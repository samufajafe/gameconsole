export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
/** Corazones, diamantes, treboles y picas, con las letras del contrato. */
export const SUITS = ['H', 'D', 'C', 'S'] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];

const SIMBOLO: Record<Suit, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };

/** Una carta inmutable. Su `code` es el formato de `CARD_DEALT.data.card`: "AS", "10H", "KD". */
export class Card {
  constructor(
    readonly rank: Rank,
    readonly suit: Suit,
  ) {}

  /** Lee "10H", "AS"... Lanza si no cumple `^(10|[2-9AJQK])[HDCS]$`. */
  static parse(code: string): Card {
    const m = /^(10|[2-9AJQK])([HDCS])$/.exec(code);
    if (!m) throw new Error(`Carta invalida: ${code}`);
    return new Card(m[1] as Rank, m[2] as Suit);
  }

  get code(): string {
    return `${this.rank}${this.suit}`;
  }

  get isAce(): boolean {
    return this.rank === 'A';
  }

  /** Valor base: el as cuenta 11 aqui; `Hand` decide cuando baja a 1. Figuras valen 10. */
  get baseValue(): number {
    if (this.isAce) return 11;
    if (this.rank === 'J' || this.rank === 'Q' || this.rank === 'K') return 10;
    return Number(this.rank);
  }

  get isRed(): boolean {
    return this.suit === 'H' || this.suit === 'D';
  }

  toString(): string {
    return `${this.rank}${SIMBOLO[this.suit]}`;
  }
}
