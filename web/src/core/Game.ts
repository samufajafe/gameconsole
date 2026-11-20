import { EventFactory, type Clock } from './EventFactory';
import { EventType, type EventData, type GameId, type MatchMode } from './GameEvent';
import type { EventSink } from './EventSink';
import { uuid } from './ids';
import type { Player } from './Player';

export type GameStatus = 'CREATED' | 'RUNNING' | 'FINISHED' | 'ABANDONED';

export interface GameOptions {
  matchId?: string;
  clock?: Clock;
}

/**
 * Clase base de todos los juegos de la consola.
 *
 * Se encarga de lo que es igual en los tres juegos: el ciclo de vida de la partida
 * (MATCH_STARTED, PLAYER_JOINED, MATCH_FINISHED y el abandono), el `matchId` unico y estable, la
 * emision de eventos y el aviso a la interfaz cuando algo cambia. Cada subclase solo aporta sus
 * reglas.
 *
 * No conoce el DOM ni la red: los eventos salen por un `EventSink` y la UI se entera por
 * `onChange`. Por eso la logica se puede probar sin navegador ni servidor.
 */
export abstract class Game {
  readonly matchId: string;
  abstract readonly title: string;

  private estado: GameStatus = 'CREATED';
  private readonly eventos: EventFactory;
  private readonly oyentes = new Set<() => void>();

  protected constructor(
    readonly gameId: GameId,
    private readonly sink: EventSink,
    protected readonly players: readonly Player[],
    options: GameOptions = {},
  ) {
    if (players.length === 0) throw new Error('Una partida necesita jugadores');
    this.matchId = options.matchId ?? uuid();
    this.eventos = new EventFactory(gameId, this.matchId, options.clock);
  }

  get status(): GameStatus {
    return this.estado;
  }

  get isRunning(): boolean {
    return this.estado === 'RUNNING';
  }

  get participants(): readonly Player[] {
    return this.players;
  }

  /** PVP si todos son humanos; PVE si hay al menos un bot (contracts/events.md). */
  protected get matchMode(): MatchMode {
    return this.players.some((p) => p.isBot) ? 'PVE' : 'PVP';
  }

  /** Lo propio del juego que viaja en `MATCH_STARTED.data`, ademas de `matchMode`. */
  protected abstract startData(): EventData;

  /** Gancho para que el juego prepare su primer estado una vez emitido el arranque. */
  protected onStart(): void {}

  /** Arranca la partida: MATCH_STARTED y un PLAYER_JOINED por participante. */
  start(): void {
    if (this.estado !== 'CREATED') throw new Error('La partida ya se inicio');
    this.estado = 'RUNNING';
    this.emit(EventType.MatchStarted, null, { matchMode: this.matchMode, ...this.startData() });
    for (const p of this.players) this.emit(EventType.PlayerJoined, p.id, p.joinedData());
    this.onStart();
    this.changed();
  }

  /** Cierre normal: lo decide el juego cuando hay un resultado. */
  protected finish(): void {
    this.requireRunning();
    this.estado = 'FINISHED';
    this.emit(EventType.MatchFinished, null);
    this.changed();
  }

  /**
   * Abandono: cerrar la instancia o la pestana a mitad de partida.
   *
   * GameStats solo analiza una partida cuando recibe MATCH_FINISHED; sin el, quedaria viva en Go
   * para siempre (docs/CONTRACT.md §3). Por eso el abandono tambien la cierra, antecedido por la
   * desconexion de los humanos, que Scala cuenta como abandono en el perfil del jugador.
   */
  abandon(): void {
    if (this.estado !== 'RUNNING') return;
    for (const p of this.players) if (!p.isBot) this.emit(EventType.PlayerDisconnected, p.id);
    this.estado = 'ABANDONED';
    this.emit(EventType.MatchFinished, null);
    this.changed();
  }

  /** Suscribe a la UI a los cambios. Devuelve la funcion para desuscribirse. */
  onChange(oyente: () => void): () => void {
    this.oyentes.add(oyente);
    return () => this.oyentes.delete(oyente);
  }

  protected emit(type: string, playerId: string | null, data: EventData | null = null, action: string | null = null): void {
    this.sink.send(this.eventos.create(type, playerId, data, action));
  }

  protected changed(): void {
    for (const oyente of this.oyentes) oyente();
  }

  protected requireRunning(): void {
    if (this.estado !== 'RUNNING') throw new Error('La partida no esta en curso');
  }
}
