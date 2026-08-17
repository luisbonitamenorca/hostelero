import { readFile } from "node:fs/promises";
import path from "node:path";
import { exigirModulo } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Ratios Food Cost: la app de un solo HTML que vivía suelta en Vercel
 * (ratios-bonita), servida aquí tal cual pero DETRÁS de la sesión de
 * Hostelero — su pantalla de contraseña se quitó a propósito: quien llega ya
 * está identificado y con el módulo permitido para su rol (solo dirección,
 * ver ACCESO_POR_ROL). Mismo patrón que /pyg.
 *
 * Los datos NO viven aquí: la página lee y escribe en el Supabase del
 * proyecto Ratios, igual que antes. Decisión de Luis (17-08-2026): Ratios y
 * PyG se quedan con sus datos separados e independientes mientras dure la
 * fase de pruebas; aquí solo se integra el look&feel y el acceso. El port
 * de datos de Ratios al esqueleto es decisión de noviembre.
 *
 * El Copilot Escandallo (api/escandallo.js del repo original) NO está
 * portado: el HTML actual no lo llama. El día que se conecte, su proxy se
 * trae aquí con la sesión como guarda en vez del token en el navegador.
 */
export async function GET() {
  await exigirModulo("ratios");
  const html = await readFile(path.join(process.cwd(), "datos", "ratios.html"), "utf8");
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // La sesión decide quién entra: esta página nunca se cachea compartida.
      "cache-control": "private, no-store",
    },
  });
}
