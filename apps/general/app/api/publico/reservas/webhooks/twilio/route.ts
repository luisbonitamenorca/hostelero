import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { aplicarEventoProveedor, clienteServicioMensajeria, reenviarRespuestaEntrante } from "@/lib/mensajeria";

export const dynamic = "force-dynamic";

/**
 * Webhook de Twilio (SMS y WhatsApp). Atiende dos cosas en la misma URL
 * (`${MENSAJERIA_URL_PUBLICA}/api/publico/reservas/webhooks/twilio`):
 *  - Status callback de lo que enviamos: MessageSid, MessageStatus (queued, sent, delivered,
 *    read, failed, undelivered…), ErrorCode, ErrorMessage → estado del mensaje.
 *  - Mensaje ENTRANTE (el cliente contesta): SmsStatus=received, From, Body, NumMedia. Se reenvía
 *    por email a la dirección de respuesta del restaurante (lib/mensajeria → reenviarRespuestaEntrante).
 *    Para recibirlos hay que poner esta URL como «incoming messages webhook» en el WhatsApp sender
 *    y en el Messaging Service / número de SMS (ver docs/reservas-v2-mensajeria.md §5).
 * Firma: X-Twilio-Signature = base64(HMAC-SHA1(auth token, URL + parámetros ordenados)). Con
 * TWILIO_AUTH_TOKEN en el entorno se exige la firma.
 *
 * Responde 204 a los status callbacks y un TwiML vacío a los entrantes (no contestamos al cliente).
 */
export async function POST(req: Request) {
  const texto = await req.text();
  const params = new URLSearchParams(texto);
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (token && !firmaTwilioValida(req, params, token)) {
    return NextResponse.json({ error: "firma" }, { status: 401 });
  }
  const sid = params.get("MessageSid") || params.get("SmsSid") || "";
  const estado = (params.get("MessageStatus") || params.get("SmsStatus") || "").toLowerCase();
  if (!sid || !estado) return new NextResponse(null, { status: 204 });

  const sb = clienteServicioMensajeria();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  // Mensaje entrante: el cliente nos ha escrito.
  if (estado === "received" || estado === "inbound") {
    const de = params.get("From") || "";
    try {
      const r = await reenviarRespuestaEntrante(sb, {
        sid,
        de,
        cuerpo: params.get("Body") || "",
        canal: de.toLowerCase().startsWith("whatsapp:") ? "whatsapp" : "sms",
        adjuntos: Number(params.get("NumMedia") || 0) || 0,
      });
      if (!r.ok) console.warn("[webhook twilio] respuesta de cliente sin reenviar:", r.motivo);
    } catch (e) {
      // 500: Twilio reintenta (el reenvío es idempotente por MessageSid).
      console.error("[webhook twilio] error al reenviar la respuesta del cliente:", (e as Error).message);
      return NextResponse.json({ error: "reenvio" }, { status: 500 });
    }
    return new NextResponse("<Response></Response>", { status: 200, headers: { "Content-Type": "text/xml" } });
  }

  const codigo = params.get("ErrorCode");
  const detalle = estado === "failed" || estado === "undelivered" ? `Twilio ${codigo || ""} ${params.get("ErrorMessage") || estado}`.replace(/\s+/g, " ").trim() : null;
  await aplicarEventoProveedor(sb, "twilio", sid, estado, detalle);
  return new NextResponse(null, { status: 204 });
}

/** URL exacta contra la que Twilio firma: la que le dimos como StatusCallback / webhook de entrada. */
function urlFirmada(req: Request): string {
  const base = (process.env.MENSAJERIA_URL_PUBLICA || "").trim().replace(/\/+$/, "");
  if (base) return `${base}/api/publico/reservas/webhooks/twilio`;
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || u.host;
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}${u.pathname}${u.search}`;
}

function firmaTwilioValida(req: Request, params: URLSearchParams, token: string): boolean {
  const recibida = req.headers.get("x-twilio-signature") || "";
  if (!recibida) return false;
  const claves = [...new Set([...params.keys()])].sort();
  let datos = urlFirmada(req);
  for (const k of claves) for (const v of params.getAll(k)) datos += k + v;
  const esperada = createHmac("sha1", token).update(datos).digest("base64");
  const a = Buffer.from(esperada);
  const b = Buffer.from(recibida);
  return a.length === b.length && timingSafeEqual(a, b);
}
