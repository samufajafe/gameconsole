import { Game, type GameOptions } from '../../core/Game';
import type { EventData } from '../../core/GameEvent';
import type { EventSink } from '../../core/EventSink';
import type { Player } from '../../core/Player';

export type RacingPhase = 'COUNTDOWN' | 'RACING';
/** Cada piloto acelera alternando sus dos teclas: izquierda, derecha, izquierda... */
export type Pedal = 'left' | 'right';

export const FALSE_START_PENALTY_S = 3;

/** Estado de un piloto durante la carrera. */
export class Racer {
  /** Pulsaciones validas en la vuelta en curso. */
  progress = 0;
  readonly lapTimesMs: number[] = [];
  readonly positions: number[] = [];
  penaltySeconds = 0;
  ultimoPedal: Pedal | null = null;
  inicioVuelta = 0;
  /** Tiempo total sin penalizaciones, cuando termina. */
  totalMs: number | null = null;

  constructor(readonly player: Player) {}

  get lap(): number {
    return this.lapTimesMs.length;
  }
  get finished(): boolean {
    return this.totalMs !== null;
  }
}

export interface RacingOptions extends GameOptions {
  laps?: number;
  /** Pulsaciones alternadas que hacen una vuelta. */
  pressesPerLap?: number;
  track?: string;
}

/**
 * Carrera de 2 humanos en el mismo teclado (PVP).
 *
 * Arranca con una cuenta regresiva; quien acelera antes de la largada recibe un PENALTY de
 * `FALSE_START_PENALTY_S` segundos (una sola vez por carrera). Despues, cada pulsacion alternada
 * de sus dos teclas avanza al piloto; repetir la misma tecla no avanza.
 *
 * Al cerrar cada vuelta se emite LAP_COMPLETED con `lapTimeMs` y `position`: el puesto por tiempo
 * acumulado al cerrar esa vuelta (todos largan juntos, asi que es el orden en que la cierran). La
 * carrera termina cuando los dos llegan; GameStats arma el ranking con las penalizaciones.
 */
export class RacingGame extends Game {
  override readonly title = 'Racing';

  readonly laps: number;
  readonly pressesPerLap: number;
  readonly track: string;
  private readonly pilotos: Racer[];
  private readonly ahora: () => number;
  private fase: RacingPhase = 'COUNTDOWN';
  private largada = 0;

  constructor(sink: EventSink, players: readonly [Player, Player], options: RacingOptions = {}) {
    if (players[0].id === players[1].id) throw new Error('Los dos pilotos necesitan nombres distintos');
    super('racing', sink, players, options);
    this.laps = options.laps ?? 3;
    this.pressesPerLap = options.pressesPerLap ?? 20;
    this.track = options.track ?? 'Óvalo GameConsole';
    const reloj = options.clock ?? (() => new Date());
    this.ahora = () => reloj().getTime();
    this.pilotos = players.map((p) => new Racer(p));
  }

  protected override startData(): EventData {
    return { laps: this.laps, track: this.track };
  }

  get phase(): RacingPhase {
    return this.fase;
  }
  get racers(): readonly Racer[] {
    return this.pilotos;
  }
  /** Milisegundos desde la largada (0 antes de largar). */
  get elapsedMs(): number {
    return this.fase === 'RACING' ? this.ahora() - this.largada : 0;
  }

  /** Larga la carrera. Lo llama la vista al terminar la cuenta regresiva. */
  go(): void {
    this.requireRunning();
    if (this.fase !== 'COUNTDOWN') return;
    this.fase = 'RACING';
    this.largada = this.ahora();
    for (const r of this.pilotos) r.inicioVuelta = this.largada;
    this.changed();
  }

  /** Pulsacion de un pedal del piloto `indice` (0 o 1). */
  press(indice: number, pedal: Pedal): void {
    if (!this.isRunning) return;
    const r = this.pilotos[indice];
    if (!r) throw new Error(`No hay piloto ${indice}`);

    if (this.fase === 'COUNTDOWN') {
      if (r.penaltySeconds === 0) {
        r.penaltySeconds = FALSE_START_PENALTY_S;
        this.emit('PENALTY', r.player.id, { seconds: FALSE_START_PENALTY_S, reason: 'false_start' });
        this.changed();
      }
      return;
    }

    if (r.finished || r.ultimoPedal === pedal) return;
    r.ultimoPedal = pedal;
    r.progress++;
    if (r.progress >= this.pressesPerLap) this.cerrarVuelta(r);
    this.changed();
  }

  private cerrarVuelta(r: Racer): void {
    const t = this.ahora();
    const vuelta = r.lap + 1;
    // Puesto por tiempo acumulado: los que ya cerraron esta vuelta van delante.
    const position = 1 + this.pilotos.filter((o) => o !== r && o.lap >= vuelta).length;
    const lapTimeMs = Math.round(t - r.inicioVuelta);

    r.lapTimesMs.push(lapTimeMs);
    r.positions.push(position);
    r.progress = 0;
    r.inicioVuelta = t;
    this.emit('LAP_COMPLETED', r.player.id, { lap: vuelta, lapTimeMs, position });

    if (vuelta === this.laps) {
      r.totalMs = r.lapTimesMs.reduce((a, b) => a + b, 0);
      if (this.pilotos.every((p) => p.finished)) this.finish();
    }
  }
}
