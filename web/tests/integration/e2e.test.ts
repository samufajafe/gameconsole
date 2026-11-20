/**
 * Prueba de punta a punta contra un GameStats REAL. Solo corre si se le dice donde esta:
 *
 *   docker compose up -d --wait
 *   docker run --rm --network gameconsole_default -v "$PWD/web:/app" -w /app \
 *     -e GAMESTATS_INGEST_URL=http://ingest:8080 -e GAMESTATS_ANALYTICS_URL=http://analytics:8081 \
 *     node:22.11.0-alpine npx vitest run tests/integration
 *
 * Usa las mismas clases que la consola (juego, emisor, transporte HTTP y cliente del panel); solo
 * falta el DOM.
 */
import { describe, expect, it } from 'vitest';
import { Player } from '../../src/core/Player';
import { HttpIngestTransport } from '../../src/events/IngestTransport';
import { MatchEmitter } from '../../src/events/MatchEmitter';
import { StackedDeck } from '../../src/games/blackjack/Deck';
import { BlackjackGame } from '../../src/games/blackjack/BlackjackGame';
import { AI_ID, BattleshipGame } from '../../src/games/battleship/BattleshipGame';
import { Coord } from '../../src/games/battleship/Coord';
import { STANDARD_FLEET } from '../../src/games/battleship/Fleet';
import { PrologAI } from '../../src/games/battleship/PrologAI';
import { Ship } from '../../src/games/battleship/Ship';
import { GameStatsClient, type MatchResult } from '../../src/panel/GameStatsClient';

const INGEST = process.env.GAMESTATS_INGEST_URL;
const ANALYTICS = process.env.GAMESTATS_ANALYTICS_URL;
const PROLOG = process.env.PROLOG_URL;

const transport = new HttpIngestTransport(INGEST);
const client = new GameStatsClient(INGEST, ANALYTICS);

/** Espera a que Scala tenga el resultado: Go se lo manda despues de MATCH_FINISHED. */
async function resultado(matchId: string, ms = 10_000): Promise<MatchResult> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    const r = await client.match(matchId);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`GameStats no analizo ${matchId}`);
}

describe.skipIf(!INGEST || !ANALYTICS)('punta a punta con GameStats', () => {
  it('blackjack: una sesion completa llega, se analiza y aparece en el listado y el ranking', async () => {
    const jugador = `e2e-${Date.now()}`;
    const em = new MatchEmitter(transport);
    // Ronda 1: 10+7 contra 9+6 que se pasa con 10 (WIN +10). Ronda 2: 10+6 pide K (BUST -20).
    const game = new BlackjackGame(em, Player.human(jugador), {
      cards: new StackedDeck(['10H', '9C', '7D', '6S', '10C', '10D', '9H', '6C', '8S', 'KH']),
    });
    game.start();
    game.placeBet(10);
    game.stand();
    game.placeBet(20);
    game.hit();
    game.leaveTable();
    await em.whenIdle();
    expect(em.stats).toMatchObject({ dead: 0, queued: 0 });

    const r = await resultado(game.matchId);
    expect(r.gameId).toBe('blackjack');
    expect(r.match.gameSpecific).toMatchObject({ rounds: 2, dealerBalance: 10 });
    const yo = r.players.find((p) => p.playerId === jugador)!;
    expect(yo.gameSpecific).toMatchObject({ roundsPlayed: 2, netBalance: -10, winRate: 50, bustRate: 50 });

    const listado = await client.matches();
    expect(listado.some((m) => m.matchId === game.matchId && m.gameId === 'blackjack')).toBe(true);
    const ranking = await client.ranking('blackjack', 1000);
    expect(ranking?.ranking.some((x) => x.playerId === jugador)).toBe(true);
  });

  it('una partida abandonada se analiza igual, sin ganador, y cuenta como abandono', async () => {
    const jugador = `e2e-abandono-${Date.now()}`;
    const em = new MatchEmitter(transport);
    // Una ronda cerrada (17 contra 17: PUSH) y otra a medias. Ojo: si NINGUNA ronda se cierra, el
    // BlackjackAnalyzer de P1 no lista al jugador (solo cuenta a quien tiene ROUND_RESULT) y su
    // perfil da 404; la partida igual se analiza.
    const game = new BlackjackGame(em, Player.human(jugador), {
      cards: new StackedDeck(['10H', '9C', '7D', '8S', '10S', '9D', '7C', '8H']),
    });
    game.start();
    game.placeBet(10);
    game.stand();
    game.placeBet(10); // ronda a medias
    game.abandon();
    await em.whenIdle();
    expect(em.stats.dead).toBe(0);

    const r = await resultado(game.matchId);
    expect(r.match.winnerId).toBeNull();
    expect(r.generic?.eventsByType).toMatchObject({ PLAYER_DISCONNECTED: 1, MATCH_FINISHED: 1 });

    const perfil = await client.player(jugador);
    expect(perfil?.disconnections.abandons).toBe(1);
  });

  it('varias partidas concurrentes no se mezclan', async () => {
    const partidas = Array.from({ length: 5 }, (_, i) => {
      const em = new MatchEmitter(transport);
      const game = new BlackjackGame(em, Player.human(`e2e-conc-${i}-${Date.now()}`), {
        cards: new StackedDeck(['10H', '9C', '7D', '8S']),
      });
      return { em, game };
    });
    // Intercaladas: todas empiezan, todas apuestan, todas se plantan, todas terminan.
    for (const p of partidas) p.game.start();
    for (const p of partidas) p.game.placeBet(5);
    for (const p of partidas) p.game.stand();
    for (const p of partidas) p.game.leaveTable();
    await Promise.all(partidas.map((p) => p.em.whenIdle()));

    for (const p of partidas) {
      const r = await resultado(p.game.matchId);
      expect(r.eventCount).toBe(p.em.stats.delivered);
      expect(r.players.map((x) => x.playerId)).toEqual([p.game.participants[0]!.id]);
    }
  });
});

describe.skipIf(!INGEST || !ANALYTICS || !PROLOG)('punta a punta con GameStats y la IA en Prolog', () => {
  it('battleship: la IA real juega cada turno y GameStats analiza la partida', async () => {
    const jugador = `e2e-bs-${Date.now()}`;
    const em = new MatchEmitter(transport);
    // La flota de la IA es conocida para que el humano gane en 17 disparos; la del humano es al azar.
    const flotaIA = STANDARD_FLEET.map((s, i) => Ship.straight(s.ship, s.size, new Coord(i * 2, 0), true));
    const game = new BattleshipGame(em, Player.human(jugador), { strategy: new PrologAI(PROLOG), aiShips: flotaIA });
    game.start();
    for (const c of flotaIA.flatMap((s) => s.cells)) {
      game.fire(c);
      await game.whenAiDone();
      expect(game.ai.failures).toBe(0);
    }
    expect(game.winnerId).toBe(jugador);
    await em.whenIdle();
    expect(em.stats).toMatchObject({ dead: 0, queued: 0 });

    const r = await resultado(game.matchId);
    expect(r.match.winnerId).toBe(jugador);
    expect(r.match.gameSpecific).toMatchObject({ boardSize: 10, shotsToWin: 17 });
    expect(r.generic?.eventsByType).toMatchObject({ AI_DECISION: 16, SHOT_FIRED: 33 });
    const yo = r.players.find((p) => p.playerId === jugador)!;
    expect(yo.gameSpecific).toMatchObject({ shots: 17, hits: 17, shipsSunk: 5 });
    expect(r.players.find((p) => p.playerId === AI_ID)?.gameSpecific).toMatchObject({ shots: 16 });
  });
});
