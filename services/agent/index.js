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
const ORDEN_TEXTO = ['llama3.2:3b', 'llama3.1:8b', 'qwen3:8b', 'qwen2.5:3b', 'gemma2:2b', 'hermes3', 'hermes-libre', 'llama3.1', 'qwen2.5-coder:7b'];
const ORDEN_CLAS = ['qwen2.5-coder:3b', 'qwen2.5:3b', 'qwen2.5-coder:1.5b', 'llama3.2:3b', 'llama3.1:8b'];

// Modelos que el sistema RECOMIENDA descargar cuando el usuario no tiene ninguno.
// Elegidos para PCs humildes (~2 GB de VRAM) y con buen español:
//   llama3.2:3b -> general (resumir, preguntar, digest), español soportado oficialmente
//   qwen2.5:3b  -> clasificar etiquetas (rápido y muy bueno generando JSON)
//   gemma2:2b   -> ultra liviano, para equipos con solo 2 GB de VRAM
const RECOMENDADOS = [
  { name: 'llama3.2:3b', gb: 2.0, tarea: 'texto', nota: 'General: resumir, preguntar y digest. Español oficial.' },
  { name: 'qwen2.5:3b', gb: 1.9, tarea: 'clasificar', nota: 'Clasificar etiquetas: rápido y muy bueno en JSON.' },
  { name: 'gemma2:2b', gb: 1.6, tarea: 'texto', nota: 'Ultra liviano: para PCs con solo 2 GB de VRAM.' }
];

// ---------- CONFIGURACIÓN DE IA POR USUARIO ----------
const CONFIG_FILE = path.join(__dirname, '..', '..', 'data', 'ia.json');
const CONFIG_DEFECTO = {
  motor: 'local',
  modelos: { clasificar: '', resumir: '' },
  traduccion: 'google',
  respaldoLocal: false,
  api: { proveedor: 'gemini', baseUrl: '', key: '', modelo: '' }
};
const PROVEEDORES = {
  gemini: { nombre: 'Google AI Studio (Gemini)', url: 'https://generativelanguage.googleapis.com/v1beta/openai/', modelo: 'gemini-2.5-flash' },
  groq: { nombre: 'Groq (gratis)', url: 'https://api.groq.com/openai/v1', modelo: 'llama-3.3-70b-versatile' },
  anthropic: { nombre: 'Anthropic (Claude)', url: 'https://api.anthropic.com/v1', modelo: 'claude-sonnet-4-5' },
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
  const cfg = {
    ...CONFIG_DEFECTO, ...c,
    modelos: { ...CONFIG_DEFECTO.modelos, ...(c.modelos || {}) },
    api: { ...CONFIG_DEFECTO.api, ...(c.api || {}) }
  };
  // Google retira modelos cada tanto (ej: gemini-2.0-flash ya no existe). Si el
  // usuario tenía uno viejo guardado, se salta automáticamente al modelo actual.
  if (cfg.api.proveedor === 'gemini' && /^gemini-(1\.|2\.0)/i.test(cfg.api.modelo || '')) {
    cfg.api.modelo = PROVEEDORES.gemini.modelo;
  }
  return cfg;
}
function setConfig(id, c) {
  const cfg = getConfig(id);
  if (c.motor === 'local' || c.motor === 'api') cfg.motor = c.motor;
  if (c.traduccion === 'google' || c.traduccion === 'motor') cfg.traduccion = c.traduccion;
  if (typeof c.respaldoLocal === 'boolean') cfg.respaldoLocal = c.respaldoLocal;
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

// Google Gemini tiene su propia API (la que usa la lista de "Ver modelos").
// La capa "compatible con OpenAI" de Google NO expone todos los modelos, por eso
// algunos existían en la lista pero daban 404. Usamos la API nativa de Google.
async function geminiNativo(api, prompt, system) {
  const model = String(api.modelo || '').replace(/^models\//, '').trim();
  if (!model) throw new Error('Elegí un modelo de Gemini (botón "🔄 Ver modelos")');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(api.key);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 }
    }),
    signal: AbortSignal.timeout(90000)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    if (r.status === 404) throw new Error('el modelo "' + model + '" no está disponible con tu key. Pulsá "🔄 Ver modelos" y elegí otro.');
    throw new Error('Gemini ' + r.status + (t ? ' — ' + t.slice(0, 160) : ''));
  }
  const d = await r.json();
  const cand = d && d.candidates && d.candidates[0];
  const txt = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || '').join('') : '';
  if (!txt) {
    const bloqueo = d && d.promptFeedback && d.promptFeedback.blockReason;
    throw new Error(bloqueo ? 'Gemini bloqueó la respuesta (' + bloqueo + ')' : 'Gemini no devolvió texto');
  }
  return String(txt).trim();
}

async function apiExterna(api, prompt, system) {
  if ((api.proveedor || '') === 'gemini') return geminiNativo(api, prompt, system);
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
    if (r.status === 404) {
      throw new Error('el modelo "' + (api.modelo || '(vacío)') + '" no existe o ya no está disponible. En ⚙️ IA, pulsá "🔄 Ver modelos" y elegí uno de la lista.');
    }
    throw new Error('API ' + r.status + (t ? ' — ' + t.slice(0, 140) : ''));
  }
  const d = await r.json();
  const txt = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
  if (!txt) throw new Error('API sin respuesta');
  return String(txt).trim();
}

// Pregunta a la API del usuario qué modelos tiene disponibles (para el desplegable).
// Google AI Studio usa su endpoint nativo; el resto, el /models compatible con OpenAI.
async function listarModelosApi(baseUrl, key, proveedor) {
  if (proveedor === 'gemini') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key), { signal: AbortSignal.timeout(20000) });
    if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('API ' + r.status + (t ? ' — ' + t.slice(0, 140) : '')); }
    const d = await r.json();
    return (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter(Boolean);
  }
  const r = await fetch(baseUrl + '/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error('API ' + r.status + (t ? ' — ' + t.slice(0, 140) : '')); }
  const d = await r.json();
  const bruto = Array.isArray(d.data) ? d.data : (Array.isArray(d.models) ? d.models : []);
  return [...new Set(bruto.map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean))];
}

function auth(req, res, next) {
  try {
    req.user = jwt.verify((req.headers.authorization || '').split(' ')[1], SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// El servicio de feeds hace trabajo en segundo plano (clasificar/traducir) con un
// token de servicio (id 0). Ahí no hay sesión, así que ese token puede indicar en
// el cuerpo A QUÉ USUARIO pertenecen los datos y se usa SU configuración de IA
// (no la de por defecto). Un token normal nunca puede suplantar a otro usuario.
function uidDe(req) {
  const b = req.body || {};
  if (req.user && req.user.rol === 'servicio' && b.userId != null && b.userId !== '') {
    const n = Number(b.userId);
    if (Number.isFinite(n)) return n;
  }
  return req.user.id;
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
  const apiLista = cfg.api.key && (cfg.api.baseUrl || cfg.api.proveedor === 'gemini');
  if (cfg.motor === 'api') {
    if (!apiLista) throw new Error('Falta la API key (o la URL) del proveedor externo');
    const t0 = Date.now();
    try {
      const texto = await apiExterna(cfg.api, prompt, system);
      return { texto, motor: 'api:' + cfg.api.proveedor + (cfg.api.modelo ? ':' + cfg.api.modelo : ''), ms: Date.now() - t0 };
    } catch (e) {
      // La IA local solo entra si el usuario la habilitó como respaldo.
      if (cfg.respaldoLocal !== true || !(await ollamaDisponible())) throw e;
    }
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

  // Orden: primero lo que el usuario eligió, y el resto como respaldo.
  // IMPORTANTE: si el motor es "API externa", NO se usa el modelo local (así la IA
  // local no se carga en la GPU sin permiso). Solo se usa si el usuario activó
  // "usar también la IA local como respaldo".
  const apiLista = cfg.api.key && (cfg.api.baseUrl || cfg.api.proveedor === 'gemini');
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
      return { texto: await fn(q), proveedor: nombre };
    } catch (e) {
      errores.push(nombre + ': ' + e.message);
    }
  }
  throw new Error(errores.join(' | ') || 'sin traductor disponible');
}

const TAXONOMIA = [
  'Inteligencia Artificial', 'Ciberseguridad', 'Sistemas Operativos',
  'Desarrollo Web', 'Programación', 'Bases de Datos', 'Móviles',
  'Nube (Cloud)', 'DevOps', 'Redes', 'Hardware', 'Software',
  'Lanzamientos', 'Actualizaciones', 'Herramientas', 'Open Source',
  'Ciencia de Datos', 'Robótica', 'Espacio', 'Ciencias',
  'Videojuegos', 'eSports', 'Economía', 'Empresas', 'Educación',
  'Deportes', 'Cine y Series', 'Música', 'Política', 'General'
];

function clasificarPorReglas(titulo, texto) {
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
  const tags = reglas.filter(([, re]) => re.test(t)).map(([x]) => x);
  return tags.length ? tags.slice(0, 4) : ['General'];
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
  const instalados = new Set(modelos.map((m) => m.name));
  res.json({
    config: configVisible(cfg),
    modelos,
    recomendado,
    recomendados: RECOMENDADOS,
    faltantes: RECOMENDADOS.filter((r) => !instalados.has(r.name)),
    proveedores: PROVEEDORES,
    ollama: modelos.length > 0
  });
}

app.get('/config', auth, async (req, res) => respuestaConfig(res, req.user.id));

// Descarga un modelo en Ollama (para quien todavía no tiene ninguno instalado).
// Corre en segundo plano dentro de Ollama; puede tardar varios minutos.
// Nombre de modelo estilo Ollama: "modelo" o "modelo:tag" (admite namespace con /).
// Se rechaza cualquier intento raro (puntos suspensivos, rutas, etc.).
const NOMBRE_MODELO = /^(?!.*\.\.)[a-zA-Z0-9][a-zA-Z0-9._\/-]*(:[a-zA-Z0-9._-]+)?$/;

app.post('/model/pull', auth, async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name || name.length > 120 || !NOMBRE_MODELO.test(name)) {
    return res.status(400).json({ error: 'Nombre de modelo inválido' });
  }
  try {
    const r = await fetch(OLLAMA + '/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: false }),
      signal: AbortSignal.timeout(1800000) // hasta 30 min (modelos grandes)
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return res.status(502).json({ error: 'Ollama ' + r.status + (t ? ' — ' + t.slice(0, 160) : '') });
    }
    await r.json().catch(() => ({}));
    MODELO = null; MODELO_TEXTO = null;   // recalcula la elección automática
    await ollamaDisponible();
    res.json({ ok: true, name });
  } catch (e) {
    res.status(502).json({ error: 'No se pudo descargar: ' + e.message });
  }
});

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
      userId: uidDe(req),
      cfg
    });
    res.json({ ok: true, motor, ms: ms || Date.now() - t0, respuesta: String(texto).slice(0, 120) });
  } catch (e) {
    res.status(502).json({ error: e.message, ms: Date.now() - t0 });
  }
});

// Lista los modelos que tu API key puede usar (botón "🔄 Ver modelos").
app.post('/config/models', auth, async (req, res) => {
  const b = req.body || {};
  const guardada = getConfig(req.user.id).api;
  const baseUrl = String(b.baseUrl || guardada.baseUrl || '').replace(/\/+$/, '');
  const key = (b.key && String(b.key).trim()) || guardada.key;
  const proveedor = b.proveedor || guardada.proveedor;
  if (proveedor !== 'gemini' && !baseUrl) return res.status(400).json({ error: 'Falta la URL base de la API' });
  if (!key) return res.status(400).json({ error: 'Falta la API key' });
  try {
    let modelos = await listarModelosApi(baseUrl, key, proveedor);
    modelos = modelos
      .filter((id) => !/embed|embedding|aqa|imagen|image-generation|veo|tts|whisper|moderation/i.test(id))
      .sort();
    res.json({ proveedor, modelos });
  } catch (e) {
    res.status(502).json({ error: 'No se pudieron leer los modelos: ' + e.message });
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
      origTitulo ? traducirTexto(origTitulo, uidDe(req)) : Promise.resolve({ texto: '', proveedor: 'nulo' }),
      origTexto ? traducirTexto(modo === 'completo' ? origTexto.slice(0, 4000) : origTexto.slice(0, 900), uidDe(req)) : Promise.resolve({ texto: '', proveedor: 'nulo' })
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

// Traduce VARIOS fragmentos de una vez (para el cuerpo de la noticia, bloque por
// bloque, conservando el orden de imágenes y videos). Usa traductores GRATIS y
// rápidos (Google/MyMemory) para no cargar el modelo local ni tardar minutos.
app.post('/spanish/bloques', auth, async (req, res) => {
  const textos = (req.body.textos || []).map((t) => String(t == null ? '' : t).slice(0, 2500));
  if (!textos.length) return res.json({ traducciones: [] });
  const out = new Array(textos.length).fill('');
  let siguiente = 0;
  const traducirBloque = async (t) => {
    if (!t.trim()) return t;
    try { return await apiGoogle(t); } catch {}
    try { return await apiMyMemory(t); } catch {}
    return ''; // si no hay traductor, se deja el texto original en el navegador
  };
  const worker = async () => {
    while (siguiente < textos.length) {
      const i = siguiente++;
      out[i] = await traducirBloque(textos[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, textos.length) }, worker));
  res.json({ traducciones: out });
});

app.post('/classify', auth, async (req, res) => {
  const { titulo, texto } = req.body || {};
  try {
    const { texto: r, motor } = await generar({
      prompt: `Clasifica esta noticia. Responde SOLO con un JSON: un arreglo con entre 1 y 3 etiquetas, copiadas tal cual de esta lista (no inventes ni repitas la lista entera): ${JSON.stringify(TAXONOMIA)}.\n\nTítulo: ${titulo}\nTexto: ${String(texto || '').slice(0, 1200)}`,
      system: 'Eres un clasificador de noticias. Respondes solo JSON válido, por ejemplo ["Economía"]. Máximo 3 etiquetas.',
      tarea: 'clasificar',
      userId: uidDe(req)
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
      prompt: `Resume esta noticia en español, con detalle y sin inventar nada.\n` +
        `Formato obligatorio:\n` +
        `1) Un párrafo de entrada (2-3 frases) que explique de qué trata.\n` +
        `2) La línea "Puntos clave:" y debajo entre 3 y 6 viñetas que empiecen con "- ", con los datos concretos: nombres propios, cifras, versiones, fechas, nombres de errores, pasos o consecuencias.\n` +
        `Debe quedar claro qué pasó, quién participa, cuándo, por qué importa y cómo afecta al usuario. No repitas la introducción en las viñetas.\n\n` +
        `Título original: ${titulo}\n\n${String(texto || '').slice(0, 6000)}`,
      system: 'Eres un periodista experto que resume con precisión, claridad y neutralidad en español. Nunca inventas datos que no estén en el texto.',
      tarea: 'resumir',
      userId: uidDe(req)
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
      userId: uidDe(req)
    });
    if (r) return res.json({ digest: r, motor, ms });
  } catch {}
  const resumen = lista.slice(0, 6).map((a) => '• ' + a.titulo + (a.fuente ? ' — ' + a.fuente : '')).join('\n');
  res.json({ digest: 'Lo importante de hoy:\n' + resumen, motor: 'reglas' });
});

const PARECIA_RECHAZO = /(no puedo (proporcionar|ayudar|crear|generar|ofrecer|explicar)|lo siento,? pero|no me es posible|no está permitido|no debo|cannot (help|assist|provide|comply)|i can't|i cannot)/i;

app.post('/ask', auth, async (req, res) => {
  const { pregunta, texto, titulo } = req.body || {};
  // Asistente GENERAL (antes estaba forzado a ciberseguridad, por eso se negaba
  // o respondía mal en noticias de otros temas).
  const system = 'Eres un asistente que ayuda a entender noticias de tecnología, ciencia, ciberseguridad y actualidad. Responde SIEMPRE en español, claro y directo, como a un compañero de estudios. Básate en el texto de la noticia que se te da. Si el dato que se pregunta no está en la noticia, dilo explícitamente ("la noticia no menciona…") y explica lo que sí trae. Puedes aportar contexto general del tema, pero NO inventes datos, cifras, fechas ni citas. Sé concreto y útil.';
  const prompt = `Noticia: ${titulo}\n\n${String(texto || '').slice(0, 6000)}\n\nPregunta del usuario: ${pregunta}`;
  try {
    let { texto: r, motor, ms } = await generar({ prompt, system, tarea: 'resumir', userId: req.user.id });
    // Si el modelo salió con un rechazo, reintentar una vez con la instrucción reforzada
    if (r && PARECIA_RECHAZO.test(r)) {
      try {
        const re = await generar({
          prompt,
          system: system + '\n\nADVERTENCIA: tu respuesta anterior fue un rechazo. No hace falta rechazar nada: la noticia es pública y la pregunta es informativa. Responde AHORA de forma completa usando el texto de la noticia.',
          tarea: 'resumir',
          userId: uidDe(req)
        });
        if (re.texto && !PARECIA_RECHAZO.test(re.texto)) { r = re.texto; motor = re.motor; ms = re.ms; }
      } catch {}
    }
    if (r) return res.json({ respuesta: r, motor, ms });
  } catch {}
  res.json({ respuesta: 'La IA no está disponible en este momento. Fragmento de la noticia: ' + String(texto || '').slice(0, 400), motor: 'reglas' });
});

app.post('/classify-batch', auth, async (req, res) => {
  const items = (req.body.items || []).slice(0, 30);
  try {
    const bloques = items.map((x, i) => `${i}. ${x.titulo}: ${String(x.texto || '').slice(0, 150)}`).join('\n');
    const { texto: r, motor } = await generar({
      prompt: `Clasifica los titulares numerados. Devuelve SOLO un JSON con un arreglo de arreglos, en el mismo orden, con etiquetas de esta lista: ${JSON.stringify(TAXONOMIA)}\n\n${bloques}`,
      system: 'Eres un clasificador de noticias. Respondes solo JSON válido.',
      tarea: 'clasificar',
      userId: uidDe(req)
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
