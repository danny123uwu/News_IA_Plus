'use strict';
// Hash de contraseñas con scrypt asíncrono (no bloquea el event loop).
// Formato guardado: "salHex:hashHex". Sigue siendo compatible con los hashes
// creados por la versión anterior (mismo scryptSync con 64 bytes).

const crypto = require('crypto');

const LARGO_HASH = 64;

function scrypt(pass, sal) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(pass), sal, LARGO_HASH, (err, clave) => (err ? reject(err) : resolve(clave)));
  });
}

async function hash(pass) {
  const sal = crypto.randomBytes(16).toString('hex');
  const clave = await scrypt(pass, sal);
  return sal + ':' + clave.toString('hex');
}

async function check(pass, guardado) {
  try {
    const partes = String(guardado || '').split(':');
    if (partes.length !== 2) return false;
    const [sal, esperadoHex] = partes;
    if (!/^[0-9a-f]{32}$/i.test(sal) || !/^[0-9a-f]{128}$/i.test(esperadoHex)) return false;
    const esperado = Buffer.from(esperadoHex, 'hex');
    const calculado = await scrypt(pass, sal);
    if (calculado.length !== esperado.length) return false;
    return crypto.timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}

module.exports = { hash, check, LARGO_HASH };
