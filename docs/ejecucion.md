# Otras formas de ejecutar Portal IA News

Para el uso habitual basta con el menú **`./portal.sh` en Linux** o
**`portal.bat` en Windows**. Esta página reúne las alternativas manuales.

## Docker Compose sin lanzador

Prepará `.env` desde `.env.example` con un `JWT_SECRET` aleatorio propio.
No lo publiques ni reemplaces un `.env` existente al actualizar.
`OAUTH_REDIRECT_URIS` es opcional: si no se define, se admiten las raíces de
`localhost` y `127.0.0.1` en los puertos 80, 8080 y 8090. Para otro dominio,
registrar allí la URL exacta de retorno. Fuera de localhost debe ser HTTPS.

```bash
docker compose -f docker-compose.yml build web
docker compose -f docker-compose.yml up -d
```

Abrir http://localhost. Para descargar modelos:

```bash
docker compose exec ollama ollama pull qwen2.5:3b
docker compose exec ollama ollama pull llama3.2:3b
```

Con GPU NVIDIA disponible en Docker, añadir `-f docker-compose.gpu.yml` tanto
a `build web` como a `up -d`. En Windows se requiere Docker Desktop con WSL2,
contenedores Linux y controladores compatibles. En Linux se necesita NVIDIA
Container Toolkit; el menú `portal.sh` puede configurarlo en Arch/CachyOS.
No se necesita instalar ese toolkit manualmente dentro de Windows.

## Ollama del sistema

El lanzador permite elegir el servidor del host. Configuración de `.env`:

```text
OLLAMA_MODO=host
OLLAMA_HOST_URL=http://host.docker.internal:11434
```

Después, elegir **Iniciar**. En Linux, si Ollama solo escucha en `127.0.0.1`,
hay que configurar una dirección accesible desde Docker. Con systemd se
puede establecer `OLLAMA_HOST` mediante `sudo systemctl edit ollama` y reiniciar
el servicio. No abrir 11434 a Internet: la API no exige contraseña; limitarla
con firewall a la red que la necesita.

Manualmente:

```bash
docker compose -f docker-compose.yml -f docker-compose.host.yml up -d
```

Si venías del contenedor, comprobar primero la conexión al host y luego
detener solo `ianews-ollama`. Los lanzadores verifican antes de detenerlo.
Cambiar de modo no borra modelos. Cada Ollama tiene su propio almacén.

## Usar solo una API externa

Configurar el proveedor desde **IA → API externa** y desactivar el respaldo
local. Con Compose manual se puede usar `docker-compose.host.yml` para no
iniciar el contenedor de Ollama, aunque no haya servidor del host.
El modo host de los lanzadores sí verifica un servidor Ollama externo.

## Node con configuración explícita

`npm start` sirve para desarrollo local sin preparación adicional. Para usar
secreto propio, preparar `.env` y ejecutar:

```bash
npm ci
node --env-file=.env start.js
```

En este caso `OLLAMA_URL` debe apuntar a `http://127.0.0.1:11434`, no al nombre
`ollama` de Docker. Si se definen, `AGENT_URL` y `FEEDS_URL` deben apuntar a
`http://localhost:3003` y `http://localhost:3002`. El lanzador Windows aplica
esas direcciones a su ejecución nativa sin modificar el `.env` de Docker.

Para abrir cada servicio por separado, en cuatro terminales con el mismo entorno:

```bash
node --env-file=.env services/auth/index.js
node --env-file=.env services/feeds/index.js
node --env-file=.env services/agent/index.js
node --env-file=.env web/index.js
```

Abrir http://localhost:8090. Ctrl+C detiene los procesos. No usar las mismas
bases desde dos despliegues a la vez. Detener Docker antes de cambiar a Node.

## Apagado y datos

El menú **Detener** conserva las bases y los modelos. Eliminar contenedores
con `-v` borra el volumen de modelos; borrar `data/` elimina usuarios y noticias.
No son acciones necesarias para actualizar el proyecto.

Para una copia de seguridad: detener el portal y copiar privadamente `data/`
y `.env`. Los modelos Docker están en un volumen aparte.
