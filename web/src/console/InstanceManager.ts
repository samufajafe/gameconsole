import type { Game } from '../core/Game';
import type { IngestTransport } from '../events/IngestTransport';
import { MatchEmitter, type EmitterStats } from '../events/MatchEmitter';
import type { GameDescriptor, GameView, LaunchContext } from './GameDescriptor';
import { el, esc, shortId } from './html';

const ESTADO: Record<string, string> = {
  CREATED: 'creada',
  RUNNING: 'en curso',
  FINISHED: 'terminada',
  ABANDONED: 'abandonada',
};

/** Una partida abierta en la consola: el juego, su emisor propio y su vista. */
export class GameInstance {
  readonly card = el('article', 'instance');
  private readonly badge = el('span', 'emitter');
  private readonly estado = el('span', 'state');
  private readonly quitar: Array<() => void> = [];

  constructor(
    readonly descriptor: GameDescriptor,
    readonly game: Game,
    readonly emitter: MatchEmitter,
    private readonly view: GameView,
    onClose: (i: GameInstance) => void,
  ) {
    const cabecera = el(
      'header',
      '',
      `<h3>${esc(game.title)}</h3><code title="${esc(game.matchId)}">${esc(shortId(game.matchId))}</code>`,
    );
    const cerrar = el('button', 'close', '✕');
    cerrar.title = 'Cerrar instancia (si está en curso, se abandona)';
    cerrar.addEventListener('click', () => onClose(this));
    cabecera.append(this.estado, this.badge, cerrar);
    this.card.classList.add(`game-${descriptor.id}`);
    this.card.append(cabecera, view.element);

    this.quitar.push(game.onChange(() => this.pintarEstado()));
    this.quitar.push(emitter.subscribe((s) => this.pintarEmisor(s)));
    this.pintarEstado();
  }

  get statusLabel(): string {
    return ESTADO[this.game.status] ?? this.game.status;
  }

  destroy(): void {
    for (const q of this.quitar) q();
    this.view.destroy();
    this.card.remove();
  }

  private pintarEstado(): void {
    this.estado.textContent = this.statusLabel;
    this.estado.dataset.status = this.game.status;
  }

  /** Indicador del envio: cuantos eventos esperan, cuantos llegaron y si esta reintentando. */
  private pintarEmisor(s: EmitterStats): void {
    const texto = s.state === 'retrying' ? `reintentando… ${s.queued} en cola` : s.queued > 0 ? `enviando ${s.queued}` : `✓ ${s.delivered} eventos`;
    this.badge.textContent = texto + (s.dead > 0 ? ` · ${s.dead} rechazados` : '');
    this.badge.dataset.state = s.dead > 0 ? 'dead' : s.state;
    this.badge.title = s.lastError ? `Último error: ${s.lastError}` : 'Eventos enviados a GameStats';
  }
}

/**
 * Maneja las instancias simultaneas de la pestana. Cada partida tiene su `MatchEmitter`, de modo
 * que los envios de una no esperan a los de otra; todas comparten el transporte HTTP.
 */
export class InstanceManager {
  private readonly instancias: GameInstance[] = [];
  /** Emisores de partidas ya cerradas que todavia tienen eventos por entregar. */
  private readonly drenando = new Set<MatchEmitter>();

  constructor(
    private readonly container: HTMLElement,
    private readonly transport: IngestTransport,
    private readonly onChange: () => void,
  ) {}

  get all(): readonly GameInstance[] {
    return this.instancias;
  }

  launch(descriptor: GameDescriptor, ctx: LaunchContext): GameInstance | null {
    const emitter = new MatchEmitter(this.transport);
    const creado = descriptor.launch(emitter, ctx);
    if (!creado) return null;

    const instancia = new GameInstance(descriptor, creado.game, emitter, creado.view, (i) => this.close(i));
    creado.game.onChange(() => this.onChange());
    this.instancias.unshift(instancia);
    this.container.prepend(instancia.card);
    creado.game.start();
    this.onChange();
    return instancia;
  }

  /** Cierra la instancia. Si estaba en curso la abandona (manda MATCH_FINISHED). */
  close(i: GameInstance): void {
    i.game.abandon();
    i.destroy();
    this.instancias.splice(this.instancias.indexOf(i), 1);
    // El emisor sigue vivo hasta entregar lo que le queda, aunque la tarjeta ya no este.
    this.drenando.add(i.emitter);
    void i.emitter.whenIdle().then(() => this.drenando.delete(i.emitter));
    this.onChange();
  }

  /** Al cerrar la pestana: abandona lo que este en curso y manda todo con keepalive. */
  abandonAllOnUnload(): void {
    for (const i of this.instancias) i.game.abandon();
    for (const e of this.emisores()) e.flushOnUnload();
  }

  /** Volvio la red: que cada emisor reintente ya, sin esperar su backoff. */
  wakeAll(): void {
    for (const e of this.emisores()) e.wake();
  }

  private emisores(): MatchEmitter[] {
    return [...this.instancias.map((i) => i.emitter), ...this.drenando];
  }
}
