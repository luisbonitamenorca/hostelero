import { exigirModulo } from "@/lib/supabase/server";
import { servirHtmlModulo } from "@/lib/html-modulo";

export const dynamic = "force-dynamic";

/**
 * Bonita · Agentes: panel de los agentes IA (reseñas, WhatsApp, prospección,
 * vigilancia, subvenciones), servido aquí detrás de la sesión de Hostelero
 * (módulo 'agentes', solo dirección). Mismo patrón que /pyg y /ratios con UNA
 * diferencia: su login interno SE CONSERVA, porque sus datos viven en el
 * Supabase del proyecto agentes con Auth y RLS propios y sus /api/* verifican
 * ese token. supabase-js recuerda la sesión: se pide una vez por navegador.
 *
 * Las llamadas /api/agentes/* las proxea el rewrite de next.config.mjs al
 * Vercel original (agentes-bonita.vercel.app), que conserva la
 * ANTHROPIC_API_KEY y los tres crons. Aquí no hay ninguna clave.
 */
export async function GET() {
  await exigirModulo("agentes");
  return servirHtmlModulo("agentes.html");
}
