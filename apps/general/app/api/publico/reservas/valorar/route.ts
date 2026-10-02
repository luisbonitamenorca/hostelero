import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { cuerpo, entero, esToken, limitar, texto } from "../_comun";

export const dynamic = "force-dynamic";

/**
 * Encuesta post-visita (RPC reservas_gestion_valorar). Cuatro bloques: comida, atención y entorno
 * (1-5) y NPS (0-10). La valoración global (1-5) que guarda la reserva es la media redondeada de
 * los tres bloques; el detalle completo va en `valoracion_detalle`. Si la nota es ≥ 4 el RPC
 * devuelve `url_resena` (Google) para invitar a dejar reseña.
 */
export async function POST(req: Request) {
  const bloqueo = limitar(req, "valorar", 10);
  if (bloqueo) return bloqueo;
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const b = await cuerpo(req);
  const token = b?.token;
  if (!esToken(token)) return NextResponse.json({ error: "NO_ENCONTRADA" });

  const comida = entero(b?.comida, 1, 5);
  const atencion = entero(b?.atencion, 1, 5);
  const entorno = entero(b?.entorno, 1, 5);
  const nps = b?.nps === null || b?.nps === undefined || b?.nps === "" ? null : entero(b?.nps, 0, 10);
  if (comida === null || atencion === null || entorno === null || (nps === null && b?.nps !== null && b?.nps !== undefined && b?.nps !== "")) {
    return NextResponse.json({ error: "VALORACION_INVALIDA" });
  }
  const comentario = texto(b?.comentario, 2000);
  const global = Math.max(1, Math.min(5, Math.round((comida + atencion + entorno) / 3)));

  const { data, error } = await sb.rpc("reservas_gestion_valorar", {
    p_token: token,
    p_valoracion: global,
    ...(comentario ? { p_comentario: comentario } : {}),
    p_detalle: { comida, atencion, entorno, ...(nps === null ? {} : { nps }) },
  });
  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });
  const j = (data ?? {}) as Record<string, unknown>;
  return NextResponse.json({ ...j, valoracion: global });
}
