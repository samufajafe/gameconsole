import type { EventSink } from '../core/EventSink';
import type { Game } from '../core/Game';
import type { GameId } from '../core/GameEvent';
import type { Pregunta } from './dialog';

/** Vista de una partida: dibuja el estado del juego y le pasa las acciones del usuario. */
export interface GameView {
  readonly element: HTMLElement;
  destroy(): void;
}

/** Datos de la consola que necesita un juego para arrancar. */
export interface LaunchContext {
  /** Alias del jugador de esta consola; es su `playerId` en GameStats. */
  playerId: string;
  /** Pide datos extra al usuario (p. ej. el segundo piloto en racing); `null` si cancela. */
  ask(pregunta: Pregunta): Promise<string | null>;
}

/**
 * Entrada del catalogo de la consola. Cada juego se registra con uno de estos y la consola no
 * sabe nada mas de el: crea la partida, la vista, y el resto es polimorfismo sobre `Game`.
 */
export interface GameDescriptor {
  readonly id: GameId;
  readonly title: string;
  readonly description: string;
  /** Icono del catalogo y de la tarjeta de la partida. */
  readonly icon: string;
  /** Modalidad en pocas palabras: "1 jugador · contra el crupier". */
  readonly mode: string;
  /** Reglas cortas para "Cómo se juega". */
  readonly howTo: readonly string[];
  /** Devuelve `null` si el usuario cancelo algun dato. */
  launch(sink: EventSink, ctx: LaunchContext): Promise<{ game: Game; view: GameView } | null>;
}
