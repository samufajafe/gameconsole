/**
 * Genera un UUID v4.
 *
 * `crypto.randomUUID()` solo existe en contextos seguros (https o localhost). Si la consola se
 * sirve por http desde otra maquina no esta disponible, pero `crypto.getRandomValues()` si, asi
 * que se arma el UUID a mano con la misma calidad de aleatoriedad.
 */
export function uuid(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();

  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC 4122
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
