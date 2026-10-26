'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hash, check } = require('../services/auth/password');
const { normalizarEmail, passwordValida, tipoImagen } = require('../services/auth/validacion');

test('hash y verificación de contraseñas', async () => {
  const h = await hash('ClaveSegura123');
  assert.match(h, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  assert.equal(await check('ClaveSegura123', h), true);
  assert.equal(await check('otra-clave', h), false);
});

test('un hash corrupto no rompe el login', async () => {
  for (const roto of ['', 'sin-dos-puntos', 'abc:def', 'x'.repeat(32) + ':nohex', null, undefined]) {
    assert.equal(await check('cualquiera', roto), false);
  }
});

test('valida correo y contraseña', () => {
  assert.equal(normalizarEmail('  USER@Example.COM '), 'user@example.com');
  assert.equal(normalizarEmail('sin-arroba'), '');
  assert.equal(normalizarEmail('a@b'), '');
  assert.match(passwordValida('corta'), /8 caracteres/);
  assert.equal(passwordValida('una-clave-larga'), '');
  assert.match(passwordValida('x'.repeat(201)), /demasiado larga/);
});

test('solo acepta imágenes reales, no HTML ni SVG', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const gif = Buffer.from('GIF89a......', 'ascii');
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)]);
  assert.equal(tipoImagen(png).ext, 'png');
  assert.equal(tipoImagen(jpg).ext, 'jpg');
  assert.equal(tipoImagen(gif).ext, 'gif');
  assert.equal(tipoImagen(webp).ext, 'webp');
  assert.equal(tipoImagen(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(tipoImagen(Buffer.from('<svg onload="alert(1)"></svg>')), null);
  assert.equal(tipoImagen(Buffer.alloc(0)), null);
});
