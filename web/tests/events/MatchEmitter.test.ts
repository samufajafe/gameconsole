import { describe, expect, it } from 'vitest';
import { EventFactory } from '../../src/core/EventFactory';
import type { GameEvent } from '../../src/core/GameEvent';
import { MemoryBuffer } from '../../src/events/EventBuffer';
import type { IngestResponse, IngestTransport } from '../../src/events/IngestTransport';
import { MatchEmitter } from '../../src/events/MatchEmitter';
import { ExponentialBackoff } from '../../src/events/RetryPolicy';

type Respuesta = IngestResponse | Error | ((lote: readonly GameEvent[]) => IngestResponse);

/** Transporte falso: contesta con la lista de respuestas dada y despues acepta todo. */
class FakeTransport implements IngestTransport {
  readonly lotes: GameEvent[][] = [];
  readonly keepalive: GameEvent[][] = [];

  constructor(
    private readonly respuestas: Respuesta[] = [],
    private readonly porDefecto: (lote: readonly GameEvent[]) => IngestResponse = (lote) => ({
      status: 200,
      body: { accepted: lote.length, rejected: [] },
    }),
  ) {}

  async post(events: readonly GameEvent[]): Promise<IngestResponse> {
    this.lotes.push([...events]);
    const r = this.respuestas.shift() ?? this.porDefecto;
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r(events) : r;
  }

  postKeepalive(events: readonly GameEvent[]): void {
    this.keepalive.push([...events]);
  }

  get enviados(): string[] {
    return this.lotes.flat().map((e) => e.type);
  }
}

function eventos(n: number): GameEvent[] {
  const f = new EventFactory('blackjack', 'm-1');
  return [f.create('MATCH_STARTED', null), ...Array.from({ length: n - 1 }, (_, i) => f.create(`E${i + 1}`, 'ana'))];
}

const sinEspera = { sleep: async () => {} };

describe('MatchEmitter', () => {
  it('send() vuelve de inmediato aunque la red tarde', async () => {
    let soltar!: () => void;
    const lento: IngestTransport = {
      post: (evs) => new Promise((r) => (soltar = () => r({ status: 200, body: { accepted: evs.length, rejected: [] } }))),
      postKeepalive: () => {},
    };
    const em = new MatchEmitter(lento);
    const [e] = eventos(1);
    em.send(e!); // si esto esperara a la red, el test se colgaria aqui
    expect(em.stats.queued).toBe(1);
    soltar();
    await em.whenIdle();
    expect(em.stats).toMatchObject({ queued: 0, delivered: 1 });
  });

  it('entrega en orden FIFO y en lotes del tamano configurado', async () => {
    const t = new FakeTransport();
    const em = new MatchEmitter(t, { batchSize: 3, ...sinEspera });
    const evs = eventos(7);
    for (const e of evs) em.send(e);
    await em.whenIdle();

    expect(t.lotes.flat().map((e) => e.eventId)).toEqual(evs.map((e) => e.eventId));
    expect(t.lotes.every((l) => l.length <= 3)).toBe(true);
    expect(em.stats.delivered).toBe(7);
  });

  it('reintenta con backoff ante errores de red y 5xx, sin perder ni desordenar', async () => {
    const esperas: number[] = [];
    const t = new FakeTransport([new Error('sin red'), { status: 503, body: null }, new Error('timeout')]);
    const em = new MatchEmitter(t, {
      retry: new ExponentialBackoff(100, 1000, () => 1),
      sleep: async (ms) => void esperas.push(ms),
    });
    const evs = eventos(3);
    for (const e of evs) em.send(e);
    await em.whenIdle();

    expect(esperas).toEqual([100, 200, 400]);
    expect(em.stats).toMatchObject({ delivered: 3, retries: 3, dead: 0, queued: 0 });
    // El ultimo intento (el que funciono) lleva todo, empezando por MATCH_STARTED.
    expect(t.lotes.at(-1)!.map((e) => e.eventId)).toEqual(evs.map((e) => e.eventId));
  });

  it('cuenta duplicate_event como entregado (el reintento de algo que ya llego)', async () => {
    const t = new FakeTransport([
      (lote) => ({ status: 400, body: { accepted: 0, rejected: lote.map((e) => ({ eventId: e.eventId, reason: 'duplicate_event' })) } }),
    ]);
    const em = new MatchEmitter(t, sinEspera);
    for (const e of eventos(2)) em.send(e);
    await em.whenIdle();
    expect(em.stats).toMatchObject({ delivered: 2, dead: 0 });
  });

  it('aparta los rechazos definitivos sin reintentarlos ni frenar al resto', async () => {
    const evs = eventos(3);
    const malo = evs[1]!.eventId;
    const t = new FakeTransport([], (lote) => ({
      status: 200,
      body: {
        accepted: lote.filter((e) => e.eventId !== malo).length,
        rejected: lote.some((e) => e.eventId === malo) ? [{ eventId: malo, reason: 'missing_player_id' }] : [],
      },
    }));
    const em = new MatchEmitter(t, sinEspera);
    for (const e of evs) em.send(e);
    await em.whenIdle();

    // Se envio una sola vez: los rechazos definitivos no se reintentan.
    expect(t.lotes.flat().filter((e) => e.eventId === malo)).toHaveLength(1);
    expect(em.stats).toMatchObject({ delivered: 2, dead: 1 });
    expect(em.deadLetters[0]).toMatchObject({ reason: 'missing_player_id', event: { eventId: evs[1]!.eventId } });
  });

  it('respalda en el buffer antes de enviar y lo limpia al confirmar', async () => {
    const buffer = new MemoryBuffer();
    let enVuelo = 0;
    const t = new FakeTransport([
      (lote) => {
        enVuelo = buffer.size;
        return { status: 200, body: { accepted: lote.length, rejected: [] } };
      },
    ]);
    const em = new MatchEmitter(t, { buffer, ...sinEspera });
    em.send(eventos(1)[0]!);
    await em.whenIdle();
    expect(enVuelo).toBe(1);
    expect(buffer.size).toBe(0);
  });

  it('wake() corta la espera del backoff', async () => {
    const t = new FakeTransport([new Error('sin red')]);
    const em = new MatchEmitter(t, { sleep: () => new Promise(() => {}) }); // espera infinita
    em.send(eventos(1)[0]!);
    await new Promise((r) => setTimeout(r, 0));
    expect(em.stats.state).toBe('retrying');
    em.wake();
    await em.whenIdle();
    expect(em.stats.delivered).toBe(1);
  });

  it('al cerrar la pestana manda con keepalive todo lo no confirmado', () => {
    const t = new FakeTransport([new Error('sin red')]);
    const em = new MatchEmitter(t, { sleep: () => new Promise(() => {}) });
    const evs = eventos(3);
    for (const e of evs) em.send(e);
    em.flushOnUnload();
    expect(t.keepalive[0]!.map((e) => e.eventId)).toEqual(evs.map((e) => e.eventId));
  });

  it('varias partidas con su propio emisor no se bloquean entre si', async () => {
    const caida: IngestTransport = { post: () => Promise.reject(new Error('caido')), postKeepalive: () => {} };
    const sana = new FakeTransport();
    const atascada = new MatchEmitter(caida, { sleep: () => new Promise(() => {}) });
    const libre = new MatchEmitter(sana, sinEspera);

    atascada.send(eventos(1)[0]!);
    libre.send(eventos(1)[0]!);
    await libre.whenIdle();
    expect(libre.stats.delivered).toBe(1);
    expect(atascada.stats.queued).toBe(1);
  });
});

describe('ExponentialBackoff', () => {
  it('crece exponencialmente con tope y jitter entre 50 % y 100 %', () => {
    const max = new ExponentialBackoff(500, 30_000, () => 1);
    expect([0, 1, 2, 3, 10].map((i) => max.delayMs(i))).toEqual([500, 1000, 2000, 4000, 30_000]);
    const min = new ExponentialBackoff(500, 30_000, () => 0);
    expect(min.delayMs(0)).toBe(250);
  });
});
