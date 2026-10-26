-- Esquema final de feeds.db; SIN DATOS. Fuente: services/feeds/index.js.
-- Las referencias son LOGICAS: el código actual no declara FOREIGN KEY.
-- Crear en una base NUEVA. La aplicación crea/migra las tablas al iniciar.
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  url TEXT NOT NULL,
  activo INTEGER DEFAULT 1,
  prioridad INTEGER DEFAULT 3,
  ultimo_error TEXT
);
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  titulo TEXT,
  link TEXT,
  contenido TEXT,
  autor TEXT,
  fecha TEXT,
  etiquetas TEXT DEFAULT '[]',
  leido INTEGER DEFAULT 0,
  favorito INTEGER DEFAULT 0,
  archivado INTEGER DEFAULT 0,
  saltado INTEGER DEFAULT 0,
  imagen TEXT,
  video TEXT,
  titulo_es TEXT,
  resumen_es TEXT,
  idioma TEXT,
  contenido_html TEXT,
  UNIQUE(source_id, link)
);
CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  article_id INTEGER,
  titulo TEXT,
  texto TEXT,
  nota TEXT,
  medio TEXT,
  link TEXT,
  fecha TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_user_fecha ON articles(user_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_articles_user_estado ON articles(user_id, archivado, saltado, leido);
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_id);
CREATE INDEX IF NOT EXISTS idx_sources_user ON sources(user_id);
CREATE INDEX IF NOT EXISTS idx_clips_user_fecha ON clips(user_id, fecha DESC);
PRAGMA user_version=2;
