import type { GameEvent } from './GameEvent';

/**
 * Destino de los eventos de una partida.
 *
 * `send` es sincrono y no devuelve nada a proposito: un juego nunca espera a la red. En
 * produccion el sink es un `MatchEmitter` (cola + envio en segundo plano); en las pruebas, un
 * arreglo.
 */
export interface EventSink {
  send(event: GameEvent): void;
}

/** Sink que solo guarda los eventos. Sirve para pruebas y para depurar. */
export class CollectingSink implements EventSink {
  readonly events: GameEvent[] = [];

  send(event: GameEvent): void {
    this.events.push(event);
  }

  ofType(type: string): GameEvent[] {
    return this.events.filter((e) => e.type === type);
  }
}
