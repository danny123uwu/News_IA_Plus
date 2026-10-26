'use strict';
// ============================================================================
//  Microservicio de feeds / artículos
//
//  Mejoras de esta versión:
//   · consultas que NO traen contenido_html (hasta 20 KB por fila) en las listas
//   · índices SQLite + WAL para responder más rápido con muchas noticias
//   · refresco de fuentes con concurrencia limitada y sin solaparse
//   · clasificación y traducción por lotes en colas (no una petición por noticia)
//   · estadísticas cacheadas y parseo tolerante de etiquetas
//   · todas las URLs externas pasan por la protección SSRF de rss.js
// ============================================================================

const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { abrirFeed, normalizarUrl } = require('./rss');
const { resolverSecreto, entero } = require('../shared/env');
const {
  cabecerasSeguridad, corsPortal, crearLimitador, recortar, numero, jsonSeguro, listaSegura
} = require('../shared/http');
const { mapLimit } = require('../shared/async');
const { TAXONOMIA, clasificarPorReglas } = require('../shared/taxonomia');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cabecerasSeguridad);
app.use(corsPortal());
app.use(express.json({ limit: '1mb' }));

const SECRET = resolverSecreto();
const AGENT = process.env.AGENT_URL || 'http://localhost:3003';
const DATA = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });

const db = new DatabaseSync(path.join(DATA, 'feeds.db'));
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA synchronous=NORMAL');
db.exec('PRAGMA busy_timeout=5000');
db.exec('PRAGMA temp_store=MEMORY');
db.exec('PRAGMA cache_size=-16000'); // ~16 MB de caché

db.exec(`CREATE TABLE IF NOT EXISTS sources(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  url TEXT NOT NULL,
  activo INTEGER DEFAULT 1,
  prioridad INTEGER DEFAULT 3,
  ultimo_error TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS articles(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  titulo TEXT,
  link TEXT,
  contenido TEXT,
  autor TEXT,
  fecha TEXT,
  etiquetas TEXT DEFAULT '[]',
  leido INTEGER DEFAULT 0,
  favorito INTEGER DEFAULT 0,
  archivado INTEGER DEFAULT 0,
  saltado INTEGER DEFAULT 0,
  UNIQUE(source_id, link)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS clips(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  article_id INTEGER,
  titulo TEXT,
  texto TEXT,
  nota TEXT,
  medio TEXT,
  link TEXT,
  fecha TEXT DEFAULT (datetime('now'))
)`);

// Índices para las consultas más usadas (lista, feed, panel y recortes).
db.exec('CREATE INDEX IF NOT EXISTS idx_articles_user_fecha ON articles(user_id, fecha DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_articles_user_estado ON articles(user_id, archivado, saltado, leido)');
db.exec('CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_sources_user ON sources(user_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_clips_user_fecha ON clips(user_id, fecha DESC)');

function columnas(tabla) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
}
const COLS_ART = ['imagen', 'video', 'titulo_es', 'resumen_es', 'idioma', 'contenido_html'];
for (const c of COLS_ART) {
  if (!columnas('articles').includes(c)) db.exec(`ALTER TABLE articles ADD COLUMN ${c} TEXT`);
}

// Migración 2: el cuerpo de la noticia ya NO se baja de la página original.
if (((db.prepare('PRAGMA user_version').get() || {}).user_version || 0) < 2) {
  db.exec('UPDATE articles SET contenido_html=NULL');
  db.exec('PRAGMA user_version=2');
  console.log('[feeds] contenido_html reiniciado: desde ahora solo se usa el del RSS');
}

// Columnas que sí necesita una tarjeta/lista. Evitamos contenido_html (pesado).
const CAMPOS_LISTA = `a.id,a.user_id,a.source_id,a.titulo,a.link,a.contenido,a.autor,a.fecha,
  a.etiquetas,a.leido,a.favorito,a.archivado,a.saltado,a.imagen,a.video,
  a.titulo_es,a.resumen_es,a.idioma`;

function htmlATexto(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&#8217;|&rsquo;/g, '’').replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function imagenDe(it, html) {
  const cand = [];
  if (Array.isArray(it.media)) {
    for (const m of it.media) {
      const u = (m && m.$ && m.$.url) || (typeof m === 'string' ? m : null);
      if (u) cand.push(u);
      if (m && Array.isArray(m['media:thumbnail'])) for (const t of m['media:thumbnail']) if (t && t.$ && t.$.url) cand.push(t.$.url);
    }
  }
  if (Array.isArray(it.thumb)) for (const t of it.thumb) cand.push(typeof t === 'string' ? t : (t && t.$ && t.$.url));
  else if (it.thumb) cand.push(typeof it.thumb === 'string' ? it.thumb : (it.thumb.$ && it.thumb.$.url));
  if (it.enclosure && it.enclosure.url && /^https?:/i.test(it.enclosure.url)) cand.push(it.enclosure.url);
  const enHtml = String(html || '').match(/<img[^>]+src=["']([^"']+)["']/i);
  if (enHtml) cand.push(enHtml[1]);
  return cand.find((u) => u && /^https?:\/\//i.test(u) && !/\.(gif|svg)(\?|$)/i.test(u)) || null;
}

function videoDe(it, html) {
  const texto = String(html || '') + ' ' + (it.link || '');
  const yt = texto.match(/youtube\.com\/embed\/([\w-]{6,})/) || texto.match(/youtu\.be\/([\w-]{6,})/);
  if (yt) return 'https://www.youtube.com/embed/' + yt[1];
  const vm = texto.match(/player\.vimeo\.com\/video\/(\d+)/);
  if (vm) return 'https://player.vimeo.com/video/' + vm[1];
  return null;
}

function fechaISO(valor) {
  if (!valor) return new Date().toISOString();
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').split(' ')[1];
    req.user = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

const idValido = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const like = (texto) => '%' + String(texto).replace(/[\\%_]/g, (c) => '\\' + c) + '%';

// ---------------------- limitadores de peticiones --------------------------
const porUsuario = (req) => 'u' + (req.user ? req.user.id : (req.ip || 'anon'));
const limiteGeneral = crearLimitador({
  ventanaMs: 60000, maximo: entero('RATE_FEEDS_MIN', 180, { min: 20, max: 3000 }), clave: porUsuario
});
const limiteImportar = crearLimitador({
  ventanaMs: 600000, maximo: 20, clave: porUsuario,
  mensaje: 'Demasiadas fuentes agregadas seguidas. Esperá unos minutos.'
});
const limiteRefresco = crearLimitador({
  ventanaMs: 300000, maximo: 8, clave: porUsuario,
  mensaje: 'Estás actualizando muy seguido. Esperá unos minutos.'
});

// ---------------- clasificación por lotes (una cola global) ----------------
const colaClasificar = new Map();
let clasificando = false;
let temporizadorClasificar = null;
let tokenServicioCache = { token: '', hasta: 0 };

function tokenServicio() {
  const ahora = Date.now();
  if (tokenServicioCache.token && tokenServicioCache.hasta > ahora) return tokenServicioCache.token;
  const token = jwt.sign({ id: 0, email: 'feeds@interno', rol: 'servicio' }, SECRET, { expiresIn: '12h', algorithm: 'HS256' });
  tokenServicioCache = { token, hasta: ahora + 11 * 3600 * 1000 };
  return token;
}

function encolarClasificacion(items, userId) {
  for (const item of items) colaClasificar.set(Number(item.id), { item, userId });
  if (clasificando || temporizadorClasificar) return;
  temporizadorClasificar = setTimeout(() => {
    temporizadorClasificar = null;
    procesarClasificacion().catch((e) => console.error('[feeds] clasificación:', e.message));
  }, 250);
  if (temporizadorClasificar.unref) temporizadorClasificar.unref();
}

async function reclasificarConIA(items, userId) {
  if (!items.length) return;
  const r = await fetch(AGENT + '/classify-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenServicio() },
    body: JSON.stringify({ items, userId }),
    signal: AbortSignal.timeout(90000)
  });
  if (!r.ok) return;
  const d = await r.json();
  const actualizar = db.prepare('UPDATE articles SET etiquetas=? WHERE id=?');
  for (const res of (d.resultados || [])) {
    if (res && Array.isArray(res.etiquetas) && res.etiquetas.length) {
      actualizar.run(JSON.stringify(res.etiquetas), res.id);
    }
  }
}

async function procesarClasificacion() {
  if (clasificando) return;
  clasificando = true;
  try {
    while (colaClasificar.size) {
      const primero = colaClasificar.values().next().value;
      const userId = primero.userId;
      const lote = [];
      for (const [id, x] of colaClasificar) {
        if (x.userId !== userId) continue;
        lote.push(x.item);
        colaClasificar.delete(id);
        if (lote.length >= 25) break;
      }
      try { await reclasificarConIA(lote, userId); } catch {}
      await new Promise((r) => setTimeout(r, 80));
    }
  } finally {
    clasificando = false;
    if (colaClasificar.size && !temporizadorClasificar) encolarClasificacion([], 0);
  }
}

// ------------------------- cola de traducción ------------------------------
const colaES = new Map();
let traduciendo = false;

function encolarTraduccion(ids, userId) {
  for (const id of ids) {
    if (!colaES.has(Number(id))) colaES.set(Number(id), { userId: userId ?? null, intentos: 0 });
  }
  if (!traduciendo) procesarColaES().catch((e) => console.error('[feeds] traducción:', e.message));
}

async function traducirArticulo(id, entrada) {
  const a = db.prepare('SELECT id, user_id, titulo, contenido, titulo_es FROM articles WHERE id=?').get(id);
  if (!a || a.titulo_es) return;
  const r = await fetch(AGENT + '/spanish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenServicio() },
    body: JSON.stringify({
      titulo: a.titulo,
      texto: String(a.contenido || '').slice(0, 900),
      userId: entrada.userId ?? a.user_id
    }),
    signal: AbortSignal.timeout(45000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  if (d && (d.titulo || d.resumen)) {
    db.prepare('UPDATE articles SET titulo_es=?, resumen_es=?, idioma=? WHERE id=?')
      .run(d.titulo || a.titulo, d.resumen || '', d.idioma || 'es', id);
  }
}

async function procesarColaES() {
  if (traduciendo) return;
  traduciendo = true;
  try {
    while (colaES.size) {
      const lote = [];
      for (const [id, x] of colaES) {
        lote.push([id, x]);
        colaES.delete(id);
        if (lote.length >= 6) break;
      }
      await mapLimit(lote, 3, async ([id, entrada]) => {
        try {
          await traducirArticulo(id, entrada);
        } catch {
          entrada.intentos++;
          if (entrada.intentos < 2) colaES.set(id, entrada);
          await new Promise((r) => setTimeout(r, 1200));
        }
      });
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    traduciendo = false;
  }
}

function encolarPendientes(limite = 200) {
  try {
    const filas = db.prepare('SELECT id, user_id FROM articles WHERE titulo_es IS NULL ORDER BY fecha DESC LIMIT ?').all(limite);
    if (filas.length) {
      for (const f of filas) {
        if (!colaES.has(f.id)) colaES.set(f.id, { userId: f.user_id, intentos: 0 });
      }
      if (!traduciendo) procesarColaES().catch(() => {});
    }
  } catch {}
}

// --------------------------- importación -----------------------------------
async function importarFuente(src, feedYaParseado) {
  let feed = feedYaParseado;
  if (!feed) {
    try {
      const r = await abrirFeed(src.url);
      feed = r.feed;
      if (r.corregida && r.url && r.url !== src.url) {
        db.prepare('UPDATE sources SET url=? WHERE id=?').run(r.url, src.id);
        console.log('[feeds] fuente "' + src.nombre + '" corregida -> ' + r.url);
      }
    } catch (e) {
      db.prepare('UPDATE sources SET ultimo_error=? WHERE id=?').run('No se pudo leer el feed: ' + e.message, src.id);
      return 0;
    }
  }

  db.prepare('UPDATE sources SET ultimo_error=NULL WHERE id=?').run(src.id);
  let nuevos = 0;
  const pendientes = [];
  const porTraducir = [];
  const existeStmt = db.prepare('SELECT id, imagen, video, contenido, contenido_html FROM articles WHERE source_id=? AND link=?');
  const insertar = db.prepare(`INSERT OR IGNORE INTO articles(user_id,source_id,titulo,link,contenido,contenido_html,autor,fecha,etiquetas,imagen,video)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)`);

  for (const it of (feed.items || []).slice(0, 30)) {
    if (!it.link) continue;
    const bruto = it['content:encoded'] || it.content || it.contentSnippet || it.summary || '';
    const contenido = htmlATexto(bruto).slice(0, 4000);
    const contenidoHtml = bruto && /<[a-z][\s\S]*>/i.test(String(bruto)) ? String(bruto).slice(0, 20000) : null;
    const imagen = imagenDe(it, bruto);
    const video = videoDe(it, bruto);

    const existe = existeStmt.get(src.id, it.link);
    if (existe) {
      const cambios = [];
      const args = [];
      if (!existe.imagen && imagen) { cambios.push('imagen=?'); args.push(imagen); }
      if (!existe.video && video) { cambios.push('video=?'); args.push(video); }
      if (!existe.contenido_html || (contenidoHtml && contenidoHtml !== existe.contenido_html)) {
        if (contenidoHtml) { cambios.push('contenido_html=?'); args.push(contenidoHtml); }
      }
      if (contenido.length > String(existe.contenido || '').length) { cambios.push('contenido=?'); args.push(contenido); }
      if (cambios.length) db.prepare(`UPDATE articles SET ${cambios.join(',')} WHERE id=?`).run(...args, existe.id);
      continue;
    }

    const etiquetas = clasificarPorReglas(it.title, contenido);
    const r = insertar.run(
      src.user_id, src.id, it.title || '(sin título)', it.link, contenido, contenidoHtml,
      it.creator || it.author || it['dc:creator'] || feed.title || src.nombre,
      fechaISO(it.isoDate || it.pubDate || it['dc:date']),
      JSON.stringify(etiquetas), imagen, video
    );
    if (r.changes) {
      nuevos++;
      pendientes.push({ id: Number(r.lastInsertRowid), titulo: it.title || '', texto: contenido.slice(0, 300) });
      porTraducir.push(Number(r.lastInsertRowid));
    }
  }

  if (pendientes.length) encolarClasificacion(pendientes, src.user_id);
  if (porTraducir.length) encolarTraduccion(porTraducir, src.user_id);
  return nuevos;
}

const REFRESCO_CONCURRENCIA = entero('FEEDS_CONCURRENCIA', 3, { min: 1, max: 8 });
let refrescandoTodo = false;

async function refrescarTodo() {
  if (refrescandoTodo) return 0;
  refrescandoTodo = true;
  try {
    const fuentes = db.prepare('SELECT * FROM sources WHERE activo=1').all();
    const resultados = await mapLimit(fuentes, REFRESCO_CONCURRENCIA, (f) =>
      importarFuente(f).catch((e) => {
        console.error('[feeds] ' + f.nombre + ':', e.message);
        return 0;
      })
    );
    return resultados.reduce((n, x) => n + x, 0);
  } finally {
    refrescandoTodo = false;
  }
}

const refrescosUsuario = new Map();
async function refrescarUsuario(userId) {
  const previo = refrescosUsuario.get(userId);
  if (previo) return previo;
  const tarea = (async () => {
    const fuentes = db.prepare('SELECT * FROM sources WHERE user_id=? AND activo=1').all(userId);
    const resultados = await mapLimit(fuentes, REFRESCO_CONCURRENCIA, (f) => importarFuente(f).catch(() => 0));
    return { nuevos: resultados.reduce((n, x) => n + x, 0), fuentes: fuentes.length };
  })().finally(() => refrescosUsuario.delete(userId));
  refrescosUsuario.set(userId, tarea);
  return tarea;
}

// ------------------------------- rutas -------------------------------------
app.get('/health', (req, res) => res.json({ ok: true, servicio: 'feeds' }));
app.get('/taxonomy', auth, (req, res) => res.json({ etiquetas: TAXONOMIA }));

app.post('/feeds/test', auth, limiteImportar, async (req, res) => {
  try {
    const url = recortar(req.body && req.body.url, 500);
    if (!url) return res.json({ ok: false, error: 'Falta la dirección del portal' });
    const r = await abrirFeed(url);
    res.json({
      ok: true,
      titulo: r.feed.title || 'Feed válido',
      cantidad: (r.feed.items || []).length,
      url: r.url,
      corregida: r.corregida,
      metodo: r.metodo
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/feeds', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM sources WHERE user_id=? ORDER BY prioridad DESC, id').all(req.user.id);
  res.json({ fuentes: rows });
});

app.post('/feeds', auth, limiteImportar, async (req, res) => {
  const pedida = recortar(req.body && req.body.url, 500).trim();
  const nombre = recortar(req.body && req.body.nombre, 100).trim() || pedida;
  if (!pedida) return res.status(400).json({ error: 'Falta la dirección del portal' });
  if (!/^https?:\/\//.test(pedida) && !/^[\w.-]+\.[a-z]{2,}/i.test(pedida)) {
    return res.status(400).json({ error: 'La URL debe empezar con http(s)://' });
  }

  let r;
  try {
    r = await abrirFeed(pedida);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const url = r.url || normalizarUrl(pedida);
  if (!url) return res.status(400).json({ error: 'La dirección no es válida' });
  const repetida = db.prepare('SELECT id, nombre FROM sources WHERE user_id=? AND url=?').get(req.user.id, url);
  if (repetida) {
    return res.status(409).json({ error: 'Ese portal ya está en tus fuentes: "' + repetida.nombre + '"' });
  }

  const rr = db.prepare('INSERT INTO sources(user_id,nombre,url) VALUES(?,?,?)').run(req.user.id, nombre, url);
  const src = db.prepare('SELECT * FROM sources WHERE id=?').get(rr.lastInsertRowid);
  try {
    await importarFuente(src, r.feed);
  } catch (e) {
    db.prepare('UPDATE sources SET ultimo_error=? WHERE id=?').run('Error al importar: ' + e.message, src.id);
  }
  res.json({
    ok: true,
    id: rr.lastInsertRowid,
    titulo: r.feed.title || nombre,
    url,
    corregida: !!r.corregida,
    metodo: r.metodo,
    noticias: (r.feed.items || []).length
  });
});

app.put('/feeds/:id', auth, (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'Fuente inválida' });
  const src = db.prepare('SELECT * FROM sources WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!src) return res.status(404).json({ error: 'Fuente no encontrada' });
  const b = req.body || {};
  db.prepare('UPDATE sources SET nombre=?, activo=?, prioridad=? WHERE id=?').run(
    b.nombre !== undefined ? (recortar(b.nombre, 100).trim() || src.nombre) : src.nombre,
    b.activo !== undefined ? (b.activo ? 1 : 0) : src.activo,
    b.prioridad !== undefined ? Math.round(numero(b.prioridad, src.prioridad, 1, 5)) : src.prioridad,
    src.id
  );
  res.json({ ok: true });
});

app.delete('/feeds/:id', auth, (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'Fuente inválida' });
  const src = db.prepare('SELECT * FROM sources WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!src) return res.status(404).json({ error: 'Fuente no encontrada' });
  db.prepare('DELETE FROM articles WHERE source_id=?').run(src.id);
  db.prepare('DELETE FROM sources WHERE id=?').run(src.id);
  res.json({ ok: true });
});

app.post('/feeds/refresh', auth, limiteRefresco, async (req, res) => {
  try {
    const r = await refrescarUsuario(req.user.id);
    res.json({ ok: true, nuevos: r.nuevos, fuentes: r.fuentes });
  } catch (e) {
    res.status(500).json({ error: 'No se pudieron actualizar las fuentes: ' + e.message });
  }
});

app.get('/articles', auth, limiteGeneral, (req, res) => {
  const { estado, fuente, tag, q, archivado } = req.query;
  let sql = `SELECT ${CAMPOS_LISTA}, s.nombre AS fuente, s.prioridad FROM articles a
             JOIN sources s ON s.id=a.source_id WHERE a.user_id=?`;
  const args = [req.user.id];
  if (archivado === '1') sql += ' AND a.archivado=1';
  else sql += ' AND a.archivado=0';
  if (estado === 'no_leido') sql += ' AND a.leido=0';
  if (estado === 'favorito') sql += ' AND a.favorito=1';
  const fuenteId = idValido(fuente);
  if (fuenteId) { sql += ' AND a.source_id=?'; args.push(fuenteId); }
  if (tag) { sql += " AND a.etiquetas LIKE ? ESCAPE '\\'"; args.push(like(recortar(tag, 60))); }
  if (q) {
    const buscado = like(recortar(q, 120));
    sql += " AND (a.titulo LIKE ? ESCAPE '\\' OR a.contenido LIKE ? ESCAPE '\\')";
    args.push(buscado, buscado);
  }
  const limite = Math.round(numero(req.query.limit, 100, 1, 200));
  const offset = Math.round(numero(req.query.offset, 0, 0, 10000));
  sql += ' ORDER BY a.fecha DESC LIMIT ? OFFSET ?';
  args.push(limite, offset);

  const rows = db.prepare(sql).all(...args).map((r) => {
    r.etiquetas = listaSegura(r.etiquetas);
    return r;
  });
  res.json({ articulos: rows });
});

app.get('/articles/:id', auth, async (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'Artículo inválido' });
  const a = db.prepare(`SELECT a.*, s.nombre AS fuente, s.prioridad FROM articles a
    JOIN sources s ON s.id=a.source_id WHERE a.id=? AND a.user_id=?`).get(id, req.user.id);
  if (!a) return res.status(404).json({ error: 'Artículo no encontrado' });
  a.etiquetas = listaSegura(a.etiquetas);
  res.json({ articulo: a });
});

app.get('/feed', auth, limiteGeneral, (req, res) => {
  const horas = Math.round(numero(req.query.horas, 168, 1, 8760));
  const intereses = String(req.query.intereses || '')
    .split(',').map((s) => s.trim().slice(0, 60)).filter(Boolean).slice(0, 30);
  const q = recortar(req.query.q, 120).trim().toLowerCase();
  const ahora = Date.now();
  const limite = ahora - horas * 3600 * 1000;
  const limite24 = ahora - 24 * 3600 * 1000;

  let rows = db.prepare(`SELECT ${CAMPOS_LISTA}, s.nombre AS fuente, s.prioridad FROM articles a
    JOIN sources s ON s.id=a.source_id
    WHERE a.user_id=? AND a.saltado=0 AND a.archivado=0
    ORDER BY a.fecha DESC LIMIT 400`).all(req.user.id);
  if (q) rows = rows.filter((r) => ((r.titulo || '') + ' ' + (r.contenido || '')).toLowerCase().includes(q));

  const dentro = [];
  const fuera = [];
  let conInteres = 0;

  for (const r of rows) {
    const ts = Date.parse(r.fecha) || 0;
    const etiquetas = listaSegura(r.etiquetas);
    const coincide = intereses.length > 0 && intereses.some((t) => etiquetas.includes(t));
    const reciente = ts >= limite24;
    const pref = r.prioridad >= 4;
    const n = reciente ? (pref ? 1 : coincide ? 2 : 3) : (pref ? 4 : coincide ? 5 : 6);
    const item = { r, n, ts };
    if (ts >= limite) {
      dentro.push(item);
      if (coincide) conInteres++;
    } else {
      fuera.push(item);
    }
  }

  const orden = (a, b) => a.n - b.n || b.r.prioridad - a.r.prioridad || b.ts - a.ts;
  dentro.sort(orden);
  fuera.sort(orden);

  const total = dentro.length;
  let lista = dentro;
  let relleno = false;
  if (lista.length < 12 && fuera.length) {
    lista = lista.concat(fuera);
    relleno = true;
  }
  res.json({
    articulos: lista.slice(0, 60).map((x) => {
      x.r.etiquetas = listaSegura(x.r.etiquetas);
      return x.r;
    }),
    total,
    conInteres,
    sinIntereses: total - conInteres,
    relleno,
    rango: horas,
    intereses: intereses.length
  });
});

const flag = (v, actual) => (v === undefined ? actual : (v === true || v === 1 || v === '1' ? 1 : 0));

app.patch('/articles/:id', auth, (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'Artículo inválido' });
  const a = db.prepare('SELECT * FROM articles WHERE id=? AND user_id=?').get(id, req.user.id);
  if (!a) return res.status(404).json({ error: 'Artículo no encontrado' });
  const b = req.body || {};
  db.prepare('UPDATE articles SET leido=?, favorito=?, archivado=?, saltado=? WHERE id=?').run(
    flag(b.leido, a.leido),
    flag(b.favorito, a.favorito),
    flag(b.archivado, a.archivado),
    flag(b.saltado, a.saltado),
    a.id
  );
  cacheStats.delete(req.user.id);
  res.json({ ok: true });
});

app.post('/articles/:id/clip', auth, (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'Artículo inválido' });
  const a = db.prepare(`SELECT ar.*, s.nombre AS fuente FROM articles ar
    JOIN sources s ON s.id=ar.source_id WHERE ar.id=? AND ar.user_id=?`).get(id, req.user.id);
  if (!a) return res.status(404).json({ error: 'Artículo no encontrado' });
  const b = req.body || {};
  const texto = recortar(b.texto, 4000).trim();
  if (!texto) return res.status(400).json({ error: 'Falta el fragmento de texto' });
  db.prepare('INSERT INTO clips(user_id,article_id,titulo,texto,nota,medio,link) VALUES(?,?,?,?,?,?,?)')
    .run(req.user.id, a.id, a.titulo || null, texto, recortar(b.nota, 1000), a.fuente || null, a.link || null);
  cacheStats.delete(req.user.id);
  res.json({ ok: true });
});

app.get('/clips', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM clips WHERE user_id=? ORDER BY fecha DESC LIMIT 500').all(req.user.id);
  res.json({ recortes: rows });
});

app.delete('/clips/:id', auth, (req, res) => {
  const id = idValido(req.params.id);
  if (!id) return res.status(400).json({ error: 'Recorte inválido' });
  db.prepare('DELETE FROM clips WHERE id=? AND user_id=?').run(id, req.user.id);
  cacheStats.delete(req.user.id);
  res.json({ ok: true });
});

// El panel se consulta al abrir la pestaña; 20 s de caché evitan recalcular
// las 4.000 etiquetas cada vez.
const cacheStats = new Map();
const STATS_TTL_MS = 20000;

app.get('/stats', auth, limiteGeneral, (req, res) => {
  const u = req.user.id;
  const hit = cacheStats.get(u);
  if (hit && hit.exp > Date.now()) return res.json(hit.datos);

  const total = db.prepare('SELECT COUNT(*) n FROM articles WHERE user_id=?').get(u).n;
  const leidos = db.prepare('SELECT COUNT(*) n FROM articles WHERE user_id=? AND leido=1').get(u).n;
  const favoritos = db.prepare('SELECT COUNT(*) n FROM articles WHERE user_id=? AND favorito=1').get(u).n;
  const archivados = db.prepare('SELECT COUNT(*) n FROM articles WHERE user_id=? AND archivado=1').get(u).n;
  const recortes = db.prepare('SELECT COUNT(*) n FROM clips WHERE user_id=?').get(u).n;
  const porFuente = db.prepare(`SELECT s.nombre, COUNT(*) n FROM articles a JOIN sources s ON s.id=a.source_id
    WHERE a.user_id=? AND a.leido=1 GROUP BY s.nombre ORDER BY n DESC LIMIT 8`).all(u);
  const porEtiqueta = db.prepare('SELECT etiquetas FROM articles WHERE user_id=?').all(u)
    .flatMap((r) => listaSegura(r.etiquetas))
    .reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
  const topEtiquetas = Object.entries(porEtiqueta).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([nombre, n]) => ({ nombre, n }));

  const datos = { total, leidos, favoritos, archivados, recortes, porFuente, topEtiquetas };
  cacheStats.set(u, { datos, exp: Date.now() + STATS_TTL_MS });
  if (cacheStats.size > 500) cacheStats.delete(cacheStats.keys().next().value);
  res.json(datos);
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'La petición es demasiado grande' });
  }
  if (err && (err instanceof SyntaxError || err.status === 400)) {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  console.error('[feeds] error:', err && err.message);
  res.status(500).json({ error: 'Error interno' });
});

// Refresco inicial en segundo plano (no retrasa el healthcheck) y cada 15 min.
setTimeout(() => {
  refrescarTodo()
    .then((n) => { if (n) console.log('[feeds] refresco inicial: ' + n + ' noticias nuevas'); })
    .catch((e) => console.error('[feeds] error al importar fuentes iniciales:', e.message));
}, 3000);

setInterval(() => {
  refrescarTodo().catch((e) => console.error('[feeds] error en refresco automático:', e.message));
}, 15 * 60 * 1000);

// Traducción de pendientes: primero un lote y luego cada 5 minutos.
setTimeout(() => encolarPendientes(400), 12000);
setInterval(() => encolarPendientes(200), 5 * 60 * 1000);

app.listen(3002, () => console.log('[feeds] microservicio en :3002'));

module.exports = { app };
