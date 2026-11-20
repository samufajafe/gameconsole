import { HttpIngestTransport } from '../events/IngestTransport';
import { GameStatsClient } from '../panel/GameStatsClient';
import { StatsPanel } from '../panel/StatsPanel';
import { aliasValido, REGLA_ALIAS } from './alias';
import type { GameDescriptor } from './GameDescriptor';
import { el, esc } from './html';
import { InstanceManager } from './InstanceManager';

const CLAVE_ALIAS = 'gameconsole.alias';

/**
 * La consola: catalogo de juegos, partidas simultaneas y panel de GameStats.
 *
 * Cada pestana es una consola independiente; varias pestanas pueden jugar a la vez porque cada
 * partida tiene su `matchId` UUID y GameStats agrupa por el.
 */
export class ConsoleApp {
  private readonly instancias: InstanceManager;
  private readonly panel: StatsPanel;
  private alias: string;

  constructor(
    private readonly root: HTMLElement,
    private readonly games: readonly GameDescriptor[],
  ) {
    this.alias = leerAlias();

    root.innerHTML = `
      <header class="topbar">
        <h1>GameConsole</h1>
        <label>Jugador <input id="alias" value="${esc(this.alias)}" maxlength="32" autocomplete="off"></label>
        <nav class="tabs"><button data-tab="juegos" class="active">Juegos</button><button data-tab="panel">Panel</button></nav>
      </header>
      <main>
        <section id="tab-juegos" class="tab">
          <div class="catalog"></div>
          <div class="instances"></div>
          <p class="empty muted">Inicia una partida. Puedes tener varias abiertas a la vez, y también abrir otra pestaña.</p>
        </section>
        <section id="tab-panel" class="tab hidden"><div class="panel"></div></section>
      </main>`;

    this.instancias = new InstanceManager(this.q('.instances'), new HttpIngestTransport(), () => this.alCambiar());
    this.panel = new StatsPanel(this.q('.panel'), {
      client: new GameStatsClient(),
      games: games.map((g) => ({ id: g.id, title: g.title })),
      playerId: () => this.alias,
      localMatches: () =>
        this.instancias.all.map((i) => ({ matchId: i.game.matchId, gameId: i.game.gameId, title: i.game.title, status: i.statusLabel })),
    });

    this.armarCatalogo();
    this.armarEventos();
    this.panel.start();
  }

  private armarCatalogo(): void {
    const catalogo = this.q('.catalog');
    for (const g of this.games) {
      const tarjeta = el('div', `game-tile game-${g.id}`, `<h2>${esc(g.title)}</h2><p>${esc(g.description)}</p>`);
      const boton = el('button', '', 'Nueva partida');
      boton.addEventListener('click', () => this.lanzar(g));
      tarjeta.append(boton);
      catalogo.append(tarjeta);
    }
  }

  private lanzar(g: GameDescriptor): void {
    if (!this.validarAlias()) return;
    this.instancias.launch(g, {
      playerId: this.alias,
      ask: (pregunta, porDefecto) => window.prompt(pregunta, porDefecto),
    });
  }

  private armarEventos(): void {
    const input = this.q<HTMLInputElement>('#alias');
    input.addEventListener('change', () => {
      this.alias = input.value.trim();
      if (this.validarAlias()) guardarAlias(this.alias);
      this.panel.refresh();
    });

    this.root.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        this.root.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
        this.root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${b.dataset.tab}`));
        this.panel.refresh();
      }),
    );

    // Cerrar la pestana a mitad de partida: se abandona y se manda con keepalive.
    window.addEventListener('pagehide', () => this.instancias.abandonAllOnUnload());
    window.addEventListener('online', () => this.instancias.wakeAll());
  }

  private alCambiar(): void {
    this.q('.empty').classList.toggle('hidden', this.instancias.all.length > 0);
    this.panel.refresh();
  }

  private validarAlias(): boolean {
    const ok = aliasValido(this.alias);
    this.q('#alias').classList.toggle('invalid', !ok);
    if (!ok) alert(`Elige un alias de ${REGLA_ALIAS}.`);
    return ok;
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    const e = this.root.querySelector<T>(sel);
    if (!e) throw new Error(`Falta ${sel}`);
    return e;
  }
}

function leerAlias(): string {
  try {
    const guardado = localStorage.getItem(CLAVE_ALIAS);
    if (guardado) return guardado;
  } catch {
    // localStorage puede no estar disponible (modo privado).
  }
  // Alias estable para la pestana: es el playerId con el que GameStats agrupa el perfil.
  const nuevo = `jugador-${Math.floor(Math.random() * 900 + 100)}`;
  guardarAlias(nuevo);
  return nuevo;
}

function guardarAlias(a: string): void {
  try {
    localStorage.setItem(CLAVE_ALIAS, a);
  } catch {
    // Solo es una comodidad.
  }
}
