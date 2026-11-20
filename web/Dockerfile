# Consola web: se compila con Node y se sirve con nginx, que ademas hace de proxy hacia GameStats.
#
#   docker build -t gameconsole-web web/
#   docker run --rm -p 8000:80 gameconsole-web

# ---------------------------------------------------------------- build
FROM --platform=$BUILDPLATFORM node:22.11.0-alpine AS build
WORKDIR /app

# Dependencias primero: mientras el lockfile no cambie, Docker reutiliza esta capa.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Typecheck + pruebas + build: una imagen con codigo roto no llega a existir.
RUN npm run typecheck && npm test && npm run build

# ---------------------------------------------------------------- final
FROM nginx:1.27.3-alpine

ENV INGEST_URL=http://ingest:8080 \
    ANALYTICS_URL=http://analytics:8081 \
    PROLOG_URL=http://prolog:8090 \
    NGINX_RESOLVER=127.0.0.11

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
