import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { cuerpo, esToken, limitar, texto } from "../../_comun";

export const dynamic = "force-dynamic";

/**
 * El cliente cancela desde el enlace (RPC reservas_gestion_cancelar). El RPC devuelve si fue
 * tardía y si procede cargo de garantía (`cargo_aplicable`, `importe`, `reserva_id`): el cobro
 * en sí lo ejecuta el servidor con la pieza de pagos (lib/redsys), no este handler.
 * Al cliente solo le devolvemos lo que necesita ver.
 */
export async function POST(req: Request) {
  const bloqueo = limitar(req, "gestion-cancelar", 10);
  if (bloqueo) return bloqueo;
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const b = await cuerpo(req);
  const token = b?.token;
  if (!esToken(token)) return NextResponse.json({ error: "NO_ENCONTRADA" });
  const motivo = texto(b?.motivo, 1000);

  const { data, error } = await sb.rpc("reservas_gestion_cancelar", { p_token: token, ...(motivo ? { p_motivo: motivo } : {}) });
  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });
  const j = (data ?? {}) as Record<string, unknown>;
  if (j.error) return NextResponse.json({ error: j.error, estado: j.estado });
  return NextResponse.json({
    ok: true,
    estado: j.estado,
    ya_cancelada: j.ya_cancelada === true,
    tardia: j.tardia === true,
    cargo_aplicable: j.cargo_aplicable === true,
    importe: j.cargo_aplicable === true ? j.importe : null,
  });
}
