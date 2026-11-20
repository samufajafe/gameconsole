# GameConsole

Consola web de videojuegos (Proyecto 2, Lenguajes de Programación). Tiene tres juegos que se
pueden jugar a la vez, en varias instancias y pestañas. Cada evento de juego se manda a
**GameStats** (Proyecto 1), y un panel muestra lo que GameStats calcula.

| Juego | Modo | Contra |
|---|---|---|
| **Blackjack** | PVE | el crupier (se planta en 17) |
| **Battleship** | PVE | una IA escrita en **SWI-Prolog** que explica cada jugada |
| **Racing** | PVP | otro humano en el mismo teclado (A/D contra J/L) |

```
 navegador ──> console (nginx :8000) ─┬─ /                     -> la consola (TypeScript + Vite)
                                      ├─ /gamestats/ingest/*    -> ingest    (Go, P1)    :8080
                                      ├─ /gamestats/analytics/* -> analytics (Scala, P1) :8081
                                      └─ /prolog/*              -> prolog    (SWI-Prolog):8090
```

El contrato con GameStats (formato de eventos, rechazos y endpoints) está en
[`docs/CONTRACT.md`](docs/CONTRACT.md).

## Requisitos

Solo **Docker** con Compose v2 (Docker Desktop en Windows o macOS). No hace falta instalar Node
ni Prolog: todo corre en contenedores.

## Instalación y ejecución

```bash
git clone https://github.com/samufajafe/gameconsole.git
cd gameconsole
docker compose up --build -d --wait     # construye la consola y la IA; baja GameStats v1.4
```

- Consola: **http://localhost:8000**
- GameStats queda expuesto también en `:8080` (ingest) y `:8081` (analytics, con su propia UI de
  solo lectura en `/`), y la IA en `:8090`, para consultarlos con `curl` durante la revisión.

```bash
docker compose down                     # bajar todo (GameStats guarda en memoria: se pierde)
```

### Cómo se juega

1. Arriba a la derecha está el **alias**: es el `playerId` que usa GameStats. Se guarda en el
   navegador.
2. En **Juegos** se pulsa *Nueva partida* en cualquier juego, todas las veces que se quiera. Cada
   instancia tiene su `matchId` (UUID) y un indicador de envío (`✓ N eventos`, `reintentando…`).
3. **Battleship**: se dispara con clic sobre la flota enemiga. Después de cada disparo juega la
   IA, que muestra su modo (`HUNT`/`TARGET`) y su razonamiento. Mientras nadie haya disparado, se
   puede recolocar la flota propia.
4. **Racing**: se pide el nombre del segundo piloto. Hay que hacer clic en la carrera para que
   reciba el teclado. Cada piloto acelera **alternando** sus dos teclas. Acelerar durante la
   cuenta regresiva es salida en falso: +3 s (`PENALTY`).
5. Al cerrar una instancia (✕) o la pestaña a mitad de partida, la partida se **abandona**: se
   manda `PLAYER_DISCONNECTED` y `MATCH_FINISHED` para que GameStats no la deje abierta para
   siempre.
6. **Panel**: consulta a GameStats cada 3 s.

### Qué muestra el panel

El panel **no calcula ninguna métrica**: solo muestra respuestas de GameStats.

- Generales: `GET /metrics` (eventos recibidos, válidos, rechazos por razón, partidas en curso) y
  el perfil del alias con `GET /results/players/{id}`.
- Por juego: ranking (`GET /results/games/{id}/ranking`) y la última partida analizada
  (`GET /results/matches/{id}`).
- **Instancias por juego**: GameStats no tiene un endpoint de "instancias por juego". El panel
  cuenta las filas de `GET /results/matches` que tienen ese `gameId`, es decir, las partidas
  terminadas y analizadas. Las partidas en curso de todos los juegos salen de `activeMatches`
  (`GET /metrics`), que es global. Scala solo conoce una partida cuando recibe su
  `MATCH_FINISHED`; por eso el conteo por juego sube al terminar cada partida.

## Pruebas

```bash
# Consola: typecheck + vitest + build (dentro de node:22.11.0-alpine)
docker run --rm -v "$PWD/web:/app" -w /app node:22.11.0-alpine \
  sh -c "npm ci && npm run typecheck && npm test && npm run build"

# IA: pruebas plunit (también corren al construir la imagen de prolog)
docker run --rm -v "$PWD/prolog:/app" -w /app swipl:10.0.2 swipl -g run_tests -t halt tests.pl

# Punta a punta contra GameStats y Prolog reales (con el compose levantado)
docker run --rm --network gameconsole_default -v "$PWD/web:/app" -w /app \
  -e GAMESTATS_INGEST_URL=http://ingest:8080 -e GAMESTATS_ANALYTICS_URL=http://analytics:8081 \
  -e PROLOG_URL=http://prolog:8090 node:22.11.0-alpine npx vitest run tests/integration
```

En PowerShell se usa `${PWD}` en vez de `$PWD`, y la comilla invertida (`` ` ``) en vez de `\`
para partir líneas.

- **Contrato**: cada evento que generan los juegos se valida contra una copia del
  `event.schema.json` de P1 (`web/tests/contract/`).
- **e2e**: se juegan partidas reales con las mismas clases de la consola y se comprueba lo que
  GameStats analizó. Una sesión de blackjack, un abandono y 5 partidas concurrentes; una partida de
  battleship completa contra la IA real; una carrera en la que la penalización cambia el ganador y
  GameStats detecta el patrón `comeback`.

## Deployment (CI/CD)

`.github/workflows/ci.yml` corre en cada PR y en cada push a `main`:

| Job | Qué hace |
|---|---|
| `web` | `npm ci`, typecheck, vitest y build en `node:22.11.0-alpine` |
| `prolog` | pruebas plunit en `swipl:10.0.2` |
| `e2e` | `docker compose up --build --wait`, prueba el proxy y corre los e2e contra GameStats real |
| `publish` | (solo push) publica `ghcr.io/samufajafe/gameconsole/web` y `.../prolog` para **amd64 y arm64**, con tags `sha-<commit>`, `latest` y `vX.Y` |
| `deploy` | (solo push) baja las imágenes **publicadas**, sin `docker login`, con `docker-compose.deploy.yml`, y corre los e2e contra ellas |

Para levantar la versión publicada sin clonar ni compilar nada basta con
[`docker-compose.deploy.yml`](docker-compose.deploy.yml):

```bash
docker compose -f docker-compose.deploy.yml up -d --wait            # latest
GAMECONSOLE_TAG=v1.0 docker compose -f docker-compose.deploy.yml up -d --wait
```

Para crear una versión fija: `git tag v1.0 && git push origin v1.0`. Los paquetes de GHCR tienen
que ser **públicos** (GitHub → Packages → *Change visibility*), o el job `deploy` falla. Ese job
existe justamente para detectar eso.

Para construir GameStats desde un clon local de P1 (`../gamestats`) en vez de usar su imagen
publicada:
`docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d --wait`.

## Decisiones técnicas

- **TypeScript con POO.** `Game` (clase abstracta) maneja lo que es común a los tres juegos: el
  ciclo de vida, `MATCH_STARTED`/`PLAYER_JOINED`/`MATCH_FINISHED`, el abandono y el `matchId`.
  Cada juego solo aporta sus reglas. Un bot es un `Player` más con `playerType: "BOT"`. La lógica
  no conoce el DOM ni la red: los eventos salen por un `EventSink` y la vista se suscribe a
  `onChange`. Por eso todo se prueba sin navegador. Agregar un juego es registrar un
  `GameDescriptor` en `web/src/main.ts`.
- **Un solo lugar arma eventos.** `EventFactory` produce el sobre cerrado del contrato: `eventId`
  y `matchId` UUID v4, `timestamp` RFC 3339 en UTC que nunca retrocede dentro de una partida, y
  `playerId: null` en los `MATCH_*`.
- **Emisor asíncrono por partida** (`MatchEmitter`). `send()` es síncrono y nunca bloquea el juego.
  Hay una cola FIFO en memoria por partida, que se manda en lotes (Go acepta arreglos y los procesa
  en orden). Ante un error de red, 5xx, 408 o 429, reintenta el mismo lote con backoff exponencial
  con jitter, sin límite. Como cada evento conserva su `eventId`, si un lote ya había llegado, Go
  responde `duplicate_event`, y eso cuenta como **entregado**. Los demás rechazos son definitivos y
  quedan aparte (`deadLetters`) sin frenar al resto. Cada partida tiene su emisor, así que una
  partida atascada no frena a las otras. Al cerrar la pestaña se manda lo pendiente con
  `fetch(..., { keepalive: true })`.
- **Proxy en el mismo origen.** GameStats no envía cabeceras CORS y no se modifica. nginx (el
  contenedor `console`) reenvía `/gamestats/*` y `/prolog/*` tal cual, sin transformar ni cachear.
  En desarrollo, Vite hace lo mismo.
- **IA en Prolog como servicio.** `BattleshipGame` depende de la interfaz `ShotStrategy`; `PrologAI`
  la implementa con `POST /prolog/battleship/move`. A Prolog solo se le manda lo que la máquina
  *ve* (sus disparos con `miss`/`hit`/`sunk` y los tamaños que faltan hundir), nunca dónde están
  los barcos. Prolog usa un mapa de densidad de colocaciones posibles (modo `HUNT`) y remata
  alrededor de los tocados (modo `TARGET`), con desempate determinista. Cada jugada se registra
  como `AI_DECISION` (`action` = modo, `data {coord, reason}`) justo antes de su `SHOT_FIRED`.
  `AI_DECISION` no está en el catálogo de P1, pero usa el mismo sobre: Go lo acepta y Scala lo
  cuenta en `eventsByType`. **Si Prolog no responde, la consola muestra "IA no disponible,
  reintentando" y reintenta. Nunca juega al azar.**
- **Racing.** `position` es el puesto por tiempo acumulado al cerrar cada vuelta. Como todos
  largan juntos, coincide con el orden en que cierran esa vuelta. El ganador lo decide GameStats
  con el tiempo ajustado (vueltas + penalizaciones), no la consola. El teclado solo llega a la
  carrera que tiene el foco, para que dos carreras abiertas no reciban las mismas teclas.
- **Caídas de GameStats.** Go guarda en memoria qué partidas están abiertas. Las caídas se
  simulan con `docker compose pause ingest` / `unpause`, **no** con `stop`/`start`: un reinicio
  borraría ese estado y Go rechazaría los eventos pendientes con `match_not_started`.

## Estructura

```
web/                 consola (TypeScript + Vite), servida por nginx
  src/core/          Game, Player, EventFactory, EventSink: el núcleo POO
  src/events/        MatchEmitter, ExponentialBackoff, HttpIngestTransport, EventBuffer
  src/games/         blackjack/, battleship/, racing/: reglas + vista de cada juego
  src/console/       catálogo, instancias simultáneas
  src/panel/         cliente de GameStats y panel
  tests/             vitest: contrato, emisor, juegos, e2e
  nginx/             proxy del mismo origen
prolog/              IA de Battleship (SWI-Prolog): lógica, servidor HTTP y pruebas plunit
docs/                CONTRACT.md (contrato con GameStats), ESTADO.md (avance)
```
