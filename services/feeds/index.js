const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { abrirFeed, normalizarUrl } = require('./rss');

const app = express();
app.use(cors());
app.use(express.json());

const SECRET = process.env.JWT_SECRET || 'portal-ia-news-dev-secret';
const AGENT = process.env.AGENT_URL || 'http://localhost:3003';
const DATA = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA, { recursive: true });

const db = new DatabaseSync(path.join(DATA, 'feeds.db'));
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

const TAXONOMIA = [
  'Inteligencia Artificial', 'Ciberseguridad', 'Sistemas Operativos',
  'Desarrollo Web', 'Programación', 'Bases de Datos', 'Móviles',
  'Nube (Cloud)', 'DevOps', 'Redes', 'Hardware', 'Software',
  'Lanzamientos', 'Actualizaciones', 'Herramientas', 'Open Source',
  'Ciencia de Datos', 'Robótica', 'Espacio', 'Ciencias',
  'Videojuegos', 'eSports', 'Economía', 'Empresas', 'Educación',
  'Deportes', 'Cine y Series', 'Música', 'Política', 'General'
];

function columnas(tabla) {
  return db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name);
}
const COLS_ART = ['imagen', 'video', 'titulo_es', 'resumen_es', 'idioma', 'contenido_html'];
for (const c of COLS_ART) {
  if (!columnas('articles').includes(c)) db.exec(`ALTER TABLE articles ADD COLUMN ${c} TEXT`);
}

// Migración 2: el cuerpo de la noticia ya NO se baja de la página original.
// Solo se muestra el texto/multimedia que trae el propio RSS. Borramos una vez
// el HTML viejo (era la página completa scrapeada) para partir de cero.
if (((db.prepare('PRAGMA user_version').get() || {}).user_version || 0) < 2) {
  db.exec('UPDATE articles SET contenido_html=NULL');
  db.exec('PRAGMA user_version=2');
  console.log('[feeds] contenido_html reiniciado: desde ahora solo se usa el del RSS');
}

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

function auth(req, res, next) {
  try {
    req.user = jwt.verify((req.headers.authorization || '').split(' ')[1], SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function etiquetar(titulo, texto) {
  const t = ((titulo || '') + ' ' + (texto || '')).toLowerCase();
  const reglas = [
    ['Inteligencia Artificial', /(^|[^a-zá])ia([^a-zá]|$)|inteligi|llm|gpt|openai|deepseek|gemini|copilot|machine learning|modelo de lenguaje|chatbot|neural/],
    ['Ciberseguridad', /vulnerab|cve-|ransomware|malware|phishing|hack|brecha|cifrado|exploit|zero.?day|insegur/],
    ['Sistemas Operativos', /linux|kernel|ubuntu|debian|fedora|arch linux|windows 1[012]|macos|distro|gnome|kde|wayland/],
    ['Desarrollo Web', /react|angular|vue|svelte|next\.?js|nuxt|django|laravel|rails|frontend|backend|javascript|typescript|web ?dev|wordpress/],
    ['Programación', /programad|código|codigo|python|rust|golang|c\+\+|compilador|algoritmo|scripting/],
    ['Bases de Datos', /base de datos|sql|postgres|mysql|mongodb|redis|sqlite|oracle/],
    ['Móviles', /android|iphone|ios\b|smartphone|aplicación móvil|app móvil|pixel|galaxy|play store|app store/],
    ['Nube (Cloud)', /cloud|nube |aws|azure|google cloud|servidor|hosting|kubernetes|contenedor/],
    ['DevOps', /devops|ci\/cd|pipeline|docker|jenkins|terraform|ansible|despliegue|deploy/],
    ['Redes', /wifi|5g|internet|isp|banda ancha|router|fibra óptica|starlink/],
    ['Hardware', /gpu|cpu|nvidia|amd |intel |ryzen|radeon|tarjeta gráfica|monitor|ssd|portátil|laptop|procesador|memoria ram/],
    ['Software', /software|aplicación|navegador|chrome|firefox|edge|vs ?code/],
    ['Lanzamientos', /lanz|estrena|disponible|nueva versión|release|anuncia|presentó|debut/],
    ['Actualizaciones', /actualiz|update|parche|patch|hotfix|corrig/],
    ['Herramientas', /herramienta|terminal|editor|plugin|extensión|librería|sdk/],
    ['Open Source', /open source|código abierto|opensource|comunidad de código/],
    ['Ciencia de Datos', /data s|analytics|estadíst|big data|visualización de datos/],
    ['Robótica', /robot|robót|dron/],
    ['Espacio', /nasa|espacio|astronáut|cohete|satélite|marte|spacex|orbital/],
    ['Ciencias', /cienc|física|biolog|investigac|científic/],
    ['Videojuegos', /juego|gaming|steam|playstation|xbox|nintendo|consola|gameplay|trailer|epic games/],
    ['eSports', /esport|torneo|competic|campeonato|liga de/],
    ['Economía', /econom|mercado|inflaci|cripto|bitcoin|dólar|bolsa|inversión|financ/],
    ['Empresas', /empresa|google|microsoft|apple|meta|amazon|tesla|startup|ceo|despid|adquisi/],
    ['Educación', /educac|beca|universidad|escuela|curso|certific|academ/],
    ['Deportes', /fútbol|futbol|nba|nfl|tenis|olímpic|gol |liga /],
    ['Cine y Series', /película|pelicula|serie |netflix|hbo|disney\+|actor|tráiler/],
    ['Música', /música|musica|álbum|album|artista|gira|concierto|spotify/],
    ['Política', /polític|gobierno|elecc|senado|president|congreso/]
  ];
  const tags = reglas.filter(([, re]) => re.test(t)).map(([t]) => t);
  return tags.length ? tags.slice(0, 4) : ['General'];
}

async function reclasificarConIA(items, userId) {
  if (!items.length) return;
  try {
    const r = await fetch(AGENT + '/classify-batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + jwt.sign({ id: 0, email: 'feeds@interno', rol: 'servicio' }, SECRET, { expiresIn: '12h' })
      },
      body: JSON.stringify({ items, userId }),
      signal: AbortSignal.timeout(75000)
    });
    if (!r.ok) return;
    const d = await r.json();
    for (const res of (d.resultados || [])) {
      if (res && res.etiquetas && res.etiquetas.length) {
        db.prepare('UPDATE articles SET etiquetas=? WHERE id=?').run(JSON.stringify(res.etiquetas), res.id);
      }
    }
  } catch {}
}

async function importarFuente(src, feedYaParseado) {
  let feed = feedYaParseado;
  if (!feed) {
    try {
      // abrirFeed() no solo lee el RSS: si la fuente guardada apunta a una
      // página web, busca el feed de verdad y nos devuelve su URL.
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
  for (const it of (feed.items || []).slice(0, 30)) {
    if (!it.link) continue;
    const bruto = it['content:encoded'] || it.content || it.contentSnippet || it.summary || '';
    const contenido = htmlATexto(bruto).slice(0, 4000);
    const contenidoHtml = bruto && /<[a-z][\s\S]*>/i.test(String(bruto)) ? String(bruto).slice(0, 20000) : null;
    const imagen = imagenDe(it, bruto);
    const video = videoDe(it, bruto);

    const existe = db.prepare('SELECT id, imagen, video, contenido, contenido_html FROM articles WHERE source_id=? AND link=?').get(src.id, it.link);
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

    const etiquetas = etiquetar(it.title, contenido);
    const r = db.prepare(`INSERT OR IGNORE INTO articles(user_id,source_id,titulo,link,contenido,contenido_html,autor,fecha,etiquetas,imagen,video)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(src.user_id, src.id, it.title || '(sin título)', it.link, contenido, contenidoHtml,
        it.creator || it.author || it['dc:creator'] || feed.title || src.nombre,
        it.isoDate || it.pubDate || new Date().toISOString(), JSON.stringify(etiquetas), imagen, video);
    if (r.changes) {
      nuevos++;
      pendientes.push({ id: Number(r.lastInsertRowid), titulo: it.title || '', texto: contenido.slice(0, 300) });
      porTraducir.push(Number(r.lastInsertRowid));
    }
  }
  if (pendientes.length) reclasificarConIA(pendientes, src.user_id).catch(() => {});
  if (porTraducir.length) encolarTraduccion(porTraducir, src.user_id);
  return nuevos;
}

// ---------- COLA DE TRADUCCIÓN AL ESPAÑOL ----------
const tokenServicio = () => jwt.sign({ id: 0, email: 'feeds@interno', rol: 'servicio' }, SECRET, { expiresIn: '12h' });
const colaES = new Map();
let traduciendo = false;

function encolarTraduccion(ids, userId) {
  for (const id of ids) colaES.set(id, userId ?? null);
  if (!traduciendo) procesarColaES().catch(() => {});
}

async function procesarColaES() {
  traduciendo = true;
  while (colaES.size) {
    const [id, userId] = colaES.entries().next().value;
    colaES.delete(id);
    try {
      const a = db.prepare('SELECT id, user_id, titulo, contenido, titulo_es FROM articles WHERE id=?').get(id);
      if (!a || a.titulo_es) continue;
      const r = await fetch(AGENT + '/spanish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenServicio() },
        body: JSON.stringify({ titulo: a.titulo, texto: String(a.contenido || '').slice(0, 900), userId: userId ?? a.user_id }),
        signal: AbortSignal.timeout(45000)
      });
      if (!r.ok) continue;
      const d = await r.json();
      if (d && (d.titulo || d.resumen)) {
        db.prepare('UPDATE articles SET titulo_es=?, resumen_es=?, idioma=? WHERE id=?')
          .run(d.titulo || a.titulo, d.resumen || '', d.idioma || 'es', id);
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  traduciendo = false;
}

async function refrescarTodo() {
  const fuentes = db.prepare('SELECT * FROM sources WHERE activo=1').all();
  for (const f of fuentes) {
    await importarFuente(f);
  }
}

app.get('/health', (req, res) => res.json({ ok: true, servicio: 'feeds' }));
app.get('/taxonomy', auth, (req, res) => res.json({ etiquetas: TAXONOMIA }));

app.post('/feeds/test', auth, async (req, res) => {
  try {
    const r = await abrirFeed(String(req.body.url || ''));
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

app.post('/feeds', auth, async (req, res) => {
  const pedida = String(req.body.url || '').trim();
  const nombre = String(req.body.nombre || '').trim() || pedida;
  if (!pedida) return res.status(400).json({ error: 'Falta la dirección del portal' });
  if (!/^https?:\/\//.test(pedida) && !/^[\w.-]+\.[a-z]{2,}/i.test(pedida)) {
    return res.status(400).json({ error: 'La URL debe empezar con http(s)://' });
  }

  // abrirFeed(): si pegaste la portada del sitio, busca el feed y devuelve su URL.
  let r;
  try {
    r = await abrirFeed(pedida);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const url = r.url || normalizarUrl(pedida);
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
  const src = db.prepare('SELECT * FROM sources WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!src) return res.status(404).json({ error: 'Fuente no encontrada' });
  const { nombre, activo, prioridad } = req.body || {};
  db.prepare('UPDATE sources SET nombre=?, activo=?, prioridad=? WHERE id=?').run(
    nombre !== undefined ? String(nombre) : src.nombre,
    activo !== undefined ? (activo ? 1 : 0) : src.activo,
    prioridad !== undefined ? Math.max(1, Math.min(5, Number(prioridad))) : src.prioridad,
    src.id
  );
  res.json({ ok: true });
});

app.delete('/feeds/:id', auth, (req, res) => {
  const src = db.prepare('SELECT * FROM sources WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!src) return res.status(404).json({ error: 'Fuente no encontrada' });
  db.prepare('DELETE FROM articles WHERE source_id=?').run(src.id);
  db.prepare('DELETE FROM sources WHERE id=?').run(src.id);
  res.json({ ok: true });
});

app.post('/feeds/refresh', auth, async (req, res) => {
  const fuentes = db.prepare('SELECT * FROM sources WHERE user_id=? AND activo=1').all(req.user.id);
  let nuevos = 0;
  for (const f of fuentes) nuevos += await importarFuente(f);
  res.json({ ok: true, nuevos, fuentes: fuentes.length });
});

app.get('/articles', auth, (req, res) => {
  const { estado, fuente, tag, q, archivado } = req.query;
  let sql = `SELECT a.*, s.nombre AS fuente, s.prioridad FROM articles a
             JOIN sources s ON s.id=a.source_id WHERE a.user_id=?`;
  const args = [req.user.id];
  if (archivado === '1') sql += ' AND a.archivado=1';
  else sql += ' AND a.archivado=0';
  if (estado === 'no_leido') sql += ' AND a.leido=0';
  if (estado === 'favorito') sql += ' AND a.favorito=1';
  if (fuente) { sql += ' AND a.source_id=?'; args.push(fuente); }
  if (tag) { sql += ' AND a.etiquetas LIKE ?'; args.push('%"' + tag + '"%'); }
  if (q) { sql += ' AND (a.titulo LIKE ? OR a.contenido LIKE ?)'; args.push('%' + q + '%', '%' + q + '%'); }
  sql += ' ORDER BY a.fecha DESC LIMIT 100';
  const rows = db.prepare(sql).all(...args).map((r) => {
    delete r.contenido_html; // pesa hasta 20 KB — solo se pide al abrir el modal
    return Object.assign(r, { etiquetas: JSON.parse(r.etiquetas || '[]') });
  });
  res.json({ articulos: rows });
});

app.get('/articles/:id', auth, async (req, res) => {
  const a = db.prepare(`SELECT a.*, s.nombre AS fuente, s.prioridad FROM articles a
    JOIN sources s ON s.id=a.source_id WHERE a.id=? AND a.user_id=?`).get(req.params.id, req.user.id);
  if (!a) return res.status(404).json({ error: 'Artículo no encontrado' });
  res.json({ articulo: a });
});


app.get('/feed', auth, (req, res) => {
  const horas = Number(req.query.horas || 168);
  const intereses = String(req.query.intereses || '').split(',').filter(Boolean);
  const q = String(req.query.q || '');
  const ahora = Date.now();
  const limite = ahora - horas * 3600 * 1000;
  const limite24 = ahora - 24 * 3600 * 1000;

  let rows = db.prepare(`SELECT a.*, s.nombre AS fuente, s.prioridad FROM articles a
    JOIN sources s ON s.id=a.source_id
    WHERE a.user_id=? AND a.saltado=0 AND a.archivado=0
    ORDER BY a.fecha DESC LIMIT 400`).all(req.user.id);
  if (q) rows = rows.filter((r) => ((r.titulo || '') + ' ' + (r.contenido || '')).toLowerCase().includes(q.toLowerCase()));

  const etiquetas = (r) => { try { return JSON.parse(r.etiquetas || '[]'); } catch { return []; } };
  const coincide = (r) => intereses.some((t) => etiquetas(r).includes(t));
  const reciente = (r) => Date.parse(r.fecha) >= limite24;
  const nivel = (r) => {
    const pref = r.prioridad >= 4;
    const match = coincide(r);
    if (reciente(r)) return pref ? 1 : match ? 2 : 3;
    return pref ? 4 : match ? 5 : 6;
  };
  const orden = (a, b) => a.n - b.n || b.prioridad - a.prioridad || Date.parse(b.fecha) - Date.parse(a.fecha);

  const dentro = [];
  const fuera = [];
  for (const r of rows) (Date.parse(r.fecha) >= limite ? dentro : fuera).push({ r, n: nivel(r) });
  dentro.sort(orden);
  fuera.sort(orden);

  const total = dentro.length;
  const conInteres = dentro.filter((x) => coincide(x.r)).length;
  let lista = dentro;
  let relleno = false;
  if (lista.length < 12 && fuera.length) {
    lista = lista.concat(fuera);
    relleno = true;
  }
  res.json({
    articulos: lista.slice(0, 60).map((x) => { delete x.r.contenido_html; return x.r; }),
    total,
    conInteres,
    sinIntereses: total - conInteres,
    relleno,
    rango: horas,
    intereses: intereses.length
  });
});

app.patch('/articles/:id', auth, (req, res) => {
  const a = db.prepare('SELECT * FROM articles WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!a) return res.status(404).json({ error: 'Artículo no encontrado' });
  const { leido, favorito, archivado, saltado } = req.body || {};
  db.prepare('UPDATE articles SET leido=?, favorito=?, archivado=?, saltado=? WHERE id=?').run(
    leido !== undefined ? (leido ? 1 : 0) : a.leido,
    favorito !== undefined ? (favorito ? 1 : 0) : a.favorito,
    archivado !== undefined ? (archivado ? 1 : 0) : a.archivado,
    saltado !== undefined ? (saltado ? 1 : 0) : a.saltado,
    a.id
  );
  res.json({ ok: true });
});

app.post('/articles/:id/clip', auth, (req, res) => {
  // OJO: hay que traer el nombre de la fuente con un JOIN. Si se pasa undefined a
  // node:sqlite, la consulta revienta (por eso los recortes daban error 500).
  const a = db.prepare(`SELECT ar.*, s.nombre AS fuente FROM articles ar
    JOIN sources s ON s.id=ar.source_id WHERE ar.id=? AND ar.user_id=?`).get(req.params.id, req.user.id);
  if (!a) return res.status(404).json({ error: 'Artículo no encontrado' });
  const { texto, nota } = req.body || {};
  if (!texto) return res.status(400).json({ error: 'Falta el fragmento de texto' });
  db.prepare('INSERT INTO clips(user_id,article_id,titulo,texto,nota,medio,link) VALUES(?,?,?,?,?,?,?)')
    .run(req.user.id, a.id, a.titulo || null, String(texto).slice(0, 4000), String(nota || ''), a.fuente || null, a.link || null);
  res.json({ ok: true });
});

app.get('/clips', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM clips WHERE user_id=? ORDER BY fecha DESC').all(req.user.id);
  res.json({ recortes: rows });
});

app.delete('/clips/:id', auth, (req, res) => {
  db.prepare('DELETE FROM clips WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.get('/stats', auth, (req, res) => {
  const u = req.user.id;
  const total = db.prepare('SELECT COUNT(*) n FROM articles WHERE user_id=?').get(u).n;
  const leidos = db.prepare('SELECT COUNT(*) n FROM articles WHERE user_id=? AND leido=1').get(u).n;
  const favoritos = db.prepare('SELECT COUNT(*) n FROM articles WHERE user_id=? AND favorito=1').get(u).n;
  const archivados = db.prepare('SELECT COUNT(*) n FROM articles WHERE user_id=? AND archivado=1').get(u).n;
  const recortes = db.prepare('SELECT COUNT(*) n FROM clips WHERE user_id=?').get(u).n;
  const porFuente = db.prepare(`SELECT s.nombre, COUNT(*) n FROM articles a JOIN sources s ON s.id=a.source_id
    WHERE a.user_id=? AND a.leido=1 GROUP BY s.nombre ORDER BY n DESC LIMIT 8`).all(u);
  const porEtiqueta = db.prepare(`SELECT etiquetas FROM articles WHERE user_id=?`).all(u)
    .flatMap((r) => JSON.parse(r.etiquetas || '[]'))
    .reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
  const topEtiquetas = Object.entries(porEtiqueta).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([nombre, n]) => ({ nombre, n }));
  res.json({ total, leidos, favoritos, archivados, recortes, porFuente, topEtiquetas });
});

refrescarTodo()
  .then(() => console.log('[feeds] fuentes iniciales importadas'))
  .catch((e) => console.error('[feeds] error al importar fuentes iniciales:', e.message));
setInterval(() => refrescarTodo().catch((e) => console.error('[feeds] error en refresco automático:', e.message)), 15 * 60 * 1000);

const sinTraducir = db.prepare('SELECT id FROM articles WHERE titulo_es IS NULL ORDER BY fecha DESC').all().map((r) => r.id);
if (sinTraducir.length) {
  console.log('[feeds] traduciendo ' + sinTraducir.length + ' noticias al español');
  encolarTraduccion(sinTraducir);
}

app.listen(3002, () => console.log('[feeds] microservicio en :3002'));
