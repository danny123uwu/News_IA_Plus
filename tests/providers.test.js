'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns');
const { apiExterna, listarModelosApi } = require('../services/agent/ai/providers');
const { combinarApi, configVisible, PROVEEDORES } = require('../services/agent/config');
const { generar } = require('../services/agent/ai/engine');

const KEY = 'clave-ficticia-no-valida';
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json' }
});

function simular(t, responder) {
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  return t.mock.method(globalThis, 'fetch', async (url, options) => responder(String(url), options));
}

for (const proveedor of ['openai', 'groq', 'deepseek', 'openrouter', 'personalizado']) {
  test(proveedor + ': generación y lista usan el protocolo OpenAI', async t => {
    const baseUrl = PROVEEDORES[proveedor].url || 'https://example.com/v1';
    const api = { proveedor, baseUrl, key: KEY, modelo: 'modelo-prueba' };
    simular(t, (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer ' + KEY);
      assert.equal(options.redirect, 'error');
      if (url.endsWith('/models')) return json({ data: [{ id: 'modelo-prueba' }, { id: 'modelo-prueba' }] });
      assert.equal(url, baseUrl + '/chat/completions');
      const body = JSON.parse(options.body);
      assert.equal(body.model, api.modelo);
      assert.deepEqual(body.messages, [{ role: 'system', content: 'sistema' }, { role: 'user', content: 'hola' }]);
      return json({ choices: [{ message: { content: 'LISTO' } }] });
    });
    assert.equal(await apiExterna(api, 'hola', 'sistema'), 'LISTO');
    assert.deepEqual(await listarModelosApi(baseUrl, KEY, proveedor), ['modelo-prueba']);
  });
}

test('Anthropic usa /messages, x-api-key y bloques de texto', async t => {
  const api = { proveedor: 'anthropic', baseUrl: PROVEEDORES.anthropic.url, key: KEY, modelo: 'claude-prueba' };
  simular(t, (url, options) => {
    assert.equal(options.headers['x-api-key'], KEY);
    assert.equal(options.headers['anthropic-version'], '2023-06-01');
    assert.equal(options.headers.Authorization, undefined);
    if (url.includes('/models?')) return json({ data: [{ id: api.modelo }] });
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    const body = JSON.parse(options.body);
    assert.equal(body.system, 'sistema');
    assert.ok(body.max_tokens > 0);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'hola' }]);
    return json({ content: [{ type: 'thinking', thinking: 'interno' }, { type: 'text', text: 'LISTO' }] });
  });
  assert.equal(await apiExterna(api, 'hola', 'sistema'), 'LISTO');
  assert.deepEqual(await listarModelosApi(api.baseUrl, KEY, 'anthropic'), [api.modelo]);
});

test('Gemini usa cabecera privada, ignora pensamientos y pagina modelos', async t => {
  const api = { proveedor: 'gemini', key: KEY, modelo: 'models/gemini-prueba' };
  simular(t, (url, options) => {
    assert.ok(!url.includes(KEY));
    assert.equal(options.headers['x-goog-api-key'], KEY);
    if (url.includes(':generateContent')) {
      assert.ok(url.endsWith('/gemini-prueba:generateContent'));
      assert.equal(JSON.parse(options.body).system_instruction.parts[0].text, 'sistema');
      return json({ candidates: [{ content: { parts: [{ thought: true, text: 'interno' }, { text: 'LISTO' }] } }] });
    }
    if (url.includes('pageToken=siguiente')) return json({ models: [
      { name: 'models/gemini-dos', supportedGenerationMethods: ['generateContent'] }
    ] });
    return json({ nextPageToken: 'siguiente', models: [
      { name: 'models/gemini-uno', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }
    ] });
  });
  assert.equal(await apiExterna(api, 'hola', 'sistema'), 'LISTO');
  assert.deepEqual(await listarModelosApi('', KEY, 'gemini'), ['gemini-uno', 'gemini-dos']);
});

test('Gemini informa bloqueo y ausencia de texto', async t => {
  const api = { proveedor: 'gemini', key: KEY, modelo: 'gemini-prueba' };
  simular(t, () => json({ promptFeedback: { blockReason: 'SAFETY' } }));
  await assert.rejects(apiExterna(api, 'hola'), /SAFETY/);
});

test('Anthropic recorre páginas de modelos', async t => {
  simular(t, (url) => url.includes('after_id=claude-uno')
    ? json({ data: [{ id: 'claude-dos' }], has_more: false })
    : json({ data: [{ id: 'claude-uno' }], has_more: true, last_id: 'claude-uno' }));
  assert.deepEqual(await listarModelosApi(PROVEEDORES.anthropic.url, KEY, 'anthropic'), ['claude-uno', 'claude-dos']);
});

test('una respuesta sin contenido no se presenta como éxito', async t => {
  simular(t, () => json({ choices: [] }));
  await assert.rejects(apiExterna({ proveedor: 'openai', baseUrl: PROVEEDORES.openai.url, key: KEY, modelo: 'prueba' }, 'hola'), /sin respuesta/);
});

for (const status of [401, 403, 404, 429, 500]) {
  test('API informa HTTP ' + status + ' sin filtrar la clave', async t => {
    simular(t, () => json({ error: { message: 'Error con ' + KEY } }, status));
    await assert.rejects(apiExterna({ proveedor: 'groq', baseUrl: PROVEEDORES.groq.url, key: KEY, modelo: 'prueba' }, 'hola'), e => {
      assert.ok(e.message.includes(String(status)));
      assert.ok(!e.message.includes(KEY));
      return true;
    });
  });
}

test('rechaza API sin clave, sin modelo y URL privada antes de llamar', async t => {
  const fetch = simular(t, () => { throw Error('No debe llamar'); });
  await assert.rejects(apiExterna({ proveedor: 'gemini' }, 'hola'), /key/);
  await assert.rejects(apiExterna({ proveedor: 'gemini', key: KEY }, 'hola'), /modelo/);
  await assert.rejects(apiExterna({ baseUrl: 'http://127.0.0.1', modelo: 'prueba', key: KEY }, 'hola'), /red interna/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('OpenAI de razonamiento no recibe temperature incompatible', async t => {
  simular(t, (url, options) => {
    assert.equal(JSON.parse(options.body).temperature, undefined);
    return json({ choices: [{ message: { content: 'LISTO' } }] });
  });
  for (const modelo of ['o3', 'o4-mini', 'gpt-5', 'gpt-5-mini']) {
    assert.equal(await apiExterna({ proveedor: 'openai', baseUrl: PROVEEDORES.openai.url, key: KEY, modelo }, 'hola'), 'LISTO');
  }
});

test('cancelar API aborta fetch y no activa respaldo local', async t => {
  const ctrl = new AbortController();
  const fetch = simular(t, (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    ctrl.abort();
  }));
  await assert.rejects(generar({ prompt: 'hola', signal: ctrl.signal, cfg: {
    motor: 'api', respaldoLocal: true,
    api: { proveedor: 'gemini', modelo: 'gemini-prueba', key: KEY }
  } }), { name: 'AbortError' });
  assert.equal(fetch.mock.callCount(), 1);
});

test('fallo de API sin respaldo no contacta Ollama', async t => {
  const fetch = simular(t, () => json({ error: { message: 'sin cuota' } }, 429));
  await assert.rejects(generar({ prompt: 'hola', cfg: { motor: 'api', respaldoLocal: false,
    api: { proveedor: 'gemini', modelo: 'prueba', key: KEY }
  } }), /429/);
  assert.equal(fetch.mock.callCount(), 1);
});

test('API correcta informa motor externo y no consulta Ollama', async t => {
  const fetch = simular(t, () => json({ candidates: [{ content: { parts: [{ text: 'LISTO' }] } }] }));
  const d = await generar({ prompt: 'hola', cfg: { motor: 'api', respaldoLocal: true,
    api: { proveedor: 'gemini', modelo: 'prueba', key: KEY }
  } });
  assert.equal(d.motor, 'api:gemini:prueba');
  assert.equal(d.texto, 'LISTO');
  assert.equal(fetch.mock.callCount(), 1);
});

test('solo usa respaldo local cuando se habilitó y falló la API', async t => {
  simular(t, (url) => {
    if (url.includes('generativelanguage.googleapis.com')) return json({ error: { message: 'sin cuota' } }, 429);
    if (url.endsWith('/api/tags')) return json({ models: [{ name: 'llama3.2:3b' }] });
    assert.ok(url.endsWith('/api/generate'));
    return json({ response: 'respaldo local' });
  });
  const d = await generar({ prompt: 'hola', cfg: { motor: 'api', respaldoLocal: true,
    modelos: { resumir: 'llama3.2:3b' }, api: { proveedor: 'gemini', modelo: 'prueba', key: KEY }
  } });
  assert.equal(d.motor, 'ollama:llama3.2:3b');
  assert.equal(d.texto, 'respaldo local');
});

test('cambiar proveedor o dominio elimina clave anterior; mismo destino la conserva', () => {
  const base = { proveedor: 'openai', baseUrl: PROVEEDORES.openai.url, modelo: 'prueba', key: KEY };
  assert.equal(combinarApi(base, { key: '' }).key, KEY);
  assert.equal(combinarApi(base, { proveedor: 'anthropic' }).key, '');
  assert.equal(combinarApi(base, { baseUrl: 'https://example.com/v1' }).key, '');
  assert.equal(combinarApi(base, { proveedor: 'groq', key: 'nueva-clave' }).key, 'nueva-clave');
  assert.throws(() => combinarApi(base, { proveedor: 'desconocido' }), /inválido/);
  assert.equal(configVisible({ api: base }).api.key, '');
});
