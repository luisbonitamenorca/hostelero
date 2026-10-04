/**
 * Envío de email transaccional vía Resend (decisión 26-08-2026: Resend para
 * transaccional Y campañas del CRM; los DNS de los dominios los gestiona
 * Infotelecom y solo añaden SPF/DKIM/DMARC).
 *
 * Sin SDK a propósito: es una llamada HTTP y una dependencia menos. La clave
 * vive en Vercel (RESEND_API_KEY); sin ella, enviarCorreo devuelve false y el
 * que llama sigue su vida — un email que no sale nunca debe romper un pago.
 * El remitente por defecto se puede cambiar con RESEND_REMITENTE.
 *
 * Ampliación 04-10-2026 (Pedidos), compatible con lo que ya había: `para` puede
 * ser una lista, y opcionales `texto` (versión en texto plano), `responderA`
 * (reply_to: las respuestas del proveedor van a quien hizo el pedido) y
 * `remitente` (si no viene, RESEND_REMITENTE o el de siempre).
 */
export async function enviarCorreo(destino: {
  para: string | string[];
  asunto: string;
  html: string;
  /** Versión en texto plano (campo "text" de Resend). */
  texto?: string;
  /** Dirección a la que se responde (campo "reply_to" de Resend). */
  responderA?: string | null;
  /** Remitente («Nombre <direccion@dominio>»); si no viene, RESEND_REMITENTE o el de siempre. */
  remitente?: string | null;
}): Promise<boolean> {
  const clave = process.env.RESEND_API_KEY;
  if (!clave) return false;
  const remitente =
    destino.remitente?.trim() || process.env.RESEND_REMITENTE || "Bodegas Binifadet <reservas@binifadet.com>";
  const para = (Array.isArray(destino.para) ? destino.para : [destino.para]).map((x) => x.trim()).filter(Boolean);
  if (!para.length) return false;
  const cuerpo: Record<string, unknown> = { from: remitente, to: para, subject: destino.asunto, html: destino.html };
  if (destino.texto) cuerpo.text = destino.texto;
  const responderA = destino.responderA?.trim();
  if (responderA) cuerpo.reply_to = responderA;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    return r.ok;
  } catch {
    return false;
  }
}
