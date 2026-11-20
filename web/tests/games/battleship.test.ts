import { describe, expect, it } from 'vitest';
import { CollectingSink } from '../../src/core/EventSink';
import { Player } from '../../src/core/Player';
import { AI_ID, BattleshipGame } from '../../src/games/battleship/BattleshipGame';
import { Board } from '../../src/games/battleship/Board';
import { Coord } from '../../src/games/battleship/Coord';
import { placeFleet, STANDARD_FLEET } from '../../src/games/battleship/Fleet';
import { PrologAI } from '../../src/games/battleship/PrologAI';
import { Ship } from '../../src/games/battleship/Ship';
import type { OpponentView, ShotDecision, ShotStrategy } from '../../src/games/battleship/ShotStrategy';
import { schemaErrors } from '../contract/schema';

/** Generador pseudoaleatorio con semilla, para colocaciones reproducibles. */
function semilla(s: number): () => number {
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Flota fija: cada barco en su propia fila, desde la columna 1 (A1..A5, B1..B4, ...). */
function flotaEnFilas(): Ship[] {
  return STANDARD_FLEET.map((s, i) => Ship.straight(s.ship, s.size, new Coord(i, 0), true));
}

/** Estrategia falsa: dispara en orden a las coordenadas dadas y anota lo que vio. */
class Guion implements ShotStrategy {
  readonly vistas: OpponentView[] = [];
  private readonly jugadas: Array<string | Error>;
  constructor(jugadas: Array<string | Error>) {
    this.jugadas = [...jugadas];
  }
  async decide(view: OpponentView): Promise<ShotDecision> {
    this.vistas.push(structuredClone(view));
    const j = this.jugadas.shift();
    if (j === undefined) throw new Error('guion agotado');
    if (j instanceof Error) throw j;
    return { coord: j, mode: view.shots.some((s) => s.result === 'hit') ? 'TARGET' : 'HUNT', reason: `prueba ${j}` };
  }
}

/** Celdas de las filas I y J, donde la flota fija no tiene barcos. */
const AGUA = [8, 9].flatMap((f) => Array.from({ length: 10 }, (_, c) => new Coord(f, c).toString()));

function partida(jugadas: Array<string | Error>) {
  const sink = new CollectingSink();
  const ia = new Guion(jugadas);
  const game = new BattleshipGame(sink, Player.human('ana'), {
    strategy: ia,
    playerShips: flotaEnFilas(),
    aiShips: flotaEnFilas(),
    sleep: async () => {},
  });
  game.start();
  return { sink, ia, game };
}

describe('Coord', () => {
  it('usa fila = letra y columna = numero, como Prolog y el contrato', () => {
    expect(Coord.parse('B7')).toMatchObject({ row: 1, col: 6 });
    expect(new Coord(9, 9).toString()).toBe('J10');
    expect(Coord.parse('a1').toString()).toBe('A1');
    expect(() => Coord.parse('K1')).toThrow();
    expect(() => Coord.parse('A11')).toThrow();
    expect(() => Coord.parse('A0')).toThrow();
  });
});

describe('placeFleet', () => {
  it('coloca los 5 barcos dentro del tablero sin pisarse', () => {
    for (let s = 1; s <= 20; s++) {
      const barcos = placeFleet(STANDARD_FLEET, 10, semilla(s));
      const b = new Board(barcos); // el constructor valida limites y solapamientos
      expect(b.ships.map((x) => x.size)).toEqual([5, 4, 3, 3, 2]);
      expect(new Set(barcos.flatMap((x) => x.cells.map(String))).size).toBe(17);
    }
  });
});

describe('Board', () => {
  it('distingue agua, tocado y hundido, y lo reporta como lo pide Prolog', () => {
    const b = new Board([Ship.straight('destroyer', 2, new Coord(0, 0), true)]);
    expect(b.receiveShot(Coord.parse('C3'))).toEqual({ hit: false, sunk: null });
    expect(b.receiveShot(Coord.parse('A1')).hit).toBe(true);
    expect(b.knowledge()).toEqual([
      { coord: 'C3', result: 'miss' },
      { coord: 'A1', result: 'hit' },
    ]);
    const r = b.receiveShot(Coord.parse('A2'));
    expect(r.sunk?.name).toBe('destroyer');
    // Al hundirse, sus tocados pasan a "sunk": ya no son tocados pendientes.
    expect(b.knowledge().map((k) => k.result)).toEqual(['miss', 'sunk', 'sunk']);
    expect(b.allSunk).toBe(true);
    expect(() => b.receiveShot(Coord.parse('A1'))).toThrow();
  });

  it('rechaza barcos que se pisan', () => {
    expect(
      () => new Board([Ship.straight('a', 3, new Coord(0, 0), true), Ship.straight('b', 3, new Coord(0, 1), false)]),
    ).toThrow();
  });
});

describe('BattleshipGame', () => {
  it('arranca en PVE con la flota del contrato y la IA como BOT', () => {
    const { sink } = partida([]);
    expect(sink.events[0]!.data).toEqual({ matchMode: 'PVE', boardSize: 10, fleet: [...STANDARD_FLEET] });
    expect(sink.events[2]).toMatchObject({ playerId: AI_ID, data: { playerType: 'BOT', botLevel: 'hard' } });
  });

  it('el turno de la IA emite AI_DECISION antes de su SHOT_FIRED', async () => {
    const { sink, ia, game } = partida(['J10']);
    game.fire('J1');
    expect(game.phase).toBe('AI_TURN');
    await game.whenAiDone();

    expect(sink.events.slice(3).map((e) => [e.type, e.playerId, e.action])).toEqual([
      ['SHOT_FIRED', 'ana', null],
      ['AI_DECISION', AI_ID, 'HUNT'],
      ['SHOT_FIRED', AI_ID, null],
    ]);
    expect(sink.ofType('AI_DECISION')[0]!.data).toEqual({ coord: 'J10', reason: 'prueba J10' });
    expect(game.phase).toBe('PLAYER_TURN');
    expect(game.ai.lastDecision?.coord).toBe('J10');
    // La IA solo ve el resultado de sus disparos, no los barcos.
    expect(ia.vistas[0]).toEqual({ size: 10, shots: [], remaining: [5, 4, 3, 3, 2] });
  });

  it('SHIP_SUNK lleva al dueno del barco, no a quien disparo', async () => {
    // El destroyer de la IA esta en E1-E2.
    const { sink, game } = partida(['J1', 'J2']);
    game.fire('E1');
    await game.whenAiDone();
    game.fire('E2');
    await game.whenAiDone();
    expect(sink.ofType('SHIP_SUNK')).toHaveLength(1);
    expect(sink.ofType('SHIP_SUNK')[0]).toMatchObject({ playerId: AI_ID, data: { ship: 'destroyer', size: 2 } });
  });

  it('le dice a Prolog que tocados ya son de un barco hundido', async () => {
    // La IA hunde el destroyer del humano (E1-E2) y en el turno siguiente lo ve como "sunk".
    const { ia, game } = partida(['E1', 'E2', 'J10']);
    for (const c of ['J1', 'J2', 'J3']) {
      game.fire(c);
      await game.whenAiDone();
    }
    expect(ia.vistas[1]!.shots).toEqual([{ coord: 'E1', result: 'hit' }]);
    expect(ia.vistas[2]).toEqual({
      size: 10,
      shots: [
        { coord: 'E1', result: 'sunk' },
        { coord: 'E2', result: 'sunk' },
      ],
      remaining: [5, 4, 3, 3],
    });
  });

  it('el humano gana al hundir toda la flota y la partida se cierra', async () => {
    const objetivos = flotaEnFilas().flatMap((s) => s.cells.map(String));
    const { sink, game } = partida(AGUA.slice(0, 16));
    for (const c of objetivos) {
      game.fire(c);
      await game.whenAiDone();
    }
    expect(game.status).toBe('FINISHED');
    expect(game.winnerId).toBe('ana');
    expect(sink.ofType('SHIP_SUNK').every((e) => e.playerId === AI_ID)).toBe(true);
    expect(sink.ofType('SHIP_SUNK')).toHaveLength(5);
    expect(sink.events.at(-1)!.type).toBe('MATCH_FINISHED');
    // El ultimo disparo gano: la IA ya no juega despues.
    expect(sink.ofType('SHOT_FIRED').filter((e) => e.playerId === AI_ID)).toHaveLength(16);
    for (const e of sink.events) expect(schemaErrors(e), e.type).toBe('');
  });

  it('la IA gana al hundir la flota del humano', async () => {
    const objetivos = flotaEnFilas().flatMap((s) => s.cells.map(String));
    const { game } = partida(objetivos);
    for (let i = 0; i < objetivos.length; i++) {
      game.fire(AGUA[i]!);
      await game.whenAiDone();
    }
    expect(game.status).toBe('FINISHED');
    expect(game.winnerId).toBe(AI_ID);
  });

  it('si Prolog no responde avisa, reintenta y nunca dispara al azar', async () => {
    const { sink, game } = partida([new Error('Prolog caido'), new Error('Prolog caido'), 'A1']);
    const estados: string[] = [];
    game.onChange(() => estados.push(game.ai.state));
    game.fire('J1');
    await game.whenAiDone();

    expect(estados).toContain('unavailable');
    // Ningun disparo de la IA mientras no hubo respuesta: el unico es el que eligio Prolog.
    expect(sink.ofType('SHOT_FIRED').filter((e) => e.playerId === AI_ID).map((e) => e.data)).toEqual([
      { coord: 'A1', hit: true },
    ]);
    expect(game.ai).toMatchObject({ state: 'idle', failures: 0, error: null });
  });

  it('rechaza una jugada repetida de la IA sin emitir nada y reintenta', async () => {
    const { sink, game } = partida(['A1', 'A1', 'B1']);
    game.fire('J1');
    await game.whenAiDone();
    game.fire('J2');
    await game.whenAiDone();
    expect(sink.ofType('AI_DECISION').map((e) => e.data?.coord)).toEqual(['A1', 'B1']);
  });

  it('valida el turno y los disparos repetidos del humano', async () => {
    const { game } = partida(['A1']);
    expect(() => game.fire('Z1')).toThrow();
    game.fire('J1');
    expect(() => game.fire('J2')).toThrow(/turno/);
    await game.whenAiDone();
    expect(() => game.fire('J1')).toThrow(/Ya disparaste/);
  });

  it('abandonar mientras la IA piensa no emite nada despues del MATCH_FINISHED', async () => {
    let responder!: (d: ShotDecision) => void;
    const lenta: ShotStrategy = { decide: () => new Promise((r) => (responder = r)) };
    const sink = new CollectingSink();
    const game = new BattleshipGame(sink, Player.human('ana'), { strategy: lenta });
    game.start();
    game.fire('A1');
    game.abandon();
    responder({ coord: 'B2', mode: 'HUNT', reason: 'tarde' });
    await game.whenAiDone();
    expect(sink.events.at(-1)!.type).toBe('MATCH_FINISHED');
    expect(sink.ofType('AI_DECISION')).toHaveLength(0);
  });

  it('solo deja recolocar la flota antes del primer disparo', async () => {
    const { game } = partida(['A1']);
    expect(game.canRearrange).toBe(true);
    game.rearrangeFleet();
    game.fire('J1');
    expect(game.canRearrange).toBe(false);
    expect(() => game.rearrangeFleet()).toThrow();
  });
});

describe('PrologAI', () => {
  const vista: OpponentView = { size: 10, shots: [{ coord: 'E5', result: 'hit' }], remaining: [5, 4, 3, 3, 2] };

  it('manda lo que ve al servicio y devuelve su jugada', async () => {
    let pedido: { url: string; body: unknown } | null = null;
    const ai = new PrologAI('/prolog', 1000, async (url, init) => {
      pedido = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ coord: 'D5', mode: 'TARGET', reason: 'junto a un tocado' }));
    });
    await expect(ai.decide(vista)).resolves.toEqual({ coord: 'D5', mode: 'TARGET', reason: 'junto a un tocado' });
    expect(pedido).toEqual({ url: '/prolog/battleship/move', body: vista });
  });

  it('lanza si el servicio falla o responde algo inesperado', async () => {
    await expect(new PrologAI('', 1000, async () => new Response('', { status: 502 })).decide(vista)).rejects.toThrow(/502/);
    await expect(new PrologAI('', 1000, async () => new Response('{"coord":1}')).decide(vista)).rejects.toThrow(/formato/);
    await expect(
      new PrologAI('', 1000, async () => {
        throw new TypeError('fetch failed');
      }).decide(vista),
    ).rejects.toThrow(/Sin conexion/);
  });
});
