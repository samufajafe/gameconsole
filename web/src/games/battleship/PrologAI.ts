import type { OpponentView, ShotDecision, ShotStrategy } from './ShotStrategy';

/**
 * IA de Battleship en SWI-Prolog (`prolog/battleship_ai.pl`), consultada por HTTP.
 *
 * La consola le manda lo que la maquina ve del tablero del humano y ejecuta la jugada que Prolog
 * devuelve; aqui no se decide nada. El `baseUrl` por defecto es `/prolog`, la ruta del proxy nginx
 * en el mismo origen.
 */
export class PrologAI implements ShotStrategy {
  constructor(
    private readonly baseUrl = '/prolog',
    private readonly timeoutMs = 5000,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async decide(view: OpponentView): Promise<ShotDecision> {
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await this.fetchImpl(`${this.baseUrl}/battleship/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(view),
        signal: corte.signal,
      });
    } catch (e) {
      throw new Error(corte.signal.aborted ? 'Prolog no respondio a tiempo' : `Sin conexion con Prolog (${mensaje(e)})`);
    } finally {
      clearTimeout(reloj);
    }

    if (!resp.ok) throw new Error(`Prolog respondio ${resp.status}`);
    let cuerpo: unknown;
    try {
      cuerpo = await resp.json();
    } catch {
      throw new Error('Prolog respondio algo que no es JSON');
    }
    return leerDecision(cuerpo);
  }
}

function leerDecision(x: unknown): ShotDecision {
  const o = x as Partial<ShotDecision> | null;
  if (
    typeof o !== 'object' ||
    o === null ||
    typeof o.coord !== 'string' ||
    (o.mode !== 'HUNT' && o.mode !== 'TARGET') ||
    typeof o.reason !== 'string'
  ) {
    throw new Error('Respuesta de Prolog con formato inesperado');
  }
  return { coord: o.coord, mode: o.mode, reason: o.reason };
}

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
