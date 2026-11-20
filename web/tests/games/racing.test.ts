import { describe, expect, it } from 'vitest';
import { CollectingSink } from '../../src/core/EventSink';
import { Player } from '../../src/core/Player';
import { FALSE_START_PENALTY_S, RacingGame } from '../../src/games/racing/RacingGame';
import { schemaErrors } from '../contract/schema';

/** Reloj manual: las pruebas deciden cuanto tiempo pasa. */
function relojManual(inicio = Date.UTC(2026, 10, 19, 12)) {
  let t = inicio;
  return { clock: () => new Date(t), avanzar: (ms: number) => void (t += ms) };
}

function carrera(laps = 2, pressesPerLap = 4) {
  const sink = new CollectingSink();
  const reloj = relojManual();
  const game = new RacingGame(sink, [Player.human('ana'), Player.human('beto')], { laps, pressesPerLap, clock: reloj.clock });
  game.start();
  return { sink, game, reloj };
}

/** Da `n` pulsaciones alternadas validas al piloto `i`. */
function acelerar(game: RacingGame, i: number, n: number) {
  for (let k = 0; k < n; k++) {
    const ultimo = game.racers[i]!.ultimoPedal;
    game.press(i, ultimo === 'left' ? 'right' : 'left');
  }
}

describe('RacingGame', () => {
  it('arranca en PVP con dos humanos, vueltas y pista', () => {
    const { sink, game } = carrera(3);
    expect(sink.events.map((e) => e.type)).toEqual(['MATCH_STARTED', 'PLAYER_JOINED', 'PLAYER_JOINED']);
    expect(sink.events[0]!.data).toEqual({ matchMode: 'PVP', laps: 3, track: game.track });
    expect(sink.events.slice(1).map((e) => e.data)).toEqual([{ playerType: 'HUMAN' }, { playerType: 'HUMAN' }]);
    expect(game.phase).toBe('COUNTDOWN');
  });

  it('rechaza dos pilotos con el mismo nombre', () => {
    expect(() => new RacingGame(new CollectingSink(), [Player.human('ana'), Player.human('ana')])).toThrow();
  });

  it('acelerar antes de la largada es salida en falso: un PENALTY por piloto y no avanza', () => {
    const { sink, game } = carrera();
    game.press(0, 'left');
    game.press(0, 'right');
    game.press(0, 'left');
    expect(sink.ofType('PENALTY')).toHaveLength(1);
    expect(sink.ofType('PENALTY')[0]).toMatchObject({ playerId: 'ana', data: { seconds: FALSE_START_PENALTY_S, reason: 'false_start' } });
    expect(game.racers[0]!.progress).toBe(0);
    expect(game.racers[1]!.penaltySeconds).toBe(0);
  });

  it('solo avanza alternando las dos teclas', () => {
    const { game } = carrera();
    game.go();
    game.press(0, 'left');
    game.press(0, 'left');
    game.press(0, 'left');
    expect(game.racers[0]!.progress).toBe(1);
    game.press(0, 'right');
    expect(game.racers[0]!.progress).toBe(2);
  });

  it('cierra vueltas con su tiempo y el puesto por tiempo acumulado', () => {
    const { sink, game, reloj } = carrera(2, 4);
    game.go();
    reloj.avanzar(1000);
    acelerar(game, 1, 4); // beto cierra la vuelta 1 primero
    reloj.avanzar(500);
    acelerar(game, 0, 4);
    reloj.avanzar(1000);
    acelerar(game, 0, 4); // ana cierra la vuelta 2 primero: adelanta
    reloj.avanzar(2000);
    acelerar(game, 1, 4);

    expect(sink.ofType('LAP_COMPLETED').map((e) => [e.playerId, e.data])).toEqual([
      ['beto', { lap: 1, lapTimeMs: 1000, position: 1 }],
      ['ana', { lap: 1, lapTimeMs: 1500, position: 2 }],
      ['ana', { lap: 2, lapTimeMs: 1000, position: 1 }],
      ['beto', { lap: 2, lapTimeMs: 3500, position: 2 }],
    ]);
    expect(game.status).toBe('FINISHED');
    expect(sink.events.at(-1)!.type).toBe('MATCH_FINISHED');
    for (const e of sink.events) expect(schemaErrors(e), e.type).toBe('');
  });

  it('no termina hasta que llegan los dos y no cuenta pulsaciones de quien ya llego', () => {
    const { sink, game } = carrera(1, 2);
    game.go();
    acelerar(game, 0, 2);
    expect(game.racers[0]!.finished).toBe(true);
    expect(game.status).toBe('RUNNING');
    acelerar(game, 0, 6);
    expect(sink.ofType('LAP_COMPLETED')).toHaveLength(1);
    acelerar(game, 1, 2);
    expect(game.status).toBe('FINISHED');
  });

  it('abandonar desconecta a los dos humanos y cierra la partida', () => {
    const { sink, game } = carrera();
    game.go();
    game.abandon();
    expect(sink.events.slice(-3).map((e) => [e.type, e.playerId])).toEqual([
      ['PLAYER_DISCONNECTED', 'ana'],
      ['PLAYER_DISCONNECTED', 'beto'],
      ['MATCH_FINISHED', null],
    ]);
    game.press(0, 'left'); // ya no emite nada
    expect(sink.events.at(-1)!.type).toBe('MATCH_FINISHED');
  });
});
