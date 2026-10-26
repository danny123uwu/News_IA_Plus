#!/usr/bin/env bash
# ============================================================================
#  Portal IA News — cuantización de modelos para gastar menos VRAM
#
#  Los modelos que baja "portal.sh modelos" YA vienen cuantizados (Q4_K_M).
#  Este script sirve si tenés un modelo en FP16/FP32 o querés una variante más
#  chica para una GPU con poca memoria.
#
#  Uso:
#     bash scripts/cuantizar-modelos.sh                 # qwen2.5:3b -> qwen2.5-q4km
#     bash scripts/cuantizar-modelos.sh llama3.2:3b
#     bash scripts/cuantizar-modelos.sh --listar        # ver modelos instalados
#
#  Requiere el contenedor ianews-ollama encendido (./portal.sh iniciar).
# ============================================================================
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")/.."

VERDE='\033[1;32m'; ROJO='\033[1;31m'; AMAR='\033[1;33m'; AZUL='\033[1;36m'; SIN='\033[0m'
CONTENEDOR=ianews-ollama

if ! docker inspect -f '{{.State.Running}}' "$CONTENEDOR" 2>/dev/null | grep -q true; then
  echo -e "${ROJO}El contenedor $CONTENEDOR no está corriendo.${SIN}"
  echo "Levantá el sistema con:  ./portal.sh iniciar"
  exit 1
fi

ollama() { docker exec -i "$CONTENEDOR" ollama "$@"; }

if [ "${1:-}" = "--listar" ] || [ "${1:-}" = "-l" ]; then
  echo -e "${AZUL}==> Modelos instalados:${SIN}"
  ollama list
  exit 0
fi

MODELO="${1:-qwen2.5:3b}"
BASE="${MODELO%%:*}"
NUEVO="${BASE}-q4km"

echo -e "${AZUL}==> Modelo origen:${SIN} $MODELO"
if ! ollama list | awk 'NR>1 {print $1}' | grep -qx "$MODELO"; then
  echo -e "${ROJO}No está instalado \"$MODELO\".${SIN} Modelos disponibles:"
  ollama list
  exit 1
fi

if ! ollama create --help 2>&1 | grep -qi 'quantize'; then
  echo -e "${AMAR}Tu versión de Ollama no soporta \"create -q\".${SIN}"
  echo "Actualizá el contenedor o bajá una etiqueta ya cuantizada, por ejemplo:"
  echo "   docker exec -i $CONTENEDOR ollama pull qwen2.5:3b-instruct-q4_K_M"
  exit 1
fi

echo -e "${AZUL}==> Creando $NUEVO con cuantización Q4_K_M…${SIN}"
echo "    (si el origen ya estaba en Q4, el ahorro será pequeño)"

TMP="/tmp/Modelfile.$$"
trap 'docker exec -i "$CONTENEDOR" rm -f "$TMP" >/dev/null 2>&1 || true' EXIT

ollama show --modelfile "$MODELO" > /tmp/Modelfile.portal.$$
docker cp "/tmp/Modelfile.portal.$$" "$CONTENEDOR:$TMP" >/dev/null
rm -f "/tmp/Modelfile.portal.$$"

ollama create "$NUEVO" -q q4_K_M -f "$TMP"

echo
echo -e "${VERDE}Listo.${SIN} Variante cuantizada: $NUEVO"
ollama list | grep -E "NAME|$BASE" || true
echo
echo "Elegila en el portal:  ⚙️ IA  ->  modelos por tarea."
echo -e "${AMAR}Nota:${SIN} para ahorrar VRAM también podés bajar OLLAMA_NUM_CTX,"
echo "OLLAMA_NUM_BATCH y usar OLLAMA_KV_CACHE_TYPE=q8_0 (ya activo en .env)."
