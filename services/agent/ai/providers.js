'use strict';
// ============================================================================
//  providers.js — APIs externas compatibles con OpenAI + Gemini nativo
//
//  No conoce usuarios ni rutas HTTP: recibe la configuración `api` y devuelve
//  texto. La URL base se valida contra SSRF antes de cada llamada.
// ============================================================================

const { leerJsonLimitado } = require('../../shared/http');
const { validarUrlPublica } = require('../../shared/url-segura');
const { PROVEEDORES } = require('../config');

const TIMEOUT_MS = 90000;

async function geminiNativo(api, prompt, system) {
  const model = String(api.modelo || '').replace(/^models\//, '').trim();
  if (!model) throw new Error('Elegí un modelo de Gemini (botón "🔄 Ver modelos")');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(api.key);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 }
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    if (r.status === 404) {
      throw new Error('el modelo "' + model + '" no está disponible con tu key. Pulsá "🔄 Ver modelos" y elegí otro.');
    }
    throw new Error('Gemini ' + r.status + (t ? ' — ' + t.slice(0, 160) : ''));
  }
  const d = await leerJsonLimitado(r, 2 * 1024 * 1024);
  const cand = d && d.candidates && d.candidates[0];
  const txt = cand && cand.content && cand.content.parts
    ? cand.content.parts.map((p) => p.text || '').join('')
    : '';
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
  // Impide que una URL "personalizada" apunte a localhost o a la red interna.
  await validarUrlPublica(base);
  const r = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + api.key },
    body: JSON.stringify({
      model: api.modelo,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      temperature: 0.3
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    if (r.status === 404) {
      throw new Error('el modelo "' + (api.modelo || '(vacío)') + '" no existe o ya no está disponible. En ⚙️ IA, pulsá "🔄 Ver modelos" y elegí uno de la lista.');
    }
    throw new Error('API ' + r.status + (t ? ' — ' + t.slice(0, 140) : ''));
  }
  const d = await leerJsonLimitado(r, 4 * 1024 * 1024);
  const txt = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
  if (!txt) throw new Error('API sin respuesta');
  return String(txt).trim();
}

async function listarModelosApi(baseUrl, key, proveedor) {
  if (proveedor === 'gemini') {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key), {
      signal: AbortSignal.timeout(20000)
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('API ' + r.status + (t ? ' — ' + t.slice(0, 140) : ''));
    }
    const d = await leerJsonLimitado(r, 2 * 1024 * 1024);
    return (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter(Boolean);
  }

  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Falta la URL base de la API');
  await validarUrlPublica(base);
  const r = await fetch(base + '/models', {
    headers: { Authorization: 'Bearer ' + key },
    signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error('API ' + r.status + (t ? ' — ' + t.slice(0, 140) : ''));
  }
  const d = await leerJsonLimitado(r, 2 * 1024 * 1024);
  const bruto = Array.isArray(d.data) ? d.data : (Array.isArray(d.models) ? d.models : []);
  return [...new Set(bruto.map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean))];
}

module.exports = { PROVEEDORES, geminiNativo, apiExterna, listarModelosApi };
