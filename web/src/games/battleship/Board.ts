import { Coord } from './Coord';
import type { Ship } from './Ship';

/** Lo que se sabe de una celda disparada, en el vocabulario del servicio Prolog. */
export type ShotResult = 'miss' | 'hit' | 'sunk';

/** Un disparo visto desde afuera: coordenada y resultado. Es lo que se le manda a la IA. */
export interface KnownShot {
  coord: string;
  result: ShotResult;
}

export interface ShotOutcome {
  hit: boolean;
  /** El barco que este disparo termino de hundir, si alguno. */
  sunk: Ship | null;
}

/**
 * Tablero de UN jugador: sus barcos y los disparos que recibio del rival.
 */
export class Board {
  private readonly disparos: Coord[] = [];
  private readonly barcos: readonly Ship[];

  constructor(
    ships: readonly Ship[],
    readonly size = 10,
  ) {
    for (const b of ships) {
      if (!b.cells.every((c) => c.inside(size))) throw new Error(`El barco ${b.name} se sale del tablero`);
    }
    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) {
        if (ships[i]!.cells.some((c) => ships[j]!.occupies(c))) throw new Error('Dos barcos se pisan');
      }
    }
    this.barcos = [...ships];
  }

  get ships(): readonly Ship[] {
    return this.barcos;
  }

  get shotCount(): number {
    return this.disparos.length;
  }

  shipAt(c: Coord): Ship | undefined {
    return this.barcos.find((b) => b.occupies(c));
  }

  wasShot(c: Coord): boolean {
    return this.disparos.some((d) => d.equals(c));
  }

  /** Recibe un disparo del rival. Lanza si se sale del tablero o si ya se disparo ahi. */
  receiveShot(c: Coord): ShotOutcome {
    if (!c.inside(this.size)) throw new Error(`${c} esta fuera del tablero`);
    if (this.wasShot(c)) throw new Error(`Ya se disparo a ${c}`);
    this.disparos.push(c);
    const barco = this.shipAt(c);
    if (!barco) return { hit: false, sunk: null };
    barco.hit(c);
    return { hit: true, sunk: barco.isSunk ? barco : null };
  }

  /** Resultado actual de una celda ya disparada; `null` si nadie disparo ahi. */
  resultAt(c: Coord): ShotResult | null {
    if (!this.wasShot(c)) return null;
    const barco = this.shipAt(c);
    if (!barco) return 'miss';
    return barco.isSunk ? 'sunk' : 'hit';
  }

  /**
   * Lo que el rival sabe de este tablero: cada disparo con su resultado, donde un tocado de un
   * barco que ya se hundio aparece como `sunk`. No revela donde estan los barcos.
   */
  knowledge(): KnownShot[] {
    return this.disparos.map((c) => ({ coord: c.toString(), result: this.resultAt(c)! }));
  }

  /** Tamanos de los barcos que siguen a flote. */
  remainingSizes(): number[] {
    return this.barcos.filter((b) => !b.isSunk).map((b) => b.size);
  }

  get allSunk(): boolean {
    return this.barcos.every((b) => b.isSunk);
  }

  /** Todas las celdas, fila por fila, para dibujar. */
  cells(): Coord[] {
    const todas: Coord[] = [];
    for (let f = 0; f < this.size; f++) for (let c = 0; c < this.size; c++) todas.push(new Coord(f, c));
    return todas;
  }
}
