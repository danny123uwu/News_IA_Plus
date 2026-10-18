# Imagen única para los 4 microservicios (auth, feeds, agente, web).
# Cada servicio se arranca con un "command" distinto desde docker-compose.yml.
# node:sqlite viene incluido en Node 24, no hay que compilar nada.
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production

# 1) Dependencias primero (aprovecha la caché de capas de Docker)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 2) Código del proyecto
COPY . .

# 3) Carpeta de datos (se monta como volumen desde docker-compose)
RUN mkdir -p /app/data/uploads

EXPOSE 3001 3002 3003 8090

# Por defecto arranca todo junto (start.js); en compose se sobreescribe por servicio.
CMD ["node", "start.js"]
