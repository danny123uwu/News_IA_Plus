# 📰 Portal IA News

Portal de noticias con agente de inteligencia artificial — **3 microservicios + JWT + IA local o API externa**.

> **Estado: 7 oct 2026** — alfa usable. Lo que falta está listado abajo en [Pendiente](#pendiente-falta).

## Requisitos
- Node.js 22+ (usa `node:sqlite` incluido, sin instalar nada más)
- Ollama corriendo con algún modelo (opcional — sin él funciona con reglas locales)

## Cómo correrlo

```bash
git clone https://github.com/danny123uwu/News_IA_Plus.git
cd News_IA_Plus
npm install
npm start
```

Abrir **http://localhost:8090**

En la primera ejecución se crea solo la carpeta `data/` con las bases de datos — no hace falta configurar nada.

## Estructura

```
portal-ianews/
├── start.js            # arranca los 4 servicios con un solo comando
├── services/
│   ├── auth/           # registro, login, JWT, perfil (puerto 3001)
│   ├── feeds/          # fuentes RSS, artículos, feed (puerto 3002)
│   └── agent/          # agente IA (puerto 3003)
├── web/                # frontend (puerto 8090)
└── data/               # bases de datos y llaves de IA (NO se sube a git)
```

> ⚠️ **Seguridad**: `data/` está en `.gitignore` porque contiene las bases de datos y las llaves API de cada usuario. Nunca lo suban a GitHub.

## Arquitectura

| Microservicio | Puerto | Qué hace |
|---|---|---|
| `services/auth` | 3001 | Registro/login, JWT, perfil y foto de usuario |
| `services/feeds` | 3002 | Fuentes RSS, artículos, feed "Para Ti", recortes, estadísticas, imágenes y videos |
| `services/agent` | 3003 | Agente IA: clasificar, resumir, digest, preguntas, traducir, config de IA |
| `web` | 8090 | Página (frontend) |

Comunicación: el frontend (y entre sí) hablan por HTTP con `Authorization: Bearer <JWT>`.

## Recorrido rápido
1. Crear cuenta en la página
2. "Mis fuentes" → agregar un preset (The Verge, PC Gamer, Ars Technica)
3. "Para Ti" → ver el feed ordenado por prioridad; botones de resumir IA, favorito, archivar, "no me interesa"
4. Abrir una noticia → seleccionar texto → "Guardar recorte"
5. "☀ Digest de hoy" → resumen del día con IA
6. "Mi perfil" → foto, nombre y etiquetas de interés
7. "Panel" → estadísticas
8. "⚙️ IA" → elegir motor (Ollama local o API externa), modelos por tarea y traducción

## Probar con Postman (lo que pide el inge)
1. `POST localhost:3001/register` (body: `{"email":"a@a.com","password":"1234","nombre":"Yo"}`) → copia el `token`
2. En Headers: `Authorization: Bearer <token>`
3. `GET localhost:3002/feeds` / `POST localhost:3002/feeds` / `GET localhost:3002/feed`
4. `POST localhost:3003/summarize` (body: `{"titulo":"...","texto":"..."}`)
5. `GET localhost:3003/config` y `POST localhost:3003/config/test` (configuración de IA)

## Estado

### Hecho ✅
- Registro/login con JWT y roles en el token; perfil con foto e intereses
- CRUD de fuentes RSS con prueba de URL, prioridad, pausa y presets
- Importación automática (cada 15 min), clasificación por IA con fallback a reglas
- Feed "Para Ti" con burbujas, filtros por tiempo, búsqueda y etiquetas
- Modal de noticia: resumen ~150 palabras, preguntar a la IA, recortes, link original
- Archivados, favoritos, leídos, "no me interesa", panel de estadísticas
- Traducción automática al español (Google con respaldos)
- Imágenes (230) y videos (18) de las noticias
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
