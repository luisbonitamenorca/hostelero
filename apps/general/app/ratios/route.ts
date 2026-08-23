import { exigirModulo } from "@/lib/supabase/server";
import { servirHtmlModulo } from "@/lib/html-modulo";

export const dynamic = "force-dynamic";

/**
 * Ratios Food Cost, PORTADO del todo al esqueleto (24-08-2026): sus 25 tablas
 * viven ya en ESTA casa (nombres tal cual, RLS de sesión) y las compras le
 * llegan EN VIVO desde el módulo Compras a través de la vista SQL 'gastos'
 * (histórico Dijit + líneas de albaranes desde el corte del 1 de agosto).
 * Primera conexión real entre módulos del esqueleto.
 *
 * URL, clave publicable y token de sesión se inyectan al servir el HTML,
 * mismo patrón que Mantenimiento y Compras.
 */
export async function GET() {
  const { supabase, cuenta } = await exigirModulo("ratios");

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return servirHtmlModulo("ratios.html", {
    "__SUPABASE_URL__": process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    "__SUPABASE_ANON__": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    "__SB_TOKEN__": session?.access_token ?? "",
    "__CUENTA_ID__": cuenta.id,
  });
}
