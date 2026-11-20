/**
 * Consultas a GameStats para el panel. Solo GETs a los endpoints que P1 ya expone
 * (docs/CONTRACT.md §4); la consola no calcula ninguna metrica, solo muestra estas respuestas.
 *
 * Las rutas pasan por el proxy del mismo origen (`/gamestats/ingest`, `/gamestats/analytics`)
 * porque GameStats no tiene CORS. El proxy no transforma nada.
 */

export interface IngestMetrics {
  eventsReceived: number;
  eventsValid: number;
  eventsInvalid: number;
  rejectionsByReason: Record<string, number>;
  activeMatches: number;
  batchesSent: number;
  batchesFailed: number;
}

export interface MatchListItem {
  matchId: string;
  gameId: string;
  winnerId: string | null;
  eventCount: number;
  patterns: string[];
}

export interface PatternResult {
  rule: string;
  playerId: string;
  detail: Record<string, unknown>;
}

export interface MatchResult {
  matchId: string;
  gameId: string;
  analyzedAt: string;
  eventCount: number;
  generic?: { eventsByType: Record<string, number>; playersSeen: number };
  match: {
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    playerCount: number;
    winnerId: string | null;
    gameSpecific: Record<string, unknown>;
  };
  players: Array<{ playerId: string; gameSpecific: Record<string, unknown> }>;
  patterns: PatternResult[];
}

export interface GameRanking {
  gameId: string;
  top: number;
  ranking: Array<{ rank: number; playerId: string; matchesPlayed: number; wins: number; winRate: number }>;
}

export interface PlayerSummary {
  playerId: string;
  matchesPlayed: number;
  wins: number;
  winRate: number;
  vsBots: { matchesPlayed: number; wins: number; winRate: number };
  vsHumans: { matchesPlayed: number; wins: number; winRate: number };
  disconnections: { reconnections: number; abandons: number };
  byGame: Array<{ gameId: string; matchesPlayed: number; gameSpecific: Record<string, unknown> }>;
}

export class GameStatsClient {
  constructor(
    private readonly ingestUrl = '/gamestats/ingest',
    private readonly analyticsUrl = '/gamestats/analytics',
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly timeoutMs = 4000,
  ) {}

  metrics(): Promise<IngestMetrics> {
    return this.get<IngestMetrics>(`${this.ingestUrl}/metrics`).then(obligatorio);
  }

  async matches(): Promise<MatchListItem[]> {
    const r = await this.get<{ matches: MatchListItem[] }>(`${this.analyticsUrl}/results/matches`);
    return obligatorio(r).matches;
  }

  /** `null` si la partida todavia no fue analizada (404). */
  match(matchId: string): Promise<MatchResult | null> {
    return this.get<MatchResult>(`${this.analyticsUrl}/results/matches/${encodeURIComponent(matchId)}`);
  }

  /** `null` si el juego no tiene partidas analizadas (404). */
  ranking(gameId: string, top = 5): Promise<GameRanking | null> {
    return this.get<GameRanking>(`${this.analyticsUrl}/results/games/${encodeURIComponent(gameId)}/ranking?top=${top}`);
  }

  /** `null` si el jugador no aparece en ninguna partida analizada (404). */
  player(playerId: string): Promise<PlayerSummary | null> {
    return this.get<PlayerSummary>(`${this.analyticsUrl}/results/players/${encodeURIComponent(playerId)}`);
  }

  private async get<T>(url: string): Promise<T | null> {
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), this.timeoutMs);
    try {
      const resp = await this.fetchImpl(url, { signal: corte.signal, headers: { Accept: 'application/json' } });
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`GameStats respondio ${resp.status} en ${url}`);
      return (await resp.json()) as T;
    } finally {
      clearTimeout(reloj);
    }
  }
}

function obligatorio<T>(valor: T | null): T {
  if (valor === null) throw new Error('GameStats respondio 404 en un endpoint que siempre existe');
  return valor;
}
