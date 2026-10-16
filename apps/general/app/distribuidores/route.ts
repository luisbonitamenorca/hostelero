import { exigirModulo } from "@/lib/supabase/server";
import { servirHtmlModulo } from "@/lib/html-modulo";

export const dynamic = "force-dynamic";

/**
 * Módulo Distribuidores (16-10-2026): herramienta de presupuestos para quien
 * vende Jano. App de un solo HTML servida con la sesión de la casa; sus
 * tablas (dist_*) viven en este proyecto y se leen con el token del usuario
 * (RLS por cuenta). Apartado «Soporte» de la portada.
 */
export async function GET() {
  const { supabase, perfil, cuenta } = await exigirModulo("distribuidores");

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return servirHtmlModulo("distribuidores.html", {
    "__SUPABASE_URL__": process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    "__SUPABASE_ANON__": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    "__SB_TOKEN__": session?.access_token ?? "",
    "__CUENTA_ID__": cuenta.id,
    "__CUENTA_NOMBRE__": cuenta.nombre,
  }, { modulo: "Distribuidores", cuenta: cuenta.nombre, correo: perfil.correo });
}
