/**
 * Prefijo con el que se sirve esta app (basePath en next.config.ts).
 *
 * SOLO se usa en enlaces <a> crudos, que el navegador resuelve tal cual y a los
 * que Next no les añade nada — por ejemplo la descarga del PDF.
 *
 * NO se usa en Link, router.push ni redirect():
 *  · Link y router.push añaden el prefijo ellos solos.
 *  · redirect() de una acción de servidor devuelve el destino TAL CUAL, y
 *    cuando la acción la lanza JavaScript (que es siempre, en un navegador
 *    real) el router del cliente le añade el prefijo al navegar. Prefijarlo
 *    aquí lo duplicaba: /finanzas/finanzas/clientes.
 *
 * Por eso las acciones ya no redirigen: devuelven a dónde ir y navega el
 * cliente con router.push, que es determinista. Verificado en producción el
 * 16-08-2026, después de que el fallo saliera creando un cliente de verdad.
 */
export const BASE = "/finanzas";

export function ruta(camino: string): string {
  return `${BASE}${camino}`;
}
