import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { cuerpo, esEmail, esToken, limitar, texto } from "../../_comun";

export const dynamic = "force-dynamic";

// Solo se invita a reservas vivas (no canceladas, no pendientes de tarjeta) y de hoy en adelante.
const ESTADOS_INVITABLES = ["pendiente", "confirmada", "reconfirmada", "a_revisar"];

/**
 * «Invita a tus acompañantes» (plan §5): POST {token, emails[], mensaje?}. Encola un email
 * 'invitacion' por destinatario con reservas_mensaje_encolar (plantilla es/en de la base; el
 * cron lo envía por Resend). Frenos contra el uso como buzón de spam: como mucho pax − 1
 * invitaciones por reserva en total, 5 envíos por IP cada 10 minutos, mensaje corto y sin enlaces.
 */
export async function POST(req: Request) {
  const bloqueo = limitar(req, "gestion-invitar", 5, 10 * 60_000);
  if (bloqueo) return bloqueo;
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const b = await cuerpo(req);
  const token = b?.token;
  if (!esToken(token)) return NextResponse.json({ error: "NO_ENCONTRADA" });
  if (!Array.isArray(b?.emails)) return NextResponse.json({ error: "datos" }, { status: 400 });
  const emails = [...new Set((b.emails as unknown[]).map((e) => texto(e, 254).toLowerCase()).filter(Boolean))];
  if (!emails.length || emails.length > 20) return NextResponse.json({ error: "datos" }, { status: 400 });
  if (emails.some((e) => !esEmail(e))) return NextResponse.json({ error: "EMAIL_INVALIDO" });
  // Mensaje del cliente: texto plano, sin enlaces ni marcas (va dentro de un email de la casa).
  const mensaje = texto(b?.mensaje, 300)
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bwww\.\S+/gi, "")
    .replace(/[<>]/g, "")
    .trim();

  const { data: r } = await sb.from("reservas_reservas").select("id, pax, estado, fecha").eq("token", token).maybeSingle();
  if (!r) return NextResponse.json({ error: "NO_ENCONTRADA" });
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  if (!ESTADOS_INVITABLES.includes(r.estado) || r.fecha < hoy || r.pax < 2) return NextResponse.json({ error: "NO_INVITABLE" });

  const { count } = await sb.from("reservas_mensajes").select("id", { count: "exact", head: true }).eq("reserva_id", r.id).eq("tipo", "invitacion");
  const quedan = r.pax - 1 - (count ?? 0);
  if (quedan <= 0) return NextResponse.json({ error: "LIMITE_INVITACIONES" });
  const destinatarios = emails.slice(0, quedan);

  let enviados = 0;
  for (const email of destinatarios) {
    const { data, error } = await sb.rpc("reservas_mensaje_encolar", {
      p_reserva_id: r.id,
      p_tipo: "invitacion",
      p_mensaje_extra: mensaje,
      p_destinatario_email: email,
    });
    if (!error && typeof data === "number") enviados += data;
  }
  if (!enviados) return NextResponse.json({ error: "SIN_ENVIO" });
  return NextResponse.json({ ok: true, enviados, quedan: Math.max(0, quedan - enviados) });
}
