import { exigirModulo } from "@/lib/supabase/server";
import { servirHtmlModulo } from "@/lib/html-modulo";

export const dynamic = "force-dynamic";

/**
 * PyG Socios: cuadro de mando económico para socios. Es la app de un solo
 * HTML que vivía suelta en Vercel (pyg-socios), servida aquí tal cual pero
 * DETRÁS de la sesión de Hostelero — la pantalla de contraseña que traía se
 * quitó a propósito: quien llega ya está identificado y con el módulo
 * permitido para su rol (solo dirección, ver ACCESO_POR_ROL).
 *
 * Los datos NO viven aquí: la página lee su Excel del Storage del proyecto
 * Ratios (bucket 'pyg'), igual que antes. Decisión de Luis (17-08-2026):
 * PyG y Ratios se quedan con sus datos separados e independientes mientras
 * dure la fase de pruebas; aquí solo se integra el look&feel y el acceso.
 */
export async function GET() {
  await exigirModulo("pyg");
  return servirHtmlModulo("pyg.html");
}
