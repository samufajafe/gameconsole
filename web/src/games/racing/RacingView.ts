import { aliasValido, REGLA_ALIAS } from '../../console/alias';
import type { GameDescriptor, GameView } from '../../console/GameDescriptor';
import { el, esc, formatMs } from '../../console/html';
import { Player } from '../../core/Player';
import { FALSE_START_PENALTY_S, RacingGame, type Pedal, type Racer } from './RacingGame';

const CUENTA_MS = 3000;
/** Cuanto se ve iluminada una tecla al pulsarla. */
const DESTELLO_MS = 140;

/** Teclas por `KeyboardEvent.code`, asi no depende de la distribucion del teclado. */
const TECLAS: Record<string, [number, Pedal]> = {
  KeyA: [0, 'left'],
  KeyD: [0, 'right'],
  KeyJ: [1, 'left'],
  KeyL: [1, 'right'],
};
const LETRA: readonly Record<Pedal, string>[] = [
  { left: 'A', right: 'D' },
  { left: 'J', right: 'L' },
];
const AUTO = ['🏎️', '🚙'];

interface Pulsacion {
  pedal: Pedal;
  t: number;
  /** Repitio la misma tecla: no avanza. */
  mal: boolean;
}

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
  private readonly pulsado: Array<Pulsacion | null> = [null, null];
  private readonly cuerpo: HTMLElement;

  constructor(private readonly game: RacingGame) {
    const [a, b] = game.racers;
    this.element.tabIndex = 0;
    this.element.setAttribute(
      'aria-label',
      `Carrera. ${a!.player.name} alterna A y D; ${b!.player.name} alterna J y L.`,
    );
    this.element.innerHTML = `
      <p class="race-help">
        <span class="p0"><b>${esc(a!.player.name)}</b> alterna <kbd>A</kbd> <kbd>D</kbd></span>
        <span class="p1"><b>${esc(b!.player.name)}</b> alterna <kbd>J</kbd> <kbd>L</kbd></span>
        <span class="muted">Acelerar antes del verde: +${FALSE_START_PENALTY_S} s</span></p>
      <div class="race-body"></div>
      <button type="button" class="race-focus">⌨ Haz clic aquí para usar el teclado</button>`;
    this.cuerpo = this.element.querySelector('.race-body')!;
    this.element.querySelector('.race-focus')!.addEventListener('click', () => this.element.focus());
    this.element.addEventListener('keydown', (ev) => this.tecla(ev));
    this.element.addEventListener('focus', () => this.element.classList.add('has-focus'));
    this.element.addEventListener('blur', () => this.element.classList.remove('has-focus'));
    this.desuscribir = game.onChange(() => {
      if (game.isRunning && !this.finCuenta) this.iniciarCuenta();
      this.render();
    });
    this.render();
  }

  /**
   * La cuenta regresiva arranca cuando la partida ya emitio MATCH_STARTED. Para entonces la
   * consola ya puso la tarjeta en la pagina, asi que se le puede dar el foco del teclado.
   */
  private iniciarCuenta(): void {
    this.finCuenta = Date.now() + CUENTA_MS;
    this.largada = setTimeout(() => this.game.isRunning && this.game.go(), CUENTA_MS);
    // Redibuja la cuenta y el cronometro mientras la carrera siga en curso.
    this.reloj = setInterval(() => (this.game.isRunning ? this.render() : this.pararReloj()), 100);
    this.element.focus({ preventScroll: true });
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
    if (!t || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    ev.preventDefault();
    if (ev.repeat) return; // mantener apretada no cuenta
    const [i, pedal] = t;
    const r = this.game.racers[i]!;
    const mal = this.game.phase === 'RACING' && !r.finished && r.ultimoPedal === pedal;
    this.pulsado[i] = { pedal, t: Date.now(), mal };
    this.game.press(i, pedal);
    this.render();
  }

  private render(): void {
    const g = this.game;
    this.element.dataset.phase = g.isRunning ? g.phase : g.status;
    this.cuerpo.innerHTML = `
      <div class="race-hud">
        ${this.semaforo()}
        <div class="race-clock" aria-live="off"><span class="hud-label">Tiempo</span>
          <span class="hud-value">${g.phase === 'RACING' || !g.isRunning ? formatMs(g.elapsedMs) : '0 s'}</span></div>
        <div class="race-info"><span class="hud-label">Circuito</span><span>${esc(g.track)} · ${g.laps} vueltas</span></div>
      </div>
      <div class="circuit">${g.racers.map((r, i) => this.carril(r, i)).join('')}</div>
      ${this.resultado()}`;
  }

  /** Tres luces rojas que se encienden una por segundo; verde al largar. */
  private semaforo(): string {
    const g = this.game;
    let rojas = 0;
    let texto: string;
    if (!g.isRunning) texto = g.status === 'FINISHED' ? '🏁 Meta' : 'Abandonada';
    else if (g.phase === 'COUNTDOWN') {
      const s = this.finCuenta ? Math.max(0, Math.ceil((this.finCuenta - Date.now()) / 1000)) : 3;
      rojas = 4 - Math.max(1, s);
      texto = `Prepárense… ${s || ''}`;
    } else texto = '¡YA!';
    const verde = g.isRunning && g.phase === 'RACING';
    const luces = [0, 1, 2].map((k) => `<i class="${verde ? 'green' : k < rojas ? 'red' : ''}"></i>`).join('');
    return `<div class="lights" role="status" aria-label="${esc(texto)}"><span class="bulbs">${luces}</span><b>${esc(texto)}</b></div>`;
  }

  private carril(r: Racer, i: number): string {
    const g = this.game;
    const total = g.laps * g.pressesPerLap;
    const hecho = r.finished ? total : r.lap * g.pressesPerLap + r.progress;
    const pct = (100 * hecho) / total;
    const vuelta = (100 * r.progress) / g.pressesPerLap;
    const p = this.pulsado[i];
    const reciente = p && Date.now() - p.t < DESTELLO_MS ? p : null;
    const siguiente: Pedal = r.ultimoPedal === 'left' ? 'right' : 'left';
    const tecla = (pedal: Pedal): string => {
      const clases = [
        g.phase === 'RACING' && g.isRunning && !r.finished && pedal === siguiente ? 'next' : '',
        reciente?.pedal === pedal ? (reciente.mal ? 'wrong' : 'pressed') : '',
      ].join(' ');
      return `<kbd class="${clases}">${LETRA[i]![pedal]}</kbd>`;
    };
    const vueltas = r.lapTimesMs.map((ms, k) => `<li>V${k + 1} <b>${(ms / 1000).toFixed(2)} s</b> <span class="muted">P${r.positions[k]}</span></li>`).join('');
    const aviso =
      reciente?.mal && Date.now() - reciente.t < 600
        ? '<span class="tag warn">¡Alterna las teclas!</span>'
        : r.penaltySeconds
          ? `<span class="tag bad">Salida en falso +${r.penaltySeconds} s</span>`
          : '';

    return `
      <div class="lane lane-${i} ${r.finished ? 'done' : ''}">
        <div class="lane-head">
          <span class="pilot">P${i + 1} · ${esc(r.player.name)}</span>
          <span class="lap-count">Vuelta <b>${Math.min(r.lap + 1, g.laps)}</b>/${g.laps}</span>
          ${aviso}
          ${r.finished ? `<span class="tag good">🏁 ${((r.totalMs ?? 0) / 1000).toFixed(2)} s</span>` : ''}
        </div>
        <div class="track" role="progressbar" aria-label="Avance de ${esc(r.player.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}">
          <span class="trail" style="width:${pct.toFixed(1)}%"></span>
          <span class="car" style="left: calc(${pct.toFixed(1)}% - ${((pct / 100) * 30).toFixed(1)}px)" aria-hidden="true">${AUTO[i]}</span>
        </div>
        <div class="lane-foot">
          <span class="pedals" aria-hidden="true">${tecla('left')}${tecla('right')}</span>
          <span class="lap-bar" aria-hidden="true"><i style="width:${r.finished ? 100 : vuelta.toFixed(0)}%"></i></span>
          <ol class="lap-times">${vueltas}</ol>
        </div>
      </div>`;
  }

  /** Orden de llegada y penalizaciones. El ganador oficial (con penalizaciones) lo da GameStats. */
  private resultado(): string {
    const g = this.game;
    if (g.isRunning) return '';
    if (g.status === 'ABANDONED') return '<div class="game-over"><p class="game-over-title">Carrera abandonada</p></div>';
    const orden = [...g.racers].sort((a, b) => (a.totalMs ?? 0) - (b.totalMs ?? 0));
    const filas = orden
      .map(
        (r, k) =>
          `<tr><td>${k + 1}º</td><td>${esc(r.player.name)}</td><td>${((r.totalMs ?? 0) / 1000).toFixed(2)} s</td>
           <td>${r.penaltySeconds ? `<span class="tag bad">+${r.penaltySeconds} s</span>` : '—'}</td></tr>`,
      )
      .join('');
    return `<div class="game-over">
        <p class="game-over-title">🏁 Carrera terminada</p>
        <table><thead><tr><th>Llegada</th><th>Piloto</th><th>Tiempo en pista</th><th>Penalización</th></tr></thead><tbody>${filas}</tbody></table>
        <p class="muted">GameStats suma las penalizaciones y decide el ganador oficial: míralo en el <b>Panel</b>.</p>
      </div>`;
  }
}

export const racingDescriptor: GameDescriptor = {
  id: 'racing',
  title: 'Racing',
  icon: '🏁',
  mode: '2 jugadores · mismo teclado',
  description: 'Carrera de 3 vueltas a pura velocidad de dedos: A/D contra J/L.',
  howTo: [
    'Cada piloto acelera alternando sus dos teclas: A y D, o J y L. Repetir la misma no avanza.',
    'Espera la luz verde: acelerar antes suma 3 s de penalización.',
    'La tarjeta de la carrera debe estar seleccionada para recibir el teclado.',
    'GameStats suma las penalizaciones y decide el ganador.',
  ],
  async launch(sink, ctx) {
    const otro = await ctx.ask({
      titulo: 'Segundo piloto',
      mensaje: `${ctx.playerId} maneja con A/D. ¿Quién maneja con J/L?`,
      etiqueta: 'Nombre del piloto 2',
      porDefecto: 'invitado',
      aceptar: '🏁 A la pista',
      validar: (v) => {
        if (!aliasValido(v)) return `Usa ${REGLA_ALIAS}.`;
        if (v === ctx.playerId) return `Debe ser distinto de ${ctx.playerId}.`;
        return null;
      },
    });
    if (otro === null) return null;
    const game = new RacingGame(sink, [Player.human(ctx.playerId), Player.human(otro)]);
    return { game, view: new RacingView(game) };
  },
};
