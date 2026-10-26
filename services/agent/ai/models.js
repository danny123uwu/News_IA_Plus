'use strict';
// Modelos recomendados y elección automática según lo instalado.

const ORDEN_TEXTO = ['llama3.2:3b', 'llama3.1:8b', 'qwen3:8b', 'qwen2.5:3b', 'gemma2:2b', 'hermes3', 'hermes-libre', 'llama3.1', 'qwen2.5-coder:7b'];
const ORDEN_CLAS = ['qwen2.5-coder:3b', 'qwen2.5:3b', 'qwen2.5-coder:1.5b', 'llama3.2:3b', 'llama3.1:8b'];

// Todos son variantes ya cuantizadas (Q4_K_M / Q4_0) que publica Ollama:
// pesan ~2 GB y entran en GPUs de 2-4 GB. No hace falta convertir nada.
const RECOMENDADOS = [
  { name: 'llama3.2:3b', gb: 2.0, tarea: 'texto', nota: 'General: resumir, preguntar y digest. Español oficial. Cuantizado Q4.' },
  { name: 'qwen2.5:3b', gb: 1.9, tarea: 'clasificar', nota: 'Clasificar etiquetas: rápido y muy bueno en JSON. Cuantizado Q4.' },
  { name: 'gemma2:2b', gb: 1.6, tarea: 'texto', nota: 'Ultra liviano: para PCs con solo 2 GB de VRAM. Cuantizado Q4.' }
];

// "modelo" o "modelo:tag", admite namespace con / (ej: usuario/modelo:q4_K_M).
const NOMBRE_MODELO = /^(?!.*\.\.)[a-zA-Z0-9][a-zA-Z0-9._/-]*(:[a-zA-Z0-9._-]+)?$/;

function recomendar(modelos) {
  const validos = (modelos || []).filter((m) => m && !/embed/i.test(m.name));
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

function elegirAutomatico(modelos, tarea) {
  const nombres = (modelos || []).map((m) => m.name);
  if (tarea === 'clasificar') {
    return ORDEN_CLAS.find((m) => nombres.includes(m)) ||
      nombres.find((m) => /qwen|llama|hermes|gemma|phi/i.test(m)) || nombres[0] || null;
  }
  return ORDEN_TEXTO.find((m) => nombres.includes(m)) ||
    nombres.find((m) => /qwen|llama|hermes|gemma|phi/i.test(m)) || nombres[0] || null;
}

module.exports = { ORDEN_TEXTO, ORDEN_CLAS, RECOMENDADOS, NOMBRE_MODELO, recomendar, elegirAutomatico };
