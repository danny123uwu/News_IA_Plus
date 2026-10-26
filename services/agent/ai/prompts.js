'use strict';
// Construcción de prompts. Separado de las rutas HTTP y del cliente del modelo.

const { TAXONOMIA, recortar } = require('./rules');

function clasificar({ titulo, texto }) {
  return {
    system: 'Eres un clasificador de noticias. Respondes solo JSON válido, por ejemplo ["Economía"]. Máximo 3 etiquetas.',
    prompt: `Clasifica esta noticia. Responde SOLO con un JSON: un arreglo con entre 1 y 3 etiquetas, copiadas tal cual de esta lista (no inventes ni repitas la lista entera): ${JSON.stringify(TAXONOMIA)}.\n\nTítulo: ${recortar(titulo, 500)}\nTexto: ${recortar(texto, 1200)}`
  };
}

function clasificarLote(items) {
  const bloques = items.map((x, i) =>
    `${i}. ${recortar(x.titulo, 300)}: ${recortar(x.texto, 400)}`
  ).join('\n');
  return {
    system: 'Eres un clasificador de noticias. Respondes solo JSON válido.',
    prompt: `Clasifica los titulares numerados. Devuelve SOLO un JSON con un arreglo de arreglos, en el mismo orden, con etiquetas de esta lista: ${JSON.stringify(TAXONOMIA)}\n\n${bloques}`
  };
}

function resumir({ titulo, texto }) {
  return {
    system: 'Eres un periodista experto que resume con precisión, claridad y neutralidad en español. Nunca inventas datos que no estén en el texto.',
    prompt: `Resume esta noticia en español, con detalle y sin inventar nada.\n` +
      `Formato obligatorio:\n` +
      `1) Un párrafo de entrada (2-3 frases) que explique de qué trata.\n` +
      `2) La línea "Puntos clave:" y debajo entre 3 y 6 viñetas que empiecen con "- ", con los datos concretos: nombres propios, cifras, versiones, fechas, nombres de errores, pasos o consecuencias.\n` +
      `Debe quedar claro qué pasó, quién participa, cuándo, por qué importa y cómo afecta al usuario. No repitas la introducción en las viñetas.\n\n` +
      `Título original: ${recortar(titulo, 500)}\n\n${recortar(texto, 6000)}`
  };
}

function digest(articulos) {
  const bloques = articulos.map((a, i) =>
    `${i + 1}. [${recortar(a.fuente, 120)}] ${recortar(a.titulo, 300)}\n${recortar(a.contenido, 400)}`
  ).join('\n\n');
  return {
    system: 'Eres un editor de noticias conciso.',
    prompt: `Este es lo publicado hoy. Escribe un digest "Lo importante de hoy": máximo 6 bullets cortos en español, agrupando lo que sea del mismo tema:\n\n${bloques}`
  };
}

function preguntar({ titulo, texto, pregunta }) {
  const system = 'Eres un asistente que ayuda a entender noticias de tecnología, ciencia, ciberseguridad y actualidad. Responde SIEMPRE en español, claro y directo, como a un compañero de estudios. Básate en el texto de la noticia que se te da. Si el dato que se pregunta no está en la noticia, dilo explícitamente ("la noticia no menciona…") y explica lo que sí trae. Puedes aportar contexto general del tema, pero NO inventes datos, cifras, fechas ni citas. Sé concreto y útil.';
  const prompt = `Noticia: ${recortar(titulo, 500)}\n\n${recortar(texto, 6000)}\n\nPregunta del usuario: ${recortar(pregunta, 2000)}`;
  return { system, prompt };
}

function reintentoPregunta(system, prompt) {
  return {
    system: system + '\n\nADVERTENCIA: tu respuesta anterior fue un rechazo. No hace falta rechazar nada: la noticia es pública y la pregunta es informativa. Responde AHORA de forma completa usando el texto de la noticia.',
    prompt
  };
}

module.exports = { clasificar, clasificarLote, resumir, digest, preguntar, reintentoPregunta };
