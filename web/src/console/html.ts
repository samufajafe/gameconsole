/** Escapa texto para meterlo en HTML. Todo dato que viene de GameStats o del usuario pasa por aqui. */
export function esc(valor: unknown): string {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Crea un elemento con clase y contenido HTML ya escapado. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html) e.innerHTML = html;
  return e;
}

/** Atributos que identifican un control para devolverle el foco despues de redibujar. */
const CLAVES_FOCO = ['data-a', 'data-coord', 'data-cell', 'data-ship', 'data-f'];

/**
 * Reemplaza el contenido de `root` sin perder el foco del teclado: si estaba en un control con
 * `data-a`/`data-coord`/..., se lo devuelve al control equivalente del HTML nuevo; si ese ya no
 * existe, a `root` (que debe tener `tabIndex`). Asi los atajos y las flechas siguen funcionando.
 */
export function redibujar(root: HTMLElement, html: string): void {
  const activo = document.activeElement as HTMLElement | null;
  const dentro = !!activo && activo !== root && root.contains(activo);
  const attr = dentro ? CLAVES_FOCO.find((a) => activo!.hasAttribute(a)) : undefined;
  const selector = attr ? `[${attr}="${CSS.escape(activo!.getAttribute(attr)!)}"]` : null;
  root.innerHTML = html;
  if (!dentro) return;
  const nuevo = selector ? root.querySelector<HTMLElement>(selector) : null;
  (nuevo && !nuevo.hasAttribute('disabled') ? nuevo : root).focus({ preventScroll: true });
}

/** `true` si el usuario pidio menos movimiento en su sistema. */
export function menosMovimiento(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Muestra un valor de GameStats tal cual, con formato legible. No calcula nada. */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null)) return v.map(formatValue).join(', ');
    return v.map((x) => formatObject(x as Record<string, unknown>)).join(' · ');
  }
  if (typeof v === 'object') return formatObject(v as Record<string, unknown>);
  return String(v);
}

function formatObject(o: Record<string, unknown>): string {
  return Object.entries(o)
    .map(([k, x]) => `${k}: ${formatValue(x)}`)
    .join(', ');
}

/** Duracion en ms de GameStats como "1 min 05 s". */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
