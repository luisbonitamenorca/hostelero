/**
 * Configuración común de los front públicos (solo servidor).
 *
 * Las páginas públicas no tienen sesión, así que la cuenta destino se fija aquí
 * en una única fuente. Por defecto, Bonita Menorca. Se puede sobrescribir por
 * env; cuando haya multi-tenant se pasará a slug/dominio.
 */
export const CUENTA_PUBLICA =
  process.env.VISITAS_PUBLICO_CUENTA_ID ?? "082c5366-d9ae-49b9-a8b8-8caad73985bd";
