import { exigirModulo } from "@/lib/supabase/server";
import { servirHtmlModulo } from "@/lib/html-modulo";

export const dynamic = "force-dynamic";

/**
 * PyG Pruebas (15-09-2026): mismo cuadro de mando que PyG Socios, con datos de
 * Contabilidad, Presupuesto y Compras en vez del Excel de A3. Corre en sombra
 * hasta fin de año y, si cuadra, sustituirá a PyG Socios.
 *
 */
export async function GET() {
  const { supabase, cuenta } = await exigirModulo("pyg_pruebas");

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return servirHtmlModulo("pyg-pruebas.html", {
    "__SUPABASE_URL__": process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    "__SUPABASE_ANON__": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    "__SB_TOKEN__": session?.access_token ?? "",
    "__CUENTA_ID__": cuenta.id,
  });
}
