'use strict';
// ============================================================================
//  providers.js — APIs compatibles con OpenAI + Gemini y Anthropic nativos
//
//  No conoce usuarios ni rutas HTTP: recibe la configuración `api` y devuelve
//  texto. La URL base se valida contra SSRF antes de cada llamada.
// ============================================================================

const { leerJsonLimitado } = require('../../shared/http');
const { validarUrlPublica } = require('../../shared/url-segura');
const { PROVEEDORES } = require('../config');

const TIMEOUT_MS = 90000;

function senalApi(signal, timeout = TIMEOUT_MS) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
}

async function errorApi(r, api) {
  let detalle = '';
  try {
    const d = await leerJsonLimitado(r, 64 * 1024);
    detalle = String(d.error?.message || d.message || '');
  } catch {}
  if (api.key) detalle = detalle.split(api.key).join('[clave oculta]');
  const motivo = {
    401: 'clave inválida o sin autorización',
    403: 'sin permisos para este recurso',
    404: 'modelo o dirección no disponible; consultá «Ver modelos»',
    429: 'cuota agotada o demasiadas solicitudes'
  }[r.status] || 'falló la solicitud';
  return new Error('API ' + r.status + ': ' + motivo + (detalle ? ' — ' + detalle.slice(0, 180) : ''));
}

async function anthropicNativo(api, prompt, system, signal) {
  const base = String(api.baseUrl || PROVEEDORES.anthropic.url).replace(/\/+$/, '');
  await validarUrlPublica(base);
  const r = await fetch(base + '/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': api.key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: api.modelo, max_tokens: 2048,
      system: system || undefined,
      messages: [{ role: 'user', content: prompt }]
    }),
    redirect: 'error', signal: senalApi(signal)
  });
  if (!r.ok) throw await errorApi(r, api);
  const d = await leerJsonLimitado(r, 4 * 1024 * 1024);
  const texto = (d.content || []).filter(p => p.type === 'text').map(p => p.text || '').join('').trim();
  if (!texto) throw new Error('Anthropic no devolvió texto');
  return texto;
}

async function geminiNativo(api, prompt, system, signal) {
  const model = String(api.modelo || '').replace(/^models\//, '').trim();
  if (!model) throw new Error('Elegí un modelo de Gemini (botón "🔄 Ver modelos")');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': api.key },
    body: JSON.stringify({
      system_instruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 }
    }),
    redirect: 'error', signal: senalApi(signal)
  });
  if (!r.ok) {
    throw await errorApi(r, api);
  }
  const d = await leerJsonLimitado(r, 2 * 1024 * 1024);
  const cand = d && d.candidates && d.candidates[0];
  const txt = cand && cand.content && cand.content.parts
    ? cand.content.parts.filter((p) => !p.thought).map((p) => p.text || '').join('')
    : '';
  if (!txt) {
    const bloqueo = d && d.promptFeedback && d.promptFeedback.blockReason;
    throw new Error(bloqueo ? 'Gemini bloqueó la respuesta (' + bloqueo + ')' : 'Gemini no devolvió texto');
  }
  return String(txt).trim();
}

async function apiExterna(api, prompt, system, signal) {
  if (!api.key) throw new Error('Falta la API key del proveedor seleccionado');
  if (!api.modelo) throw new Error('Elegí un modelo de la API (botón «Ver modelos»)');
  if ((api.proveedor || '') === 'gemini') return geminiNativo(api, prompt, system, signal);
  if ((api.proveedor || '') === 'anthropic') return anthropicNativo(api, prompt, system, signal);
  const base = String(api.baseUrl || '').replace(/\/+$/, '');
  if (!base || !api.key) throw new Error('API externa sin URL o sin key');
  // Impide que una URL "personalizada" apunte a localhost o a la red interna.
  await validarUrlPublica(base);
  const r = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + api.key },
    body: JSON.stringify({
      model: api.modelo,
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
      // Los modelos de razonamiento de OpenAI no aceptan temperature=0.3.
      ...(api.proveedor === 'openai' && /^(o[134](?:-|$)|gpt-5)/i.test(api.modelo) ? {} : { temperature: 0.3 })
    }),
    redirect: 'error', signal: senalApi(signal)
  });
  if (!r.ok) {
    throw await errorApi(r, api);
  }
  const d = await leerJsonLimitado(r, 4 * 1024 * 1024);
  const txt = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
  if (!txt) throw new Error('API sin respuesta');
  return String(txt).trim();
}

async function listarModelosApi(baseUrl, key, proveedor) {
  if (!key) throw new Error('Falta la API key');
  if (proveedor === 'gemini') {
    const modelos = [];
    let pagina = '';
    let paginas = 0;
    do {
      const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
      url.searchParams.set('pageSize', '100');
      if (pagina) url.searchParams.set('pageToken', pagina);
      const r = await fetch(url, {
        headers: { 'x-goog-api-key': key }, redirect: 'error', signal: senalApi(null, 20000)
      });
      if (!r.ok) throw await errorApi(r, { key });
      const d = await leerJsonLimitado(r, 2 * 1024 * 1024);
      modelos.push(...(d.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => String(m.name || '').replace(/^models\//, '')).filter(Boolean));
      if (pagina === d.nextPageToken) break;
      pagina = d.nextPageToken;
    } while (pagina && modelos.length < 300 && ++paginas < 10);
    return [...new Set(modelos)].slice(0, 300);
  }

  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('Falta la URL base de la API');
  await validarUrlPublica(base);
  if (proveedor === 'anthropic') {
    const modelos = [];
    let ultimo = '';
    let paginas = 0;
    do {
      const url = new URL(base + '/models');
      url.searchParams.set('limit', '100');
      if (ultimo) url.searchParams.set('after_id', ultimo);
      const r = await fetch(url, {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        redirect: 'error', signal: senalApi(null, 20000)
      });
      if (!r.ok) throw await errorApi(r, { key });
      const d = await leerJsonLimitado(r, 2 * 1024 * 1024);
      modelos.push(...(d.data || []).map(m => String(m.id || '')).filter(Boolean));
      if (!d.has_more || !d.last_id || ultimo === d.last_id) break;
      ultimo = d.last_id;
    } while (modelos.length < 300 && ++paginas < 10);
    return [...new Set(modelos)].slice(0, 300);
  }
  const r = await fetch(base + '/models', {
    headers: { Authorization: 'Bearer ' + key },
    redirect: 'error', signal: senalApi(null, 20000)
  });
  if (!r.ok) {
    throw await errorApi(r, { key });
  }
  const d = await leerJsonLimitado(r, 2 * 1024 * 1024);
  const bruto = Array.isArray(d.data) ? d.data : (Array.isArray(d.models) ? d.models : []);
  return [...new Set(bruto.map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean))];
}

module.exports = { PROVEEDORES, geminiNativo, anthropicNativo, apiExterna, listarModelosApi };
