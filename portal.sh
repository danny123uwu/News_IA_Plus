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
COMPOSE=(docker compose -f docker-compose.yml)
if docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q '"nvidia"'; then
  COMPOSE+=(-f docker-compose.gpu.yml)
fi
dc() { "${COMPOSE[@]}" "$@"; }

URL="http://localhost"
ESPERAR=90   # segundos máximos que espera a que el sistema responda

pausa() { read -rp "Enter para volver al menú... " _; }

# ---------------------------------------------------------------- INICIAR ---
iniciar() {
  echo -e "${AZUL}==> Construyendo la imagen de los servicios…${SIN}"
  # Se construye UNA sola vez (todos los servicios comparten la misma imagen);
  # si se construyen en paralelo, Docker 29 se queja de la imagen duplicada.
  dc build web || { echo -e "${ROJO}Falló la construcción.${SIN}"; return 1; }

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
  echo -e "${AZUL}==> Reiniciando (revisa permisos de data/)…${SIN}"
  # "up -d" vuelve a ejecutar init-datos; "restart" no lo haría y, si borraste
  # la carpeta data/, los servicios no podrían escribir la base.
  dc up -d || true
  dc ps
}

# ----------------------------------------------------------------- ESTADO ---
estado() {
  echo -e "${AZUL}==> Contenedores del sistema:${SIN}"
  dc ps
  echo
  echo -e "${AZUL}==> Respuesta del proxy ($URL):${SIN}"
  curl -fsS "$URL/proxy-health" 2>/dev/null && echo || echo -e "${AMAR}El proxy no responde (¿está apagado?).${SIN}"
}

# ------------------------------------------------------------------ LOGS ---
ver_logs() {
  local svc="${1:-}"
  if [ -n "$svc" ]; then dc logs -f "$svc"; else dc logs -f; fi
}

# --------------------------------------------------------------- MODELOS IA -
bajar_modelos() {
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
}

# ------------------------------------------------------------------ MENÚ ---
menu() {
  while true; do
    echo
    echo -e "${AZUL}================================================================${SIN}"
    echo -e "${AZUL}   Portal IA News — lanzador${SIN}"
    echo -e "${AZUL}================================================================${SIN}"
    dc ps --format 'table {{.Name}}\t{{.Status}}' 2>/dev/null
    echo
    echo "  1) Iniciar / actualizar      (construye y levanta)"
    echo "  2) Detener                   (apaga, conserva datos)"
    echo "  3) Reiniciar"
    echo "  4) Ver estado"
    echo "  5) Ver logs en vivo"
    echo "  6) Descargar modelos de IA recomendados"
    echo "  7) Eliminar contenedores, modelos e imagen (conserva datos)"
    echo "  8) BORRAR TODO (incluye la base de datos)   <-- peligroso"
    echo "  9) Activar GPU para la IA (NVIDIA)"
    echo " 10) Cuantizar un modelo (Q4, menos VRAM)"
    echo "  0) Salir"
    echo
    read -rp "Opción: " op
    case "$op" in
      1) iniciar ;;
      2) detener ;;
      3) reiniciar ;;
      4) estado; pausa ;;
      5) echo "Elegí un servicio (auth/feeds/agente/web/nginx/ollama) o vacío para todos:"; read -rp "servicio: " s; ver_logs "$s" ;;
      6) bajar_modelos ;;
      7) eliminar; pausa ;;
      8) borrar_todo; pausa ;;
      9) activar_gpu; pausa ;;
      10) echo "Modelo a cuantizar (Enter = qwen2.5:3b):"; read -rp "modelo: " m; cuantizar_modelos "${m:-qwen2.5:3b}"; pausa ;;
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
  eliminar|destroy)         eliminar ;;
  borrar-todo|uninstall|purge) borrar_todo ;;
  ayuda|help|-h|--help)
    sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  "")                       menu ;;
  *) echo -e "${ROJO}Comando desconocido: $1${SIN}"; echo "Probá:  $0 ayuda" ;;
esac
