import type { GameEvent } from '../core/GameEvent';

/** Un evento rechazado, tal como lo lista `POST /events` (contracts/rejections.md). */
export interface Rejection {
  eventId?: string;
  reason: string;
  detail?: string;
}

/** Cuerpo de la respuesta de `POST /events`. */
export interface IngestBody {
  accepted: number;
  rejected: Rejection[];
}

export interface IngestResponse {
  status: number;
  /** `null` si la respuesta no trae el cuerpo del contrato (p. ej. un 502 del proxy). */
  body: IngestBody | null;
}

/**
 * Como llega un lote a la ingestion de GameStats. Separarlo del emisor permite probar el emisor
 * con un transporte falso y cambiar el mecanismo sin tocarlo.
 *
 * `post` lanza si no hubo respuesta (sin red, timeout); si hubo, la devuelve aunque sea un error.
 */
export interface IngestTransport {
  post(events: readonly GameEvent[]): Promise<IngestResponse>;
  /** Envio de ultimo momento al cerrar la pestana: no se espera respuesta. */
  postKeepalive(events: readonly GameEvent[]): void;
}

function esCuerpoDeIngesta(x: unknown): x is IngestBody {
  const o = x as IngestBody | null;
  return typeof o === 'object' && o !== null && typeof o.accepted === 'number' && Array.isArray(o.rejected);
}

/**
 * Transporte HTTP: `POST {baseUrl}/events` con el lote como arreglo JSON.
 *
 * El `baseUrl` por defecto es `/gamestats/ingest`, la ruta del proxy en el mismo origen de la
 * consola (GameStats no tiene CORS; ver README).
 */
export class HttpIngestTransport implements IngestTransport {
  constructor(
    private readonly baseUrl = '/gamestats/ingest',
    private readonly timeoutMs = 5000,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async post(events: readonly GameEvent[]): Promise<IngestResponse> {
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), this.timeoutMs);
    try {
      const resp = await this.fetchImpl(`${this.baseUrl}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events),
        signal: corte.signal,
      });
      let body: IngestBody | null = null;
      try {
        const json: unknown = await resp.json();
        body = esCuerpoDeIngesta(json) ? json : null;
      } catch {
        body = null;
      }
      return { status: resp.status, body };
    } finally {
      clearTimeout(reloj);
    }
  }

  postKeepalive(events: readonly GameEvent[]): void {
    if (events.length === 0) return;
    try {
      // keepalive deja que la peticion termine aunque la pagina se cierre (limite ~64 KB).
      void this.fetchImpl(`${this.baseUrl}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // Al cerrar la pagina no hay nada mas que hacer.
    }
  }
}
