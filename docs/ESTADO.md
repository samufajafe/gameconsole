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
| Consola (`web/src/console`) y panel (`web/src/panel`) | tema arcade, diálogos propios (`dialog.ts`), indicador global de GameStats; recorrida con Playwright |
| Colocación manual de la flota (`FleetPlacement`, `BattleshipGame.setPlayerFleet`) | probada; la flota al azar sigue siendo la opción por defecto |
| Battleship (`web/src/games/battleship`): `Coord`, `Ship`, `Board`, `Fleet`, `BattleshipGame`, `ShotStrategy` + `PrologAI`, vista | compila, probado; emite `AI_DECISION`; si Prolog no responde muestra "IA no disponible, reintentando" |
| Racing (`web/src/games/racing`): `RacingGame`, `Racer`, vista con teclado (A/D contra J/L, solo con foco) | compila, probado; salida en falso → `PENALTY` de 3 s (una por piloto) |
| Tests vitest: contrato (JSON Schema de P1), emisor, blackjack, battleship (incluida la colocación manual), racing | **60/60 pasan** |
| Test e2e contra GameStats v1.4 real (blackjack: sesión, abandono, 5 concurrentes; battleship con la IA real; racing: la penalización cambia el ganador y da `comeback`) | **5/5 pasan** |
| nginx, `web/Dockerfile`, `docker-compose.yml`, `docker-compose.local.yml` | probados: `compose up --wait` deja los 4 servicios sanos; el proxy responde en las 3 rutas |
| CI/CD (`.github/workflows/ci.yml`): jobs web, prolog, e2e, publish (GHCR multi-arch, matriz web/prolog) y deploy (imágenes publicadas sin login) | los 6 jobs pasan en GitHub (incluido `deploy` sin login: los paquetes de GHCR quedaron públicos) |
| Prueba de caída (`scripts/prueba-caida.sh` + `web/tests/integration/caida.test.ts`): 10 partidas concurrentes en 3 "pestañas" con `pause ingest` | **pasa**; también corre en CI |
| `README.md` (instalación, ejecución, pruebas, deployment, decisiones técnicas, conteo de instancias) | listo |
| IA Prolog (`prolog/battleship_ai.pl`, `server.pl`, `tests.pl`, `Dockerfile`) | **13/13 tests plunit pasan** con SWI-Prolog 10.0.2; servidor probado con curl |

Fase 1 verificada el 19 nov: `web/package-lock.json` generado y commiteado; se agregó `@types/node` (faltaba para `process.env`).

## Pendiente, en orden

1. ~~Verificar la Fase 1~~ **hecho**.
2. ~~Fase 2: Battleship en TS con la IA de Prolog~~ **hecho**.
3. ~~Fase 3: Racing~~ **hecho**.
4. ~~Fase 4: CI/CD y README~~ **hecho**.
5. ~~Fase 5: concurrencia (varias instancias y pestañas, pause/unpause de ingest)~~ **hecho**
   y automatizado.
6. ~~Fase 6: UI arcade con heurísticas de Nielsen y colocación manual de la flota~~ **hecho**
   (19 nov). Recorrida con Playwright (capturas de cada pantalla, escritorio y celular) y con un
   `docker compose pause ingest` real con 3 partidas abiertas: se siguió jugando, la IA respondió
   en <0,5 s, la barra avisó "GameStats sin conexión · N eventos en espera" y tras el `unpause`
   llegó todo sin rechazos. Falta que el usuario la pruebe a mano.
7. ~~Video de demostración~~ **hecho**: https://youtu.be/0JOzJ8Hfj_0 (enlazado en el README).
8. Opcional, solo si sobra tiempo: `EventBuffer` en IndexedDB + `navigator.locks`.

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
