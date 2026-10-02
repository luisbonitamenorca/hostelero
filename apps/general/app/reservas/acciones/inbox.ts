"use server";

/* Acciones de servidor de la sección Inbox del panel de Reservas.
   Todo pasa por el cliente autenticado bajo RLS (cuenta_id = cuenta_actual()). Sin service key.
   El Inbox no tiene tabla propia: es una lectura cruzada de reservas, historial, mensajes y
   lista de espera de los últimos días. El «leído» vive en el navegador (localStorage), no aquí.
   Lo que requiere acción (online pendientes, tarjeta sin introducir, «a revisar») se lee aparte,
   sin depender del periodo elegido, para que nunca se pierda por el límite de filas. */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables } from "@hostelero/db";
import { reenviar as reenviarMensaje } from "./mensajes";

async function cliente() {
  const { supabase, perfil } = await exigirModulo("reservas");
  return { sb: supabase, perfil };
}
type Sb = Awaited<ReturnType<typeof cliente>>["sb"];
type Perfil = Awaited<ReturnType<typeof cliente>>["perfil"];

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

/* ================= Permisos de sala (reservas_permisos_perfil) =================
   Mismo criterio que acciones/dia.ts: dirección pasa siempre; sin fila, todo permitido;
   con fila, se exige el flag (si se pide) y que el restaurante esté en su lista (si no es null).
   Privado a este fichero (en un "use server" todo lo exportado es una acción pública);
   el integrador lo consolidará con el de dia.ts. */

type PermisoSala = "puede_cambiar_estado" | null;

/** Restaurantes permitidos al perfil: null = todos. */
async function restaurantesPermitidos(sb: Sb, perfil: Perfil): Promise<string[] | null> {
  if (perfil.rol === "direccion") return null;
  const { data } = await sb.from("reservas_permisos_perfil").select("restaurantes").eq("perfil_id", perfil.id).maybeSingle();
  return data?.restaurantes ?? null;
}

/** Devuelve un mensaje de error si el perfil no puede actuar; null si puede. */
async function exigirPermisoSala(sb: Sb, perfil: Perfil, permiso: PermisoSala, restauranteId: string | null): Promise<string | null> {
  if (perfil.rol === "direccion") return null;
  const { data } = await sb
    .from("reservas_permisos_perfil")
    .select("puede_cambiar_estado, restaurantes")
    .eq("perfil_id", perfil.id)
    .maybeSingle();
  if (!data) return null;
  if (permiso === "puede_cambiar_estado" && !data.puede_cambiar_estado) return "No tienes permiso para cambiar el estado de las reservas.";
  if (restauranteId && data.restaurantes && !data.restaurantes.includes(restauranteId)) return "No tienes permiso sobre este restaurante.";
  return null;
}

/* ================= Fecha de hoy en la zona del restaurante ================= */

const ZONA_DEFECTO = "Europe/Madrid";
function hoyEnZona(zona: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: zona || ZONA_DEFECTO, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: ZONA_DEFECTO, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
}
/** "YYYY-MM-DD" − n días (aritmética en UTC a mediodía: sin saltos de horario). */
function restarDias(fecha: string, n: number): string {
  const d = new Date(fecha + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/* ================= Tipos ================= */

export type TipoNovedad =
  | "nueva" // reserva online nueva (pendiente o ya confirmada)
  | "grupo" // solicitud de grupo grande (online, sin mesa, pendiente de contestar)
  | "tarjeta" // reserva en tarjeta_pendiente: el cliente aún no ha metido la tarjeta
  | "pago" // pago fallido o cargo de no show
  | "cancelacion"
  | "modificacion" // cambio de fecha/hora/pax hecho por el cliente (enlace de gestión)
  | "mensaje_error" // mensaje que no se ha podido enviar (o resumen de «sin proveedor» por canal)
  | "valoracion"
  | "a_revisar" // hora pasada sin llegada
  | "espera"; // lista de espera: solicitud nueva o aviso enviado

export type ClienteInbox = Pick<
  Tables<"reservas_clientes">,
  "id" | "nombre" | "apellidos" | "telefono" | "email" | "vip" | "lista_negra" | "alergias" | "idioma"
>;

/* Sin `token`: es la llave del enlace de gestión del cliente y el Inbox no la necesita
   (el enlace de tarjeta se pide aparte con enlaceTarjeta). */
export type ReservaInbox = Pick<
  Tables<"reservas_reservas">,
  | "id" | "restaurante_id" | "fecha" | "hora" | "pax" | "estado" | "localizador" | "mesa_id" | "origen" | "canal"
  | "tipo" | "estado_pago" | "notas_cliente" | "notas_internas" | "alergias" | "valoracion" | "valoracion_comentario"
  | "valoracion_detalle" | "valoracion_en" | "cancelada_en" | "cancelada_por" | "motivo_cancelacion" | "creado_en"
  | "actualizado_en" | "idioma"
> & { reservas_clientes: ClienteInbox | null };

export type MensajeInbox = Pick<
  Tables<"reservas_mensajes">,
  "id" | "canal" | "tipo" | "destinatario" | "asunto" | "estado" | "error" | "intentos" | "creado_en" | "reserva_id" | "lista_espera_id" | "restaurante_id"
>;

export type EsperaInbox = Pick<
  Tables<"reservas_lista_espera">,
  "id" | "restaurante_id" | "fecha" | "nombre" | "telefono" | "pax" | "estado" | "hora_preferida" | "notas" | "creado_en" | "avisado_en" | "reserva_id"
>;

/** Cambio concreto de una modificación: campo → antes / después. */
export type CambioInbox = { campo: "fecha" | "hora" | "pax"; antes: string; despues: string };

export type Novedad = {
  /** Clave estable (tipo + id de origen): es lo que se guarda como «leído». */
  id: string;
  tipo: TipoNovedad;
  /** Instante de la novedad (ISO). */
  ts: string;
  restaurante_id: string | null;
  /** true = requiere una acción de la sala (confirmar, reintentar…). */
  pendiente: boolean;
  reserva?: ReservaInbox | null;
  mensaje?: MensajeInbox | null;
  espera?: EsperaInbox | null;
  cambios?: CambioInbox[];
  /** Quién hizo el cambio en una modificación: cliente (enlace de gestión) o sistema. */
  autor?: "cliente" | "sistema" | null;
  /** Fila resumen (mensajes «sin proveedor» de un canal): cuántos hay agrupados. */
  total?: number;
};

const CAMPOS_RESERVA =
  "id, restaurante_id, fecha, hora, pax, estado, localizador, mesa_id, origen, canal, tipo, estado_pago, " +
  "notas_cliente, notas_internas, alergias, valoracion, valoracion_comentario, valoracion_detalle, valoracion_en, " +
  "cancelada_en, cancelada_por, motivo_cancelacion, creado_en, actualizado_en, idioma, " +
  "reservas_clientes(id, nombre, apellidos, telefono, email, vip, lista_negra, alergias, idioma)";

const CAMPOS_MENSAJE = "id, canal, tipo, destinatario, asunto, estado, error, intentos, creado_en, reserva_id, lista_espera_id, restaurante_id";
const CAMPOS_ESPERA = "id, restaurante_id, fecha, nombre, telefono, pax, estado, hora_preferida, notas, creado_en, avisado_en, reserva_id";

/** Límite del histórico informativo (lo que requiere acción va con LIMITE_ACCION). */
const LIMITE = 300;
const LIMITE_ACCION = 1000;
/** «A revisar» antiguas: se miran hasta 60 días atrás aunque el periodo sea menor. */
const DIAS_REVISAR = 60;
const esGrupo = (r: { notas_internas: string | null }) => /^Solicitud de grupo grande/i.test(r.notas_internas ?? "");

/* ================= Lectura ================= */

/** Novedades desde `desde` (ISO) para un restaurante o para todos (null). Ordenadas: lo que
    requiere acción primero y, dentro, de más reciente a más antigua. `truncado` = alguna
    consulta del histórico llegó al límite (hay más de lo que se muestra). */
export async function novedades(restauranteId: string | null, desde: string): Promise<R<Novedad[]> & { truncado?: boolean }> {
  const { sb, perfil } = await cliente();

  // Restaurantes visibles para este perfil (Ajustes › Permisos).
  const permitidos = await restaurantesPermitidos(sb, perfil);
  if (restauranteId && permitidos && !permitidos.includes(restauranteId)) return { ok: false, error: "No tienes permiso sobre este restaurante." };
  if (!restauranteId && permitidos && !permitidos.length) return { ok: true, data: [] };
  const conRest = <Q extends { eq: (c: string, v: string) => Q; in: (c: string, v: string[]) => Q }>(q: Q): Q =>
    restauranteId ? q.eq("restaurante_id", restauranteId) : permitidos ? q.in("restaurante_id", permitidos) : q;

  // «Hoy» por restaurante (zona horaria propia); para las consultas, el más temprano menos un día.
  const restsQ = await (restauranteId
    ? sb.from("reservas_restaurantes").select("id, zona_horaria").eq("id", restauranteId)
    : permitidos
      ? sb.from("reservas_restaurantes").select("id, zona_horaria").in("id", permitidos)
      : sb.from("reservas_restaurantes").select("id, zona_horaria"));
  const zonas = new Map<string, string>((restsQ.data ?? []).map((x) => [x.id, x.zona_horaria]));
  const hoyDe = (rid: string | null) => hoyEnZona(rid ? zonas.get(rid) : null);
  const hoyMin = restarDias(hoyEnZona(ZONA_DEFECTO), 1);

  const [nuevas, pendientes, canceladas, historial, mensajes, sinProv, valoradas, revisar, pagos, esperaNueva, esperaAvisada] = await Promise.all([
    // Histórico: reservas online nacidas en el periodo (pendientes, confirmadas, solicitudes de grupo…)
    conRest(sb.from("reservas_reservas").select(CAMPOS_RESERVA).eq("origen", "online").gte("creado_en", desde))
      .order("creado_en", { ascending: false }).limit(LIMITE),
    // Requieren acción, sin depender del periodo: online sin contestar y reservas esperando tarjeta,
    // de hoy en adelante.
    conRest(
      sb.from("reservas_reservas").select(CAMPOS_RESERVA)
        .or("and(origen.eq.online,estado.eq.pendiente),estado.eq.tarjeta_pendiente").gte("fecha", hoyMin),
    ).order("fecha").order("hora").limit(LIMITE_ACCION),
    conRest(sb.from("reservas_reservas").select(CAMPOS_RESERVA).eq("estado", "cancelada").gte("cancelada_en", desde))
      .order("cancelada_en", { ascending: false }).limit(LIMITE),
    // Modificaciones de fecha/hora/pax sin usuario (enlace de gestión del cliente). Las del panel
    // no se listan: son acciones propias de la sala.
    conRest(
      sb.from("reservas_reservas_historial").select("id, reserva_id, restaurante_id, campos, antes, despues, ts, user_id")
        .eq("accion", "update").is("user_id", null).overlaps("campos", ["fecha", "hora", "pax"]).gte("ts", desde),
    ).order("ts", { ascending: false }).limit(LIMITE),
    // Mensajes con error de verdad (el cron agotó sus intentos).
    conRest(sb.from("reservas_mensajes").select(CAMPOS_MENSAJE).eq("estado", "error").gte("creado_en", desde))
      .order("creado_en", { ascending: false }).limit(LIMITE),
    // «Sin proveedor» no es un error: el cron los manda cuando haya claves. Solo se resumen por canal.
    conRest(sb.from("reservas_mensajes").select(CAMPOS_MENSAJE).eq("estado", "sin_proveedor").gte("creado_en", desde))
      .order("creado_en", { ascending: false }).limit(LIMITE_ACCION),
    conRest(sb.from("reservas_reservas").select(CAMPOS_RESERVA).not("valoracion", "is", null).gte("valoracion_en", desde))
      .order("valoracion_en", { ascending: false }).limit(LIMITE),
    // «A revisar»: requieren acción, así que se miran más atrás que el periodo.
    conRest(sb.from("reservas_reservas").select(CAMPOS_RESERVA).eq("estado", "a_revisar").gte("fecha", restarDias(hoyMin, DIAS_REVISAR)))
      .order("fecha", { ascending: false }).order("hora", { ascending: false }).limit(LIMITE_ACCION),
    // Pagos fallidos y cargos de no show del periodo.
    conRest(sb.from("reservas_reservas").select(CAMPOS_RESERVA).in("estado_pago", ["fallido", "cobrado_noshow"]).gte("actualizado_en", desde))
      .order("actualizado_en", { ascending: false }).limit(LIMITE),
    conRest(sb.from("reservas_lista_espera").select(CAMPOS_ESPERA).gte("creado_en", desde))
      .order("creado_en", { ascending: false }).limit(LIMITE),
    conRest(sb.from("reservas_lista_espera").select(CAMPOS_ESPERA).gte("avisado_en", desde))
      .order("avisado_en", { ascending: false }).limit(LIMITE),
  ]);

  const todas = [nuevas, pendientes, canceladas, historial, mensajes, sinProv, valoradas, revisar, pagos, esperaNueva, esperaAvisada];
  const fallo = todas.find((x) => x.error);
  if (fallo?.error) return { ok: false, error: fallo.error.message };
  const truncado = [nuevas, canceladas, historial, mensajes, valoradas, pagos, esperaNueva, esperaAvisada].some((x) => (x.data?.length ?? 0) >= LIMITE);

  // Reservas que referencian el historial y los mensajes (sin FK embebible en el historial).
  const idsExtra = new Set<string>();
  (historial.data ?? []).forEach((h) => idsExtra.add(h.reserva_id));
  (mensajes.data ?? []).forEach((m) => { if (m.reserva_id) idsExtra.add(m.reserva_id); });
  const porId = new Map<string, ReservaInbox>();
  const registrar = (xs: unknown[] | null | undefined) => (xs as ReservaInbox[] | null | undefined)?.forEach((r) => porId.set(r.id, r));
  registrar(nuevas.data); registrar(pendientes.data); registrar(canceladas.data); registrar(valoradas.data); registrar(revisar.data); registrar(pagos.data);
  const faltan = [...idsExtra].filter((id) => !porId.has(id));
  if (faltan.length) {
    const { data } = await sb.from("reservas_reservas").select(CAMPOS_RESERVA).in("id", faltan.slice(0, 500));
    registrar(data);
  }

  const out: Novedad[] = [];

  // Online y tarjeta: histórico + requieren acción, fusionados por reserva.
  const vistas = new Set<string>();
  const online = [...((pendientes.data ?? []) as unknown as ReservaInbox[]), ...((nuevas.data ?? []) as unknown as ReservaInbox[])];
  online.forEach((r) => {
    if (vistas.has(r.id)) return;
    vistas.add(r.id);
    const futura = r.fecha >= hoyDe(r.restaurante_id);
    if (r.estado === "tarjeta_pendiente") {
      out.push({ id: `tarjeta:${r.id}`, tipo: "tarjeta", ts: r.creado_en, restaurante_id: r.restaurante_id, pendiente: futura, reserva: r });
      return;
    }
    const grupo = esGrupo(r);
    out.push({
      id: `${grupo ? "grupo" : "nueva"}:${r.id}`,
      tipo: grupo ? "grupo" : "nueva",
      ts: r.creado_en,
      restaurante_id: r.restaurante_id,
      pendiente: r.estado === "pendiente" && futura,
      reserva: r,
    });
  });
  (canceladas.data as unknown as ReservaInbox[]).forEach((r) => {
    out.push({ id: `cancel:${r.id}`, tipo: "cancelacion", ts: r.cancelada_en ?? r.actualizado_en, restaurante_id: r.restaurante_id, pendiente: false, reserva: r });
  });
  (historial.data ?? []).forEach((h) => {
    const r = porId.get(h.reserva_id);
    if (!r) return;
    const antes = (h.antes ?? {}) as Record<string, unknown>;
    const despues = (h.despues ?? {}) as Record<string, unknown>;
    const cambios: CambioInbox[] = (["fecha", "hora", "pax"] as const)
      .filter((c) => (h.campos ?? []).includes(c))
      .map((c) => ({ campo: c, antes: String(antes[c] ?? ""), despues: String(despues[c] ?? "") }));
    if (!cambios.length) return;
    out.push({ id: `mod:${h.id}`, tipo: "modificacion", ts: h.ts, restaurante_id: h.restaurante_id ?? r.restaurante_id, pendiente: false, reserva: r, cambios, autor: "cliente" });
  });
  (mensajes.data ?? []).forEach((m) => {
    out.push({ id: `msg:${m.id}`, tipo: "mensaje_error", ts: m.creado_en, restaurante_id: m.restaurante_id, pendiente: true, mensaje: m, reserva: m.reserva_id ? porId.get(m.reserva_id) ?? null : null });
  });
  // Una fila resumen por restaurante y canal; el id es estable para que, una vez leída, no
  // vuelva a contar como nueva con cada mensaje que se sume.
  const resumen = new Map<string, { m: MensajeInbox; total: number }>();
  (sinProv.data ?? []).forEach((m) => {
    const k = `${m.restaurante_id ?? "-"}:${m.canal}`;
    const ya = resumen.get(k);
    if (ya) ya.total++;
    else resumen.set(k, { m, total: 1 }); // vienen de más reciente a más antiguo: el primero es el último
  });
  resumen.forEach(({ m, total }, k) => {
    out.push({ id: `sinprov:${k}`, tipo: "mensaje_error", ts: m.creado_en, restaurante_id: m.restaurante_id, pendiente: false, mensaje: m, total });
  });
  (valoradas.data as unknown as ReservaInbox[]).forEach((r) => {
    // 3 estrellas o menos: pendiente de respuesta (la sección la saca de «Requieren acción» al leerla).
    const baja = (r.valoracion ?? 5) <= 3;
    out.push({ id: `val:${r.id}`, tipo: "valoracion", ts: r.valoracion_en ?? r.actualizado_en, restaurante_id: r.restaurante_id, pendiente: baja, reserva: r });
  });
  (revisar.data as unknown as ReservaInbox[]).forEach((r) => {
    out.push({ id: `rev:${r.id}`, tipo: "a_revisar", ts: r.actualizado_en, restaurante_id: r.restaurante_id, pendiente: true, reserva: r });
  });
  (pagos.data as unknown as ReservaInbox[]).forEach((r) => {
    out.push({ id: `pago:${r.id}:${r.estado_pago}`, tipo: "pago", ts: r.actualizado_en, restaurante_id: r.restaurante_id, pendiente: r.estado_pago === "fallido" && r.fecha >= hoyDe(r.restaurante_id), reserva: r });
  });
  (esperaNueva.data ?? []).forEach((e) => {
    out.push({ id: `esp:${e.id}:nueva`, tipo: "espera", ts: e.creado_en, restaurante_id: e.restaurante_id, pendiente: e.estado === "esperando" && e.fecha >= hoyDe(e.restaurante_id), espera: e });
  });
  (esperaAvisada.data ?? []).forEach((e) => {
    if (!e.avisado_en) return;
    out.push({ id: `esp:${e.id}:aviso`, tipo: "espera", ts: e.avisado_en, restaurante_id: e.restaurante_id, pendiente: false, espera: e });
  });

  out.sort((a, b) => (a.pendiente === b.pendiente ? (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0) : a.pendiente ? -1 : 1));
  return { ok: true, data: out, truncado };
}

/* ================= Escrituras =================
   Todas condicionales sobre el estado de partida (.in("estado", …) + .select("id")): si entre la
   lectura del Inbox y el clic la reserva ha cambiado (el cliente cancela, el cron marca no show…),
   no se pisa: se avisa de que hay que actualizar. */

const CAMBIADA = "La reserva ha cambiado mientras tanto: actualiza el Inbox.";

/** Restaurante de una reserva (y de paso comprueba que existe y es de la cuenta). */
async function restDeReserva(sb: Sb, id: string): Promise<{ restaurante_id: string; estado: string } | null> {
  const { data } = await sb.from("reservas_reservas").select("restaurante_id, estado").eq("id", id).maybeSingle();
  return data ?? null;
}

/** Acepta una reserva online pendiente (o una solicitud de grupo, o una «a revisar» que sigue en
    pie). Una reserva en tarjeta_pendiente NO se confirma aquí: la garantía la pone el cliente al
    meter la tarjeta. El trigger de mensajería avisa al cliente porque las online nacen con notificar. */
export async function confirmarReserva(id: string): Promise<R> {
  const { sb, perfil } = await cliente();
  const r = await restDeReserva(sb, id);
  if (!r) return { ok: false, error: "La reserva ya no existe." };
  const sinPermiso = await exigirPermisoSala(sb, perfil, "puede_cambiar_estado", r.restaurante_id);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  if (r.estado === "tarjeta_pendiente") return { ok: false, error: "Falta la tarjeta del cliente: reenvíale el enlace o libera la reserva." };
  const { data, error } = await sb
    .from("reservas_reservas")
    .update({ estado: "confirmada", actualizado_en: new Date().toISOString() })
    .eq("id", id)
    .in("estado", ["pendiente", "a_revisar"])
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: `La reserva ya está «${r.estado}»: no hay nada que confirmar. Actualiza el Inbox.` };
  return { ok: true };
}

/** Rechaza (cancela) una reserva con motivo interno. Cancelada avisa siempre al cliente (trigger),
    pero la plantilla no incluye el motivo: queda solo para la sala. */
export async function rechazarReserva(id: string, motivo: string): Promise<R> {
  const { sb, perfil } = await cliente();
  const r = await restDeReserva(sb, id);
  if (!r) return { ok: false, error: "La reserva ya no existe." };
  const sinPermiso = await exigirPermisoSala(sb, perfil, "puede_cambiar_estado", r.restaurante_id);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { data, error } = await sb
    .from("reservas_reservas")
    .update({
      estado: "cancelada",
      cancelada_por: "restaurante",
      motivo_cancelacion: motivo.trim().slice(0, 500) || null,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", id)
    .not("estado", "in", "(cancelada,no_show,terminada)")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: `La reserva ya está «${r.estado}».` };
  return { ok: true };
}

/** Cambios de estado rápidos desde el Inbox (p. ej. «a revisar» → llegada / no show / liberar).
    Cada destino solo se admite desde unos estados concretos: así una fila desfasada no reactiva
    una reserva cancelada o en no show. */
const ESTADOS_RAPIDOS = ["llegada", "sentada", "no_show", "terminada", "confirmada"] as const;
const ORIGENES: Record<(typeof ESTADOS_RAPIDOS)[number], string[]> = {
  llegada: ["a_revisar", "confirmada", "reconfirmada"],
  sentada: ["a_revisar", "confirmada", "reconfirmada", "llegada"],
  no_show: ["a_revisar", "confirmada", "reconfirmada"],
  terminada: ["a_revisar", "llegada", "sentada", "postre", "cuenta"],
  confirmada: ["pendiente", "a_revisar"],
};
export async function cambiarEstadoReserva(id: string, estado: (typeof ESTADOS_RAPIDOS)[number]): Promise<R> {
  if (!ESTADOS_RAPIDOS.includes(estado)) return { ok: false, error: "Estado no permitido desde el Inbox." };
  const { sb, perfil } = await cliente();
  const r = await restDeReserva(sb, id);
  if (!r) return { ok: false, error: "La reserva ya no existe." };
  const sinPermiso = await exigirPermisoSala(sb, perfil, "puede_cambiar_estado", r.restaurante_id);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { data, error } = await sb
    .from("reservas_reservas")
    .update({ estado, actualizado_en: new Date().toISOString() })
    .eq("id", id)
    .in("estado", ORIGENES[estado])
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: CAMBIADA };
  return { ok: true };
}

/** Vuelve a encolar un mensaje fallido: el cron lo reintenta en su siguiente pasada. Se ponen
    los intentos a 0 (el cron solo recoge pendientes por debajo de MAX_INTENTOS y uno en «error»
    ya los ha agotado). */
export async function reintentarMensaje(id: string): Promise<R> {
  const { sb, perfil } = await cliente();
  const { data: m, error: e1 } = await sb.from("reservas_mensajes").select("id, estado, restaurante_id").eq("id", id).maybeSingle();
  if (e1) return { ok: false, error: e1.message };
  if (!m) return { ok: false, error: "El mensaje ya no existe." };
  const sinPermiso = await exigirPermisoSala(sb, perfil, null, m.restaurante_id);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  if (!["error", "sin_proveedor"].includes(m.estado)) return { ok: false, error: `El mensaje ya está «${m.estado}».` };
  const { data, error } = await sb
    .from("reservas_mensajes")
    .update({ estado: "pendiente", error: null, intentos: 0, programado_para: new Date().toISOString() })
    .eq("id", id)
    .in("estado", ["error", "sin_proveedor"])
    .select("id");
  if (error) {
    // Índice parcial: un solo pendiente por reserva, canal y tipo.
    if (error.code === "23505") return { ok: false, error: "Ya hay un mensaje igual pendiente de envío para esta reserva." };
    return { ok: false, error: error.message };
  }
  if (!data?.length) return { ok: false, error: "El mensaje ha cambiado mientras tanto: actualiza el Inbox." };
  return { ok: true };
}

/** Descarta un mensaje fallido que ya no tiene sentido reenviar. */
export async function descartarMensaje(id: string): Promise<R> {
  const { sb, perfil } = await cliente();
  const { data: m } = await sb.from("reservas_mensajes").select("restaurante_id").eq("id", id).maybeSingle();
  if (!m) return { ok: false, error: "El mensaje ya no existe." };
  const sinPermiso = await exigirPermisoSala(sb, perfil, null, m.restaurante_id);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { error } = await sb.from("reservas_mensajes").update({ estado: "cancelado" }).eq("id", id).in("estado", ["error", "sin_proveedor"]);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ================= Tarjeta pendiente ================= */

/** Enlace de pago/garantía de una reserva en tarjeta_pendiente (para mandarlo a mano por WhatsApp).
    Se pide solo al pulsar: el token no viaja con la lista del Inbox. */
export async function enlaceTarjeta(reservaId: string): Promise<R<{ enlace: string }>> {
  const { sb, perfil } = await cliente();
  const { data: r } = await sb.from("reservas_reservas").select("restaurante_id, estado, token").eq("id", reservaId).maybeSingle();
  if (!r) return { ok: false, error: "La reserva ya no existe." };
  const sinPermiso = await exigirPermisoSala(sb, perfil, null, r.restaurante_id);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  if (r.estado !== "tarjeta_pendiente" || !r.token) return { ok: false, error: CAMBIADA };
  const { data: base } = await sb.rpc("reservas_url_base", { p_restaurante: r.restaurante_id });
  const urlBase = (typeof base === "string" && base ? base : "").replace(/\/$/, "");
  return { ok: true, data: { enlace: `${urlBase}/reserva/${r.token}/pago` } };
}

/** Reenvía al cliente el último aviso de garantía/pago de la reserva (copia nueva, se envía ya).
    Si nunca se le mandó ninguno (sin canal configurado), hay que hacerlo por WhatsApp. */
export async function reenviarEnlaceTarjeta(reservaId: string): Promise<R<{ estado: string }>> {
  const { sb, perfil } = await cliente();
  const r = await restDeReserva(sb, reservaId);
  if (!r) return { ok: false, error: "La reserva ya no existe." };
  const sinPermiso = await exigirPermisoSala(sb, perfil, null, r.restaurante_id);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  if (r.estado !== "tarjeta_pendiente") return { ok: false, error: CAMBIADA };
  const { data: m } = await sb
    .from("reservas_mensajes")
    .select("id")
    .eq("reserva_id", reservaId)
    .in("tipo", ["garantia", "pago"])
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!m) return { ok: false, error: "No hay ningún aviso de tarjeta enviado a este cliente: mándale el enlace por WhatsApp." };
  const res = await reenviarMensaje(m.id);
  if (!res.ok || !res.data) return { ok: false, error: res.error || "No se ha podido reenviar." };
  if (res.data.estado === "error") return { ok: false, error: res.data.error || "El envío ha fallado." };
  return { ok: true, data: { estado: res.data.estado } };
}
