import { confirmar } from '../../console/dialog';
import type { GameDescriptor, GameView } from '../../console/GameDescriptor';
import { el, esc, redibujar } from '../../console/html';
import { Player } from '../../core/Player';
import type { Card } from './Card';
import { BlackjackGame, type RoundOutcome } from './BlackjackGame';

const MENSAJE: Record<RoundOutcome, string> = {
  WIN: '¡Ganaste la ronda!',
  LOSE: 'Gana el crupier',
  PUSH: 'Empate',
  BLACKJACK: '¡BLACKJACK!',
  BUST: 'Te pasaste de 21',
};

/** Fichas para armar la apuesta con clics, sin tener que escribir. */
const FICHAS = [5, 25, 50, 100] as const;

/**
 * Interfaz de Blackjack. Solo dibuja y delega: las reglas viven en `BlackjackGame`.
 *
 * Atajos con la mesa seleccionada: P pide carta, M se planta, Enter reparte.
 */
export class BlackjackView implements GameView {
  readonly element = el('div', 'bj');
  private apuesta = 10;
  private error = '';
  /** Cartas ya dibujadas por mano, para animar solo las que llegan. */
  private vistas = { crupier: 0, jugador: 0, oculta: false };
  private readonly fichasIniciales: number;
  private readonly desuscribir: () => void;

  constructor(private readonly game: BlackjackGame) {
    this.fichasIniciales = game.bankroll;
    this.element.tabIndex = 0;
    this.element.setAttribute('aria-label', 'Mesa de blackjack. Atajos: P pedir carta, M plantarse, Enter repartir.');
    this.element.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-a]');
      if (b && !b.disabled) this.accion(b.dataset.a!, b.dataset.v);
    });
    this.element.addEventListener('input', (ev) => {
      const t = ev.target as HTMLInputElement;
      if (t.dataset.f === 'bet') {
        this.apuesta = Math.floor(Number(t.value));
        this.pintarApuesta();
      }
    });
    this.element.addEventListener('keydown', (ev) => this.tecla(ev));
    this.desuscribir = game.onChange(() => this.render());
    this.render();
  }

  destroy(): void {
    this.desuscribir();
  }

  private tecla(ev: KeyboardEvent): void {
    if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const g = this.game;
    if (!g.isRunning) return;
    const escribiendo = (ev.target as HTMLElement).tagName === 'INPUT';
    if (g.phase === 'PLAYER_TURN' && ev.code === 'KeyP') this.accion('hit');
    else if (g.phase === 'PLAYER_TURN' && ev.code === 'KeyM') this.accion('stand');
    else if (g.phase === 'BETTING' && ev.key === 'Enter' && (escribiendo || ev.target === this.element)) this.accion('bet');
    else return;
    ev.preventDefault();
  }

  private accion(a: string, v?: string): void {
    this.error = '';
    const g = this.game;
    try {
      if (a === 'chip') {
        this.apuesta = Math.min(g.bankroll, Math.max(0, this.apuestaValida()) + Number(v));
        this.render();
      } else if (a === 'all') {
        this.apuesta = g.bankroll;
        this.render();
      } else if (a === 'clear') {
        this.apuesta = 0;
        this.render();
      } else if (a === 'bet') {
        if (this.problemaApuesta()) throw new Error(this.problemaApuesta()!);
        g.placeBet(this.apuesta);
      } else if (a === 'hit') g.hit();
      else if (a === 'stand') g.stand();
      else if (a === 'leave') void this.levantarse();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.render();
    }
  }

  private async levantarse(): Promise<void> {
    const g = this.game;
    const ok = await confirmar({
      titulo: '¿Levantarse de la mesa?',
      mensaje: `Terminas la partida con ${g.bankroll} fichas. No se puede deshacer.`,
      aceptar: 'Levantarme',
      cancelar: 'Seguir jugando',
    });
    if (ok && g.isRunning && g.phase === 'BETTING') g.leaveTable();
  }

  private apuestaValida(): number {
    return Number.isFinite(this.apuesta) ? this.apuesta : 0;
  }

  /** Por que no se puede repartir con la apuesta actual; `null` si se puede. */
  private problemaApuesta(): string | null {
    const a = this.apuesta;
    if (!Number.isInteger(a) || a < 1) return 'La apuesta mínima es 1 ficha.';
    if (a > this.game.bankroll) return `Solo tienes ${this.game.bankroll} fichas.`;
    return null;
  }

  /** Actualiza el aviso y el boton de repartir sin redibujar (para no perder el cursor). */
  private pintarApuesta(): void {
    const problema = this.problemaApuesta();
    const aviso = this.element.querySelector<HTMLElement>('.bet-hint');
    const boton = this.element.querySelector<HTMLButtonElement>('[data-a="bet"]');
    const input = this.element.querySelector<HTMLInputElement>('[data-f="bet"]');
    if (aviso) aviso.textContent = problema ?? '';
    if (boton) boton.disabled = !!problema;
    input?.toggleAttribute('aria-invalid', !!problema);
  }

  private render(): void {
    const g = this.game;
    const enRonda = g.phase === 'PLAYER_TURN';
    const ultima = g.lastRound;

    // Mano nueva: se reinicia el conteo de cartas vistas.
    if (g.dealerHand.length < this.vistas.crupier || g.playerHand.length < this.vistas.jugador) {
      this.vistas = { crupier: 0, jugador: 0, oculta: false };
    }
    const crupier = g.dealerHand.map((c, i) => {
      const oculta = g.dealerHoleHidden && i === 1;
      const nueva = i >= this.vistas.crupier || (i === 1 && this.vistas.oculta && !oculta);
      return carta(c, oculta, nueva, i);
    });
    const jugador = g.playerHand.map((c, i) => carta(c, false, i >= this.vistas.jugador, i));
    this.vistas = { crupier: g.dealerHand.length, jugador: g.playerHand.length, oculta: g.dealerHoleHidden };

    const totalJugador = g.playerHand.length ? g.playerTotal : null;
    const totalCrupier = g.dealerHand.length ? (g.dealerHoleHidden ? '?' : g.dealerTotal) : null;
    const banner =
      ultima && !enRonda
        ? `<div class="bj-banner ${ultima.payout > 0 ? 'good' : ultima.payout < 0 ? 'bad' : 'even'}" role="status">
             <b>${MENSAJE[ultima.outcome]}</b>
             <span>${ultima.payout > 0 ? '+' : ''}${ultima.payout} fichas · tú ${ultima.playerTotal} – crupier ${ultima.dealerTotal}</span>
           </div>`
        : '';

    redibujar(
      this.element,
      `
      <div class="hud">
        <div class="hud-item"><span class="hud-label">Fichas</span><span class="hud-value">${g.bankroll}</span></div>
        <div class="hud-item"><span class="hud-label">Apuesta</span><span class="hud-value">${enRonda ? g.currentBet : '—'}</span></div>
        <div class="hud-item"><span class="hud-label">Ronda</span><span class="hud-value">${g.roundsPlayed + (enRonda ? 1 : 0)}</span></div>
      </div>
      <div class="felt">
        <div class="seat">
          <div class="seat-head"><span class="seat-name">Crupier</span>${totalCrupier !== null ? `<span class="total">${totalCrupier}</span>` : ''}</div>
          <div class="cards" aria-label="Cartas del crupier">${crupier.join('') || '<span class="card-slot"></span><span class="card-slot"></span>'}</div>
        </div>
        ${banner || '<p class="felt-rule">Blackjack paga 3 a 2 · El crupier se planta en 17</p>'}
        <div class="seat">
          <div class="seat-head"><span class="seat-name">${esc(g.participants.find((p) => !p.isBot)?.name ?? 'Tú')}</span>${
            totalJugador !== null ? `<span class="total ${totalJugador > 21 ? 'bust' : totalJugador === 21 ? 'max' : ''}">${totalJugador}</span>` : ''
          }</div>
          <div class="cards" aria-label="Tus cartas">${jugador.join('') || '<span class="card-slot"></span><span class="card-slot"></span>'}</div>
        </div>
      </div>
      ${this.error ? `<p class="error" role="alert">${esc(this.error)}</p>` : ''}
      ${this.controles()}`,
    );
    if (g.phase === 'BETTING' && g.isRunning) this.pintarApuesta();
  }

  private controles(): string {
    const g = this.game;
    if (!g.isRunning) {
      const dif = g.bankroll - this.fichasIniciales;
      return `<div class="game-over">
          <p class="game-over-title">${g.status === 'FINISHED' ? 'Fin de la partida' : 'Partida abandonada'}</p>
          <p>Terminaste con <b>${g.bankroll}</b> fichas (${dif >= 0 ? '+' : ''}${dif}) en ${g.roundsPlayed} rondas.
             Mira las estadísticas en el <b>Panel</b>.</p>
        </div>`;
    }
    if (g.phase === 'PLAYER_TURN') {
      return `<div class="controls">
          <button type="button" class="btn primary" data-a="hit">Pedir carta <kbd>P</kbd></button>
          <button type="button" class="btn" data-a="stand">Me planto <kbd>M</kbd></button>
        </div>
        <p class="keys-hint">Selecciona la mesa para usar los atajos.</p>`;
    }
    const a = this.apuestaValida();
    const fichas = FICHAS.map(
      (f) =>
        `<button type="button" class="chip-btn chip-${f}" data-a="chip" data-v="${f}" ${a + f > g.bankroll ? 'disabled' : ''}
           aria-label="Sumar ${f} fichas">${f}</button>`,
    ).join('');
    return `<div class="bet">
        <div class="bet-chips" role="group" aria-label="Fichas para apostar">${fichas}
          <button type="button" class="btn small ghost" data-a="all">Todo</button>
          <button type="button" class="btn small ghost" data-a="clear">Borrar</button>
        </div>
        <label class="bet-amount">Apuesta
          <input type="number" data-f="bet" min="1" max="${g.bankroll}" step="1" value="${a}" inputmode="numeric"></label>
        <span class="bet-hint field-error" role="alert"></span>
      </div>
      <div class="controls">
        <button type="button" class="btn primary" data-a="bet">Repartir <kbd>Enter</kbd></button>
        <button type="button" class="btn ghost" data-a="leave">Levantarse de la mesa</button>
      </div>`;
  }
}

function carta(c: Card, oculta: boolean, nueva: boolean, i: number): string {
  const anim = nueva ? ` nueva" style="--d:${Math.min(i, 3) * 90}ms` : '';
  if (oculta) return `<span class="playing-card back${anim}" aria-label="Carta boca abajo"></span>`;
  const palo = c.toString().slice(c.rank.length);
  return `<span class="playing-card ${c.isRed ? 'red' : ''}${anim}" aria-label="${esc(c.toString())}">
      <span class="pc-corner">${esc(c.rank)}<br>${palo}</span><span class="pc-suit" aria-hidden="true">${palo}</span></span>`;
}

export const blackjackDescriptor: GameDescriptor = {
  id: 'blackjack',
  title: 'Blackjack',
  icon: '🃏',
  mode: '1 jugador · contra el crupier',
  description: 'Acércate a 21 sin pasarte y gánale al crupier. Empiezas con 500 fichas.',
  howTo: [
    'Elige tu apuesta con las fichas y pulsa Repartir.',
    'Pide carta (P) para sumar o plántate (M) para quedarte con lo que tienes.',
    'Las figuras valen 10 y el as 1 u 11. Blackjack (21 con dos cartas) paga 3 a 2.',
    'El crupier pide hasta llegar a 17. Levántate de la mesa cuando quieras terminar.',
  ],
  async launch(sink, ctx) {
    const game = new BlackjackGame(sink, Player.human(ctx.playerId));
    return { game, view: new BlackjackView(game) };
  },
};
