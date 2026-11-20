/** Ids que ya usan los bots; un humano con el mismo id se mezclaria con ellos en GameStats. */
const RESERVADOS = new Set(['dealer', 'prolog-ai']);

export const REGLA_ALIAS = '1 a 32 caracteres (letras, números, . _ -), distinto de "dealer" y "prolog-ai"';

/** Un alias es el `playerId` con el que GameStats agrupa el perfil del jugador. */
export function aliasValido(a: string): boolean {
  return /^[\w.-]{1,32}$/.test(a) && !RESERVADOS.has(a);
}
