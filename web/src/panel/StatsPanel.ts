import { esc, formatMs, formatValue, shortId } from '../console/html';
import type { GameRanking, GameStatsClient, IngestMetrics, MatchListItem, MatchResult, PlayerSummary } from './GameStatsClient';

export interface PanelGame {
  id: string;
  title: string;
  icon?: string;
}

/** Partida abierta en esta pestana, para mostrar si GameStats ya la analizo. */
export interface LocalMatch {
  matchId: string;
  gameId: string;
  title: string;
  status: string;
}

export interface StatsPanelOptions {
  client: GameStatsClient;
  games: readonly PanelGame[];
  playerId: () => string;
  localMatches: () => readonly LocalMatch[];
  intervalMs?: number;
  /** Avisa en cada consulta si GameStats respondio, para el indicador de la barra. */
  onConnection?: (ok: boolean) => void;
}

/** Cuantos detalles de partida nuevos se piden por ciclo, para no saturar a GameStats. */
const DETALLES_POR_CICLO = 8;

/**
 * Panel de control: consulta a GameStats por polling (P1 no tiene push) y muestra lo que
 * responde, sin recalcular metricas.
 *
 *   - Generales: `GET /metrics` de la ingestion y `GET /results/players/{id}` del jugador.
 *   - Por juego: instancias = filas de `GET /results/matches` con ese `gameId` (decision
 *     documentada en el README); ranking de `GET /results/games/{id}/ranking`; ultima partida
 *     con `GET /results/matches/{id}`.
 *
 * Los resultados de una partida analizada no cambian, asi que cada detalle se pide una sola vez.
 */
export class StatsPanel {
  private readonly detalles = new Map<string, MatchResult>();
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private corriendo = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly opts: StatsPanelOptions,
  ) {}

  start(): void {
    if (this.corriendo) return;
    this.corriendo = true;
    void this.ciclo();
  }

  stop(): void {
    this.corriendo = false;
    if (this.temporizador) clearTimeout(this.temporizador);
  }

  /** Fuerza una actualizacion inmediata (p. ej. al terminar una partida). */
  refresh(): void {
    if (!this.corriendo) return;
    if (this.temporizador) clearTimeout(this.temporizador);
    void this.ciclo();
  }

  private async ciclo(): Promise<void> {
    if (typeof document === 'undefined' || !document.hidden) await this.actualizar();
    if (this.corriendo) this.temporizador = setTimeout(() => void this.ciclo(), this.opts.intervalMs ?? 3000);
  }

  private async actualizar(): Promise<void> {
    const { client, games } = this.opts;
    const jugador = this.opts.playerId();

    const [metricas, listado, rankings, perfil] = await Promise.all([
      client.metrics().catch(() => null),
      client.matches().catch(() => null),
      Promise.all(games.map((g) => client.ranking(g.id).catch(() => undefined))),
      jugador ? client.player(jugador).catch(() => undefined) : Promise.resolve(null),
    ]);

    this.opts.onConnection?.(metricas !== null && listado !== null);
    if (listado) await this.traerDetalles(listado);

    this.root.innerHTML = `
      <div class="panel-head">
        <h2 class="section-title">Panel GameStats</h2>
        <span class="muted">Datos tal como los calcula GameStats · se actualiza cada ${(this.opts.intervalMs ?? 3000) / 1000} s · última: ${esc(new Date().toLocaleTimeString())}</span>
      </div>
      <div class="panel-general">
        ${this.generales(metricas)}
        ${this.perfil(jugador, perfil)}
      </div>
      ${this.locales(listado)}
      <div class="panel-games">
        ${games.map((g, i) => this.juego(g, listado, rankings[i])).join('')}
      </div>`;
  }

  /** Pide el detalle de las partidas que aun no tenemos; primero las de esta pestana. */
  private async traerDetalles(listado: MatchListItem[]): Promise<void> {
    const locales = new Set(this.opts.localMatches().map((m) => m.matchId));
    const faltan = listado
      .filter((m) => !this.detalles.has(m.matchId))
      .sort((a, b) => Number(locales.has(b.matchId)) - Number(locales.has(a.matchId)))
      .slice(0, DETALLES_POR_CICLO);
    const traidos = await Promise.all(faltan.map((m) => this.opts.client.match(m.matchId).catch(() => null)));
    for (const r of traidos) if (r) this.detalles.set(r.matchId, r);
  }

  private generales(m: IngestMetrics | null): string {
    if (!m) return `<section class="card"><h3>Estadísticas generales</h3><p class="error">Sin conexión con la ingestión de GameStats.</p></section>`;
    const rechazos = Object.entries(m.rejectionsByReason).filter(([, n]) => n > 0);
    return `
      <section class="card">
        <h3>Estadísticas generales <small class="muted">GET /metrics</small></h3>
        <dl class="kv">
          <dt>Partidas en curso (todas)</dt><dd>${m.activeMatches}</dd>
          <dt>Eventos recibidos</dt><dd>${m.eventsReceived}</dd>
          <dt>Eventos válidos</dt><dd>${m.eventsValid}</dd>
          <dt>Eventos inválidos</dt><dd>${m.eventsInvalid}</dd>
          <dt>Lotes analizados</dt><dd>${m.batchesSent}</dd>
          <dt>Lotes fallidos</dt><dd>${m.batchesFailed}</dd>
        </dl>
        ${rechazos.length ? `<p class="muted">Rechazos: ${rechazos.map(([r, n]) => `${esc(r)} ${n}`).join(' · ')}</p>` : ''}
      </section>`;
  }

  private perfil(jugador: string, p: PlayerSummary | null | undefined): string {
    const titulo = `<h3>Perfil de ${esc(jugador || '—')} <small class="muted">GET /results/players</small></h3>`;
    if (p === undefined) return `<section class="card">${titulo}<p class="error">Sin conexión con el análisis de GameStats.</p></section>`;
    if (p === null) return `<section class="card">${titulo}<p class="muted">Todavía no tiene partidas analizadas.</p></section>`;
    return `
      <section class="card">
        ${titulo}
        <dl class="kv">
          <dt>Partidas</dt><dd>${p.matchesPlayed}</dd>
          <dt>Victorias</dt><dd>${p.wins} (${formatValue(p.winRate)} %)</dd>
          <dt>Contra bots</dt><dd>${p.vsBots.wins}/${p.vsBots.matchesPlayed} (${formatValue(p.vsBots.winRate)} %)</dd>
          <dt>Contra humanos</dt><dd>${p.vsHumans.wins}/${p.vsHumans.matchesPlayed} (${formatValue(p.vsHumans.winRate)} %)</dd>
          <dt>Reconexiones / abandonos</dt><dd>${p.disconnections.reconnections} / ${p.disconnections.abandons}</dd>
        </dl>
      </section>`;
  }

  private locales(listado: MatchListItem[] | null): string {
    const mias = this.opts.localMatches();
    if (mias.length === 0) return '';
    const analizadas = new Map((listado ?? []).map((m) => [m.matchId, m]));
    const filas = mias
      .map((m) => {
        const r = analizadas.get(m.matchId);
        const estado = r ? `analizada · ganador: ${esc(r.winnerId ?? 'ninguno')} · ${r.eventCount} eventos` : 'aún no analizada (GameStats analiza al recibir MATCH_FINISHED)';
        return `<tr><td>${esc(m.title)}</td><td><code>${esc(shortId(m.matchId))}</code></td><td>${esc(m.status)}</td><td>${estado}</td></tr>`;
      })
      .join('');
    return `
      <section class="card">
        <h3>Partidas de esta pestaña</h3>
        <table><thead><tr><th>Juego</th><th>matchId</th><th>Consola</th><th>GameStats</th></tr></thead><tbody>${filas}</tbody></table>
      </section>`;
  }

  private juego(g: PanelGame, listado: MatchListItem[] | null, ranking: GameRanking | null | undefined): string {
    const delJuego = (listado ?? []).filter((m) => m.gameId === g.id);
    const ultima = [...this.detalles.values()]
      .filter((r) => r.gameId === g.id)
      .sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt))[0];

    return `
      <section class="card game-stats game-${esc(g.id)}">
        <h3>${g.icon ? `<span aria-hidden="true">${g.icon}</span> ` : ''}${esc(g.title)} <small class="muted">gameId: ${esc(g.id)}</small></h3>
        <p class="big">${listado ? delJuego.length : '—'} <span class="muted">instancias analizadas</span></p>
        ${this.ranking(ranking)}
        ${ultima ? this.ultima(ultima) : '<p class="muted">Sin partidas analizadas todavía.</p>'}
      </section>`;
  }

  private ranking(r: GameRanking | null | undefined): string {
    if (r === undefined) return '<p class="error">Ranking no disponible.</p>';
    if (r === null || r.ranking.length === 0) return '';
    const filas = r.ranking
      .map((x) => `<tr><td>${x.rank}</td><td>${esc(x.playerId)}</td><td>${x.matchesPlayed}</td><td>${x.wins}</td><td>${formatValue(x.winRate)} %</td></tr>`)
      .join('');
    return `<h4>Ranking</h4><table><thead><tr><th>#</th><th>Jugador</th><th>Partidas</th><th>Victorias</th><th>Win rate</th></tr></thead><tbody>${filas}</tbody></table>`;
  }

  private ultima(r: MatchResult): string {
    const especificos = Object.entries(r.match.gameSpecific)
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(formatValue(v))}</dd>`)
      .join('');
    const claves = [...new Set(r.players.flatMap((p) => Object.keys(p.gameSpecific)))].filter((k) =>
      r.players.every((p) => typeof p.gameSpecific[k] !== 'object' || p.gameSpecific[k] === null),
    );
    const jugadores = r.players
      .map((p) => `<tr><td>${esc(p.playerId)}</td>${claves.map((k) => `<td>${esc(formatValue(p.gameSpecific[k]))}</td>`).join('')}</tr>`)
      .join('');
    const patrones = r.patterns.length
      ? `<p>Patrones: ${r.patterns.map((p) => `<span class="tag">${esc(p.rule)} · ${esc(p.playerId)}</span>`).join(' ')}</p>`
      : '';
    return `
      <h4>Última partida <code>${esc(shortId(r.matchId))}</code></h4>
      <dl class="kv">
        <dt>Ganador</dt><dd>${esc(r.match.winnerId ?? 'ninguno')}</dd>
        <dt>Duración</dt><dd>${formatMs(r.match.durationMs)}</dd>
        <dt>Eventos</dt><dd>${r.eventCount}</dd>
        ${especificos}
      </dl>
      ${claves.length ? `<div class="scroll"><table><thead><tr><th>Jugador</th>${claves.map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${jugadores}</tbody></table></div>` : ''}
      ${patrones}`;
  }
}
