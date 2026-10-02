import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { aplicarEventoProveedor, clienteServicioMensajeria } from "@/lib/mensajeria";

export const dynamic = "force-dynamic";

/**
 * Webhook de Resend (eventos de email). Se da de alta en Resend → Webhooks con la URL
 * https://<app>/api/publico/reservas/webhooks/resend y los eventos sent, delivered, opened,
 * clicked, bounced, complained. Resend firma con Svix: cabeceras svix-id, svix-timestamp y
 * svix-signature, secreto `whsec_…` (env RESEND_WEBHOOK_SECRET). Con el secreto puesto se exige
 * la firma; sin él, en producción se contesta 503 sin procesar nada (en preview/local se acepta,
 * para pruebas).
 *
 * Un evento se aplica a la fila de reservas_mensajes con proveedor='resend' y
 * proveedor_id = data.email_id. Siempre 200 (Resend reintenta los no-200).
 */
export async function POST(req: Request) {
  const cuerpo = await req.text();
  const secreto = process.env.RESEND_WEBHOOK_SECRET;
  if (!secreto && process.env.VERCEL_ENV === "production") {
    console.error("[webhook resend] RESEND_WEBHOOK_SECRET sin definir: eventos ignorados");
    return NextResponse.json({ error: "config_pendiente" }, { status: 503 });
  }
  if (secreto && !firmaSvixValida(req, cuerpo, secreto)) {
    return NextResponse.json({ error: "firma" }, { status: 401 });
  }

  let ev: { type?: string; data?: { email_id?: string; bounce?: { message?: string }; [k: string]: unknown } } | null = null;
  try {
    ev = JSON.parse(cuerpo);
  } catch {
    return NextResponse.json({ error: "json" }, { status: 400 });
  }
  const tipo = ev?.type || "";
  const emailId = ev?.data?.email_id;
  if (!tipo || !emailId) return NextResponse.json({ ok: true });

  const sb = clienteServicioMensajeria();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const detalle = tipo === "email.bounced" ? ev?.data?.bounce?.message || null : null;
  await aplicarEventoProveedor(sb, "resend", emailId, tipo, detalle ? `Rebotado: ${detalle}` : null);
  // Siempre 200 y sin datos internos: una fila que no encontramos (email de otro módulo) no es
  // motivo de reintento, y a Resend le basta con el 200.
  return NextResponse.json({ ok: true });
}

/** Firma Svix: HMAC-SHA256(secreto base64, `${id}.${ts}.${cuerpo}`) en base64; tolerancia 5 min. */
function firmaSvixValida(req: Request, cuerpo: string, secreto: string): boolean {
  const id = req.headers.get("svix-id") || "";
  const ts = req.headers.get("svix-timestamp") || "";
  const firmas = req.headers.get("svix-signature") || "";
  if (!id || !ts || !firmas) return false;
  const edad = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(edad) || edad > 300) return false;
  let clave: Buffer;
  try {
    clave = Buffer.from(secreto.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }
  const esperada = createHmac("sha256", clave).update(`${id}.${ts}.${cuerpo}`).digest();
  // La cabecera puede traer varias firmas «v1,<base64>» separadas por espacio.
  for (const parte of firmas.split(" ")) {
    const [ver, b64] = parte.split(",");
    if (ver !== "v1" || !b64) continue;
    const recibida = Buffer.from(b64, "base64");
    if (recibida.length === esperada.length && timingSafeEqual(recibida, esperada)) return true;
  }
  return false;
}
