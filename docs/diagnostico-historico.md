# Notas históricas de desarrollo (no son la guía vigente)

Este archivo conserva el README anterior por trazabilidad. Sus cifras,
instrucciones y afirmaciones pueden estar desactualizadas. Para ejecutar la
versión de entrega usá [el README principal](../README.md); para conocer sus
límites reales, [la revisión técnica](revision-tecnica.md).

---

# 📰 Portal IA News

Portal de noticias con agente de inteligencia artificial — **3 microservicios + JWT + IA local o API externa**.

> **Estado: 25 oct 2026** — alfa usable. Ya incluye **Docker + Nginx (proxy inverso)**, **temas de color**, **API de IA externa** y **autodescubrimiento de feeds RSS**. Lo que falta está listado abajo en [Pendiente](#pendiente-falta).

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

## Con Docker + Nginx (todo en contenedores)

Levanta **cada microservicio en su propio contenedor** detrás de un **proxy inverso Nginx** que es la única puerta de entrada (puerto **80**). Así el navegador no habla con 4 puertos distintos: Nginx reparte `/auth`, `/feeds` y `/agente`, y sirve la página.

La forma más fácil es el **lanzador** (menú interactivo):

```bash
./portal.sh            # menú: iniciar / detener / estado / logs / eliminar…
```

O a mano:

```bash
cp .env.example .env          # 1) copiar configuración
docker compose build web      # 2) construir la imagen (una sola vez)
docker compose up -d          # 3) levantar todo
# abrir:  http://localhost
```

> Los contenedores **no se reinician solos** al prender la PC (`RESTART_POLICY=no` en `.env`). Si querés que sobrevivan a un reinicio, cambiá esa línea a `unless-stopped`.

Cómo queda el reparto:

| Navegador pide | Nginx lo manda a | Contenedor |
|---|---|---|
| `/auth/...` | `auth:3001` | `ianews-auth` |
| `/feeds/...` | `feeds:3002` | `ianews-feeds` |
| `/agente/...` | `agente:3003` | `ianews-agente` |
| todo lo demás | `web:8090` (frontend) | `ianews-web` |
| — | `ollama:11434` | `ianews-ollama` |

Contenedores: `ianews-nginx`, `ianews-web`, `ianews-auth`, `ianews-feeds`, `ianews-agente`, `ianews-ollama`. Además hay uno efímero, `ianews-init`, que prepara los permisos de `data/` y termina.

### IA local (Ollama)

El contenedor de Ollama arranca **vacío**: hay que bajar los modelos una vez. El propio panel **⚙️ IA** de la página los lista con un botón **⬇️ Descargar** (ideal si no tenés ninguno).

Modelos recomendados (pensados para equipos humildes, ~2 GB de VRAM):

| Modelo | Tamaño | Para qué |
|---|---|---|
| `llama3.2:3b` | 2.0 GB | General: resumir, preguntar, digest (español oficial) |
| `qwen2.5:3b` | 1.9 GB | Clasificar etiquetas (rápido, muy bueno en JSON) |
| `gemma2:2b` | 1.6 GB | Ultra liviano, para PCs con 2 GB de VRAM |

```bash
./portal.sh modelos            # o: bash scripts/docker-ia-modelos.sh
```

- **Con GPU** (mucho más rápido y sin gastar RAM) — un solo comando que hace todo:
  ```bash
  ./portal.sh gpu                # instala nvidia-container-toolkit y levanta con GPU
  ```
  (equivale a `sudo pacman -S nvidia-container-toolkit`, `sudo nvidia-ctk runtime configure --runtime=docker`, `sudo systemctl restart docker` y levantar con `docker-compose.gpu.yml`). El launcher detecta la GPU sola y la usa a partir de ahí.
- **Reusar el Ollama que ya está instalado en la PC** (sin bajar nada, usa tus modelos y tu GPU): poner en el servicio del sistema `OLLAMA_HOST=0.0.0.0`, luego en `.env` descomentar `OLLAMA_URL=http://host.docker.internal:11434` y volver a levantar.

### Comandos útiles

```bash
./portal.sh iniciar            # construir + levantar
./portal.sh detener            # apagar (conserva datos)
./portal.sh estado             # ver contenedores
./portal.sh gpu                # activar la GPU NVIDIA para la IA (pide sudo)
./portal.sh cuantizar          # crea una variante Q4_K_M de un modelo (menos VRAM)
./portal.sh logs agente        # logs en vivo de un servicio
./portal.sh eliminar           # borra contenedores, modelos e imagen
./portal.sh borrar-todo        # borra TODO, incluida la base de datos
npm test                       # 22 pruebas unitarias (seguridad, RSS, auth, IA)
npm run test:feeds             # prueba el autodescubrimiento de feeds (5 sitios reales)
```

Los datos (`data/`) se guardan en tu carpeta del proyecto, así que **no se pierden** al apagar los contenedores.

## Estructura

```
portal-ianews/
├── start.js            # arranca los 4 servicios con un solo comando (modo sin Docker)
├── portal.sh           # LANZADOR: iniciar / detener / estado / logs / eliminar
├── Dockerfile          # imagen de los microservicios Node
├── docker-compose.yml  # 4 servicios + Nginx (proxy) + Ollama + init-datos
├── docker-compose.gpu.yml  # sobrecapa para dar GPU al contenedor de Ollama
├── .env.example        # configuración (JWT_SECRET obligatorio, OLLAMA_URL, rendimiento)
├── deploy/nginx/       # configuración del proxy inverso (gzip, CSP, límites)
├── scripts/            # modelos, cuantización, GPU y prueba de feeds
├── tests/              # pruebas unitarias (node:test, sin dependencias)
├── services/
│   ├── shared/         # seguridad HTTP, SSRF, entorno, taxonomía y utilidades
│   │   ├── env.js      #   variables de entorno y validación de JWT_SECRET
│   │   ├── http.js     #   cabeceras, CORS, rate limit, lectura acotada
│   │   ├── url-segura.js#  bloqueo de redes internas (SSRF + DNS rebinding)
│   │   ├── taxonomia.js#   las 30 categorías y el clasificador por reglas
│   │   └── async.js    #   mapLimit (concurrencia acotada)
│   ├── auth/           # registro, login, JWT, perfil (puerto 3001)
│   │   ├── index.js    #   rutas y persistencia
│   │   ├── password.js #   scrypt asíncrono + comparación en tiempo constante
│   │   └── validacion.js#  email, contraseña e imágenes reales
│   ├── feeds/          # fuentes RSS, artículos, feed (puerto 3002)
│   │   ├── index.js    #   endpoints, índices, caché y colas por lotes
│   │   └── rss.js      #   descubre el feed, parsea XML roto y descarga seguro
│   └── agent/          # agente IA (puerto 3003)
│       ├── index.js    #   SOLO rutas HTTP, validación y límites
│       ├── config.js   #   preferencias por usuario (data/ia.json)
│       └── ai/         #   lógica de modelos, aislada del negocio
│           ├── ollama.js    # cola de inferencia y opciones de GPU
│           ├── providers.js # APIs externas compatibles con OpenAI + Gemini
│           ├── engine.js    # decide API vs local (y el respaldo opcional)
│           ├── prompts.js   # plantillas de los prompts
│           ├── rules.js     # clasificador por reglas y recortes de texto
│           ├── models.js    # recomendación/elección de modelos
│           └── translate.js # caché y traducción por lotes
├── web/                # frontend (puerto 8090)
│   └── public/
│       ├── catalogo.js # catálogo de ~150 portales tech con RSS
│       ├── img/        # iconos propios del menú (SVG/PNG)
│       ├── app.js
│       └── style.css
└── data/               # bases de datos y llaves de IA (NO se sube a git)
```

> ⚠️ **Seguridad**: `data/` está en `.gitignore` porque contiene las bases de datos y las llaves API de cada usuario. Nunca lo suban a GitHub.

## Arquitectura

| Microservicio | Puerto | Qué hace |
|---|---|---|
| `services/auth` | 3001 | Registro/login, JWT, perfil y foto de usuario |
| `services/feeds` | 3002 | Fuentes RSS, artículos, feed "Para Ti", portadas por fuente, recortes, estadísticas |
| `services/agent` | 3003 | Agente IA: clasificar, resumir, digest, preguntas (anti-rechazo), traducir, config de IA |
| `web` | 8090 | Página (frontend) |

Comunicación: el frontend (y entre sí) hablan por HTTP con `Authorization: Bearer <JWT>`.

> **Separación de responsabilidades**: `services/agent/index.js` solo atiende HTTP y validación; la IA vive en `services/agent/ai/` y las preferencias en `config.js`. Si mañana cambia el motor (otro Ollama, otro proveedor), no se toca la lógica de negocio.

## Seguridad

- **JWT_SECRET obligatorio** (mínimo 32 caracteres). Si falta o es el de ejemplo, los servicios **no arrancan** en producción (`NODE_ENV=production`). Generá uno con `openssl rand -hex 32`.
- **Anti-SSRF**: las URLs de feeds y de APIs externas se validan por protocolo, credenciales y **todas las IPs resueltas**; la conexión real vuelve a comprobar la IP (`lookup`) para evitar DNS rebinding. Se bloquean loopback, redes privadas, CGNAT, link-local/metadatos (`169.254.169.254`), multicast y rangos reservados.
- **Descarga de feeds acotada**: redirecciones manuales (máx. 5, cada una revalidada), tope de 6 MB **mientras se descarga** (aunque no haya `Content-Length`) y descompresión gzip/deflate/br.
- **Contraseñas**: scrypt asíncrono (no bloquea el event loop) y comparación en tiempo constante; mínimo 8 caracteres.
- **Fotos de perfil**: se detecta el tipo real por *magic bytes* (PNG/JPG/GIF/WEBP). HTML, SVG y ejecutables se rechazan; los archivos se sirven con `nosniff` y `CSP: default-src 'none'; sandbox`.
- **Límites**: rate limit por usuario/IP en login, registro, feeds, agente, descargas de modelos y refrescos; topes de tamaño en cuerpos JSON y en los textos que van a la IA.
- **Cabeceras**: Nginx agrega CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` y `server_tokens off`. Los microservicios también las envían (por si corrés sin Docker).
- **Contenedores**: `no-new-privileges`, `cap_drop: ALL`, usuario `1000:1000`, `init: true` y `RESTART_POLICY=no`.
- **Config de IA**: `data/ia.json` se escribe de forma atómica con permisos `600` (las API keys no quedan legibles por otros).

## Rendimiento y consumo de GPU

- **Consultas más livianas**: las listas ya no traen `contenido_html` (hasta 20 KB por fila); el feed bajó de ~0,96 MB a ~0,64 MB y las estadísticas de ~5,6 ms a ~2 ms (caché de 20 s). Índices SQLite + WAL.
- **Menos llamadas a la IA**: clasificación y traducción van a **colas por lotes** (`/classify-batch`, título+cuerpo en una sola petición cuando se puede), con concurrencia limitada y reintentos. La traducción se cachea en memoria.
- **Una sola GPU**: la cola de Ollama limita la concurrencia (`OLLAMA_NUM_PARALLEL=1`) y el tamaño de la cola; el healthcheck usa una caché de 5 s para no despertar la GPU.
- **Ajustes de inferencia** (en `.env`, opcionales): `OLLAMA_NUM_CTX`, `OLLAMA_NUM_BATCH`, `OLLAMA_NUM_PREDICT`, `OLLAMA_NUM_PREDICT_CLASIFICAR`, `OLLAMA_KEEP_ALIVE`. Menos contexto/tanda = menos VRAM. Clasificar usa 160 tokens y resumir 700.
- **Cuantización**: los modelos recomendados ya son **Q4_K_M**. Además el compose activa `OLLAMA_KV_CACHE_TYPE=q8_0` y `OLLAMA_FLASH_ATTENTION=1` (la caché KV ocupa ~la mitad). Para convertir un modelo propio: `./portal.sh cuantizar`.
- **Nginx** comprime JSON/JS/CSS con gzip y cachea estáticos (7 días para imágenes, `no-cache` para el HTML).
- **Con "API externa" la IA local no se usa**: no se carga ningún modelo en la GPU salvo que actives la casilla de respaldo local.

## Recorrido rápido
1. Crear cuenta en la página
2. "Mis fuentes" → **catálogo con buscador** (~150 portales por categoría, un clic para agregar) o presets rápidos. En "Agregar portal" podés pegar **la dirección del sitio** (no hace falta el enlace del RSS): el sistema **busca el feed** y guarda la URL correcta.
3. "Para Ti" → feed ordenado por prioridad; **🎛 Prioridades** arriba del feed y **▲▼** en cada tarjeta; clic en cualquier parte de la tarjeta abre la noticia
4. Burbujas superiores → **portada** de esa fuente estilo periódico
5. Abrir una noticia → **el texto de la noticia tal como lo publica el medio, con sus imágenes y videos en el mismo orden** (se usa solo lo que trae el RSS; no se copia la página original). Debajo, el resumen IA a demanda y el botón "Ver fuente" para la nota completa.
6. "☀ Digest de hoy" → resumen del día con IA
7. "Mi perfil" → foto, nombre, **🎨 tema de color** (8 combinaciones + **Personalizado** con 4 colores propios), **🔠 texto e iconos** (tipo de letra, tamaño de la letra, color de las letras —9 fijos, automático o **color personalizado**— y tamaño de los iconos), **🌈 aros de las noticias** (12 paletas de color para los estados), **idioma de las noticias** (Español / English) y etiquetas de interés. Todo se guarda en tu cuenta. En Español, las noticias que vengan en otro idioma se traducen solas (título y cuerpo).
8. "⚙️ IA" → motor local (Ollama) o **API externa** (Google AI Studio/Gemini, Claude, Groq, OpenAI, DeepSeek, OpenRouter). Botón **🔄 Ver modelos** que lista los modelos que tu propia API key tiene disponibles, para elegir de una lista en vez de escribirlo a mano.
9. **Buscar**: filtra mientras escribís; **Enter fija la búsqueda** (la barra se vacía y aparece un chip 🔎 que podés quitar). Clic en tu **nombre/foto** del topbar → te lleva a tu perfil.

## Probar con Postman (lo que pide el inge)
1. `POST localhost:3001/register` (body: `{"email":"a@a.com","password":"ClaveSegura123","nombre":"Yo"}`) → copia el `token`
2. En Headers: `Authorization: Bearer <token>`
3. `GET localhost:3002/feeds` / `POST localhost:3002/feeds` / `GET localhost:3002/feed` / `GET localhost:3002/articles/:id`
4. `POST localhost:3003/summarize` (body: `{"titulo":"...","texto":"..."}`)
5. `GET localhost:3003/config` y `POST localhost:3003/config/test` (configuración de IA)

## 🔧 Errores comunes y soluciones (Troubleshooting)

Todos estos fallos **ya están resueltos en el código**; acá quedan documentados por si
te vuelven a aparecer, si trabajás sobre una versión vieja o si tenés que explicarlos en
clase. Formato: **síntoma → causa → solución**.

### Arranque rápido (TL;DR)

```bash
cp .env.example .env        # 1) configuración (una sola vez)
./portal.sh iniciar         # 2) construye + levanta todo
# abrir http://localhost
./portal.sh estado          # 3) los 6 contenedores deben decir "healthy"
./portal.sh detener         # 4) apagar (los datos NO se pierden)
```

Sin Docker: `npm install && npm start` → abrir **http://localhost:8090**.
Con IA local: `./portal.sh modelos` (baja los modelos) y, si tenés NVIDIA, `./portal.sh gpu`.

---

### 🐳 Docker y arranque

**1. `docker compose up` falla con "image ... already exists" / builds en paralelo**
- *Causa:* los 4 servicios comparten **una misma imagen**; en Docker 29 construir varios a la vez choca.
- *Solución:* construir **una sola vez** y después levantar: `docker compose build web && docker compose up -d`. El launcher (`./portal.sh iniciar`) ya lo hace así.

**2. "permission denied" al usar Docker, o "el servicio de Docker no está corriendo"**
- *Causa:* el motor está apagado o tu usuario no está en el grupo `docker`.
- *Solución:* `sudo systemctl start docker` y, si sigue, `sudo usermod -aG docker $USER` (cerrá sesión y volvé a entrar).

**3. Los contenedores se levantan solos al prender la PC**
- *Causa:* política de reinicio del contenedor.
- *Solución:* ya está en `RESTART_POLICY=no` (`.env`). Si querés que sobrevivan a un reinicio, cambialo a `unless-stopped`.

**4. Puerto 80 ocupado ("address already in use")**
- *Causa:* otro servidor (Apache, nginx del sistema, otro proyecto) usa el 80.
- *Solución:* `sudo lsof -i :80` para ver quién lo tiene, y o lo pará, o cambiá el mapeo en `docker-compose.yml` (`"8080:80"` → abrir `http://localhost:8080`).

---

### 🌐 Nginx / proxy inverso

**5. Después de recrear un contenedor aparece "502 Bad Gateway"**
- *Causa:* Nginx resuelve el nombre del contenedor **una sola vez al arrancar** y se queda con la IP vieja.
- *Solución:* ya resuelto en `deploy/nginx/default.conf` con `resolver 127.0.0.11 valid=10s` + `set $destino ...` + `rewrite`, así re-resuelve la IP en cada request.

**6. `/auth`, `/feeds` o `/agente` dan 404 desde el navegador**
- *Causa:* el frontend no está saliendo por el proxy (estás en el puerto 8090 pero esperando el 80, o al revés).
- *Solución:* la página detecta sola si está detrás del proxy (`location.port !== '8090'`). Si abrís por el 80, tiene que ir todo por `/auth`, `/feeds`, `/agente`.

**7. Cambié el código y el navegador sigue mostrando lo viejo**
- *Causa:* con Docker los archivos van **dentro de la imagen**, y además el navegador cachea.
- *Solución:* reconstruir la imagen (`docker compose build web && docker compose up -d`) y recargar con **Ctrl + Shift + R**.

---

### 🗄️ Backend / base de datos

**8. HTTP 500 al guardar un recorte (u otra acción con SQL)**
- *Causa:* `node:sqlite` **rechaza parámetros `undefined`** (`a.fuente` venía sin el `JOIN` con `sources`).
- *Solución:* el `SELECT` de recortes ahora hace `JOIN sources` y **todo valor se coacciona a `null`** antes de pasarlo a `.run()`. Regla general del proyecto: nunca pasar `undefined` a SQL.

**9. Se crea un archivo raro `*.db-journal` o la base se bloquea**
- *Causa:* SQLite en modo journal mientras corre el contenedor.
- *Solución:* es normal; esos archivos están en `.gitignore` y no se suben. No borres la carpeta `data/` con el sistema encendido.

**9 bis. Borré `data/` para empezar de cero y auth falla con `EACCES: permission denied, mkdir '/app/data/uploads'`**
- *Causa:* al no existir, Docker crea `./data` como **root**, pero los servicios corren como usuario `1000` y no pueden escribir.
- *Solución:* ya está resuelto con el servicio de un solo uso **`init-datos`**, que crea `data/uploads`, le da el dueño `1000:1000` y arranca antes que auth/feeds/agente. Con `./portal.sh iniciar` (o `docker compose up -d`) se ejecuta solo. Si lo hacés a mano: `docker compose up -d init-datos` y después `docker compose up -d`.
- *Verificación:* `ls -ld data data/uploads` debe mostrar tu usuario (no `root`), y `docker compose ps` tiene que mostrar `ianews-auth` y `ianews-feeds` en **healthy**.

**10. "data/" aparece en `git status`**
- *Causa:* las bases y las llaves API viven ahí.
- *Solución:* **nunca** subirlo. Ya está ignorado (`data/`, `*.db`, `.env*`). Solo se versiona `.env.example`.

---

### 🤖 IA

**11. Ollama se queda cargado y consume RAM/VRAM aunque no uses la IA**
- *Causa:* por defecto Ollama deja el modelo en memoria 5 minutos.
- *Solución:* el contenedor ya arranca con `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_NUM_PARALLEL=1` y `OLLAMA_KEEP_ALIVE=30s` (30 s y se descarga). `OLLAMA_KEEP_ALIVE=0` lo descarga al instante.

**12. La IA local corre en CPU en vez de la GPU**
- *Causa:* falta el runtime de NVIDIA para Docker.
- *Solución:* `./portal.sh gpu` (instala `nvidia-container-toolkit`, configura Docker y levanta con la sobrecapa `docker-compose.gpu.yml`). Verificá con `docker compose exec ollama ollama ps` → debe decir **100 % GPU**.

**13. Uso "API externa" pero la PC igual se pone lenta / usa la GPU**
- *Causa:* el **trabajo de fondo** (clasificar y traducir al importar) se hacía con un token interno *sin usuario*, así que el motor aplicaba la config **por defecto = IA local**.
- *Solución:* el servicio `feeds` ahora manda **a qué usuario pertenecen** las noticias y el agente usa **la config de ese usuario** (`uidDe()`). Con "API externa" la IA local **no se toca** (hay una casilla opcional "usar IA local como respaldo").

**14. Gemini: "el modelo … no existe o ya no está disponible"**
- *Causa:* Google retira modelos seguido (p. ej. `gemini-2.0-flash`).
- *Solución:* hay **migración automática** a `gemini-2.5-flash` en `getConfig`.

**15. "🔄 Ver modelos" lista 41 modelos pero el que elijo da 404**
- *Causa:* la lista sale de la API **nativa** de Google, pero las peticiones iban por la capa "**compatible con OpenAI**", que **no expone todos** los modelos.
- *Solución:* el agente ahora **usa la API nativa de Gemini** (`…:generateContent`), así que cualquier modelo de la lista funciona.

**16. El desplegable de modelos no mostraba nada**
- *Causa:* usaba un `<datalist>`, y el navegador lo despliega de forma poco fiable.
- *Solución:* ahora es un **`<select>` real** que se llena al pulsar "🔄 Ver modelos".

**17. La traducción automática falla o vuelve vacía**
- *Causa:* el endpoint *batch* de Google (`translate_a/t?client=gtx`) está **bloqueado desde algunas IPs**.
- *Solución:* se usa `translate_a/single?client=dict-chrome-ex` (funciona) con **MyMemory** y tu motor de IA como respaldo.

**18. Las respuestas de la IA salen con `**asteriscos**` y viñetas feas**
- *Causa:* el modelo devuelve **Markdown** y antes se mostraba como texto plano.
- *Solución:* el frontend lo renderiza (negritas, viñetas, `código`) en resumen, preguntas y digest. Tanto el resumen como las preguntas se abren en un **panel lateral** que entra desde la derecha: no mueven el artículo que estás leyendo.

**19. La IA responde "reglas" y avisa que no está disponible**
- *Causa:* el volumen de Ollama está **vacío** (no hay modelos). Pasa, por ejemplo, después de `./portal.sh eliminar` o `borrar-todo`, que borran el volumen de modelos a propósito.
- *Solución:* `./portal.sh modelos` (o `bash scripts/docker-ia-modelos.sh`) para bajar `llama3.2:3b` y `qwen2.5:3b`. Verificá con `docker compose exec ollama ollama list`.
- *Nota:* el aviso en pantalla muestra el error real y el panel etiqueta el motor usado (`ollama:…`, `api:…` o `reglas`).

**20. Descargué un modelo mejor y la IA sigue usando el anterior**
- *Causa:* antes la elección automática quedaba fijada al arrancar el servicio.
- *Solución:* ahora se recalcula cuando cambia la lista de modelos instalados. No hace falta reiniciar: la próxima respuesta ya usa el mejor disponible (`llama3.2:3b` para texto, `qwen2.5:3b` para clasificar).

---

### 🖥️ Frontend

**19. Al abrir noticias rápido se "mezclaba" el contenido de una con otra**
- *Causa:* **condición de carrera** — una traducción o respuesta que venía en camino aterrizaba en la noticia nueva.
- *Solución:* cada noticia tiene un **token**; si cambiaste de noticia, la respuesta vieja se descarta. Al cerrar el modal también se invalida lo pendiente.

**20. El modal mostraba la página original entera (scrapeada)**
- *Causa:* se "enriquecía" copiando el HTML del medio.
- *Solución:* ahora el cuerpo se arma **solo con lo que trae el RSS** (texto + imágenes/YouTube/Vimeo en su orden). Para la nota completa está el botón **"Ver fuente ↗"**.

**21. La barra de acciones "Resumir / Preguntar / …" desaparecía al bajar**
- *Causa:* estaba al final del contenido.
- *Solución:* ahora es una **barra fija** (`position: sticky`) al pie del modal, y se puede **ocultar** con la pestañita "⌄ Ocultar acciones".

**22. El tema de color no se aplica / se pierde al cambiar de PC**
- *Causa:* solo se miraba el navegador.
- *Solución:* el tema se guarda en la **cuenta** (`users.tema`) y en `localStorage` (para que se vea al instante). Al iniciar sesión manda el de la cuenta.

**23. Tras actualizar, veo la versión vieja del sitio**
- *Solución:* **Ctrl + Shift + R**. Y si tocaste archivos del frontend con Docker: `docker compose build web && docker compose up -d`.

---

### 📰 Fuentes y feeds RSS

**24. "No se pudo leer ese RSS: Status code 404" / "Unexpected close tag…" (sitio real que sí existe)**
- *Síntoma:* pegás la dirección de un portal real (p. ej. `https://laboratoriolinux.es/index.php`) y falla aunque el sitio abra bien en el navegador.
- *Causa:* **estabas pegando la página web, no el feed.** Dos mensajes distintos para el mismo problema:
  - `Status code 404` → en esa ruta no hay feed.
  - `Unexpected close tag` → el parser intentaba leer **HTML** como si fuera XML (de ahí el "close tag").
- *Solución:* `services/feeds/rss.js` ahora hace **autodescubrimiento**. Al agregar una fuente:
  1. Si ya es un feed, lo usa.
  2. Si es una página, busca el feed que el propio sitio declara (`<link rel="alternate" type="application/rss+xml">`), después enlaces tipo "RSS/Suscribirse" y por último rutas típicas: `/feed`, `/rss.xml`, `/?feed=rss2`, Joomla `?format=feed&type=rss`, Blogger `/feeds/posts/default`, WordPress `/wp-json/wp/v2/posts`, etc.
  3. Guarda **la URL del feed** (no la de la página) y te avisa: *"feed detectado: …"*.
- *Bonus:* las fuentes viejas **se arreglan solas** en el siguiente refresco (si la URL guardada no es un feed, se corrige en la base).

**25. Un feed real tiene el XML roto y no carga**
- *Causa:* `&` sin escapar, `<br>` sin cerrar dentro de una descripción, `&nbsp;`/`&mdash;` (entidades HTML, no XML), un aviso de PHP antes del `<?xml?>`, o basura después del `</rss>`.
- *Solución:* antes de parsear se **sanea** el XML (entidades, caracteres de control, basura alrededor de la raíz) y se reintenta con un parser **tolerante**; si aún así falla, se **rescatan los `<item>`** a mano. También se normalizan títulos con entidades (`&quot;` → `"`) y se convierten los enlaces relativos en absolutos.

**26. El sitio bloquea las lecturas automáticas (HTTP 403)**
- *Causa:* protección anti-bot/Cloudflare.
- *Solución:* se descarga con **User-Agent de navegador** y cabeceras `Accept` de feed, lo que evita la mayoría de los bloqueos. Si el sitio igual bloquea, el mensaje ahora lo dice explícitamente en vez de mostrar un error técnico.

**27. Hay que ser paciente con un sitio sin feed**
- *Causa:* si no hay feed, se prueban hasta ~25 direcciones candidatas.
- *Solución:* se prueban **4 en paralelo** con 8 s de espera y se corta en cuanto una funciona. Normal: 0,2–2 s. Peor caso (sitio caído): unos 25 s y después un mensaje claro.

---

### 📋 Chuleta de diagnóstico

```bash
./portal.sh estado                                   # ¿todo "healthy"?
./portal.sh logs agente                              # logs en vivo (auth/feeds/agente/web/nginx/ollama)
curl -s localhost/agente/health                      # ¿responde la IA?
docker compose exec ollama ollama ps                 # ¿modelo cargado? ¿GPU o CPU?
docker compose exec ollama ollama list               # modelos instalados
docker compose config >/dev/null && echo "compose OK" # valida el YAML
npm run test:feeds                                   # ¿el autodescubrimiento de RSS anda?
curl -s -X POST localhost/feeds/feeds/test -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"url":"https://www.theverge.com"}'
```

## Estado

### Hecho ✅
- Registro/login con JWT y roles en el token; perfil con foto e intereses
- CRUD de fuentes RSS con prueba de URL, pausa y presets; **catálogo de ~150 portales** con buscador y acordeones por categoría
- **Agregar portal a prueba de balas**: pegás la **página** del medio y el sistema **encuentra su RSS** (autodescubrimiento + rutas típicas + WordPress/Joomla/Blogger/FeedBurner) y guarda la URL correcta; las fuentes viejas se autocorrigen. Parser tolerante para feeds con XML roto
- **Prioridades solo en el feed** (panel con sliders + ▲▼ inline en las tarjetas)
- Importación automática (cada 15 min), clasificación con **30 categorías** en español (IA con fallback a reglas)
- Feed "Para Ti" con burbujas → **portada por fuente**, filtros por tiempo, búsqueda con debounce y etiquetas
- **Buscador mejorado**: filtra en vivo mientras escribís, con **Enter fija la búsqueda** (la barra se vacía sola y queda un chip 🔎 quitable), botón ✕ para limpiar y Escape para reiniciar
- **🎨 Temas de color** (8 combinaciones: Oscuro, Claro, Cian, Púrpura, Celeste, Rojo, Verde, Naranja + **Personalizado**) elegibles desde el **perfil** o desde el topbar; se **guardan en la cuenta** y se aplican en todos los dispositivos. El tema **Personalizado** guarda tus propios colores de fondo, tarjetas, acento y texto
- **🌈 Aros de las noticias**: 12 paletas de color (Instagram, Atardecer, Océano, Bosque, Neón, Oro, Rubí, Lavanda, Menta, Gris, Fuego e Hielo) para los aros de las fuentes y el estado de cada noticia (brillante = sin leer, atenuado = leída). Se guardan en la cuenta
- **Identidad propia**: iconos del menú (periódico, satélite, usuario, panel e IA) en `web/public/img/`, **favicon con el periódico** en la pestaña del navegador (`favicon.ico` + PNG 32/512 + apple-touch-icon) y **botón de salir con el icono de apagado** junto a tu foto
- **Perfil → "Texto e iconos" (accesibilidad)**: **tipo de letra** (sistema, Verdana, Trebuchet, redondeada, Georgia, monoespaciada), **tamaño de la letra** (pequeña → muy grande, escala todo el sitio), **color de las letras** (10 opciones, automático según el tema o **color personalizado** con selector) y **tamaño de los iconos** (chicos → muy grandes). Se guarda en la cuenta (`users.fuente`, `tamano_texto`, `color_texto`, `color_texto_hex`, `tamano_iconos`), se aplica al instante y hay botón **↺ Restablecer**
- **Orden del menú**: Para Ti → Mis fuentes → Archivados → Panel → IA → Mi perfil
- **Espaciado más cómodo** en tarjetas, campos, botones, iconos, noticias archivadas, recortes y en la vista previa del perfil (separada del botón Restablecer)
- **Topbar**: tu nombre y foto ahora son un **botón que te lleva a Mi perfil**
- Modal de noticia: **texto de la noticia con su multimedia (imágenes, YouTube, Vimeo) en orden**, tomado del RSS (sin copiar la página original), resumen detallado con puntos clave a demanda, preguntar a la IA, recortes, Ver fuente
- **Preferencia de idioma** (Español por defecto): traduce automáticamente el cuerpo de las noticias que vienen en otro idioma, conservando imágenes y videos en su lugar
- **Recortes** funcionando (guardar fragmento desde una noticia y verlos en Archivados)
- **IA anti-rechazo**: si el modelo se niega con info pública, reintenta automáticamente con instrucción reforzada
- Archivados, favoritos, leídos (sin recargar el feed), "no me interesa", panel de estadísticas
- Traducción automática al español (Google con respaldos)
- Imágenes y videos de las noticias
- **Panel ⚙️ IA**: motor local (Ollama) o API externa (Gemini/Groq/OpenAI/DeepSeek/OpenRouter), modelo por tarea, traducción y botón de prueba, guardado por usuario
- **Gemini con API nativa**: los modelos del botón "🔄 Ver modelos" son exactamente los que funcionan (la capa "compatible OpenAI" de Google no expone todos)
- **El trabajo de fondo respeta tu configuración**: clasificar y traducir al importar usan el motor del **dueño de las noticias**. Con "API externa" la **IA local no se usa** (no toca tu GPU); casilla opcional para habilitarla como respaldo
- **Respuestas de la IA con formato** (negritas y viñetas reales, sin asteriscos sueltos) en resumen, preguntas y digest
- **Barra de acciones fija** en el modal de la noticia (siempre visible, se puede ocultar) y sin mezclar respuestas si abrís otra noticia rápido
- **Auditoría ISO 25010/25000**: SSRF, JWT_SECRET obligatorio, rate limits, validación de imágenes por contenido, CSP y cabeceras, límites de entrada y pruebas unitarias (`npm test`)
- **Rendimiento**: consultas sin `contenido_html`, índices + WAL, caché de estadísticas y traducciones, clasificación/traducción por lotes y cola de inferencia con concurrencia limitada
- **Cuantización**: modelos Q4 recomendados, caché KV `q8_0`, flash attention y `./portal.sh cuantizar` para convertir modelos propios
- **Arquitectura modular**: `services/shared/` (seguridad y utilidades) y `services/agent/ai/` (IA separada de las rutas y del negocio)

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
- [x] **Docker + Nginx**: cada microservicio en su contenedor, detrás de un proxy inverso Nginx (puerto 80)
# Elegir dónde se ejecuta Ollama

La web y sus servicios pueden seguir en Docker aunque los modelos corran fuera:

```bash
./portal.sh motor docker  # contenedor; GPU automática si existe runtime NVIDIA
./portal.sh iniciar

./portal.sh motor host    # Ollama del sistema; no inicia el contenedor Ollama
./portal.sh iniciar
./portal.sh motor estado
```

La elección queda en `.env` (`OLLAMA_MODO`). Aplicala con el lanzador, no con
`docker compose up` a secas (ese comando no selecciona las sobrecapas).
Los modelos del sistema y del contenedor son almacenes independientes; cambiar
de modo no borra ninguno. En modo host, elegí tus modelos instalados en ⚙️ IA.

El modo host usa `OLLAMA_HOST_URL` (por defecto
`http://host.docker.internal:11434`). En Linux, un Ollama que escucha solo en
`127.0.0.1` **no es accesible desde la red del contenedor**. El lanzador verifica
la conexión antes de detener el Ollama de Docker. Para configurar el servicio:

```ini
# sudo systemctl edit ollama
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
```

Después: `sudo systemctl daemon-reload` y `sudo systemctl restart ollama`.
**Seguridad:** la API de Ollama no exige contraseña. Preferí enlazar a una IP
del puente Docker, o restringí 11434 en el firewall a la red Docker antes de
escuchar en `0.0.0.0`; no la expongas a Internet/LAN sin protección.
El lanzador no cambia el servicio del sistema ni sus reglas de firewall.

GPU no significa CPU al 0 %: tokenización, carga y parte del procesamiento
siguen usando CPU. Comprobá `ollama ps` durante una generación (en Docker:
`docker compose exec ollama ollama ps`) y las capas GPU en los logs. La GPU
en reposo puede marcar 0 % y `ollama ps` vacío no indica un fallo.

## Comprobar una API externa

En **⚙️ IA → API externa**, elegí proveedor, ingresá su clave, pulsá
**Ver modelos**, seleccioná uno y pulsá **Probar conexión**. Solo después de
una respuesta correcta guardá la configuración. La prueba no guarda cambios
ni usa Ollama de respaldo para aparentar una conexión exitosa.

Claude usa la API nativa de Anthropic; Gemini usa la API nativa de Google.
OpenAI, Groq, DeepSeek, OpenRouter y Personalizado usan el protocolo OpenAI.
Al cambiar de proveedor o dominio no se reutiliza la clave anterior.
Los errores 401/403 indican problemas de acceso y 429 indica cuota o límites.

`npm test` incluye pruebas **simuladas** de los siete proveedores, listado de
modelos, errores y cancelación. No comprueba el saldo ni la validez de claves
reales: eso requiere la prueba de conexión con la cuenta del usuario.
