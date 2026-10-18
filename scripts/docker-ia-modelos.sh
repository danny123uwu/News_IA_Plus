#!/usr/bin/env bash
# ============================================================================
#  Portal IA News — baja al contenedor de Ollama los 2 modelos recomendados
#  (uno chico para clasificar y uno más grande para resumir/preguntar/digest).
#
#  Uso:  bash scripts/docker-ia-modelos.sh
# ============================================================================
set -e

CHICO="qwen2.5:3b"    # ~1.9 GB  -> clasificar etiquetas (rápido, bueno en JSON)
GRANDE="llama3.2:3b"  # ~2.0 GB  -> resumir, preguntar, digest (español oficial)
# Opción ultra liviana (PCs con 2 GB de VRAM): reemplazá por gemma2:2b (~1.6 GB)

echo "==> Verificando que el contenedor de Ollama esté arriba…"
if ! docker compose ps --status running --services | grep -q '^ollama$'; then
  echo "ERROR: el servicio 'ollama' no está corriendo."
  echo "       Levantá primero el sistema con:  docker compose up -d --build"
  exit 1
fi

echo "==> Bajando modelo para CLASIFICAR: $CHICO"
docker compose exec ollama ollama pull "$CHICO"

echo "==> Bajando modelo para RESUMIR/PREGUNTAR: $GRANDE"
docker compose exec ollama ollama pull "$GRANDE"

echo
echo "==> Modelos disponibles ahora:"
docker compose exec ollama ollama list

echo
echo "Listo. Entrá a http://localhost  ->  pestaña ⚙️ IA y elegí los modelos por tarea."
