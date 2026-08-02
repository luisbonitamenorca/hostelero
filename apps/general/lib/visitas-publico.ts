/**
 * Configuración del front público de Visitas (solo servidor).
 *
 * La página pública no tiene sesión, así que la cuenta destino se fija aquí en
 * una única fuente. Por defecto, Bonita Menorca (Binifadet). Se puede sobrescribir
 * por env para futuros tenants; cuando haya multi-tenant se pasará a slug/centro.
 */
export const CUENTA_PUBLICA =
  process.env.VISITAS_PUBLICO_CUENTA_ID ?? "082c5366-d9ae-49b9-a8b8-8caad73985bd";
