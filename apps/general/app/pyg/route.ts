import { exigirModulo } from "@/lib/supabase/server";
import { servirHtmlModulo } from "@/lib/html-modulo";

export const dynamic = "force-dynamic";

/**
 * PyG Socios, PORTADO al esqueleto (24-08-2026): su Excel (datos.xlsx) vive
 * en el bucket privado 'pyg' de ESTA casa y se lee/escribe con el token de
 * sesión del usuario (política de storage: solo authenticated). La app vieja
 * de PyG queda repuntada, no apagada, hasta verificar.
 */
export async function GET() {
  const { supabase, cuenta } = await exigirModulo("pyg");

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return servirHtmlModulo("pyg.html", {
    "__SUPABASE_URL__": process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    "__SUPABASE_ANON__": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    "__SB_TOKEN__": session?.access_token ?? "",
    "__CUENTA_ID__": cuenta.id,
  });
}
