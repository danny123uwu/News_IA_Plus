'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parsearXml, limpiarXml, enlacesDescubiertos, candidatosComunes, normalizarUrl, bajar, ErrorFeed
} = require('../services/feeds/rss');

const XML_ROTO = `Warning: algo en /var/www/x.php on line 3
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
<title>Feed & roto</title>
<item><title>Nota con <br> salto</title><link>/nota-1</link>
<description>texto con &nbsp; entidad y & suelto</description></item>
</channel></rss>
<br>basura`;

test('parsea un XML roto y rescata el ítem', async () => {
  const f = await parsearXml(XML_ROTO, 'https://ejemplo.com/feed/');
  assert.equal(f.items.length, 1);
  assert.match(f.items[0].title, /Nota con/);
  assert.match(f.items[0].link, /nota-1/);
});

test('limpia entidades y & sueltos sin romper CDATA', () => {
  const salida = limpiarXml('<x>a & b &nbsp; <![CDATA[& literal]]></x>');
  assert.match(salida, /a &amp; b/);
  assert.match(salida, /CDATA\[& literal\]/);
});

test('descubre el feed declarado y los enlaces RSS de una portada', () => {
  const html = `
    <html><head>
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
      <link rel="stylesheet" href="/estilo.css">
    </head><body>
      <a href="/rss">RSS</a>
      <a href="/otra">Otra cosa</a>
    </body></html>`;
  const r = enlacesDescubiertos(html, 'https://sitio.com/blog/');
  assert.deepEqual(r.declarados, ['https://sitio.com/feed.xml']);
  assert.ok(r.otros.includes('https://sitio.com/rss'));
  assert.ok(!r.otros.some((u) => u.includes('estilo.css')));
});

test('propone rutas típicas y normaliza la URL de entrada', () => {
  const comunes = candidatosComunes('https://sitio.com/blog/post');
  assert.ok(comunes.some((u) => u.endsWith('/feed')));
  assert.ok(comunes.some((u) => u.includes('wp-json')));
  assert.equal(normalizarUrl('sitio.com/feed'), 'https://sitio.com/feed');
  assert.equal(normalizarUrl('  //sitio.com/feed '), 'https://sitio.com/feed');
  assert.equal(normalizarUrl(''), '');
});

test('la descarga rechaza destinos internos antes de conectar', async () => {
  await assert.rejects(bajar('http://127.0.0.1:9/feed'), (e) => {
    assert.ok(e instanceof ErrorFeed);
    assert.equal(e.codigo, 'bloqueado');
    return true;
  });
  await assert.rejects(bajar('http://169.254.169.254/latest/meta-data/'), /no está permitida/i);
});
