/**
 * Sobre comun de un evento de GameStats. Es el espejo exacto de
 * `gamestats/contracts/event.schema.json` (ver docs/CONTRACT.md §1).
 *
 * El sobre es CERRADO: Go rechaza cualquier campo extra con `unknown_field`, asi que esta
 * interfaz no debe crecer. Lo especifico de cada juego va dentro de `data`.
 */
export interface GameEvent {
  readonly eventId: string;
  readonly timestamp: string;
  readonly gameId: GameId;
  readonly gameVersion: string;
  readonly matchId: string;
  /** Obligatorio salvo en los eventos MATCH_*, donde va `null`. */
  readonly playerId: string | null;
  readonly type: string;
  readonly action: string | null;
  readonly data: EventData | null;
}

export type EventData = Record<string, unknown>;

/** Los tres juegos de GameStats que implementa la consola. */
export type GameId = 'blackjack' | 'battleship' | 'racing';

export type MatchMode = 'PVP' | 'PVE';

/** Version de juego que viaja en todos los eventos; la misma que usa P1. */
export const GAME_VERSION = '1.0';

/** Tipos de evento generales, comunes a todos los juegos. */
export const EventType = {
  MatchStarted: 'MATCH_STARTED',
  PlayerJoined: 'PLAYER_JOINED',
  PlayerDisconnected: 'PLAYER_DISCONNECTED',
  PlayerReconnected: 'PLAYER_RECONNECTED',
  MatchFinished: 'MATCH_FINISHED',
} as const;

/** Los eventos MATCH_* son los unicos que pueden ir sin jugador. */
export function esEventoDePartida(type: string): boolean {
  return type.startsWith('MATCH_');
}
