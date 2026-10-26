'use strict';
// ============================================================================
//  http.js — utilidades HTTP compartidas por los microservicios
//
//  · cabeceras de seguridad (también sirven sin Nginx, en desarrollo)
//  · CORS restringido (por defecto solo el frontend local de desarrollo)
//  · limitador de peticiones en memoria (sin dependencias externas)
//  · lectura de respuestas con tope de tamaño (evita agotar la memoria)
//  · parseo/validación de datos de entrada
// ============================================================================

const { entero, texto } = require('./env');

function cabecerasSeguridad(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (req.path.startsWith('/health')) res.setHeader('Cache-Control', 'no-store');
  next();
}

function corsPortal() {
  const permitidos = texto(
    'CORS_ORIGINS',
    'http://localhost:8090,http://127.0.0.1:8090'
  ).split(',').map((s) => s.trim()).filter(Boolean);

  return function cors(req, res, next) {
    const origen = req.headers.origin;
    if (origen && permitidos.includes(origen)) {
      res.setHeader('Access-Control-Allow-Origin', origen);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

// ---------------------------------------------------------------------------
//  Limitador de peticiones (ventana fija por clave).
//  Suficiente para un despliegue doméstico: evita fuerza bruta y abuso de la
//  IA sin añadir Redis ni dependencias. Se limpia solo para no crecer sin fin.
// ---------------------------------------------------------------------------
function crearLimitador({ ventanaMs, maximo, clave, mensaje }) {
  const registros = new Map();
  const limpiar = setInterval(() => {
    const ahora = Date.now();
    for (const [k, v] of registros) if (v.reinicio <= ahora) registros.delete(k);
  }, Math.max(60000, ventanaMs));
  if (limpiar.unref) limpiar.unref();

  return function limitador(req, res, next) {
    const k = typeof clave === 'function' ? clave(req) : (req.ip || req.socket.remoteAddress || 'desconocido');
    const ahora = Date.now();
    let r = registros.get(k);
    if (!r || r.reinicio <= ahora) {
      r = { cuenta: 0, reinicio: ahora + ventanaMs };
      registros.set(k, r);
    }
    r.cuenta++;
    res.setHeader('X-RateLimit-Limit', String(maximo));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maximo - r.cuenta)));
    if (r.cuenta > maximo) {
      res.setHeader('Retry-After', String(Math.ceil((r.reinicio - ahora) / 1000)));
      return res.status(429).json({ error: mensaje || 'Demasiadas peticiones. Esperá un momento.' });
    }
    next();
  };
}

// ---------------------------------------------------------------------------
//  Lectura de una respuesta fetch con tope de bytes.
// ---------------------------------------------------------------------------
async function leerTextoLimitado(respuesta, maxBytes = 1024 * 1024) {
  const declarado = Number(respuesta.headers.get('content-length') || 0);
  if (declarado > maxBytes) throw new Error('La respuesta del proveedor es demasiado grande');
  if (!respuesta.body) return (await respuesta.text()).slice(0, maxBytes);

  const lector = respuesta.body.getReader();
  const trozos = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await lector.cancel(); } catch {}
        throw new Error('La respuesta del proveedor es demasiado grande');
      }
      trozos.push(Buffer.from(value));
    }
  } finally {
    try { lector.releaseLock(); } catch {}
  }
  return Buffer.concat(trozos).toString('utf8');
}

async function leerJsonLimitado(respuesta, maxBytes = 2 * 1024 * 1024) {
  const txt = await leerTextoLimitado(respuesta, maxBytes);
  try { return JSON.parse(txt); } catch { throw new Error('El proveedor devolvió una respuesta inválida'); }
}

// ---------------------------------------------------------------------------
//  Validaciones de entrada
// ---------------------------------------------------------------------------
function recortar(valor, max) {
  return String(valor == null ? '' : valor).slice(0, max);
}

function numero(valor, porDefecto, min, max) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return porDefecto;
  return Math.max(min, Math.min(max, n));
}

function jsonSeguro(txt, porDefecto) {
  try { return JSON.parse(txt); } catch { return porDefecto; }
}

function listaSegura(txt) {
  const v = jsonSeguro(txt, []);
  return Array.isArray(v) ? v : [];
}

module.exports = {
  cabecerasSeguridad,
  corsPortal,
  crearLimitador,
  leerTextoLimitado,
  leerJsonLimitado,
  recortar,
  numero,
  jsonSeguro,
  listaSegura,
  entero
};
