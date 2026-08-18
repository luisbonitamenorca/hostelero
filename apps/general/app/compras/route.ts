import { exigirModulo } from "@/lib/supabase/server";
import { servirHtmlModulo } from "@/lib/html-modulo";

export const dynamic = "force-dynamic";

/**
 * Compras (OCR de facturas y albaranes): la app de un solo HTML que vive en
 * compras-bonita.vercel.app, servida aquí detrás de la sesión de Hostelero
 * (módulo 'compras': dirección y administración). La app original no traía
 * login, así que esto AÑADE una puerta; la URL vieja sigue viva y sin cambios
 * para Lucía y Dakota — decisión de Luis (18-08-2026): Compras se queda con
 * sus datos separados e independientes, igual que PyG y Ratios, y el port de
 * verdad es decisión de noviembre.
 *
 * Las llamadas /api/compras/* las proxea el rewrite de next.config.mjs al
 * Vercel original, donde siguen la ANTHROPIC_API_KEY, el buzón IMAP y el
 * cron de ingesta de correo. Aquí no entra ninguna clave.
 */
export async function GET() {
  await exigirModulo("compras");
  return servirHtmlModulo("compras.html");
}
