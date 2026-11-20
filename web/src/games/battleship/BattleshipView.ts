import type { GameDescriptor, GameView } from '../../console/GameDescriptor';
import { el, esc } from '../../console/html';
import { Player } from '../../core/Player';
import { BattleshipGame } from './BattleshipGame';
import type { Board } from './Board';
import { PrologAI } from './PrologAI';

/** Interfaz de Battleship. Solo dibuja y delega: las reglas viven en `BattleshipGame`. */
export class BattleshipView implements GameView {
  readonly element = el('div', 'bs');
  private error = '';
  private readonly desuscribir: () => void;

  constructor(private readonly game: BattleshipGame) {
    this.desuscribir = game.onChange(() => this.render());
    // Un solo oyente para todas las celdas y botones: el HTML se redibuja en cada cambio.
    this.element.addEventListener('click', (ev) => this.alClic(ev));
    this.render();
  }

  destroy(): void {
    this.desuscribir();
  }

  private alClic(ev: Event): void {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-coord], [data-a]');
    if (!t) return;
    this.error = '';
    try {
      if (t.dataset.coord) this.game.fire(t.dataset.coord);
      else if (t.dataset.a === 'rearrange') this.game.rearrangeFleet();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.render();
    }
  }

  private render(): void {
    const g = this.game;
    const miTurno = g.isRunning && g.phase === 'PLAYER_TURN';
    const fin = !g.isRunning;

    this.element.innerHTML = `
      <p class="status-line">${this.estado()}</p>
      ${this.error ? `<p class="error">${esc(this.error)}</p>` : ''}
      <div class="bs-boards">
        <figure>
          <figcaption>Flota enemiga ${restantes(g.targetBoard)}</figcaption>
          ${tablero(g.targetBoard, { disparable: miTurno, revelar: fin })}
        </figure>
        <figure>
          <figcaption>Tu flota ${restantes(g.playerBoard)}</figcaption>
          ${tablero(g.playerBoard, { disparable: false, revelar: true })}
        </figure>
      </div>
      ${this.decision()}
      ${g.canRearrange ? '<div class="controls"><button data-a="rearrange" class="secondary">Recolocar mi flota</button></div>' : ''}`;
  }

  private estado(): string {
    const g = this.game;
    if (g.status === 'ABANDONED') return '<span class="muted">Partida abandonada.</span>';
    if (g.status === 'FINISHED') {
      return g.winnerId === g.humanId
        ? '<span class="result good">¡Hundiste toda la flota enemiga!</span>'
        : '<span class="result bad">La IA hundió tu flota.</span>';
    }
    if (g.phase === 'PLAYER_TURN') return '<b>Tu turno:</b> dispara a una celda de la flota enemiga.';
    const ia = g.ai;
    if (ia.state === 'unavailable') {
      return `<span class="warn">IA no disponible, reintentando… (intento ${ia.failures + 1})</span> <small class="muted">${esc(ia.error ?? '')}</small>`;
    }
    return '<span class="muted">La IA (Prolog) está pensando…</span>';
  }

  private decision(): string {
    const d = this.game.ai.lastDecision;
    if (!d) return '';
    return `<p class="ai-decision"><span class="tag">${esc(d.mode)}</span> IA disparó a <b>${esc(d.coord)}</b>: ${esc(d.reason)}</p>`;
  }
}

function restantes(b: Board): string {
  return `<small class="muted">${b.remainingSizes().length}/${b.ships.length} a flote</small>`;
}

/** Dibuja un tablero 10x10 con encabezados A-J (filas) y 1-10 (columnas). */
function tablero(b: Board, o: { disparable: boolean; revelar: boolean }): string {
  const cols = Array.from({ length: b.size }, (_, i) => `<span class="bs-h">${i + 1}</span>`).join('');
  const filas: string[] = [];
  for (let f = 0; f < b.size; f++) {
    const celdas = b
      .cells()
      .filter((c) => c.row === f)
      .map((c) => {
        const r = b.resultAt(c);
        const barco = o.revelar && b.shipAt(c) ? ' ship' : '';
        const clase = `bs-cell${barco}${r ? ` ${r}` : ''}`;
        const marca = r === 'miss' ? '•' : r ? '✕' : '';
        return o.disparable && !r
          ? `<button class="${clase}" data-coord="${c}" title="${c}" aria-label="Disparar a ${c}"></button>`
          : `<span class="${clase}" title="${c}">${marca}</span>`;
      })
      .join('');
    filas.push(`<span class="bs-h">${String.fromCharCode(65 + f)}</span>${celdas}`);
  }
  return `<div class="bs-grid" style="--n:${b.size}"><span></span>${cols}${filas.join('')}</div>`;
}

export const battleshipDescriptor: GameDescriptor = {
  id: 'battleship',
  title: 'Battleship',
  description: 'Hunde la flota de la IA en Prolog antes de que hunda la tuya. Ella explica cada jugada.',
  launch(sink, ctx) {
    const game = new BattleshipGame(sink, Player.human(ctx.playerId), { strategy: new PrologAI() });
    return { game, view: new BattleshipView(game) };
  },
};
