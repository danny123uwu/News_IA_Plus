'use strict';
const jwt = require('jsonwebtoken');

// OAuth autoriza y emite el access_token. Los servicios verifican su firma JWT
// y que incluya el permiso del recurso, sin compartir la base de Auth.
function verificarAcceso(token, secret, scope) {
  const claims = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (claims.rol === 'servicio' && claims.id === 0) return claims;
  if (claims.tipo !== 'oauth_access' || claims.iss !== 'portal-auth' || claims.aud !== 'portal-api') {
    throw new Error('Se requiere un access_token de OAuth 2.0');
  }
  if (!String(claims.scope || '').split(' ').includes(scope)) {
    throw Object.assign(new Error('El token no tiene permiso para este servicio'), { status: 403 });
  }
  return claims;
}

module.exports = { verificarAcceso };
