import { enviarCorreo } from "./correo";

type DatosConfirmacion = {
  para: string;
  nombre: string;
  codigo: string;
  producto: string;
  fecha: string; // AAAA-MM-DD
  hora: string;
  personas: number;
  importe: number;
  idioma: "es" | "en" | "fr";
};

const TXT = {
  es: {
    asunto: (c: string) => `Tu visita a Binifadet está confirmada · ${c}`,
    hola: (n: string) => `Hola ${n},`,
    intro: "¡Pago recibido! Tu visita está confirmada. Estos son los datos:",
    codigo: "Código de reserva",
    experiencia: "Experiencia",
    fecha: "Fecha",
    hora: "Hora",
    personas: "Personas",
    importe: "Importe pagado",
    pie: "Presenta este código a tu llegada. Si necesitas cambiar o cancelar tu visita, responde a este correo. ¡Te esperamos en la bodega!",
  },
  en: {
    asunto: (c: string) => `Your Binifadet visit is confirmed · ${c}`,
    hola: (n: string) => `Hi ${n},`,
    intro: "Payment received! Your visit is confirmed. Here are the details:",
    codigo: "Booking code",
    experiencia: "Experience",
    fecha: "Date",
    hora: "Time",
    personas: "People",
    importe: "Amount paid",
    pie: "Show this code on arrival. To change or cancel your visit, just reply to this email. See you at the winery!",
  },
  fr: {
    asunto: (c: string) => `Votre visite chez Binifadet est confirmée · ${c}`,
    hola: (n: string) => `Bonjour ${n},`,
    intro: "Paiement reçu ! Votre visite est confirmée. Voici les détails :",
    codigo: "Code de réservation",
    experiencia: "Expérience",
    fecha: "Date",
    hora: "Heure",
    personas: "Personnes",
    importe: "Montant payé",
    pie: "Présentez ce code à votre arrivée. Pour modifier ou annuler votre visite, répondez à cet email. À bientôt au domaine !",
  },
} as const;

const LOCALE = { es: "es-ES", en: "en-GB", fr: "fr-FR" } as const;

const escapa = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Email de confirmación tras el pago. Se llama desde la notificación del TPV:
 * si el envío falla (o Resend aún no está configurado), el pago sigue siendo
 * pago — por eso devuelve boolean y jamás lanza.
 */
export async function correoConfirmacionVisita(d: DatosConfirmacion): Promise<boolean> {
  const t = TXT[d.idioma] ?? TXT.es;
  const fechaLarga = new Intl.DateTimeFormat(LOCALE[d.idioma] ?? "es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(d.fecha + "T00:00:00"));
  const euros = d.importe.toLocaleString(LOCALE[d.idioma] ?? "es-ES", {
    style: "currency",
    currency: "EUR",
  });

  const fila = (k: string, v: string, negrita = false) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#5F6B65;">${k}</td><td style="padding:6px 0;${negrita ? "font-weight:700;" : ""}">${v}</td></tr>`;

  const html = `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1E2A25;">
    <h1 style="font-size:20px;margin:0 0 4px;">Bodegas Binifadet</h1>
    <p style="margin:16px 0 6px;">${escapa(t.hola(d.nombre))}</p>
    <p style="margin:0 0 18px;">${t.intro}</p>
    <table style="border-collapse:collapse;font-size:15px;">
      ${fila(t.codigo, `<span style="letter-spacing:1px;">${escapa(d.codigo)}</span>`, true)}
      ${fila(t.experiencia, escapa(d.producto))}
      ${fila(t.fecha, fechaLarga)}
      ${fila(t.hora, escapa(d.hora))}
      ${fila(t.personas, String(d.personas))}
      ${fila(t.importe, euros, true)}
    </table>
    <p style="margin:20px 0 0;color:#5F6B65;font-size:14px;">${t.pie}</p>
  </div>`;

  return enviarCorreo({ para: d.para, asunto: t.asunto(d.codigo), html });
}
