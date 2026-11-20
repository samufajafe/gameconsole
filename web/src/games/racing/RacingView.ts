import { aliasValido, REGLA_ALIAS } from '../../console/alias';
import type { GameDescriptor, GameView } from '../../console/GameDescriptor';
import { el, esc, formatMs } from '../../console/html';
import { Player } from '../../core/Player';
import { FALSE_START_PENALTY_S, RacingGame, type Pedal, type Racer } from './RacingGame';

const CUENTA_MS = 3000;

/** Teclas por `KeyboardEvent.code`, asi no depende de la distribucion del teclado. */
const TECLAS: Record<string, [number, Pedal]> = {
  KeyA: [0, 'left'],
  KeyD: [0, 'right'],
  KeyJ: [1, 'left'],
  KeyL: [1, 'right'],
};

/**
 * Interfaz de Racing. Solo escucha el teclado cuando la tarjeta tiene el foco, para que dos
 * carreras abiertas a la vez no reciban las mismas teclas.
 */
export class RacingView implements GameView {
  readonly element = el('div', 'race');
  private readonly desuscribir: () => void;
  private largada: ReturnType<typeof setTimeout> | undefined;
  private reloj: ReturnType<typeof setInterval> | undefined;
  private finCuenta = 0;
  private cuerpo!: HTMLElement;

  constructor(private readonly game: RacingGame) {
    this.element.tabIndex = 0;
    this.element.innerHTML = `
      <p class="race-help">Clic aquí para tomar el teclado.
        <b>${esc(game.racers[0]!.player.name)}</b>: alterna <kbd>A</kbd> <kbd>D</kbd> ·
        <b>${esc(game.racers[1]!.player.name)}</b>: alterna <kbd>J</kbd> <kbd>L</kbd>.
        Acelerar antes de la largada: +${FALSE_START_PENALTY_S} s.</p>
      <div class="race-body"></div>`;
    this.cuerpo = this.element.querySelector('.race-body')!;
    this.element.addEventListener('keydown', (ev) => this.tecla(ev));
    this.desuscribir = game.onChange(() => this.render());

    // La cuenta regresiva arranca cuando la partida ya emitio MATCH_STARTED.
    queueMicrotask(() => {
      this.finCuenta = Date.now() + CUENTA_MS;
      this.largada = setTimeout(() => this.game.isRunning && this.game.go(), CUENTA_MS);
      // Redibuja la cuenta y el cronometro mientras la carrera siga en curso.
      this.reloj = setInterval(() => (this.game.isRunning ? this.render() : this.pararReloj()), 100);
      this.element.focus();
    });
    this.render();
  }

  destroy(): void {
    this.desuscribir();
    clearTimeout(this.largada);
    this.pararReloj();
  }

  private pararReloj(): void {
    clearInterval(this.reloj);
    this.render();
  }

  private tecla(ev: KeyboardEvent): void {
    const t = TECLAS[ev.code];
    if (!t) return;
    ev.preventDefault();
    if (ev.repeat) return; // mantener apretada no cuenta
    this.game.press(t[0], t[1]);
  }

  private render(): void {
    const g = this.game;
    let estado: string;
    if (g.status === 'ABANDONED') estado = '<span class="muted">Carrera abandonada.</span>';
    else if (g.status === 'FINISHED') estado = '<span class="result good">¡Carrera terminada! El ganador lo decide GameStats con las penalizaciones (ver Panel).</span>';
    else if (g.phase === 'COUNTDOWN') {
      const s = Math.max(0, Math.ceil((this.finCuenta - Date.now()) / 1000));
      estado = `<span class="race-count">${this.finCuenta ? s || '¡YA!' : '…'}</span>`;
    } else estado = `<span class="race-count go">¡YA!</span> <span class="muted">${formatMs(g.elapsedMs)}</span>`;

    this.cuerpo.innerHTML = `
      <p class="status-line">${estado} · ${g.laps} vueltas · ${esc(g.track)}</p>
      ${g.racers.map((r, i) => this.carril(r, i)).join('')}`;
  }

  private carril(r: Racer, i: number): string {
    const g = this.game;
    const pct = r.finished ? 100 : (100 * (r.lap * g.pressesPerLap + r.progress)) / (g.laps * g.pressesPerLap);
    const vueltas = r.lapTimesMs.map((ms, k) => `V${k + 1} ${(ms / 1000).toFixed(2)} s (P${r.positions[k]})`).join(' · ');
    return `
      <div class="lane lane-${i}">
        <div class="lane-label"><b>${esc(r.player.name)}</b>
          <span class="muted">vuelta ${Math.min(r.lap + 1, g.laps)}/${g.laps}</span>
          ${r.penaltySeconds ? `<span class="tag bad">+${r.penaltySeconds} s salida en falso</span>` : ''}
          ${r.finished ? `<span class="tag">llegó: ${((r.totalMs ?? 0) / 1000).toFixed(2)} s</span>` : ''}</div>
        <div class="track"><span class="car" style="left: calc(${pct.toFixed(1)}% - ${(pct / 100) * 24}px)">${i === 0 ? '🏎' : '🚙'}</span></div>
        <div class="lane-laps muted">${vueltas || '&nbsp;'}</div>
      </div>`;
  }
}

/** Pide el nombre del segundo piloto hasta que sea valido; `null` si se cancela. */
function segundoPiloto(ask: (p: string, d: string) => string | null, primero: string): string | null {
  let aviso = '';
  for (;;) {
    const r = ask(`${aviso}Nombre del segundo piloto (teclas J/L):`, 'invitado');
    if (r === null) return null;
    const a = r.trim();
    if (aliasValido(a) && a !== primero) return a;
    aviso = `Debe tener ${REGLA_ALIAS} y ser distinto de ${primero}.\n`;
  }
}

export const racingDescriptor: GameDescriptor = {
  id: 'racing',
  title: 'Racing',
  description: 'Dos pilotos en el mismo teclado: A/D contra J/L. Salir antes de tiempo penaliza.',
  launch(sink, ctx) {
    const otro = segundoPiloto(ctx.ask, ctx.playerId);
    if (otro === null) return null;
    const game = new RacingGame(sink, [Player.human(ctx.playerId), Player.human(otro)]);
    return { game, view: new RacingView(game) };
  },
};
