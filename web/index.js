'use strict';
const express = require('express');
const path = require('path');

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

app.get('/health', (req, res) => res.json({ ok: true, servicio: 'web' }));

app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'ignore',
  index: 'index.html',
  setHeaders(res, archivo) {
    // HTML/JS/CSS se revalidan siempre (evita ver una versión vieja tras
    // actualizar); las imágenes sí se pueden cachear una semana.
    if (/\.(png|jpe?g|webp|gif|ico|svg|woff2?)$/i.test(archivo)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use((req, res) => res.status(404).json({ error: 'No encontrado' }));

app.listen(8090, () => console.log('pagina en http://localhost:8090'));

module.exports = { app };
