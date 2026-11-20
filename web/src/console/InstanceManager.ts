import type { Game } from '../core/Game';
import type { IngestTransport } from '../events/IngestTransport';
import { MatchEmitter, type EmitterStats } from '../events/MatchEmitter';
import { confirmar } from './dialog';
import type { GameDescriptor, GameView, LaunchContext } from './GameDescriptor';
import { el, esc, menosMovimiento, shortId } from './html';

const ESTADO: Record<string, string> = {
  CREATED: 'creada',
  RUNNING: 'en curso',
  FINISHED: 'terminada',
  ABANDONED: 'abandonada',
};

/** Tras cuanto tiempo sin respuesta un envio se muestra como "esperando a GameStats". */
const LENTO_MS = 1500;

/** Resumen del envio de todas las partidas de la pestana, para el indicador de la barra. */
export interface DeliverySummary {
  /** Eventos esperando ser entregados. */
  queued: number;
  /** Alguna partida esta reintentando porque GameStats no responde. */
  retrying: boolean;
  /** Eventos que GameStats rechazo (no se reintentan). */
  dead: number;
}

/** Una partida abierta en la consola: el juego, su emisor propio y su vista. */
export class GameInstance {
  readonly card = el('article', 'instance');
  private readonly badge = el('span', 'chip emitter');
  private readonly estado = el('span', 'chip state');
  private readonly quitar: Array<() => void> = [];
  private lento: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly descriptor: GameDescriptor,
    readonly game: Game,
    readonly emitter: MatchEmitter,
    private readonly view: GameView,
    onClose: (i: GameInstance) => void,
    onDelivery: () => void,
  ) {
    const cabecera = el(
      'header',
      '',
      `<span class="inst-icon" aria-hidden="true">${descriptor.icon}</span>
       <h3>${esc(game.title)}</h3>
       <code title="matchId: ${esc(game.matchId)}">#${esc(shortId(game.matchId))}</code>`,
    );
    const cerrar = el('button', 'icon-btn close', '✕');
    cerrar.type = 'button';
    cerrar.title = 'Cerrar la partida';
    cerrar.setAttribute('aria-label', `Cerrar la partida de ${game.title}`);
    cerrar.addEventListener('click', () => onClose(this));
    this.badge.setAttribute('role', 'status');
    cabecera.append(this.estado, this.badge, cerrar);
    this.card.classList.add(`game-${descriptor.id}`);
    this.card.setAttribute('aria-label', `Partida de ${game.title}`);
    this.card.append(cabecera, view.element);

    this.quitar.push(game.onChange(() => this.pintarEstado()));
    this.quitar.push(
      emitter.subscribe((s) => {
        this.pintarEmisor(s);
        onDelivery();
      }),
    );
    this.pintarEstado();
  }

  get statusLabel(): string {
    return ESTADO[this.game.status] ?? this.game.status;
  }

  destroy(): void {
    clearTimeout(this.lento);
    for (const q of this.quitar) q();
    this.view.destroy();
    this.card.remove();
  }

  private pintarEstado(): void {
    this.estado.textContent = this.statusLabel;
    this.estado.dataset.status = this.game.status;
    this.card.dataset.status = this.game.status;
  }

  /** Indicador del envio: cuantos eventos esperan, cuantos llegaron y si esta reintentando. */
  private pintarEmisor(s: EmitterStats, lento = false): void {
    // Un envio que no contesta (p. ej. ingest en pausa) tarda hasta el timeout del transporte en
    // fallar; si pasa de LENTO_MS se avisa que se esta esperando, en vez de "enviando".
    clearTimeout(this.lento);
    if (s.state === 'sending' && !lento) {
      this.lento = setTimeout(() => {
        const ahora = this.emitter.stats;
        if (ahora.state === 'sending') this.pintarEmisor(ahora, true);
      }, LENTO_MS);
    }

    let texto: string;
    if (s.state === 'retrying') texto = `⟳ GameStats no responde · ${s.queued} en cola`;
    else if (lento) texto = `⏳ esperando a GameStats · ${s.queued} en cola`;
    else if (s.queued > 0) texto = `↑ enviando ${s.queued}`;
    else texto = `✓ ${s.delivered} eventos enviados`;
    this.badge.textContent = texto + (s.dead > 0 ? ` · ${s.dead} rechazados` : '');
    this.badge.dataset.state = s.dead > 0 ? 'dead' : lento ? 'retrying' : s.state;
    this.badge.title =
      s.state === 'retrying' || lento
        ? `Los eventos quedan guardados y se reenvían solos cuando GameStats vuelva.${s.lastError ? ` Último error: ${s.lastError}` : ''}`
        : 'Eventos de esta partida entregados a GameStats';
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
    private readonly onDelivery: (s: DeliverySummary) => void = () => {},
  ) {}

  get all(): readonly GameInstance[] {
    return this.instancias;
  }

  /** Cuantas partidas abiertas hay de un juego. */
  count(gameId: string): number {
    return this.instancias.filter((i) => i.descriptor.id === gameId).length;
  }

  async launch(descriptor: GameDescriptor, ctx: LaunchContext): Promise<GameInstance | null> {
    const emitter = new MatchEmitter(this.transport);
    const creado = await descriptor.launch(emitter, ctx);
    if (!creado) return null;

    const instancia = new GameInstance(
      descriptor,
      creado.game,
      emitter,
      creado.view,
      (i) => void this.pedirCierre(i),
      () => this.avisarEnvio(),
    );
    creado.game.onChange(() => this.onChange());
    this.instancias.unshift(instancia);
    this.container.prepend(instancia.card);
    creado.game.start();
    this.onChange();
    instancia.card.scrollIntoView({ behavior: menosMovimiento() ? 'auto' : 'smooth', block: 'nearest' });
    return instancia;
  }

  /** Cerrar una partida en curso la abandona: se pide confirmacion antes. */
  private async pedirCierre(i: GameInstance): Promise<void> {
    if (i.game.isRunning) {
      const ok = await confirmar({
        titulo: '¿Abandonar la partida?',
        mensaje: `La partida de ${i.game.title} sigue en curso. Si la cierras, GameStats la registra como abandonada.`,
        aceptar: 'Abandonar',
        cancelar: 'Seguir jugando',
        peligro: true,
      });
      if (!ok || !this.instancias.includes(i)) return;
    }
    this.close(i);
  }

  /** Cierra la instancia. Si estaba en curso la abandona (manda MATCH_FINISHED). */
  close(i: GameInstance): void {
    i.game.abandon();
    i.destroy();
    this.instancias.splice(this.instancias.indexOf(i), 1);
    // El emisor sigue vivo hasta entregar lo que le queda, aunque la tarjeta ya no este.
    this.drenando.add(i.emitter);
    const sub = i.emitter.subscribe(() => this.avisarEnvio());
    void i.emitter.whenIdle().then(() => {
      sub();
      this.drenando.delete(i.emitter);
      this.avisarEnvio();
    });
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

  summary(): DeliverySummary {
    const stats = this.emisores().map((e) => e.stats);
    return {
      queued: stats.reduce((n, s) => n + s.queued, 0),
      retrying: stats.some((s) => s.state === 'retrying'),
      dead: stats.reduce((n, s) => n + s.dead, 0),
    };
  }

  private avisarEnvio(): void {
    this.onDelivery(this.summary());
  }

  private emisores(): MatchEmitter[] {
    return [...this.instancias.map((i) => i.emitter), ...this.drenando];
  }
}
