import type { GameEvent } from '../core/GameEvent';

/**
 * Copia de respaldo de los eventos que todavia no confirmo GameStats.
 *
 * El emisor mantiene su propia cola FIFO en memoria para enviar; el buffer es el respaldo para
 * no perder eventos. La interfaz es asincrona para que una implementacion persistente
 * (IndexedDB) se enchufe sin reescribir el emisor: el emisor nunca espera estas promesas en el
 * camino del juego.
 */
export interface EventBuffer {
  /** Guarda un evento recien emitido. */
  append(event: GameEvent): Promise<void>;
  /** Quita los eventos ya resueltos: entregados o descartados definitivamente. */
  remove(eventIds: readonly string[]): Promise<void>;
  /** Eventos pendientes de una partida, en orden de emision. */
  pending(matchId: string): Promise<GameEvent[]>;
}

/** Buffer en memoria: sobrevive a caidas de GameStats, no a cerrar la pestana. */
export class MemoryBuffer implements EventBuffer {
  private readonly eventos = new Map<string, GameEvent>();

  async append(event: GameEvent): Promise<void> {
    this.eventos.set(event.eventId, event);
  }

  async remove(eventIds: readonly string[]): Promise<void> {
    for (const id of eventIds) this.eventos.delete(id);
  }

  async pending(matchId: string): Promise<GameEvent[]> {
    // Map conserva el orden de insercion, que es el de emision.
    return [...this.eventos.values()].filter((e) => e.matchId === matchId);
  }

  get size(): number {
    return this.eventos.size;
  }
}
