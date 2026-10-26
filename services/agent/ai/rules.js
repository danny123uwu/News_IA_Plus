'use strict';
// Reglas y utilidades de texto que NO dependen de ningún modelo.
// Se usan como respaldo cuando la IA no está disponible y para acotar textos.

const { TAXONOMIA, clasificarPorReglas } = require('../../shared/taxonomia');

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

function recortar(texto, max) {
  return String(texto == null ? '' : texto).slice(0, max);
}

const PARECIA_RECHAZO = /(no puedo (proporcionar|ayudar|crear|generar|ofrecer|explicar)|lo siento,? pero|no me es posible|no está permitido|no debo|cannot (help|assist|provide|comply)|i can't|i cannot)/i;

// Un modelo chico a veces se traba repitiendo la misma frase hasta agotar los
// tokens. Detectamos eso para no mostrar basura repetida.
function textoEnBucle(t) {
  const s = String(t || '').trim();
  if (s.length < 300) return false;
  const palabras = s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (palabras.length < 120) return false;
  return (new Set(palabras).size / palabras.length) < 0.22;
}

module.exports = {
  TAXONOMIA,
  clasificarPorReglas,
  resumenExtractivo,
  recortarFrases,
  recortar,
  PARECIA_RECHAZO,
  textoEnBucle
};
