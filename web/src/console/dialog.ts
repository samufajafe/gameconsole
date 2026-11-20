import { el, esc } from './html';

/**
 * Dialogos modales propios (sobre `<dialog>`), en lugar de `prompt`/`confirm`/`alert` del
 * navegador: muestran el error junto al campo, se cancelan con Esc y respetan el estilo.
 */

interface Base {
  titulo: string;
  mensaje: string;
  aceptar?: string;
  cancelar?: string;
}

export interface Pregunta extends Base {
  etiqueta: string;
  porDefecto?: string;
  /** Devuelve el mensaje de error, o `null` si el valor sirve. */
  validar?: (valor: string) => string | null;
}

export interface Confirmacion extends Base {
  /** Accion destructiva: el boton de aceptar va en rojo. */
  peligro?: boolean;
}

function abrir(cuerpo: string, clase: string): HTMLDialogElement {
  const d = el('dialog', `dlg ${clase}`, `<form method="dialog" novalidate>${cuerpo}</form>`);
  document.body.append(d);
  d.addEventListener('close', () => d.remove(), { once: true });
  d.showModal();
  return d;
}

/** Pide un texto. Resuelve con el valor ya recortado, o `null` si se cancela. */
export function preguntar(o: Pregunta): Promise<string | null> {
  const d = abrir(
    `<h2>${esc(o.titulo)}</h2>
     <p>${esc(o.mensaje)}</p>
     <label class="field"><span>${esc(o.etiqueta)}</span>
       <input name="valor" value="${esc(o.porDefecto ?? '')}" maxlength="32" autocomplete="off" aria-describedby="dlg-error"></label>
     <p id="dlg-error" class="field-error" role="alert"></p>
     <div class="dlg-actions">
       <button type="button" class="btn ghost" data-r="no">${esc(o.cancelar ?? 'Cancelar')}</button>
       <button type="submit" class="btn primary">${esc(o.aceptar ?? 'Aceptar')}</button>
     </div>`,
    'dlg-ask',
  );
  const input = d.querySelector<HTMLInputElement>('input')!;
  const error = d.querySelector<HTMLElement>('.field-error')!;
  input.select();

  return new Promise((resolver) => {
    let resultado: string | null = null;
    const revisar = (): string | null => o.validar?.(input.value.trim()) ?? null;
    input.addEventListener('input', () => {
      // Solo se limpia el aviso mientras escribe; se vuelve a validar al aceptar.
      if (!revisar()) {
        error.textContent = '';
        input.removeAttribute('aria-invalid');
      }
    });
    d.querySelector('form')!.addEventListener('submit', (ev) => {
      const problema = revisar();
      if (problema) {
        ev.preventDefault();
        error.textContent = problema;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      resultado = input.value.trim();
    });
    d.querySelector('[data-r="no"]')!.addEventListener('click', () => d.close());
    d.addEventListener('close', () => resolver(resultado), { once: true });
  });
}

/** Pide confirmar una accion. Esc o "Cancelar" resuelven `false`. */
export function confirmar(o: Confirmacion): Promise<boolean> {
  const d = abrir(
    `<h2>${esc(o.titulo)}</h2>
     <p>${esc(o.mensaje)}</p>
     <div class="dlg-actions">
       <button type="submit" value="no" class="btn ghost" autofocus>${esc(o.cancelar ?? 'Cancelar')}</button>
       <button type="submit" value="si" class="btn ${o.peligro ? 'danger' : 'primary'}">${esc(o.aceptar ?? 'Aceptar')}</button>
     </div>`,
    'dlg-confirm',
  );
  return new Promise((resolver) => d.addEventListener('close', () => resolver(d.returnValue === 'si'), { once: true }));
}
