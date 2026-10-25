#!/usr/bin/env node
'use strict';
// ============================================================================
//  probar-feeds.js — verificación del autodescubrimiento y del parser tolerante
//
//  Uso:   npm run test:feeds
//         node scripts/probar-feeds.js https://otro-sitio.com
//
//  Comprueba:
//    1. Que un sitio real (NO el feed) sea resuelto a su feed.
//    2. Que un XML roto se pueda leer igual.
//    3. Que un sitio sin feed devuelva un mensaje entendible (no un error raro).
// ============================================================================

const { abrirFeed, parsearXml } = require('../services/feeds/rss');

const SITIOS = [
  'https://laboratoriolinux.es/index.php',   // Joomla (el de las capturas)
  'https://www.theverge.com/',               // descubre /rss/index.xml
  'https://www.xataka.com',                  // WordPress + FeedBurner
  'https://blog.google/',                    // ruta típica /rss/
  'https://feeds.arstechnica.com/arstechnica/index' // feed directo
];

const XML_ROTO = `Warning: algo en /var/www/x.php on line 3
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
<title>Feed & roto</title>
<item><title>Nota con <br> salto</title><link>/nota-1</link>
<description>texto con &nbsp; entidad y & suelto</description></item>
</channel></rss>
<br>basura`;

const verde = (t) => '\x1b[32m' + t + '\x1b[0m';
const rojo = (t) => '\x1b[31m' + t + '\x1b[0m';
const gris = (t) => '\x1b[90m' + t + '\x1b[0m';

let fallos = 0;

async function probarSitio(url) {
  const t0 = Date.now();
  try {
    const r = await abrirFeed(url);
    const seg = ((Date.now() - t0) / 1000).toFixed(1) + 's';
    if (!r.feed.items.length) throw new Error('el feed no trajo noticias');
    console.log(verde('  OK   ') + url);
    console.log('       ' + gris('-> ' + r.url + '  (' + r.metodo + ', ' + r.feed.items.length + ' noticias, ' + seg + ')'));
  } catch (e) {
    fallos++;
    console.log(rojo('  FALLO') + ' ' + url);
    console.log('       ' + gris(e.codigo + ': ' + e.message));
  }
}

(async () => {
  console.log('\n=== 1) Sitios reales: la portada tiene que resolver a su feed ===');
  const lista = process.argv.slice(2).length ? process.argv.slice(2) : SITIOS;
  for (const url of lista) await probarSitio(url);

  console.log('\n=== 2) XML roto: tiene que leerlo igual ===');
  try {
    const f = await parsearXml(XML_ROTO, 'https://ejemplo.com/feed/');
    const ok = f.items.length === 1 && /Nota con/.test(f.items[0].title);
    console.log((ok ? verde('  OK   ') : rojo('  FALLO')) + ' ítem rescatado: ' + f.items[0].title);
    console.log('       ' + gris('link absoluto: ' + f.items[0].link));
    if (!ok) fallos++;
  } catch (e) {
    fallos++;
    console.log(rojo('  FALLO') + ' el XML roto no se pudo leer: ' + e.message);
  }

  console.log('\n=== 3) Sitio sin feed: mensaje claro en vez de error técnico ===');
  try {
    await abrirFeed('https://example.com');
    console.log(rojo('  FALLO') + ' debería haber avisado de que no hay feed');
    fallos++;
  } catch (e) {
    console.log(verde('  OK   ') + ' mensaje: ' + gris(e.message.slice(0, 110) + '…'));
  }

  console.log('\n' + (fallos ? rojo(fallos + ' prueba(s) fallaron') : verde('Todo bien ✔')) + '\n');
  process.exit(fallos ? 1 : 0);
})();
