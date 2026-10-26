'use strict';
// ============================================================================
//  ollama.js — cliente del motor local
//
//  · caché corta de /api/tags (el healthcheck no despierta la GPU cada 10 s)
//  · cola con concurrencia limitada: OLLAMA_NUM_PARALLEL=1 evita que varias
//    peticiones compitan por la misma GPU/RAM
//  · opciones de inferencia ajustables (num_batch, num_ctx, num_predict,
//    keep_alive). Un num_predict corto para clasificar reduce tiempo y VRAM.
// ============================================================================

const { entero, texto } = require('../../shared/env');
const { elegirAutomatico } = require('./models');

const OLLAMA = texto('OLLAMA_URL', 'http://localhost:11434');
const KEEP_ALIVE = texto('OLLAMA_KEEP_ALIVE', '30s');
const TIMEOUT_MS = entero('OLLAMA_TIMEOUT_MS', 180000, { min: 10000, max: 1800000 });
const CONCURRENCIA = entero('OLLAMA_NUM_PARALLEL', 1, { min: 1, max: 8 });
const MAX_COLA = entero('OLLAMA_MAX_QUEUE', 32, { min: 1, max: 512 });

const OPCIONES_BASE = {
  num_ctx: entero('OLLAMA_NUM_CTX', 4096, { min: 512, max: 32768 }),
  num_batch: entero('OLLAMA_NUM_BATCH', 128, { min: 1, max: 1024 }),
  num_thread: entero('OLLAMA_NUM_THREAD', 0, { min: 0, max: 64 }),
  num_gpu: entero('OLLAMA_NUM_GPU', -1, { min: -1, max: 999 })
};

const NUM_PREDICT = {
  clasificar: entero('OLLAMA_NUM_PREDICT_CLASIFICAR', 160, { min: 16, max: 2048 }),
  resumir: entero('OLLAMA_NUM_PREDICT', 700, { min: 64, max: 4096 })
};

let etiquetas = { at: 0, modelos: [], ok: false };
let auto = { clasificar: null, resumir: null };
let autoLista = '';

function invalidar() {
  etiquetas = { at: 0, modelos: [], ok: false };
  auto = { clasificar: null, resumir: null };
  autoLista = '';
}

// La elección automática se recalcula si cambió la lista de modelos instalados.
// Así, si el usuario descarga un modelo mejor (por ejemplo llama3.2:3b) con el
// servicio ya corriendo, la próxima respuesta lo usa sin reiniciar nada.
function sincronizarAuto() {
  const lista = etiquetas.modelos.map((m) => m.name).sort().join(',');
  if (lista === autoLista) return;
  autoLista = lista;
  auto = { clasificar: null, resumir: null };
}

async function leerTags({ forzar = false } = {}) {
  const ahora = Date.now();
  if (!forzar && etiquetas.at && ahora - etiquetas.at < 5000) return etiquetas;
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const modelos = (d.models || [])
      .map((m) => ({ name: m.name, size: m.size || 0, gb: +((m.size || 0) / 1e9).toFixed(1) }))
      .filter((m) => !/embed/i.test(m.name));
    etiquetas = { at: ahora, modelos, ok: modelos.length > 0 };
    return etiquetas;
  } catch {
    etiquetas = { at: ahora, modelos: [], ok: false };
    return etiquetas;
  }
}

async function listarModelos() {
  return (await leerTags()).modelos;
}

async function disponible() {
  return (await leerTags()).ok;
}

function modeloPara(tarea, preferido) {
  if (preferido) return preferido;
  sincronizarAuto();
  if (!auto[tarea]) auto[tarea] = elegirAutomatico(etiquetas.modelos, tarea);
  return auto[tarea] || etiquetas.modelos[0]?.name || null;
}

// ---------------------------------------------------------------------------
//  Cola FIFO con concurrencia limitada.
// ---------------------------------------------------------------------------
const pendientes = [];
let activos = 0;

function enCola(tarea, prioridad = 0) {
  return new Promise((resolve, reject) => {
    if (pendientes.length >= MAX_COLA) {
      const e = new Error('La IA local está ocupada. Probá de nuevo en unos segundos.');
      e.codigo = 'cola_llena';
      return reject(e);
    }
    const trabajo = { tarea, resolve, reject, prioridad };
    // Prioridad 0 = pedido del usuario (resumen/pregunta); 1 = trabajo de
    // fondo (clasificar/traducir). Se inserta delante de los de menor
    // prioridad, manteniendo el orden de llegada entre iguales.
    let i = pendientes.length;
    while (i > 0 && (pendientes[i - 1].prioridad || 0) > prioridad) i--;
    pendientes.splice(i, 0, trabajo);
    siguiente();
  });
}

function siguiente() {
  while (activos < CONCURRENCIA && pendientes.length) {
    const trabajo = pendientes.shift();
    activos++;
    Promise.resolve()
      .then(trabajo.tarea)
      .then(trabajo.resolve, trabajo.reject)
      .finally(() => { activos--; siguiente(); });
  }
}

async function preguntar({ prompt, system, modelo, tarea = 'resumir', prioridad = 0 }) {
  const elegido = modeloPara(tarea, modelo);
  if (!elegido) throw new Error('No hay ningún modelo local instalado');

  const opciones = {
    temperature: tarea === 'clasificar' ? 0.1 : 0.3,
    num_ctx: OPCIONES_BASE.num_ctx,
    num_batch: OPCIONES_BASE.num_batch,
    num_predict: NUM_PREDICT[tarea] || NUM_PREDICT.resumir
  };
  if (OPCIONES_BASE.num_thread > 0) opciones.num_thread = OPCIONES_BASE.num_thread;
  if (OPCIONES_BASE.num_gpu >= 0) opciones.num_gpu = OPCIONES_BASE.num_gpu;

  return enCola(async () => {
    const r = await fetch(OLLAMA + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: elegido,
        prompt,
        system,
        stream: false,
        think: false,
        keep_alive: KEEP_ALIVE,
        options: opciones
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('Ollama ' + r.status + (t ? ' — ' + t.slice(0, 120) : ''));
    }
    const d = await r.json();
    return String(d.response || '').trim();
  }, prioridad);
}

// Descarga un modelo. No pasa por la cola de inferencia (puede tardar mucho),
// pero el llamador debe impedir dos descargas simultáneas.
async function jalarModelo(name) {
  const r = await fetch(OLLAMA + '/api/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stream: false }),
    signal: AbortSignal.timeout(1800000)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const e = new Error('Ollama ' + r.status + (t ? ' — ' + t.slice(0, 160) : ''));
    e.status = 502;
    throw e;
  }
  await r.json().catch(() => ({}));
  invalidar();
  await leerTags({ forzar: true });
}

function estado() {
  return {
    ia_local: etiquetas.ok,
    modelo: etiquetas.ok ? modeloPara('clasificar') : null,
    modelo_texto: etiquetas.ok ? modeloPara('resumir') : null
  };
}

module.exports = {
  OLLAMA,
  KEEP_ALIVE,
  listarModelos,
  disponible,
  preguntar,
  jalarModelo,
  invalidar,
  estado,
  modeloPara
};
