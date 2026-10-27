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

-- Estado del servidor OAuth 2.0 (services/auth/oauth.js).
CREATE TABLE IF NOT EXISTS oauth_sessions (
  session_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256' CHECK(code_challenge_method='S256'),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expiry ON oauth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expiry ON oauth_codes(expires_at);
