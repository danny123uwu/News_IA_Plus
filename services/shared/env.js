'use strict';
// ============================================================================
//  env.js — lectura segura de variables de entorno
//
//  Centraliza los valores numéricos/booleanos y la comprobación del secreto
//  JWT. Si el sistema corre en producción (NODE_ENV=production) con el secreto
//  de ejemplo, el proceso NO arranca: un JWT firmado con una clave conocida
//  permitiría entrar como cualquier usuario.
// ============================================================================

const SECRETO_DE_EJEMPLO = 'portal-ia-news-dev-secret';

function entero(nombre, porDefecto, { min = -Infinity, max = Infinity } = {}) {
  const n = Number.parseInt(process.env[nombre], 10);
  if (!Number.isFinite(n)) return porDefecto;
  return Math.max(min, Math.min(max, n));
}

function booleano(nombre, porDefecto = false) {
  const v = String(process.env[nombre] || '').toLowerCase().trim();
  if (['1', 'true', 'si', 'sí', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return porDefecto;
}

function texto(nombre, porDefecto = '') {
  const v = process.env[nombre];
  return v == null || String(v).trim() === '' ? porDefecto : String(v).trim();
}

function resolverSecreto() {
  const secreto = texto('JWT_SECRET', '');
  const inseguro = !secreto || secreto === SECRETO_DE_EJEMPLO || secreto.length < 32;
  if (inseguro && process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET no es seguro. Definí una clave aleatoria de al menos 32 caracteres ' +
      'en el archivo .env (por ejemplo: openssl rand -hex 32).'
    );
  }
  if (inseguro) {
    console.warn('[seguridad] JWT_SECRET débil o de ejemplo: solo válido para desarrollo local.');
  }
  return secreto || SECRETO_DE_EJEMPLO;
}

module.exports = { entero, booleano, texto, resolverSecreto, SECRETO_DE_EJEMPLO };
