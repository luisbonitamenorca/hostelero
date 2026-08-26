import { NextResponse } from "next/server";
import type { Database } from "@hostelero/db";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/visitas-publico";
import { registrarConsentimientoPublico } from "@/lib/crm-publico";

export const dynamic = "force-dynamic";

type Idioma = Database["public"]["Enums"]["visitas_idioma"];

/**
 * Crea una reserva online (método tpv → queda pendiente_pago; el cobro llega
 * justo después por el TPV Virtual de CaixaBank, ver /api/publico/visitas/pago).
 * El importe se calcula en el servidor a partir del precio real del producto:
 * nunca se confía en un importe enviado por el cliente.
 */
export async function POST(req: Request) {
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "datos" }, { status: 400 });

  const sesionId = String(body.sesion_id || "");
  const nombre = String(body.nombre || "").trim();
  const email = String(body.email || "").trim();
  const telefono = String(body.telefono || "").trim() || null;
  const pais = String(body.pais || "").trim() || null;
  const personas = parseInt(String(body.personas), 10);
  const lang: Idioma | null = ["es", "en", "fr"].includes(body.idioma) ? body.idioma : null;

  if (!sesionId || !nombre || !/.+@.+\..+/.test(email) || !(personas >= 1)) {
    return NextResponse.json({ error: "datos" }, { status: 400 });
  }

  // La sesión debe ser reservable públicamente (misma cuenta, activa, visible, futura).
  const { data: s } = await sb
    .from("visitas_sesiones")
    .select("id, visitas_productos(precio)")
    .eq("id", sesionId)
    .eq("cuenta_id", CUENTA_PUBLICA)
    .eq("estado", "activa")
    .eq("visible_web", true)
    .gte("fecha", new Date().toISOString().slice(0, 10))
    .maybeSingle();
  if (!s) return NextResponse.json({ error: "no_disponible" }, { status: 404 });

  const precio = Number(s.visitas_productos?.precio || 0);

  // Reconfirmar plazas antes de crear (el propio RPC tiene bloqueo anti-carrera).
  const { data: plazas } = await sb.rpc("visitas_plazas_disponibles", { p_sesion_id: sesionId });
  if (Number(plazas ?? 0) < personas) {
    return NextResponse.json({ error: "sin_plazas" }, { status: 409 });
  }

  const { data, error } = await sb.rpc("visitas_crear_reserva", {
    p_sesion_id: sesionId,
    p_cliente_nombre: nombre,
    p_cliente_email: email,
    p_cliente_telefono: telefono as unknown as string,
    p_cliente_pais: pais as unknown as string,
    p_idioma_preferido: (lang ?? null) as unknown as Idioma,
    p_num_personas: personas,
    p_importe_total: personas * precio,
    p_metodo_pago: "tpv",
  });
  if (error) return NextResponse.json({ error: "no_creada" }, { status: 409 });

  // Casilla de marketing (T2 CRM): solo si la marcó, y sin romper la reserva.
  if (body.marketing === true) {
    await registrarConsentimientoPublico(sb, { nombre, email, telefono, front: "front_visitas" });
  }

  const r = data as unknown as { codigo_reserva?: string } | null;
  return NextResponse.json({ codigo_reserva: r?.codigo_reserva ?? null });
}
