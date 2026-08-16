/**
 * Prefijo con el que se sirve esta app (basePath en next.config.ts).
 *
 * Hace falta escrito porque Next NO lo aplica en todas partes:
 *  · Link y router.push  → lo añaden solos. No usar `ruta()` con ellos.
 *  · NextResponse.redirect en middleware → lo añade solo (viene de nextUrl).
 *  · redirect() de next/navigation en acciones de servidor y guards → NO lo
 *    añade. Ahí hay que usar `ruta()`, o el usuario acaba en la portada de
 *    hostelero-app en vez de en el módulo.
 *
 * Verificado el 16-08-2026 contra las dos apps levantadas: un login fallido
 * devolvía 303 a /login en vez de a /finanzas/login.
 */
export const BASE = "/finanzas";

export function ruta(camino: string): string {
  return `${BASE}${camino}`;
}
