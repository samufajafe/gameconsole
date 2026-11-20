import { Coord } from './Coord';
import { Ship } from './Ship';

/** Un barco de la flota tal como viaja en `MATCH_STARTED.data.fleet`. */
export interface ShipSpec {
  ship: string;
  size: number;
}

/** Flota estandar del contrato (docs/CONTRACT.md §2): 5 barcos, 17 celdas. */
export const STANDARD_FLEET: readonly ShipSpec[] = [
  { ship: 'carrier', size: 5 },
  { ship: 'battleship', size: 4 },
  { ship: 'cruiser', size: 3 },
  { ship: 'submarine', size: 3 },
  { ship: 'destroyer', size: 2 },
];

export const BOARD_SIZE = 10;

/**
 * Coloca la flota al azar sin que los barcos se pisen. La colocacion no viaja en ningun evento:
 * solo la conoce el dueno del tablero.
 */
export function placeFleet(
  spec: readonly ShipSpec[] = STANDARD_FLEET,
  size = BOARD_SIZE,
  random: () => number = Math.random,
): Ship[] {
  // Reintentar desde cero es suficiente: con 17 celdas en 100 casi nunca hace falta.
  for (let intento = 0; intento < 100; intento++) {
    const barcos: Ship[] = [];
    const ok = spec.every(({ ship, size: largo }) => {
      for (let i = 0; i < 200; i++) {
        const horizontal = random() < 0.5;
        const fila = Math.floor(random() * (horizontal ? size : size - largo + 1));
        const col = Math.floor(random() * (horizontal ? size - largo + 1 : size));
        const candidato = Ship.straight(ship, largo, new Coord(fila, col), horizontal);
        if (!barcos.some((b) => candidato.cells.some((c) => b.occupies(c)))) {
          barcos.push(candidato);
          return true;
        }
      }
      return false;
    });
    if (ok) return barcos;
  }
  throw new Error('No se pudo colocar la flota');
}
