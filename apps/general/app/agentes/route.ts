import { readFile } from "node:fs/promises";
import path from "node:path";
import { exigirModulo } from "@/lib/supabase/server";

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
  const html = await readFile(path.join(process.cwd(), "datos", "agentes.html"), "utf8");
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // La sesión decide quién entra: esta página nunca se cachea compartida.
      "cache-control": "private, no-store",
    },
  });
}
