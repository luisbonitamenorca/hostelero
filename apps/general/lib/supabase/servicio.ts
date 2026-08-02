import { createClient } from "@supabase/supabase-js";
import type { Database } from "@hostelero/db";

/**
 * Cliente Supabase con service_role. SOLO para los route handlers de servidor
 * del front público (que no tiene sesión y por tanto no pasa por RLS de
 * `authenticated`). NUNCA importar desde componentes cliente: la service key
 * jamás va al bundle ni al repo, se lee de una env de servidor.
 *
 * Devuelve null si falta configuración (para responder 503 en vez de romper).
 */
export function crearClienteServicio() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
