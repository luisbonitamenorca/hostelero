import { readFile } from "node:fs/promises";
import path from "node:path";
import { exigirModulo } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Mantenimiento: la app de un solo HTML (mantenimiento-bonita.vercel.app)
 * servida detrás de la sesión de Hostelero, patrón de la casa. Es la mitad
 * «gestionar» — el panel de Marcos, con estados, asignaciones y PDF —; la
 * mitad «pedir» vive en /parte, un front público instalable en el móvil que
 * escribe en la misma tabla. La app original no traía login (URL abierta):
 * esto AÑADE una puerta, y su URL vieja sigue viva mientras convenga.
 */
export async function GET() {
  await exigirModulo("mantenimiento");
  const html = await readFile(path.join(process.cwd(), "datos", "mantenimiento.html"), "utf8");
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // La sesión decide quién entra: esta página nunca se cachea compartida.
      "cache-control": "private, no-store",
    },
  });
}
