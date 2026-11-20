import { Coord } from './Coord';

/** Barco en el tablero: sabe que celdas ocupa y cuales ya recibieron un impacto. */
export class Ship {
  private readonly impactos = new Set<string>();
  private readonly celdas: readonly Coord[];

  constructor(
    /** Nombre del contrato: carrier, battleship, cruiser, submarine, destroyer. */
    readonly name: string,
    celdas: readonly Coord[],
  ) {
    if (celdas.length === 0) throw new Error('Un barco necesita al menos una celda');
    this.celdas = [...celdas];
  }

  /** Barco recto desde `inicio`, horizontal (avanza la columna) o vertical (avanza la fila). */
  static straight(name: string, size: number, inicio: Coord, horizontal: boolean): Ship {
    const celdas = Array.from({ length: size }, (_, i) =>
      horizontal ? new Coord(inicio.row, inicio.col + i) : new Coord(inicio.row + i, inicio.col),
    );
    return new Ship(name, celdas);
  }

  get size(): number {
    return this.celdas.length;
  }

  get cells(): readonly Coord[] {
    return this.celdas;
  }

  occupies(c: Coord): boolean {
    return this.celdas.some((x) => x.equals(c));
  }

  /** Registra un impacto. Devuelve `false` si la celda no es de este barco. */
  hit(c: Coord): boolean {
    if (!this.occupies(c)) return false;
    this.impactos.add(c.toString());
    return true;
  }

  get isSunk(): boolean {
    return this.impactos.size === this.celdas.length;
  }
}
