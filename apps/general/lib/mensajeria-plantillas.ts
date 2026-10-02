/**
 * Mensajería de Reservas · parte PURA (sin Supabase, sin env): variables de una reserva,
 * renderizado de plantillas, HTML de marca para el email y el .ics adjunto.
 *
 * Lo usan el motor de envío (lib/mensajeria.ts), el cron y las acciones del panel
 * (previsualizar). El renderizado replica a propósito `reservas_renderizar` de la base:
 * {{clave}} → valor; los placeholders sin valor desaparecen.
 */
import type { Tables } from "@hostelero/db";

export type RestauranteMsg = Tables<"reservas_restaurantes">;
export type ReservaMsg = Tables<"reservas_reservas">;
export type ClienteMsg = Tables<"reservas_clientes">;
export type MensajeMsg = Tables<"reservas_mensajes">;

export type Idioma = "es" | "en" | "ca" | "fr" | "de";

/** URL pública base del restaurante (misma regla que reservas_url_base en SQL). */
export const URL_BASE_DEFECTO = "https://hostelero-app.vercel.app";
export function urlBase(rest: Pick<RestauranteMsg, "url_base">): string {
  const u = (rest.url_base || "").trim();
  return (u || URL_BASE_DEFECTO).replace(/\/+$/, "");
}

/** Sustituye {{clave}} por su valor; los placeholders sin valor desaparecen. */
export function renderizar(texto: string | null | undefined, vars: Record<string, string>): string {
  let v = texto || "";
  for (const [k, val] of Object.entries(vars)) v = v.split(`{{${k}}}`).join(val ?? "");
  return v.replace(/\{\{[a-z_]+\}\}/g, "");
}

export function idiomaDe(...cands: Array<string | null | undefined>): Idioma {
  for (const c of cands) {
    const i = (c || "").slice(0, 2).toLowerCase();
    if (i === "es" || i === "en" || i === "ca" || i === "fr" || i === "de") return i;
  }
  return "es";
}

const fmtFecha = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};
const fmtImporte = (n: number | null | undefined) => (n == null ? "" : Number(n).toFixed(2));

/**
 * Variables de una reserva, idénticas a las que construye reservas_mensaje_encolar en SQL
 * (misma clave, mismo formato). Se usan para previsualizar y para las variables de contenido
 * de WhatsApp.
 */
export function variablesReserva(d: {
  reserva: ReservaMsg;
  cliente: ClienteMsg | null;
  restaurante: RestauranteMsg;
  mensajeExtra?: string | null;
}): Record<string, string> {
  const { reserva: r, cliente: c, restaurante: rest } = d;
  const base = urlBase(rest);
  const tok = r.token || "";
  const importe =
    r.tipo === "prepago" || r.tipo === "experiencia"
      ? r.importe_prepago
      : r.tipo === "garantia" || r.tipo === "politica_cancelacion"
        ? r.importe_garantia
        : null;
  const nombre = (c?.nombre || "").trim();
  return {
    nombre: nombre.split(" ")[0] || "",
    nombre_completo: [c?.nombre, c?.apellidos].filter(Boolean).join(" ").trim(),
    restaurante: rest.nombre,
    fecha: fmtFecha(r.fecha),
    hora: (r.hora || "").slice(0, 5),
    pax: String(r.pax),
    localizador: r.localizador,
    enlace: `${base}/reserva/${tok}`,
    enlace_cancelar: `${base}/reserva/${tok}?accion=cancelar`,
    enlace_confirmar: `${base}/reserva/${tok}?accion=confirmar`,
    enlace_pago: `${base}/reserva/${tok}/pago`,
    enlace_valorar: `${base}/valorar/${tok}`,
    direccion: rest.direccion || rest.ubicacion || "",
    telefono: rest.telefono || "",
    mensaje: d.mensajeExtra ?? rest.mensaje_widget ?? "",
    importe: fmtImporte(importe),
    horas_politica: String(rest.politica_cancelacion_horas),
  };
}

/* ───────────────────────── Fechas y zona horaria ───────────────────────── */

/** Offset (minutos) de una zona horaria IANA en un instante dado. */
function offsetMin(fecha: Date, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(fecha)) if (x.type !== "literal") p[x.type] = Number(x.value);
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (local - fecha.getTime()) / 60000;
}

/** Instante UTC de «fecha + hora» expresadas en la zona del restaurante (= reservas_ts). */
export function instanteLocal(fecha: string, hora: string, tz = "Europe/Madrid"): Date {
  const [a, m, d] = fecha.split("-").map(Number);
  const [h, mi] = hora.split(":").map(Number);
  const supuesto = Date.UTC(a, m - 1, d, h, mi || 0, 0);
  let off: number;
  try {
    off = offsetMin(new Date(supuesto), tz);
  } catch {
    off = 0;
  }
  const t = supuesto - off * 60000;
  // Segunda pasada por si el instante cae en un cambio de hora.
  try {
    const off2 = offsetMin(new Date(t), tz);
    if (off2 !== off) return new Date(supuesto - off2 * 60000);
  } catch {
    /* zona inválida: nos quedamos con la primera estimación */
  }
  return new Date(t);
}

const icsFecha = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsEscapa = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fichero .ics (RFC 5545) de la reserva; el UID es el localizador para que al reenviar se actualice. */
export function icsReserva(d: {
  reserva: Pick<ReservaMsg, "fecha" | "hora" | "duracion_min" | "pax" | "localizador" | "estado">;
  restaurante: Pick<RestauranteMsg, "nombre" | "direccion" | "ubicacion" | "zona_horaria" | "telefono">;
  enlace?: string;
  idioma?: Idioma;
}): string {
  const { reserva: r, restaurante: rest } = d;
  const ini = instanteLocal(r.fecha, r.hora, rest.zona_horaria);
  const fin = new Date(ini.getTime() + (r.duracion_min || 120) * 60000);
  const t = TXT[d.idioma || "es"];
  const titulo = `${t.ics_titulo} ${rest.nombre} · ${r.pax} ${t.pax}`;
  const desc = [`${t.ics_localizador}: ${r.localizador}`, d.enlace ? `${t.gestionar}: ${d.enlace}` : "", rest.telefono || ""]
    .filter(Boolean)
    .join("\n");
  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hostelero//Reservas//ES",
    "CALSCALE:GREGORIAN",
    `METHOD:${r.estado === "cancelada" ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:reserva-${r.localizador}@hostelero`,
    `DTSTAMP:${icsFecha(new Date())}`,
    // Mismo UID en cada envío: SEQUENCE creciente y LAST-MODIFIED para que el calendario
    // (Apple, Outlook) tome la versión nueva de una modificación en vez de ignorarla o duplicarla.
    `SEQUENCE:${Math.floor(Date.now() / 1000)}`,
    `LAST-MODIFIED:${icsFecha(new Date())}`,
    `DTSTART:${icsFecha(ini)}`,
    `DTEND:${icsFecha(fin)}`,
    `SUMMARY:${icsEscapa(titulo)}`,
    `DESCRIPTION:${icsEscapa(desc)}`,
    `LOCATION:${icsEscapa([rest.nombre, rest.direccion || rest.ubicacion || ""].filter(Boolean).join(", "))}`,
    `STATUS:${r.estado === "cancelada" ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscapa(titulo)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // Plegado a 75 octetos (RFC 5545 §3.1) y CRLF.
  return lineas.map(plegarIcs).join("\r\n") + "\r\n";
}

/** Parte una línea .ics en trozos de ≤ 75 octetos UTF-8 sin cortar caracteres (la continuación empieza por espacio). */
function plegarIcs(linea: string): string {
  const enc = new TextEncoder(); // sin Buffer: este fichero también puede importarse desde el cliente
  const trozos: string[] = [];
  let actual = "";
  let bytes = 0;
  for (const ch of linea) {
    const b = enc.encode(ch).length;
    const max = trozos.length === 0 ? 75 : 74;
    if (bytes + b > max) {
      trozos.push(actual);
      actual = "";
      bytes = 0;
    }
    actual += ch;
    bytes += b;
  }
  trozos.push(actual);
  return trozos.join("\r\n ");
}

/** Enlace «Añadir a Google Calendar» (sirve en cualquier cliente de correo, el .ics va adjunto). */
export function enlaceGoogleCalendar(d: {
  reserva: Pick<ReservaMsg, "fecha" | "hora" | "duracion_min" | "pax" | "localizador">;
  restaurante: Pick<RestauranteMsg, "nombre" | "direccion" | "ubicacion" | "zona_horaria">;
  idioma?: Idioma;
}): string {
  const { reserva: r, restaurante: rest } = d;
  const ini = instanteLocal(r.fecha, r.hora, rest.zona_horaria);
  const fin = new Date(ini.getTime() + (r.duracion_min || 120) * 60000);
  const t = TXT[d.idioma || "es"];
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: `${t.ics_titulo} ${rest.nombre} · ${r.pax} ${t.pax}`,
    dates: `${icsFecha(ini)}/${icsFecha(fin)}`,
    details: `${t.ics_localizador}: ${r.localizador}`,
    location: [rest.nombre, rest.direccion || rest.ubicacion || ""].filter(Boolean).join(", "),
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/* ───────────────────────── HTML de marca ───────────────────────── */

const TXT: Record<
  Idioma,
  {
    gestionar: string;
    cancelar: string;
    confirmar: string;
    valorar: string;
    calendario: string;
    pagar: string;
    tarjeta: string;
    reservar: string;
    pax: string;
    ics_titulo: string;
    ics_localizador: string;
    legal: string;
    automatico: string;
  }
> = {
  es: {
    gestionar: "Gestionar mi reserva",
    cancelar: "Cancelar la reserva",
    confirmar: "Confirmar asistencia",
    valorar: "Valorar la experiencia",
    calendario: "Añadir al calendario",
    pagar: "Pagar la reserva",
    tarjeta: "Introducir la tarjeta",
    reservar: "Reservar de nuevo",
    pax: "pers.",
    ics_titulo: "Reserva en",
    ics_localizador: "Localizador",
    legal:
      "Recibes este mensaje porque has hecho una reserva con nosotros. Responsable del tratamiento: {{titular}}. Puedes ejercer tus derechos de acceso, rectificación y supresión escribiendo al restaurante.",
    automatico: "Mensaje enviado automáticamente desde el sistema de reservas.",
  },
  en: {
    gestionar: "Manage my booking",
    cancelar: "Cancel booking",
    confirmar: "Confirm attendance",
    valorar: "Rate your experience",
    calendario: "Add to calendar",
    pagar: "Pay for the booking",
    tarjeta: "Enter card details",
    reservar: "Book again",
    pax: "guests",
    ics_titulo: "Booking at",
    ics_localizador: "Booking code",
    legal:
      "You receive this message because you made a booking with us. Data controller: {{titular}}. You can exercise your rights of access, rectification and erasure by writing to the restaurant.",
    automatico: "Automatic message from the booking system.",
  },
  ca: {
    gestionar: "Gestionar la meva reserva",
    cancelar: "Cancel·lar la reserva",
    confirmar: "Confirmar assistència",
    valorar: "Valorar l'experiència",
    calendario: "Afegir al calendari",
    pagar: "Pagar la reserva",
    tarjeta: "Introduir la targeta",
    reservar: "Reservar de nou",
    pax: "pers.",
    ics_titulo: "Reserva a",
    ics_localizador: "Localitzador",
    legal:
      "Reps aquest missatge perquè has fet una reserva amb nosaltres. Responsable del tractament: {{titular}}. Pots exercir els teus drets d'accés, rectificació i supressió escrivint al restaurant.",
    automatico: "Missatge enviat automàticament des del sistema de reserves.",
  },
  fr: {
    gestionar: "Gérer ma réservation",
    cancelar: "Annuler la réservation",
    confirmar: "Confirmer ma venue",
    valorar: "Évaluer l'expérience",
    calendario: "Ajouter au calendrier",
    pagar: "Payer la réservation",
    tarjeta: "Saisir la carte",
    reservar: "Réserver à nouveau",
    pax: "pers.",
    ics_titulo: "Réservation chez",
    ics_localizador: "Référence",
    legal:
      "Vous recevez ce message car vous avez effectué une réservation chez nous. Responsable du traitement : {{titular}}. Vous pouvez exercer vos droits d'accès, de rectification et de suppression en écrivant au restaurant.",
    automatico: "Message envoyé automatiquement par le système de réservation.",
  },
  de: {
    gestionar: "Reservierung verwalten",
    cancelar: "Reservierung stornieren",
    confirmar: "Teilnahme bestätigen",
    valorar: "Erlebnis bewerten",
    calendario: "Zum Kalender hinzufügen",
    pagar: "Reservierung bezahlen",
    tarjeta: "Karte hinterlegen",
    reservar: "Erneut reservieren",
    pax: "Pers.",
    ics_titulo: "Reservierung bei",
    ics_localizador: "Buchungscode",
    legal:
      "Sie erhalten diese Nachricht, weil Sie bei uns reserviert haben. Verantwortlicher: {{titular}}. Sie können Ihre Rechte auf Auskunft, Berichtigung und Löschung ausüben, indem Sie dem Restaurant schreiben.",
    automatico: "Automatische Nachricht des Reservierungssystems.",
  },
};

export const escapaHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Texto plano → párrafos HTML; los enlaces http(s) se convierten en <a>. */
export function cuerpoHtml(texto: string, color: string): string {
  const parrafos = texto.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return parrafos
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const lineas = p.split("\n").map((l) =>
        escapaHtml(l).replace(
          /(https?:\/\/[^\s<]+[^\s<.,;:)!?])/g,
          (u) => `<a href="${u}" style="color:${color};text-decoration:underline;word-break:break-all;">${u}</a>`,
        ),
      );
      return `<p style="margin:0 0 14px;line-height:1.5;">${lineas.join("<br>")}</p>`;
    })
    .join("");
}

export type Boton = { texto: string; url: string; primario?: boolean };

/** Botones por tipo de mensaje (lo que haría Cover: gestionar / confirmar / cancelar / valorar / pagar). */
export function botonesPorTipo(tipo: string, vars: Record<string, string>, idioma: Idioma, calendario?: string | null): Boton[] {
  const t = TXT[idioma];
  const b: Boton[] = [];
  const hayToken = !!vars.enlace && !/\/reserva\/$/.test(vars.enlace);
  switch (tipo) {
    case "confirmacion":
    case "confirmada":
    case "modificacion":
      if (hayToken) b.push({ texto: t.gestionar, url: vars.enlace, primario: true });
      if (calendario) b.push({ texto: t.calendario, url: calendario });
      break;
    case "recordatorio":
    case "reconfirmacion":
      if (hayToken) {
        b.push({ texto: t.confirmar, url: vars.enlace_confirmar, primario: true });
        b.push({ texto: t.cancelar, url: vars.enlace_cancelar });
      }
      break;
    case "valoracion":
      if (hayToken) b.push({ texto: t.valorar, url: vars.enlace_valorar, primario: true });
      break;
    case "pago":
      if (hayToken) b.push({ texto: t.pagar, url: vars.enlace_pago, primario: true });
      break;
    case "garantia":
      if (hayToken) b.push({ texto: t.tarjeta, url: vars.enlace_pago, primario: true });
      break;
    case "cancelacion":
    case "noshow":
      if (vars.enlace_reservar) b.push({ texto: t.reservar, url: vars.enlace_reservar, primario: true });
      break;
    default:
      break;
  }
  return b;
}

/**
 * Email de marca: cabecera con logo o nombre (color del restaurante), cuerpo renderizado,
 * botones, pie con dirección y aviso legal. Diseño en tabla + estilos en línea (clientes de
 * correo); se lee bien en claro y en oscuro (fondo claro fijo, colores explícitos).
 */
export function htmlEmail(d: {
  restaurante: Pick<RestauranteMsg, "nombre" | "color_marca" | "logo_url" | "direccion" | "ubicacion" | "telefono" | "url_condiciones" | "slug">;
  cuerpo: string;
  botones?: Boton[];
  idioma?: Idioma;
  titular?: string;
  preencabezado?: string;
  /** Email al que puede escribir el cliente (reply_to); se muestra tras el aviso legal. */
  responderA?: string | null;
}): string {
  const rest = d.restaurante;
  const idioma = d.idioma || "es";
  const t = TXT[idioma];
  const color = /^#[0-9a-f]{6}$/i.test(rest.color_marca || "") ? (rest.color_marca as string) : "#0F6E56";
  const titular = d.titular || rest.nombre;
  const direccion = [rest.direccion || rest.ubicacion || "", rest.telefono || ""].filter(Boolean).join(" · ");
  const cabecera = rest.logo_url
    ? `<img src="${escapaHtml(rest.logo_url)}" alt="${escapaHtml(rest.nombre)}" height="48" style="height:48px;max-width:220px;display:block;margin:0 auto;object-fit:contain;">`
    : `<div style="font-size:20px;font-weight:700;letter-spacing:.3px;color:#ffffff;">${escapaHtml(rest.nombre)}</div>`;
  const botones = (d.botones || [])
    .map(
      (b) =>
        `<a href="${escapaHtml(b.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:11px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;${
          b.primario ? `background:${color};color:#ffffff;` : `background:#ffffff;color:${color};border:1px solid ${color};`
        }">${escapaHtml(b.texto)}</a>`,
    )
    .join("");
  const pre = d.preencabezado
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapaHtml(d.preencabezado)}</div>`
    : "";
  const condiciones = rest.url_condiciones
    ? ` <a href="${escapaHtml(rest.url_condiciones)}" style="color:#6b7280;">${idioma === "es" ? "Condiciones" : idioma === "ca" ? "Condicions" : idioma === "fr" ? "Conditions" : idioma === "de" ? "Bedingungen" : "Terms"}</a>`
    : "";

  const contacto = d.responderA
    ? ` <a href="mailto:${escapaHtml(d.responderA)}" style="color:#6b7280;">${escapaHtml(d.responderA)}</a>`
    : "";

  return `<!doctype html>
<html lang="${idioma}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapaHtml(rest.nombre)}</title></head>
<body style="margin:0;padding:0;background:#f1f3f2;">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f3f2;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1e2a25;font-size:15px;">
  <tr><td style="background:${color};padding:22px 24px;text-align:center;">${cabecera}</td></tr>
  <tr><td style="padding:26px 24px 8px;">${cuerpoHtml(d.cuerpo, color)}</td></tr>
  ${botones ? `<tr><td style="padding:4px 24px 20px;">${botones}</td></tr>` : ""}
  <tr><td style="padding:16px 24px 22px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.5;">
    <div style="font-weight:600;color:#374151;">${escapaHtml(rest.nombre)}</div>
    ${direccion ? `<div>${escapaHtml(direccion)}</div>` : ""}
    <div style="margin-top:8px;">${escapaHtml(t.legal.replace("{{titular}}", titular))}${contacto}${condiciones}</div>
    <div style="margin-top:6px;">${escapaHtml(t.automatico)}</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** Versión texto plano del email (Resend la manda como alternativa; mejora la entregabilidad). */
export function textoPlano(cuerpo: string, botones: Boton[] = [], rest?: Pick<RestauranteMsg, "nombre" | "direccion" | "ubicacion" | "telefono">): string {
  const partes = [cuerpo.trim()];
  if (botones.length) partes.push(botones.map((b) => `${b.texto}: ${b.url}`).join("\n"));
  if (rest) partes.push([rest.nombre, rest.direccion || rest.ubicacion || "", rest.telefono || ""].filter(Boolean).join("\n"));
  return partes.join("\n\n") + "\n";
}

/** Tipos de mensaje que son avisos automáticos (los que Cover sigue mandando a sus reservas). */
export const TIPOS_AUTOMATICOS = new Set(["confirmacion", "confirmada", "recordatorio", "reconfirmacion", "valoracion", "noshow"]);

/** Tipos que llevan el .ics adjunto. */
export const TIPOS_CON_ICS = new Set(["confirmacion", "confirmada", "modificacion"]);

/** Etiqueta en español de cada tipo (panel: tracking, selector de plantilla). */
export const TIPO_TXT: Record<string, string> = {
  confirmacion: "Reserva recibida",
  confirmada: "Reserva confirmada",
  recordatorio: "Recordatorio",
  reconfirmacion: "Reconfirmación",
  cancelacion: "Cancelación",
  modificacion: "Modificación",
  lista_espera: "Lista de espera",
  valoracion: "Valoración",
  pago: "Pago",
  garantia: "Garantía (tarjeta)",
  noshow: "No-show",
  invitacion: "Invitación",
  manual: "Manual",
};

export const ESTADO_MSG_TXT: Record<string, string> = {
  pendiente: "Pendiente",
  enviado: "Enviado",
  entregado: "Entregado",
  abierto: "Leído",
  error: "Error",
  sin_proveedor: "Sin proveedor",
  cancelado: "Cancelado",
};
