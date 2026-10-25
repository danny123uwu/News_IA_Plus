'use strict';
// ============================================================================
//  rss.js — Lectura de feeds "a prueba de balas"
//
//  Problema real (capturas ss1 / ss2): la gente pega la dirección de la
//  PÁGINA (https://sitio.com/index.php) en vez de la del FEED. Ahí pasaban dos
//  cosas distintas según el sitio:
//    · "Status code 404"            -> el sitio no tiene feed en esa ruta.
//    · "Unexpected close tag ..."   -> el parser intentaba leer HTML como XML.
//  Además hay feeds con el XML roto (un <br> sin cerrar, un & suelto, basura
//  antes del <?xml ...?>) que antes se rechazaban de plano.
//
//  Este módulo hace, en orden:
//    1. Descarga con User-Agent de navegador (muchos medios bloquean bots).
//    2. Si ya es un feed -> lo parsea (estricto y, si falla, tolerante).
//    3. Si es una página HTML -> BUSCA el feed del sitio:
//         <link rel="alternate" type="application/rss+xml">
//         enlaces tipo "RSS"/"Feed"/"Suscribirse"
//         rutas típicas (/feed, /rss.xml, /?feed=rss2, Joomla, Blogger...)
//         API REST de WordPress (/wp-json/wp/v2/posts)
//    4. Si el XML viene roto -> lo repara (CDATA, & sueltos, entidades HTML,
//       basura alrededor del elemento raíz, etiquetas sin cerrar) y, como
//       último recurso, rescata los <item> a mano.
//
//  Devuelve siempre la URL REAL del feed, para guardarla en la base de datos.
// ============================================================================

const Parser = require('rss-parser');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CABECERAS = {
  'User-Agent': UA,
  Accept: 'application/rss+xml, application/atom+xml, application/rdf+xml;q=0.9, ' +
    'application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, application/json;q=0.7, */*;q=0.6',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache'
};

const CAMPOS = {
  item: [
    ['media:content', 'media', { keepArray: true }],
    ['media:thumbnail', 'thumb', { keepArray: true }],
    'enclosure',
    'content:encoded'
  ]
};

// Dos parsers: el estricto da mejores resultados; el laxo perdona XML roto.
const estricto = new Parser({ timeout: 15000, customFields: CAMPOS });
const laxo = new Parser({ timeout: 15000, customFields: CAMPOS, xml2js: { strict: false } });

const MAX_BYTES = 6 * 1024 * 1024;
const CONCURRENCIA = 4;

// ---------- errores con mensaje humano --------------------------------------
class ErrorFeed extends Error {
  constructor(codigo, mensaje, extra = {}) {
    super(mensaje);
    this.name = 'ErrorFeed';
    this.codigo = codigo;
    Object.assign(this, extra);
  }
}

// ---------- utilidades ------------------------------------------------------
const ENTIDADES = {
  nbsp: ' ', iexcl: '¡', cent: '¢', pound: '£', curren: '¤', yen: '¥', brvbar: '¦', sect: '§',
  uml: '¨', copy: '©', ordf: 'ª', laquo: '«', not: '¬', shy: '', reg: '®', macr: '¯',
  deg: '°', plusmn: '±', sup2: '²', sup3: '³', acute: '´', micro: 'µ', para: '¶',
  middot: '·', cedil: '¸', sup1: '¹', ordm: 'º', raquo: '»', frac14: '¼', frac12: '½',
  frac34: '¾', iquest: '¿', times: '×', divide: '÷', euro: '€', trade: '™',
  ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '', lrm: '', rlm: '',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”',
  bdquo: '„', dagger: '†', Dagger: '‡', bull: '•', hellip: '…', permil: '‰',
  prime: '′', Prime: '″', lsaquo: '‹', rsaquo: '›', oline: '‾', frasl: '⁄',
  larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔', minus: '−', lowast: '∗',
  radic: '√', infin: '∞', ne: '≠', le: '≤', ge: '≥', spades: '♠', clubs: '♣',
  hearts: '♥', diams: '♦', Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã',
  Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É',
  Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï', ETH: 'Ð',
  Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö',
  Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý',
  THORN: 'Þ', szlig: 'ß', agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã',
  auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é',
  ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', eth: 'ð',
  ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö',
  oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý',
  thorn: 'þ', yuml: 'ÿ', OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š',
  Yuml: 'Ÿ', fnof: 'ƒ', circ: 'ˆ', tilde: '˜'
};

/** Decodifica bytes respetando el charset del header o del <?xml?>. */
function decodificar(buf, contentType) {
  let charset = (String(contentType).match(/charset\s*=\s*["']?([\w-]+)/i) || [])[1];
  if (!charset) {
    const cabecera = buf.subarray(0, 300).toString('latin1');
    charset = (cabecera.match(/encoding\s*=\s*["']([\w-]+)["']/i) || [])[1];
  }
  charset = String(charset || 'utf-8').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const alias = { utf8: 'utf-8', latin1: 'windows-1252', 'iso8859-1': 'iso-8859-1' };
  charset = alias[charset] || charset;
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

function sinBom(s) {
  return String(s || '').replace(/^\uFEFF/, '').replace(/^\uFEFF/, '');
}

/** ¿El cuerpo descargado es ya un feed (XML) o una página web? */
function pareceXml(texto) {
  const cab = sinBom(texto).slice(0, 4000).trimStart();
  return /^(<\?xml|<!doctype\s+rss|<rss[\s>]|<feed[\s>]|<rdf:rdf[\s>]|<rdf[\s>])/i.test(cab) ||
    /<rss[\s>]|<feed[\s>]|<rdf:rdf[\s>]/i.test(cab);
}

function pareceHtml(texto, tipo) {
  const cab = sinBom(texto).slice(0, 4000).trimStart().toLowerCase();
  if (/^(<!doctype\s+html|<html[\s>])/.test(cab)) return true;
  return /text\/html|application\/xhtml/i.test(String(tipo)) && !pareceXml(texto);
}

/**
 * Sanea un XML para que el parser estricto no reviente.
 * No toca el interior de los CDATA (ahí el & es literal y debe seguir siéndolo).
 */
function limpiarXml(xml) {
  const partes = sinBom(xml).split(/(<!\[CDATA\[[\s\S]*?\]\]>)/);
  return partes.map((parte, i) => (i % 2 ? parte : arreglarXml(parte))).join('');
}

function arreglarXml(s) {
  return s
    // caracteres de control que XML no admite
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    // entidades: las 5 de XML se dejan intactas; las HTML se vuelven carácter
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, n) => {
      const l = n.toLowerCase();
      if (l === 'amp' || l === 'lt' || l === 'gt' || l === 'quot' || l === 'apos') return m;
      return Object.prototype.hasOwnProperty.call(ENTIDADES, n) ? ENTIDADES[n] : '&amp;' + n + ';';
    })
    // & sueltos (no son entidad ni referencia numérica)
    .replace(/&(?!#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
}

/** Devuelve texto plano: resuelve entidades (&quot;, &#39;, &nbsp;…) y espacios. */
function decodificarEntidades(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; }
    })
    .replace(/&#(\d+);/g, (m, d) => {
      try { return String.fromCodePoint(Number(d)); } catch { return m; }
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, n) => {
      const basicas = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (Object.prototype.hasOwnProperty.call(basicas, n.toLowerCase())) return basicas[n.toLowerCase()];
      return Object.prototype.hasOwnProperty.call(ENTIDADES, n) ? ENTIDADES[n] : m;
    })
    .replace(/[\u00A0\u200B]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quita basura antes/después del elemento raíz (avisos de PHP, HTML pegado…). */
function recortarRaiz(xml) {
  let s = sinBom(xml);
  const inicio = s.search(/<(rss|feed|rdf:RDF)\b/i);
  if (inicio > 0) s = s.slice(inicio);
  const cierres = [/<\/rss\s*>/gi, /<\/feed\s*>/gi, /<\/rdf:RDF\s*>/gi];
  let fin = -1;
  for (const re of cierres) {
    let m;
    while ((m = re.exec(s))) fin = Math.max(fin, m.index + m[0].length);
  }
  if (fin > 0 && fin < s.length) s = s.slice(0, fin);
  return s;
}

/** Último recurso: el XML está tan roto que rescatamos los <item> a mano. */
function rescatarItems(xml, urlBase) {
  const items = [];
  const bloques = String(xml).match(/<(item|entry)\b[\s\S]*?<\/\1\s*>/gi) || [];
  const campo = (bloque, tag) => {
    const re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'i');
    const m = bloque.match(re);
    if (!m) return '';
    return m[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };
  const enlace = (bloque) => {
    const simple = bloque.match(/<link\b[^>]*>([\s\S]*?)<\/link\s*>/i);
    if (simple) {
      const u = simple[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
      if (u && !/</.test(u)) return u;
    }
    const href = bloque.match(/<link\b[^>]*href\s*=\s*["']([^"']+)["']/i);
    return href ? href[1].trim() : '';
  };

  for (const b of bloques.slice(0, 60)) {
    const link = absoluta(enlace(b), urlBase);
    const titulo = campo(b, 'title');
    if (!link && !titulo) continue;
    items.push({
      title: titulo || '(sin título)',
      link,
      content: campo(b, 'content:encoded') || campo(b, 'description') ||
        campo(b, 'summary') || campo(b, 'content'),
      contentSnippet: campo(b, 'description').slice(0, 400),
      isoDate: campo(b, 'pubDate') || campo(b, 'published') || campo(b, 'updated') || campo(b, 'dc:date'),
      creator: campo(b, 'dc:creator') || campo(b, 'author')
    });
  }
  const tituloFeed = campo(String(xml), 'title');
  return items.length ? { title: tituloFeed || '', items } : null;
}

function absoluta(href, base) {
  const h = String(href || '').trim();
  if (!h) return '';
  if (/^https?:\/\//i.test(h)) return h;
  if (/^\/\//.test(h)) return 'https:' + h;
  try { return new URL(h, base).href; } catch { return h; }
}

function normalizarUrl(entrada) {
  let u = String(entrada || '').trim().replace(/^feed:\/\//i, 'https://');
  if (!u) return '';
  if (/^\/\//.test(u)) u = 'https:' + u;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { return new URL(u).href; } catch { return ''; }
}

function hostDe(url) {
  try { return new URL(url).host; } catch { return url; }
}

// ---------- descarga --------------------------------------------------------
async function bajar(url, { timeout = 12000 } = {}) {
  let r;
  try {
    r = await fetch(url, {
      redirect: 'follow',
      headers: CABECERAS,
      signal: AbortSignal.timeout(timeout)
    });
  } catch (e) {
    const lento = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new ErrorFeed(lento ? 'tiempo' : 'red',
      lento
        ? 'El sitio ' + hostDe(url) + ' tardó demasiado en responder (más de ' + Math.round(timeout / 1000) + ' s).'
        : 'No se pudo conectar con ' + hostDe(url) + '. Revisá la dirección o tu conexión.',
      { url, causa: e.message });
  }

  const tipo = r.headers.get('content-type') || '';
  const largo = Number(r.headers.get('content-length') || 0);
  if (largo > MAX_BYTES) {
    try { await r.body?.cancel(); } catch {}
    throw new ErrorFeed('grande', 'La respuesta de ' + hostDe(url) + ' es demasiado grande.', { url, estado: r.status });
  }

  let buf;
  try {
    buf = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    throw new ErrorFeed('red', 'Se cortó la descarga de ' + hostDe(url) + '.', { url, causa: e.message });
  }
  if (buf.length > MAX_BYTES) buf = buf.subarray(0, MAX_BYTES);

  const texto = decodificar(buf, tipo);
  return {
    url,
    urlFinal: r.url || url,
    estado: r.status,
    tipo,
    texto,
    esXml: pareceXml(texto),
    esHtml: pareceHtml(texto, tipo)
  };
}

/** Convierte la respuesta de /wp-json/wp/v2/posts en un feed con items. */
function feedDeWpJson(texto, url) {
  let datos;
  try { datos = JSON.parse(texto); } catch { return null; }
  if (!Array.isArray(datos) || !datos.length) return null;
  if (!datos[0] || typeof datos[0] !== 'object' || !datos[0].link || !('title' in datos[0])) return null;
  const items = datos.map((p) => ({
    title: String((p.title && p.title.rendered) || '').replace(/<[^>]+>/g, ' ').trim(),
    link: p.link || '',
    content: (p.content && p.content.rendered) || (p.excerpt && p.excerpt.rendered) || '',
    contentSnippet: String((p.excerpt && p.excerpt.rendered) || '').replace(/<[^>]+>/g, ' ').trim(),
    isoDate: p.date_gmt || p.date || '',
    creator: (p._embedded && p._embedded.author && p._embedded.author[0] &&
      p._embedded.author[0].name) || ''
  }));
  return { title: 'WordPress · ' + hostDe(url), items };
}

// ---------- parseo ----------------------------------------------------------
async function parsearXml(texto, url) {
  const limpio = limpiarXml(texto);
  let primerError = null;

  try {
    return await estricto.parseString(limpio);
  } catch (e) { primerError = e; }

  try {
    return await laxo.parseString(limpio);
  } catch (e) { if (!primerError) primerError = e; }

  try {
    const recortado = limpiarXml(recortarRaiz(texto));
    if (recortado !== limpio) return await laxo.parseString(recortado);
  } catch {}

  const rescatado = rescatarItems(texto, url);
  if (rescatado) return rescatado;

  throw new ErrorFeed('xml',
    'El XML del feed está roto' + (primerError ? ' (' + String(primerError.message).split('\n')[0].slice(0, 90) + ')' : '') +
    ' y no se pudieron rescatar noticias.', { url });
}

/** Interpreta la respuesta ya descargada como feed, o devuelve null. */
async function comoFeed(res) {
  if (res.estado === 401 || res.estado === 403) {
    throw new ErrorFeed('bloqueado',
      'El sitio ' + hostDe(res.urlFinal) + ' bloquea las lecturas automáticas (HTTP ' + res.estado + ').',
      { url: res.urlFinal, estado: res.estado });
  }
  if (res.estado === 404 || res.estado === 410) {
    throw new ErrorFeed('404', 'La dirección no existe en ' + hostDe(res.urlFinal) + ' (HTTP ' + res.estado + ').',
      { url: res.urlFinal, estado: res.estado });
  }
  if (res.estado >= 400) {
    throw new ErrorFeed('http', hostDe(res.urlFinal) + ' respondió HTTP ' + res.estado + '.',
      { url: res.urlFinal, estado: res.estado });
  }

  if (/json/i.test(res.tipo) || /^\s*[[{]/.test(res.texto)) {
    const feed = feedDeWpJson(res.texto, res.urlFinal);
    if (feed) return feed;
    return null;
  }
  if (!res.esXml) return null;

  const feed = await parsearXml(res.texto, res.urlFinal);
  if (!feed) return null;
  if (!Array.isArray(feed.items)) feed.items = [];
  return feed;
}

// ---------- descubrimiento del feed dentro de una página --------------------
/**
 * Devuelve las direcciones de feed que anuncia una página.
 * `declarados`: los del <link rel="alternate"> (los que el sitio declara como
 *              su feed oficial — máxima prioridad).
 * `otros`:      enlaces del tipo "RSS / Suscribirse" y FeedBurner.
 */
function enlacesDescubiertos(html, base) {
  const declarados = [];
  const otros = [];
  const vistos = new Set();
  const push = (lista, bruto) => {
    if (!bruto) return;
    const url = absoluta(String(bruto).replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim(), base);
    if (!/^https?:\/\//i.test(url)) return;
    if (vistos.has(url)) return;
    vistos.add(url);
    lista.push(url);
  };

  // <link rel="alternate" type="application/rss+xml" href="...">
  const reLink = /<link\b[^>]*>/gi;
  let m;
  while ((m = reLink.exec(html))) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?[^"'>]*alternate/i.test(tag)) continue;
    const tipo = (tag.match(/type\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (!/(rss|atom|rdf|xml|json)/i.test(tipo)) continue;
    push(declarados, (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1]);
  }

  // <a href="...">RSS</a> / "Suscribirse" / "Feed"
  const reA = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,160}?)<\/a\s*>/gi;
  while ((m = reA.exec(html))) {
    const href = m[1];
    const txt = m[2].replace(/<[^>]+>/g, ' ');
    if (/(rss|atom|feed|\.xml)(\b|\/|\?|=)/i.test(href) || /\b(rss|atom|feed|suscrib|sindic)/i.test(txt)) push(otros, href);
  }

  // feedburner / feedpress declarados en cualquier parte
  const reFeed = /https?:\/\/(?:feeds\.feedburner\.com|feedpress\.me|feeds\.feedblitz\.com)\/[^"'\s<>]+/gi;
  while ((m = reFeed.exec(html))) push(otros, m[0]);

  return { declarados: declarados.slice(0, 5), otros: otros.slice(0, 6) };
}

function candidatosComunes(base) {
  const salida = [];
  const vistos = new Set();
  const push = (u) => {
    try {
      const url = new URL(u, base).href;
      if (!/^https?:\/\//i.test(url) || vistos.has(url)) return;
      vistos.add(url);
      salida.push(url);
    } catch {}
  };
  let u;
  try { u = new URL(base); } catch { return salida; }

  const rutas = [
    '/feed', '/feed/', '/rss', '/rss/', '/rss.xml', '/feed.xml', '/atom.xml',
    '/index.xml', '/feeds/posts/default', '/?feed=rss2', '/feed/?post_type=post',
    '/blog/feed', '/blog/feed/', '/blog/rss.xml', '/news/feed', '/noticias/feed'
  ];
  for (const r of rutas) push(r);
  push('/wp-json/wp/v2/posts?per_page=15');

  // Joomla: /index.php?format=feed&type=rss
  if (/\/index\.php$/i.test(u.pathname)) {
    push(u.pathname + '?format=feed&type=rss');
    push(u.pathname + '?format=feed&type=atom');
  }
  // WordPress con enlaces permanentes: /entrada/feed/
  if (u.pathname && u.pathname !== '/' && !/\.(xml|rss|php)$/i.test(u.pathname)) {
    push(u.pathname.replace(/\/?$/, '/') + 'feed/');
  }
  return salida;
}

/** Prueba una lista de URLs y devuelve el primer feed válido. */
async function primeroQueSirva(urls, opciones) {
  const probados = [];
  let listo = false;
  let indice = 0;

  const obreros = Array.from({ length: Math.min(CONCURRENCIA, urls.length) }, async () => {
    while (!listo && indice < urls.length) {
      const url = urls[indice++];
      try {
        const res = await bajar(url, opciones);
        const feed = await comoFeed(res);
        if (!feed) { probados.push({ url, motivo: 'no es un feed' }); continue; }
        if (!listo) { listo = true; return { feed, url: res.urlFinal }; }
      } catch (e) {
        probados.push({ url, motivo: e.message });
      }
    }
    return null;
  });

  const resultados = await Promise.all(obreros);
  const ganador = resultados.find(Boolean);
  return { ganador, probados };
}

// ---------- API pública -----------------------------------------------------
/**
 * Abre una dirección y devuelve SIEMPRE un feed utilizable.
 * @param {string} entrada  URL de un feed o de la portada del sitio
 * @returns {Promise<{feed:object, url:string, original:string, corregida:boolean, metodo:string}>}
 */
async function abrirFeed(entrada, opciones = {}) {
  const original = normalizarUrl(entrada);
  if (!original) throw new ErrorFeed('url', 'La dirección no es válida. Tiene que empezar con http:// o https://');

  // 1) ¿Ya es un feed? (el caso normal, y el más rápido)
  let primera = null;
  let errorPrimero = null;
  try {
    primera = await bajar(original, opciones);
  } catch (e) {
    errorPrimero = e;
  }

  if (primera) {
    let feed = null;
    try {
      feed = await comoFeed(primera);
    } catch (e) {
      // 404/403: seguimos intentando descubrir, no abortamos todavía
      errorPrimero = e;
    }
    if (feed) {
      return {
        feed: completar(feed, primera.urlFinal),
        url: primera.urlFinal,
        original,
        corregida: primera.urlFinal !== original,
        metodo: 'directo'
      };
    }
  }

  // 2) Es una página web (o dio error): buscamos el feed del sitio.
  //    Primero los enlaces que el propio sitio declara (los más fiables) y,
  //    solo si no hay, las rutas típicas.
  const base = (primera && primera.urlFinal) || original;
  const html = primera && primera.esHtml ? primera.texto : '';
  const { declarados, otros } = enlacesDescubiertos(html, base);
  const comunes = candidatosComunes(base);
  const opcionesProbado = Object.assign({ timeout: 8000 }, opciones);

  let ganador = null;
  let metodo = '';
  const fases = [
    { lista: declarados, metodo: 'descubierto' },
    { lista: otros, metodo: 'descubierto' }
  ];
  for (const fase of fases) {
    if (ganador || !fase.lista.length) continue;
    const r = await primeroQueSirva(fase.lista, opcionesProbado);
    if (r.ganador) { ganador = r.ganador; metodo = fase.metodo; }
  }
  if (!ganador) {
    const intentos = [];
    const vistos = new Set([original].concat(declarados, otros));
    // Si ni siquiera pudimos bajar la página, arrancamos por la portada.
    if (!primera) {
      try { intentos.push(new URL('/', base).href); } catch {}
    }
    for (const u of comunes) {
      if (vistos.has(u)) continue;
      vistos.add(u);
      intentos.push(u);
    }
    const r = await primeroQueSirva(intentos.slice(0, 14), opcionesProbado);
    if (r.ganador) { ganador = r.ganador; metodo = 'adivinado'; }
  }

  if (ganador) {
    return {
      feed: completar(ganador.feed, ganador.url),
      url: ganador.url,
      original,
      corregida: true,
      metodo
    };
  }

  // 3) Nada sirvió: explicamos qué pasó, sin mensajes crípticos
  if (errorPrimero && errorPrimero.codigo && errorPrimero.codigo !== '404') {
    throw errorPrimero;
  }
  if (primera && primera.esHtml) {
    throw new ErrorFeed('no-es-feed',
      'Esa dirección es una página web, no un feed RSS. La busqué en el sitio ' + hostDe(base) +
      ' (enlaces RSS y rutas típicas como /feed) y no la encontré. ' +
      'Abrí el sitio y pegá el enlace del feed; suele estar en un icono naranja RSS o en /feed.',
      { url: original, probados: declarados.concat(otros, comunes) });
  }
  throw new ErrorFeed('desconocido',
    'No se pudo leer un feed en ' + hostDe(original) + '. Probé ' + (declarados.length + otros.length + comunes.length) +
    ' direcciones y ninguna sirvió.',
    { url: original, probados: declarados.concat(otros, comunes) });
}

/** Normaliza el feed: enlaces absolutos, sin items vacíos, fechas usables. */
function completar(feed, urlBase) {
  feed.title = decodificarEntidades(feed.title) || hostDe(urlBase);
  const items = Array.isArray(feed.items) ? feed.items : [];
  feed.items = items
    .filter((it) => it && (it.link || it.title))
    .map((it) => {
      const copia = Object.assign({}, it);
      copia.title = decodificarEntidades(copia.title) || '(sin título)';
      copia.link = absoluta(copia.link, urlBase);
      if (!copia.isoDate) {
        const fecha = copia.pubDate || copia['dc:date'] || copia.published || copia.updated;
        if (fecha) copia.isoDate = fecha;
      }
      return copia;
    });
  feed.link = absoluta(feed.link, urlBase) || urlBase;
  return feed;
}

module.exports = {
  abrirFeed,
  bajar,
  parsearXml,
  limpiarXml,
  decodificarEntidades,
  enlacesDescubiertos,
  candidatosComunes,
  normalizarUrl,
  ErrorFeed,
  parser: estricto
};
