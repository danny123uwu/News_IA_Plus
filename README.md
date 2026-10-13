# 📰 Portal IA News

Portal de noticias con agente de inteligencia artificial — **3 microservicios + JWT + IA local o API externa**.

> **Estado: 13 oct 2026** — alfa usable. Lo que falta está listado abajo en [Pendiente](#pendiente-falta).

## Requisitos
- **Node.js 22.5+** (recomendado 24 LTS) — descargar de https://nodejs.org (funciona en **Windows, macOS y Linux**; usa `node:sqlite` incluido, sin compilar nada)
- **Ollama** (opcional) — sin él, la IA usa respaldos: API externa configurable o reglas locales
- Navegador Chrome/Firefox/Edge reciente

## Cómo correrlo (igual en Windows, Mac y Linux)

```bash
git clone https://github.com/danny123uwu/News_IA_Plus.git
cd News_IA_Plus
npm install
npm start
```

Abrir **http://localhost:8090** — crear cuenta y listo.

Notas por sistema:
- **Windows**: en la primera ejecución, el Firewall puede preguntar → dar **Permitir** (los puertos 8090/3001-3003 son locales). Si `npm` no se encuentra, reinstalar Node con la casilla "Add to PATH" marcada.
- **macOS**: igual; si pide permisos de red, aceptar. Ollama se instala desde https://ollama.com.
- **Linux**: ya lo sabes pana.
- En la primera ejecución se crea solo la carpeta `data/` con las bases de datos — no hay que configurar nada. `data/` **no** se sube a git (contiene llaves API y BDs personales).

Para probar en clase: basta con copiar la carpeta del proyecto en la otra PC (sin `node_modules/` ni `data/`) y repetir `npm install` + `npm start`. Sin internet solo funciona con Ollama local (el feed necesita conexión para traer RSS).

## Estructura

```
portal-ianews/
├── start.js            # arranca los 4 servicios con un solo comando
├── services/
│   ├── auth/           # registro, login, JWT, perfil (puerto 3001)
│   ├── feeds/          # fuentes RSS, artículos, feed (puerto 3002)
│   └── agent/          # agente IA (puerto 3003)
├── web/                # frontend (puerto 8090)
│   └── public/
│       ├── catalogo.js # catálogo de ~150 portales tech con RSS
│       ├── app.js
│       └── style.css
└── data/               # bases de datos y llaves de IA (NO se sube a git)
```

> ⚠️ **Seguridad**: `data/` está en `.gitignore` porque contiene las bases de datos y las llaves API de cada usuario. Nunca lo suban a GitHub.

## Arquitectura

| Microservicio | Puerto | Qué hace |
|---|---|---|
| `services/auth` | 3001 | Registro/login, JWT, perfil y foto de usuario |
| `services/feeds` | 3002 | Fuentes RSS, artículos, feed "Para Ti", portadas por fuente, recortes, estadísticas, enriquecer artículo desde su web |
| `services/agent` | 3003 | Agente IA: clasificar, resumir, digest, preguntas (anti-rechazo), traducir, config de IA |
| `web` | 8090 | Página (frontend) |

Comunicación: el frontend (y entre sí) hablan por HTTP con `Authorization: Bearer <JWT>`.

## Recorrido rápido
1. Crear cuenta en la página
2. "Mis fuentes" → **catálogo con buscador** (~150 portales por categoría, un clic para agregar) o presets rápidos
3. "Para Ti" → feed ordenado por prioridad; **🎛 Prioridades** arriba del feed y **▲▼** en cada tarjeta; clic en cualquier parte de la tarjeta abre la noticia
4. Burbujas superiores → **portada** de esa fuente estilo periódico
5. Abrir una noticia → resumen IA + **cuerpo completo con imágenes en orden** (se enriquece solo desde la web original; la primera vez tarda ~10 s, luego queda cacheado)
6. "☀ Digest de hoy" → resumen del día con IA
7. "Mi perfil" → foto, nombre y etiquetas de interés
8. "⚙️ IA" → motor local (Ollama) o API externa, modelos por tarea y traducción

## Probar con Postman (lo que pide el inge)
1. `POST localhost:3001/register` (body: `{"email":"a@a.com","password":"1234","nombre":"Yo"}`) → copia el `token`
2. En Headers: `Authorization: Bearer <token>`
3. `GET localhost:3002/feeds` / `POST localhost:3002/feeds` / `GET localhost:3002/feed` / `GET localhost:3002/articles/:id`
4. `POST localhost:3003/summarize` (body: `{"titulo":"...","texto":"..."}`)
5. `GET localhost:3003/config` y `POST localhost:3003/config/test` (configuración de IA)

## Estado

### Hecho ✅
- Registro/login con JWT y roles en el token; perfil con foto e intereses
- CRUD de fuentes RSS con prueba de URL, pausa y presets; **catálogo de ~150 portales** con buscador y acordeones por categoría
- **Prioridades solo en el feed** (panel con sliders + ▲▼ inline en las tarjetas)
- Importación automática (cada 15 min), clasificación con **30 categorías** en español (IA con fallback a reglas)
- Feed "Para Ti" con burbujas → **portada por fuente**, filtros por tiempo, búsqueda con debounce y etiquetas
- Modal de noticia: resumen ~150 palabras + **cuerpo original con multimedia inline en orden** (enriquecido desde la web vía AllOrigins/Jina cuando el RSS no trae imágenes), preguntar a la IA, recortes, Ver fuente
- **IA anti-rechazo**: si el modelo se niega con info pública, reintenta automáticamente con instrucción reforzada
- Archivados, favoritos, leídos (sin recargar el feed), "no me interesa", panel de estadísticas
- Traducción automática al español (Google con respaldos)
- Imágenes y videos de las noticias
- **Panel ⚙️ IA**: motor local (Ollama) o API externa (Gemini/Groq/OpenAI/DeepSeek/OpenRouter), modelo por tarea, traducción y botón de prueba, guardado por usuario

### Pendiente (FALTA)
- [ ] **OAuth 2.0 real** (`/authorize` con redirect y `/token`) — hoy es login directo con JWT
- [ ] **Verificación de veracidad** (comparar con otras fuentes)
- [ ] **Alertas por palabra clave**
- [ ] **Filtro por formato** (artículo/video/podcast) **y rango de edad**
- [ ] **Exportación de historial en CSV**
- [ ] **Roles admin**: gestión de usuarios y moderación de fuentes
- [ ] **Importar/exportar OPML**
- [ ] **Notas personales por artículo** (hoy solo en los recortes)
- [ ] **Feed con scroll vertical estilo TikTok** (hoy es lista normal)
- [ ] **Endpoints `/recommend`, `/feedback`, `/verify`, `/regenerate`**
- [ ] **Gráficas Chart.js** en el dashboard (hoy hay barras en CSS)
- [ ] **Docker** (docker-compose con los 4 servicios)
