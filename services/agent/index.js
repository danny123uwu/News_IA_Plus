'use strict';
// ============================================================================
//  Agente IA — capa HTTP y de negocio
//
//  Este archivo solo conoce rutas, autenticación y validación de entrada.
//  La IA vive en ./ai (Ollama, proveedores, prompts, reglas y traducción) y
//  las preferencias del usuario en ./config.js.
// ============================================================================

const express = require('express');
const jwt = require('jsonwebtoken');
const { resolverSecreto, entero } = require('../shared/env');
const {
  cabecerasSeguridad, corsPortal, crearLimitador, recortar
} = require('../shared/http');

const { getConfig, setConfig, configVisible, PROVEEDORES, sanearBaseUrl } = require('./config');
const { listarModelos, disponible, jalarModelo, estado } = require('./ai/ollama');
const { RECOMENDADOS, NOMBRE_MODELO, recomendar } = require('./ai/models');
const { listarModelosApi } = require('./ai/providers');
const { TAXONOMIA, clasificarPorReglas, resumenExtractivo, recortarFrases, PARECIA_RECHAZO } = require('./ai/rules');
const { generar } = require('./ai/engine');
const { traducirPar, traducirBloques } = require('./ai/translate');
const prompts = require('./ai/prompts');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', entero('TRUST_PROXY', 1, { min: 0, max: 5 }));
app.use(cabecerasSeguridad);
app.use(corsPortal());
app.use(express.json({ limit: '1mb' }));

const SECRET = resolverSecreto();

function auth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').split(' ')[1];
    req.user = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// El servicio de feeds trabaja en segundo plano con un token de servicio
// (id 0). Solo ese rol puede indicar a qué usuario pertenecen los datos.
function uidDe(req) {
  const b = req.body || {};
  if (req.user && req.user.rol === 'servicio' && b.userId != null && b.userId !== '') {
    const n = Number(b.userId);
    if (Number.isFinite(n)) return n;
  }
  return req.user.id;
}

const porUsuario = (req) => 'u' + (req.user ? req.user.id : (req.ip || 'anon'));
const limiteGeneral = crearLimitador({
  ventanaMs: 60000, maximo: entero('RATE_AGENTE_MIN', 120, { min: 10, max: 2000 }), clave: porUsuario,
  mensaje: 'Demasiadas peticiones a la IA. Esperá un momento.'
});
const limiteCaro = crearLimitador({
  ventanaMs: 60000, maximo: entero('RATE_AGENTE_CARO_MIN', 24, { min: 2, max: 500 }), clave: porUsuario,
  mensaje: 'Estás usando la IA muy seguido. Esperá un minuto.'
});
const limitePrueba = crearLimitador({
  ventanaMs: 300000, maximo: 12, clave: porUsuario,
  mensaje: 'Demasiadas pruebas de configuración. Esperá unos minutos.'
});
const limiteDescarga = crearLimitador({
  ventanaMs: 600000, maximo: 3, clave: porUsuario,
  mensaje: 'Ya se está descargando un modelo. Esperá a que termine.'
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

app.get('/health', async (req, res) => {
  await disponible();
  res.json({ ok: true, servicio: 'agente', ...estado() });
});

app.get('/config', auth, limiteGeneral, async (req, res) => respuestaConfig(res, req.user.id));

// Descarga un modelo en Ollama. Solo una descarga a la vez.
let descargando = null;
app.post('/model/pull', auth, limiteGeneral, limiteDescarga, async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  if (!name || name.length > 120 || !NOMBRE_MODELO.test(name)) {
    return res.status(400).json({ error: 'Nombre de modelo inválido' });
  }
  if (descargando) return res.status(409).json({ error: 'Ya se está descargando "' + descargando + '"' });
  descargando = name;
  try {
    await jalarModelo(name);
    res.json({ ok: true, name });
  } catch (e) {
    res.status(e.status || 502).json({ error: 'No se pudo descargar: ' + e.message });
  } finally {
    descargando = null;
  }
});

app.put('/config', auth, limiteGeneral, async (req, res) => {
  try {
    setConfig(req.user.id, req.body || {});
    await respuestaConfig(res, req.user.id);
  } catch (e) {
    res.status(500).json({ error: 'No se pudo guardar: ' + e.message });
  }
});

function configDePrueba(base, b) {
  const cfg = {
    ...base,
    modelos: { ...base.modelos, ...(b.modelos && typeof b.modelos === 'object' ? b.modelos : {}) },
    api: { ...base.api }
  };
  if (b.motor === 'local' || b.motor === 'api') cfg.motor = b.motor;
  if (b.api && typeof b.api === 'object') {
    if (typeof b.api.proveedor === 'string' && b.api.proveedor) cfg.api.proveedor = b.api.proveedor;
    if (typeof b.api.baseUrl === 'string') cfg.api.baseUrl = sanearBaseUrl(b.api.baseUrl);
    if (typeof b.api.modelo === 'string') cfg.api.modelo = b.api.modelo.trim().slice(0, 120);
    if (typeof b.api.key === 'string' && b.api.key.trim()) cfg.api.key = b.api.key.trim().slice(0, 400);
  }
  cfg.modelos.clasificar = recortar(cfg.modelos.clasificar, 120);
  cfg.modelos.resumir = recortar(cfg.modelos.resumir, 120);
  return cfg;
}

app.post('/config/test', auth, limiteGeneral, limitePrueba, async (req, res) => {
  const t0 = Date.now();
  const b = req.body || {};
  const cfg = configDePrueba(getConfig(uidDe(req)), b);
  try {
    const { texto, motor, ms } = await generar({
      prompt: 'Responde con exactamente una palabra: LISTO',
      system: 'Contesta con una sola palabra, sin puntuación.',
      tarea: 'resumir',
      cfg
    });
    res.json({ ok: true, motor, ms: ms || Date.now() - t0, respuesta: String(texto).slice(0, 120) });
  } catch (e) {
    res.status(502).json({ error: e.message, ms: Date.now() - t0 });
  }
});

app.post('/config/models', auth, limiteGeneral, limitePrueba, async (req, res) => {
  const b = req.body || {};
  const guardada = getConfig(req.user.id).api;
  const baseUrl = sanearBaseUrl(b.baseUrl || guardada.baseUrl || '');
  const key = (b.key && String(b.key).trim().slice(0, 400)) || guardada.key;
  const proveedor = b.proveedor || guardada.proveedor;
  if (proveedor !== 'gemini' && !baseUrl) return res.status(400).json({ error: 'Falta la URL base de la API' });
  if (!key) return res.status(400).json({ error: 'Falta la API key' });
  try {
    let modelos = await listarModelosApi(baseUrl, key, proveedor);
    modelos = modelos
      .filter((id) => !/embed|embedding|aqa|imagen|image-generation|veo|tts|whisper|moderation/i.test(id))
      .sort()
      .slice(0, 300);
    res.json({ proveedor, modelos });
  } catch (e) {
    res.status(502).json({ error: 'No se pudieron leer los modelos: ' + e.message });
  }
});

// ---------- TRADUCCIÓN ----------
app.post('/spanish', auth, limiteGeneral, async (req, res) => {
  const { titulo, texto, modo } = req.body || {};
  const origTitulo = recortar(titulo, 500);
  const origTexto = recortar(texto, 20000);
  if (!origTitulo && !origTexto) return res.status(400).json({ error: 'Falta el texto' });

  const cfg = getConfig(uidDe(req));
  try {
    const par = await traducirPar({ titulo: origTitulo, texto: origTexto, modo, cfg });
    const maxResumen = modo === 'completo' ? 4000 : 700;
    if (par.proveedor === 'original') {
      return res.json({
        titulo: origTitulo,
        resumen: recortarFrases(origTexto, maxResumen),
        texto: recortarFrases(origTexto, 4000),
        idioma: 'es',
        proveedor: 'original'
      });
    }
    res.json({
      titulo: par.titulo || origTitulo,
      resumen: recortarFrases(par.texto, maxResumen),
      texto: par.texto,
      idioma: 'es',
      proveedor: par.proveedor
    });
  } catch (e) {
    res.status(502).json({ error: 'No se pudo traducir: ' + e.message });
  }
});

app.post('/spanish/bloques', auth, limiteGeneral, async (req, res) => {
  const brutos = Array.isArray(req.body && req.body.textos) ? req.body.textos : [];
  const textos = brutos.slice(0, 40).map((t) => recortar(t, 2500));
  const total = textos.reduce((n, t) => n + t.length, 0);
  if (total > 60000) return res.status(413).json({ error: 'El texto es demasiado grande para traducir de una vez' });
  if (!textos.length) return res.json({ traducciones: [] });
  const traducciones = await traducirBloques(textos);
  res.json({ traducciones });
});

// ---------- CLASIFICACIÓN ----------
app.post('/classify', auth, limiteGeneral, async (req, res) => {
  const { titulo, texto } = req.body || {};
  const t = recortar(titulo, 500);
  const x = recortar(texto, 4000);
  try {
    const { texto: r, motor } = await generar({
      ...prompts.clasificar({ titulo: t, texto: x }),
      tarea: 'clasificar',
      cfg: getConfig(uidDe(req))
    });
    const m = r.match(/\[[\s\S]*?\]/);
    if (m) {
      const tags = JSON.parse(m[0]).filter((tag) => TAXONOMIA.includes(tag)).slice(0, 3);
      if (tags.length) return res.json({ etiquetas: tags, motor });
    }
  } catch {}
  res.json({ etiquetas: clasificarPorReglas(t, x), motor: 'reglas' });
});

app.post('/classify-batch', auth, limiteGeneral, async (req, res) => {
  const entrada = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  const items = entrada.slice(0, 30).filter((x) => x && typeof x === 'object').map((x) => ({
    id: x.id,
    titulo: recortar(x.titulo, 300),
    texto: recortar(x.texto, 1500)
  }));
  if (!items.length) return res.json({ resultados: [], motor: 'reglas' });
  try {
    const { texto: r, motor } = await generar({
      ...prompts.clasificarLote(items),
      tarea: 'clasificar',
      cfg: getConfig(uidDe(req))
    });
    const m = r.match(/\[[\s\S]*\]/);
    if (m) {
      const arr = JSON.parse(m[0]);
      const resultados = items.map((x, i) => ({
        id: x.id,
        etiquetas: [...new Set((Array.isArray(arr[i]) ? arr[i] : []).filter((tag) => TAXONOMIA.includes(tag)))].slice(0, 4)
      }));
      if (resultados.some((x) => x.etiquetas.length)) return res.json({ resultados, motor });
    }
  } catch {}
  res.json({
    resultados: items.map((x) => ({ id: x.id, etiquetas: clasificarPorReglas(x.titulo, x.texto) })),
    motor: 'reglas'
  });
});

// ---------- RESUMEN / DIGEST / PREGUNTAS ----------
app.post('/summarize', auth, limiteGeneral, limiteCaro, async (req, res) => {
  const { titulo, texto } = req.body || {};
  try {
    const { texto: r, motor, ms } = await generar({
      ...prompts.resumir({ titulo: recortar(titulo, 500), texto: recortar(texto, 20000) }),
      tarea: 'resumir',
      cfg: getConfig(uidDe(req))
    });
    if (r) return res.json({ resumen: r, motor, ms });
  } catch {}
  res.json({ resumen: resumenExtractivo(recortar(texto, 20000)), motor: 'reglas' });
});

app.post('/digest', auth, limiteGeneral, limiteCaro, async (req, res) => {
  const entrada = Array.isArray(req.body && req.body.articulos) ? req.body.articulos : [];
  const lista = entrada.slice(0, 20).filter((a) => a && typeof a === 'object').map((a) => ({
    fuente: recortar(a.fuente, 120),
    titulo: recortar(a.titulo, 300),
    contenido: recortar(a.contenido, 800)
  }));
  if (!lista.length) return res.json({ digest: 'No hay noticias nuevas en las últimas 24 horas.' });
  try {
    const { texto: r, motor, ms } = await generar({
      ...prompts.digest(lista),
      tarea: 'resumir',
      cfg: getConfig(uidDe(req))
    });
    if (r) return res.json({ digest: r, motor, ms });
  } catch {}
  const resumen = lista.slice(0, 6).map((a) => '• ' + a.titulo + (a.fuente ? ' — ' + a.fuente : '')).join('\n');
  res.json({ digest: 'Lo importante de hoy:\n' + resumen, motor: 'reglas' });
});

app.post('/ask', auth, limiteGeneral, limiteCaro, async (req, res) => {
  const { pregunta, texto, titulo } = req.body || {};
  const p = prompts.preguntar({
    titulo: recortar(titulo, 500),
    texto: recortar(texto, 20000),
    pregunta: recortar(pregunta, 2000)
  });
  const cfg = getConfig(uidDe(req));
  try {
    let { texto: r, motor, ms } = await generar({ ...p, tarea: 'resumir', cfg });
    if (r && PARECIA_RECHAZO.test(r)) {
      try {
        const re = await generar({ ...prompts.reintentoPregunta(p.system, p.prompt), tarea: 'resumir', cfg });
        if (re.texto && !PARECIA_RECHAZO.test(re.texto)) { r = re.texto; motor = re.motor; ms = re.ms; }
      } catch {}
    }
    if (r) return res.json({ respuesta: r, motor, ms });
  } catch {}
  res.json({
    respuesta: 'La IA no está disponible en este momento. Fragmento de la noticia: ' + recortar(texto, 400),
    motor: 'reglas'
  });
});

// Errores de JSON/body demasiado grande sin filtrar trazas internas.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'La petición es demasiado grande' });
  }
  if (err && (err instanceof SyntaxError || err.status === 400)) {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  console.error('[agente] error:', err && err.message);
  res.status(500).json({ error: 'Error interno del agente' });
});

app.listen(3003, () => console.log('[agente] microservicio en :3003'));

module.exports = { app };
