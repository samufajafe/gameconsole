import { describe, expect, it } from 'vitest';
import { EventFactory } from '../../src/core/EventFactory';
import { CollectingSink } from '../../src/core/EventSink';
import { Player } from '../../src/core/Player';
import { StackedDeck } from '../../src/games/blackjack/Deck';
import { BlackjackGame } from '../../src/games/blackjack/BlackjackGame';
import { schemaErrors, validateEvent } from '../contract/schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('EventFactory', () => {
  it('arma un sobre que cumple el JSON Schema de GameStats', () => {
    const f = new EventFactory('blackjack', 'm-1');
    const eventos = [
      f.create('MATCH_STARTED', null, { matchMode: 'PVE', decks: 6 }),
      f.create('PLAYER_JOINED', 'ana', { playerType: 'HUMAN' }),
      f.create('AI_DECISION', 'prolog-ai', { coord: 'A1', reason: 'densidad' }, 'HUNT'),
      f.create('MATCH_FINISHED', null),
    ];
    for (const e of eventos) expect(schemaErrors(e)).toBe('');
  });

  it('solo usa los campos del sobre cerrado', () => {
    const e = new EventFactory('racing', 'm-1').create('MATCH_STARTED', null, {});
    expect(Object.keys(e).sort()).toEqual(
      ['action', 'data', 'eventId', 'gameId', 'gameVersion', 'matchId', 'playerId', 'timestamp', 'type'].sort(),
    );
    // Control del propio test: el esquema copiado de P1 sí rechaza un campo extra.
    expect(validateEvent({ ...e, extra: 1 })).toBe(false);
  });

  it('usa UUID v4 unicos y timestamps RFC 3339 en UTC con milisegundos', () => {
    const f = new EventFactory('blackjack', 'm-1');
    const a = f.create('MATCH_STARTED', null);
    const b = f.create('MATCH_FINISHED', null);
    expect(a.eventId).toMatch(UUID);
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('nunca retrocede el timestamp dentro de una partida', () => {
    const horas = [2000, 1000, 3000];
    const f = new EventFactory('racing', 'm', () => new Date(horas.shift()!));
    const t = [0, 1, 2].map(() => Date.parse(f.create('MATCH_STARTED', null).timestamp));
    expect(t).toEqual([2000, 2000, 3000]);
  });

  it('pone playerId null en MATCH_* y exige jugador en el resto', () => {
    const f = new EventFactory('blackjack', 'm');
    expect(f.create('MATCH_STARTED', 'ana').playerId).toBeNull();
    expect(() => f.create('BET_PLACED', null)).toThrow();
  });

  it('una partida completa de blackjack solo produce eventos validos para GameStats', () => {
    const sink = new CollectingSink();
    const g = new BlackjackGame(sink, Player.human('ana'), { cards: new StackedDeck(['10H', '9C', '7D', '8S', '5H']) });
    g.start();
    g.placeBet(20);
    g.hit();
    g.leaveTable();

    for (const e of sink.events) expect(schemaErrors(e), `${e.type}`).toBe('');
    expect(new Set(sink.events.map((e) => e.matchId))).toEqual(new Set([g.matchId]));
    expect(g.matchId).toMatch(UUID);
  });
});
