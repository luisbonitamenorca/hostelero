import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { cuerpo, esToken, limitar } from "../../_comun";

export const dynamic = "force-dynamic";

/** El cliente reconfirma su reserva desde el enlace (RPC reservas_gestion_confirmar). */
export async function POST(req: Request) {
  const bloqueo = limitar(req, "gestion-confirmar", 20);
  if (bloqueo) return bloqueo;
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const b = await cuerpo(req);
  const token = b?.token;
  if (!esToken(token)) return NextResponse.json({ error: "NO_ENCONTRADA" });

  const { data, error } = await sb.rpc("reservas_gestion_confirmar", { p_token: token });
  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });
  return NextResponse.json(data);
}
