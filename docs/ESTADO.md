# Estado del desarrollo

Actualizado: 19 nov 2026. Entrega: **viernes 20 nov 2026, 10 pm**.

El plan aprobado está resumido aquí; el contrato con GameStats está en [`CONTRACT.md`](CONTRACT.md).

## Decisiones ya tomadas (no reabrir)

- Juegos: **blackjack** (vs crupier), **battleship** (vs IA en Prolog), **racing** (2 humanos en el
  mismo teclado: A/D contra J/L, salida en falso → `PENALTY`). `combat` no se implementa.
- La IA registra sus jugadas con un tipo extra **`AI_DECISION`** (`playerId: "prolog-ai"`,
  `action: HUNT|TARGET`, `data {coord, reason}`), enviado antes de su `SHOT_FIRED`.
- Instancias por juego = cantidad de filas de `GET /results/matches` con ese `gameId`, más
  `activeMatches` global de `GET /metrics`. La consola no calcula métricas.
- GameStats no tiene CORS y **no se modifica**: nginx (contenedor `console`) hace de proxy en el
  mismo origen: `/gamestats/ingest/*` → `ingest:8080`, `/gamestats/analytics/*` →
  `analytics:8081`, `/prolog/*` → `prolog:8090`.
- GameStats se usa desde su imagen pública `ghcr.io/gabo8086/gamestats:v1.4`.
- Emisor: cola FIFO en memoria por partida, lotes, backoff con jitter, `duplicate_event` = entregado.
  IndexedDB, `navigator.locks` y recuperación entre pestañas solo al final si sobra tiempo (ya
  existe la interfaz `EventBuffer` para enchufarlo).
- Las caídas de GameStats se prueban con `docker compose pause ingest` / `unpause`, **nunca**
  `stop`/`start` (Go pierde el estado y rechaza con `match_not_started`).
- Node no se instala en la máquina: npm y vitest corren en contenedores `node:22.11.0-alpine`.

## Hecho

| Pieza | Estado |
|---|---|
| `docs/CONTRACT.md` | listo (Fase 0) |
| Núcleo POO (`web/src/core`): `Game`, `Player`, `EventFactory`, `EventSink` | compila, probado |
| Emisor (`web/src/events`): `MatchEmitter`, `ExponentialBackoff`, `HttpIngestTransport`, `MemoryBuffer` | compila, probado |
| Blackjack (`web/src/games/blackjack`) + vista | compila, probado |
| Consola (`web/src/console`) y panel (`web/src/panel`) | compila; prueba a mano en el navegador pendiente |
| Battleship (`web/src/games/battleship`): `Coord`, `Ship`, `Board`, `Fleet`, `BattleshipGame`, `ShotStrategy` + `PrologAI`, vista | compila, probado; emite `AI_DECISION`; si Prolog no responde muestra "IA no disponible, reintentando" |
| Racing (`web/src/games/racing`): `RacingGame`, `Racer`, vista con teclado (A/D contra J/L, solo con foco) | compila, probado; salida en falso → `PENALTY` de 3 s (una por piloto) |
| Tests vitest: contrato (JSON Schema de P1), emisor, blackjack, battleship, racing | **54/54 pasan** |
| Test e2e contra GameStats v1.4 real (blackjack: sesión, abandono, 5 concurrentes; battleship con la IA real; racing: la penalización cambia el ganador y da `comeback`) | **5/5 pasan** |
| nginx, `web/Dockerfile`, `docker-compose.yml`, `docker-compose.local.yml` | probados: `compose up --wait` deja los 4 servicios sanos; el proxy responde en las 3 rutas |
| IA Prolog (`prolog/battleship_ai.pl`, `server.pl`, `tests.pl`, `Dockerfile`) | **13/13 tests plunit pasan** con SWI-Prolog 10.0.2; servidor probado con curl |

Fase 1 verificada el 19 nov: `web/package-lock.json` generado y commiteado; se agregó `@types/node` (faltaba para `process.env`).

## Pendiente, en orden

1. ~~Verificar la Fase 1~~ **hecho**.
2. ~~Fase 2: Battleship en TS con la IA de Prolog~~ **hecho**.
3. ~~Fase 3: Racing~~ **hecho**.
4. **Fase 4**: CI/CD en GitHub Actions (typecheck, vitest, plunit, build de imágenes y publish a
   GHCR multi-arch como en P1), `docker-compose.deploy.yml` y job `deploy` que prueba la imagen
   publicada sin login, y README (instalación, ejecución, deployment, decisiones técnicas, y que el
   conteo de instancias sale de `/results/matches`).
5. **Fase 5**: concurrencia (varias instancias y pestañas, `pause`/`unpause` de ingest) y pulido de
   la UI.

Un commit por fase, con un resumen corto al terminar cada una.

## Comandos (PowerShell o bash, con Docker Desktop)

```bash
# Dentro de gameconsole/
docker run --rm -v "${PWD}/web:/app" -w /app node:22.11.0-alpine npm install   # genera package-lock.json
docker run --rm -v "${PWD}/web:/app" -w /app node:22.11.0-alpine sh -c "npm run typecheck && npm test && npm run build"
docker compose up --build -d --wait
# consola: http://localhost:8000
docker run --rm --network gameconsole_default -v "${PWD}/web:/app" -w /app `
  -e GAMESTATS_INGEST_URL=http://ingest:8080 -e GAMESTATS_ANALYTICS_URL=http://analytics:8081 `
  -e PROLOG_URL=http://prolog:8090 node:22.11.0-alpine npx vitest run tests/integration
# Prolog sin instalarlo: sus tests corren al construir la imagen
docker build -t gameconsole-prolog prolog
docker compose down
```

(En PowerShell el salto de línea es la comilla invertida; en bash, `\`.)
