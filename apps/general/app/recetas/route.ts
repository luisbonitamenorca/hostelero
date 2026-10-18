import { exigirModulo } from "@/lib/supabase/server";
import { servirHtmlModulo } from "@/lib/html-modulo";

export const dynamic = "force-dynamic";

/**
 * Módulo Recetas (18-10-2026): escandallos y food cost de los productos de
 * Ágora. App de un solo HTML servida con la sesión de la casa. Sus tablas
 * (rec_*) viven en este proyecto con RLS por cuenta; lee además el catálogo
 * de Compras (compras_producto), la clasificación de Ratios (productos_dijit,
 * familias, subfamilias, productos_agora) y los PVP de Ágora (vista
 * rec_agora_pvp sobre ingresos) con el token del usuario.
 */
export async function GET() {
  const { supabase, perfil, cuenta } = await exigirModulo("recetas");

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return servirHtmlModulo("recetas.html", {
    "__SUPABASE_URL__": process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    "__SUPABASE_ANON__": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    "__SB_TOKEN__": session?.access_token ?? "",
    "__CUENTA_ID__": cuenta.id,
    "__CUENTA_NOMBRE__": cuenta.nombre,
  }, { modulo: "Recetas", cuenta: cuenta.nombre, correo: perfil.correo });
}
