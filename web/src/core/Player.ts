import type { EventData } from './GameEvent';

export type PlayerType = 'HUMAN' | 'BOT';
export type BotLevel = 'easy' | 'hard';

/**
 * Participante de una partida. Un bot es un jugador mas con un atributo distinto, igual que en el
 * contrato de GameStats: no es un caso especial del modelo.
 */
export class Player {
  constructor(
    readonly id: string,
    readonly type: PlayerType,
    readonly name: string = id,
    readonly botLevel?: BotLevel,
  ) {
    if (!id.trim()) throw new Error('El jugador necesita un id');
  }

  static human(id: string, name?: string): Player {
    return new Player(id, 'HUMAN', name ?? id);
  }

  static bot(id: string, level: BotLevel, name?: string): Player {
    return new Player(id, 'BOT', name ?? id, level);
  }

  get isBot(): boolean {
    return this.type === 'BOT';
  }

  /** `data` del evento PLAYER_JOINED: `{ playerType, botLevel? }`. */
  joinedData(): EventData {
    return this.botLevel ? { playerType: this.type, botLevel: this.botLevel } : { playerType: this.type };
  }
}
