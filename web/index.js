const express = require('express');
const path = require('path');

const app = express();
app.get('/health', (req, res) => res.json({ ok: true, servicio: 'web' }));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(8090, () => console.log('pagina en http://localhost:8090'));
