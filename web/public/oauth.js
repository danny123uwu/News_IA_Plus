'use strict';
// Cliente público OAuth 2.0. El secreto PKCE y state permanecen en esta pestaña;
// el código viaja en la redirección, nunca el access_token.
(function (root) {
  const KEY = 'portal_oauth_pending';
  const TOKEN = 'portal_oauth_access_token';
  const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const aleatorio = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

  function validarCallback(params, pending) {
    if (!pending || !Number.isFinite(pending.creado) || pending.creado > Date.now() + 60000 ||
        Date.now() - pending.creado > 5 * 60 * 1000 || params.get('state') !== pending.state) {
      throw new Error('La autorización no corresponde a esta pestaña o expiró. Iniciá sesión de nuevo.');
    }
    if (params.has('error')) throw new Error(params.get('error_description') || 'No se autorizó el acceso');
    if (!params.get('code')) throw new Error('Falta el código de autorización');
  }

  async function iniciar(auth) {
    const verifier = aleatorio();
    const state = aleatorio();
    const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const redirect = location.origin + '/';
    sessionStorage.setItem(KEY, JSON.stringify({ verifier, state, redirect, creado: Date.now() }));
    const url = new URL(auth + '/authorize', location.origin);
    url.search = new URLSearchParams({ client_id: 'portal-web', response_type: 'code',
      redirect_uri: redirect, scope: 'profile feeds ai', state,
      code_challenge: challenge, code_challenge_method: 'S256' });
    location.assign(url.href);
  }

  async function completar(auth) {
    const params = new URLSearchParams(location.search);
    if (!params.has('code') && !params.has('error')) return null;
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem(KEY)); } catch {}
    sessionStorage.removeItem(KEY);
    const limpia = new URL(location.href);
    for (const k of ['code', 'state', 'error', 'error_description']) limpia.searchParams.delete(k);
    history.replaceState(null, '', limpia.pathname + limpia.search + limpia.hash);
    validarCallback(params, pending);
    const r = await fetch(auth + '/token', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'portal-web',
        redirect_uri: pending.redirect, code: params.get('code'), code_verifier: pending.verifier })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error_description || 'No se pudo obtener autorización');
    if (!d.access_token || String(d.token_type).toLowerCase() !== 'bearer') {
      throw new Error('El servidor no devolvió un token de acceso válido');
    }
    sessionStorage.setItem(TOKEN, d.access_token);
    return d.access_token;
  }

  function limpiar() {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(TOKEN);
  }
  root.PortalOAuth = { iniciar, completar, limpiar, validarCallback, TOKEN };
})(globalThis);
