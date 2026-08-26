/**
 * Envío de email transaccional vía Resend (decisión 26-08-2026: Resend para
 * transaccional Y campañas del CRM; los DNS de los dominios los gestiona
 * Infotelecom y solo añaden SPF/DKIM/DMARC).
 *
 * Sin SDK a propósito: es una llamada HTTP y una dependencia menos. La clave
 * vive en Vercel (RESEND_API_KEY); sin ella, enviarCorreo devuelve false y el
 * que llama sigue su vida — un email que no sale nunca debe romper un pago.
 * El remitente por defecto se puede cambiar con RESEND_REMITENTE.
 */
export async function enviarCorreo(destino: {
  para: string;
  asunto: string;
  html: string;
}): Promise<boolean> {
  const clave = process.env.RESEND_API_KEY;
  if (!clave) return false;
  const remitente = process.env.RESEND_REMITENTE || "Bodegas Binifadet <reservas@binifadet.com>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: remitente, to: [destino.para], subject: destino.asunto, html: destino.html }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
