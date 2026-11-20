import type { GameDescriptor, GameView } from '../../console/GameDescriptor';
import { el, esc } from '../../console/html';
import { Player } from '../../core/Player';
import type { Card } from './Card';
import { BlackjackGame, type RoundOutcome } from './BlackjackGame';

const MENSAJE: Record<RoundOutcome, string> = {
  WIN: 'Ganaste la ronda',
  LOSE: 'Perdiste la ronda',
  PUSH: 'Empate',
  BLACKJACK: '¡Blackjack!',
  BUST: 'Te pasaste de 21',
};

/** Interfaz de Blackjack. Solo dibuja y delega: las reglas viven en `BlackjackGame`. */
export class BlackjackView implements GameView {
  readonly element = el('div', 'bj');
  private apuesta = 10;
  private error = '';
  private readonly desuscribir: () => void;

  constructor(private readonly game: BlackjackGame) {
    this.desuscribir = game.onChange(() => this.render());
    this.render();
  }

  destroy(): void {
    this.desuscribir();
  }

  private render(): void {
    const g = this.game;
    const enRonda = g.phase === 'PLAYER_TURN';
    const activa = g.isRunning;
    const ultima = g.lastRound;

    this.element.innerHTML = `
      <div class="hand"><div class="hand-label">Crupier ${g.dealerHand.length ? `<b>${g.dealerHoleHidden ? '?' : g.dealerTotal}</b>` : ''}</div>
        <div class="cards">${g.dealerHand.map((c, i) => carta(c, g.dealerHoleHidden && i === 1)).join('')}</div></div>
      <div class="hand"><div class="hand-label">Tú ${g.playerHand.length ? `<b>${g.playerTotal}</b>` : ''}</div>
        <div class="cards">${g.playerHand.map((c) => carta(c, false)).join('')}</div></div>
      <p class="status-line">Fichas: <b>${g.bankroll}</b> · Rondas: ${g.roundsPlayed}
        ${enRonda ? ` · Apuesta: <b>${g.currentBet}</b>` : ''}
        ${ultima && !enRonda ? ` · <span class="result ${ultima.payout > 0 ? 'good' : ultima.payout < 0 ? 'bad' : ''}">${MENSAJE[ultima.outcome]} (${ultima.payout > 0 ? '+' : ''}${ultima.payout})</span>` : ''}
      </p>
      ${this.error ? `<p class="error">${esc(this.error)}</p>` : ''}
      <div class="controls">
        ${
          !activa
            ? `<span class="muted">Partida ${g.status === 'FINISHED' ? 'terminada' : 'abandonada'}.</span>`
            : enRonda
              ? `<button data-a="hit">Pedir</button><button data-a="stand">Plantarse</button>`
              : `<input type="number" min="1" max="${g.bankroll}" step="1" value="${Math.min(this.apuesta, g.bankroll)}" aria-label="Apuesta">
                 <button data-a="bet">Apostar</button><button data-a="leave" class="secondary">Levantarse de la mesa</button>`
        }
      </div>`;

    this.element.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) =>
      b.addEventListener('click', () => this.accion(b.dataset.a!)),
    );
  }

  private accion(a: string): void {
    this.error = '';
    try {
      if (a === 'bet') {
        const input = this.element.querySelector<HTMLInputElement>('input[type=number]');
        this.apuesta = Math.floor(Number(input?.value ?? 0));
        this.game.placeBet(this.apuesta);
      } else if (a === 'hit') this.game.hit();
      else if (a === 'stand') this.game.stand();
      else if (a === 'leave') this.game.leaveTable();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.render();
    }
  }
}

function carta(c: Card, oculta: boolean): string {
  if (oculta) return '<span class="playing-card back"></span>';
  return `<span class="playing-card ${c.isRed ? 'red' : ''}">${esc(c.toString())}</span>`;
}

export const blackjackDescriptor: GameDescriptor = {
  id: 'blackjack',
  title: 'Blackjack',
  description: 'Tú contra el crupier (se planta en 17). Blackjack paga 3:2.',
  launch(sink, ctx) {
    const game = new BlackjackGame(sink, Player.human(ctx.playerId));
    return { game, view: new BlackjackView(game) };
  },
};
