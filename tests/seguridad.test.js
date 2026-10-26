'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { esIpPrivada, validarUrlPublica, lookupSeguro } = require('../services/shared/url-segura');

test('detecta IPv4 privadas, reservadas y de metadatos', () => {
  for (const ip of [
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.10',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '198.18.0.1', '192.0.2.5', '203.0.113.9'
  ]) assert.equal(esIpPrivada(ip), true, ip + ' debería bloquearse');
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '104.16.0.1']) {
    assert.equal(esIpPrivada(ip), false, ip + ' es pública');
  }
});

test('detecta IPv6 privadas, mapeadas y públicas', () => {
  for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '2001:db8::1']) {
    assert.equal(esIpPrivada(ip), true, ip + ' debería bloquearse');
  }
  assert.equal(esIpPrivada('2606:4700:4700::1111'), false);
});

test('bloquea URLs internas, protocolos raros y credenciales embebidas', async () => {
  const casos = [
    'http://127.0.0.1:3001/health',
    'http://localhost/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]:8080/',
    'http://10.0.0.5/feed',
    'http://192.168.0.1/',
    'ftp://example.com/feed',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'http://usuario:clave@example.com/feed',
    'no-es-una-url'
  ];
  for (const url of casos) {
    await assert.rejects(validarUrlPublica(url), undefined, url + ' debería rechazarse');
  }
});

test('permite IPs públicas y permite explícitamente redes privadas cuando se pide', async () => {
  const publica = await validarUrlPublica('http://1.1.1.1/feed');
  assert.equal(publica.hostname, '1.1.1.1');
  const interna = await validarUrlPublica('http://127.0.0.1:1/', { permitirPrivadas: true });
  assert.equal(interna.hostname, '127.0.0.1');
});

test('lookupSeguro rechaza direcciones privadas al conectar', async () => {
  await assert.rejects(
    new Promise((resolve, reject) => lookupSeguro('127.0.0.1', {}, (e, a) => (e ? reject(e) : resolve(a)))),
    /no permitido/i
  );
  const dir = await new Promise((resolve, reject) =>
    lookupSeguro('1.1.1.1', {}, (e, a) => (e ? reject(e) : resolve(a)))
  );
  assert.equal(dir, '1.1.1.1');
});
