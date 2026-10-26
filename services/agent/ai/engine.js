'use strict';
// ============================================================================
//  engine.js — punto único de generación de texto
//
//  Decide entre API externa y modelo local respetando la configuración del
//  usuario. REGLA CLAVE: si el motor es "API externa", el modelo local NO se
//  toca (no se carga en la GPU) salvo que el usuario active "respaldo local".
// ============================================================================

const { apiExterna } = require('./providers');
const { disponible, preguntar, modeloPara } = require('./ollama');

function apiLista(cfg) {
  return Boolean(cfg.api.key && (cfg.api.baseUrl || cfg.api.proveedor === 'gemini'));
}

async function generar({ prompt, system, tarea = 'resumir', cfg }) {
  if (!cfg) throw new Error('Falta la configuración de IA');
  let errorApi = null;

  if (cfg.motor === 'api') {
    if (!apiLista(cfg)) throw new Error('Falta la API key (o la URL) del proveedor externo');
    const t0 = Date.now();
    try {
      const texto = await apiExterna(cfg.api, prompt, system);
      return { texto, motor: 'api:' + cfg.api.proveedor + (cfg.api.modelo ? ':' + cfg.api.modelo : ''), ms: Date.now() - t0 };
    } catch (e) {
      errorApi = e;
      // La IA local solo entra si el usuario la habilitó como respaldo.
      if (cfg.respaldoLocal !== true || !(await disponible())) throw e;
    }
  }

  if (await disponible()) {
    const preferido = (cfg.modelos || {})[tarea];
    const modelo = modeloPara(tarea, preferido);
    const t0 = Date.now();
    try {
      const texto = await preguntar({ prompt, system, modelo, tarea });
      return { texto, motor: 'ollama:' + modelo, ms: Date.now() - t0 };
    } catch (e) {
      if (errorApi) throw new Error(errorApi.message + ' | local: ' + e.message);
      throw e;
    }
  }

  throw errorApi || new Error('Sin motor de IA disponible (Ollama apagado y sin API externa)');
}

module.exports = { generar, apiLista };
