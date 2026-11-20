import type { EventSink } from '../core/EventSink';
import type { GameEvent } from '../core/GameEvent';
import { MemoryBuffer, type EventBuffer } from './EventBuffer';
import type { IngestResponse, IngestTransport } from './IngestTransport';
import { ExponentialBackoff, type RetryPolicy } from './RetryPolicy';

export type EmitterState = 'idle' | 'sending' | 'retrying';

export interface EmitterStats {
  state: EmitterState;
  /** Eventos emitidos que todavia no confirma GameStats. */
  queued: number;
  delivered: number;
  /** Rechazados definitivamente por GameStats (no se reintentan). */
  dead: number;
  retries: number;
  lastError: string | null;
}

export interface DeadLetter {
  event: GameEvent;
  reason: string;
}

export interface MatchEmitterOptions {
  buffer?: EventBuffer;
  retry?: RetryPolicy;
  /** Maximo de eventos por POST. Go acepta un arreglo y lo procesa en orden. */
  batchSize?: number;
  /** Espera entre reintentos; las pruebas la reemplazan para no esperar de verdad. */
  sleep?: (ms: number) => Promise<void>;
}

type Resultado = 'resuelto' | 'reintentar';

/** El reintento de algo que ya llego: Go lo rechaza por repetido, y eso es exito. */
const YA_ENTREGADO = 'duplicate_event';

/**
 * Emisor asincrono de los eventos de UNA partida.
 *
 *   - `send()` es sincrono: mete el evento en una cola FIFO en memoria, lo respalda en el buffer
 *     y vuelve. El juego nunca espera a la red.
 *   - Un unico bucle por partida vacia la cola en lotes, en orden. Que sea uno solo garantiza que
 *     MATCH_STARTED llega antes que el resto y MATCH_FINISHED al final, que es lo que exige Go.
 *   - Si no hay respuesta, o es un 5xx, 408 o 429: espera con backoff exponencial y jitter y
 *     reintenta el mismo lote, sin limite. Como cada evento conserva su `eventId`, si el lote si
 *     habia llegado Go responde `duplicate_event` y se cuenta como entregado.
 *   - Cualquier otro rechazo es definitivo (el evento esta mal o la partida no existe en Go): se
 *     aparta en `deadLetters` y no se reintenta, para no bloquear al resto.
 *
 * Varias partidas tienen cada una su emisor, asi que una partida con problemas no frena a las
 * demas.
 */
export class MatchEmitter implements EventSink {
  readonly deadLetters: DeadLetter[] = [];

  private readonly cola: GameEvent[] = [];
  private readonly buffer: EventBuffer;
  private readonly retry: RetryPolicy;
  private readonly batchSize: number;
  private readonly sleep: (ms: number) => Promise<void>;

  private enviando = false;
  private intento = 0;
  private despertar: (() => void) | null = null;
  private esperandoVacio: Array<() => void> = [];
  private readonly oyentes = new Set<(s: EmitterStats) => void>();
  private estadisticas: EmitterStats = { state: 'idle', queued: 0, delivered: 0, dead: 0, retries: 0, lastError: null };

  constructor(
    private readonly transport: IngestTransport,
    options: MatchEmitterOptions = {},
  ) {
    this.buffer = options.buffer ?? new MemoryBuffer();
    this.retry = options.retry ?? new ExponentialBackoff();
    this.batchSize = Math.max(1, options.batchSize ?? 20);
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get stats(): EmitterStats {
    return { ...this.estadisticas };
  }

  send(event: GameEvent): void {
    this.cola.push(event);
    // El respaldo no se espera: si falla, el evento igual sigue en la cola.
    this.buffer.append(event).catch(() => undefined);
    this.actualizar({ queued: this.cola.length });
    void this.bombear();
  }

  /** Corta la espera del backoff y reintenta ya (p. ej. el navegador volvio a tener red). */
  wake(): void {
    this.despertar?.();
  }

  /** Se resuelve cuando no queda nada por enviar. Lo usan las pruebas y el cierre ordenado. */
  whenIdle(): Promise<void> {
    if (!this.enviando && this.cola.length === 0) return Promise.resolve();
    return new Promise((r) => this.esperandoVacio.push(r));
  }

  /**
   * Ultimo intento al cerrar la pestana: manda TODO lo no confirmado con `fetch keepalive`. Si
   * parte ya habia llegado, Go lo descarta como duplicado sin danio.
   */
  flushOnUnload(): void {
    this.transport.postKeepalive(this.cola.slice());
  }

  subscribe(oyente: (s: EmitterStats) => void): () => void {
    this.oyentes.add(oyente);
    oyente(this.stats);
    return () => this.oyentes.delete(oyente);
  }

  private async bombear(): Promise<void> {
    if (this.enviando) return; // ya hay un bucle vaciando la cola: el evento nuevo lo tomara el
    this.enviando = true;
    try {
      while (this.cola.length > 0) {
        const lote = this.cola.slice(0, this.batchSize);
        this.actualizar({ state: 'sending' });

        if ((await this.intentar(lote)) === 'reintentar') {
          const ms = this.retry.delayMs(this.intento++);
          this.actualizar({ state: 'retrying', retries: this.estadisticas.retries + 1 });
          await this.esperar(ms);
          continue;
        }

        // Solo se agrega al final de la cola, asi que el lote sigue siendo su prefijo.
        this.intento = 0;
        this.cola.splice(0, lote.length);
        this.actualizar({ queued: this.cola.length, lastError: null });
      }
    } finally {
      this.enviando = false;
      this.actualizar({ state: 'idle' });
      const esperando = this.esperandoVacio;
      this.esperandoVacio = [];
      for (const r of esperando) r();
    }
  }

  private async intentar(lote: GameEvent[]): Promise<Resultado> {
    let resp: IngestResponse;
    try {
      resp = await this.transport.post(lote);
    } catch (error) {
      this.actualizar({ lastError: error instanceof Error ? error.message : String(error) });
      return 'reintentar';
    }

    if (resp.body === null) {
      if (resp.status >= 500 || resp.status === 408 || resp.status === 429 || resp.status === 0) {
        this.actualizar({ lastError: `HTTP ${resp.status}` });
        return 'reintentar';
      }
      this.resolver(lote, () => `http_${resp.status}`);
      return 'resuelto';
    }

    const body = resp.body;
    const porEvento = new Map<string, string>();
    let sinId: string | null = null;
    for (const r of body.rejected) {
      if (r.eventId) porEvento.set(r.eventId, r.reason);
      else sinId = r.reason; // malformed_json: no se sabe de cual, afecta al lote
    }

    this.resolver(lote, (e) => {
      const razon = porEvento.get(e.eventId) ?? (body.accepted === 0 ? sinId : null);
      return razon === YA_ENTREGADO ? null : razon;
    });
    return 'resuelto';
  }

  /** Cierra el lote: `razon(e)` es null si el evento quedo entregado, o la razon del rechazo. */
  private resolver(lote: GameEvent[], razon: (e: GameEvent) => string | null): void {
    let entregados = 0;
    for (const e of lote) {
      const r = razon(e);
      if (r === null) {
        entregados++;
      } else {
        this.deadLetters.push({ event: e, reason: r });
        console.warn(`[GameConsole] GameStats rechazo ${e.type} ${e.eventId}: ${r}`);
      }
    }
    this.buffer.remove(lote.map((e) => e.eventId)).catch(() => undefined);
    this.actualizar({
      delivered: this.estadisticas.delivered + entregados,
      dead: this.estadisticas.dead + (lote.length - entregados),
    });
  }

  private async esperar(ms: number): Promise<void> {
    await new Promise<void>((r) => {
      this.despertar = r;
      this.sleep(ms).then(() => r());
    });
    this.despertar = null;
  }

  private actualizar(cambio: Partial<EmitterStats>): void {
    this.estadisticas = { ...this.estadisticas, ...cambio };
    const foto = this.stats;
    for (const o of this.oyentes) o(foto);
  }
}
