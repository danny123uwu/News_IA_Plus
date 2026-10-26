'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { clasificarPorReglas, recortarFrases, TAXONOMIA } = require('../services/agent/ai/rules');
const { recomendar, NOMBRE_MODELO, elegirAutomatico } = require('../services/agent/ai/models');
const { esEspanol } = require('../services/agent/ai/translate');
const { sanearBaseUrl } = require('../services/agent/config');
const prompts = require('../services/agent/ai/prompts');

test('clasifica por reglas sin depender del modelo', () => {
  assert.ok(clasificarPorReglas('Nueva vulnerabilidad CVE en Linux', 'parche de seguridad').includes('Ciberseguridad'));
  assert.ok(clasificarPorReglas('OpenAI lanza un modelo de lenguaje', 'LLM').includes('Inteligencia Artificial'));
  assert.deepEqual(clasificarPorReglas('texto sin pistas', ''), ['General']);
});

test('recorta por frases sin cortar palabras', () => {
  const t = 'Primera frase. Segunda frase. Tercera frase.';
  const r = recortarFrases(t, 20);
  assert.ok(r.length <= 21);
  assert.match(r, /Primera frase\./);
});

test('detecta español con acentos y palabras comunes', () => {
  assert.equal(esEspanol('El gobierno anunció una medida económica'), true);
  assert.equal(esEspanol('The government announced a new economic measure today'), false);
});

test('recomienda modelos instalados y evita los que no entran en VRAM', () => {
  const r = recomendar([
    { name: 'qwen2.5:3b', size: 1.9e9 },
    { name: 'llama3.2:3b', size: 2.0e9 },
    { name: 'llama3.1:70b', size: 40e9 },
    { name: 'nomic-embed-text', size: 0.3e9 }
  ]);
  assert.equal(r.clasificar, 'qwen2.5:3b');
  assert.equal(r.resumir, 'llama3.2:3b');
  assert.deepEqual(r.evitados, ['llama3.1:70b']);
  assert.equal(elegirAutomatico([{ name: 'gemma2:2b' }, { name: 'x:1b' }], 'resumir'), 'gemma2:2b');
});

test('valida nombres de modelo contra rutas y puntos suspensivos', () => {
  for (const ok of ['qwen2.5:3b', 'llama3.2:3b', 'usuario/modelo:q4_K_M', 'gemma2']) {
    assert.equal(NOMBRE_MODELO.test(ok), true, ok);
  }
  for (const mal of ['', '../etc/passwd', 'modelo con espacios', 'modelo:tag:otro']) {
    assert.equal(NOMBRE_MODELO.test(mal), false, mal);
  }
  // La longitud se controla aparte en la ruta (máx. 120).
  assert.equal(NOMBRE_MODELO.test('a'.repeat(200)), true);
});

test('la URL de la API externa solo admite http(s) sin credenciales', () => {
  assert.equal(sanearBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
  assert.equal(sanearBaseUrl('http://192.168.1.5:8080/v1'), 'http://192.168.1.5:8080/v1');
  assert.equal(sanearBaseUrl('javascript:alert(1)'), '');
  assert.equal(sanearBaseUrl('ftp://ejemplo.com'), '');
  assert.equal(sanearBaseUrl('https://user:pass@ejemplo.com/v1'), '');
  assert.equal(sanearBaseUrl(''), '');
});

test('los prompts limitan el tamaño de la entrada', () => {
  const p = prompts.resumir({ titulo: 'x'.repeat(2000), texto: 'y'.repeat(30000) });
  assert.ok(p.prompt.length < 8000);
  const c = prompts.clasificar({ titulo: 'x'.repeat(2000), texto: 'y'.repeat(9000) });
  assert.ok(c.prompt.length < 4000);
  const d = prompts.digest(Array.from({ length: 30 }, () => ({ fuente: 'f', titulo: 't', contenido: 'c' })));
  assert.ok(d.prompt.length < 20000);
});

test('la taxonomía compartida no tiene duplicados', () => {
  assert.equal(new Set(TAXONOMIA).size, TAXONOMIA.length);
});
