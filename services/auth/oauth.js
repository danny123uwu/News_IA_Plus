'use strict';
// Servidor OAuth 2.0: Authorization Code + PKCE S256 para el cliente público
// del portal. La biblioteca valida el protocolo; SQLite guarda sesiones y
// códigos de un solo uso, y JWT firma el access_token para los microservicios.
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const OAuth2Server = require('@node-oauth/oauth2-server');
const { crearLimitador } = require('../shared/http');

const CLIENT_ID = 'portal-web';
const SCOPES = ['profile', 'feeds', 'ai'];
const COOKIE = 'portal_oauth_session';
const ACCESS_SECONDS = 8 * 3600;
const SESSION_SECONDS = 10 * 60;
const REDIRECTS = [
  'http://localhost/', 'http://127.0.0.1/',
  'http://localhost:8090/', 'http://127.0.0.1:8090/',
  'http://localhost:8080/', 'http://127.0.0.1:8080/'
];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function crearOAuth({ db, secret, redirectUris = REDIRECTS }) {
  const redirects = [...new Set(redirectUris)];
  for (const value of redirects) {
    const u = new URL(value);
    if (u.hash || u.search || u.username || u.password ||
        !(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))) {
      throw new Error('OAUTH_REDIRECT_URIS requiere URLs HTTPS o localhost, sin credenciales, query ni fragmento');
    }
  }
  const origins = new Set(redirects.map(u => new URL(u).origin));
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_sessions (
      session_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_codes (
      code_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL DEFAULT 'S256' CHECK(code_challenge_method='S256'),
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expiry ON oauth_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_oauth_codes_expiry ON oauth_codes(expires_at);
  `);
  const client = { id: CLIENT_ID, grants: ['authorization_code'], redirectUris: redirects };
  const userById = id => db.prepare('SELECT id,email,rol FROM users WHERE id=?').get(id);
  const limpiar = () => {
    db.prepare('DELETE FROM oauth_sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('DELETE FROM oauth_codes WHERE expires_at<=?').run(Date.now());
  };
  const model = {
    getClient(id, secret) { return id === CLIENT_ID && !secret ? client : false; },
    validateScope(user, client, scopes) {
      const requested = scopes?.length ? scopes : SCOPES;
      return requested.every(s => SCOPES.includes(s)) ? [...new Set(requested)] : false;
    },
    generateAuthorizationCode() { return crypto.randomBytes(32).toString('base64url'); },
    saveAuthorizationCode(code, client, user) {
      limpiar();
      db.prepare(`INSERT INTO oauth_codes
        (code_hash,user_id,client_id,redirect_uri,scope,code_challenge,code_challenge_method,expires_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(hash(code.authorizationCode), user.id, client.id,
        code.redirectUri, code.scope.join(' '), code.codeChallenge, code.codeChallengeMethod, code.expiresAt.getTime());
      return { ...code, client, user };
    },
    getAuthorizationCode(code) {
      const row = db.prepare('SELECT * FROM oauth_codes WHERE code_hash=?').get(hash(code));
      if (!row || row.client_id !== CLIENT_ID) return false;
      const user = userById(row.user_id);
      if (!user) return false;
      return { authorizationCode: code, client, user, redirectUri: row.redirect_uri,
        expiresAt: new Date(row.expires_at), scope: row.scope.split(' '),
        codeChallenge: row.code_challenge, codeChallengeMethod: row.code_challenge_method };
    },
    revokeAuthorizationCode(code) {
      // DELETE condicional y síncrono: dos canjes concurrentes no pueden ganar.
      return db.prepare('DELETE FROM oauth_codes WHERE code_hash=?').run(hash(code.authorizationCode)).changes === 1;
    },
    generateAccessToken(client, user, scope) {
      return jwt.sign({ id: user.id, email: user.email, rol: user.rol,
        tipo: 'oauth_access', client_id: client.id, scope: scope.join(' ') }, secret,
      { algorithm: 'HS256', expiresIn: ACCESS_SECONDS, subject: String(user.id),
        issuer: 'portal-auth', audience: 'portal-api', jwtid: crypto.randomUUID() });
    },
    // Este cliente utiliza Authorization Code, no se emiten refresh tokens.
    generateRefreshToken() { return undefined; },
    saveToken(token, client, user) { return { ...token, client, user }; }
  };
  const server = new OAuth2Server({ model, authorizationCodeLifetime: 60,
    accessTokenLifetime: ACCESS_SECONDS, requirePKCE: true, enablePlainPKCE: false,
    allowEmptyState: false, requireClientAuthentication: { authorization_code: false } });
  const cookieValue = headers => {
    const entry = String(headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='));
    const value = entry?.slice(COOKIE.length + 1) || '';
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
  };
  const cookieOptions = req => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
  function origenPermitido(req, res, next) {
    if (req.headers.origin && !origins.has(req.headers.origin)) {
      return res.status(403).json({ error: 'access_denied', error_description: 'Origen no autorizado' });
    }
    next();
  }
  function iniciarSesion(req, res, user) {
    limpiar();
    const previous = cookieValue(req.headers);
    if (previous) db.prepare('DELETE FROM oauth_sessions WHERE session_hash=?').run(hash(previous));
    const session = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO oauth_sessions(session_hash,user_id,expires_at) VALUES(?,?,?)')
      .run(hash(session), user.id, Date.now() + SESSION_SECONDS * 1000);
    res.set('Cache-Control', 'no-store');
    res.cookie(COOKIE, session, { ...cookieOptions(req), maxAge: SESSION_SECONDS * 1000 });
  }
  function usuarioSesion(request) {
    const value = cookieValue(request.headers);
    const row = value && db.prepare('SELECT user_id FROM oauth_sessions WHERE session_hash=? AND expires_at>?')
      .get(hash(value), Date.now());
    if (!row) throw new OAuth2Server.UnauthorizedRequestError('Iniciá sesión para autorizar el acceso');
    return userById(row.user_id);
  }
  function enviar(res, response, error) {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    if (response?.headers) res.set(response.headers);
    if (response?.headers?.location) return res.status(response.status).end();
    if (error) {
      const status = error.code >= 400 && error.code < 500 ? error.code : 500;
      return res.status(status).json({ error: status === 500 ? 'server_error' : error.name,
        error_description: status === 500 ? 'No se pudo completar la autorización' : error.message });
    }
    return res.status(response.status).json(response.body);
  }
  const router = express.Router();
  const limitar = crearLimitador({ ventanaMs: 60000, maximo: 60 });
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/authorize', limitar, async (req, res) => {
    // Nunca redirigir a una URL arbitraria, incluso cuando hay otro error.
    if (req.query.client_id !== CLIENT_ID || !redirects.includes(req.query.redirect_uri)) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Cliente o redirect_uri no registrado' });
    }
    if (req.query.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(req.query.code_challenge || '')) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'Se requiere PKCE S256 válido' });
    }
    const response = new OAuth2Server.Response(res);
    try {
      await server.authorize(new OAuth2Server.Request(req), response,
        { authenticateHandler: { handle: usuarioSesion } });
      enviar(res, response);
    } catch (error) { enviar(res, response, error); }
  });
  router.post('/token', origenPermitido, limitar, express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 }), async (req, res) => {
    const response = new OAuth2Server.Response(res);
    try {
      await server.token(new OAuth2Server.Request(req), response);
      enviar(res, response);
    } catch (error) { enviar(res, response, error); }
  });
  router.post('/logout', origenPermitido, (req, res) => {
    const value = cookieValue(req.headers);
    if (value) db.prepare('DELETE FROM oauth_sessions WHERE session_hash=?').run(hash(value));
    res.clearCookie(COOKIE, cookieOptions(req));
    res.json({ ok: true });
  });
  return { router, iniciarSesion, origenPermitido };
}

module.exports = { crearOAuth, CLIENT_ID, SCOPES, REDIRECTS };
