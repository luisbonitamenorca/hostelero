import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";

export const dynamic = "force-dynamic";

/** Crea una reserva online (RPC reservas_crear_online; valida y asigna mesa dentro). */
export async function POST(req: Request) {
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "datos" }, { status: 400 });

  const slug = String(body.slug || "");
  const fecha = String(body.fecha || "");
  const hora = String(body.hora || "");
  const pax = parseInt(String(body.pax), 10);
  const nombre = String(body.nombre || "").trim();
  const telefono = String(body.telefono || "").trim();
  const email = String(body.email || "").trim();
  const notas = String(body.notas || "").trim();

  if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}(:\d{2})?$/.test(hora) || !(pax >= 1) || !nombre) {
    return NextResponse.json({ error: "datos" }, { status: 400 });
  }

  const { data, error } = await sb.rpc("reservas_crear_online", {
    p_slug: slug,
    p_fecha: fecha,
    p_hora: hora.length === 5 ? hora + ":00" : hora,
    p_pax: pax,
    p_nombre: nombre,
    p_telefono: telefono,
    p_email: email,
    p_notas: notas,
  });
  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });
  return NextResponse.json(data);
}
