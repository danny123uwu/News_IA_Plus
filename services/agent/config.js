'use strict';
// ============================================================================
//  config.js — configuración de IA por usuario (data/ia.json)
//
//  Solo se ocupa de leer/validar/guardar preferencias. No habla con Ollama ni
//  con proveedores externos: eso vive en ai/*.js. Así la lógica de negocio y
//  la del modelo quedan separadas.
// ============================================================================

const fs = require('fs');
const path = require('path');

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

let cache = null;
let cacheMtime = 0;

function leerConfigs() {
  try {
    const st = fs.statSync(CONFIG_FILE);
    if (cache && st.mtimeMs === cacheMtime) return cache;
    const datos = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    cache = datos && typeof datos === 'object' ? datos : {};
    cacheMtime = st.mtimeMs;
    return cache;
  } catch {
    cache = {};
    cacheMtime = 0;
    return cache;
  }
}

function guardarConfigs(todas) {
  const dir = path.dirname(CONFIG_FILE);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporal = CONFIG_FILE + '.tmp';
  // Escritura atómica + permisos 600: las API keys no quedan legibles por otros.
  fs.writeFileSync(temporal, JSON.stringify(todas, null, 2), { mode: 0o600 });
  fs.renameSync(temporal, CONFIG_FILE);
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch {}
  cache = todas;
  try { cacheMtime = fs.statSync(CONFIG_FILE).mtimeMs; } catch { cacheMtime = 0; }
}

function getConfig(id) {
  const c = leerConfigs()['u' + id] || {};
  const cfg = {
    ...CONFIG_DEFECTO, ...c,
    modelos: { ...CONFIG_DEFECTO.modelos, ...(c.modelos || {}) },
    api: { ...CONFIG_DEFECTO.api, ...(c.api || {}) }
  };
  // Google retira modelos cada tanto (ej: gemini-2.0-flash ya no existe).
  if (cfg.api.proveedor === 'gemini' && /^gemini-(1\.|2\.0)/i.test(cfg.api.modelo || '')) {
    cfg.api.modelo = PROVEEDORES.gemini.modelo;
  }
  return cfg;
}

function sanearBaseUrl(valor) {
  const s = String(valor || '').trim().slice(0, 300);
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (u.username || u.password) return '';
    return (u.origin + u.pathname).replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function setConfig(id, c) {
  const cfg = getConfig(id);
  if (c.motor === 'local' || c.motor === 'api') cfg.motor = c.motor;
  if (c.traduccion === 'google' || c.traduccion === 'motor') cfg.traduccion = c.traduccion;
  if (typeof c.respaldoLocal === 'boolean') cfg.respaldoLocal = c.respaldoLocal;
  if (c.modelos && typeof c.modelos === 'object') {
    if (typeof c.modelos.clasificar === 'string') cfg.modelos.clasificar = c.modelos.clasificar.slice(0, 120);
    if (typeof c.modelos.resumir === 'string') cfg.modelos.resumir = c.modelos.resumir.slice(0, 120);
  }
  if (c.api && typeof c.api === 'object') {
    cfg.api = combinarApi(cfg.api, c.api);
  }
  const todas = leerConfigs();
  todas['u' + id] = cfg;
  guardarConfigs(todas);
  return cfg;
}

// Nunca enviar la clave guardada de un proveedor a otro dominio/proveedor.
// Un campo vacío conserva la clave solo si el destino sigue siendo el mismo.
function combinarApi(base, cambios = {}) {
  const proveedor = cambios.proveedor || base.proveedor;
  if (!Object.hasOwn(PROVEEDORES, proveedor)) throw new Error('Proveedor de API inválido');
  const cambioProveedor = proveedor !== base.proveedor;
  const defecto = PROVEEDORES[proveedor];
  const baseUrl = typeof cambios.baseUrl === 'string'
    ? sanearBaseUrl(cambios.baseUrl)
    : (cambioProveedor ? defecto.url : base.baseUrl);
  const origen = (url) => { try { return new URL(url).origin; } catch { return ''; } };
  const cambioDestino = origen(baseUrl || defecto.url) !== origen(base.baseUrl || PROVEEDORES[base.proveedor]?.url);
  return {
    ...base, proveedor, baseUrl,
    modelo: typeof cambios.modelo === 'string' ? cambios.modelo.trim().slice(0, 120)
      : (cambioProveedor ? defecto.modelo : base.modelo),
    key: typeof cambios.key === 'string' && cambios.key.trim()
      ? cambios.key.trim().slice(0, 400)
      : (cambioProveedor || cambioDestino ? '' : base.key)
  };
}

function configVisible(cfg) {
  const api = {
    ...cfg.api,
    key: '',
    keyGuardada: Boolean(cfg.api.key),
    keyFinal: cfg.api.key ? '••••' + cfg.api.key.slice(-4) : ''
  };
  return { ...cfg, api };
}

module.exports = {
  CONFIG_FILE,
  CONFIG_DEFECTO,
  PROVEEDORES,
  getConfig,
  setConfig,
  configVisible,
  combinarApi,
  sanearBaseUrl
};
