import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";

export const dynamic = "force-dynamic";

/** Cancela una reserva por localizador + teléfono (RPC reservas_cancelar). */
export async function POST(req: Request) {
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const loc = String(body?.localizador || "").trim();
  const tel = String(body?.telefono || "").trim();
  if (!loc || tel.replace(/\D/g, "").length < 9) {
    return NextResponse.json({ error: "datos" }, { status: 400 });
  }

  const { data, error } = await sb.rpc("reservas_cancelar", {
    p_localizador: loc,
    p_telefono: tel,
  });
  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });
  return NextResponse.json(data);
}
