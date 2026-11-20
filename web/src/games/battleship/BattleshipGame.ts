import { Game, type GameOptions } from '../../core/Game';
import type { EventData } from '../../core/GameEvent';
import type { EventSink } from '../../core/EventSink';
import { Player } from '../../core/Player';
import { ExponentialBackoff, type RetryPolicy } from '../../events/RetryPolicy';
import { Board, type ShotOutcome } from './Board';
import { Coord } from './Coord';
import { BOARD_SIZE, placeFleet, STANDARD_FLEET, type ShipSpec } from './Fleet';
import { Ship } from './Ship';
import type { ShotDecision, ShotStrategy } from './ShotStrategy';

export const AI_ID = 'prolog-ai';

export type BattleshipPhase = 'PLAYER_TURN' | 'AI_TURN';

/** Que esta haciendo la maquina, para mostrarlo en la vista. */
export interface AiStatus {
  state: 'idle' | 'thinking' | 'unavailable';
  /** Ultima jugada de la IA, con su explicacion. */
  lastDecision: ShotDecision | null;
  /** Por que no se pudo consultar a la IA (solo en `unavailable`). */
  error: string | null;
  /** Intentos fallidos seguidos en este turno. */
  failures: number;
}

export interface BattleshipOptions extends GameOptions {
  strategy: ShotStrategy;
  /** Barcos fijos para pruebas; si no, se colocan al azar. */
  playerShips?: Ship[];
  aiShips?: Ship[];
  random?: () => number;
  /** Espera entre reintentos cuando la IA no responde. */
  retry?: RetryPolicy;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Battleship: el humano contra la IA en Prolog (PVE). Dispara primero el humano.
 *
 * Eventos (docs/CONTRACT.md §2): SHOT_FIRED con el `playerId` de quien dispara y SHIP_SUNK con
 * el del DUENO del barco hundido. Antes de cada disparo de la maquina va su AI_DECISION
 * (`action` HUNT|TARGET, `data {coord, reason}`).
 *
 * Si Prolog no responde, el turno queda en "IA no disponible" y se reintenta con backoff hasta que
 * conteste. La maquina nunca dispara al azar.
 */
export class BattleshipGame extends Game {
  override readonly title = 'Battleship';

  private readonly strategy: ShotStrategy;
  private readonly random: () => number;
  private readonly retry: RetryPolicy;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly fleet: readonly ShipSpec[] = STANDARD_FLEET;

  /** Tablero del humano: sus barcos y los disparos de la IA. */
  private propio: Board;
  /** Tablero de la IA: sus barcos y los disparos del humano. */
  private readonly rival: Board;
  private fase: BattleshipPhase = 'PLAYER_TURN';
  private ia: AiStatus = { state: 'idle', lastDecision: null, error: null, failures: 0 };
  private ganador: string | null = null;
  private turnoIA: Promise<void> = Promise.resolve();

  constructor(
    sink: EventSink,
    private readonly human: Player,
    options: BattleshipOptions,
  ) {
    super('battleship', sink, [human, Player.bot(AI_ID, 'hard', 'IA Prolog')], options);
    this.strategy = options.strategy;
    this.random = options.random ?? Math.random;
    this.retry = options.retry ?? new ExponentialBackoff(1000, 5000);
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.propio = new Board(options.playerShips ?? placeFleet(this.fleet, BOARD_SIZE, this.random), BOARD_SIZE);
    this.rival = new Board(options.aiShips ?? placeFleet(this.fleet, BOARD_SIZE, this.random), BOARD_SIZE);
  }

  protected override startData(): EventData {
    return { boardSize: BOARD_SIZE, fleet: this.fleet.map((s) => ({ ship: s.ship, size: s.size })) };
  }

  get phase(): BattleshipPhase {
    return this.fase;
  }
  get playerBoard(): Board {
    return this.propio;
  }
  get targetBoard(): Board {
    return this.rival;
  }
  get ai(): AiStatus {
    return { ...this.ia };
  }
  get winnerId(): string | null {
    return this.ganador;
  }
  get humanId(): string {
    return this.human.id;
  }
  /** Se puede recolocar la flota propia mientras nadie haya disparado. */
  get canRearrange(): boolean {
    return this.isRunning && this.propio.shotCount === 0 && this.rival.shotCount === 0;
  }

  /** Se resuelve cuando la maquina termina su turno en curso (lo usan las pruebas). */
  whenAiDone(): Promise<void> {
    return this.turnoIA;
  }

  /** Vuelve a colocar al azar los barcos del humano. La colocacion no viaja en ningun evento. */
  rearrangeFleet(): void {
    if (!this.canRearrange) throw new Error('Ya empezaron los disparos');
    this.propio = new Board(placeFleet(this.fleet, BOARD_SIZE, this.random), BOARD_SIZE);
    this.changed();
  }

  /**
   * Pone la flota que el jugador coloco a mano. Tiene que ser exactamente la flota de la partida
   * (mismos barcos y tamanos), sin pisarse ni salirse; si no, lanza y no cambia nada.
   */
  setPlayerFleet(ships: readonly Ship[]): void {
    if (!this.canRearrange) throw new Error('Ya empezaron los disparos');
    const pedidos = this.fleet.map((s) => `${s.ship}:${s.size}`).sort();
    const dados = ships.map((s) => `${s.name}:${s.size}`).sort();
    if (pedidos.join() !== dados.join()) throw new Error(`La flota debe ser ${pedidos.join(', ')}`);
    // Copias limpias: los barcos llevan la cuenta de sus impactos.
    this.propio = new Board(
      ships.map((s) => new Ship(s.name, s.cells)),
      BOARD_SIZE,
    );
    this.changed();
  }

  /** Disparo del humano al tablero de la IA. Si no gana, empieza el turno de la maquina. */
  fire(objetivo: Coord | string): void {
    this.requireRunning();
    if (this.fase !== 'PLAYER_TURN') throw new Error('Es el turno de la IA');
    const c = typeof objetivo === 'string' ? Coord.parse(objetivo, BOARD_SIZE) : objetivo;
    if (this.rival.wasShot(c)) throw new Error(`Ya disparaste a ${c}`);

    const r = this.rival.receiveShot(c);
    this.registrarDisparo(this.human.id, AI_ID, c, r);
    if (this.rival.allSunk) {
      this.terminar(this.human.id);
      return;
    }
    this.fase = 'AI_TURN';
    this.changed();
    this.turnoIA = this.jugarIA();
  }

  /** Turno de la maquina: pide la jugada a la estrategia y reintenta hasta tener una valida. */
  private async jugarIA(): Promise<void> {
    let fallos = 0;
    while (this.isRunning && this.fase === 'AI_TURN') {
      this.ia = { ...this.ia, state: fallos > 0 ? 'unavailable' : 'thinking' };
      this.changed();
      try {
        const vista = { size: BOARD_SIZE, shots: this.propio.knowledge(), remaining: this.propio.remainingSizes() };
        const decision = await this.strategy.decide(vista);
        if (!this.isRunning) return; // se abandono mientras pensaba
        this.aplicarJugadaIA(decision);
        return;
      } catch (e) {
        if (!this.isRunning) return;
        fallos++;
        this.ia = { ...this.ia, state: 'unavailable', error: e instanceof Error ? e.message : String(e), failures: fallos };
        this.changed();
        await this.sleep(this.retry.delayMs(fallos - 1));
      }
    }
  }

  /** Valida la jugada ANTES de emitir nada; si no sirve, lanza y el turno se reintenta. */
  private aplicarJugadaIA(d: ShotDecision): void {
    const c = Coord.parse(d.coord, BOARD_SIZE);
    if (this.propio.wasShot(c)) throw new Error(`La IA eligio ${c}, que ya estaba disparada`);

    this.emit('AI_DECISION', AI_ID, { coord: c.toString(), reason: d.reason }, d.mode);
    const r = this.propio.receiveShot(c);
    this.registrarDisparo(AI_ID, this.human.id, c, r);
    this.ia = { state: 'idle', lastDecision: { ...d, coord: c.toString() }, error: null, failures: 0 };

    if (this.propio.allSunk) {
      this.terminar(AI_ID);
      return;
    }
    this.fase = 'PLAYER_TURN';
    this.changed();
  }

  /** SHOT_FIRED de quien dispara y, si hundio un barco, SHIP_SUNK del dueno del barco. */
  private registrarDisparo(tirador: string, dueno: string, c: Coord, r: ShotOutcome): void {
    this.emit('SHOT_FIRED', tirador, { coord: c.toString(), hit: r.hit });
    if (r.sunk) this.emit('SHIP_SUNK', dueno, { ship: r.sunk.name, size: r.sunk.size });
  }

  private terminar(ganador: string): void {
    this.ganador = ganador;
    this.finish();
  }
}
