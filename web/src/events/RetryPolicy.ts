/** Cuanto esperar antes del reintento numero `attempt` (0 = primer reintento). */
export interface RetryPolicy {
  delayMs(attempt: number): number;
}

/**
 * Backoff exponencial con jitter: `base * 2^intento`, con un tope, y un factor aleatorio entre
 * 0.5 y 1.
 *
 * El jitter evita que muchas partidas que fallaron a la vez (GameStats se cayo) reintenten todas
 * en el mismo instante cuando vuelve.
 */
export class ExponentialBackoff implements RetryPolicy {
  constructor(
    private readonly baseMs = 500,
    private readonly maxMs = 30_000,
    private readonly random: () => number = Math.random,
  ) {}

  delayMs(attempt: number): number {
    const techo = Math.min(this.maxMs, this.baseMs * 2 ** Math.max(0, attempt));
    return Math.round(techo * (0.5 + this.random() / 2));
  }
}
