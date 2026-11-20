import { describe, expect, it } from 'vitest';
import { CollectingSink } from '../../src/core/EventSink';
import { Player } from '../../src/core/Player';
import { Card } from '../../src/games/blackjack/Card';
import { Shoe, StackedDeck } from '../../src/games/blackjack/Deck';
import { BlackjackGame, DEALER_ID } from '../../src/games/blackjack/BlackjackGame';
import { Hand } from '../../src/games/blackjack/Hand';

function mano(...codes: string[]): Hand {
  const h = new Hand();
  for (const c of codes) h.add(Card.parse(c));
  return h;
}

/** Orden del reparto inicial: jugador, crupier, jugador, crupier; despues lo que se pida. */
function partida(cartas: string[], bankroll = 100) {
  const sink = new CollectingSink();
  const game = new BlackjackGame(sink, Player.human('ana'), { cards: new StackedDeck(cartas), bankroll });
  game.start();
  return { sink, game };
}

describe('Card', () => {
  it('lee y escribe el formato del contrato', () => {
    expect(Card.parse('10H').code).toBe('10H');
    expect(Card.parse('AS').baseValue).toBe(11);
    expect(Card.parse('KD').baseValue).toBe(10);
    expect(() => Card.parse('1H')).toThrow();
    expect(() => Card.parse('AX')).toThrow();
  });
});

describe('Hand', () => {
  it('aplica la regla del as como Scala', () => {
    expect(mano('AS', 'KD').total).toBe(21);
    expect(mano('AS', 'KD').isBlackjack).toBe(true);
    expect(mano('AS', 'AH', '9C').total).toBe(21);
    expect(mano('AS', '6H').isSoft).toBe(true);
    expect(mano('AS', '6H', '10C').total).toBe(17);
    expect(mano('AS', '6H', '10C').isSoft).toBe(false);
    expect(mano('10S', '6H', 'QC').isBust).toBe(true);
    expect(mano('7S', '7H', '7C').isBlackjack).toBe(false);
  });
});

describe('Shoe', () => {
  it('tiene 52 cartas por baraja y se rearma al acabarse', () => {
    const s = new Shoe(1, () => 0.5);
    const vistas = new Set(Array.from({ length: 52 }, () => s.draw().code));
    expect(vistas.size).toBe(52);
    expect(s.remaining).toBe(0);
    s.draw();
    expect(s.remaining).toBe(51);
  });
});

describe('BlackjackGame', () => {
  it('emite el arranque con el crupier como BOT', () => {
    const { sink, game } = partida(['2H']);
    expect(sink.events.map((e) => e.type)).toEqual(['MATCH_STARTED', 'PLAYER_JOINED', 'PLAYER_JOINED']);
    expect(sink.events[0]!.data).toEqual({ matchMode: 'PVE', decks: 6 });
    expect(sink.events[2]).toMatchObject({ playerId: DEALER_ID, data: { playerType: 'BOT' } });
    expect(game.status).toBe('RUNNING');
  });

  it('reparte con playerId del dueno de la ronda y `to` de quien recibe', () => {
    const { sink, game } = partida(['10H', '9C', '7D', '8S']);
    game.placeBet(10);
    const cartas = sink.ofType('CARD_DEALT');
    expect(cartas.map((e) => e.playerId)).toEqual(['ana', 'ana', 'ana', 'ana']);
    expect(cartas.map((e) => e.data)).toEqual([
      { card: '10H', to: 'ana' },
      { card: '9C', to: DEALER_ID },
      { card: '7D', to: 'ana' },
      { card: '8S', to: DEALER_ID },
    ]);
    expect(game.dealerHoleHidden).toBe(true);
  });

  it('gana plantandose cuando el crupier se pasa', () => {
    // Jugador 10+7=17; crupier 9+6=15, pide 10 y se pasa.
    const { sink, game } = partida(['10H', '9C', '7D', '6S', '10C']);
    game.placeBet(10);
    game.stand();
    expect(game.lastRound).toMatchObject({ outcome: 'WIN', payout: 10 });
    expect(game.bankroll).toBe(110);
    expect(sink.ofType('ROUND_RESULT')[0]!.data).toEqual({ outcome: 'WIN', payout: 10 });
    expect(sink.events.map((e) => e.type).slice(-3)).toEqual(['PLAYER_STAND', 'CARD_DEALT', 'ROUND_RESULT']);
  });

  it('pasarse de 21 es BUST y el crupier no juega', () => {
    const { sink, game } = partida(['10H', '9C', '6D', '8S', 'KC']);
    game.placeBet(20);
    game.hit();
    expect(game.lastRound).toMatchObject({ outcome: 'BUST', payout: -20 });
    expect(sink.events.map((e) => e.type).slice(-3)).toEqual(['PLAYER_HIT', 'CARD_DEALT', 'ROUND_RESULT']);
  });

  it('blackjack natural paga 3:2 entero y cierra la ronda sin pedir', () => {
    const { game } = partida(['AS', '9C', 'KD', '8S']);
    game.placeBet(15);
    expect(game.phase).toBe('BETTING');
    expect(game.lastRound).toMatchObject({ outcome: 'BLACKJACK', payout: 22 });
  });

  it('empate y derrota frente al crupier', () => {
    const empate = partida(['10H', '10C', '8D', '8S']);
    empate.game.placeBet(10);
    empate.game.stand();
    expect(empate.game.lastRound).toMatchObject({ outcome: 'PUSH', payout: 0 });

    const derrota = partida(['10H', '10C', '7D', '9S']);
    derrota.game.placeBet(10);
    derrota.game.stand();
    expect(derrota.game.lastRound).toMatchObject({ outcome: 'LOSE', payout: -10 });
  });

  it('el crupier se planta en 17 blando', () => {
    const { game } = partida(['10H', 'AC', '8D', '6S']);
    game.placeBet(10);
    game.stand();
    expect(game.dealerTotal).toBe(17);
    expect(game.dealerHand).toHaveLength(2);
    expect(game.lastRound?.outcome).toBe('WIN');
  });

  it('valida la apuesta y el turno', () => {
    const { game } = partida(['10H', '9C', '7D', '8S'], 50);
    expect(() => game.placeBet(0)).toThrow();
    expect(() => game.placeBet(2.5)).toThrow();
    expect(() => game.placeBet(51)).toThrow();
    expect(() => game.hit()).toThrow();
    game.placeBet(10);
    expect(() => game.placeBet(10)).toThrow();
    expect(() => game.leaveTable()).toThrow();
  });

  it('termina sola al quedarse sin fichas', () => {
    const { sink, game } = partida(['10H', '10C', '7D', '9S'], 10);
    game.placeBet(10);
    game.stand();
    expect(game.status).toBe('FINISHED');
    expect(sink.events.at(-1)!.type).toBe('MATCH_FINISHED');
  });

  it('levantarse cierra la partida con MATCH_FINISHED', () => {
    const { sink, game } = partida(['2H']);
    game.leaveTable();
    expect(game.status).toBe('FINISHED');
    expect(sink.events.at(-1)).toMatchObject({ type: 'MATCH_FINISHED', playerId: null, data: null });
  });

  it('abandonar a mitad de ronda desconecta al humano y cierra la partida', () => {
    const { sink, game } = partida(['10H', '9C', '7D', '8S']);
    game.placeBet(10);
    game.abandon();
    expect(game.status).toBe('ABANDONED');
    expect(sink.events.slice(-2).map((e) => [e.type, e.playerId])).toEqual([
      ['PLAYER_DISCONNECTED', 'ana'],
      ['MATCH_FINISHED', null],
    ]);
    game.abandon(); // idempotente: no vuelve a emitir
    expect(sink.ofType('MATCH_FINISHED')).toHaveLength(1);
  });
});
