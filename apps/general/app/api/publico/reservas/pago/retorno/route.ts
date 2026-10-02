import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { configTpv, validarNotificacion } from "@/lib/redsys";
import { aplicarResultadoTpv, tokenValido } from "@/lib/pagos-reservas";

export const dynamic = "force-dynamic";
// Un cobro que llega tarde se devuelve en la misma llamada (REST al banco, hasta 25 s).
export const maxDuration = 60;

/**
 * Vuelta del cliente desde el TPV (DS_MERCHANT_URLOK / URLKO). Redsys puede traerlo por GET
 * o por POST y, si el comercio tiene activado «parámetros en las URLs», con los mismos
 * Ds_MerchantParameters + Ds_Signature de la notificación. Si vienen y la firma casa, se
 * aplican (idempotente: si la notificación ya llegó, no cambia nada). En cualquier caso se
 * redirige a la página pública /reserva/<token>/pago?resultado=ok|ko, que pinta el estado
 * real leído de la base.
 */
async function procesar(req: Request, campos: URLSearchParams | FormData | null) {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") || "").toLowerCase();
  const r = url.searchParams.get("r") === "ok" ? "ok" : "ko";

  const cfg = configTpv();
  const sb = crearClienteServicio();
  const parametros = String(campos?.get("Ds_MerchantParameters") || url.searchParams.get("Ds_MerchantParameters") || "");
  const firma = String(campos?.get("Ds_Signature") || url.searchParams.get("Ds_Signature") || "");
  if (cfg && sb && parametros && firma) {
    const noti = validarNotificacion(cfg, parametros, firma);
    if (noti) await aplicarResultadoTpv(sb, noti, cfg);
  }

  const destino = tokenValido(token) ? `/reserva/${token}/pago?resultado=${r}` : "/reservar-mesa";
  return NextResponse.redirect(new URL(destino, `${url.protocol}//${req.headers.get("x-forwarded-host") || url.host}`), 303);
}

export async function GET(req: Request) {
  return procesar(req, null);
}

export async function POST(req: Request) {
  const cuerpo = await req.formData().catch(() => null);
  return procesar(req, cuerpo);
}
