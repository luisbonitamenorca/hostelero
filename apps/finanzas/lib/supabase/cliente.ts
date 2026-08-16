"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@hostelero/db";

/**
 * Cliente de navegador. Se usa SOLO en el circuito de recuperación de
 * contraseña, donde el token llega en la URL y hay que recogerlo en el
 * navegador. Todo lo demás (lecturas y escrituras) va por el servidor con
 * `crearClienteServidor`, que es el patrón de la casa.
 *
 * Comparte las cookies de sesión con el servidor, así que en cuanto se abre
 * sesión aquí, el middleware ya la ve.
 */
export function crearClienteNavegador() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
