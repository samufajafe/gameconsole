import type { KnownShot } from './Board';

/** Lo que la maquina sabe del tablero rival. Es exactamente el cuerpo de `POST /battleship/move`. */
export interface OpponentView {
  size: number;
  shots: KnownShot[];
  /** Tamanos de los barcos rivales que siguen a flote. */
  remaining: number[];
}

export type DecisionMode = 'HUNT' | 'TARGET';

/** La jugada elegida y por que. Viaja en `AI_DECISION` (`action` = modo, `data` = coord + razon). */
export interface ShotDecision {
  coord: string;
  mode: DecisionMode;
  reason: string;
}

/**
 * Como decide un disparo la maquina. `BattleshipGame` no sabe quien decide: en produccion es
 * `PrologAI` (servicio HTTP en SWI-Prolog); en las pruebas, una estrategia falsa.
 *
 * Si no puede decidir (servicio caido, respuesta invalida) LANZA: el juego reintenta y nunca juega
 * al azar en su lugar.
 */
export interface ShotStrategy {
  decide(view: OpponentView): Promise<ShotDecision>;
}
