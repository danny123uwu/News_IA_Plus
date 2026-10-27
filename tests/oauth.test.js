'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const jwt = require('jsonwebtoken');
const { crearOAuth } = require('../services/auth/oauth');
const { verificarAcceso } = require('../services/shared/acceso');
const SECRET = 'secreto-exclusivo-de-pruebas-no-es-una-clave-real';
const REDIRECT = 'http://localhost:8090/';

async function entorno(t) {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,rol TEXT); INSERT INTO users VALUES(1,'oauth@example.test','user')");
  const oauth = crearOAuth({ db, secret: SECRET, redirectUris: [REDIRECT] });
  const app = express();
  // Sesión de usuario controlada para probar aisladamente el servidor OAuth.
  // El registro/login con contraseña se prueba además en la aplicación completa.
  app.post('/session', (req, res) => { oauth.iniciarSesion(req, res, { id: 1 }); res.json({ ok: true }); });
  app.use(oauth.router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); db.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const session = await fetch(base + '/session', { method: 'POST' });
  const cookie = session.headers.get('set-cookie').split(';')[0];
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(32).toString('base64url');
  const authorize = changes => fetch(base + '/authorize?' + new URLSearchParams({
    client_id: 'portal-web', redirect_uri: REDIRECT, response_type: 'code',
    scope: 'profile feeds ai', state, code_challenge: challenge, code_challenge_method: 'S256', ...changes
  }), { headers: { Cookie: cookie }, redirect: 'manual' });
  const exchange = (code, changes = {}) => fetch(base + '/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'portal-web',
      code, redirect_uri: REDIRECT, code_verifier: verifier, ...changes }) });
  const code = async changes => {
    const r = await authorize(changes);
    assert.equal(r.status, 302);
    const u = new URL(r.headers.get('location'));
    assert.equal(u.searchParams.get('state'), state);
    assert.ok(u.searchParams.get('code'));
    assert.ok(!u.searchParams.has('access_token'));
    return u.searchParams.get('code');
  };
  return { db, base, cookie, verifier, challenge, authorize, exchange, code, session };
}

test('OAuth Authorization Code + PKCE entrega JWT verificable por los tres servicios', async t => {
  const e = await entorno(t);
  const r = await e.exchange(await e.code());
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /no-store/);
  const d = await r.json();
  assert.equal(d.token_type.toLowerCase(), 'bearer');
  assert.ok(d.expires_in > 0 && d.expires_in <= 8 * 3600);
  assert.equal(d.refresh_token, undefined);
  for (const scope of ['profile', 'feeds', 'ai']) assert.equal(verificarAcceso(d.access_token, SECRET, scope).id, 1);
});

test('sesión y códigos OAuth se guardan hasheados, cookie HttpOnly y SameSite', async t => {
  const e = await entorno(t);
  const header = e.session.headers.get('set-cookie');
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Lax/i);
  const raw = await e.code();
  const row = e.db.prepare('SELECT * FROM oauth_codes').get();
  assert.notEqual(row.code_hash, raw);
  assert.equal(row.code_hash, crypto.createHash('sha256').update(raw).digest('hex'));
  const session = e.db.prepare('SELECT * FROM oauth_sessions').get();
  assert.ok(!e.cookie.includes(session.session_hash));
});

test('un código OAuth no puede canjearse dos veces', async t => {
  const e = await entorno(t), code = await e.code();
  assert.equal((await e.exchange(code)).status, 200);
  const r = await e.exchange(code);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'invalid_grant');
});

test('dos canjes concurrentes del mismo código solo emiten un token', async t => {
  const e = await entorno(t), code = await e.code();
  const results = await Promise.all([e.exchange(code), e.exchange(code)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
});

test('PKCE incorrecto impide el canje y consume el código', async t => {
  const e = await entorno(t), code = await e.code();
  const r = await e.exchange(code, { code_verifier: 'a'.repeat(43) });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'invalid_grant');
  assert.equal((await e.exchange(code)).status, 400);
});

test('no permite omitir PKCE ni utilizar plain', async t => {
  const e = await entorno(t);
  assert.equal((await e.authorize({ code_challenge: '' })).status, 400);
  assert.equal((await e.authorize({ code_challenge_method: 'plain' })).status, 400);
  assert.equal((await e.exchange(await e.code(), { code_verifier: '' })).status, 400);
});

test('rechaza cliente y redirect_uri no registrados sin redirigir al atacante', async t => {
  const e = await entorno(t);
  for (const changes of [{ client_id: 'otro' }, { redirect_uri: 'https://atacante.example/' }, { redirect_uri: REDIRECT + 'otra' }]) {
    const r = await e.authorize(changes);
    assert.equal(r.status, 400);
    assert.equal(r.headers.get('location'), null);
  }
});

test('redirect_uri del canje debe coincidir exactamente con el autorizado', async t => {
  const e = await entorno(t);
  assert.equal((await e.exchange(await e.code(), { redirect_uri: 'http://localhost/' })).status, 400);
});

test('sesión ausente o caducada no autoriza', async t => {
  const e = await entorno(t);
  e.db.prepare('UPDATE oauth_sessions SET expires_at=0').run();
  assert.equal((await e.authorize()).status, 401);
});

test('código caducado no produce un token', async t => {
  const e = await entorno(t), code = await e.code();
  e.db.prepare('UPDATE oauth_codes SET expires_at=0').run();
  assert.equal((await e.exchange(code)).status, 400);
});

test('logout elimina la sesión de autorización y limpia su cookie', async t => {
  const e = await entorno(t);
  const r = await fetch(e.base + '/logout', { method: 'POST', headers: { Cookie: e.cookie } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /Expires=/);
  assert.equal(e.db.prepare('SELECT count(*) n FROM oauth_sessions').get().n, 0);
  assert.equal((await e.authorize()).status, 401);
});

test('un origen web ajeno no puede canjear ni cerrar una sesión', async t => {
  const e = await entorno(t);
  for (const endpoint of ['/token', '/logout']) {
    const r = await fetch(e.base + endpoint, { method: 'POST', headers: { Origin: 'https://atacante.example', Cookie: e.cookie } });
    assert.equal(r.status, 403);
  }
});

test('no autoriza permisos inventados, implicit ni password grant', async t => {
  const e = await entorno(t);
  for (const changes of [{ scope: 'admin' }, { response_type: 'token' }, { state: '' }]) {
    const r = await e.authorize(changes);
    assert.equal(r.status, 302);
    const u = new URL(r.headers.get('location'));
    assert.ok(u.searchParams.has('error'));
    assert.ok(!u.searchParams.has('code'));
  }
  assert.equal((await e.exchange('inexistente', { grant_type: 'password' })).status, 400);
});

test('los scopes se respetan: profile no da acceso a Feeds ni Agente', async t => {
  const e = await entorno(t);
  const d = await (await e.exchange(await e.code({ scope: 'profile' }))).json();
  assert.equal(verificarAcceso(d.access_token, SECRET, 'profile').id, 1);
  for (const scope of ['feeds', 'ai']) assert.throws(() => verificarAcceso(d.access_token, SECRET, scope), e => e.status === 403);
});

test('JWT antiguo sin autorización OAuth se rechaza; JWT de servicio sigue funcionando', () => {
  const old = jwt.sign({ id: 1, rol: 'user' }, SECRET);
  assert.throws(() => verificarAcceso(old, SECRET, 'feeds'), /OAuth/);
  const internal = jwt.sign({ id: 0, rol: 'servicio' }, SECRET, { expiresIn: '1m' });
  assert.equal(verificarAcceso(internal, SECRET, 'ai').rol, 'servicio');
});

test('el access_token no se acepta si venció o se alteró su firma', () => {
  const claims = { id: 1, rol: 'user', tipo: 'oauth_access', iss: 'portal-auth', aud: 'portal-api', scope: 'feeds' };
  const expired = jwt.sign(claims, SECRET, { expiresIn: -1 });
  const forged = jwt.sign(claims, 'otra-clave-distinta', { expiresIn: 60 });
  assert.throws(() => verificarAcceso(expired, SECRET, 'feeds'), /expired/);
  assert.throws(() => verificarAcceso(forged, SECRET, 'feeds'), /signature/);
});

test('el cliente comprueba state y caducidad antes de aceptar la redirección', () => {
  const sandbox = { URLSearchParams, Date };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/public/oauth.js'), 'utf8'), sandbox);
  const validar = sandbox.PortalOAuth.validarCallback;
  assert.doesNotThrow(() => validar(new URLSearchParams('code=prueba&state=correcto'), { state: 'correcto', creado: Date.now() }));
  assert.throws(() => validar(new URLSearchParams('code=prueba&state=ajeno'), { state: 'correcto', creado: Date.now() }), /pestaña/);
  assert.throws(() => validar(new URLSearchParams('code=prueba&state=correcto'), { state: 'correcto', creado: 0 }), /expiró/);
});
