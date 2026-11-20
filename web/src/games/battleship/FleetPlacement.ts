import type { Coord } from './Coord';
import { BOARD_SIZE, placeFleet, STANDARD_FLEET, type ShipSpec } from './Fleet';
import { Ship } from './Ship';

/** Nombres para mostrar; en los eventos viajan los del contrato (carrier, battleship...). */
export const NOMBRE_BARCO: Record<string, string> = {
  carrier: 'Portaaviones',
  battleship: 'Acorazado',
  cruiser: 'Crucero',
  submarine: 'Submarino',
  destroyer: 'Destructor',
};

/** `true` si el barco va de izquierda a derecha (los de una celda cuentan como horizontales). */
export function esHorizontal(s: Ship): boolean {
  const [a, b] = s.cells;
  return !b || a!.row === b.row;
}

/**
 * Colocacion de la flota propia antes de la batalla, a mano o al azar.
 *
 * Es un modelo sin DOM: la vista solo le pregunta si un barco cabe y le pide colocarlo. Nunca
 * deja la flota en un estado invalido (barcos que se pisan o se salen), asi que lo que entrega
 * `ships` siempre lo acepta `Board`.
 */
export class FleetPlacement {
  private readonly colocados = new Map<string, Ship>();
  private actual: string | null;
  /** Orientacion del barco que se esta por colocar. */
  horizontal = true;

  constructor(
    readonly spec: readonly ShipSpec[] = STANDARD_FLEET,
    readonly size = BOARD_SIZE,
    private readonly random: () => number = Math.random,
  ) {
    this.actual = spec[0]?.ship ?? null;
  }

  /** Arranca desde una flota ya colocada (p. ej. la que salio al azar). */
  static desde(ships: readonly Ship[], spec: readonly ShipSpec[] = STANDARD_FLEET, size = BOARD_SIZE): FleetPlacement {
    const p = new FleetPlacement(spec, size);
    for (const s of ships) p.colocados.set(s.name, new Ship(s.name, s.cells));
    p.actual = p.siguienteSinColocar();
    return p;
  }

  /** Barco seleccionado para colocar, o `null` si ya estan todos. */
  get selected(): ShipSpec | null {
    return this.spec.find((s) => s.ship === this.actual) ?? null;
  }

  /** Barcos colocados, en el orden de la flota. */
  get ships(): Ship[] {
    return this.spec.flatMap((s) => this.colocados.get(s.ship) ?? []);
  }

  get isComplete(): boolean {
    return this.spec.every((s) => this.colocados.has(s.ship));
  }

  isPlaced(name: string): boolean {
    return this.colocados.has(name);
  }

  shipAt(c: Coord): Ship | undefined {
    return [...this.colocados.values()].find((s) => s.occupies(c));
  }

  /** Elige que barco colocar. Si ya estaba en el tablero, lo levanta para moverlo. */
  select(name: string): void {
    if (!this.spec.some((s) => s.ship === name)) throw new Error(`No hay barco ${name}`);
    const puesto = this.colocados.get(name);
    if (puesto) {
      this.horizontal = esHorizontal(puesto);
      this.colocados.delete(name);
    }
    this.actual = name;
  }

  rotate(): void {
    this.horizontal = !this.horizontal;
  }

  /** El barco seleccionado tal como quedaria con la proa en `inicio`, quepa o no. */
  candidate(inicio: Coord): Ship | null {
    const sel = this.selected;
    return sel ? Ship.straight(sel.ship, sel.size, inicio, this.horizontal) : null;
  }

  /** Si el barco seleccionado cabe con la proa en `inicio` sin salirse ni pisar a otro. */
  canPlace(inicio: Coord): boolean {
    const c = this.candidate(inicio);
    return !!c && c.cells.every((x) => x.inside(this.size) && !this.shipAt(x));
  }

  /** Coloca el barco seleccionado y pasa al siguiente que falte. Lanza si no cabe. */
  place(inicio: Coord): Ship {
    const c = this.candidate(inicio);
    if (!c) throw new Error('Ya colocaste toda la flota');
    if (!this.canPlace(inicio)) throw new Error(`El ${NOMBRE_BARCO[c.name] ?? c.name} no cabe ahí`);
    this.colocados.set(c.name, c);
    this.actual = this.siguienteSinColocar(c.name);
    return c;
  }

  /** Levanta el barco que ocupa `c` (si hay) y lo deja seleccionado para moverlo. */
  pickUp(c: Coord): Ship | undefined {
    const s = this.shipAt(c);
    if (s) this.select(s.name);
    return s;
  }

  clear(): void {
    this.colocados.clear();
    this.actual = this.spec[0]?.ship ?? null;
    this.horizontal = true;
  }

  /** Coloca al azar los barcos que faltan, respetando los que ya puso el jugador. */
  fillRandom(): void {
    const fijos = this.ships;
    const faltan = this.spec.filter((s) => !this.colocados.has(s.ship));
    if (faltan.length === 0) return;
    // placeFleet no sabe de barcos fijos: se reintenta hasta que lo nuevo no pise lo puesto.
    for (let intento = 0; intento < 200; intento++) {
      const nuevos = placeFleet(faltan, this.size, this.random);
      if (nuevos.every((n) => !fijos.some((f) => n.cells.some((x) => f.occupies(x))))) {
        for (const n of nuevos) this.colocados.set(n.name, n);
        this.actual = null;
        return;
      }
    }
    throw new Error('No hay lugar para los barcos que faltan; mueve alguno');
  }

  /** Flota nueva entera al azar. */
  randomize(): void {
    this.colocados.clear();
    this.fillRandom();
  }

  private siguienteSinColocar(despuesDe?: string): string | null {
    const i = despuesDe ? this.spec.findIndex((s) => s.ship === despuesDe) : -1;
    const orden = [...this.spec.slice(i + 1), ...this.spec.slice(0, i + 1)];
    return orden.find((s) => !this.colocados.has(s.ship))?.ship ?? null;
  }
}
