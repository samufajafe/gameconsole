import { Game, type GameOptions } from '../../core/Game';
import type { EventData } from '../../core/GameEvent';
import type { EventSink } from '../../core/EventSink';
import { Player } from '../../core/Player';
import type { Card } from './Card';
import { Shoe, type CardSource } from './Deck';
import { Hand } from './Hand';

export type RoundOutcome = 'WIN' | 'LOSE' | 'PUSH' | 'BLACKJACK' | 'BUST';
export type BlackjackPhase = 'BETTING' | 'PLAYER_TURN';

export interface RoundSummary {
  bet: number;
  outcome: RoundOutcome;
  /** Neto con signo para el jugador, igual que `ROUND_RESULT.data.payout`. */
  payout: number;
  playerTotal: number;
  dealerTotal: number;
}

/** Regla fija del crupier: pide hasta 17 y se planta en 17 o mas (incluido 17 blando). */
export class DealerPolicy {
  shouldHit(hand: Hand): boolean {
    return hand.total < 17;
  }
}

export interface BlackjackOptions extends GameOptions {
  decks?: number;
  bankroll?: number;
  cards?: CardSource;
}

export const DEALER_ID = 'dealer';

/**
 * Blackjack: un jugador humano contra el crupier (PVE).
 *
 * Una partida es una sesion de varias rondas; termina cuando el jugador se levanta de la mesa o
 * se queda sin fichas. Eventos (docs/CONTRACT.md §2): BET_PLACED, CARD_DEALT (el `playerId` es el
 * dueno de la ronda y `to` quien recibe la carta), PLAYER_HIT, PLAYER_STAND y ROUND_RESULT. El
 * valor de la mano NO viaja: Scala lo reconstruye.
 */
export class BlackjackGame extends Game {
  override readonly title = 'Blackjack';

  private readonly cartas: CardSource;
  private readonly decks: number;
  private readonly politica = new DealerPolicy();
  private fase: BlackjackPhase = 'BETTING';
  private fichas: number;
  private apuesta = 0;
  private manoJugador = new Hand();
  private manoCrupier = new Hand();
  private ultima: RoundSummary | null = null;
  private rondas = 0;

  constructor(
    sink: EventSink,
    private readonly human: Player,
    options: BlackjackOptions = {},
  ) {
    super('blackjack', sink, [human, Player.bot(DEALER_ID, 'easy', 'Crupier')], options);
    this.decks = options.decks ?? 6;
    this.cartas = options.cards ?? new Shoe(this.decks);
    this.fichas = options.bankroll ?? 500;
  }

  protected override startData(): EventData {
    return { decks: this.decks };
  }

  get phase(): BlackjackPhase {
    return this.fase;
  }
  get bankroll(): number {
    return this.fichas;
  }
  get currentBet(): number {
    return this.apuesta;
  }
  get playerHand(): readonly Card[] {
    return this.manoJugador.cards;
  }
  get playerTotal(): number {
    return this.manoJugador.total;
  }
  get dealerHand(): readonly Card[] {
    return this.manoCrupier.cards;
  }
  get dealerTotal(): number {
    return this.manoCrupier.total;
  }
  /** La segunda carta del crupier se muestra solo cuando la ronda termino. */
  get dealerHoleHidden(): boolean {
    return this.fase === 'PLAYER_TURN';
  }
  get lastRound(): RoundSummary | null {
    return this.ultima;
  }
  get roundsPlayed(): number {
    return this.rondas;
  }

  /** Abre una ronda: apuesta y reparto inicial (jugador, crupier, jugador, crupier). */
  placeBet(amount: number): void {
    this.requireRunning();
    if (this.fase !== 'BETTING') throw new Error('Ya hay una ronda en juego');
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('La apuesta debe ser un entero positivo');
    if (amount > this.fichas) throw new Error('No hay fichas suficientes');

    this.apuesta = amount;
    this.manoJugador = new Hand();
    this.manoCrupier = new Hand();
    this.ultima = null;
    this.fase = 'PLAYER_TURN';
    this.emit('BET_PLACED', this.human.id, { amount });

    this.repartir(this.manoJugador, this.human.id);
    this.repartir(this.manoCrupier, DEALER_ID);
    this.repartir(this.manoJugador, this.human.id);
    this.repartir(this.manoCrupier, DEALER_ID);

    if (this.manoJugador.isBlackjack || this.manoCrupier.isBlackjack) this.cerrarRonda();
    this.changed();
  }

  hit(): void {
    this.requireTurn();
    this.emit('PLAYER_HIT', this.human.id);
    this.repartir(this.manoJugador, this.human.id);
    if (this.manoJugador.isBust) this.cerrarRonda();
    else if (this.manoJugador.total === 21) this.plantarse();
    this.changed();
  }

  stand(): void {
    this.requireTurn();
    this.plantarse();
    this.changed();
  }

  /** El jugador se levanta de la mesa: fin normal de la partida. */
  leaveTable(): void {
    this.requireRunning();
    if (this.fase === 'PLAYER_TURN') throw new Error('Termina la ronda antes de levantarte');
    this.finish();
  }

  private plantarse(): void {
    this.emit('PLAYER_STAND', this.human.id);
    while (this.politica.shouldHit(this.manoCrupier)) this.repartir(this.manoCrupier, DEALER_ID);
    this.cerrarRonda();
  }

  private repartir(mano: Hand, para: string): void {
    const carta = this.cartas.draw();
    mano.add(carta);
    // El sobre lleva al dueno de la ronda; `to` distingue la mano que recibe la carta.
    this.emit('CARD_DEALT', this.human.id, { card: carta.code, to: para });
  }

  private cerrarRonda(): void {
    const outcome = this.resultado();
    const payout = this.pago(outcome);
    this.fichas += payout;
    this.rondas++;
    this.ultima = {
      bet: this.apuesta,
      outcome,
      payout,
      playerTotal: this.manoJugador.total,
      dealerTotal: this.manoCrupier.total,
    };
    this.fase = 'BETTING';
    this.emit('ROUND_RESULT', this.human.id, { outcome, payout });
    if (this.fichas <= 0) this.finish();
  }

  private resultado(): RoundOutcome {
    const j = this.manoJugador;
    const c = this.manoCrupier;
    if (j.isBust) return 'BUST';
    if (j.isBlackjack && c.isBlackjack) return 'PUSH';
    if (j.isBlackjack) return 'BLACKJACK';
    if (c.isBlackjack) return 'LOSE';
    if (c.isBust || j.total > c.total) return 'WIN';
    if (j.total < c.total) return 'LOSE';
    return 'PUSH';
  }

  /** Blackjack paga 3:2 (redondeado hacia abajo: `payout` es entero). */
  private pago(outcome: RoundOutcome): number {
    switch (outcome) {
      case 'BLACKJACK':
        return Math.floor((this.apuesta * 3) / 2);
      case 'WIN':
        return this.apuesta;
      case 'PUSH':
        return 0;
      case 'LOSE':
      case 'BUST':
        return -this.apuesta;
    }
  }

  private requireTurn(): void {
    this.requireRunning();
    if (this.fase !== 'PLAYER_TURN') throw new Error('No hay una ronda en juego');
  }
}
