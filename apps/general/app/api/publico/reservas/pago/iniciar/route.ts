import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { configTpv } from "@/lib/redsys";
import { baseUrlDe, iniciarPagoReserva, tokenValido } from "@/lib/pagos-reservas";

export const dynamic = "force-dynamic";

/**
 * Inicia el pago / la garantía de una reserva en «tarjeta_pendiente» y devuelve el
 * formulario firmado para redirigir al TPV del banco. El token público de gestión es la
 * única credencial (lo recibe el cliente en su email/SMS); importe y tipo salen de la
 * reserva guardada. Errores: no_encontrada · no_pendiente · caducada · sin_importe.
 */
export async function POST(req: Request) {
  const cfg = configTpv();
  if (!cfg) return NextResponse.json({ error: "tpv_no_configurado" }, { status: 503 });
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const token = String(body?.token || "").trim().toLowerCase();
  const idioma = String(body?.idioma || "es").slice(0, 2);
  if (!tokenValido(token)) return NextResponse.json({ error: "datos" }, { status: 400 });

  const res = await iniciarPagoReserva(sb, cfg, { token, base: baseUrlDe(req), idioma });
  if (!res.ok) {
    const estado = res.error === "no_encontrada" ? 404 : res.error === "no_iniciado" ? 500 : 409;
    return NextResponse.json({ error: res.error }, { status: estado });
  }
  return NextResponse.json(res.data);
}
