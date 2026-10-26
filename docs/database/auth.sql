-- Esquema final de auth.db; SIN DATOS. Fuente: services/auth/index.js.
-- Crear en una base NUEVA, no importar sobre la base de un usuario.
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  pass TEXT NOT NULL,
  rol TEXT DEFAULT 'user',
  foto TEXT,
  intereses TEXT DEFAULT '[]',
  creado TEXT DEFAULT (datetime('now')),
  idioma TEXT DEFAULT 'es',
  tema TEXT DEFAULT 'oscuro',
  fuente TEXT DEFAULT 'sistema',
  tamano_texto TEXT DEFAULT 'normal',
  color_texto TEXT DEFAULT 'auto',
  tamano_iconos TEXT DEFAULT 'normal',
  aro TEXT DEFAULT 'instagram',
  tema_colores TEXT DEFAULT '{}',
  color_texto_hex TEXT DEFAULT ''
);
