import type { Card } from './Card';

/**
 * Mano de blackjack. Es la misma regla que reconstruye Scala con su `foldLeft`: cada as suma 11 y,
 * mientras el total pase de 21 y queden ases contados como 11, se le restan 10.
 */
export class Hand {
  private readonly cartas: Card[] = [];

  add(card: Card): void {
    this.cartas.push(card);
  }

  get cards(): readonly Card[] {
    return this.cartas;
  }

  get total(): number {
    return this.calcular().total;
  }

  /** Blanda: hay un as contando 11 (puede bajar a 1 sin pasarse). */
  get isSoft(): boolean {
    return this.calcular().asesAlto > 0;
  }

  get isBlackjack(): boolean {
    return this.cartas.length === 2 && this.total === 21;
  }

  get isBust(): boolean {
    return this.total > 21;
  }

  private calcular(): { total: number; asesAlto: number } {
    let total = 0;
    let asesAlto = 0;
    for (const c of this.cartas) {
      total += c.baseValue;
      if (c.isAce) asesAlto++;
    }
    while (total > 21 && asesAlto > 0) {
      total -= 10;
      asesAlto--;
    }
    return { total, asesAlto };
  }
}
