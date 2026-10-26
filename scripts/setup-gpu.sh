#!/usr/bin/env bash
# ============================================================================
#  Portal IA News — Activar la GPU NVIDIA para Ollama
#
#  Hace que el contenedor de Ollama use tu tarjeta gráfica (VRAM) en lugar de
#  la CPU y la memoria RAM. Pide tu contraseña porque instala un paquete del
#  sistema y reinicia Docker.
#
#  Uso:   ./scripts/setup-gpu.sh
# ============================================================================
set -e
cd "$(dirname "$(readlink -f "$0")")/.."

VERDE='\033[1;32m'; ROJO='\033[1;31m'; AMAR='\033[1;33m'; AZUL='\033[1;36m'; SIN='\033[0m'

echo -e "${AZUL}==> 1/4 Comprobando que exista la GPU NVIDIA…${SIN}"
if ! command -v nvidia-smi >/dev/null 2>&1 || ! nvidia-smi >/dev/null 2>&1; then
  echo -e "${ROJO}No se detectó una GPU NVIDIA (nvidia-smi falló).${SIN}"
  echo "Verificá que tengas los drivers de NVIDIA instalados."
  exit 1
fi
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

echo -e "${AZUL}==> 2/4 Instalando nvidia-container-toolkit (pide contraseña)…${SIN}"
if command -v pacman >/dev/null 2>&1; then
  sudo pacman -S --needed --noconfirm nvidia-container-toolkit
elif command -v apt >/dev/null 2>&1; then
  echo -e "${AMAR}En Debian/Ubuntu primero hay que agregar el repositorio de NVIDIA.${SIN}"
  echo "Seguí esta guía: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
  exit 1
else
  echo -e "${ROJO}Distribución no reconocida. Instalá nvidia-container-toolkit a mano.${SIN}"
  exit 1
fi

echo -e "${AZUL}==> 3/4 Configurando Docker y reiniciándolo…${SIN}"
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
sleep 3

echo -e "${AZUL}==> 4/4 Levantando el sistema con GPU…${SIN}"
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d

echo
echo -e "${VERDE}¡Listo!${SIN} Para comprobarlo:"
echo "   ./portal.sh estado"
echo "   docker compose exec ollama ollama ps    # debe decir '100% GPU'"
echo
echo -e "${AMAR}Nota:${SIN} ollama ps solo muestra modelos mientras están cargados."
echo "Generá una respuesta y revisá PROCESSOR; nvidia-smi en reposo puede marcar 0 %."
echo "Si sigue en CPU, revisá docker compose logs ollama (CUDA / offloaded layers)."
