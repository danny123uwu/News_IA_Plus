'use strict';
// ============================================================================
//  Microservicio de autenticación, perfil y fotos.
//  · contraseñas con scrypt asíncrono + comparación en tiempo constante
//  · límites de intentos (fuerza bruta) y de tamaño de entrada
//  · las fotos se validan por contenido real (no por extensión) y se sirven
//    con nosniff, así que no se puede subir HTML/SVG ejecutable
// ============================================================================

const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { resolverSecreto } = require('../shared/env');
const {
  cabecerasSeguridad, corsPortal, crearLimitador, recortar, listaSegura
} = require('../shared/http');
const { hash, check } = require('./password');
const { normalizarEmail, nombreValido, passwordValida, tipoImagen } = require('./validacion');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cabecerasSeguridad);
app.use(corsPortal());
app.use(express.json({ limit: '8mb' }));

const SECRET = resolverSecreto();
const DATA = path.join(__dirname, '..', '..', 'data');
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const UPLOADS = path.join(DATA, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true, mode: 0o700 });
app.use('/uploads', express.static(UPLOADS, {
  index: false,
  maxAge: '7d',
  immutable: true,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  }
}));

const db = new DatabaseSync(path.join(DATA, 'auth.db'));
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA synchronous=NORMAL');
db.exec('PRAGMA busy_timeout=5000');
db.exec('PRAGMA foreign_keys=ON');
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
const TEMAS = ['oscuro', 'claro', 'cian', 'purpura', 'celeste', 'rojo', 'verde', 'naranja', 'personalizado'];
if (!db.prepare('PRAGMA table_info(users)').all().map((c) => c.name).includes('tema')) {
  db.exec("ALTER TABLE users ADD COLUMN tema TEXT DEFAULT 'oscuro'");
}

// ---------- Accesibilidad / apariencia del texto ----------
const FUENTES = ['sistema', 'humanista', 'geometrica', 'serif', 'mono', 'redondeada'];
const TAMANOS = ['chico', 'normal', 'grande', 'enorme'];
const COLORES_TEXTO = ['auto', 'blanco', 'negro', 'azul', 'verde', 'ambar', 'rosa', 'cian', 'violeta', 'gris', 'personalizado'];
const TAMANOS_ICONOS = ['chico', 'normal', 'grande', 'enorme'];
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
function sanearIntereses(v) {
  if (!Array.isArray(v)) return null;
  return [...new Set(v.filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 50);
}

function sign(u) {
  return jwt.sign({ id: u.id, email: u.email, rol: u.rol }, SECRET, { expiresIn: '8h', algorithm: 'HS256' });
}
function publicUser(u) {
  return {
    id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, foto: u.foto,
    intereses: listaSegura(u.intereses), idioma: u.idioma || 'es', tema: u.tema || 'oscuro',
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
    const token = (req.headers.authorization || '').split(' ')[1];
    req.user = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// ---------------------------- imágenes -------------------------------------
function borrarFotoVieja(userId, nombre) {
  if (!nombre) return;
  if (!new RegExp('^u' + userId + '_[A-Za-z0-9]+\\.(png|jpe?g|gif|webp)$').test(nombre)) return;
  try { fs.unlinkSync(path.join(UPLOADS, path.basename(nombre))); } catch {}
}

// ---------------------------- límites --------------------------------------
const limiteLogin = crearLimitador({
  ventanaMs: 300000, maximo: 12,
  mensaje: 'Demasiados intentos de inicio de sesión. Esperá 5 minutos.'
});
const limiteRegistro = crearLimitador({
  ventanaMs: 3600000, maximo: 8,
  mensaje: 'Demasiadas cuentas creadas desde esta conexión. Esperá un rato.'
});

app.get('/health', (req, res) => res.json({ ok: true, servicio: 'auth' }));

app.post('/register', limiteRegistro, async (req, res) => {
  const b = req.body || {};
  const email = normalizarEmail(b.email);
  const nombre = nombreValido(b.nombre);
  const errorPass = passwordValida(b.password);
  if (!email) return res.status(400).json({ error: 'El correo no es válido' });
  if (!nombre) return res.status(400).json({ error: 'Falta tu nombre' });
  if (errorPass) return res.status(400).json({ error: errorPass });
  try {
    const pass = await hash(String(b.password));
    const r = db.prepare('INSERT INTO users(email,nombre,pass) VALUES(?,?,?)').run(email, nombre, pass);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
    res.json({ token: sign(u), user: publicUser(u) });
  } catch (e) {
    if (/UNIQUE|constraint/i.test(String(e && e.message))) {
      return res.status(409).json({ error: 'Ese correo ya está registrado' });
    }
    console.error('[auth] error al registrar:', e && e.message);
    res.status(500).json({ error: 'No se pudo crear la cuenta' });
  }
});

app.post('/login', limiteLogin, async (req, res) => {
  const b = req.body || {};
  const email = recortar(b.email, 254).toLowerCase().trim();
  const pass = String(b.password == null ? '' : b.password);
  if (!email || pass.length > 200) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !(await check(pass, u.pass))) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }
  res.json({ token: sign(u), user: publicUser(u) });
});

app.get('/me', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(publicUser(u));
});

app.put('/me', auth, (req, res) => {
  const b = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });

  const hexValido = (v, actual) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : (v === '' ? '' : actual));
  const nuevoNombre = b.nombre !== undefined ? nombreValido(b.nombre) : '';
  const intereses = b.intereses !== undefined ? sanearIntereses(b.intereses) : null;

  db.prepare(`UPDATE users SET nombre=?, intereses=?, idioma=?, tema=?,
              fuente=?, tamano_texto=?, color_texto=?, color_texto_hex=?, tamano_iconos=?,
              aro=?, tema_colores=? WHERE id=?`).run(
    nuevoNombre || u.nombre,
    intereses !== null ? JSON.stringify(intereses) : u.intereses,
    b.idioma !== undefined ? (['es', 'en'].includes(b.idioma) ? b.idioma : 'es') : (u.idioma || 'es'),
    b.tema !== undefined ? (TEMAS.includes(b.tema) ? b.tema : 'oscuro') : (u.tema || 'oscuro'),
    b.fuente !== undefined ? elegir(b.fuente, FUENTES, 'sistema') : (u.fuente || 'sistema'),
    b.tamanoTexto !== undefined ? elegir(b.tamanoTexto, TAMANOS, 'normal') : (u.tamano_texto || 'normal'),
    b.colorTexto !== undefined ? elegir(b.colorTexto, COLORES_TEXTO, 'auto') : (u.color_texto || 'auto'),
    hexValido(b.colorTextoHex, u.color_texto_hex || ''),
    b.tamanoIconos !== undefined ? elegir(b.tamanoIconos, TAMANOS_ICONOS, 'normal') : (u.tamano_iconos || 'normal'),
    b.aro !== undefined ? elegir(b.aro, AROS, 'instagram') : (u.aro || 'instagram'),
    b.temaColores !== undefined ? JSON.stringify(sanearTemaColores(b.temaColores)) : (u.tema_colores || '{}'),
    u.id
  );
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)));
});

app.post('/me/foto', auth, async (req, res) => {
  const b = req.body || {};
  if (!b.dataBase64) return res.status(400).json({ error: 'Falta la imagen' });

  const limpio = String(b.dataBase64).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s+/g, '');
  if (!limpio || limpio.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(limpio)) {
    return res.status(400).json({ error: 'La imagen no es válida o es demasiado pesada (máx. 5 MB)' });
  }
  const buf = Buffer.from(limpio, 'base64');
  if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Imagen muy pesada (máx. 5 MB)' });
  const tipo = tipoImagen(buf);
  if (!tipo) return res.status(400).json({ error: 'Formato no permitido. Usá PNG, JPG, GIF o WEBP.' });

  const nombre = 'u' + req.user.id + '_' + Date.now().toString(36) + crypto.randomBytes(8).toString('hex') + '.' + tipo.ext;
  try {
    await fs.promises.writeFile(path.join(UPLOADS, nombre), buf, { mode: 0o600 });
  } catch (e) {
    console.error('[auth] no se pudo guardar la foto:', e.message);
    return res.status(500).json({ error: 'No se pudo guardar la imagen' });
  }

  const anterior = db.prepare('SELECT foto FROM users WHERE id=?').get(req.user.id);
  db.prepare('UPDATE users SET foto=? WHERE id=?').run(nombre, req.user.id);
  if (anterior && anterior.foto && anterior.foto !== nombre) borrarFotoVieja(req.user.id, anterior.foto);
  res.json({ foto: nombre });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'La petición es demasiado grande' });
  }
  if (err && (err instanceof SyntaxError || err.status === 400)) {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  console.error('[auth] error:', err && err.message);
  res.status(500).json({ error: 'Error interno' });
});

app.listen(3001, () => console.log('[auth] microservicio en :3001'));

module.exports = { app };
