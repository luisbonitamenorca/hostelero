import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/publico";
import { limitar, texto } from "../_comun";

export const dynamic = "force-dynamic";

/**
 * Comprueba el prescriptor del enlace (?p=<slug>) para enseñar «Recomendado por …» en el widget.
 * Solo devuelve el nombre: ni teléfono, ni email, ni comisión.
 */
export async function GET(req: Request) {
  const bloqueo = limitar(req, "prescriptor", 60);
  if (bloqueo) return bloqueo;
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const p = texto(new URL(req.url).searchParams.get("p"), 120).toLowerCase();
  if (!p || !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(p)) return NextResponse.json({ ok: false });

  const { data } = await sb.from("reservas_prescriptores").select("nombre, slug").eq("cuenta_id", CUENTA_PUBLICA).eq("activo", true).eq("slug", p).limit(1).maybeSingle();
  if (!data) return NextResponse.json({ ok: false });
  return NextResponse.json({ ok: true, nombre: data.nombre, slug: data.slug });
}
