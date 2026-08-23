import { exigirModulo } from "@/lib/supabase/server";
import { servirHtmlModulo } from "@/lib/html-modulo";

export const dynamic = "force-dynamic";

/**
 * Compras (OCR de facturas y albaranes), PORTADO del todo al esqueleto
 * (24-08-2026): las 13 tablas compras_* y el bucket 'documentos' viven ya en
 * ESTA casa. Mismo patrón que Mantenimiento: URL, clave publicable y token de
 * sesión se inyectan al servir el HTML, y la RLS multi-tenant aplica.
 *
 * El proxy de Anthropic es local (pages/api/compras/anthropic.js). La única
 * pieza que sigue en el Vercel viejo es la ingesta de CORREO (IMAP): hasta
 * que Infotelecom entregue las claves, las facturas de correo se revisan en
 * la app antigua y se traerán con una pasada delta al cortar.
 */
export async function GET() {
  const { supabase, cuenta } = await exigirModulo("compras");

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return servirHtmlModulo("compras.html", {
    "__SUPABASE_URL__": process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    "__SUPABASE_ANON__": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    "__SB_TOKEN__": session?.access_token ?? "",
    "__CUENTA_ID__": cuenta.id,
  });
}
