import { exigirModulo } from "@/lib/supabase/server";
import { servirHtmlModulo } from "@/lib/html-modulo";

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
  return servirHtmlModulo("ratios.html");
}
