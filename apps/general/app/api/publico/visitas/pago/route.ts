import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/visitas-publico";
import { configTpv, firmarPeticion, nuevoPedido } from "@/lib/redsys";

export const dynamic = "force-dynamic";

const IDIOMA_TPV: Record<string, string> = { es: "1", en: "2", fr: "3" };

/**
 * Inicia el cobro de una reserva pendiente: crea el intento en visitas_pagos
 * y devuelve el formulario firmado para redirigir al TPV del banco. El
 * importe sale SIEMPRE de la reserva guardada, nunca del navegador. Se pide
 * código + email para que un código filtrado no baste para operar.
 */
export async function POST(req: Request) {
  const cfg = configTpv();
  if (!cfg) return NextResponse.json({ error: "tpv_no_configurado" }, { status: 503 });

  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const codigo = String(body?.codigo_reserva || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();
  const lang = String(body?.idioma || "es");
  if (!codigo || !email) return NextResponse.json({ error: "datos" }, { status: 400 });

  const { data: reserva } = await sb
    .from("visitas_reservas")
    .select("id, importe_total, estado, cliente_email, cliente_nombre")
    .eq("cuenta_id", CUENTA_PUBLICA)
    .eq("codigo_reserva", codigo)
    .maybeSingle();
  if (!reserva || reserva.cliente_email?.toLowerCase() !== email) {
    return NextResponse.json({ error: "no_encontrada" }, { status: 404 });
  }
  if (reserva.estado !== "pendiente_pago") {
    return NextResponse.json({ error: "no_pendiente" }, { status: 409 });
  }

  const importe = Number(reserva.importe_total || 0);
  const centimos = Math.round(importe * 100);
  if (!(centimos > 0)) return NextResponse.json({ error: "importe" }, { status: 409 });

  const pedido = nuevoPedido();
  const { error: errorPago } = await sb.from("visitas_pagos").insert({
    cuenta_id: CUENTA_PUBLICA,
    reserva_id: reserva.id,
    ds_order: pedido,
    importe,
  });
  if (errorPago) return NextResponse.json({ error: "no_iniciado" }, { status: 500 });

  // Base pública para las vueltas del banco: el host real de la petición
  // (en Vercel llega en x-forwarded-host), con https siempre.
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "hostelero-app.vercel.app";
  const base = `https://${host}`;

  const formulario = firmarPeticion(cfg, pedido, centimos, {
    DS_MERCHANT_MERCHANTURL: `${base}/api/publico/visitas/pago/notificacion`,
    DS_MERCHANT_URLOK: `${base}/reservar/pago-ok?codigo=${encodeURIComponent(codigo)}&lang=${lang}`,
    DS_MERCHANT_URLKO: `${base}/reservar/pago-ko?codigo=${encodeURIComponent(codigo)}&lang=${lang}`,
    DS_MERCHANT_PRODUCTDESCRIPTION: `Visita Binifadet ${codigo}`.slice(0, 125),
    DS_MERCHANT_TITULAR: (reserva.cliente_nombre || "").slice(0, 60),
    DS_MERCHANT_CONSUMERLANGUAGE: IDIOMA_TPV[lang] ?? "1",
  });

  return NextResponse.json({ url: cfg.url, campos: formulario });
}
