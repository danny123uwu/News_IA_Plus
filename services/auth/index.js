const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const app = express();
app.use(cors());
app.use(express.json({ limit: '6mb' }));

const SECRET = process.env.JWT_SECRET || 'portal-ia-news-dev-secret';
const DATA = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA, { recursive: true });
const UPLOADS = path.join(DATA, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
app.use('/uploads', express.static(UPLOADS));

const db = new DatabaseSync(path.join(DATA, 'auth.db'));
db.exec(`CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  pass TEXT NOT NULL,
  rol TEXT DEFAULT 'user',
  foto TEXT,
  intereses TEXT DEFAULT '[]',
  creado TEXT DEFAULT (datetime('now'))
)`);

function hash(p) {
  const s = crypto.randomBytes(16).toString('hex');
  return s + ':' + crypto.scryptSync(p, s, 64).toString('hex');
}
function check(p, h) {
  const [s, x] = h.split(':');
  return x === crypto.scryptSync(p, s, 64).toString('hex');
}
function sign(u) {
  return jwt.sign({ id: u.id, email: u.email, rol: u.rol }, SECRET, { expiresIn: '8h' });
}
function publicUser(u) {
  return { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, foto: u.foto, intereses: JSON.parse(u.intereses || '[]') };
}
function auth(req, res, next) {
  try {
    req.user = jwt.verify((req.headers.authorization || '').split(' ')[1], SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

app.get('/health', (req, res) => res.json({ ok: true, servicio: 'auth' }));

app.post('/register', (req, res) => {
  const { email, password, nombre } = req.body || {};
  if (!email || !password || !nombre) return res.status(400).json({ error: 'Faltan datos (email, password, nombre)' });
  if (String(password).length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  try {
    const r = db.prepare('INSERT INTO users(email,nombre,pass) VALUES(?,?,?)').run(String(email).toLowerCase().trim(), String(nombre).trim(), hash(String(password)));
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
    res.json({ token: sign(u), user: publicUser(u) });
  } catch (e) {
    res.status(400).json({ error: 'Ese correo ya está registrado' });
  }
});

app.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase().trim());
  if (!u || !check(String(password || ''), u.pass)) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  res.json({ token: sign(u), user: publicUser(u) });
});

app.get('/me', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(publicUser(u));
});

app.put('/me', auth, (req, res) => {
  const { nombre, intereses } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  db.prepare('UPDATE users SET nombre=?, intereses=? WHERE id=?').run(
    nombre !== undefined ? String(nombre) : u.nombre,
    intereses !== undefined ? JSON.stringify(intereses) : u.intereses,
    u.id
  );
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)));
});

app.post('/me/foto', auth, (req, res) => {
  const { dataBase64, ext } = req.body || {};
  if (!dataBase64) return res.status(400).json({ error: 'Falta la imagen' });
  const limpio = String(dataBase64).replace(/^data:image\/\w+;base64,/, '');
  const buf = Buffer.from(limpio, 'base64');
  if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Imagen muy pesada (max 5MB)' });
  const nombre = 'u' + req.user.id + '_' + Date.now() + '.' + String(ext || 'png').replace(/\W/g, '');
  fs.writeFileSync(path.join(UPLOADS, nombre), buf);
  db.prepare('UPDATE users SET foto=? WHERE id=?').run(nombre, req.user.id);
  res.json({ foto: nombre });
});

app.listen(3001, () => console.log('[auth] microservicio en :3001'));
