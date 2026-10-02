import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { esToken, limitar } from "../_comun";

export const dynamic = "force-dynamic";

// Lista blanca de lo que ve el cliente. NUNCA los datos de la ficha CRM (reservas_clientes): el
// RPC los lee del cliente enganchado por teléfono, y cualquiera puede crear una reserva con el
// teléfono de otra persona y abrir su token. Lo que sale es solo de la propia reserva.
const CAMPOS = [
  "ok", "localizador", "token", "estado", "tipo", "estado_pago", "importe", "fecha", "fecha_iso", "hora", "duracion_min", "pax",
  "idioma", "notas_cliente", "alergias", "zona", "experiencia", "valoracion", "reconfirmada_en", "cancelada_en",
  "puede_confirmar", "puede_cancelar", "puede_modificar", "puede_pagar", "puede_valorar", "dentro_politica", "cargo_si_cancela", "mesas",
];
const CAMPOS_RESTAURANTE = [
  "slug", "nombre", "direccion", "telefono", "email", "url_condiciones", "color_marca", "logo_url", "mensaje", "politica_cancelacion_horas", "url_resena_google",
];

function elegir(o: Record<string, unknown>, campos: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of campos) if (k in o) out[k] = o[k];
  return out;
}

/**
 * Ficha pública de una reserva por token (RPC reservas_gestion): datos de la reserva, del
 * restaurante y permisos (puede_confirmar, …). Token inválido → {error: NO_ENCONTRADA} sin
 * distinguir «no existe» de «mal formado».
 */
export async function GET(req: Request) {
  const bloqueo = limitar(req, "gestion", 60);
  if (bloqueo) return bloqueo;
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const token = new URL(req.url).searchParams.get("token") || "";
  if (!esToken(token)) return NextResponse.json({ error: "NO_ENCONTRADA" });

  const { data, error } = await sb.rpc("reservas_gestion", { p_token: token });
  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });
  const j = (data ?? {}) as Record<string, unknown>;
  if (j.error) return NextResponse.json({ error: j.error });
  const rest = j.restaurante && typeof j.restaurante === "object" ? (j.restaurante as Record<string, unknown>) : {};
  return NextResponse.json({
    ...elegir(j, CAMPOS),
    restaurante: elegir(rest, CAMPOS_RESTAURANTE),
    ics: `/api/publico/reservas/gestion/calendario?token=${token}`,
  });
}
