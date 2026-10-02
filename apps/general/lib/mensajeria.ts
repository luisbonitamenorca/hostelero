/**
 * Mensajería de Reservas · MOTOR DE ENVÍO (email / SMS / WhatsApp).
 *
 * Las filas las encolan los triggers y RPC de la base en `reservas_mensajes`; aquí se envían.
 *  - Email: Resend por HTTP (misma decisión que lib/correo.ts: sin SDK). Remitente por
 *    restaurante cuando su dominio está verificado en Resend; si no, el remitente general.
 *  - SMS y WhatsApp: Twilio por REST con fetch. WhatsApp exige plantillas aprobadas
 *    (ContentSid por tipo, env TWILIO_WA_CONTENT_<TIPO>).
 *  - Sin claves → estado 'sin_proveedor' (no es un error): se reintenta cuando existan.
 *  - Errores de proveedor → hasta 3 intentos con espera creciente (5, 15, 45 min); después 'error'.
 *
 * Además (lo que haría Cover):
 *  - un WhatsApp que no puede salir (sin plantilla aprobada, sin remitente o rechazado) se manda
 *    por SMS con la plantilla SMS del mismo tipo si el restaurante tiene SMS activo;
 *  - los avisos que se quedaron atascados (sin proveedor durante días) caducan en vez de llegar
 *    tarde: nadie quiere un «tu reserva está confirmada» de una cena que ya pasó;
 *  - remitente SMS / WhatsApp por restaurante con env TWILIO_SMS_FROM_<SLUG> / TWILIO_WHATSAPP_FROM_<SLUG>.
 *
 * Dos puertas de entrada:
 *  - enviarPendientes(limite): la llama el cron con la service key (lee todas las cuentas).
 *  - enviarMensajesPorId(sb, ids): la llaman las acciones del panel con el cliente de sesión
 *    (RLS), para que «Enviar ahora» no espere al cron. Nada de service key en el panel.
 *  - enviarAhoraDe(sb, { reservaId | listaEsperaId }): manda al momento lo que ya toca de una
 *    reserva o lista de espera (tras crear, confirmar o avisar), sin esperar al cron.
 *
 * REGLA MIENTRAS COVER SIGA VIVO: una reserva con cover_id ya recibe sus avisos automáticos
 * de Cover; aquí esos tipos (confirmación, recordatorio, reconfirmación, valoración, no-show)
 * se cancelan sin enviar si los encoló el sistema. Cancelación, modificación, pago, lista de
 * espera y todo lo que se manda a mano desde el panel (creado_por con valor) sí salen.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@hostelero/db";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import {
  botonesPorTipo,
  cuerpoHtml,
  enlaceGoogleCalendar,
  htmlEmail,
  icsReserva,
  idiomaDe,
  instanteLocal,
  renderizar,
  textoPlano,
  TIPOS_AUTOMATICOS,
  TIPOS_CON_ICS,
  urlBase,
  variablesReserva,
  type ClienteMsg,
  type ReservaMsg,
  type RestauranteMsg,
} from "./mensajeria-plantillas";

export type ClienteSb = SupabaseClient<Database>;
export type Mensaje = Tables<"reservas_mensajes">;

export const MAX_INTENTOS = 3;
const ESPERA_MIN = [5, 15, 45]; // backoff por intento fallido

/**
 * Reclamo con plazo: al coger una fila se le adelanta `programado_para` 10 min y se marca
 * `error` con MARCA_ENVIO. Mientras dure el plazo ninguna otra lectura (segundo disparo del
 * cron, «Enviar ahora», reenviar) la encuentra. Toda salida reescribe estado, error y
 * programado_para; si el proceso muere a medias, la fila vuelve a salir al vencer el plazo.
 */
const PLAZO_RECLAMO_MS = 10 * 60000;
/** Desfase admitido entre el reloj de la base (now() de los RPC) y el del servidor. */
const TOLERANCIA_RELOJ_MS = 5000;
export const MARCA_ENVIO = "Enviándose ahora";
/** Texto que se añade a un WhatsApp caído mientras su SMS de respaldo no ha terminado. */
const SUFIJO_RESPALDO = "Se intenta por SMS.";
/** asunto de la fila SMS de respaldo (los SMS no usan asunto): sirve para encontrar el WhatsApp original. */
const ASUNTO_RESPALDO = "Respaldo de WhatsApp";

/** ¿La fila la tiene cogida ahora mismo otro proceso (reclamo vigente)? */
export function enEnvio(m: Pick<Mensaje, "error" | "programado_para">): boolean {
  return m.error === MARCA_ENVIO && new Date(m.programado_para).getTime() > Date.now();
}

export type ResultadoEnvio = {
  procesados: number;
  enviados: number;
  errores: number;
  sin_proveedor: number;
  cancelados: number;
  omitidos: number;
  detalle: Array<{ id: string; canal: string; tipo: string; estado: string; error?: string | null }>;
};

/* ───────────────────────── Configuración de proveedores ───────────────────────── */

/** Dominios verificados en Resend (desde los que podemos firmar como el restaurante). */
function dominiosVerificados(): string[] {
  return (process.env.RESEND_DOMINIOS || "binifadet.com,tamarindosmenorca.com,casatirant.com")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/** slug del restaurante → dominio (env RESEND_DOMINIOS_SLUG="binifadet=binifadet.com,…"). */
function dominioPorSlug(): Record<string, string> {
  const txt = process.env.RESEND_DOMINIOS_SLUG || "binifadet=binifadet.com,tamarindos=tamarindosmenorca.com,bar-tamarindos=tamarindosmenorca.com,casa-tirant=casatirant.com";
  const m: Record<string, string> = {};
  for (const par of txt.split(",")) {
    const [s, d] = par.split("=").map((x) => x.trim().toLowerCase());
    if (s && d) m[s] = d;
  }
  return m;
}

/**
 * Remitente del email de un restaurante: «Nombre <reservas@dominio>» si su dominio está
 * verificado; si no, el remitente general (RESEND_REMITENTE) con el nombre del restaurante.
 */
export function remitenteDe(rest: Pick<RestauranteMsg, "nombre" | "slug" | "email" | "email_reservas">): string {
  const verificados = dominiosVerificados();
  const buzon = (process.env.RESEND_BUZON || "reservas").trim();
  const nombre = rest.nombre.replace(/[<>"]/g, "").trim();
  const emailRest = (rest.email_reservas || rest.email || "").trim().toLowerCase();
  const domEmail = emailRest.includes("@") ? emailRest.split("@")[1] : "";
  const dominio = (domEmail && verificados.includes(domEmail) && domEmail) || dominioPorSlug()[rest.slug.toLowerCase()] || "";
  if (dominio && verificados.includes(dominio)) return `${nombre} <${buzon}@${dominio}>`;
  return remitenteGeneral(nombre);
}

/** Remitente general (RESEND_REMITENTE) firmando con el nombre del restaurante. */
function remitenteGeneral(nombre: string): string {
  const general = process.env.RESEND_REMITENTE || "Bodegas Binifadet <reservas@binifadet.com>";
  const dir = general.match(/<([^>]+)>/)?.[1] || general;
  return `${nombre.replace(/[<>"]/g, "").trim()} <${dir.trim()}>`;
}

/**
 * Dirección a la que llegan las respuestas del cliente (reply_to): email_reservas o email del
 * restaurante; si no tiene, MENSAJERIA_RESPONDER_A (con variante por slug:
 * MENSAJERIA_RESPONDER_A_BINIFADET). null si no hay ninguna: el panel lo avisa.
 */
export function responderA(rest: Pick<RestauranteMsg, "slug" | "email" | "email_reservas">): string | null {
  for (const c of [rest.email_reservas, rest.email, envPorRestaurante("MENSAJERIA_RESPONDER_A", rest.slug)]) {
    const e = (c || "").trim().toLowerCase();
    if (EMAIL_RE.test(e)) return e;
  }
  return null;
}

/**
 * Variable de entorno con variante por restaurante: primero `${base}_${SLUG}` (slug en
 * mayúsculas, guiones → «_»), después `${base}`. Sirve para que cada local firme sus SMS
 * («Binifadet», «Tamarindos») o tenga su propio número de WhatsApp.
 */
function envPorRestaurante(base: string, slug: string | null | undefined): string {
  const s = (slug || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  return ((s && process.env[`${base}_${s}`]) || process.env[base] || "").trim();
}

/**
 * Países en los que el «0» nacional se cuela a menudo tras el prefijo (44 07…, 33 06…) y hay
 * que quitarlo para E.164. Italia (39) no: allí el 0 de los fijos forma parte del número.
 */
const PREFIJO_CON_CERO = ["44", "33", "49", "31", "32", "41", "43", "353", "61", "64", "46", "47", "45", "358"];

/**
 * Teléfono en E.164 a partir de telefono_norm (solo dígitos). 9 dígitos que empiezan por 6-9 =
 * España; el resto ya trae prefijo internacional (lo que deja la importación de Cover).
 */
export function telE164(t: string | null | undefined): string | null {
  const crudo = (t || "").trim();
  let d = crudo.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  else if (!crudo.startsWith("+") && d.length === 9 && /^[6789]/.test(d)) d = "34" + d;
  for (const p of PREFIJO_CON_CERO) {
    if (d.startsWith(p + "0") && d.length - p.length - 1 >= 9) {
      d = p + d.slice(p.length + 1);
      break;
    }
  }
  if (d.length < 8 || d.length > 15) return null;
  return "+" + d;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** URL pública que Twilio llamará con el estado del envío (si no está, sin callback). */
function callbackTwilio(): string | undefined {
  const base = (process.env.MENSAJERIA_URL_PUBLICA || "").trim().replace(/\/+$/, "");
  return base ? `${base}/api/publico/reservas/webhooks/twilio` : undefined;
}

type Envio =
  | { ok: true; proveedor: string; proveedorId: string | null; estado?: "enviado" | "entregado" }
  | { ok: false; sinProveedor: true; error: string }
  | { ok: false; sinProveedor?: false; error: string; definitivo?: boolean; limite?: boolean; cupo?: "diario" | "mensual" };

/** Instante en que Resend repone el cupo: medianoche UTC siguiente o día 1 del mes siguiente. */
function finDeCupo(cupo: "diario" | "mensual"): Date {
  const d = new Date();
  const t = cupo === "diario" ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return new Date(t + 5 * 60000); // unos minutos de margen
}

/**
 * Resend admite 2 peticiones por segundo por defecto: el motor espera entre envíos para no
 * comerse un 429 (que, además, no cuenta como intento: se reprograma a 1 minuto).
 */
let ultimoResend = 0;
async function turnoResend() {
  const hueco = Number(process.env.RESEND_MS_ENTRE_ENVIOS || 550);
  const espera = ultimoResend + hueco - Date.now();
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimoResend = Date.now();
}

/* ───────────────────────── Email (Resend) ───────────────────────── */

async function enviarEmail(d: {
  mensaje: Mensaje;
  restaurante: RestauranteMsg;
  reserva: ReservaMsg | null;
  cliente: ClienteMsg | null;
}): Promise<Envio> {
  const clave = process.env.RESEND_API_KEY;
  if (!clave) return { ok: false, sinProveedor: true, error: "Falta RESEND_API_KEY" };
  const { mensaje: m, restaurante: rest, reserva: r } = d;
  const para = m.destinatario.trim().toLowerCase();
  if (!EMAIL_RE.test(para)) return { ok: false, error: "Email del destinatario no válido", definitivo: true };

  const idioma = idiomaDe(r?.idioma, d.cliente?.idioma);
  const vars = r ? variablesReserva({ reserva: r, cliente: d.cliente, restaurante: rest }) : {};
  if (r) vars.enlace_reservar = `${urlBase(rest)}/reservar-mesa/${rest.slug}`;
  const calendario = r && TIPOS_CON_ICS.has(m.tipo) ? enlaceGoogleCalendar({ reserva: r, restaurante: rest, idioma }) : null;
  const botones = botonesPorTipo(m.tipo, vars, idioma, calendario);
  const html = htmlEmail({
    restaurante: rest,
    cuerpo: m.cuerpo,
    botones,
    idioma,
    titular: process.env.MENSAJERIA_TITULAR || undefined,
    responderA: responderA(rest),
    preencabezado: m.cuerpo.split("\n").find((l) => l.trim() && !/^hola|^hi |^hello|^bonjour|^hallo/i.test(l.trim()))?.trim(),
  });

  const adjuntos =
    r && TIPOS_CON_ICS.has(m.tipo) && r.estado !== "cancelada"
      ? [
          {
            filename: "reserva.ics",
            content: Buffer.from(icsReserva({ reserva: r, restaurante: rest, enlace: vars.enlace, idioma }), "utf8").toString("base64"),
            content_type: "text/calendar; charset=utf-8; method=PUBLISH",
          },
        ]
      : undefined;

  // Las respuestas del cliente («¿podemos ser 6?») van al restaurante, no al buzón que solo envía.
  const responder = responderA(rest) || "";
  const cuerpo: Record<string, unknown> = {
    from: "",
    to: [para],
    subject: m.asunto || `${rest.nombre} · ${m.tipo}`,
    html,
    text: textoPlano(m.cuerpo, botones, rest),
    headers: { "X-Entity-Ref-ID": m.id },
    tags: [
      { name: "mensaje_id", value: m.id },
      { name: "tipo", value: m.tipo },
    ],
  };
  if (EMAIL_RE.test(responder)) cuerpo.reply_to = responder;
  if (adjuntos) cuerpo.attachments = adjuntos;

  // Primero como el restaurante; si Resend dice que ese dominio no está verificado, con el general.
  const remitentes = [...new Set([remitenteDe(rest), remitenteGeneral(rest.nombre)])];
  let ultimo: Envio = { ok: false, error: "Resend: sin intento" };
  for (let i = 0; i < remitentes.length; i++) {
    cuerpo.from = remitentes[i];
    await turnoResend();
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clave}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `rsv-${m.id}-${m.intentos}-${i}`,
        },
        body: JSON.stringify(cuerpo),
      });
      const j = (await res.json().catch(() => null)) as { id?: string; message?: string; name?: string } | null;
      if (res.ok && j?.id) return { ok: true, proveedor: "resend", proveedorId: j.id };
      const txt = j?.message || `Resend HTTP ${res.status}`;
      if (res.status === 429) {
        // daily_quota_exceeded / monthly_quota_exceeded: el cupo del plan está agotado (no es ir rápido).
        if (/quota/i.test(j?.name || "")) {
          const cupo = /month/i.test(j?.name || "") ? "mensual" : "diario";
          return {
            ok: false,
            limite: true,
            cupo,
            error: cupo === "diario" ? "Cupo diario de Resend agotado: sale mañana" : "Cupo mensual de Resend agotado: sale el día 1",
          };
        }
        return { ok: false, error: `Resend: límite de envíos (${txt})`, limite: true };
      }
      // Dominio del remitente sin verificar → probamos con el remitente general.
      if ((res.status === 403 || res.status === 422) && /domain|dominio|verif/i.test(txt) && i < remitentes.length - 1) {
        ultimo = { ok: false, error: txt, definitivo: true };
        continue;
      }
      // Resto de 4xx = petición mal formada o destinatario rechazado: no vale reintentar.
      return { ok: false, error: txt, definitivo: res.status >= 400 && res.status < 500 };
    } catch (e) {
      return { ok: false, error: `Resend: ${(e as Error).message}` };
    }
  }
  return ultimo;
}

/* ───────────────────────── SMS y WhatsApp (Twilio) ───────────────────────── */

type TwilioCfg = { sid: string; token: string; sms: string; wa: string };

/** Credenciales de Twilio y remitentes (por restaurante si hay variante con su slug). */
function twilioCfg(slug?: string | null): TwilioCfg | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return { sid, token, sms: envPorRestaurante("TWILIO_SMS_FROM", slug), wa: envPorRestaurante("TWILIO_WHATSAPP_FROM", slug) };
}

async function twilioPost(cfg: TwilioCfg, params: Record<string, string>): Promise<Envio> {
  const body = new URLSearchParams(params);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${cfg.sid}:${cfg.token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const j = (await res.json().catch(() => null)) as { sid?: string; status?: string; code?: number; message?: string; error_code?: number | null } | null;
    if (res.ok && j?.sid) {
      if (j.status === "failed" || j.status === "undelivered") return { ok: false, error: `Twilio ${j.error_code ?? ""} ${j.status}`.trim(), definitivo: true };
      return { ok: true, proveedor: "twilio", proveedorId: j.sid };
    }
    const txt = j?.message ? `Twilio ${j.code ?? res.status}: ${j.message}` : `Twilio HTTP ${res.status}`;
    if (res.status === 429 || j?.code === 20429) return { ok: false, error: txt, limite: true };
    // 21211 número inválido, 21614 no es móvil, 63016 fuera de la ventana de 24 h (texto libre),
    // 21408 región no permitida, 63007 remitente de WhatsApp no registrado…: no vale reintentar.
    return { ok: false, error: txt, definitivo: res.status >= 400 && res.status < 500 };
  } catch (e) {
    return { ok: false, error: `Twilio: ${(e as Error).message}` };
  }
}

async function enviarSms(d: { mensaje: Mensaje; slug: string }): Promise<Envio> {
  const cfg = twilioCfg(d.slug);
  if (!cfg) return { ok: false, sinProveedor: true, error: "SMS sin configurar: faltan TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN" };
  if (!cfg.sms) return { ok: false, sinProveedor: true, error: "SMS sin configurar: falta TWILIO_SMS_FROM" };
  const para = telE164(d.mensaje.destinatario);
  if (!para) return { ok: false, error: "Teléfono del destinatario no válido", definitivo: true };
  const params: Record<string, string> = { To: para, Body: d.mensaje.cuerpo };
  // Un Messaging Service (MG…), un número (+34…) o un remitente alfanumérico («Binifadet»).
  if (cfg.sms.startsWith("MG")) params.MessagingServiceSid = cfg.sms;
  else params.From = cfg.sms;
  const cb = callbackTwilio();
  if (cb) params.StatusCallback = cb;
  return twilioPost(cfg, params);
}

/** Orden de variables de la plantilla de WhatsApp de un tipo ({{1}}, {{2}}, …). */
function ordenVariablesWa(tipo: string): string[] {
  const env = process.env[`TWILIO_WA_VARS_${tipo.toUpperCase()}`] || process.env.TWILIO_WA_VARS;
  const def = "nombre,restaurante,fecha,hora,pax,localizador,enlace";
  return (env || def).split(",").map((s) => s.trim()).filter(Boolean);
}

/** ContentSid de la plantilla aprobada: primero la del idioma (…_<TIPO>_EN), después la del tipo. */
export function contentSidWa(tipo: string, idioma?: string | null): string {
  const t = tipo.toUpperCase();
  const i = (idioma || "").slice(0, 2).toUpperCase();
  return ((i && process.env[`TWILIO_WA_CONTENT_${t}_${i}`]) || process.env[`TWILIO_WA_CONTENT_${t}`] || "").trim();
}

/** Tipos para los que hay plantilla de WhatsApp aprobada (en algún idioma) + el texto libre. */
function tiposWaDisponibles(): string[] {
  const tipos = ["confirmacion", "confirmada", "recordatorio", "reconfirmacion", "cancelacion", "modificacion", "lista_espera", "valoracion", "pago", "garantia", "noshow", "invitacion"];
  const conPlantilla = tipos.filter((t) => Object.keys(process.env).some((k) => (k === `TWILIO_WA_CONTENT_${t.toUpperCase()}` || k.startsWith(`TWILIO_WA_CONTENT_${t.toUpperCase()}_`)) && process.env[k]));
  return [...conPlantilla, "manual"];
}

async function enviarWhatsApp(d: { mensaje: Mensaje; vars: Record<string, string>; slug: string; idioma: string }): Promise<Envio> {
  const cfg = twilioCfg(d.slug);
  if (!cfg) return { ok: false, sinProveedor: true, error: "WhatsApp sin configurar: faltan TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN" };
  if (!cfg.wa) return { ok: false, sinProveedor: true, error: "WhatsApp sin configurar: falta TWILIO_WHATSAPP_FROM" };
  const para = telE164(d.mensaje.destinatario);
  if (!para) return { ok: false, error: "Teléfono del destinatario no válido", definitivo: true };
  const params: Record<string, string> = { To: `whatsapp:${para}` };
  if (cfg.wa.startsWith("MG")) params.MessagingServiceSid = cfg.wa;
  else params.From = cfg.wa.startsWith("whatsapp:") ? cfg.wa : `whatsapp:${cfg.wa}`;
  const cb = callbackTwilio();
  if (cb) params.StatusCallback = cb;

  const tipo = d.mensaje.tipo;
  if (tipo === "manual") {
    // Texto libre: solo llega si el cliente nos ha escrito en las últimas 24 h (ventana de Meta).
    params.Body = d.mensaje.cuerpo;
    return twilioPost(cfg, params);
  }
  const contentSid = contentSidWa(tipo, d.idioma);
  if (!contentSid) {
    return {
      ok: false,
      sinProveedor: true,
      error: `Falta la plantilla de WhatsApp aprobada para «${tipo}» (env TWILIO_WA_CONTENT_${tipo.toUpperCase()})`,
    };
  }
  const variables: Record<string, string> = {};
  ordenVariablesWa(tipo).forEach((k, i) => (variables[String(i + 1)] = (d.vars[k] ?? "").trim() || "-"));
  params.ContentSid = contentSid;
  params.ContentVariables = JSON.stringify(variables);
  return twilioPost(cfg, params);
}

/* ───────────────────────── Núcleo ───────────────────────── */

const ESTADOS_VISITA = new Set(["llegada", "sentada", "postre", "cuenta", "terminada"]);
const TIPOS_DE_RESERVA_VIVA = new Set(["confirmacion", "confirmada", "recordatorio", "reconfirmacion", "valoracion", "pago", "garantia", "modificacion"]);
/** Avisos que no tienen sentido una vez pasada la hora de la reserva. */
const TIPOS_ANTES_DE_LA_HORA = new Set(["confirmacion", "confirmada", "recordatorio", "reconfirmacion", "modificacion", "pago", "garantia", "cancelacion"]);
const HORA = 3600000;

type ReservaCtx = ReservaMsg & { reservas_clientes: ClienteMsg | null };
type Espera = Tables<"reservas_lista_espera">;

type Contexto = {
  reservas: Map<string, ReservaCtx>;
  restaurantes: Map<string, RestauranteMsg>;
  esperas: Map<string, Espera>;
};

async function cargarContexto(sb: ClienteSb, filas: Mensaje[]): Promise<Contexto> {
  const idsR = [...new Set(filas.map((f) => f.reserva_id).filter((x): x is string => !!x))];
  const idsE = [...new Set(filas.map((f) => f.lista_espera_id).filter((x): x is string => !!x))];
  const [res, esp] = await Promise.all([
    idsR.length ? sb.from("reservas_reservas").select("*, reservas_clientes(*)").in("id", idsR) : Promise.resolve({ data: [], error: null }),
    idsE.length ? sb.from("reservas_lista_espera").select("*").in("id", idsE) : Promise.resolve({ data: [], error: null }),
  ]);
  // Una lectura fallida NO puede pasar por «la reserva ya no existe»: se corta antes de reclamar nada.
  if (res.error) throw new Error(`No se han podido leer las reservas: ${res.error.message}`);
  if (esp.error) throw new Error(`No se ha podido leer la lista de espera: ${esp.error.message}`);
  const ctx: Contexto = { reservas: new Map(), restaurantes: new Map(), esperas: new Map() };
  for (const r of (res.data ?? []) as ReservaCtx[]) ctx.reservas.set(r.id, r);
  for (const e of (esp.data ?? []) as Espera[]) ctx.esperas.set(e.id, e);
  // Restaurantes de las filas y de sus reservas (una fila manual puede venir sin restaurante_id).
  const idsRest = new Set(filas.map((f) => f.restaurante_id).filter((x): x is string => !!x));
  for (const r of ctx.reservas.values()) idsRest.add(r.restaurante_id);
  if (idsRest.size) {
    const { data, error } = await sb.from("reservas_restaurantes").select("*").in("id", [...idsRest]);
    if (error) throw new Error(`No se han podido leer los restaurantes: ${error.message}`);
    for (const r of (data ?? []) as RestauranteMsg[]) ctx.restaurantes.set(r.id, r);
  }
  return ctx;
}

/**
 * Motivo para NO enviar (y cancelar) un mensaje: estado actual de la reserva o de la lista de
 * espera, regla de Cover y caducidad (un aviso que no salió a tiempo no se manda tarde).
 */
function motivoCancelacion(m: Mensaje, r: ReservaMsg | null, rest: RestauranteMsg | null, espera: Espera | null): string | null {
  const antiguedad = Date.now() - new Date(m.programado_para).getTime();
  const aMano = !!m.creado_por; // enviado desde el panel por una persona

  if (m.tipo === "lista_espera") {
    if (espera && !["esperando", "avisado"].includes(espera.estado)) return `La lista de espera ya no está activa (${espera.estado})`;
    if (antiguedad > 3 * HORA) return "Caducado: el aviso de mesa libre no salió a tiempo";
  }
  if (antiguedad > 72 * HORA) return "Caducado: no salió en 3 días";
  if (!r) {
    if (m.reserva_id && m.tipo !== "manual") return "La reserva ya no existe";
    return null;
  }
  if (r.cover_id && !aMano && TIPOS_AUTOMATICOS.has(m.tipo)) return "Reserva importada de Cover: el aviso automático lo manda Cover";
  if ((r.estado === "cancelada" || r.estado === "no_show") && TIPOS_DE_RESERVA_VIVA.has(m.tipo)) return `La reserva está ${r.estado === "no_show" ? "en no-show" : "cancelada"}`;
  if (r.estado === "lista_espera" && TIPOS_DE_RESERVA_VIVA.has(m.tipo)) return "La reserva está en lista de espera";
  const tz = rest?.zona_horaria || "Europe/Madrid";
  const ini = instanteLocal(r.fecha, r.hora, tz).getTime();
  if (TIPOS_ANTES_DE_LA_HORA.has(m.tipo) && ini < Date.now()) return "La hora de la reserva ya ha pasado";
  if (m.tipo === "reconfirmacion" && r.estado === "reconfirmada") return "El cliente ya había reconfirmado";
  if ((m.tipo === "pago" || m.tipo === "garantia") && r.estado !== "tarjeta_pendiente") return "La reserva ya no está pendiente de tarjeta";
  if (m.tipo === "valoracion") {
    if (r.valoracion != null) return "El cliente ya ha valorado";
    const presunta = rest ? !rest.noshow_automatico && (r.estado === "confirmada" || r.estado === "reconfirmada") : false;
    if (!ESTADOS_VISITA.has(r.estado) && !presunta) return `La reserva no consta como visita (${r.estado})`;
  }
  if (m.tipo === "noshow" && r.estado !== "no_show") return "La reserva ya no está en no-show";
  return null;
}

/** Variables de una fila de lista de espera (mismas claves que reservas_lista_espera_avisar). */
function variablesEspera(e: Espera, rest: RestauranteMsg, cuerpo: string): Record<string, string> {
  const [a, mm, d] = e.fecha.split("-");
  // El enlace del aviso lleva la hora ofrecida (&hora=HH:MM), que puede no ser la preferida.
  const enlace = cuerpo.match(/https?:\/\/\S*espera=\S+/)?.[0] || cuerpo.match(/https?:\/\/\S+/)?.[0] || "";
  let hora = (e.hora_preferida || "").slice(0, 5);
  try {
    hora = new URL(enlace).searchParams.get("hora") || hora;
  } catch {
    /* sin enlace: nos quedamos con la preferida */
  }
  return {
    nombre: (e.nombre || "").trim().split(" ")[0],
    nombre_completo: (e.nombre || "").trim(),
    restaurante: rest.nombre,
    fecha: `${d}/${mm}/${a}`,
    hora,
    pax: String(e.pax),
    localizador: "",
    enlace,
    direccion: rest.direccion || rest.ubicacion || "",
    telefono: rest.telefono || "",
  };
}

/** Variables e idioma de un mensaje (reserva o lista de espera). */
function variablesDe(m: Mensaje, r: ReservaCtx | null, rest: RestauranteMsg, espera: Espera | null): { vars: Record<string, string>; idioma: string } {
  if (r) {
    const vars = variablesReserva({ reserva: r, cliente: r.reservas_clientes, restaurante: rest });
    vars.enlace_reservar = `${urlBase(rest)}/reservar-mesa/${rest.slug}`;
    return { vars, idioma: idiomaDe(r.idioma, r.reservas_clientes?.idioma) };
  }
  if (espera) return { vars: variablesEspera(espera, rest, m.cuerpo), idioma: idiomaDe(espera.idioma) };
  return { vars: { nombre: "", restaurante: rest.nombre }, idioma: "es" };
}

export type OpcionesEnvio = {
  /** Instante (ms) a partir del cual no se empieza ningún envío más (para no pasarse del maxDuration). */
  hasta?: number;
};

/**
 * Procesa una lista de filas (ya cargadas) con el cliente que se le pase. Reclama cada fila
 * con un plazo de bloqueo (ver PLAZO_RECLAMO_MS): ni dos crons solapados ni «Enviar ahora»
 * a la vez que el cron mandan el mismo mensaje dos veces.
 * Lanza una excepción, sin haber reclamado nada, si no puede leer las reservas o restaurantes.
 */
export async function procesarMensajes(sb: ClienteSb, filasIn: Mensaje[], opciones: OpcionesEnvio = {}): Promise<ResultadoEnvio> {
  const out: ResultadoEnvio = { procesados: 0, enviados: 0, errores: 0, sin_proveedor: 0, cancelados: 0, omitidos: 0, detalle: [] };
  if (!filasIn.length) return out;
  const filas = [...filasIn]; // los SMS de respaldo se añaden al final y salen en la misma pasada
  const ctx = await cargarContexto(sb, filas);
  const ahora = () => new Date().toISOString();
  const anotar = (m: Mensaje, estado: string, error?: string | null) => out.detalle.push({ id: m.id, canal: m.canal, tipo: m.tipo, estado, error: error ?? null });
  // Cupo de Resend agotado en esta pasada: el resto de emails ni se intenta.
  let cupoEmail: { hasta: string; error: string } | null = null;

  for (const m of filas) {
    if (opciones.hasta && Date.now() > opciones.hasta) {
      out.omitidos++; // sin reclamar: lo coge la siguiente pasada
      continue;
    }
    if (cupoEmail && m.canal === "email") {
      out.omitidos++;
      continue;
    }
    out.procesados++;
    // Reclamar la fila con plazo: si otro proceso la cogió antes, intentos o programado_para ya no cuadran.
    const { data: reclamada } = await sb
      .from("reservas_mensajes")
      .update({ intentos: m.intentos + 1, programado_para: new Date(Date.now() + PLAZO_RECLAMO_MS).toISOString(), error: MARCA_ENVIO })
      .eq("id", m.id)
      .eq("intentos", m.intentos)
      .in("estado", ["pendiente", "sin_proveedor"])
      .lte("programado_para", new Date(Date.now() + TOLERANCIA_RELOJ_MS).toISOString())
      .select("id")
      .maybeSingle();
    if (!reclamada) {
      out.omitidos++;
      continue;
    }
    const intento = m.intentos + 1;
    // Salida de la fila: devuelve programado_para a su valor (la caducidad se mide desde ahí).
    const cerrar = (campos: Partial<Mensaje>) =>
      sb
        .from("reservas_mensajes")
        .update({ programado_para: m.programado_para, ...campos })
        .eq("id", m.id);
    const r = m.reserva_id ? (ctx.reservas.get(m.reserva_id) ?? null) : null;
    const espera = m.lista_espera_id ? (ctx.esperas.get(m.lista_espera_id) ?? null) : null;
    const rest = (m.restaurante_id ? ctx.restaurantes.get(m.restaurante_id) : undefined) ?? (r ? ctx.restaurantes.get(r.restaurante_id) : undefined) ?? null;
    const cliente = r?.reservas_clientes ?? null;

    // 1) ¿Sigue teniendo sentido mandarlo?
    const motivo = motivoCancelacion(m, r, rest, espera);
    if (motivo || !rest) {
      const err = motivo || "Restaurante no encontrado";
      await cerrar({ estado: "cancelado", error: err, intentos: m.intentos });
      out.cancelados++;
      anotar(m, "cancelado", err);
      await cerrarRespaldo(sb, m, `Tampoco salió por SMS: ${err}`);
      continue;
    }

    // 2) Enviar por canal.
    const { vars, idioma } = variablesDe(m, r, rest, espera);
    let res: Envio;
    if (m.canal === "email") res = await enviarEmail({ mensaje: m, restaurante: rest, reserva: r, cliente });
    else if (m.canal === "sms") res = await enviarSms({ mensaje: m, slug: rest.slug });
    else res = await enviarWhatsApp({ mensaje: m, vars, slug: rest.slug, idioma });

    // 3) Anotar el resultado.
    if (res.ok) {
      await cerrar({ estado: res.estado || "enviado", proveedor: res.proveedor, proveedor_id: res.proveedorId, error: null, enviado_en: ahora(), intentos: intento });
      if (m.tipo === "recordatorio" && r) {
        await sb.from("reservas_reservas").update({ recordatorio_enviado_en: ahora() }).eq("id", r.id);
      }
      out.enviados++;
      anotar(m, "enviado");
      await cerrarRespaldo(sb, m, "Enviado por SMS en su lugar.");
      continue;
    }

    // WhatsApp que no puede salir (sin proveedor, sin plantilla o rechazado) → SMS si el local lo tiene.
    const waCaido = m.canal === "whatsapp" && (res.sinProveedor || (!res.limite && (res.definitivo || intento >= MAX_INTENTOS)));
    const respaldo = waCaido ? await encolarSmsRespaldo(sb, m, rest, { vars, idioma }) : null;

    if (res.sinProveedor) {
      if (respaldo) {
        const err = `${res.error}. ${SUFIJO_RESPALDO}`;
        await cerrar({ estado: "cancelado", error: err, intentos: m.intentos });
        out.cancelados++;
        anotar(m, "cancelado", err);
        filas.push(respaldo);
        continue;
      }
      // No cuenta como intento: cuando haya claves, el cron lo coge otra vez.
      await cerrar({ estado: "sin_proveedor", error: res.error, intentos: m.intentos });
      out.sin_proveedor++;
      anotar(m, "sin_proveedor", res.error);
      continue;
    }
    if (res.limite) {
      if (res.cupo) {
        // Cupo del plan agotado: hasta que Resend lo reponga no sale ningún email más.
        const hasta = finDeCupo(res.cupo).toISOString();
        if (!cupoEmail) console.error(`[mensajeria] ${res.error}: los emails se reprograman a ${hasta}`);
        cupoEmail = { hasta, error: res.error };
        await cerrar({ estado: "pendiente", error: res.error, programado_para: hasta, intentos: m.intentos });
        anotar(m, "pendiente", res.error);
        continue;
      }
      // Límite de peticiones del proveedor: no es culpa del mensaje, no gasta intento.
      await cerrar({ estado: "pendiente", error: res.error, programado_para: new Date(Date.now() + 60000).toISOString(), intentos: m.intentos });
      anotar(m, "pendiente", `${res.error} (se reintenta en 1 min)`);
      continue;
    }
    const agotado = res.definitivo || intento >= MAX_INTENTOS;
    if (agotado) {
      const err = respaldo ? `${res.error}. ${SUFIJO_RESPALDO}` : res.error;
      await cerrar({ estado: "error", error: err, intentos: res.definitivo ? MAX_INTENTOS : intento });
      out.errores++;
      anotar(m, "error", err);
      if (respaldo) filas.push(respaldo);
      await cerrarRespaldo(sb, m, `Tampoco salió por SMS: ${res.error}`);
    } else {
      const espera = ESPERA_MIN[Math.min(intento - 1, ESPERA_MIN.length - 1)];
      await cerrar({ estado: "pendiente", error: res.error, programado_para: new Date(Date.now() + espera * 60000).toISOString(), intentos: intento });
      anotar(m, "pendiente", `${res.error} (reintento ${intento}/${MAX_INTENTOS} en ${espera} min)`);
    }
  }
  return out;
}

/**
 * Cuando termina un SMS de respaldo, actualiza el texto del WhatsApp original («Se intenta por
 * SMS.» → «Enviado por SMS en su lugar.» o «Tampoco salió por SMS: …»), para que el
 * seguimiento no diga que salió por SMS antes de saberlo. Solo actúa sobre filas de respaldo.
 */
async function cerrarRespaldo(sb: ClienteSb, sms: Mensaje, texto: string): Promise<void> {
  if (sms.canal !== "sms" || sms.asunto !== ASUNTO_RESPALDO) return;
  let q = sb.from("reservas_mensajes").select("id, error").eq("canal", "whatsapp").eq("tipo", sms.tipo).like("error", `%${SUFIJO_RESPALDO}`);
  if (sms.reserva_id) q = q.eq("reserva_id", sms.reserva_id);
  else if (sms.lista_espera_id) q = q.eq("lista_espera_id", sms.lista_espera_id);
  else q = q.eq("destinatario", sms.destinatario);
  const { data } = await q.limit(5);
  for (const w of data ?? []) {
    const nuevo = (w.error || "").replace(SUFIJO_RESPALDO, texto);
    await sb.from("reservas_mensajes").update({ error: nuevo }).eq("id", w.id).eq("error", w.error || "");
  }
}

/**
 * Un WhatsApp que no ha podido salir se manda por SMS (lo que hace Cover) si el restaurante
 * tiene SMS activo y hay remitente. El texto sale de la plantilla SMS del mismo tipo (más
 * corta); si no la hay, el del WhatsApp. No duplica: si ya hay un SMS del mismo aviso (p. ej.
 * la lista de espera, que encola los dos canales), no hace nada. Devuelve la fila nueva.
 */
export async function encolarSmsRespaldo(
  sb: ClienteSb,
  m: Mensaje,
  rest: RestauranteMsg,
  datos?: { vars: Record<string, string>; idioma: string },
): Promise<Mensaje | null> {
  if (!rest.envio_sms || !twilioCfg(rest.slug)?.sms) return null;

  let q = sb.from("reservas_mensajes").select("id").eq("canal", "sms").eq("tipo", m.tipo).neq("estado", "cancelado");
  if (m.reserva_id) q = q.eq("reserva_id", m.reserva_id);
  else if (m.lista_espera_id) q = q.eq("lista_espera_id", m.lista_espera_id);
  else q = q.eq("destinatario", m.destinatario);
  if (m.tipo === "manual" || m.tipo === "invitacion" || m.tipo === "modificacion") {
    // Avisos que pueden repetirse: solo cuenta un SMS de este mismo aviso (creado a la vez o después).
    q = q.gte("creado_en", new Date(new Date(m.creado_en).getTime() - 5 * 60000).toISOString());
  }
  if (m.tipo === "manual") q = q.eq("cuerpo", m.cuerpo);
  const { data: ya } = await q.limit(1);
  if (ya && ya.length) return null;

  let cuerpo = m.cuerpo;
  if (m.tipo !== "manual" && datos) {
    const { data: pls } = await sb
      .from("reservas_plantillas")
      .select("restaurante_id, idioma, cuerpo")
      .eq("cuenta_id", m.cuenta_id)
      .eq("activa", true)
      .eq("canal", "sms")
      .eq("tipo", m.tipo)
      .in("idioma", [datos.idioma, "es"])
      .or(`restaurante_id.eq.${rest.id},restaurante_id.is.null`);
    const pl = (pls ?? []).sort(
      (a, b) => Number(b.restaurante_id !== null) - Number(a.restaurante_id !== null) || Number(b.idioma === datos.idioma) - Number(a.idioma === datos.idioma),
    )[0];
    if (pl?.cuerpo) cuerpo = renderizar(pl.cuerpo, datos.vars).trim() || cuerpo;
  }

  const { data, error } = await sb
    .from("reservas_mensajes")
    .insert({
      cuenta_id: m.cuenta_id,
      restaurante_id: m.restaurante_id ?? rest.id,
      reserva_id: m.reserva_id,
      cliente_id: m.cliente_id,
      lista_espera_id: m.lista_espera_id,
      canal: "sms",
      tipo: m.tipo,
      destinatario: m.destinatario,
      asunto: ASUNTO_RESPALDO, // marca de respaldo (los SMS no llevan asunto)
      cuerpo,
      programado_para: new Date().toISOString(),
      creado_por: m.creado_por,
    })
    .select("*")
    .maybeSingle();
  if (error || !data) return null;
  return data as Mensaje;
}

/* ───────────────────────── Puertas de entrada ───────────────────────── */

/** Cliente con service_role (solo servidor: cron y webhooks). null si falta configuración. */
export function clienteServicioMensajeria(): ClienteSb | null {
  return crearClienteServicio();
}

/** ¿Hay algún proveedor configurado para este canal? (para el panel y para no reintentar en vano). */
export function proveedorDisponible(canal: string): boolean {
  if (canal === "email") return !!process.env.RESEND_API_KEY;
  const t = twilioCfg();
  if (!t) return false;
  const pref = canal === "sms" ? "TWILIO_SMS_FROM" : "TWILIO_WHATSAPP_FROM";
  return Object.keys(process.env).some((k) => (k === pref || k.startsWith(`${pref}_`)) && !!process.env[k]);
}

const VACIO = (): ResultadoEnvio => ({ procesados: 0, enviados: 0, errores: 0, sin_proveedor: 0, cancelados: 0, omitidos: 0, detalle: [] });

/**
 * Envía los mensajes pendientes cuya hora ha llegado (service role, todas las cuentas).
 * También recoge los 'sin_proveedor' de los canales que ya tienen claves (en WhatsApp, solo los
 * tipos que ya tienen plantilla aprobada; los demás seguirían sin poder salir).
 */
export async function enviarPendientes(limite = 40, opciones: OpcionesEnvio = {}): Promise<ResultadoEnvio & { error?: string }> {
  const sb = clienteServicioMensajeria();
  if (!sb) return { ...VACIO(), error: "config_pendiente" };
  const ahora = new Date().toISOString();
  const { data: pendientes, error } = await sb
    .from("reservas_mensajes")
    .select("*")
    .eq("estado", "pendiente")
    .lte("programado_para", ahora)
    .lt("intentos", MAX_INTENTOS)
    .order("programado_para")
    .limit(limite);
  if (error) return { ...VACIO(), error: error.message };
  let filas = (pendientes ?? []) as Mensaje[];

  for (const canal of ["email", "sms", "whatsapp"]) {
    if (filas.length >= limite || !proveedorDisponible(canal)) continue;
    let q = sb.from("reservas_mensajes").select("*").eq("estado", "sin_proveedor").eq("canal", canal).lte("programado_para", ahora);
    if (canal === "whatsapp") q = q.in("tipo", tiposWaDisponibles());
    const { data: huerfanos } = await q.order("programado_para").limit(limite - filas.length);
    filas = filas.concat((huerfanos ?? []) as Mensaje[]);
  }
  try {
    return await procesarMensajes(sb, filas, { hasta: opciones.hasta ?? Date.now() + 45000 });
  } catch (e) {
    // Lectura fallida de reservas/restaurantes: no se ha reclamado nada, la siguiente pasada lo reintenta.
    return { ...VACIO(), omitidos: filas.length, error: (e as Error).message };
  }
}

/**
 * Envía ahora unos mensajes concretos con el cliente que se le pase (desde el panel, el de
 * sesión bajo RLS). Solo coge los que estén pendientes o sin proveedor.
 */
export async function enviarMensajesPorId(sb: ClienteSb, ids: string[]): Promise<ResultadoEnvio> {
  if (!ids.length) return VACIO();
  // Solo las que ya tocan (reenviar / enviarManual las ponen a now()): una fila reclamada por el
  // cron tiene programado_para en el futuro y no se coge.
  const { data } = await sb
    .from("reservas_mensajes")
    .select("*")
    .in("id", ids)
    .in("estado", ["pendiente", "sin_proveedor"])
    .lte("programado_para", new Date(Date.now() + TOLERANCIA_RELOJ_MS).toISOString());
  return procesarSinRomper(sb, (data ?? []) as Mensaje[], 25000);
}

/**
 * Envía al momento lo que ya toca de una reserva o de una lista de espera (confirmación recién
 * encolada por el trigger, «hay mesa libre»…), sin esperar a la siguiente pasada del cron.
 * Sirve con el cliente de sesión (panel) o con el de servicio (ruta pública, dentro de after()).
 * Nunca lanza: si algo falla, el cron lo manda en ≤ 5 min.
 */
export async function enviarAhoraDe(sb: ClienteSb, d: { reservaId?: string | null; listaEsperaId?: string | null }): Promise<ResultadoEnvio> {
  if (!d.reservaId && !d.listaEsperaId) return VACIO();
  let q = sb
    .from("reservas_mensajes")
    .select("*")
    .eq("estado", "pendiente")
    .lt("intentos", MAX_INTENTOS)
    .lte("programado_para", new Date(Date.now() + TOLERANCIA_RELOJ_MS).toISOString());
  q = d.reservaId ? q.eq("reserva_id", d.reservaId) : q.eq("lista_espera_id", d.listaEsperaId as string);
  const { data, error } = await q.order("programado_para").limit(10);
  if (error || !data?.length) return VACIO();
  return procesarSinRomper(sb, data as Mensaje[], 15000);
}

/** procesarMensajes para las puertas del panel: si no puede leer el contexto, no envía y no lanza. */
async function procesarSinRomper(sb: ClienteSb, filas: Mensaje[], plazoMs: number): Promise<ResultadoEnvio> {
  try {
    return await procesarMensajes(sb, filas, { hasta: Date.now() + plazoMs });
  } catch (e) {
    console.error("[mensajeria] envío inmediato aplazado:", (e as Error).message);
    const out = VACIO();
    out.omitidos = filas.length;
    for (const m of filas) out.detalle.push({ id: m.id, canal: m.canal, tipo: m.tipo, estado: "pendiente", error: "No se ha podido leer la reserva: sale en el próximo envío" });
    return out;
  }
}

/* ───────────────────────── Respuestas de clientes (SMS / WhatsApp entrantes) ───────────────────────── */

/**
 * Un cliente contesta por SMS o WhatsApp («llegamos a las 21:30», «cancelo»): se busca el último
 * mensaje que le mandamos a ese número para saber de qué restaurante y reserva se trata, y se
 * reenvía por email a la dirección de respuesta del restaurante (responderA). Idempotente por
 * el MessageSid de Twilio (Twilio reintenta si no contestamos a tiempo).
 */
export async function reenviarRespuestaEntrante(
  sb: ClienteSb,
  d: { sid: string; de: string; cuerpo: string; canal: "sms" | "whatsapp"; adjuntos?: number },
): Promise<{ ok: boolean; motivo?: string }> {
  const tel = telE164(d.de.replace(/^whatsapp:/i, ""));
  if (!tel) return { ok: false, motivo: "telefono" };
  const dig = tel.slice(1);
  const variantes = [dig, tel];
  if (dig.startsWith("34") && dig.length === 11) variantes.push(dig.slice(2));
  const { data: ult, error } = await sb
    .from("reservas_mensajes")
    .select("reserva_id, restaurante_id, lista_espera_id")
    .in("destinatario", variantes)
    .in("canal", ["sms", "whatsapp"])
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!ult) return { ok: false, motivo: "sin_mensaje_previo" };

  let reserva: ReservaCtx | null = null;
  if (ult.reserva_id) {
    const { data } = await sb.from("reservas_reservas").select("*, reservas_clientes(*)").eq("id", ult.reserva_id).maybeSingle();
    reserva = (data as ReservaCtx | null) ?? null;
  }
  let espera: Espera | null = null;
  if (!reserva && ult.lista_espera_id) {
    const { data } = await sb.from("reservas_lista_espera").select("*").eq("id", ult.lista_espera_id).maybeSingle();
    espera = data ?? null;
  }
  const idRest = ult.restaurante_id || reserva?.restaurante_id || espera?.restaurante_id;
  if (!idRest) return { ok: false, motivo: "sin_restaurante" };
  const { data: restData } = await sb.from("reservas_restaurantes").select("*").eq("id", idRest).maybeSingle();
  if (!restData) return { ok: false, motivo: "sin_restaurante" };
  const rest = restData as RestauranteMsg;
  const destino = responderA(rest);
  const clave = process.env.RESEND_API_KEY;
  if (!destino) return { ok: false, motivo: "sin_email_respuesta" };
  if (!clave) return { ok: false, motivo: "sin_resend" };

  const via = d.canal === "whatsapp" ? "WhatsApp" : "SMS";
  const c = reserva?.reservas_clientes;
  const nombre = [c?.nombre, c?.apellidos].filter(Boolean).join(" ").trim() || espera?.nombre?.trim() || tel;
  const [a, mm, dd] = (reserva?.fecha || espera?.fecha || "").split("-");
  const cuando = a ? `${dd}/${mm}/${a}${reserva ? ` a las ${reserva.hora.slice(0, 5)}` : ""}` : "";
  const lineas = [
    `${nombre} ha contestado por ${via} a un mensaje de ${rest.nombre}:`,
    "",
    d.cuerpo.trim() || "(sin texto)",
    d.adjuntos ? `(trae ${d.adjuntos} archivo${d.adjuntos > 1 ? "s" : ""} adjunto${d.adjuntos > 1 ? "s" : ""}: se ven en Twilio)` : "",
    "",
    reserva ? `Reserva ${reserva.localizador}: ${cuando}, ${reserva.pax} pers. (${reserva.estado}).` : espera ? `Lista de espera: ${cuando}, ${espera.pax} pers.` : "",
    `Teléfono: ${tel}`,
    "",
    d.canal === "whatsapp"
      ? "Puedes contestarle por WhatsApp desde la ficha de la reserva durante las próximas 24 h (texto libre), o llamarle. Responder a este correo no le llega al cliente."
      : "Responder a este correo no le llega al cliente: llámale o escríbele desde la ficha de la reserva.",
  ].filter((l, i, arr) => l !== "" || (i > 0 && arr[i - 1] !== ""));
  const texto = lineas.join("\n");

  await turnoResend();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${clave}`, "Content-Type": "application/json", "Idempotency-Key": `rsv-in-${d.sid}` },
    body: JSON.stringify({
      from: remitenteDe(rest),
      to: [destino],
      subject: `${via} de ${nombre}${reserva ? ` · ${reserva.localizador}` : ""} · ${rest.nombre}`,
      text: texto,
      html: `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#1e2a25;max-width:560px;">${cuerpoHtml(texto, "#0F6E56")}</div>`,
      tags: [{ name: "tipo", value: "respuesta_cliente" }],
    }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`Resend ${res.status}: ${j?.message || "sin detalle"}`);
  }
  return { ok: true };
}

/* ───────────────────────── Webhooks (actualización por proveedor_id) ───────────────────────── */

/** Estado nuestro a partir del evento del proveedor; null = no cambia nada. */
export function estadoDesdeProveedor(proveedor: "resend" | "twilio", evento: string): { estado: string; error?: string } | null {
  const e = evento.toLowerCase();
  if (proveedor === "resend") {
    switch (e) {
      case "email.sent":
        return { estado: "enviado" };
      case "email.delivered":
        return { estado: "entregado" };
      case "email.opened":
      case "email.clicked":
        return { estado: "abierto" };
      case "email.bounced":
        return { estado: "error", error: "Rebotado por el servidor del destinatario" };
      case "email.complained":
        return { estado: "error", error: "Marcado como spam por el destinatario" };
      case "email.failed":
        return { estado: "error", error: "Fallo de envío en Resend" };
      default:
        return null; // delivery_delayed y otros: sin cambio
    }
  }
  switch (e) {
    case "sent":
      return { estado: "enviado" };
    case "delivered":
      return { estado: "entregado" };
    case "read":
      return { estado: "abierto" };
    case "failed":
    case "undelivered":
      return { estado: "error" };
    default:
      return null; // queued, sending, accepted…
  }
}

const RANGO = ["pendiente", "sin_proveedor", "enviado", "entregado", "abierto"];

/**
 * Aplica un evento de proveedor a la fila con ese proveedor_id. Nunca «baja» de estado
 * (un «delivered» tardío no pisa un «abierto»); el error sí manda, salvo una queja de spam
 * sobre un email ya leído, que solo se anota.
 */
export async function aplicarEventoProveedor(
  sb: ClienteSb,
  proveedor: "resend" | "twilio",
  proveedorId: string,
  evento: string,
  detalleError?: string | null,
): Promise<{ ok: boolean; id?: string; estado?: string }> {
  const cambio = estadoDesdeProveedor(proveedor, evento);
  if (!cambio) return { ok: true };
  const { data: m } = await sb.from("reservas_mensajes").select("*").eq("proveedor", proveedor).eq("proveedor_id", proveedorId).maybeSingle();
  if (!m) return { ok: false };
  const fila = m as Mensaje;
  if (fila.estado === "cancelado") return { ok: true, id: fila.id, estado: fila.estado };
  if (cambio.estado === "error") {
    const err = detalleError || cambio.error || "Error notificado por el proveedor";
    if (evento.toLowerCase() === "email.complained" && fila.estado === "abierto") {
      await sb.from("reservas_mensajes").update({ error: err }).eq("id", fila.id);
      return { ok: true, id: fila.id, estado: fila.estado };
    }
    await sb.from("reservas_mensajes").update({ estado: "error", error: err, intentos: MAX_INTENTOS }).eq("id", fila.id);
    // SMS de respaldo que tampoco llega → el WhatsApp original lo dice.
    await cerrarRespaldo(sb, fila, `Tampoco llegó por SMS: ${err}`);
    // WhatsApp que el proveedor da por fallido → respaldo por SMS (lo manda la siguiente pasada del cron).
    if (fila.canal === "whatsapp" && fila.restaurante_id) {
      try {
        const ctx = await cargarContexto(sb, [fila]);
        const restaurante = ctx.restaurantes.get(fila.restaurante_id) ?? null;
        const r = fila.reserva_id ? (ctx.reservas.get(fila.reserva_id) ?? null) : null;
        const esp = fila.lista_espera_id ? (ctx.esperas.get(fila.lista_espera_id) ?? null) : null;
        // Solo si el aviso sigue teniendo sentido (no un recordatorio de una cena ya pasada).
        if (restaurante && !motivoCancelacion({ ...fila, programado_para: new Date().toISOString() }, r, restaurante, esp)) {
          const resp = await encolarSmsRespaldo(sb, fila, restaurante, variablesDe(fila, r, restaurante, esp));
          if (resp) await sb.from("reservas_mensajes").update({ error: `${err}. ${SUFIJO_RESPALDO}` }).eq("id", fila.id);
        }
      } catch (e) {
        // Lectura fallida: sin respaldo antes que decidir con datos a medias (queda en error en el panel).
        console.error("[mensajeria] respaldo por SMS no decidido:", (e as Error).message);
      }
    }
    return { ok: true, id: fila.id, estado: "error" };
  }
  if (RANGO.indexOf(cambio.estado) <= RANGO.indexOf(fila.estado)) return { ok: true, id: fila.id, estado: fila.estado };
  await sb.from("reservas_mensajes").update({ estado: cambio.estado, error: null }).eq("id", fila.id);
  return { ok: true, id: fila.id, estado: cambio.estado };
}
