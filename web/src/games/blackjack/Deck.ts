import { Card, RANKS, SUITS } from './Card';

/** De donde salen las cartas. Las pruebas usan un mazo preparado; el juego, un zapato barajado. */
export interface CardSource {
  draw(): Card;
}

/**
 * Zapato de `decks` barajas de 52 cartas, barajado con Fisher-Yates. Si se acaba, se arma y se
 * baraja uno nuevo.
 */
export class Shoe implements CardSource {
  private cartas: Card[] = [];

  constructor(
    readonly decks = 6,
    private readonly random: () => number = Math.random,
  ) {
    if (decks < 1) throw new Error('El zapato necesita al menos una baraja');
    this.rebarajar();
  }

  get remaining(): number {
    return this.cartas.length;
  }

  draw(): Card {
    if (this.cartas.length === 0) this.rebarajar();
    return this.cartas.pop()!;
  }

  private rebarajar(): void {
    const nuevas: Card[] = [];
    for (let d = 0; d < this.decks; d++) for (const s of SUITS) for (const r of RANKS) nuevas.push(new Card(r, s));
    for (let i = nuevas.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [nuevas[i], nuevas[j]] = [nuevas[j]!, nuevas[i]!];
    }
    this.cartas = nuevas;
  }
}

/** Mazo con un orden fijo, para pruebas y demos reproducibles. Reparte en el orden dado. */
export class StackedDeck implements CardSource {
  private readonly cartas: Card[];

  constructor(codes: readonly string[]) {
    this.cartas = codes.map((c) => Card.parse(c)).reverse();
  }

  draw(): Card {
    const c = this.cartas.pop();
    if (!c) throw new Error('El mazo preparado se quedo sin cartas');
    return c;
  }
}
