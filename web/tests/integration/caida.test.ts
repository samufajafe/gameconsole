/**
 * Prueba de concurrencia con GameStats CAIDO. No corre sola: la orquesta `scripts/prueba-caida.sh`,
 * que hace `docker compose pause ingest`, lanza esta prueba y, unos segundos despues,
 * `docker compose unpause ingest`. (Nunca stop/start: Go perderia el estado de las partidas.)
 *
 * Con ingest congelado se juegan 10 partidas a la vez de los tres juegos, repartidas en 3
 * "pestanas" (cada una con su propio transporte y sus emisores, como una pestana real):
 *
 *   1. los juegos terminan sin esperar a la red, aunque GameStats no responda;
 *   2. mientras dura la caida no se entrega nada y todo queda en cola, reintentando;
 *   3. al volver ingest, cada partida llega completa (sin rechazos) y GameStats la analiza con
 *      exactamente los eventos que se emitieron, sin mezclarse con las demas.
 */
import { describe, expect, it } from 'vitest';
import { Player } from '../../src/core/Player';
import { HttpIngestTransport } from '../../src/events/IngestTransport';
import { MatchEmitter } from '../../src/events/MatchEmitter';
import type { Game } from '../../src/core/Game';
import { BattleshipGame } from '../../src/games/battleship/BattleshipGame';
import { Coord } from '../../src/games/battleship/Coord';
import { STANDARD_FLEET } from '../../src/games/battleship/Fleet';
import { PrologAI } from '../../src/games/battleship/PrologAI';
import { Ship } from '../../src/games/battleship/Ship';
import { BlackjackGame } from '../../src/games/blackjack/BlackjackGame';
import { RacingGame } from '../../src/games/racing/RacingGame';
import { GameStatsClient, type MatchResult } from '../../src/panel/GameStatsClient';

const INGEST = process.env.GAMESTATS_INGEST_URL;
const ANALYTICS = process.env.GAMESTATS_ANALYTICS_URL;
const PROLOG = process.env.PROLOG_URL;
const ACTIVA = process.env.GAMESTATS_CAIDA === '1';

const client = new GameStatsClient(INGEST, ANALYTICS);

interface Partida {
  game: Game;
  em: MatchEmitter;
}

async function jugarBlackjack(transport: HttpIngestTransport, id: string): Promise<Partida> {
  const em = new MatchEmitter(transport);
  const game = new BlackjackGame(em, Player.human(id));
  game.start();
  for (let r = 0; r < 3 && game.isRunning; r++) {
    game.placeBet(10);
    while (game.phase === 'PLAYER_TURN') game.playerTotal < 15 ? game.hit() : game.stand();
  }
  if (game.isRunning) game.leaveTable();
  return { game, em };
}

async function jugarBattleship(transport: HttpIngestTransport, id: string): Promise<Partida> {
  const em = new MatchEmitter(transport);
  const flotaIA = STANDARD_FLEET.map((s, i) => Ship.straight(s.ship, s.size, new Coord(i * 2, 0), true));
  const game = new BattleshipGame(em, Player.human(id), { strategy: new PrologAI(PROLOG), aiShips: flotaIA });
  game.start();
  for (const c of flotaIA.flatMap((s) => s.cells)) {
    game.fire(c);
    await game.whenAiDone(); // la IA si responde: solo GameStats esta caido
  }
  return { game, em };
}

async function jugarRacing(transport: HttpIngestTransport, a: string, b: string): Promise<Partida> {
  const em = new MatchEmitter(transport);
  let t = Date.now();
  const game = new RacingGame(em, [Player.human(a), Player.human(b)], { laps: 2, pressesPerLap: 2, clock: () => new Date(t) });
  game.start();
  game.press(1, 'left'); // salida en falso
  game.go();
  for (const [i, ms] of [[0, 4000], [1, 500], [0, 4000], [1, 500]] as const) {
    t += ms;
    game.press(i, 'left');
    game.press(i, 'right');
  }
  return { game, em };
}

async function resultado(matchId: string): Promise<MatchResult> {
  const limite = Date.now() + 15_000;
  while (Date.now() < limite) {
    const r = await client.match(matchId);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`GameStats no analizo ${matchId}`);
}

describe.skipIf(!ACTIVA || !INGEST || !ANALYTICS || !PROLOG)('caida de GameStats con partidas concurrentes', () => {
  it('ninguna partida se pierde ni se mezcla mientras ingest esta en pausa', { timeout: 180_000 }, async () => {
    // 0. Confirmar que de verdad esta caido: /metrics no responde.
    await expect(client.metrics()).rejects.toThrow();

    // 1. Tres pestanas, 10 partidas en total, todas a la vez.
    const sufijo = Date.now();
    const pestanas = [0, 1, 2].map(() => new HttpIngestTransport(INGEST));
    const inicio = Date.now();
    const partidas = await Promise.all([
      ...[0, 1, 2, 3].map((i) => jugarBlackjack(pestanas[i % 3]!, `caida-bj-${i}-${sufijo}`)),
      ...[0, 1, 2].map((i) => jugarBattleship(pestanas[i]!, `caida-bs-${i}-${sufijo}`)),
      ...[0, 1, 2].map((i) => jugarRacing(pestanas[i]!, `caida-ra-${i}-${sufijo}`, `caida-rb-${i}-${sufijo}`)),
    ]);
    const jugado = Date.now() - inicio;

    // Los juegos no esperan a la red: terminan aunque GameStats no conteste.
    expect(partidas.every((p) => p.game.status === 'FINISHED')).toBe(true);
    console.log(`10 partidas jugadas en ${jugado} ms con ingest en pausa`);

    // 2. Nada entregado todavia; todo en cola.
    for (const p of partidas) {
      expect(p.em.stats.delivered).toBe(0);
      expect(p.em.stats.queued).toBeGreaterThan(0);
    }

    // 3. Esperar a que vuelva ingest (el script hace unpause) y que cada emisor vacie su cola.
    await Promise.all(partidas.map((p) => p.em.whenIdle()));
    const reintentos = partidas.reduce((n, p) => n + p.em.stats.retries, 0);
    console.log(`todo entregado tras ${Date.now() - inicio} ms y ${reintentos} reintentos`);

    for (const p of partidas) {
      expect(p.em.stats).toMatchObject({ dead: 0, queued: 0 });
      expect(p.em.stats.retries).toBeGreaterThan(0);
      const r = await resultado(p.game.matchId);
      // Exactamente los eventos emitidos: ni perdidos ni duplicados ni de otra partida.
      expect(r.eventCount, `${p.game.gameId} ${p.game.matchId}`).toBe(p.em.stats.delivered);
      expect(r.gameId).toBe(p.game.gameId);
      // Sin jugadores de otras partidas. (El analizador de blackjack de P1 no lista al crupier:
      // solo cuenta a quien tiene ROUND_RESULT; por eso se exige a los humanos y no a todos.)
      const propios = new Set(p.game.participants.map((x) => x.id));
      expect(r.players.every((x) => propios.has(x.playerId))).toBe(true);
      for (const h of p.game.participants.filter((x) => !x.isBot)) {
        expect(r.players.some((x) => x.playerId === h.id)).toBe(true);
      }
    }
  });
});
