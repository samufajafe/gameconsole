#!/usr/bin/env bash
# Prueba de caida de GameStats con partidas concurrentes (web/tests/integration/caida.test.ts).
#
#   scripts/prueba-caida.sh            # pausa ingest 15 s
#   PAUSA_S=30 scripts/prueba-caida.sh
#
# La caida se simula con `docker compose pause ingest` / `unpause`, NUNCA con stop/start: Go
# guarda en memoria que partidas estan abiertas y un reinicio las perderia (match_not_started).
#
# Funciona en Linux, macOS y Git Bash en Windows (Docker Desktop).
set -euo pipefail

cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1                          # Git Bash: no reescribir /app
WEB="$(pwd -W 2>/dev/null || pwd)/web"             # ruta que entiende Docker Desktop en Windows
PAUSA_S="${PAUSA_S:-15}"
NODE_IMAGE="${NODE_IMAGE:-node:22.11.0-alpine}"

docker compose up -d --wait

echo "== docker compose pause ingest"
docker compose pause ingest
# Pase lo que pase, ingest no queda congelado.
trap 'docker compose unpause ingest >/dev/null 2>&1 || true' EXIT

# En Linux, --user evita dejar archivos de root en el checkout; Docker Desktop ya los mapea.
USUARIO=()
if [ "$(uname -s)" = "Linux" ]; then USUARIO=(--user "$(id -u):$(id -g)" -e HOME=/tmp); fi

SALIDA="$(mktemp)"
docker run --rm "${USUARIO[@]}" \
  --network gameconsole_default -v "$WEB:/app" -w /app \
  -e GAMESTATS_INGEST_URL=http://ingest:8080 \
  -e GAMESTATS_ANALYTICS_URL=http://analytics:8081 \
  -e PROLOG_URL=http://prolog:8090 \
  -e GAMESTATS_CAIDA=1 \
  "$NODE_IMAGE" npx vitest run tests/integration/caida.test.ts >"$SALIDA" 2>&1 &
PRUEBA=$!

# La pausa se cuenta desde que las partidas terminaron de jugarse, no desde que arranca el
# contenedor: asi los emisores pasan PAUSA_S segundos reintentando, sin importar cuanto tarde vitest.
until grep -q "partidas jugadas" "$SALIDA"; do
  if ! kill -0 "$PRUEBA" 2>/dev/null; then break; fi
  sleep 1
done
grep "partidas jugadas" "$SALIDA" || true
sleep "$PAUSA_S"
echo "== docker compose unpause ingest (${PAUSA_S} s despues de jugar)"
docker compose unpause ingest

ESTADO=0
wait "$PRUEBA" || ESTADO=$?
cat "$SALIDA"
rm -f "$SALIDA"
exit "$ESTADO"
