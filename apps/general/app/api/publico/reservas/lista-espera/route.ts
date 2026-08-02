import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";

export const dynamic = "force-dynamic";

/** Apunta a la lista de espera de un día (RPC reservas_apuntar_lista_espera). */
export async function POST(req: Request) {
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "datos" }, { status: 400 });

  const slug = String(body.slug || "");
  const fecha = String(body.fecha || "");
  const nombre = String(body.nombre || "").trim();
  const telefono = String(body.telefono || "").trim();
  const pax = parseInt(String(body.pax), 10);
  const notas = String(body.notas || "").trim();

  if (!slug || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !nombre || telefono.replace(/\D/g, "").length < 9 || !(pax >= 1)) {
    return NextResponse.json({ error: "datos" }, { status: 400 });
  }

  const { data, error } = await sb.rpc("reservas_apuntar_lista_espera", {
    p_slug: slug,
    p_fecha: fecha,
    p_nombre: nombre,
    p_telefono: telefono,
    p_pax: pax,
    p_notas: notas,
  });
  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });
  return NextResponse.json(data);
}
