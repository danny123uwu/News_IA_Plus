const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const SECRET = process.env.JWT_SECRET || 'portal-ia-news-dev-secret';
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const FEEDS = process.env.FEEDS_URL || 'http://localhost:3002';
let MODELO = null;
let MODELO_TEXTO = null;
const ORDEN_TEXTO = ['llama3.1:8b', 'qwen3:8b', 'hermes3', 'hermes-libre', 'llama3.1', 'qwen2.5-coder:7b'];
const ORDEN_CLAS = ['qwen2.5-coder:3b', 'qwen2.5-coder:1.5b', 'qwen2.5-coder:7b', 'llama3.1:8b'];

// ---------- CONFIGURACIÓN DE IA POR USUARIO ----------
const CONFIG_FILE = path.join(__dirname, '..', '..', 'data', 'ia.json');
const CONFIG_DEFECTO = {
  motor: 'local',
  modelos: { clasificar: '', resumir: '' },
  traduccion: 'google',
  api: { proveedor: 'gemini', baseUrl: '', key: '', modelo: '' }
};
const PROVEEDORES = {
  gemini: { nombre: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/', modelo: 'gemini-2.0-flash' },
  groq: { nombre: 'Groq (gratis)', url: 'https://api.groq.com/openai/v1', modelo: 'llama-3.3-70b-versatile' },
  openai: { nombre: 'OpenAI', url: 'https://api.openai.com/v1', modelo: 'gpt-4o-mini' },
  deepseek: { nombre: 'DeepSeek', url: 'https://api.deepseek.com/v1', modelo: 'deepseek-chat' },
  openrouter: { nombre: 'OpenRouter', url: 'https://openrouter.ai/api/v1', modelo: 'meta-llama/llama-3.3-70b-instruct:free' },
  personalizado: { nombre: 'Personalizado (compatible OpenAI)', url: '', modelo: '' }
};

function leerConfigs() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
function guardarConfigs(todas) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(todas, null, 2));
}
function getConfig(id) {
  const c = leerConfigs()['u' + id] || {};
  return {
    ...CONFIG_DEFECTO, ...c,
    modelos: { ...CONFIG_DEFECTO.modelos, ...(c.modelos || {}) },
    api: { ...CONFIG_DEFECTO.api, ...(c.api || {}) }
  };
}
function setConfig(id, c) {
  const cfg = getConfig(id);
  if (c.motor === 'local' || c.motor === 'api') cfg.motor = c.motor;
  if (c.traduccion === 'google' || c.traduccion === 'motor') cfg.traduccion = c.traduccion;
  if (c.modelos) {
    if (typeof c.modelos.clasificar === 'string') cfg.modelos.clasificar = c.modelos.clasificar;
    if (typeof c.modelos.resumir === 'string') cfg.modelos.resumir = c.modelos.resumir;
  }
  if (c.api) {
    if (c.api.proveedor && PROVEEDORES[c.api.proveedor]) cfg.api.proveedor = c.api.proveedor;
    if (typeof c.api.baseUrl === 'string') cfg.api.baseUrl = c.api.baseUrl.trim();
    if (typeof c.api.modelo === 'string') cfg.api.modelo = c.api.modelo.trim();
    if (typeof c.api.key === 'string' && c.api.key.trim()) cfg.api.key = c.api.key.trim();
  }
  const todas = leerConfigs();
  todas['u' + id] = cfg;
  guardarConfigs(todas);
  return cfg;
}
function configVisible(cfg) {
  const api = { ...cfg.api, key: '', keyGuardada: Boolean(cfg.api.key), keyFinal: cfg.api.key ? '••••' + cfg.api.key.slice(-4) : '' };
  return { ...cfg, api };
}

async function listarModelos() {
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.models || [])
      .map((m) => ({ name: m.name, size: m.size || 0, gb: +((m.size || 0) / 1e9).toFixed(1) }))
      .filter((m) => !/embed/i.test(m.name));
  } catch { return []; }
}

function recomendar(modelos) {
  const validos = modelos.filter((m) => !/embed/i.test(m.name));
  const enGama = validos.filter((m) => m.size >= 0.9e9 && m.size <= 5.5e9).sort((a, b) => b.size - a.size);
  const chicos = validos.filter((m) => m.size > 0 && m.size <= 2.5e9).sort((a, b) => b.size - a.size);
  const pesados = validos.filter((m) => m.size > 5.5e9).map((m) => m.name);
  const tiene = (n) => validos.some((m) => m.name === n);
  return {
    clasificar: ORDEN_CLAS.find(tiene) || (chicos[0] || validos[0] || {}).name || '',
    resumir: ORDEN_TEXTO.find((n) => tiene(n) && !pesados.includes(n)) || (enGama[0] || chicos[0] || validos[0] || {}).name || '',
    evitados: pesados
  };
}

async function apiExterna(api, prompt, system) {
  const base = String(api.baseUrl || '').replace(/\/+$/, '');
  if (!base || !api.key) throw new Error('API externa sin URL o sin key');
  const r = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + api.key },
    body: JSON.stringify({
      model: api.modelo,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      temperature: 0.3
    }),
    signal: AbortSignal.timeout(90000)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error('API ' + r.status + (t ? ' — ' + t.slice(0, 140) : ''));
  }
  const d = await r.json();
  const txt = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
  if (!txt) throw new Error('API sin respuesta');
  return String(txt).trim();
}

function auth(req, res, next) {
  try {
    req.user = jwt.verify((req.headers.authorization || '').split(' ')[1], SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

async function ollamaDisponible() {
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return false;
    const d = await r.json();
    const modelos = (d.models || []).map((m) => m.name);
    if (!MODELO) MODELO = ORDEN_CLAS.find((m) => modelos.includes(m)) || modelos.find((m) => /qwen|llama|hermes|gemma|phi/i.test(m)) || modelos[0] || null;
    if (!MODELO_TEXTO) MODELO_TEXTO = ORDEN_TEXTO.find((m) => modelos.includes(m)) || MODELO;
    return Boolean(MODELO);
  } catch {
    return false;
  }
}

async function preguntar(prompt, system, modelo) {
  const r = await fetch(OLLAMA + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelo || MODELO, prompt, system, stream: false, think: false, options: { temperature: 0.3 } }),
    signal: AbortSignal.timeout(180000)
  });
  if (!r.ok) throw new Error('Ollama ' + r.status);
  const d = await r.json();
  return String(d.response || '').trim();
}

// Un solo punto de entrada para toda la IA: usa la API externa si el usuario la eligió,
// si no el modelo local configurado para esa tarea, y si no, la selección automática.
async function generar({ prompt, system, tarea, userId, cfg: cfgDirecto }) {
  const cfg = cfgDirecto || getConfig(userId);
  if (cfg.motor === 'api' && cfg.api.key && cfg.api.baseUrl) {
    const t0 = Date.now();
    const texto = await apiExterna(cfg.api, prompt, system);
    return { texto, motor: 'api:' + cfg.api.proveedor + (cfg.api.modelo ? ':' + cfg.api.modelo : ''), ms: Date.now() - t0 };
  }
  const elegido = (cfg.modelos || {})[tarea];
  if (await ollamaDisponible()) {
    const modelo = elegido || (tarea === 'clasificar' ? MODELO : MODELO_TEXTO);
    const t0 = Date.now();
    const texto = await preguntar(prompt, system, modelo);
    return { texto, motor: 'ollama:' + modelo, ms: Date.now() - t0 };
  }
  throw new Error('Sin motor de IA disponible (Ollama apagado y sin API externa)');
}

// ---------- TRADUCCIÓN AL ESPAÑOL (API externa + fallback local) ----------
function esEspanol(t) {
  const s = String(t || '');
  if (/[ñáéíóúü¿¡]/i.test(s)) return true;
  const palabras = (s.toLowerCase().match(/\b[a-záéíóúüñ]+/g) || []).length;
  if (!palabras) return false;
  const comunes = (s.toLowerCase().match(/\b(el|la|los|las|de|del|que|y|en|un|una|para|con|por|se|su|sus|no|es|al|más|como|desde|sobre|entre|este|esta|muy|pero|hay|son|fue|han|cuando|también|contra|sin|ante|bajo)\b/g) || []).length;
  return comunes / palabras > 0.1;
}

async function apiGoogle(q) {
  const u = 'https://translate.googleapis.com/translate_a/single?' + new URLSearchParams({ client: 'dict-chrome-ex', sl: 'auto', tl: 'es', dt: 't', q });
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('google ' + r.status);
  const d = await r.json();
  const txt = (d[0] || []).map((x) => x[0]).join('');
  if (!txt) throw new Error('google sin texto');
  return txt;
}

async function apiMyMemory(q) {
  const u = 'https://api.mymemory.translated.net/get?' + new URLSearchParams({ q: q.slice(0, 4500), langpair: 'autodetect|es' });
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('mymemory ' + r.status);
  const d = await r.json();
  const txt = d && d.responseData && d.responseData.translatedText;
  if (!txt || /MYMEMORY WARNING|INVALID|QUERY LENGTH/i.test(txt)) throw new Error('mymemory límite');
  return txt;
}

async function traducirTexto(q, userId) {
  if (!q) return { texto: '', proveedor: 'nulo' };
  const cfg = getConfig(userId);
  const errores = [];
  const local = async (texto) => {
    if (!(await ollamaDisponible())) throw new Error('ollama apagado');
    const modelo = cfg.modelos.resumir || MODELO_TEXTO;
    const r = await preguntar(
      `Traduce esto al español. Devuelve SOLO la traducción, sin explicaciones:\n\n${texto.slice(0, 2500)}`,
      'Eres un traductor profesional al español.',
      modelo
    );
    if (!r) throw new Error('ollama sin texto');
    return r;
  };
  const viaApi = async (texto) => apiExterna(
    cfg.api,
    `Traduce esto al español. Devuelve SOLO la traducción, sin explicaciones:\n\n${texto.slice(0, 2500)}`,
    'Eres un traductor profesional al español.'
  );

  // Orden: lo que el usuario eligió primero, y el resto como respaldo (nunca se queda sin traducir)
  const pasos = [];
  if (cfg.traduccion === 'motor') {
    if (cfg.motor === 'api' && cfg.api.key && cfg.api.baseUrl) pasos.push(['api:' + cfg.api.proveedor, viaApi]);
    else pasos.push(['ollama', local]);
    pasos.push(['google', apiGoogle], ['mymemory', apiMyMemory]);
  } else {
    pasos.push(['google', apiGoogle], ['mymemory', apiMyMemory], ['ollama', local]);
    if (cfg.motor === 'api' && cfg.api.key && cfg.api.baseUrl) pasos.push(['api:' + cfg.api.proveedor, viaApi]);
  }
  for (const [nombre, fn] of pasos) {
    try {
      return { texto: await fn(q), proveedor: nombre };
    } catch (e) {
      errores.push(nombre + ': ' + e.message);
    }
  }
  throw new Error(errores.join(' | ') || 'sin traductor disponible');
}

const TAXONOMIA = ['Sistemas Operativos', 'Ciberseguridad', 'Frameworks', 'Lanzamientos', 'Actualizaciones', 'Herramientas', 'Inteligencia Artificial', 'Hardware', 'Videojuegos', 'eSports', 'Deportes', 'Ciencias', 'Educación', 'Seguridad', 'Cine y Series', 'Música', 'Política', 'Economía', 'General'];

function clasificarPorReglas(titulo, texto) {
  const t = ((titulo || '') + ' ' + (texto || '')).toLowerCase();
  const reglas = [
    ['Sistemas Operativos', /linux|kernel|ubuntu|debian|fedora|windows 1[01]|macos|distro|gnome|kde|wayland/],
    ['Ciberseguridad', /seguridad|vulnerab|cve-|ransomware|malware|phishing|hack|brecha|cifrado|exploit/],
    ['Inteligencia Artificial', /inteligi| ia |llm|gpt|openai|deepseek|machine learning|gemini|modelo de lenguaje/],
    ['Frameworks', /framework|react|angular|vue|svelte|next\.?js|django|laravel|rails/],
    ['Actualizaciones', /actualiz|update|parche|patch|hotfix|corrig/],
    ['Lanzamientos', /lanz|estrena|disponible|nuevo versión|release|anuncia/],
    ['Herramientas', /herramienta|vs ?code|docker|git |terminal|editor|plugin|extensi/],
    ['Hardware', /gpu|cpu|nvidia|amd |intel |ryzen|tarjeta gráfica|monitor|ssd|portátil/],
    ['Videojuegos', /juego|gaming|steam|playstation|xbox|nintendo|consola|gameplay|trailer/],
    ['eSports', /esport|torneo|competic|campeonato/],
    ['Deportes', /fútbol|futbol|nba|nfl|tenis|olímpic|gol |liga /],
    ['Ciencias', /cienc|nasa|espacio|astrónom|física|biolog|investigac/],
    ['Educación', /educac|beca|universidad|escuela|curso|certific/],
    ['Cine y Series', /película|pelicula|serie |netflix|hbo|disney\+|actor|tráiler/],
    ['Música', /música|musica|álbum|album|gira|concierto|spotify/],
    ['Política', /polític|gobierno|elecc|senado|president/],
    ['Economía', /econom|mercado|inflaci|cripto|bitcoin|dólar|bolsa/]
  ];
  const tags = reglas.filter(([, re]) => re.test(t)).map(([x]) => x);
  return tags.length ? tags : ['General'];
}

function resumenExtractivo(texto, n = 3) {
  const frases = String(texto || '').replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) || [String(texto || '')];
  return frases.slice(0, n).join(' ').trim() || 'Sin contenido para resumir.';
}

function recortarFrases(texto, max) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  const fin = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('! '), corte.lastIndexOf('? '));
  return (fin > max * 0.5 ? corte.slice(0, fin + 1) : corte.trimEnd() + '…');
}

app.get('/health', async (req, res) => {
  const ia = await ollamaDisponible();
  res.json({ ok: true, servicio: 'agente', ia_local: ia, modelo: ia ? MODELO : null, modelo_texto: ia ? MODELO_TEXTO : null });
});

// ---------- CONFIGURACIÓN DE IA (panel ⚙️) ----------
async function respuestaConfig(res, userId) {
  const cfg = getConfig(userId);
  const modelos = await listarModelos();
  const recomendado = recomendar(modelos);
  res.json({
    config: configVisible(cfg),
    modelos,
    recomendado,
    proveedores: PROVEEDORES,
    ollama: modelos.length > 0
  });
}

app.get('/config', auth, async (req, res) => respuestaConfig(res, req.user.id));

app.put('/config', auth, async (req, res) => {
  try {
    setConfig(req.user.id, req.body || {});
    await respuestaConfig(res, req.user.id);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo guardar: ' + e.message });
  }
});

// Prueba el motor configurado (API externa o modelo local). Si viene config en el body,
// prueba lo que el usuario está escribiendo sin guardarlo todavía.
app.post('/config/test', auth, async (req, res) => {
  const t0 = Date.now();
  const b = req.body || {};
  const apiPrueba = { ...(b.api || {}) };
  if (!apiPrueba.key) delete apiPrueba.key; // key vacía = usar la guardada
  const base = getConfig(req.user.id);
  const cfg = (b.motor || b.api || b.modelos)
    ? { ...base, ...(b.motor ? { motor: b.motor } : {}), modelos: { ...base.modelos, ...(b.modelos || {}) }, api: { ...base.api, ...apiPrueba } }
    : base;
  try {
    const { texto, motor, ms } = await generar({
      prompt: 'Responde con exactamente una palabra: LISTO',
      system: 'Contesta con una sola palabra, sin puntuación.',
      tarea: 'resumir',
      userId: req.user.id,
      cfg
    });
    res.json({ ok: true, motor, ms: ms || Date.now() - t0, respuesta: String(texto).slice(0, 120) });
  } catch (e) {
    res.status(502).json({ error: e.message, ms: Date.now() - t0 });
  }
});

// Traduce título + extracto al español. modo:'completo' traduce el texto entero.
app.post('/spanish', auth, async (req, res) => {
  const { titulo, texto, modo } = req.body || {};
  const origTitulo = String(titulo || '');
  const origTexto = String(texto || '');
  if (!origTitulo && !origTexto) return res.status(400).json({ error: 'Falta el texto' });

  if (esEspanol(origTitulo + ' ' + origTexto.slice(0, 300))) {
    return res.json({
      titulo: origTitulo,
      resumen: recortarFrases(origTexto, modo === 'completo' ? 4000 : 700),
      texto: recortarFrases(origTexto, 4000),
      idioma: 'es',
      proveedor: 'original'
    });
  }
  try {
    const [t, x] = await Promise.all([
      origTitulo ? traducirTexto(origTitulo, req.user.id) : Promise.resolve({ texto: '', proveedor: 'nulo' }),
      origTexto ? traducirTexto(modo === 'completo' ? origTexto.slice(0, 4000) : origTexto.slice(0, 900), req.user.id) : Promise.resolve({ texto: '', proveedor: 'nulo' })
    ]);
    res.json({
      titulo: t.texto || origTitulo,
      resumen: recortarFrases(x.texto, modo === 'completo' ? 4000 : 700),
      texto: x.texto,
      idioma: 'es',
      proveedor: t.proveedor
    });
  } catch (e) {
    res.status(502).json({ error: 'No se pudo traducir: ' + e.message });
  }
});

app.post('/classify', auth, async (req, res) => {
  const { titulo, texto } = req.body || {};
  try {
    const { texto: r, motor } = await generar({
      prompt: `Clasifica esta noticia. Responde SOLO con un JSON: un arreglo con entre 1 y 3 etiquetas, copiadas tal cual de esta lista (no inventes ni repitas la lista entera): ${JSON.stringify(TAXONOMIA)}.\n\nTítulo: ${titulo}\nTexto: ${String(texto || '').slice(0, 1200)}`,
      system: 'Eres un clasificador de noticias. Respondes solo JSON válido, por ejemplo ["Economía"]. Máximo 3 etiquetas.',
      tarea: 'clasificar',
      userId: req.user.id
    });
    const m = r.match(/\[[\s\S]*?\]/);
    if (m) {
      const tags = JSON.parse(m[0]).filter((t) => TAXONOMIA.includes(t)).slice(0, 3);
      if (tags.length) return res.json({ etiquetas: tags, motor });
    }
  } catch {}
  res.json({ etiquetas: clasificarPorReglas(titulo, texto), motor: 'reglas' });
});

app.post('/summarize', auth, async (req, res) => {
  const { titulo, texto } = req.body || {};
  try {
    const { texto: r, motor, ms } = await generar({
      prompt: `Resume esta noticia en español de forma completa pero compacta.\nRequisitos: entre 5 y 7 frases (unas 150 palabras), en párrafo corrido.\nDebe responder: qué pasó, quién está involucrado, cuándo y dónde, por qué importa y los datos concretos (nombres, cifras, versiones).\nNo inventes nada que no esté en el texto.\n\nTítulo original: ${titulo}\n\n${String(texto || '').slice(0, 4000)}`,
      system: 'Eres un periodista experto que resume con precisión, claridad y neutralidad en español.',
      tarea: 'resumir',
      userId: req.user.id
    });
    if (r) return res.json({ resumen: r, motor, ms });
  } catch {}
  res.json({ resumen: resumenExtractivo(texto), motor: 'reglas' });
});

app.post('/digest', auth, async (req, res) => {
  const { articulos } = req.body || {};
  const lista = (articulos || []).slice(0, 20);
  if (!lista.length) return res.json({ digest: 'No hay noticias nuevas en las últimas 24 horas.' });
  try {
    const bloques = lista.map((a, i) => `${i + 1}. [${a.fuente}] ${a.titulo}\n${String(a.contenido || '').slice(0, 400)}`).join('\n\n');
    const { texto: r, motor, ms } = await generar({
      prompt: `Este es lo publicado hoy. Escribe un digest "Lo importante de hoy": máximo 6 bullets cortos en español, agrupando lo que sea del mismo tema:\n\n${bloques}`,
      system: 'Eres un editor de noticias conciso.',
      tarea: 'resumir',
      userId: req.user.id
    });
    if (r) return res.json({ digest: r, motor, ms });
  } catch {}
  const resumen = lista.slice(0, 6).map((a) => '• ' + a.titulo + (a.fuente ? ' — ' + a.fuente : '')).join('\n');
  res.json({ digest: 'Lo importante de hoy:\n' + resumen, motor: 'reglas' });
});

app.post('/ask', auth, async (req, res) => {
  const { pregunta, texto, titulo } = req.body || {};
  try {
    const { texto: r, motor, ms } = await generar({
      prompt: `Noticia: ${titulo}\n\n${String(texto || '').slice(0, 4000)}\n\nPregunta del usuario: ${pregunta}`,
      system: 'Explicas de forma sencilla, en español, como a un amigo. Responde con datos del texto.',
      tarea: 'resumir',
      userId: req.user.id
    });
    if (r) return res.json({ respuesta: r, motor, ms });
  } catch {}
  res.json({ respuesta: 'La IA local no está disponible en este momento. Fragmento de la noticia: ' + String(texto || '').slice(0, 400), motor: 'reglas' });
});

app.post('/classify-batch', auth, async (req, res) => {
  const items = (req.body.items || []).slice(0, 30);
  try {
    const bloques = items.map((x, i) => `${i}. ${x.titulo}: ${String(x.texto || '').slice(0, 150)}`).join('\n');
    const { texto: r, motor } = await generar({
      prompt: `Clasifica los titulares numerados. Devuelve SOLO un JSON con un arreglo de arreglos, en el mismo orden, con etiquetas de esta lista: ${JSON.stringify(TAXONOMIA)}\n\n${bloques}`,
      system: 'Eres un clasificador de noticias. Respondes solo JSON válido.',
      tarea: 'clasificar',
      userId: req.user.id
    });
    const m = r.match(/\[[\s\S]*\]/);
    if (m) {
      const arr = JSON.parse(m[0]);
      const resultados = items.map((x, i) => ({
        id: x.id,
        etiquetas: [...new Set((Array.isArray(arr[i]) ? arr[i] : []).filter((t) => TAXONOMIA.includes(t)))].slice(0, 4)
      }));
      if (resultados.some((x) => x.etiquetas.length)) return res.json({ resultados, motor });
    }
  } catch {}
  res.json({ resultados: items.map((x) => ({ id: x.id, etiquetas: clasificarPorReglas(x.titulo, x.texto) })), motor: 'reglas' });
});

app.listen(3003, () => console.log('[agente] microservicio en :3003'));
