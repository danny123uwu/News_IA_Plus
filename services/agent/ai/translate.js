'use strict';
// ============================================================================
//  translate.js — traducción al español
//
//  · caché en memoria (mismo párrafo = no se vuelve a pedir a Google)
//  · traduce título + texto en UNA petición cuando es posible
//  · respeta el motor elegido por el usuario (Google, MyMemory, API o local)
//  · si el motor es "API externa", NO usa Ollama salvo respaldoLocal=true
// ============================================================================

const crypto = require('crypto');
const { entero } = require('../../shared/env');
const { disponible, preguntar } = require('./ollama');
const { apiExterna } = require('./providers');
const { mapLimit } = require('../../shared/async');

const CACHE_TTL_MS = entero('TRAD_CACHE_MINUTOS', 360, { min: 1, max: 2880 }) * 60000;
const CACHE_MAX = entero('TRAD_CACHE_MAX', 800, { min: 50, max: 5000 });
const CONCURRENCIA = entero('TRAD_CONCURRENCIA', 4, { min: 1, max: 12 });
const cache = new Map();

const limpieza = setInterval(() => {
  const ahora = Date.now();
  for (const [k, v] of cache) if (v.exp <= ahora) cache.delete(k);
}, 60000);
if (limpieza.unref) limpieza.unref();

function clave(texto) {
  return crypto.createHash('sha1').update(String(texto)).digest('hex');
}

function cacheGet(texto) {
  const v = cache.get(clave(texto));
  if (!v) return null;
  if (v.exp <= Date.now()) { cache.delete(clave(texto)); return null; }
  return v;
}

function cacheSet(texto, valor) {
  if (!texto || String(texto).length < 8) return;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(clave(texto), { ...valor, exp: Date.now() + CACHE_TTL_MS });
}

function esEspanol(t) {
  const s = String(t || '');
  if (/[ñáéíóúü¿¡]/i.test(s)) return true;
  const palabras = (s.toLowerCase().match(/\b[a-záéíóúüñ]+/g) || []).length;
  if (!palabras) return false;
  const comunes = (s.toLowerCase().match(/\b(el|la|los|las|de|del|que|y|en|un|una|para|con|por|se|su|sus|no|es|al|más|como|desde|sobre|entre|este|esta|muy|pero|hay|son|fue|han|cuando|también|contra|sin|ante|bajo)\b/g) || []).length;
  return comunes / palabras > 0.1;
}

async function apiGoogle(q) {
  const u = 'https://translate.googleapis.com/translate_a/single?' +
    new URLSearchParams({ client: 'dict-chrome-ex', sl: 'auto', tl: 'es', dt: 't', q });
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('google ' + r.status);
  const d = await r.json();
  const txt = (d[0] || []).map((x) => x[0]).join('');
  if (!txt) throw new Error('google sin texto');
  return txt;
}

async function apiMyMemory(q) {
  const u = 'https://api.mymemory.translated.net/get?' +
    new URLSearchParams({ q: q.slice(0, 4500), langpair: 'autodetect|es' });
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('mymemory ' + r.status);
  const d = await r.json();
  const txt = d && d.responseData && d.responseData.translatedText;
  if (!txt || /MYMEMORY WARNING|INVALID|QUERY LENGTH/i.test(txt)) throw new Error('mymemory límite');
  return txt;
}

/**
 * Traduce un texto con el orden de motores que eligió el usuario.
 * @param {string} q
 * @param {object} cfg configuración de IA
 */
async function traducirTexto(q, cfg) {
  if (!q) return { texto: '', proveedor: 'nulo' };

  const usarCache = cfg.traduccion !== 'motor';
  if (usarCache) {
    const hit = cacheGet(q);
    if (hit) return { texto: hit.texto, proveedor: hit.proveedor };
  }

  const errores = [];
  const local = async (texto) => {
    if (!(await disponible())) throw new Error('ollama apagado');
    const modelo = cfg.modelos.resumir || undefined;
    const r = await preguntar({
      prompt: `Traduce esto al español. Devuelve SOLO la traducción, sin explicaciones:\n\n${texto.slice(0, 2500)}`,
      system: 'Eres un traductor profesional al español.',
      modelo,
      tarea: 'resumir'
    });
    if (!r) throw new Error('ollama sin texto');
    return r;
  };
  const viaApi = async (texto) => apiExterna(
    cfg.api,
    `Traduce esto al español. Devuelve SOLO la traducción, sin explicaciones:\n\n${texto.slice(0, 2500)}`,
    'Eres un traductor profesional al español.'
  );

  const apiLista = Boolean(cfg.api.key && (cfg.api.baseUrl || cfg.api.proveedor === 'gemini'));
  const usarLocal = cfg.motor !== 'api' || cfg.respaldoLocal === true;
  const pasos = [];
  if (cfg.traduccion === 'motor') {
    if (cfg.motor === 'api' && apiLista) pasos.push(['api:' + cfg.api.proveedor, viaApi]);
    else if (usarLocal) pasos.push(['ollama', local]);
    pasos.push(['google', apiGoogle], ['mymemory', apiMyMemory]);
  } else {
    pasos.push(['google', apiGoogle], ['mymemory', apiMyMemory]);
    if (cfg.motor === 'api' && apiLista) pasos.push(['api:' + cfg.api.proveedor, viaApi]);
    if (usarLocal) pasos.push(['ollama', local]);
  }

  for (const [nombre, fn] of pasos) {
    try {
      const texto = await fn(q);
      if (usarCache && (nombre === 'google' || nombre === 'mymemory')) {
        cacheSet(q, { texto, proveedor: nombre });
      }
      return { texto, proveedor: nombre };
    } catch (e) {
      errores.push(nombre + ': ' + e.message);
    }
  }
  throw new Error(errores.join(' | ') || 'sin traductor disponible');
}

/**
 * Traduce título y cuerpo. Si el traductor es Google y el texto no es enorme,
 * manda ambos en una sola petición (la mitad de llamadas que antes).
 */
async function traducirPar({ titulo, texto, modo, cfg }) {
  const tituloOriginal = String(titulo || '');
  const textoOriginal = String(texto || '');
  const textoRecortado = modo === 'completo' ? textoOriginal.slice(0, 4000) : textoOriginal.slice(0, 900);

  if (!tituloOriginal && !textoOriginal) {
    return { titulo: '', texto: '', proveedor: 'nulo' };
  }
  if (esEspanol(tituloOriginal + ' ' + textoOriginal.slice(0, 300))) {
    return { titulo: tituloOriginal, texto: textoOriginal, proveedor: 'original', idioma: 'es' };
  }

  const combinado = tituloOriginal && textoRecortado && cfg.traduccion !== 'motor' &&
    (tituloOriginal.length + textoRecortado.length) <= 2500;

  if (combinado) {
    const union = tituloOriginal.trim() + '\n' + textoRecortado.trim();
    const hit = cacheGet(union);
    if (hit && hit.partes) {
      return { titulo: hit.partes[0], texto: hit.partes[1], proveedor: hit.proveedor, idioma: 'es' };
    }
    try {
      const traducido = await apiGoogle(union);
      const corte = traducido.indexOf('\n');
      if (corte > 0) {
        const partes = [traducido.slice(0, corte).trim(), traducido.slice(corte + 1).trim()];
        if (partes[0] && partes[1]) {
          cacheSet(union, { texto: traducido, proveedor: 'google', partes });
          cacheSet(tituloOriginal, { texto: partes[0], proveedor: 'google' });
          cacheSet(textoRecortado, { texto: partes[1], proveedor: 'google' });
          return { titulo: partes[0], texto: partes[1], proveedor: 'google', idioma: 'es' };
        }
      }
    } catch {
      // Si el traductor combinado falla, seguimos con el camino normal.
    }
  }

  const [t, x] = await Promise.all([
    tituloOriginal ? traducirTexto(tituloOriginal, cfg) : Promise.resolve({ texto: '', proveedor: 'nulo' }),
    textoRecortado ? traducirTexto(textoRecortado, cfg) : Promise.resolve({ texto: '', proveedor: 'nulo' })
  ]);

  return {
    titulo: t.texto || tituloOriginal,
    texto: x.texto,
    proveedor: t.proveedor,
    idioma: 'es'
  };
}

/**
 * Traduce varios fragmentos (cuerpo de la noticia) con traductores gratuitos.
 * Se usa en /spanish/bloques: no toca el modelo local ni la GPU.
 */
async function traducirBloques(textos, { concurrencia = CONCURRENCIA } = {}) {
  const lista = Array.isArray(textos) ? textos : [];
  if (!lista.length) return [];

  return mapLimit(lista, concurrencia, async (t) => {
    if (!String(t || '').trim()) return String(t || '');
    const hit = cacheGet(t);
    if (hit) return hit.texto;
    try {
      const r = await apiGoogle(t);
      cacheSet(t, { texto: r, proveedor: 'google' });
      return r;
    } catch {}
    try {
      const r = await apiMyMemory(t);
      cacheSet(t, { texto: r, proveedor: 'mymemory' });
      return r;
    } catch {}
    return '';
  });
}

module.exports = {
  esEspanol,
  apiGoogle,
  apiMyMemory,
  traducirTexto,
  traducirPar,
  traducirBloques
};
