# Contrato con GameStats (Proyecto 1)

Este documento resume **lo que GameStats ya define** y que GameConsole debe respetar al pie de la
letra. No inventa nada: cada punto sale de `../gamestats` y se indica el archivo de origen. La
fuente de verdad sigue siendo `gamestats/contracts/`; si algo aquí la contradice, manda P1.

GameStats tiene dos servicios que solo se hablan por HTTP:

```
productor ──POST /events──> [ ingest (Go) :8080 ] ──POST /analyze──> [ analytics (Scala) :8081 ] <──GET /results/...── panel
                             valida y agrupa por matchId        analiza la partida al terminar
```

---

## 1. Formato del evento y mecanismo de envío

Fuentes: `contracts/event.schema.json`, `contracts/rejections.md`,
`ingest-go/internal/contract/event.go`, `ingest-go/main.go`.

### Sobre común (cerrado)

| Campo | Tipo | Obligatorio | Regla |
|---|---|---|---|
| `eventId` | string no vacío | sí | Único **global**. Go rechaza un `eventId` ya aceptado (`duplicate_event`). |
| `timestamp` | string RFC 3339 | sí | Patrón `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z\|[+-]\d{2}:\d{2})$`. |
| `gameId` | string no vacío | sí | Elige el analizador en Scala: `racing`, `combat`, `blackjack`, `battleship`. |
| `gameVersion` | string no vacío | sí | Hoy `"1.0"` en todos los juegos. |
| `matchId` | string no vacío | sí | Llave de agrupación en Go. |
| `playerId` | string o `null` | sí, salvo `MATCH_*` | En `MATCH_STARTED` / `MATCH_FINISHED` va `null`. |
| `type` | string no vacío | sí | String libre, no enum. |
| `action` | string o `null` | no | Ningún juego de P1 lo usa; existe "para extender sin cambiar el sobre". |
| `data` | objeto o `null` | no | Opaco para Go; solo lo interpreta el analizador del juego en Scala. |

- El sobre es **cerrado**: un campo que no esté en la tabla se rechaza con `unknown_field`. Go lo
  decodifica con `DisallowUnknownFields`.
- **Generación de IDs**: el contrato no fija un formato. P1 usa ids secuenciales (`bj-000001`)
  porque sus datos son simulados. GameConsole usa **UUID v4** (`crypto.randomUUID()`) tanto para
  `eventId` como para `matchId`, para que partidas y pestañas concurrentes nunca choquen.
- **Timestamp**: GameConsole usa `new Date().toISOString()` (UTC, milisegundos, sufijo `Z`), el
  mismo formato de los ejemplos de P1 (`2026-10-09T18:00:00.000Z`). Dentro de una partida los
  timestamps son no decrecientes; Go igual ordena el lote de forma estable antes de mandarlo a
  Scala.

### Envío

- `POST http://ingest:8080/events`, `Content-Type: application/json`, sin autenticación.
- El cuerpo puede ser **un evento o un arreglo de eventos**; con un arreglo, Go los procesa en el
  orden del arreglo. GameConsole manda **lotes** (arreglo) por partida.
- La respuesta es síncrona:

  ```json
  { "accepted": 14, "rejected": [ { "eventId": "e-1", "reason": "missing_required_field", "detail": "gameVersion" } ] }
  ```

  | HTTP | Cuándo |
  |---|---|
  | 200 | se aceptó al menos un evento (los inválidos vienen en `rejected`) |
  | 400 | no se aceptó ninguno, o el cuerpo no es JSON (`malformed_json`) |
  | 413 | cuerpo de más de 10 MB |

  Las pruebas se apoyan en `reason`; `detail` es texto libre.

### Razones de rechazo

| `reason` | Cuándo | ¿Qué hace GameConsole? |
|---|---|---|
| `malformed_json` | cuerpo inválido | error de programación: no se reintenta |
| `missing_required_field` | falta un campo obligatorio | no se reintenta |
| `invalid_timestamp` | timestamp no RFC 3339 | no se reintenta |
| `missing_player_id` | evento no `MATCH_*` sin `playerId` | no se reintenta |
| `unknown_field` | campo fuera del sobre | no se reintenta |
| `duplicate_event` | `eventId` ya aceptado | **se considera entregado** (un reintento de algo que ya llegó) |
| `match_not_started` | primer evento de la partida no es `MATCH_STARTED` | no se reintenta |
| `match_already_finished` | evento después de `MATCH_FINISHED` | no se reintenta |
| `reconnect_without_disconnect` | `PLAYER_RECONNECTED` sin desconexión previa | no se reintenta |

Los errores de red, timeouts y respuestas 5xx **sí** se reintentan (ver `README.md`, estrategia de
concurrencia).

### Estado en Go (importante para la concurrencia)

- Go guarda en **memoria** qué partidas están vivas, cuáles terminaron y qué `eventId` vio. Si el
  contenedor se reinicia, ese estado se pierde y los eventos pendientes de una partida ya empezada
  se rechazarían con `match_not_started`. Por eso las pruebas de caída usan
  `docker compose pause ingest` / `unpause`, no `stop` / `start`.
- Cuando llega `MATCH_FINISHED`, Go cierra la partida, ordena sus eventos por `timestamp` y manda
  el lote a Scala (`POST /analyze`, `contracts/batch.schema.json`). Si Scala falla, el lote queda
  en memoria de Go sin reintento.
- **No hay CORS** ni en Go ni en Scala (ninguna cabecera `Access-Control-*`). Un navegador no
  puede llamarlos desde otro origen; GameConsole los expone en su mismo origen con un proxy nginx
  transparente (ver README).

---

## 2. Juegos, `gameId` y eventos

Fuentes: `contracts/events.md`, `analytics-scala/src/main/scala/gamestats/analytics/*Analyzer.scala`,
`contracts/examples/*.json`, `contracts/results.md`.

P1 define **cuatro** juegos: `racing`, `combat`, `blackjack` y `battleship`. GameConsole implementa
tres: **`blackjack`**, **`battleship`** y **`racing`** (decisión acordada; `combat` queda fuera).

### Eventos generales (todos los juegos)

| `type` | `playerId` | `data` |
|---|---|---|
| `MATCH_STARTED` | `null` | `{ matchMode: "PVP" \| "PVE", ...propio del juego }` |
| `PLAYER_JOINED` | obligatorio | `{ playerType: "HUMAN" \| "BOT", botLevel?: "easy" \| "hard" }` |
| `PLAYER_DISCONNECTED` | obligatorio | `null` |
| `PLAYER_RECONNECTED` | obligatorio | `null` |
| `MATCH_FINISHED` | `null` | `null` |

`playerType` es lo que permite a Scala calcular "contra bots" y "contra humanos": un bot es un
jugador más con su propio `playerId`.

### `blackjack` — jugador contra el crupier (siempre `PVE`)

| `type` | `playerId` | `data` |
|---|---|---|
| `MATCH_STARTED` | `null` | `{ matchMode: "PVE", decks }` |
| `BET_PLACED` | jugador | `{ amount }` |
| `CARD_DEALT` | jugador **dueño de la ronda** | `{ card, to }`: `card` cumple `^(10\|[2-9AJQK])[HDCS]$`; `to` es quien recibe la carta (el jugador o el crupier) |
| `PLAYER_HIT` | jugador | `null` |
| `PLAYER_STAND` | jugador | `null` |
| `ROUND_RESULT` | jugador | `{ outcome: "WIN" \| "LOSE" \| "PUSH" \| "BLACKJACK" \| "BUST", payout }`: `payout` es un entero con signo, el neto de la ronda |

El crupier es un `PLAYER_JOINED` con `playerType: "BOT"`. El valor de la mano **no** viaja:
Scala lo reconstruye. Estadísticas: por partida `rounds` y `dealerBalance`; por jugador
`roundsPlayed`, `winRate`, `netBalance`, `avgBet` y `bustRate`; patrón `tilt` (sube la apuesta
tras 3 derrotas). Gana quien termina con saldo neto positivo; si nadie, `winnerId: null`.

### `battleship` — hundir la flota contra la máquina (siempre `PVE`)

| `type` | `playerId` | `data` |
|---|---|---|
| `MATCH_STARTED` | `null` | `{ matchMode: "PVE", boardSize: 10, fleet: [{ ship, size }] }` |
| `SHOT_FIRED` | **quien dispara** | `{ coord, hit }`: `coord` cumple `^[A-J](10\|[1-9])$`; `hit` es booleano |
| `SHIP_SUNK` | **dueño del barco hundido** | `{ ship, size }` |

Flota estándar: `carrier` 5, `battleship` 4, `cruiser` 3, `submarine` 3, `destroyer` 2. Gana
quien hunde tantos barcos como declara `fleet`; si nadie termina, `winnerId: null`. Estadísticas:
`shotsToWin` y `avgShotsPerShipSunk` del ganador; por jugador `shots`, `hits`, `accuracy` y
`shipsSunk`; patrón `hitStreak` (3 o más aciertos seguidos).

### `racing` — carreras (siempre `PVP`)

| `type` | `playerId` | `data` |
|---|---|---|
| `MATCH_STARTED` | `null` | `{ matchMode: "PVP", laps, track }` |
| `LAP_COMPLETED` | jugador | `{ lap, lapTimeMs, position }`: `position` es el puesto por tiempo acumulado al cerrar esa vuelta |
| `PENALTY` | jugador | `{ seconds, reason }` |

Estadísticas: `fastestLapMs`, `fastestLapBy`, `totalOvertakes` y `ranking` por tiempo ajustado
(tiempo más penalizaciones); por jugador `bestLapMs`, `avgLapMs`, `consistencyMs`, `overtakes` y
`positions`; patrón `comeback` (estuvo último y ganó).

### `AI_DECISION` — decisión de la IA (extensión de GameConsole)

**No está en el catálogo de P1.** Se agrega, por decisión acordada, usando el sobre exacto y sin
campos nuevos:

| `type` | `playerId` | `action` | `data` |
|---|---|---|---|
| `AI_DECISION` | el bot (`prolog-ai`) | `"HUNT"` o `"TARGET"` | `{ coord, reason }` |

Se emite justo antes del `SHOT_FIRED` del bot. Es válido para P1 porque `type` es un string libre
y el sobre no cambia: Go lo acepta, el `GenericAnalyzer` de Scala lo cuenta en
`generic.eventsByType` y `BattleshipAnalyzer` lo ignora, porque solo mira `SHOT_FIRED` y
`SHIP_SUNK`.

---

## 3. Cómo cuenta GameStats las instancias

- Una instancia es un `matchId`.
- Go la crea al aceptar su `MATCH_STARTED` y la cuenta en `activeMatches` (`GET /metrics`) mientras
  no termine. Ese número es **global**, no se separa por juego.
- Scala solo la conoce cuando Go le manda el lote, es decir, **después de `MATCH_FINISHED`**. A
  partir de ahí aparece en `GET /results/matches` con su `gameId`.
- Una partida que nunca recibe `MATCH_FINISHED` queda viva en Go para siempre y no se analiza nunca
  (`contracts/rejections.md`, "fuera de alcance"). Por eso GameConsole **siempre** cierra sus
  partidas, también al abandonarlas: manda `PLAYER_DISCONNECTED` del humano y `MATCH_FINISHED`.
- `playerCount` sale de los `PLAYER_JOINED`.

GameStats no tiene un endpoint de "instancias por juego". El panel muestra la cantidad de entradas
de `GET /results/matches` de cada `gameId` (terminadas y analizadas) y el `activeMatches` global
(en curso). Solo cuenta filas de una respuesta de GameStats; no calcula métricas.

---

## 4. Consulta de estadísticas

Fuentes: `analytics-scala/.../Main.scala`, `ResultStore.scala`, `contracts/results.md`,
`ingest-go/internal/ingest/metrics.go`.

**Solo consulta (polling).** No hay SSE, websockets ni push.

### ingest (Go) `:8080`

| Endpoint | Respuesta |
|---|---|
| `GET /health` | `{ "status": "ok", "service": "ingest-go" }` |
| `GET /metrics` | `{ eventsReceived, eventsValid, eventsInvalid, rejectionsByReason: {razón: n}, activeMatches, batchesSent, batchesFailed }` |

### analytics (Scala) `:8081`

| Endpoint | Respuesta | 404 |
|---|---|---|
| `GET /health` | `{ "status": "ok", "service": "analytics-scala" }` | — |
| `GET /results/matches` | `{ matches: [ { matchId, gameId, winnerId, eventCount, patterns: [regla] } ] }` ordenado por `matchId` | — |
| `GET /results/matches/{matchId}` | `{ matchId, gameId, gameVersion, analyzedAt, eventCount, generic: { eventsByType, activityPerMinute, playersSeen }, match: { startedAt, finishedAt, durationMs, playerCount, winnerId, gameSpecific }, players: [ { playerId, gameSpecific } ], patterns: [ { rule, playerId, detail } ] }` | partida no analizada |
| `GET /results/games/{gameId}/ranking?top=N` | `{ gameId, top, ranking: [ { rank, playerId, matchesPlayed, wins, winRate } ] }` | juego sin partidas |
| `GET /results/players/{playerId}` | `{ playerId, matchesPlayed, wins, winRate, vsBots, vsHumans, disconnections: { reconnections, abandons }, byGame: [ { gameId, matchesPlayed, gameSpecific } ], matches: [ { matchId, gameId, winner } ] }` | jugador sin partidas |
| `GET /` | interfaz HTML de solo lectura de P1 | — |

Números: los promedios vienen redondeados a 2 decimales y los tiempos en ms. Scala guarda los
resultados **en memoria**: si se reinicia, se pierden.

---

## 5. Cómo se levanta GameStats

Fuentes: `Dockerfile`, `docker-compose.yml`, `docker-compose.deploy.yml`, `docker/entrypoint.sh`,
`README.md`.

- **Una sola imagen** para los dos servicios. El modo lo elige el primer argumento: `all` (por
  defecto, los dos en un contenedor), `analytics`, `ingest`, `simulator` o `ejemplos`.
- Imagen publicada: `ghcr.io/gabo8086/gamestats` (amd64 y arm64), con tags `latest`,
  `sha-<commit>` y `v1.x`. La versión entregada es **`v1.4`**.
- Compose de P1: servicio `analytics` (modo `analytics`, puerto 8081) e `ingest` (modo `ingest`,
  puerto 8080, `ANALYTICS_URL=http://analytics:8081`, depende de que `analytics` esté sano).
- Variables de entorno: `PORT` (cada servicio), `ANALYTICS_URL` (Go → Scala), y `INGEST_PORT` /
  `ANALYTICS_PORT` (modo `all`).
- La imagen trae su propio `HEALTHCHECK` (`gamestats-health`), que revisa los servicios del modo con
  que arrancó.
- GameConsole usa la imagen publicada `v1.4` por defecto. Con `docker-compose.local.yml` la
  construye desde `../gamestats` sin modificar ese directorio.
