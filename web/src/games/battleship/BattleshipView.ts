import type { GameDescriptor, GameView } from '../../console/GameDescriptor';
import { el, esc, redibujar } from '../../console/html';
import { Player } from '../../core/Player';
import { BattleshipGame } from './BattleshipGame';
import type { Board, ShotResult } from './Board';
import { Coord } from './Coord';
import { esHorizontal, FleetPlacement, NOMBRE_BARCO } from './FleetPlacement';
import { PrologAI } from './PrologAI';
import type { Ship } from './Ship';
import type { ShotDecision } from './ShotStrategy';

/**
 * Pantallas de la partida:
 *   - `preparar`: la flota ya esta al azar; se puede sortear otra o pasar a colocarla a mano.
 *   - `manual`: el jugador pone barco por barco (con vista previa y giro con R).
 *   - `batalla`: los dos tableros; termina con el resultado.
 * La colocacion es solo de la vista y del tablero propio: no viaja en ningun evento.
 */
type Modo = 'preparar' | 'manual' | 'batalla';

const RESULTADO: Record<ShotResult, string> = { miss: 'agua', hit: '¡tocado!', sunk: '¡hundido!' };
const MODO_IA: Record<string, string> = {
  HUNT: 'Buscando: dispara donde más probable es que haya un barco',
  TARGET: 'Rematando: dispara junto a un barco ya tocado',
};
const LARGO_BITACORA = 6;
/** Donde va el mensaje de error dentro de cada pantalla. */
const HUECO_ERROR = '<!--error-->';
const FLECHAS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

/** Interfaz de Battleship. Solo dibuja y delega: las reglas viven en `BattleshipGame`. */
export class BattleshipView implements GameView {
  readonly element = el('div', 'bs');
  private modo: Modo;
  private colocacion: FleetPlacement | null = null;
  private error = '';
  /** Ultimas jugadas de la IA, la mas nueva primero. */
  private bitacora: ShotDecision[] = [];
  private ultimoMio: string | null = null;
  /** Celda bajo el puntero o con el foco, para la vista previa al colocar. */
  private sobre: string | null = null;
  private readonly desuscribir: () => void;

  constructor(private readonly game: BattleshipGame) {
    // La vista se crea antes de start(): una partida recien creada tambien empieza preparando.
    this.modo = game.status === 'CREATED' || game.canRearrange ? 'preparar' : 'batalla';
    this.element.tabIndex = -1;
    // Un solo oyente por tipo para todo el tablero: el HTML se redibuja en cada cambio.
    this.element.addEventListener('click', (ev) => this.alClic(ev));
    this.element.addEventListener('keydown', (ev) => this.tecla(ev));
    this.element.addEventListener('mouseover', (ev) => this.alPasar(ev));
    this.element.addEventListener('focusin', (ev) => this.alPasar(ev));
    this.element.addEventListener('mouseleave', () => this.previa(null));
    this.desuscribir = game.onChange(() => this.alCambiarJuego());
    this.render();
  }

  destroy(): void {
    this.desuscribir();
  }

  private alCambiarJuego(): void {
    const d = this.game.ai.lastDecision;
    if (d && this.bitacora[0]?.coord !== d.coord) this.bitacora = [d, ...this.bitacora].slice(0, LARGO_BITACORA);
    if (this.game.status === 'FINISHED' || this.game.status === 'ABANDONED') this.modo = 'batalla';
    this.render();
  }

  // ------------------------------------------------------------------ entrada

  private alClic(ev: Event): void {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-a], [data-coord], [data-cell], [data-ship]');
    if (!t || t.hasAttribute('disabled')) return;
    this.error = '';
    try {
      if (t.dataset.coord) this.disparar(t.dataset.coord);
      else if (t.dataset.cell) this.colocarEn(t.dataset.cell);
      else if (t.dataset.ship) this.colocacion?.select(t.dataset.ship);
      else this.accion(t.dataset.a!);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.render();
    this.previa(this.sobre);
  }

  private accion(a: string): void {
    const g = this.game;
    switch (a) {
      case 'random':
        g.rearrangeFleet();
        break;
      case 'manual':
        this.colocacion = new FleetPlacement();
        this.modo = 'manual';
        break;
      case 'rotate':
        this.colocacion?.rotate();
        break;
      case 'fill':
        this.colocacion?.fillRandom();
        break;
      case 'clear':
        this.colocacion?.clear();
        break;
      case 'cancel':
        this.colocacion = null;
        this.modo = 'preparar';
        break;
      case 'battle':
        if (this.modo === 'manual' && this.colocacion) {
          if (!this.colocacion.isComplete) throw new Error('Coloca todos los barcos antes de empezar.');
          g.setPlayerFleet(this.colocacion.ships);
          this.colocacion = null;
        }
        this.modo = 'batalla';
        queueMicrotask(() => this.element.querySelector<HTMLElement>('[data-coord]')?.focus({ preventScroll: true }));
        break;
    }
  }

  private disparar(coord: string): void {
    const g = this.game;
    if (g.phase !== 'PLAYER_TURN') throw new Error('Espera: es el turno de la IA.');
    if (g.targetBoard.wasShot(Coord.parse(coord, g.targetBoard.size))) throw new Error(`Ya disparaste a ${coord}. Elige otra celda.`);
    this.ultimoMio = coord;
    g.fire(coord);
  }

  private colocarEn(coord: string): void {
    const p = this.colocacion;
    if (!p) return;
    const c = Coord.parse(coord, p.size);
    if (p.shipAt(c)) {
      p.pickUp(c);
      return;
    }
    const sel = p.selected;
    if (!sel) throw new Error('Ya colocaste toda la flota. Haz clic en un barco para moverlo.');
    if (!p.canPlace(c)) {
      throw new Error(`El ${NOMBRE_BARCO[sel.ship]} no cabe desde ${coord}: se saldría del tablero o pisaría otro barco. Gíralo con R o elige otra celda.`);
    }
    p.place(c);
  }

  private tecla(ev: KeyboardEvent): void {
    const t = ev.target as HTMLElement;
    if (this.modo === 'manual' && (ev.key === 'r' || ev.key === 'R') && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      this.colocacion?.rotate();
      this.render();
      this.previa(this.sobre);
      return;
    }
    // Flechas para moverse por el tablero sin tener que tabular 100 celdas.
    const coord = t.dataset.coord ?? t.dataset.cell;
    const paso = FLECHAS[ev.key];
    if (!coord || !paso) return;
    ev.preventDefault();
    const c = Coord.parse(coord, 10);
    const n = this.game.targetBoard.size;
    const destino = new Coord(Math.min(n - 1, Math.max(0, c.row + paso[0])), Math.min(n - 1, Math.max(0, c.col + paso[1])));
    const attr = t.dataset.coord ? 'data-coord' : 'data-cell';
    this.element.querySelector<HTMLElement>(`[${attr}="${destino}"]`)?.focus();
  }

  private alPasar(ev: Event): void {
    if (this.modo !== 'manual') return;
    const celda = (ev.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    this.previa(celda?.dataset.cell ?? null);
  }

  /** Marca donde quedaria el barco seleccionado (verde si cabe, rojo si no), sin redibujar. */
  private previa(coord: string | null): void {
    this.sobre = coord;
    const p = this.colocacion;
    this.element.querySelectorAll('.prev-ok, .prev-bad, .grab').forEach((x) => x.classList.remove('prev-ok', 'prev-bad', 'grab'));
    if (this.modo !== 'manual' || !p || !coord) return;
    const c = Coord.parse(coord, p.size);
    const encima = p.shipAt(c);
    const celdas = encima ? encima.cells : (p.candidate(c)?.cells ?? []);
    const clase = encima ? 'grab' : p.canPlace(c) ? 'prev-ok' : 'prev-bad';
    for (const x of celdas) this.element.querySelector(`[data-cell="${x}"]`)?.classList.add(clase);
  }

  // ------------------------------------------------------------------ dibujo

  private render(): void {
    const cuerpo = this.modo === 'preparar' ? this.preparar() : this.modo === 'manual' ? this.manual() : this.batalla();
    // El error va arriba del tablero, donde se esta mirando, y no al final de la tarjeta.
    redibujar(this.element, cuerpo.replace(HUECO_ERROR, this.error ? `<p class="error" role="alert">${esc(this.error)}</p>` : ''));
  }

  private preparar(): string {
    const b = this.game.playerBoard;
    return `
      ${paso('Paso 1 de 2', 'Prepara tu flota')}
      <p class="hint">Tu flota ya está colocada <b>al azar</b>. Úsala tal cual, sortea otra o colócala tú mismo.</p>
      ${HUECO_ERROR}
      <div class="bs-setup">
        <section class="bs-side mine wide" aria-label="Tu flota">${tablero(b, (c) => celdaPropia(b, c))}</section>
        <div class="setup-side">
          ${estadoFlota(b.ships, 'Tu flota')}
          <div class="stack">
            <button type="button" class="btn" data-a="random">🎲 Sortear otra</button>
            <button type="button" class="btn" data-a="manual">✋ Colocar a mano</button>
          </div>
        </div>
      </div>
      <div class="controls end">
        <button type="button" class="btn primary big-btn" data-a="battle">⚔ ¡A la batalla!</button>
      </div>`;
  }

  private manual(): string {
    const p = this.colocacion!;
    const sel = p.selected;
    const faltan = p.spec.filter((s) => !p.isPlaced(s.ship)).length;
    const dock = p.spec
      .map((s) => {
        const puesto = p.isPlaced(s.ship);
        const activo = sel?.ship === s.ship;
        return `<button type="button" class="dock-ship ${activo ? 'sel' : ''} ${puesto ? 'placed' : ''}" data-ship="${s.ship}"
            aria-pressed="${activo}" title="${puesto ? 'Clic para levantarlo y moverlo' : 'Clic para elegirlo'}">
            <span class="dock-name">${NOMBRE_BARCO[s.ship] ?? s.ship}</span>
            <span class="pips" aria-label="${s.size} celdas">${'<i></i>'.repeat(s.size)}</span>
            <span class="dock-state">${puesto ? '✓ puesto' : activo ? '▶ colocando' : 'por colocar'}</span></button>`;
      })
      .join('');
    const tableroManual = tablero({ size: p.size }, (c) => {
      const s = p.shipAt(c);
      return `<button type="button" class="bs-cell ${s ? segmento(s, c) : ''}" data-cell="${c}"
          aria-label="${c}${s ? `, ${NOMBRE_BARCO[s.name]}` : ', vacía'}"></button>`;
    });

    return `
      ${paso('Paso 1 de 2', 'Coloca tu flota a mano')}
      <p class="hint">Elige un barco y haz clic en la celda donde empieza. <kbd>R</kbd> lo gira.
        Clic sobre un barco ya puesto lo levanta para moverlo.</p>
      ${HUECO_ERROR}
      <div class="bs-setup">
        <section class="bs-side mine wide placing" aria-label="Tu tablero">${tableroManual}</section>
        <div class="setup-side">
          <div class="dock" role="group" aria-label="Barcos por colocar">${dock}</div>
          <div class="rotate-row">
            <button type="button" class="btn small" data-a="rotate" ${sel ? '' : 'disabled'}>⟳ Girar <kbd>R</kbd></button>
            <span class="muted" role="status">${p.horizontal ? '⟷ Horizontal' : '↕ Vertical'}</span>
          </div>
          <div class="stack">
            <button type="button" class="btn small" data-a="fill" ${faltan ? '' : 'disabled'}>🎲 Completar al azar</button>
            <button type="button" class="btn small ghost" data-a="clear" ${faltan === p.spec.length ? 'disabled' : ''}>Vaciar tablero</button>
          </div>
        </div>
      </div>
      <div class="controls end">
        <span class="muted" role="status">${faltan ? `Faltan ${faltan} barco${faltan > 1 ? 's' : ''}` : '✓ Flota lista'}</span>
        <button type="button" class="btn ghost" data-a="cancel">Cancelar</button>
        <button type="button" class="btn primary big-btn" data-a="battle" ${faltan ? 'disabled' : ''}>⚔ ¡A la batalla!</button>
      </div>`;
  }

  private batalla(): string {
    const g = this.game;
    const miTurno = g.isRunning && g.phase === 'PLAYER_TURN';
    const fin = !g.isRunning;
    const rival = g.targetBoard;
    const propio = g.playerBoard;
    const ultimoIA = this.bitacora[0]?.coord ?? null;

    const enemigo = tablero(rival, (c) => {
      const r = rival.resultAt(c);
      const barco = fin && rival.shipAt(c);
      const clase = `bs-cell ${barco ? segmento(barco, c) : ''} ${r ?? ''} ${c.toString() === this.ultimoMio ? 'last' : ''}`;
      if (fin) return `<span class="${clase}" aria-label="${c}${r ? `: ${RESULTADO[r]}` : ''}">${marca(r)}</span>`;
      return `<button type="button" class="${clase}" data-coord="${c}" ${r || !miTurno ? 'aria-disabled="true"' : ''}
          aria-label="${r ? `${c}: ${RESULTADO[r]}` : `Disparar a ${c}`}">${marca(r)}</button>`;
    });
    const mio = tablero(propio, (c) => celdaPropia(propio, c, ultimoIA));

    return `
      ${this.banner()}
      ${HUECO_ERROR}
      <div class="bs-boards">
        <section class="bs-side enemy ${miTurno || fin ? '' : 'locked'}" aria-label="Flota enemiga">
          <header><h4>Flota enemiga</h4>${aFlote(rival)}</header>
          ${enemigo}
          ${estadoFlota(rival.ships)}
        </section>
        <section class="bs-side mine" aria-label="Tu flota">
          <header><h4>Tu flota</h4>${aFlote(propio)}</header>
          ${mio}
          ${estadoFlota(propio.ships)}
        </section>
      </div>
      <div class="bs-foot">
        <section class="ai-log" aria-label="Bitácora de la IA">
          <h4>🤖 Bitácora de la IA <small class="muted">Prolog</small></h4>
          ${
            this.bitacora.length
              ? `<ol>${this.bitacora.map((d) => this.entrada(d)).join('')}</ol>`
              : '<p class="muted">Aquí la IA explicará por qué elige cada disparo.</p>'
          }
        </section>
        <section class="legend" aria-label="Leyenda">
          <h4>Leyenda</h4>
          <ul>
            <li><span class="bs-cell mini miss">${marca('miss')}</span> Agua</li>
            <li><span class="bs-cell mini hit">${marca('hit')}</span> Tocado</li>
            <li><span class="bs-cell mini sunk">${marca('sunk')}</span> Hundido</li>
            <li><span class="bs-cell mini ship h ini fin"></span> Tu barco</li>
            <li><span class="bs-cell mini last"></span> Último disparo</li>
          </ul>
          <p class="keys-hint">Flechas para moverte por el tablero, Enter para disparar.</p>
        </section>
      </div>`;
  }

  private entrada(d: ShotDecision): string {
    const r = this.game.playerBoard.resultAt(Coord.parse(d.coord, 10));
    return `<li><span class="tag mode-${esc(d.mode)}" title="${esc(MODO_IA[d.mode] ?? d.mode)}">${esc(d.mode)}</span>
      <b>${esc(d.coord)}</b> ${r ? `<span class="res-${r}">${RESULTADO[r]}</span>` : ''}
      <span class="reason">${esc(d.reason)}</span></li>`;
  }

  /** Estado del turno, en grande: lo primero que se lee. */
  private banner(): string {
    const g = this.game;
    if (g.status === 'ABANDONED') return turno('off', 'Partida abandonada');
    if (g.status === 'FINISHED') {
      return g.winnerId === g.humanId
        ? turno('win', '🏆 ¡Victoria! Hundiste toda la flota enemiga', 'Mira las estadísticas en el Panel.')
        : turno('lose', '💀 Derrota: la IA hundió tu flota', 'Las flotas quedaron a la vista. Mira las estadísticas en el Panel.');
    }
    const mio = this.ultimoMio ? this.game.targetBoard.resultAt(Coord.parse(this.ultimoMio, 10)) : null;
    const tuDisparo = mio && this.ultimoMio ? `Tu disparo a ${this.ultimoMio}: ${RESULTADO[mio]}` : '';
    if (g.phase === 'PLAYER_TURN') {
      const ia = this.bitacora[0];
      const r = ia ? this.game.playerBoard.resultAt(Coord.parse(ia.coord, 10)) : null;
      return turno('mine', '🎯 Tu turno: dispara a la flota enemiga', ia && r ? `La IA disparó a ${ia.coord}: ${RESULTADO[r]}` : 'Elige una celda del tablero enemigo.');
    }
    const ia = g.ai;
    if (ia.state === 'unavailable') {
      return turno(
        'warn',
        `⚠ IA no disponible, reintentando… (intento ${ia.failures + 1})`,
        `La IA nunca dispara al azar: la partida sigue sola cuando Prolog responda. ${ia.error ?? ''}`,
      );
    }
    return turno('ai', '<span class="spinner" aria-hidden="true"></span> La IA (Prolog) está pensando…', tuDisparo);
  }
}

// -------------------------------------------------------------------- piezas de HTML

function paso(etapa: string, titulo: string): string {
  return `<div class="phase-banner"><span class="step">${etapa}</span><b>${titulo}</b></div>`;
}

function turno(tono: string, titulo: string, detalle = ''): string {
  return `<div class="turn-banner" data-tone="${tono}" role="status" aria-live="polite">
      <b>${titulo}</b>${detalle ? `<span>${esc(detalle)}</span>` : ''}</div>`;
}

function marca(r: ShotResult | null): string {
  return r === 'miss' ? '•' : r ? '✕' : '';
}

function aFlote(b: Board): string {
  return `<span class="chip">${b.remainingSizes().length}/${b.ships.length} a flote</span>`;
}

/** Lista de barcos con su tamano; los hundidos van tachados. */
function estadoFlota(ships: readonly Ship[], titulo = ''): string {
  return `${titulo ? `<h4>${titulo}</h4>` : ''}<ul class="fleet-status">${ships
    .map(
      (s) =>
        `<li class="${s.isSunk ? 'sunk' : ''}"><span class="pips" aria-hidden="true">${'<i></i>'.repeat(s.size)}</span>
          ${NOMBRE_BARCO[s.name] ?? s.name}${s.isSunk ? ' <span class="sr-only">(hundido)</span>' : ''}</li>`,
    )
    .join('')}</ul>`;
}

/** Clases para dibujar un barco como una pieza continua con las puntas redondeadas. */
function segmento(s: Ship, c: Coord): string {
  const i = s.cells.findIndex((x) => x.equals(c));
  return `ship ${esHorizontal(s) ? 'h' : 'v'}${i === 0 ? ' ini' : ''}${i === s.size - 1 ? ' fin' : ''}`;
}

function celdaPropia(b: Board, c: Coord, ultimo: string | null = null): string {
  const r = b.resultAt(c);
  const s = b.shipAt(c);
  const clase = `bs-cell ${s ? segmento(s, c) : ''} ${r ?? ''} ${c.toString() === ultimo ? 'last' : ''}`;
  return `<span class="${clase}" aria-label="${c}${s ? `, ${NOMBRE_BARCO[s.name]}` : ''}${r ? `: ${RESULTADO[r]}` : ''}">${marca(r)}</span>`;
}

/** Tablero 10x10 con encabezados A-J (filas) y 1-10 (columnas). */
function tablero(b: { size: number }, celda: (c: Coord) => string): string {
  const cols = Array.from({ length: b.size }, (_, i) => `<span class="bs-h">${i + 1}</span>`).join('');
  const filas: string[] = [];
  for (let f = 0; f < b.size; f++) {
    const celdas = Array.from({ length: b.size }, (_, col) => celda(new Coord(f, col))).join('');
    filas.push(`<span class="bs-h">${String.fromCharCode(65 + f)}</span>${celdas}`);
  }
  return `<div class="bs-grid" style="--n:${b.size}"><span></span>${cols}${filas.join('')}</div>`;
}

export const battleshipDescriptor: GameDescriptor = {
  id: 'battleship',
  title: 'Battleship',
  icon: '🚢',
  mode: '1 jugador · contra la IA en Prolog',
  description: 'Hunde los 5 barcos de la IA antes de que hunda los tuyos. La IA explica cada jugada.',
  howTo: [
    'Coloca tu flota: al azar o barco por barco (R gira el barco).',
    'Por turnos, dispara a una celda del tablero enemigo: • es agua, ✕ es tocado.',
    'Un barco se hunde cuando le aciertas todas sus celdas.',
    'Gana quien hunda primero la flota completa del otro.',
  ],
  async launch(sink, ctx) {
    const game = new BattleshipGame(sink, Player.human(ctx.playerId), { strategy: new PrologAI() });
    return { game, view: new BattleshipView(game) };
  },
};
