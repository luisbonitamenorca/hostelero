import { readFile } from "node:fs/promises";
import path from "node:path";
import { exigirModulo } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Mantenimiento, PORTADO del todo al esqueleto (18-08-2026): el panel de
 * Marcos (estados, asignaciones, PDF) sobre la tabla mant_partes de ESTA
 * casa — a diferencia de Compras/PyG/Ratios, aquí los datos se mudaron.
 *
 * El HTML lleva cuatro marcadores que se rellenan al servirlo: URL y clave
 * publicable del proyecto, el TOKEN DE SESIÓN del usuario y su cuenta. Así
 * la página estática habla con PostgREST como authenticated y la RLS
 * multi-tenant aplica de verdad. El token caduca (~1 h): el propio HTML se
 * recarga al primer 401 y aquí se inyecta uno fresco.
 */
export async function GET() {
  const { supabase, cuenta } = await exigirModulo("mantenimiento");

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const plantilla = await readFile(path.join(process.cwd(), "datos", "mantenimiento.html"), "utf8");
  const html = plantilla
    .replace("__SUPABASE_URL__", process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .replace("__SUPABASE_ANON__", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "")
    .replace("__SB_TOKEN__", session?.access_token ?? "")
    .replace("__CUENTA_ID__", cuenta.id);

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Lleva un token de sesión dentro: jamás se cachea, ni compartido ni local.
      "cache-control": "private, no-store",
    },
  });
}
