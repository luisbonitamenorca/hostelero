"use server";

/* Acciones de servidor de la mensajería desde el panel: seguimiento de los mensajes de una
   reserva, reenviar, enviar a mano (plantilla o texto libre) y previsualizar.
   Todo con el cliente de sesión bajo RLS (cuenta_id = cuenta_actual()). Nada de service key:
   el envío inmediato reutiliza el motor (lib/mensajeria) con este mismo cliente. */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables } from "@hostelero/db";
import { contentSidWa, enEnvio, enviarMensajesPorId, MAX_INTENTOS, proveedorDisponible, responderA, telE164, type ClienteSb } from "@/lib/mensajeria";
import {
  botonesPorTipo,
  enlaceGoogleCalendar,
  htmlEmail,
  idiomaDe,
  renderizar,
  TIPOS_CON_ICS,
  urlBase,
  variablesReserva,
  type ClienteMsg,
  type ReservaMsg,
  type RestauranteMsg,
} from "@/lib/mensajeria-plantillas";

async function cliente() {
  const { supabase, perfil } = await exigirModulo("reservas");
  return { sb: supabase as ClienteSb, perfil };
}

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

/** Los ids llegan del navegador: solo uuid (también evita colar condiciones en filtros .or()). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esId = (x: unknown): x is string => typeof x === "string" && UUID_RE.test(x);
const ID_MAL = { ok: false as const, error: "Identificador no válido" };
const YA_SALIENDO = "Ese mensaje está saliendo ahora mismo: espera unos segundos y mira el seguimiento.";

export type Mensaje = Tables<"reservas_mensajes">;
export type Plantilla = Tables<"reservas_plantillas">;
export type Canal = "email" | "sms" | "whatsapp";

/* ================= Seguimiento ================= */

/**
 * Todos los mensajes de una reserva (más recientes primero) y qué proveedores hay configurados,
 * para que la ficha pueda decir «SMS: sin proveedor» antes de que nadie pulse nada.
 */
export async function trackingReserva(reservaId: string) {
  const { sb } = await cliente();
  if (!esId(reservaId)) {
    return {
      mensajes: [] as Mensaje[],
      proveedores: { email: false, sms: false, whatsapp: false },
      recordatorio_enviado_en: null,
      reconfirmada_en: null,
      notificar: false,
      esCover: false,
      responder_a: null as string | null,
      aviso: "Identificador no válido" as string | null,
    };
  }
  const [{ data: mensajes }, { data: reserva }] = await Promise.all([
    sb.from("reservas_mensajes").select("*").eq("reserva_id", reservaId).order("creado_en", { ascending: false }).limit(100),
    sb.from("reservas_reservas").select("recordatorio_enviado_en, reconfirmada_en, notificar, cover_id, restaurante_id").eq("id", reservaId).maybeSingle(),
  ]);
  // ¿A dónde llegan las respuestas del cliente? Sin dirección, se avisa (Ajustes → email del local).
  let responder: string | null = null;
  if (reserva?.restaurante_id) {
    const { data: rest } = await sb.from("reservas_restaurantes").select("slug, email, email_reservas").eq("id", reserva.restaurante_id).maybeSingle();
    responder = rest ? responderA(rest) : null;
  }
  return {
    mensajes: (mensajes ?? []) as Mensaje[],
    proveedores: { email: proveedorDisponible("email"), sms: proveedorDisponible("sms"), whatsapp: proveedorDisponible("whatsapp") },
    recordatorio_enviado_en: reserva?.recordatorio_enviado_en ?? null,
    reconfirmada_en: reserva?.reconfirmada_en ?? null,
    notificar: reserva?.notificar ?? false,
    esCover: !!reserva?.cover_id,
    /** Dirección a la que llegan las respuestas del cliente (reply_to); null = nadie las recibe. */
    responder_a: responder,
    aviso: (responder ? null : "El restaurante no tiene email de respuesta: las respuestas de los clientes no le llegan. Rellénalo en Ajustes.") as string | null,
  };
}

/** Plantillas aplicables a un restaurante: las suyas pisan a las de la cuenta (canal+tipo+idioma). */
export async function plantillasPara(restauranteId: string): Promise<Plantilla[]> {
  const { sb } = await cliente();
  if (!esId(restauranteId)) return [];
  // El restaurante (bajo RLS) fija la cuenta: un operador no mezcla plantillas de otras cuentas.
  const { data: rest } = await sb.from("reservas_restaurantes").select("id, cuenta_id").eq("id", restauranteId).maybeSingle();
  if (!rest) return [];
  const { data } = await sb
    .from("reservas_plantillas")
    .select("*")
    .eq("activa", true)
    .eq("cuenta_id", rest.cuenta_id)
    .or(`restaurante_id.eq.${restauranteId},restaurante_id.is.null`)
    .order("canal")
    .order("tipo")
    .order("idioma");
  const vistas = new Map<string, Plantilla>();
  for (const p of (data ?? []) as Plantilla[]) {
    const k = `${p.canal}|${p.tipo}|${p.idioma}`;
    const prev = vistas.get(k);
    if (!prev || (prev.restaurante_id === null && p.restaurante_id !== null)) vistas.set(k, p);
  }
  return [...vistas.values()];
}

/* ================= Contexto ================= */

type Ctx = { reserva: ReservaMsg; cliente: ClienteMsg | null; restaurante: RestauranteMsg };

async function contextoReserva(sb: ClienteSb, reservaId: string): Promise<Ctx | null> {
  const { data: r } = await sb.from("reservas_reservas").select("*, reservas_clientes(*)").eq("id", reservaId).maybeSingle();
  if (!r) return null;
  const { data: rest } = await sb.from("reservas_restaurantes").select("*").eq("id", r.restaurante_id).maybeSingle();
  if (!rest) return null;
  const { reservas_clientes, ...reserva } = r as ReservaMsg & { reservas_clientes: ClienteMsg | null };
  return { reserva, cliente: reservas_clientes ?? null, restaurante: rest as RestauranteMsg };
}

/** Misma regla de elección que reservas_mensaje_encolar: restaurante > cuenta; idioma > 'es'. */
async function elegirPlantilla(sb: ClienteSb, ctx: Ctx, canal: Canal, tipo: string): Promise<Plantilla | null> {
  const idioma = idiomaDe(ctx.reserva.idioma, ctx.cliente?.idioma);
  const { data } = await sb
    .from("reservas_plantillas")
    .select("*")
    .eq("activa", true)
    .eq("cuenta_id", ctx.restaurante.cuenta_id)
    .eq("canal", canal)
    .eq("tipo", tipo)
    .in("idioma", [idioma, "es"])
    .or(`restaurante_id.eq.${ctx.restaurante.id},restaurante_id.is.null`);
  const lista = (data ?? []) as Plantilla[];
  lista.sort((a, b) => Number(b.restaurante_id !== null) - Number(a.restaurante_id !== null) || Number(b.idioma === idioma) - Number(a.idioma === idioma));
  return lista[0] ?? null;
}

function destinatarioPorDefecto(ctx: Ctx, canal: Canal): string | null {
  if (canal === "email") return (ctx.cliente?.email || "").trim().toLowerCase() || null;
  const t = ctx.cliente?.telefono_norm || (ctx.cliente?.telefono || "").replace(/\D/g, "");
  return t ? t : null;
}

function renderConCtx(ctx: Ctx, canal: Canal, tipo: string, asunto: string | null, cuerpo: string, mensajeExtra?: string | null) {
  const vars = variablesReserva({ reserva: ctx.reserva, cliente: ctx.cliente, restaurante: ctx.restaurante, mensajeExtra });
  vars.enlace_reservar = `${urlBase(ctx.restaurante)}/reservar-mesa/${ctx.restaurante.slug}`;
  const idioma = idiomaDe(ctx.reserva.idioma, ctx.cliente?.idioma);
  const asuntoR = canal === "email" ? renderizar(asunto, vars) || `${ctx.restaurante.nombre} · ${ctx.reserva.localizador}` : null;
  const cuerpoR = renderizar(cuerpo, vars);
  let html: string | null = null;
  if (canal === "email") {
    const calendario = TIPOS_CON_ICS.has(tipo) ? enlaceGoogleCalendar({ reserva: ctx.reserva, restaurante: ctx.restaurante, idioma }) : null;
    html = htmlEmail({ restaurante: ctx.restaurante, cuerpo: cuerpoR, botones: botonesPorTipo(tipo, vars, idioma, calendario), idioma });
  }
  return { asunto: asuntoR, cuerpo: cuerpoR, html, vars, idioma };
}

/* ================= Previsualizar ================= */

/**
 * Cómo quedaría una plantilla para una reserva concreta: asunto y cuerpo renderizados y, en
 * email, el HTML de marca completo (para un iframe en el panel). También dice a quién iría.
 */
export async function previsualizar(
  plantillaId: string,
  reservaId: string,
): Promise<R<{ canal: Canal; tipo: string; asunto: string | null; cuerpo: string; html: string | null; destinatario: string | null; nota: string | null }>> {
  const { sb } = await cliente();
  if (!esId(plantillaId) || !esId(reservaId)) return ID_MAL;
  const [{ data: p }, ctx] = await Promise.all([sb.from("reservas_plantillas").select("*").eq("id", plantillaId).maybeSingle(), contextoReserva(sb, reservaId)]);
  if (!p) return { ok: false, error: "Plantilla no encontrada" };
  if (!ctx) return { ok: false, error: "Reserva no encontrada" };
  const canal = p.canal as Canal;
  const r = renderConCtx(ctx, canal, p.tipo, p.asunto, p.cuerpo);
  // En WhatsApp lo que llega es la plantilla aprobada en Meta, no este texto: se avisa.
  let nota: string | null = null;
  if (canal === "whatsapp" && p.tipo !== "manual") {
    nota = contentSidWa(p.tipo, r.idioma)
      ? "En WhatsApp se envía la plantilla aprobada en Meta con estos datos; el texto final es el de esa plantilla."
      : "No hay plantilla de WhatsApp aprobada para este aviso: si el local tiene SMS activo, saldrá por SMS.";
  } else if (canal === "sms") {
    const largo = [...r.cuerpo].length;
    const gsm = /^[\x20-\x7E\n\r£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€]*$/.test(r.cuerpo);
    const porSms = gsm ? (largo <= 160 ? 160 : 153) : largo <= 70 ? 70 : 67;
    const partes = Math.max(1, Math.ceil(largo / porSms));
    if (partes > 1) nota = `Este SMS ocupa ${partes} mensajes (${largo} caracteres${gsm ? "" : ", con caracteres especiales"}): se cobra cada uno.`;
  }
  return { ok: true, data: { canal, tipo: p.tipo, asunto: r.asunto, cuerpo: r.cuerpo, html: r.html, destinatario: destinatarioPorDefecto(ctx, canal), nota } };
}

/* ================= Enviar a mano ================= */

export type EnvioManual = {
  /** Tipo de plantilla (confirmacion, recordatorio, …). Si no se da, es texto libre (tipo 'manual'). */
  tipo?: string | null;
  /** Texto libre (admite {{nombre}}, {{fecha}}, … como las plantillas). */
  texto?: string | null;
  asunto?: string | null;
  /** Destinatario distinto del cliente (p. ej. otro email). Por defecto el del cliente. */
  destinatario?: string | null;
  /** false = solo encolar (lo mandará el cron en ≤ 5 min). Por defecto se envía ahora. */
  ahora?: boolean;
};

/**
 * Encola y envía un mensaje a mano para una reserva. Con `tipo` usa la plantilla de ese tipo
 * (restaurante → cuenta, idioma del cliente); si ya había uno de ese tipo pendiente en cola,
 * se manda ese ahora en vez de duplicarlo. Sin `tipo`, texto libre (tipo 'manual').
 */
export async function enviarManual(reservaId: string, canal: Canal, contenido: EnvioManual): Promise<R<{ id: string; estado: string; error?: string | null }>> {
  const { sb, perfil } = await cliente();
  if (!esId(reservaId)) return ID_MAL;
  if (!["email", "sms", "whatsapp"].includes(canal)) return { ok: false, error: "Canal no válido" };
  const ctx = await contextoReserva(sb, reservaId);
  if (!ctx) return { ok: false, error: "Reserva no encontrada" };

  const destinatario = (contenido.destinatario || "").trim() || destinatarioPorDefecto(ctx, canal);
  if (!destinatario) return { ok: false, error: canal === "email" ? "El cliente no tiene email" : "El cliente no tiene teléfono" };
  if (canal === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(destinatario)) return { ok: false, error: "Email no válido" };
  if (canal !== "email" && !telE164(destinatario)) return { ok: false, error: "Teléfono no válido" };

  let tipo = "manual";
  let asunto: string | null = contenido.asunto ?? null;
  let cuerpo = (contenido.texto || "").trim();
  if (contenido.tipo && contenido.tipo !== "manual") {
    const p = await elegirPlantilla(sb, ctx, canal, contenido.tipo);
    if (!p) return { ok: false, error: `No hay plantilla de «${contenido.tipo}» para ${canal}` };
    tipo = p.tipo;
    asunto = p.asunto;
    cuerpo = p.cuerpo;
  }
  if (!cuerpo) return { ok: false, error: "El mensaje está vacío" };
  const r = renderConCtx(ctx, canal, tipo, asunto, cuerpo, contenido.texto && tipo !== "manual" ? contenido.texto : undefined);
  if (canal === "email" && !r.asunto) r.asunto = `${ctx.restaurante.nombre} · ${ctx.reserva.localizador}`;

  const destinoNorm = canal === "email" ? destinatario.toLowerCase() : destinatario.replace(/\D/g, "") || destinatario;
  const { data: fila, error } = await sb
    .from("reservas_mensajes")
    .insert({
      restaurante_id: ctx.restaurante.id,
      reserva_id: ctx.reserva.id,
      cliente_id: ctx.reserva.cliente_id,
      canal,
      tipo,
      destinatario: destinoNorm,
      asunto: r.asunto,
      cuerpo: r.cuerpo,
      programado_para: new Date().toISOString(),
      creado_por: perfil.id,
    })
    .select("id")
    .single();

  let id = fila?.id ?? null;
  if (error) {
    if (error.code !== "23505") return { ok: false, error: error.message };
    // Ya había uno de este tipo en cola para la reserva (p. ej. el recordatorio programado): se
    // manda ahora ESE, pero con lo que se acaba de componer (destinatario, asunto y texto).
    const { data: pend } = await sb
      .from("reservas_mensajes")
      .select("id, intentos, programado_para, error")
      .eq("reserva_id", reservaId)
      .eq("canal", canal)
      .eq("tipo", tipo)
      .eq("estado", "pendiente")
      .maybeSingle();
    if (!pend) return { ok: false, error: "Ya hay un mensaje de este tipo pendiente de envío" };
    if (enEnvio(pend)) return { ok: false, error: YA_SALIENDO };
    // Lo manda una persona: cuenta como manual (la regla de Cover no lo frena). La condición sobre
    // intentos y programado_para evita pisar una fila que el cron acaba de coger.
    const { data: puesta } = await sb
      .from("reservas_mensajes")
      .update({ creado_por: perfil.id, destinatario: destinoNorm, asunto: r.asunto, cuerpo: r.cuerpo, programado_para: new Date().toISOString() })
      .eq("id", pend.id)
      .eq("estado", "pendiente")
      .eq("intentos", pend.intentos)
      .eq("programado_para", pend.programado_para)
      .select("id")
      .maybeSingle();
    if (!puesta) return { ok: false, error: YA_SALIENDO };
    id = pend.id;
  }
  if (!id) return { ok: false, error: "No se ha podido encolar el mensaje" };
  if (contenido.ahora === false) return { ok: true, data: { id, estado: "pendiente" } };

  const res = await enviarMensajesPorId(sb, [id]);
  const d = res.detalle.find((x) => x.id === id);
  return { ok: true, data: { id, estado: d?.estado ?? "pendiente", error: d?.error ?? null } };
}

/* ================= Reenviar y cancelar ================= */

/**
 * Vuelve a mandar un mensaje ya enviado o fallido: crea una copia nueva (mismo canal, tipo,
 * destinatario y texto) y la envía ahora. El original se conserva en el seguimiento.
 * Si el mensaje aún está pendiente o sin proveedor, simplemente se intenta ahora.
 */
export async function reenviar(mensajeId: string): Promise<R<{ id: string; estado: string; error?: string | null }>> {
  const { sb, perfil } = await cliente();
  if (!esId(mensajeId)) return ID_MAL;
  const { data: m } = await sb.from("reservas_mensajes").select("*").eq("id", mensajeId).maybeSingle();
  if (!m) return { ok: false, error: "Mensaje no encontrado" };
  const orig = m as Mensaje;

  let id = orig.id;
  if (orig.estado === "pendiente" || orig.estado === "sin_proveedor") {
    // Reintento inmediato del mismo, como envío manual (si había agotado los intentos, se le da margen).
    // Si el cron la tiene cogida (o la coge entre medias), no se toca: saldría dos veces.
    if (enEnvio(orig)) return { ok: false, error: YA_SALIENDO };
    const { data: puesta } = await sb
      .from("reservas_mensajes")
      .update({
        programado_para: new Date().toISOString(),
        creado_por: orig.creado_por ?? perfil.id,
        ...(orig.intentos >= MAX_INTENTOS ? { intentos: 0 } : {}),
      })
      .eq("id", id)
      .eq("estado", orig.estado)
      .eq("intentos", orig.intentos)
      .eq("programado_para", orig.programado_para)
      .select("id")
      .maybeSingle();
    if (!puesta) return { ok: false, error: YA_SALIENDO };
  } else {
    const { data: nuevo, error } = await sb
      .from("reservas_mensajes")
      .insert({
        restaurante_id: orig.restaurante_id,
        reserva_id: orig.reserva_id,
        cliente_id: orig.cliente_id,
        lista_espera_id: orig.lista_espera_id,
        canal: orig.canal,
        tipo: orig.tipo,
        destinatario: orig.destinatario,
        asunto: orig.asunto,
        cuerpo: orig.cuerpo,
        programado_para: new Date().toISOString(),
        creado_por: perfil.id,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return { ok: false, error: "Ya hay un mensaje de este tipo pendiente de envío" };
      return { ok: false, error: error.message };
    }
    id = nuevo.id;
  }
  const res = await enviarMensajesPorId(sb, [id]);
  const d = res.detalle.find((x) => x.id === id);
  return { ok: true, data: { id, estado: d?.estado ?? "pendiente", error: d?.error ?? null } };
}

/** Cancela un mensaje que aún no ha salido (pendiente o sin proveedor). */
export async function cancelarMensaje(mensajeId: string): Promise<R> {
  const { sb } = await cliente();
  if (!esId(mensajeId)) return ID_MAL;
  const { data, error } = await sb
    .from("reservas_mensajes")
    .update({ estado: "cancelado", error: "Cancelado desde el panel" })
    .eq("id", mensajeId)
    .in("estado", ["pendiente", "sin_proveedor"])
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "El mensaje ya había salido" };
  return { ok: true };
}
