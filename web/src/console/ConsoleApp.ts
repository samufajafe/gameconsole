import { HttpIngestTransport } from '../events/IngestTransport';
import { GameStatsClient } from '../panel/GameStatsClient';
import { StatsPanel } from '../panel/StatsPanel';
import { aliasValido, REGLA_ALIAS } from './alias';
import { preguntar } from './dialog';
import type { GameDescriptor } from './GameDescriptor';
import { el, esc } from './html';
import { InstanceManager, type DeliverySummary } from './InstanceManager';

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
  /** Ultima respuesta de GameStats: `null` mientras no se sabe. */
  private enLinea: boolean | null = null;
  private envio: DeliverySummary = { queued: 0, retrying: false, dead: 0 };

  constructor(
    private readonly root: HTMLElement,
    private readonly games: readonly GameDescriptor[],
  ) {
    this.alias = leerAlias();

    root.innerHTML = `
      <a class="skip" href="#contenido">Saltar al contenido</a>
      <header class="topbar">
        <div class="brand" aria-label="GameConsole"><span class="logo">GAME<b>CONSOLE</b></span></div>
        <nav class="tabs" role="tablist" aria-label="Secciones">
          <button role="tab" id="t-juegos" data-tab="juegos" aria-selected="true" aria-controls="tab-juegos">🕹 Juegos</button>
          <button role="tab" id="t-panel" data-tab="panel" aria-selected="false" aria-controls="tab-panel" tabindex="-1">📊 Panel</button>
        </nav>
        <div class="topbar-end">
          <span class="net chip" role="status" data-state="pending">● Conectando con GameStats…</span>
          <div class="alias">
            <label for="alias">Jugador</label>
            <input id="alias" value="${esc(this.alias)}" maxlength="32" autocomplete="off" spellcheck="false"
              aria-describedby="alias-ayuda">
            <p id="alias-ayuda" class="field-error" role="alert"></p>
          </div>
        </div>
      </header>
      <main id="contenido">
        <section id="tab-juegos" class="tab" role="tabpanel" aria-labelledby="t-juegos">
          <h2 class="section-title">Elige un juego</h2>
          <div class="catalog"></div>
          <div class="section-row">
            <h2 class="section-title">Partidas abiertas <span class="count" aria-live="polite">0</span></h2>
            <p class="muted">Cada partida es independiente: abre varias a la vez o juega en otra pestaña del navegador.</p>
          </div>
          <div class="instances"></div>
          <div class="empty">
            <p class="empty-art" aria-hidden="true">👾</p>
            <p><b>No hay partidas abiertas.</b></p>
            <p class="muted">Elige un juego arriba y pulsa <b>Jugar</b>. Los resultados aparecen en el <b>Panel</b>.</p>
          </div>
        </section>
        <section id="tab-panel" class="tab hidden" role="tabpanel" aria-labelledby="t-panel"><div class="panel"></div></section>
      </main>`;

    this.instancias = new InstanceManager(
      this.q('.instances'),
      new HttpIngestTransport(),
      () => this.alCambiar(),
      (s) => {
        this.envio = s;
        this.pintarRed();
      },
    );
    this.panel = new StatsPanel(this.q('.panel'), {
      client: new GameStatsClient(),
      games: games.map((g) => ({ id: g.id, title: g.title, icon: g.icon })),
      playerId: () => this.alias,
      localMatches: () =>
        this.instancias.all.map((i) => ({ matchId: i.game.matchId, gameId: i.game.gameId, title: i.game.title, status: i.statusLabel })),
      onConnection: (ok) => {
        this.enLinea = ok;
        this.pintarRed();
      },
    });

    this.armarCatalogo();
    this.armarEventos();
    this.validarAlias();
    this.panel.start();
  }

  private armarCatalogo(): void {
    const catalogo = this.q('.catalog');
    for (const g of this.games) {
      const tarjeta = el(
        'article',
        `game-tile game-${g.id}`,
        `<div class="tile-art" aria-hidden="true">${g.icon}</div>
         <h3>${esc(g.title)}</h3>
         <p class="tile-mode">${esc(g.mode)}</p>
         <p class="tile-desc">${esc(g.description)}</p>
         <details><summary>Cómo se juega</summary><ul>${g.howTo.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
         <div class="tile-foot"><span class="tile-count" data-count="${g.id}"></span></div>`,
      );
      const boton = el('button', 'btn primary play', '▶ Jugar');
      boton.type = 'button';
      boton.setAttribute('aria-label', `Jugar ${g.title}`);
      boton.addEventListener('click', () => void this.lanzar(g, boton));
      tarjeta.querySelector('.tile-foot')!.prepend(boton);
      catalogo.append(tarjeta);
    }
  }

  private async lanzar(g: GameDescriptor, boton: HTMLButtonElement): Promise<void> {
    if (!this.validarAlias()) {
      this.q('#alias').focus();
      return;
    }
    boton.disabled = true; // evita abrir dos partidas con un doble clic
    try {
      await this.instancias.launch(g, { playerId: this.alias, ask: preguntar });
    } finally {
      boton.disabled = !aliasValido(this.alias);
    }
  }

  private armarEventos(): void {
    const input = this.q<HTMLInputElement>('#alias');
    // Se valida mientras escribe (el error aparece al lado del campo) y se guarda al confirmar.
    input.addEventListener('input', () => {
      this.alias = input.value.trim();
      this.validarAlias();
    });
    input.addEventListener('change', () => {
      if (this.validarAlias()) guardarAlias(this.alias);
      this.panel.refresh();
    });

    const tabs = [...this.root.querySelectorAll<HTMLButtonElement>('[role=tab]')];
    const elegir = (b: HTMLButtonElement): void => {
      for (const t of tabs) {
        const activa = t === b;
        t.setAttribute('aria-selected', String(activa));
        t.tabIndex = activa ? 0 : -1;
      }
      this.root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${b.dataset.tab}`));
      this.panel.refresh();
    };
    tabs.forEach((b, i) => {
      b.addEventListener('click', () => elegir(b));
      // Flechas izquierda/derecha entre pestanas, como en cualquier tablist.
      b.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
        const otra = tabs[(i + (ev.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
        otra.focus();
        elegir(otra);
      });
    });

    // Cerrar la pestana a mitad de partida: se abandona y se manda con keepalive.
    window.addEventListener('pagehide', () => this.instancias.abandonAllOnUnload());
    window.addEventListener('online', () => this.instancias.wakeAll());
  }

  private alCambiar(): void {
    const n = this.instancias.all.length;
    this.q('.empty').classList.toggle('hidden', n > 0);
    this.q('.count').textContent = String(n);
    for (const g of this.games) {
      const c = this.instancias.count(g.id);
      this.q(`[data-count="${g.id}"]`).textContent = c ? `${c} abierta${c > 1 ? 's' : ''}` : '';
    }
    this.panel.refresh();
  }

  /** Estado de GameStats en la barra: si responde y si hay eventos esperando. */
  private pintarRed(): void {
    const chip = this.q('.net');
    const { queued, retrying, dead } = this.envio;
    let estado: string;
    let texto: string;
    if (retrying || this.enLinea === false) {
      estado = 'down';
      texto = queued > 0 ? `⚠ GameStats sin conexión · ${queued} eventos en espera` : '⚠ GameStats sin conexión';
    } else if (queued > 0) {
      estado = 'busy';
      texto = `↑ Enviando ${queued} eventos`;
    } else if (this.enLinea) {
      estado = 'ok';
      texto = '● GameStats en línea';
    } else {
      estado = 'pending';
      texto = '● Conectando con GameStats…';
    }
    if (dead > 0) texto += ` · ${dead} rechazados`;
    chip.dataset.state = estado;
    chip.textContent = texto;
    chip.title =
      estado === 'down'
        ? 'Puedes seguir jugando: los eventos quedan en cola y se envían solos cuando GameStats vuelva.'
        : 'Estado de la conexión con GameStats';
  }

  private validarAlias(): boolean {
    const ok = aliasValido(this.alias);
    const input = this.q<HTMLInputElement>('#alias');
    input.toggleAttribute('aria-invalid', !ok);
    this.q('#alias-ayuda').textContent = ok ? '' : `Usa ${REGLA_ALIAS}.`;
    this.root.querySelectorAll<HTMLButtonElement>('.play').forEach((b) => {
      b.disabled = !ok;
      b.title = ok ? '' : 'Primero corrige tu alias';
    });
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
