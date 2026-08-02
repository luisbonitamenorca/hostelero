import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";

export const dynamic = "force-dynamic";

/** Consulta una reserva por localizador + teléfono (RPC reservas_consultar). */
export async function GET(req: Request) {
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const p = new URL(req.url).searchParams;
  const loc = (p.get("localizador") || "").trim();
  const tel = (p.get("telefono") || "").trim();
  if (!loc || tel.replace(/\D/g, "").length < 9) {
    return NextResponse.json({ error: "datos" }, { status: 400 });
  }

  const { data, error } = await sb.rpc("reservas_consultar", {
    p_localizador: loc,
    p_telefono: tel,
  });
  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });
  return NextResponse.json(data);
}
