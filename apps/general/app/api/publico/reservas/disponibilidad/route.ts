import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";

export const dynamic = "force-dynamic";

/** Horas disponibles de un restaurante para fecha+pax (RPC reservas_disponibilidad). */
export async function GET(req: Request) {
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const p = new URL(req.url).searchParams;
  const slug = p.get("slug") || "";
  const fecha = p.get("fecha") || "";
  const pax = parseInt(p.get("pax") || "", 10);
  if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !(pax >= 1)) {
    return NextResponse.json({ error: "datos" }, { status: 400 });
  }

  const { data, error } = await sb.rpc("reservas_disponibilidad", {
    p_slug: slug,
    p_fecha: fecha,
    p_pax: pax,
  });
  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });
  return NextResponse.json(data);
}
