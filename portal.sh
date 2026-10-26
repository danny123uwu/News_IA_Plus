#!/usr/bin/env bash
# ============================================================================
#  Portal IA News — LANZADOR
#
#  Inicia, detiene y borra todo el sistema de contenedores (Docker + Nginx).
#  Los contenedores NO se reinician solos al prender la PC (política "no").
#
#  Uso:   ./portal.sh            -> menú interactivo
#         ./portal.sh iniciar    -> levanta todo
#         ./portal.sh detener    -> apaga (conserva contenedores y datos)
#         ./portal.sh estado     -> ver contenedores
#         ./portal.sh logs agente-> ver logs en vivo
#         ./portal.sh modelos    -> descarga los modelos de IA recomendados
#         ./portal.sh cuantizar  -> crea una variante Q4_K_M de un modelo (menos VRAM)
#         ./portal.sh gpu        -> activa la GPU NVIDIA para la IA (pide sudo)
#         ./portal.sh motor host|docker|estado -> elige dónde ejecutar los modelos
#         ./portal.sh eliminar   -> borra contenedores, modelos e imagen
#         ./portal.sh borrar-todo-> elimina TODO (incluida tu base de datos)
#         ./portal.sh ayuda      -> esta ayuda
# ============================================================================

# Ir siempre a la carpeta del proyecto (aunque lo llames desde otro lado)
cd "$(dirname "$(readlink -f "$0")")" || exit 1

VERDE='\033[1;32m'; ROJO='\033[1;31m'; AMAR='\033[1;33m'; AZUL='\033[1;36m'; SIN='\033[0m'

if ! command -v docker >/dev/null 2>&1; then
  echo -e "${ROJO}Docker no está instalado.${SIN} Instalalo o usá el modo sin Docker: npm start"
  exit 1
fi

# El motor de docker tiene que estar encendido
if ! docker info >/dev/null 2>&1; then
  echo -e "${ROJO}El servicio de Docker no está corriendo.${SIN}"
  echo "Encendelo con:  sudo systemctl start docker"
  exit 1
fi

# Si Docker ya tiene el runtime de NVIDIA, se usa la sobrecapa de GPU para que
# Ollama corra en la tarjeta gráfica en lugar de la CPU/RAM. Si no, va normal.
MODO_IA="${OLLAMA_MODO:-$(sed -n 's/^OLLAMA_MODO=//p' .env 2>/dev/null | tail -1)}"
MODO_IA="${MODO_IA:-docker}"
COMPOSE=(docker compose -f docker-compose.yml)
if [ "$MODO_IA" = host ]; then
  COMPOSE+=(-f docker-compose.host.yml)
elif [ "$MODO_IA" != docker ]; then
  echo "OLLAMA_MODO inválido: usá host o docker."
  exit 1
elif docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q '"nvidia"'; then
  COMPOSE+=(-f docker-compose.gpu.yml)
fi
dc() { "${COMPOSE[@]}" "$@"; }

URL="http://localhost"
ESPERAR=90   # segundos máximos que espera a que el sistema responda

pausa() { read -rp "Enter para volver al menú... " _; }

# La primera puesta en marcha se prepara desde el menú, sin pasos manuales.
# Una configuración existente nunca se sobrescribe.
preparar_env() {
  [ -f .env ] && return 0
  local secreto
  if command -v openssl >/dev/null 2>&1; then
    secreto=$(openssl rand -hex 32) || return 1
  elif command -v node >/dev/null 2>&1; then
    secreto=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") || return 1
  else
    echo "Para preparar .env instalá openssl o crealo desde .env.example con una clave propia."
    return 1
  fi
  (umask 077; sed "s/^JWT_SECRET=.*/JWT_SECRET=$secreto/" .env.example > .env) || return 1
  echo "Configuración inicial preparada. Tus claves no se muestran."
}

# ---------------------------------------------------------------- INICIAR ---
iniciar() {
  preparar_env || return 1
  echo "==> Motor de modelos: $MODO_IA"
  echo -e "${AZUL}==> Construyendo la imagen de los servicios…${SIN}"
  # Se construye UNA sola vez (todos los servicios comparten la misma imagen);
  # si se construyen en paralelo, Docker 29 se queja de la imagen duplicada.
  dc build web || { echo -e "${ROJO}Falló la construcción.${SIN}"; return 1; }

  if [ "$MODO_IA" = host ]; then
    # No cambiamos el servicio del sistema ni exponemos su API sin permiso.
    dc run --rm --no-deps agente node -e '
      fetch(process.env.OLLAMA_URL + "/api/tags", {signal: AbortSignal.timeout(5000)})
        .then(r => { if (!r.ok) throw Error("HTTP " + r.status); return r.json(); })
        .then(d => console.log("Ollama externo accesible, modelos:", d.models.length))
        .catch(e => { console.error("Ollama del host no accesible:", e.message); process.exit(1); });
    ' || { echo "Revisá OLLAMA_HOST_URL y la dirección de escucha del servicio Ollama (ver README)."; return 1; }
    docker stop ianews-ollama >/dev/null 2>&1 || true
  fi

  echo -e "${AZUL}==> Levantando los contenedores…${SIN}"
  dc up -d || { echo -e "${ROJO}Falló el arranque.${SIN}"; return 1; }

  echo -n "    Esperando a que el sistema responda"
  local i
  for i in $(seq 1 "$ESPERAR"); do
    if curl -fsS "$URL/proxy-health" >/dev/null 2>&1; then
      echo -e "  ${VERDE}¡listo!${SIN}"
      echo
      dc ps --format 'table {{.Name}}\t{{.Status}}'
      echo
      echo -e "${VERDE}Abriendo:${SIN} $URL"
      return 0
    fi
    echo -n "."
    sleep 1
  done
  echo -e "  ${AMAR}está tardando más de lo normal.${SIN}"
  echo "Mirá qué pasa con:  $0 logs"
  dc ps
}

# ---------------------------------------------------------------- DETENER ---
detener() {
  echo -e "${AZUL}==> Deteniendo los contenedores (tus datos se conservan)…${SIN}"
  dc stop
  echo -e "${VERDE}Detenido.${SIN} No se van a levantar solos al prender la PC."
}

# -------------------------------------------------------------- REINICIAR ---
reiniciar() {
  if [ "$MODO_IA" = host ]; then iniciar; return $?; fi
  echo -e "${AZUL}==> Reiniciando (revisa permisos de data/)…${SIN}"
  # "up -d" vuelve a ejecutar init-datos; "restart" no lo haría y, si borraste
  # la carpeta data/, los servicios no podrían escribir la base.
  dc up -d || true
  dc ps
}

# ----------------------------------------------------------------- ESTADO ---
estado() {
  echo "Motor seleccionado: $MODO_IA (se aplica al iniciar)"
  echo -e "${AZUL}==> Contenedores del sistema:${SIN}"
  dc ps
  echo
  echo -e "${AZUL}==> Respuesta del proxy ($URL):${SIN}"
  curl -fsS "$URL/proxy-health" 2>/dev/null && echo || echo -e "${AMAR}El proxy no responde (¿está apagado?).${SIN}"
}

seleccionar_motor() {
  case "${1:-estado}" in
    estado) echo "Motor seleccionado: $MODO_IA" ;;
    host|docker)
      preparar_env || return 1
      local elegido="$1"
      if grep -q '^OLLAMA_MODO=' .env 2>/dev/null; then
        sed -i "s/^OLLAMA_MODO=.*/OLLAMA_MODO=$elegido/" .env
      else
        printf '\nOLLAMA_MODO=%s\n' "$elegido" >> .env
      fi
      echo "Motor guardado: $elegido. Aplicá con ./portal.sh iniciar"
      echo "No se borran modelos ni se modifica el Ollama del sistema."
      ;;
    *) echo "Uso: ./portal.sh motor host|docker|estado"; return 1 ;;
  esac
}

# ------------------------------------------------------------------ LOGS ---
ver_logs() {
  local svc="${1:-}"
  if [ -n "$svc" ]; then dc logs -f "$svc"; else dc logs -f; fi
}

# --------------------------------------------------------------- MODELOS IA -
bajar_modelos() {
  if [ "$MODO_IA" = host ]; then
    echo "Usás Ollama del sistema. Descargá allí con: ollama pull llama3.2:3b"
    echo "Para clasificar: ollama pull qwen2.5:3b (o elegí tus modelos en ⚙️ IA)."
    return 0
  fi
  if [ -x scripts/docker-ia-modelos.sh ]; then
    bash scripts/docker-ia-modelos.sh
  else
    echo -e "${AMAR}No encontré scripts/docker-ia-modelos.sh${SIN}"
  fi
}

# ---------------------------------------------------------- CUANTIZAR IA ---
cuantizar_modelos() {
  if [ -x scripts/cuantizar-modelos.sh ]; then
    bash scripts/cuantizar-modelos.sh "$@"
  else
    echo -e "${AMAR}No encontré scripts/cuantizar-modelos.sh${SIN}"
  fi
}

# ------------------------------------------------------------------- GPU IA --
activar_gpu() {
  if [ "$MODO_IA" = host ]; then
    echo "El modo host no necesita NVIDIA Container Toolkit. Revisá: ollama ps"
    return 0
  fi
  preparar_env || return 1
  if [ -x scripts/setup-gpu.sh ]; then
    bash scripts/setup-gpu.sh
  else
    echo -e "${AMAR}No encontré scripts/setup-gpu.sh${SIN}"
  fi
}

# --------------------------------------------------------------- ELIMINAR ---
eliminar() {
  echo -e "${AMAR}Esto va a borrar: contenedores, la red, la IMAGEN construida y el${SIN}"
  echo -e "${AMAR}volumen con los modelos de IA descargados.${SIN}"
  echo -e "${VERDE}NO borra tu base de datos ni tus fotos (carpeta data/).${SIN}"
  read -rp "¿Confirmás? escribí 'si' para seguir: " r
  [ "$r" = "si" ] || { echo "Cancelado."; return 0; }
  echo -e "${AZUL}==> Eliminando…${SIN}"
  dc down -v --rmi local --remove-orphans
  echo -e "${VERDE}Listo: no queda nada del sistema en Docker.${SIN}"
  echo -e "${AMAR}Recordá: la IA se queda sin modelos. Al volver a iniciar, corré ./portal.sh modelos${SIN}"
}

# ------------------------------------------------------------ BORRAR TODO ---
borrar_todo() {
  echo -e "${ROJO}¡ATENCIÓN! Esto borra TODO:${SIN}"
  echo "  - contenedores, red, imagen y modelos de IA (docker)"
  echo -e "  - ${ROJO}tu base de datos, usuarios, noticias guardadas y fotos${SIN} (carpeta data/)"
  echo
  read -rp "Escribí 'BORRAR' (en mayúsculas) para confirmar: " r
  [ "$r" = "BORRAR" ] || { echo "Cancelado."; return 0; }
  dc down -v --rmi local --remove-orphans
  rm -rf ./data
  echo -e "${VERDE}Eliminado por completo. La próxima vez el sistema arranca vacío.${SIN}"
  echo -e "${AMAR}Después de iniciar, bajá los modelos de IA con: ./portal.sh modelos${SIN}"
}

# ------------------------------------------------------------------ MENÚ ---
menu() {
  while true; do
    if [ -t 1 ] && [ "${TERM:-dumb}" != dumb ]; then clear; fi
    echo
    echo -e "${AZUL}================================================================${SIN}"
    echo -e "${AZUL}   Portal IA News — lanzador${SIN}"
    echo -e "${AZUL}================================================================${SIN}"
    dc ps --format 'table {{.Name}}\t{{.Status}}' 2>/dev/null
    echo
    echo "  APLICACIÓN"
    echo "  1) Iniciar / actualizar      (construye y levanta)"
    echo "  2) Detener                   (apaga, conserva datos)"
    echo "  3) Reiniciar"
    echo "  4) Ver estado"
    echo "  5) Ver logs en vivo"
    echo
    echo "  INTELIGENCIA ARTIFICIAL"
    echo "  6) Descargar modelos de IA recomendados"
    echo "  7) Elegir motor: Ollama del sistema o Docker"
    echo "  8) Activar GPU para la IA (NVIDIA)"
    echo "  9) Cuantizar un modelo (Q4, menos VRAM)"
    echo
    echo "  LIMPIEZA (PIDE CONFIRMACIÓN)"
    echo " 10) Eliminar contenedores, modelos e imagen (conserva datos)"
    echo " 11) BORRAR TODO (incluye la base de datos)   <-- peligroso"
    echo
    echo "  0) Salir"
    echo
    read -rp "Opción: " op
    case "$op" in
      1) iniciar; pausa ;;
      2) detener; pausa ;;
      3) reiniciar; pausa ;;
      4) estado; pausa ;;
      5) echo "Elegí un servicio (auth/feeds/agente/web/nginx/ollama) o vacío para todos:"; read -rp "servicio: " s; ver_logs "$s" ;;
      6) bajar_modelos; pausa ;;
      7) read -rp "Motor (host/docker): " m; seleccionar_motor "$m"; pausa; exec "$0" ;;
      8) activar_gpu; pausa ;;
      9) echo "Modelo a cuantizar (Enter = qwen2.5:3b):"; read -rp "modelo: " m; cuantizar_modelos "${m:-qwen2.5:3b}"; pausa ;;
      10) eliminar; pausa ;;
      11) borrar_todo; pausa ;;
      0|q) exit 0 ;;
      *) echo -e "${ROJO}Opción inválida.${SIN}" ;;
    esac
  done
}

# ----------------------------------------------------------- ARGUMENTOS ---
case "${1:-}" in
  iniciar|start|arriba|up)  iniciar ;;
  detener|stop|parar|down)  detener ;;
  reiniciar|restart)        reiniciar ;;
  estado|status|ps)         estado ;;
  logs)                     ver_logs "${2:-}" ;;
  modelos|ia)               bajar_modelos ;;
  cuantizar|quantize|q4)     shift || true; cuantizar_modelos "$@" ;;
  gpu|gpu-on)               activar_gpu ;;
  motor)                    seleccionar_motor "${2:-estado}" ;;
  eliminar|destroy)         eliminar ;;
  borrar-todo|uninstall|purge) borrar_todo ;;
  ayuda|help|-h|--help)
    sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  "")                       menu ;;
  *) echo -e "${ROJO}Comando desconocido: $1${SIN}"; echo "Probá:  $0 ayuda" ;;
esac
