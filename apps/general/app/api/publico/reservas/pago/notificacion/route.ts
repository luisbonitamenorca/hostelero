import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { configTpv, validarNotificacion } from "@/lib/redsys";
import { aplicarResultadoTpv } from "@/lib/pagos-reservas";

export const dynamic = "force-dynamic";
// Un cobro que llega tarde se devuelve en la misma llamada (REST al banco, hasta 25 s).
export const maxDuration = 60;

/**
 * Notificación servidor-a-servidor del TPV (DS_MERCHANT_MERCHANTURL): ESTA es la verdad del
 * pago; la pantalla de vuelta del cliente puede no llegar nunca. Llega como POST
 * form-urlencoded con Ds_MerchantParameters + Ds_Signature; sin firma válida no existe.
 * Idempotente por ds_order (los reintentos del banco sobre un pedido ya resuelto no pisan
 * nada) y siempre responde 200 para que el banco no reintente contra un error ya registrado.
 */
export async function POST(req: Request) {
  const cfg = configTpv();
  const sb = crearClienteServicio();
  if (!cfg || !sb) return new NextResponse("config", { status: 503 });

  const cuerpo = await req.formData().catch(() => null);
  const parametros = String(cuerpo?.get("Ds_MerchantParameters") || "");
  const firma = String(cuerpo?.get("Ds_Signature") || "");
  if (!parametros || !firma) return new NextResponse("datos", { status: 400 });

  const noti = validarNotificacion(cfg, parametros, firma);
  if (!noti) return new NextResponse("firma", { status: 400 });

  const res = await aplicarResultadoTpv(sb, noti, cfg);
  if (res === "desconocido") return new NextResponse("pedido", { status: 404 });
  return new NextResponse("OK");
}
