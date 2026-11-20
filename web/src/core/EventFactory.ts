import { esEventoDePartida, GAME_VERSION, type EventData, type GameEvent, type GameId } from './GameEvent';
import { uuid } from './ids';

/** Reloj inyectable: las pruebas fijan la hora en vez de depender de la real. */
export type Clock = () => Date;

/**
 * Fabrica los eventos de UNA partida con el sobre exacto del contrato.
 *
 * Es el unico lugar que arma un `GameEvent`, asi que es el unico lugar que hay que revisar para
 * saber que la consola cumple el contrato (el test `EventFactory.test.ts` lo valida contra el
 * JSON Schema de P1).
 *
 *   - `eventId`: UUID v4, unico global, como exige Go (`duplicate_event`).
 *   - `timestamp`: RFC 3339 en UTC con milisegundos (`toISOString()`), el formato de P1.
 *     Dentro de una partida nunca retrocede, aunque el reloj del sistema si lo haga.
 *   - `playerId`: `null` en los MATCH_*; obligatorio en los demas.
 */
export class EventFactory {
  private ultimoInstante = 0;

  constructor(
    private readonly gameId: GameId,
    private readonly matchId: string,
    private readonly clock: Clock = () => new Date(),
    private readonly newId: () => string = uuid,
  ) {}

  create(type: string, playerId: string | null, data: EventData | null = null, action: string | null = null): GameEvent {
    if (!esEventoDePartida(type) && !playerId) {
      // Go lo rechazaria con missing_player_id: es un error de programacion, no de red.
      throw new Error(`El evento ${type} necesita playerId`);
    }

    this.ultimoInstante = Math.max(this.ultimoInstante, this.clock().getTime());

    return {
      eventId: this.newId(),
      timestamp: new Date(this.ultimoInstante).toISOString(),
      gameId: this.gameId,
      gameVersion: GAME_VERSION,
      matchId: this.matchId,
      playerId: esEventoDePartida(type) ? null : playerId,
      type,
      action,
      data,
    };
  }
}
