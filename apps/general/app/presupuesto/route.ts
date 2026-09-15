import { exigirModulo } from "@/lib/supabase/server";
import { servirHtmlModulo } from "@/lib/html-modulo";

export const dynamic = "force-dynamic";

/**
 * Módulo Presupuesto (15-09-2026): app de un solo HTML servida con la sesión
 * de la casa. Sus tablas (pre_*) viven en este mismo proyecto y se leen con
 * el token del usuario (RLS: authenticated).
 */
export async function GET() {
  const { supabase, cuenta } = await exigirModulo("presupuesto");

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return servirHtmlModulo("presupuesto.html", {
    "__SUPABASE_URL__": process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    "__SUPABASE_ANON__": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    "__SB_TOKEN__": session?.access_token ?? "",
    "__CUENTA_ID__": cuenta.id,
  });
}
