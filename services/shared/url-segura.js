'use strict';
// ============================================================================
//  url-segura.js — defensa contra SSRF
//
//  El portal descarga feeds de URLs que escribe el usuario y también puede
//  llamar a una API externa configurable. Sin control, alguien podría pedir
//  http://127.0.0.1:3001/health, http://ollama:11434 o la IP de metadatos de
//  un proveedor cloud (169.254.169.254).
//
//  Aquí se valida el protocolo, las credenciales embebidas, el puerto y TODAS
//  las direcciones IP a las que resuelve el nombre. Además se exporta un
//  `lookup` para que la conexión real vuelva a comprobar la IP en el momento
//  de conectar (mitiga el DNS rebinding).
// ============================================================================

const dns = require('node:dns');
const net = require('node:net');
const { booleano } = require('./env');

function ipv4Privada(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  return (
    a === 0 ||                       // 0.0.0.0/8
    a === 10 ||                      // 10.0.0.0/8
    a === 127 ||                     // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||      // link-local / metadatos
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224                         // multicast / reservado
  );
}

function ipv6Privada(ip) {
  let s = String(ip || '').toLowerCase().replace(/%.*$/, '');
  if (!net.isIPv6(s)) return true;
  if (s === '::' || s === '::1') return true;

  // IPv4 mapeada: ::ffff:127.0.0.1 o ::ffff:7f00:1
  const mapeada = s.match(/^::ffff:(.+)$/);
  if (mapeada) {
    const resto = mapeada[1];
    if (net.isIPv4(resto)) return ipv4Privada(resto);
    const grupos = resto.split(':');
    if (grupos.length === 2) {
      const hi = parseInt(grupos[0], 16);
      const lo = parseInt(grupos[1], 16);
      if (Number.isInteger(hi) && Number.isInteger(lo)) {
        return ipv4Privada([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
      }
    }
    return true;
  }

  return (
    /^f[cd]/.test(s) ||  // ULA fc00::/7
    /^fe[89ab]/.test(s) || // link-local fe80::/10
    /^ff/.test(s) ||     // multicast
    /^2001:db8/.test(s) || // documentación
    /^64:ff9b/.test(s)   // NAT64 (puede mapear direcciones privadas)
  );
}

function esIpPrivada(ip) {
  const dir = String(ip || '').replace(/^\[|\]$/g, '');
  if (net.isIPv4(dir)) return ipv4Privada(dir);
  if (net.isIPv6(dir)) return ipv6Privada(dir);
  return true;
}

const HOSTS_BLOQUEADOS = /(^|\.)(localhost|local|internal|home\.arpa|lan)$/i;

/**
 * Valida una URL antes de pedirla.
 * @param {string} entrada
 * @param {{permitirPrivadas?:boolean, protocolos?:string[]}} opciones
 * @returns {Promise<URL>}
 */
async function validarUrlPublica(entrada, opciones = {}) {
  const permitirPrivadas = opciones.permitirPrivadas === true ||
    (opciones.permitirPrivadas == null && booleano('PERMITIR_RED_PRIVADA', false));
  const protocolos = opciones.protocolos || ['http:', 'https:'];

  let url;
  try {
    url = new URL(String(entrada || '').trim());
  } catch {
    throw new Error('La dirección no es válida');
  }
  if (!protocolos.includes(url.protocol)) {
    throw new Error('Solo se permiten direcciones http:// o https://');
  }
  if (url.username || url.password) throw new Error('La dirección no puede incluir usuario o contraseña');
  if (!url.hostname) throw new Error('La dirección no tiene dominio');

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!permitirPrivadas) {
    if (HOSTS_BLOQUEADOS.test(host)) throw new Error('Esa dirección apunta a una red interna y no está permitida');
    if (net.isIP(host)) {
      if (esIpPrivada(host)) throw new Error('Esa dirección apunta a una red interna y no está permitida');
    } else {
      let direcciones;
      try {
        direcciones = await dns.promises.lookup(host, { all: true, verbatim: true });
      } catch {
        throw new Error('No se pudo resolver el dominio ' + host);
      }
      if (!direcciones.length) throw new Error('No se pudo resolver el dominio ' + host);
      if (direcciones.some((d) => esIpPrivada(d.address))) {
        throw new Error('Esa dirección apunta a una red interna y no está permitida');
      }
    }
  }
  return url;
}

/**
 * `lookup` para http/https.request: bloquea la conexión si la IP resuelta en
 * ese instante es privada. Evita que un DNS malicioso cambie la respuesta
 * entre la validación y la conexión.
 */
function lookupSeguro(hostname, opciones, callback) {
  const cb = typeof opciones === 'function' ? opciones : callback;
  const opts = typeof opciones === 'function' ? {} : (opciones || {});
  const host = String(hostname || '').replace(/^\[|\]$/g, '');

  if (net.isIP(host)) {
    if (esIpPrivada(host)) return cb(new Error('Destino de red interna no permitido'));
    return cb(null, host, net.isIPv6(host) ? 6 : 4);
  }

  dns.lookup(host, Object.assign({}, opts, { all: true, verbatim: true }), (err, lista) => {
    if (err) return cb(err);
    if (!lista || !lista.length) return cb(new Error('No se pudo resolver el dominio'));
    if (lista.some((d) => esIpPrivada(d.address))) {
      return cb(new Error('Destino de red interna no permitido'));
    }
    if (opts.all) return cb(null, lista);
    return cb(null, lista[0].address, lista[0].family);
  });
}

module.exports = { esIpPrivada, validarUrlPublica, lookupSeguro };
