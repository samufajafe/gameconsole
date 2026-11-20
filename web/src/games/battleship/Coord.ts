/**
 * Celda del tablero. La fila es la letra y la columna el numero, igual que en Prolog
 * (`battleship_ai.pl`: "B7" es fila 2, columna 7) y que el patron `^[A-J](10|[1-9])$` del contrato.
 *
 * Internamente fila y columna empiezan en 0.
 */
export class Coord {
  constructor(
    readonly row: number,
    readonly col: number,
  ) {
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0) {
      throw new Error(`Coordenada invalida: ${row},${col}`);
    }
  }

  /** Lee "A1".."J10". Lanza si no tiene ese formato o se sale de un tablero de `size`. */
  static parse(texto: string, size = 10): Coord {
    const m = /^([A-Z])([1-9]\d?)$/.exec(texto.trim().toUpperCase());
    if (!m) throw new Error(`Coordenada invalida: ${texto}`);
    const c = new Coord(m[1]!.charCodeAt(0) - 65, Number(m[2]) - 1);
    if (!c.inside(size)) throw new Error(`Coordenada fuera del tablero: ${texto}`);
    return c;
  }

  inside(size: number): boolean {
    return this.row < size && this.col < size;
  }

  equals(otra: Coord): boolean {
    return this.row === otra.row && this.col === otra.col;
  }

  /** Formato del contrato: "A1", "J10". Sirve tambien como llave en mapas y conjuntos. */
  toString(): string {
    return `${String.fromCharCode(65 + this.row)}${this.col + 1}`;
  }
}
