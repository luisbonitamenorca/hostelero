import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { cuerpo, entero, esFecha, esHora, esToken, horaSql, limitar } from "../../_comun";

export const dynamic = "force-dynamic";

/**
 * Cambio de fecha / hora / comensales desde el enlace (RPC reservas_gestion_modificar).
 * El RPC recalcula disponibilidad de verdad (turno, cupos, antelación, regla de tarjeta, mesa).
 */
export async function POST(req: Request) {
  const bloqueo = limitar(req, "gestion-modificar", 20);
  if (bloqueo) return bloqueo;
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const b = await cuerpo(req);
  const token = b?.token;
  if (!esToken(token)) return NextResponse.json({ error: "NO_ENCONTRADA" });
  const fecha = b?.fecha;
  const hora = b?.hora;
  const pax = entero(b?.pax, 1, 200);
  if (!esFecha(fecha) || !esHora(hora) || pax === null) return NextResponse.json({ error: "datos" }, { status: 400 });

  const { data, error } = await sb.rpc("reservas_gestion_modificar", { p_token: token, p_fecha: fecha, p_hora: horaSql(hora), p_pax: pax });
  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });
  return NextResponse.json(data);
}
