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

// Preferencia de idioma de las noticias (por defecto: español)
if (!db.prepare('PRAGMA table_info(users)').all().map((c) => c.name).includes('idioma')) {
  db.exec("ALTER TABLE users ADD COLUMN idioma TEXT DEFAULT 'es'");
}

// Tema visual del frontend (por defecto: azul oscuro).
// "personalizado" usa los colores que el usuario guarda en tema_colores.
const TEMAS = ['oscuro', 'claro', 'cian', 'purpura', 'celeste', 'rojo', 'verde', 'naranja', 'personalizado'];
if (!db.prepare('PRAGMA table_info(users)').all().map((c) => c.name).includes('tema')) {
  db.exec("ALTER TABLE users ADD COLUMN tema TEXT DEFAULT 'oscuro'");
}

// ---------- Accesibilidad / apariencia del texto ----------
// Cada preferencia se guarda como un id corto y se valida contra su lista.
const FUENTES = ['sistema', 'humanista', 'geometrica', 'serif', 'mono', 'redondeada'];
const TAMANOS = ['chico', 'normal', 'grande', 'enorme'];
const COLORES_TEXTO = ['auto', 'blanco', 'negro', 'azul', 'verde', 'ambar', 'rosa', 'cian', 'violeta', 'gris', 'personalizado'];
const TAMANOS_ICONOS = ['chico', 'normal', 'grande', 'enorme'];
// Aros de los estados de las noticias (burbujas de fuentes y tarjetas)
const AROS = ['instagram', 'sunset', 'oceano', 'bosque', 'neon', 'oro', 'rubi', 'lavanda', 'menta', 'mono', 'fuego', 'hielo'];
const COLUMNAS_APARIENCIA = [
  ['fuente', 'sistema'],
  ['tamano_texto', 'normal'],
  ['color_texto', 'auto'],
  ['tamano_iconos', 'normal'],
  ['aro', 'instagram'],
  ['tema_colores', '{}'],
  ['color_texto_hex', '']
];
{
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  for (const [col, porDefecto] of COLUMNAS_APARIENCIA) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT DEFAULT '${porDefecto}'`);
  }
}
const elegir = (valor, lista, porDefecto) => (lista.includes(valor) ? valor : porDefecto);

// Colores personalizados: solo aceptamos #rrggbb (nada de url() ni valores raros)
const HEX = /^#[0-9a-fA-F]{6}$/;
const COLOR_TEMA_DEFECTO = { fondo: '#0f1419', superficie: '#16202a', acento: '#1d9bf0', texto: '#e7e9ea' };
function sanearTemaColores(v) {
  const salida = { ...COLOR_TEMA_DEFECTO };
  if (v && typeof v === 'object') {
    for (const k of Object.keys(COLOR_TEMA_DEFECTO)) {
      if (typeof v[k] === 'string' && HEX.test(v[k])) salida[k] = v[k].toLowerCase();
    }
  }
  return salida;
}
function leerTemaColores(txt) {
  try { return sanearTemaColores(JSON.parse(txt || '{}')); } catch { return { ...COLOR_TEMA_DEFECTO }; }
}

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
  return {
    id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, foto: u.foto,
    intereses: JSON.parse(u.intereses || '[]'), idioma: u.idioma || 'es', tema: u.tema || 'oscuro',
    fuente: u.fuente || 'sistema',
    tamanoTexto: u.tamano_texto || 'normal',
    colorTexto: u.color_texto || 'auto',
    colorTextoHex: u.color_texto_hex || '',
    tamanoIconos: u.tamano_iconos || 'normal',
    aro: u.aro || 'instagram',
    temaColores: leerTemaColores(u.tema_colores)
  };
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
  const { nombre, intereses, idioma, tema, fuente, tamanoTexto, colorTexto, colorTextoHex,
    tamanoIconos, aro, temaColores } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  const hexValido = (v, actual) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : (v === '' ? '' : actual));
  db.prepare(`UPDATE users SET nombre=?, intereses=?, idioma=?, tema=?,
              fuente=?, tamano_texto=?, color_texto=?, color_texto_hex=?, tamano_iconos=?,
              aro=?, tema_colores=? WHERE id=?`).run(
    nombre !== undefined ? String(nombre) : u.nombre,
    intereses !== undefined ? JSON.stringify(intereses) : u.intereses,
    idioma !== undefined ? (['es', 'en'].includes(idioma) ? idioma : 'es') : (u.idioma || 'es'),
    tema !== undefined ? (TEMAS.includes(tema) ? tema : 'oscuro') : (u.tema || 'oscuro'),
    fuente !== undefined ? elegir(fuente, FUENTES, 'sistema') : (u.fuente || 'sistema'),
    tamanoTexto !== undefined ? elegir(tamanoTexto, TAMANOS, 'normal') : (u.tamano_texto || 'normal'),
    colorTexto !== undefined ? elegir(colorTexto, COLORES_TEXTO, 'auto') : (u.color_texto || 'auto'),
    hexValido(colorTextoHex, u.color_texto_hex || ''),
    tamanoIconos !== undefined ? elegir(tamanoIconos, TAMANOS_ICONOS, 'normal') : (u.tamano_iconos || 'normal'),
    aro !== undefined ? elegir(aro, AROS, 'instagram') : (u.aro || 'instagram'),
    temaColores !== undefined ? JSON.stringify(sanearTemaColores(temaColores)) : (u.tema_colores || '{}'),
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
