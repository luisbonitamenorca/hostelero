import type { Database, Tables } from "@hostelero/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cobrarConReferencia,
  devolverCobro,
  formularioCobro,
  formularioGarantia,
  nuevoPedido,
  respuestaAutorizada,
  tarjetaDeParametros,
  type ConfigTpv,
  type NotificacionTpv,
  type RespuestaRest,
} from "@/lib/redsys";

/**
 * Pagos con tarjeta del módulo Reservas (Redsys / CaixaBank). Tres casos:
 *   1) garantía: operación de 0 € que guarda la tarjeta (COF) → reserva «garantizada»;
 *   2) prepago (ticket): cobro por redirección del importe → reserva «pagada»;
 *   3) cargo por no-show / cancelación tardía con la referencia guardada → «cobrado_noshow»,
 *      y devolución (total o parcial) de un cobro → «devuelto».
 *
 * Todo lo de aquí corre en el servidor con el cliente de servicio (reservas_pagos solo lo
 * escribe el servidor) y lo llaman los route handlers públicos, las server actions del panel
 * (tras comprobar permisos) y el cron de no-show. Ninguna función recibe datos de tarjeta:
 * el banco solo nos da identificador, máscara y caducidad.
 *
 * Reglas de dinero (las que evitan cobrar dos veces):
 *   - Un cargo vivo («iniciado» o «cobrado») por reserva y una devolución «iniciado» por cobro:
 *     lo garantizan índices únicos parciales en la base (migración 20261002150000); el segundo
 *     INSERT falla con 23505 y se devuelve «en_curso». La consulta por orden de creación queda
 *     como segunda defensa.
 *   - El cargo de garantía solo procede en no-show o en cancelación TARDÍA hecha por el cliente
 *     (la política que se le enseñó); el motivo sale del estado de la reserva, no de quien llama.
 *   - Si el banco no contesta (tiempo agotado, respuesta ilegible) la operación queda
 *     «iniciado» marcada como incierta y NO se puede reintentar hasta que dirección mire el
 *     portal del TPV y la resuelva (resolverIncierto).
 *   - Un pago que llega tarde (reserva ya caducada, cancelada o pagada por otro intento) se
 *     reactiva si la mesa sigue libre o, si era un cobro, se devuelve solo.
 */

export type Servicio = SupabaseClient<Database>;
export type Pago = Tables<"reservas_pagos">;
type ReservaFila = Tables<"reservas_reservas">;
type ReservaUpdate = Database["public"]["Tables"]["reservas_reservas"]["Update"];

export type ModoPago = "garantia" | "prepago";
export type MotivoCargo = "no_show" | "cancelacion_tardia";

export type Resultado<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Token público de gestión: 32 hex en minúsculas (lo mismo que reservas_token_valido). */
export const tokenValido = (t: string) => /^[0-9a-f]{32}$/.test(t);

/** Minutos que la mesa queda retenida, como mínimo, desde que el cliente pulsa «ir al banco». */
const MARGEN_BANCO_MIN = 15;
/** Ampliaciones de la retención como mucho: a partir de este número de intentos ya no se alarga
 *  (si no, quien tenga el token podría retener la mesa indefinidamente sin pagar). */
const MAX_INTENTOS_AMPLIAN = 3;
/** Un «iniciado» sin respuesta durante más de esto se puede resolver a mano. */
const INICIADO_ATASCADO_MS = 2 * 60_000;

/** Qué pide la reserva al cliente según su tipo (y con qué importe total). null = nada. */
export function modoDeReserva(r: Pick<ReservaFila, "tipo" | "importe_garantia" | "importe_prepago">): { modo: ModoPago; importe: number } | null {
  if (r.tipo === "prepago" || r.tipo === "experiencia") {
    const imp = Number(r.importe_prepago ?? 0);
    return imp > 0 ? { modo: "prepago", importe: imp } : null;
  }
  if (r.tipo === "garantia" || r.tipo === "politica_cancelacion") {
    const imp = Number(r.importe_garantia ?? 0);
    return imp > 0 ? { modo: "garantia", importe: imp } : null;
  }
  return null;
}

/** Base pública (https + host real: en Vercel llega en x-forwarded-host). */
export function baseUrlDe(req: Request): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "hostelero-app.vercel.app";
  return `https://${host}`;
}

export const fmtEuros = (n: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n);

const centimos = (n: number) => Math.round(Number(n) * 100);
const redondear = (n: number) => Math.round(Number(n) * 100) / 100;

/** ¿La operación quedó marcada como incierta (el banco no contestó)? */
export const esIncierto = (p: Pick<Pago, "respuesta">) =>
  !!p.respuesta && typeof p.respuesta === "object" && !Array.isArray(p.respuesta) && (p.respuesta as Record<string, unknown>)._incierto === true;

/** ¿Hay que resolverla a mano? «iniciado» incierto o atascado (el servidor murió a mitad). */
export function requiereRevision(p: Pick<Pago, "estado" | "tipo" | "ds_order" | "respuesta" | "creado_en">): boolean {
  if (p.estado !== "iniciado" || !["cargo_noshow", "devolucion"].includes(p.tipo)) return false;
  if (p.tipo === "cargo_noshow" && !p.ds_order) return false; // anotación del cron, no ha ido al banco
  return esIncierto(p) || Date.now() - new Date(p.creado_en).getTime() > INICIADO_ATASCADO_MS;
}

/** Cobro cuya devolución automática no salió (banco que rechaza, sin TPV): hay que devolverlo a mano. */
export const porDevolverAMano = (p: Pick<Pago, "respuesta">) =>
  !!p.respuesta && typeof p.respuesta === "object" && !Array.isArray(p.respuesta) && (p.respuesta as Record<string, unknown>)._devolver_a_mano === true;

/** Instante (ms, UTC) de una fecha + hora locales en la zona del restaurante (= reservas_ts de la base). */
export function instanteLocal(fecha: string, hora: string, zona?: string | null): number {
  const tz = zona || "Europe/Madrid";
  const [y, m, d] = fecha.split("-").map(Number);
  const [hh, mm] = hora.slice(0, 5).split(":").map(Number);
  const supuesto = Date.UTC(y, m - 1, d, hh, mm);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  // Desfase de la zona en un instante: hora local leída como si fuera UTC, menos el instante.
  const desfase = (t: number) => {
    const p = fmt.formatToParts(new Date(t));
    const v = (k: string) => Number(p.find((x) => x.type === k)?.value ?? 0);
    return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute")) - t;
  };
  // Dos pasadas: la segunda corrige el día del cambio de hora.
  const t1 = supuesto - desfase(supuesto);
  return supuesto - desfase(t1);
}

/**
 * ¿Procede cobrar la garantía de esta reserva y por qué motivo? El motivo sale del estado:
 *   - no_show → «no_show»;
 *   - cancelada por el CLIENTE dentro de las N horas previas (politica_cancelacion_horas) →
 *     «cancelacion_tardia» (mismo criterio que reservas_gestion_cancelar en la base);
 *   - cancelada por el restaurante / el sistema → error «cancelada_no_cliente»;
 *   - cancelada por el cliente con antelación suficiente → error «cancelacion_en_plazo»;
 *   - cualquier otro estado → «estado_no_cobrable».
 */
export function motivoCobrable(
  r: Pick<ReservaFila, "estado" | "cancelada_por" | "cancelada_en" | "fecha" | "hora">,
  rest: { zona_horaria?: string | null; politica_cancelacion_horas?: number | null } | null | undefined,
): { ok: true; motivo: MotivoCargo } | { ok: false; error: string } {
  if (r.estado === "no_show") return { ok: true, motivo: "no_show" };
  if (r.estado !== "cancelada") return { ok: false, error: "estado_no_cobrable" };
  if (r.cancelada_por !== "cliente") return { ok: false, error: "cancelada_no_cliente" };
  if (!r.cancelada_en) return { ok: false, error: "cancelacion_en_plazo" };
  const horas = rest?.politica_cancelacion_horas ?? 24;
  const limite = instanteLocal(r.fecha, r.hora, rest?.zona_horaria) - horas * 3_600_000;
  return new Date(r.cancelada_en).getTime() >= limite ? { ok: true, motivo: "cancelacion_tardia" } : { ok: false, error: "cancelacion_en_plazo" };
}

/** Código de violación de unicidad de Postgres (índices de cerrojo). */
const esDuplicado = (e: { code?: string } | null | undefined) => e?.code === "23505";

/* ───────────────────────────── Lecturas ───────────────────────────── */

export type ReservaPago = ReservaFila & {
  reservas_restaurantes: Pick<
    Tables<"reservas_restaurantes">,
    | "id" | "nombre" | "slug" | "zona_horaria" | "confirmar_online_auto" | "politica_cancelacion_horas" | "tarjeta_caduca_min"
    | "color_marca" | "logo_url" | "url_condiciones" | "telefono" | "email_reservas" | "email" | "direccion" | "ubicacion"
  > | null;
  reservas_clientes: Pick<Tables<"reservas_clientes">, "nombre" | "apellidos" | "email" | "telefono"> | null;
};

const SELECT_RESERVA =
  "*, reservas_restaurantes(id, nombre, slug, zona_horaria, confirmar_online_auto, politica_cancelacion_horas, tarjeta_caduca_min, color_marca, logo_url, url_condiciones, telefono, email_reservas, email, direccion, ubicacion), reservas_clientes(nombre, apellidos, email, telefono)";

export async function reservaPorToken(sb: Servicio, token: string): Promise<ReservaPago | null> {
  if (!tokenValido(token)) return null;
  const { data } = await sb.from("reservas_reservas").select(SELECT_RESERVA).eq("token", token).maybeSingle();
  return (data as unknown as ReservaPago | null) ?? null;
}

export async function reservaPorId(sb: Servicio, id: string): Promise<ReservaPago | null> {
  const { data } = await sb.from("reservas_reservas").select(SELECT_RESERVA).eq("id", id).maybeSingle();
  return (data as unknown as ReservaPago | null) ?? null;
}

/** ¿La reserva aún no ha empezado? (fecha + hora en la zona horaria del restaurante). */
export function reservaFutura(r: Pick<ReservaFila, "fecha" | "hora">, zona: string | null | undefined): boolean {
  // Formateamos «ahora» en la zona del restaurante y comparamos como texto YYYY-MM-DD HH:MM:
  // evita depender de la zona horaria del servidor (Vercel = UTC).
  const partes = new Intl.DateTimeFormat("sv-SE", {
    timeZone: zona || "Europe/Madrid",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date()); // «2026-10-01 13:05»
  const ahora = partes.replace("T", " ").slice(0, 16);
  return `${r.fecha} ${r.hora.slice(0, 5)}` > ahora;
}

/** Momento (ms) en que caduca la retención de una reserva «tarjeta_pendiente». */
export function caducaEn(r: Pick<ReservaFila, "tarjeta_solicitada_en" | "creado_en">, caducaMin: number | null | undefined): number {
  return new Date(r.tarjeta_solicitada_en ?? r.creado_en).getTime() + (caducaMin ?? 30) * 60_000;
}

export async function pagosDeReserva(sb: Servicio, reservaId: string): Promise<Pago[]> {
  const { data } = await sb.from("reservas_pagos").select("*").eq("reserva_id", reservaId).order("creado_en", { ascending: false });
  return data ?? [];
}

/** Importe ya devuelto (y en curso) de un cobro. */
function devueltoDe(pagos: Pago[], origenId: string, incluirEnCurso: boolean): number {
  return redondear(
    pagos
      .filter((p) => p.tipo === "devolucion" && p.pago_origen_id === origenId && (p.estado === "devuelto" || (incluirEnCurso && p.estado === "iniciado")))
      .reduce((s, p) => s + Number(p.importe), 0),
  );
}

/** Cobros (prepago o cargo) con importe aún devolvible. */
export function devolvibles(pagos: Pago[]): Array<{ pago: Pago; disponible: number }> {
  return pagos
    .filter((p) => p.estado === "cobrado" && (p.tipo === "prepago" || p.tipo === "cargo_noshow") && p.ds_order)
    .map((p) => ({ pago: p, disponible: redondear(Number(p.importe) - devueltoDe(pagos, p.id, true)) }))
    .filter((x) => x.disponible > 0);
}

/* ───────────────────────────── 1 y 2: página pública ───────────────────────────── */

export type InicioPago = { url: string; campos: Record<string, string>; modo: ModoPago; importe: number };

/**
 * Prepara la redirección al TPV para una reserva en «tarjeta_pendiente»: crea el intento en
 * reservas_pagos (estado iniciado, ds_order único) y devuelve el formulario firmado. El importe
 * sale SIEMPRE de la reserva guardada, nunca del navegador. Los intentos anteriores sin resolver
 * pasan a «cancelado» (si aun así el banco los autoriza, aplicarResultadoTpv los recoge).
 * Si a la retención le quedan menos de 15 min, se alarga hasta 15 para que al cliente no se le
 * caduque la mesa mientras está en la página del banco.
 */
export async function iniciarPagoReserva(
  sb: Servicio,
  cfg: ConfigTpv,
  args: { token: string; base: string; idioma?: string },
): Promise<Resultado<InicioPago>> {
  const r = await reservaPorToken(sb, args.token);
  if (!r) return { ok: false, error: "no_encontrada" };
  if (r.estado !== "tarjeta_pendiente") return { ok: false, error: "no_pendiente" };
  if (!reservaFutura(r, r.reservas_restaurantes?.zona_horaria)) return { ok: false, error: "caducada" };
  const modo = modoDeReserva(r);
  if (!modo) return { ok: false, error: "sin_importe" };

  // Retención mínima mientras el cliente está en el banco. El update solo casa si la reserva
  // sigue en tarjeta_pendiente: si el cron la acaba de caducar, no hay nada que pagar.
  // Solo en los primeros intentos: llamar a esta ruta cada 14 min no puede retener la mesa
  // indefinidamente. Pasado el límite, el intento se crea sin mover tarjeta_solicitada_en.
  const caducaMin = r.reservas_restaurantes?.tarjeta_caduca_min ?? 30;
  const { count: intentos } = await sb
    .from("reservas_pagos")
    .select("id", { count: "exact", head: true })
    .eq("reserva_id", r.id)
    .in("tipo", ["garantia", "prepago"]);
  const quedaMs = caducaEn(r, caducaMin) - Date.now();
  const puedeAmpliar = (intentos ?? 0) < MAX_INTENTOS_AMPLIAN;
  if (quedaMs <= 0 && !puedeAmpliar) return { ok: false, error: "caducada" };
  if (quedaMs < MARGEN_BANCO_MIN * 60_000 && puedeAmpliar) {
    const nueva = new Date(Date.now() + (MARGEN_BANCO_MIN - caducaMin) * 60_000).toISOString();
    const { data: sigue } = await sb
      .from("reservas_reservas")
      .update({ tarjeta_solicitada_en: nueva })
      .eq("id", r.id)
      .eq("estado", "tarjeta_pendiente")
      .select("id")
      .maybeSingle();
    if (!sigue) return { ok: false, error: "no_pendiente" };
  }

  const pedido = nuevoPedido();
  await sb.from("reservas_pagos").update({ estado: "cancelado" }).eq("reserva_id", r.id).eq("estado", "iniciado").in("tipo", ["garantia", "prepago"]);
  const { error } = await sb.from("reservas_pagos").insert({
    cuenta_id: r.cuenta_id,
    restaurante_id: r.restaurante_id,
    reserva_id: r.id,
    tipo: modo.modo,
    importe: modo.modo === "garantia" ? 0 : modo.importe,
    estado: "iniciado",
    ds_order: pedido,
  });
  if (error) return { ok: false, error: "no_iniciado" };

  const urls = {
    notificacion: `${args.base}/api/publico/reservas/pago/notificacion`,
    ok: `${args.base}/api/publico/reservas/pago/retorno?token=${r.token}&r=ok`,
    ko: `${args.base}/api/publico/reservas/pago/retorno?token=${r.token}&r=ko`,
  };
  const cli = r.reservas_clientes;
  const titular = [cli?.nombre, cli?.apellidos].filter(Boolean).join(" ");
  const rest = r.reservas_restaurantes?.nombre || "Reserva";
  const idioma = args.idioma || r.idioma || "es";
  const extras = { titular, idioma, datos: r.localizador };

  const campos =
    modo.modo === "garantia"
      ? formularioGarantia(cfg, pedido, urls, { ...extras, descripcion: `Garantía reserva ${r.localizador} · ${rest}` })
      : formularioCobro(cfg, pedido, centimos(modo.importe), urls, { ...extras, descripcion: `Reserva ${r.localizador} · ${rest}` });

  return { ok: true, data: { url: cfg.url, campos: { ...campos }, modo: modo.modo, importe: modo.importe } };
}

/**
 * ok          → aplicado: reserva garantizada / pagada (y confirmada o pendiente).
 * reactivada  → llegó tras caducar la retención, la mesa seguía libre y la reserva vuelve a estar viva.
 * devuelto    → cobro que llegó tarde (reserva cancelada o ya pagada): se ha devuelto solo.
 * sin_efecto  → autorizado pero la reserva ya no lo necesita (garantía de 0 €: no hay nada que devolver).
 * fallido     → denegado por el banco.
 * repetido    → ese pedido ya estaba resuelto (reintento del banco o carrera notificación/retorno).
 * desconocido → ds_order que no es nuestro.
 */
export type ResultadoTpv = "ok" | "reactivada" | "devuelto" | "sin_efecto" | "fallido" | "repetido" | "desconocido";

const ESTADOS_VIVOS = ["pendiente", "confirmada", "reconfirmada", "llegada", "sentada", "postre", "cuenta", "a_revisar"];

/**
 * Aplica el resultado de una operación de redirección (notificación servidor-a-servidor o
 * vuelta firmada del cliente). Idempotente por ds_order: solo actúa sobre intentos «iniciado»
 * o «cancelado» (sustituidos por otro intento pero que el cliente pudo completar en otra
 * pestaña), y el cambio de estado es condicional, así que de dos llamadas simultáneas solo
 * una pasa.
 *
 * Autorizado, según cómo esté la reserva:
 *   - tarjeta_pendiente → pago autorizado/cobrado, estado_pago garantizada/pagada y estado
 *     confirmada (confirmar_online_auto) o pendiente. El trigger manda la confirmación.
 *   - ya garantizada/pagada por otro intento → prepago duplicado: se devuelve; garantía: sin efecto.
 *   - viva (el restaurante la movió a mano mientras tanto) → solo estado_pago.
 *   - cancelada por el sistema por no meter la tarjeta a tiempo, futura y con la mesa libre →
 *     se reactiva. Si no se puede → prepago devuelto / garantía sin efecto.
 *   - cancelada por otro motivo, no-show o pasada → prepago devuelto / garantía sin efecto.
 * Denegado → pago «fallido»; la reserva sigue en tarjeta_pendiente y puede reintentar.
 */
export async function aplicarResultadoTpv(sb: Servicio, noti: NotificacionTpv, cfg?: ConfigTpv | null): Promise<ResultadoTpv> {
  const { data: pago } = await sb.from("reservas_pagos").select("*").eq("ds_order", noti.pedido).maybeSingle();
  if (!pago) return "desconocido";
  if (!["garantia", "prepago"].includes(pago.tipo)) return "repetido";
  if (pago.estado !== "iniciado" && pago.estado !== "cancelado") return "repetido";

  const autorizado = respuestaAutorizada(noti.respuesta);
  // Un intento sustituido que el banco deniega no cambia nada (ya hay otro en marcha).
  if (pago.estado === "cancelado" && !autorizado) return "repetido";

  const tarjeta = tarjetaDeParametros(noti.parametros);
  const esGarantia = pago.tipo === "garantia";
  const { data: actualizado } = await sb
    .from("reservas_pagos")
    .update({
      estado: autorizado ? (esGarantia ? "autorizado" : "cobrado") : "fallido",
      autorizacion: noti.autorizacion,
      identificador_cof: autorizado ? tarjeta.identificador : null,
      cof_txnid: autorizado ? tarjeta.cofTxnid : null,
      tarjeta_mascara: tarjeta.mascara,
      tarjeta_caducidad: tarjeta.caducidad,
      respuesta: noti.parametros,
    })
    .eq("id", pago.id)
    .eq("estado", pago.estado) // carrera entre notificación y retorno: solo uno gana
    .select("*")
    .maybeSingle();
  if (!actualizado) return "repetido";
  if (!autorizado) return "fallido";

  if (esGarantia && !tarjeta.identificador) {
    // El banco autorizó pero no devolvió referencia: falta activar «pago por referencia» en el
    // comercio. La reserva queda garantizada (el cliente ha hecho lo que se le pidió) pero no
    // se podrá cobrar el no-show. Queda en los logs para que se vea.
    console.error("[pagos-reservas] garantía autorizada SIN Ds_Merchant_Identifier (¿COF sin activar?)", noti.pedido);
  }

  const r = await reservaPorId(sb, pago.reserva_id);
  if (!r) return "ok";
  const nuevoEstadoPago = esGarantia ? "garantizada" : "pagada";
  const confirmarAuto = r.reservas_restaurantes?.confirmar_online_auto ?? false;
  const futura = reservaFutura(r, r.reservas_restaurantes?.zona_horaria);

  // Ya resuelta por otro intento (dos pestañas): un segundo cobro se devuelve.
  if (PAGO_RESUELTO.includes(r.estado_pago)) {
    return sobrante(sb, cfg, actualizado, "Pago duplicado");
  }

  if (r.estado === "tarjeta_pendiente") {
    const { data: hecho } = await sb
      .from("reservas_reservas")
      .update({ estado_pago: nuevoEstadoPago, notificar: true, estado: confirmarAuto ? "confirmada" : "pendiente" })
      .eq("id", r.id)
      .eq("estado", "tarjeta_pendiente")
      .select("id")
      .maybeSingle();
    if (hecho) return "ok";
    // El cron la ha caducado justo ahora: seguimos con la reserva recién leída.
    const otra = await reservaPorId(sb, r.id);
    if (!otra) return "ok";
    return tardio(sb, cfg, actualizado, otra, nuevoEstadoPago, confirmarAuto, futura);
  }
  return tardio(sb, cfg, actualizado, r, nuevoEstadoPago, confirmarAuto, futura);
}

/** Estados de pago que ya están resueltos: un cobro más sobre ellos es un duplicado. */
const PAGO_RESUELTO = ["garantizada", "pagada", "cobrado_noshow", "devuelto"];
/** Estados de pago que un pago autorizado puede sustituir. */
const PAGO_POR_RESOLVER = ["no_requerido", "pendiente_tarjeta", "fallido"];

/** Resultado autorizado que llega cuando la reserva ya no está en tarjeta_pendiente. */
async function tardio(
  sb: Servicio,
  cfg: ConfigTpv | null | undefined,
  pago: Pago,
  r: ReservaPago,
  nuevoEstadoPago: string,
  confirmarAuto: boolean,
  futura: boolean,
): Promise<ResultadoTpv> {
  // La reserva puede haberse resuelto entre la primera lectura y esta (otro intento ganó el
  // update condicional): se repite la comprobación con la lectura que nos pasan.
  if (PAGO_RESUELTO.includes(r.estado_pago)) return sobrante(sb, cfg, pago, "Pago duplicado");

  // Viva: el restaurante la confirmó a mano mientras el cliente pagaba. Solo apuntamos el pago,
  // con update condicional: de dos pagos tardíos simultáneos solo uno queda; el otro se devuelve.
  if (ESTADOS_VIVOS.includes(r.estado)) {
    const { data: ok } = await sb
      .from("reservas_reservas")
      .update({ estado_pago: nuevoEstadoPago })
      .eq("id", r.id)
      .in("estado_pago", PAGO_POR_RESOLVER)
      .select("id")
      .maybeSingle();
    if (!ok) return sobrante(sb, cfg, pago, "Pago duplicado");
    return "ok";
  }
  // Caducada por el sistema (no metió la tarjeta a tiempo): si la mesa sigue libre, se reactiva.
  const caducada = r.estado === "cancelada" && r.cancelada_por === "sistema" && r.estado_pago === "pendiente_tarjeta";
  if (caducada && futura && (await mesasLibres(sb, r))) {
    const estado = confirmarAuto && r.mesa_id ? "confirmada" : "pendiente";
    const cambios: ReservaUpdate = {
      estado,
      estado_pago: nuevoEstadoPago,
      notificar: true,
      cancelada_en: null,
      cancelada_por: null,
      motivo_cancelacion: null,
    };
    const { data: ok } = await sb
      .from("reservas_reservas")
      .update(cambios)
      .eq("id", r.id)
      .eq("estado", "cancelada")
      .eq("estado_pago", "pendiente_tarjeta")
      .select("id")
      .maybeSingle();
    if (ok) {
      // De «cancelada» a viva el trigger no manda confirmación: la pedimos explícitamente.
      await sb.rpc("reservas_programar_mensajes", { p_reserva_id: r.id, p_evento: estado === "confirmada" ? "confirmada" : "alta" });
      return "reactivada";
    }
  }
  return sobrante(sb, cfg, pago, "Reserva no disponible");
}

/** Motivos de las devoluciones automáticas (los usa la página pública para elegir el texto). */
export const MOTIVOS_DEVOLUCION_AUTO = ["Pago duplicado", "Reserva no disponible"];

/**
 * Cobro que ya no corresponde: el prepago se devuelve solo; la garantía (0 €) no tiene efecto.
 * Si la devolución automática no sale (banco que rechaza, sin respuesta, sin TPV), el cobro se
 * marca `_devolver_a_mano` y la reserva queda «pagada» si no tenía otro estado de pago: así el
 * panel y el Inbox la enseñan como cobrada y por devolver (cobrosPorRevisar), y la página
 * pública le dice al cliente que se le devolverá.
 */
async function sobrante(sb: Servicio, cfg: ConfigTpv | null | undefined, pago: Pago, motivo: string): Promise<ResultadoTpv> {
  if (pago.tipo === "garantia" || !(Number(pago.importe) > 0)) {
    // La garantía de 0 € no se cobró: se deja la traza pero no sirve para cargos.
    await sb.from("reservas_pagos").update({ estado: "cancelado" }).eq("id", pago.id);
    return "sin_efecto";
  }
  const res = cfg ? await devolverInterno(sb, cfg, pago, Number(pago.importe), null, motivo) : { ok: false as const, error: "tpv" };
  if (res.ok) return "devuelto";
  console.error("[pagos-reservas] no se pudo devolver solo un cobro sobrante: queda para dirección", pago.ds_order, res.error);
  const previa = pago.respuesta && typeof pago.respuesta === "object" && !Array.isArray(pago.respuesta) ? pago.respuesta : {};
  await sb
    .from("reservas_pagos")
    .update({ respuesta: { ...previa, _devolver_a_mano: true, _motivo_sobrante: motivo, _error_devolucion: res.error } })
    .eq("id", pago.id);
  await sb.from("reservas_reservas").update({ estado_pago: "pagada" }).eq("id", pago.reserva_id).in("estado_pago", PAGO_POR_RESOLVER);
  return "sin_efecto";
}

/** ¿Siguen libres las mesas de la reserva? Sin mesa asignada → true (la validará el restaurante). */
async function mesasLibres(sb: Servicio, r: ReservaFila): Promise<boolean> {
  const { data: rm } = await sb.from("reservas_reserva_mesas").select("mesa_id").eq("reserva_id", r.id);
  const ids = new Set<string>([...(rm ?? []).map((x) => x.mesa_id), ...(r.mesa_id ? [r.mesa_id] : [])]);
  for (const id of ids) {
    const { data, error } = await sb.rpc("reservas_mesa_ocupada", {
      p_mesa: id, p_fecha: r.fecha, p_hora: r.hora, p_duracion: r.duracion_min || 120, p_excluir: r.id,
    });
    if (error || data !== false) return false; // en la duda, ocupada
  }
  return true;
}

/* ───────────────────────────── 3: cargo y devolución (panel / cron) ───────────────────────────── */

/** Estados de reserva en los que tiene sentido cobrar la garantía. */
export const ESTADOS_COBRABLES = ["no_show", "cancelada"];

/**
 * Cobra la garantía de una reserva con la tarjeta guardada (no-show o cancelación tardía).
 * Requisitos: reserva en no_show, o cancelada POR EL CLIENTE dentro del plazo de la política
 * (motivoCobrable: lo que se le enseñó al cliente al registrar la tarjeta); estado_pago
 * «garantizada» (o «fallido» de un intento anterior), un pago de garantía autorizado con
 * identificador COF, ningún cargo ya cobrado ni en curso. El motivo que se apunta sale del
 * estado de la reserva; `args.motivo` se conserva por compatibilidad pero no manda.
 * Importe: el que se pida (cargo parcial, p. ej. si vino parte del grupo) o, por defecto,
 * importe_garantia; nunca más que importe_garantia.
 */
export async function cobrarGarantia(
  sb: Servicio,
  cfg: ConfigTpv,
  args: { reservaId: string; motivo: MotivoCargo; importe?: number | null; creadoPor?: string | null },
): Promise<Resultado<Pago>> {
  const r = await reservaPorId(sb, args.reservaId);
  if (!r) return { ok: false, error: "no_encontrada" };
  if (!ESTADOS_COBRABLES.includes(r.estado)) return { ok: false, error: "estado_no_cobrable" };
  const procede = motivoCobrable(r, r.reservas_restaurantes);
  if (!procede.ok) return { ok: false, error: procede.error };
  const motivoCargo = procede.motivo;
  if (!["garantizada", "fallido"].includes(r.estado_pago)) return { ok: false, error: "sin_garantia" };
  const maximo = redondear(Number(r.importe_garantia ?? 0));
  if (!(maximo > 0)) return { ok: false, error: "sin_importe" };
  const importe = args.importe == null ? maximo : redondear(args.importe);
  if (!(importe > 0) || importe > maximo) return { ok: false, error: "importe_invalido" };

  const pagos = await pagosDeReserva(sb, r.id);
  if (pagos.some((p) => p.tipo === "cargo_noshow" && p.estado === "cobrado")) return { ok: false, error: "ya_cobrado" };
  const enVuelo = pagos.find((p) => p.tipo === "cargo_noshow" && p.estado === "iniciado" && p.ds_order);
  if (enVuelo) return { ok: false, error: requiereRevision(enVuelo) ? "incierto" : "en_curso" };
  const garantia = pagos.find((p) => p.tipo === "garantia" && p.estado === "autorizado" && p.identificador_cof);
  if (!garantia?.identificador_cof) return { ok: false, error: "sin_tarjeta" };

  // Anotaciones del cron («pendiente de cobro», sin ds_order): las sustituye este cargo.
  await sb.from("reservas_pagos").update({ estado: "cancelado" }).eq("reserva_id", r.id).eq("tipo", "cargo_noshow").eq("estado", "iniciado").is("ds_order", null);

  const pedido = nuevoPedido();
  const { data: cargo, error } = await sb
    .from("reservas_pagos")
    .insert({
      cuenta_id: r.cuenta_id,
      restaurante_id: r.restaurante_id,
      reserva_id: r.id,
      tipo: "cargo_noshow",
      importe,
      estado: "iniciado",
      ds_order: pedido,
      pago_origen_id: garantia.id,
      tarjeta_mascara: garantia.tarjeta_mascara,
      tarjeta_caducidad: garantia.tarjeta_caducidad,
      creado_por: args.creadoPor ?? null,
      respuesta: { _motivo: motivoCargo },
    })
    .select("*")
    .single();
  // Índice único reservas_pagos_un_cargo_vivo: ya hay otro cargo vivo (doble clic, persona + cron).
  if (esDuplicado(error)) return { ok: false, error: "en_curso" };
  if (error || !cargo) return { ok: false, error: "no_iniciado" };

  // Segunda defensa (por si el índice aún no está aplicado): gana el primer cargo creado.
  const { data: vivos } = await sb
    .from("reservas_pagos")
    .select("id")
    .eq("reserva_id", r.id)
    .eq("tipo", "cargo_noshow")
    .in("estado", ["iniciado", "cobrado"])
    .not("ds_order", "is", null)
    .order("creado_en", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);
  if (vivos?.[0]?.id !== cargo.id) {
    await sb.from("reservas_pagos").update({ estado: "cancelado" }).eq("id", cargo.id);
    return { ok: false, error: "en_curso" };
  }

  const motivo = motivoCargo === "no_show" ? "No-show" : "Cancelación tardía";
  const resp = await cobrarConReferencia(
    cfg,
    pedido,
    centimos(importe),
    { identificador: garantia.identificador_cof, cofTxnid: garantia.cof_txnid },
    `${motivo} reserva ${r.localizador} · ${r.reservas_restaurantes?.nombre ?? ""}`,
  );
  return cerrarOperacion(sb, cargo, resp, { _motivo: motivoCargo });
}

/**
 * Devuelve un cobro (prepago o cargo por no-show): operación tipo 3 sobre el pedido original.
 * Sin importe = todo lo que quede por devolver; con importe = devolución parcial. Crea una fila
 * «devolucion» enlazada por pago_origen_id. Cuando el cobro queda devuelto entero, el cobro
 * original pasa a «devuelto» y la reserva a estado_pago «devuelto».
 */
export async function devolverPago(
  sb: Servicio,
  cfg: ConfigTpv,
  args: { pagoId: string; importe?: number | null; creadoPor?: string | null },
): Promise<Resultado<Pago>> {
  const { data: origen } = await sb.from("reservas_pagos").select("*").eq("id", args.pagoId).maybeSingle();
  if (!origen) return { ok: false, error: "no_encontrado" };
  if (origen.estado !== "cobrado" || !["prepago", "cargo_noshow"].includes(origen.tipo) || !origen.ds_order) {
    return { ok: false, error: "no_devolvible" };
  }
  const pagos = await pagosDeReserva(sb, origen.reserva_id);
  const enVuelo = pagos.find((p) => p.tipo === "devolucion" && p.pago_origen_id === origen.id && p.estado === "iniciado");
  if (enVuelo) return { ok: false, error: requiereRevision(enVuelo) ? "incierto" : "en_curso" };
  const disponible = redondear(Number(origen.importe) - devueltoDe(pagos, origen.id, false));
  if (!(disponible > 0)) return { ok: false, error: "no_devolvible" };
  const importe = args.importe == null ? disponible : redondear(args.importe);
  if (!(importe > 0) || importe > disponible) return { ok: false, error: "importe_invalido" };

  return devolverInterno(sb, cfg, origen, importe, args.creadoPor ?? null, null);
}

/** Devolución sin comprobaciones de panel (las hace quien llama). */
async function devolverInterno(
  sb: Servicio,
  cfg: ConfigTpv,
  origen: Pago,
  importe: number,
  creadoPor: string | null,
  motivo: string | null,
): Promise<Resultado<Pago>> {
  if (!origen.ds_order) return { ok: false, error: "no_devolvible" };
  const { data: dev, error } = await sb
    .from("reservas_pagos")
    .insert({
      cuenta_id: origen.cuenta_id,
      restaurante_id: origen.restaurante_id,
      reserva_id: origen.reserva_id,
      tipo: "devolucion",
      importe,
      estado: "iniciado",
      pago_origen_id: origen.id,
      tarjeta_mascara: origen.tarjeta_mascara,
      creado_por: creadoPor,
      respuesta: motivo ? { _motivo: motivo } : null,
    })
    .select("*")
    .single();
  // Índice único reservas_pagos_una_devolucion_viva: ya hay otra devolución en curso de este cobro.
  if (esDuplicado(error)) return { ok: false, error: "en_curso" };
  if (error || !dev) return { ok: false, error: "no_iniciado" };

  // Lo devuelto + en curso no puede pasar del cobro original. Con el índice único solo hay una
  // devolución «iniciado» por cobro a la vez, así que esta suma ve ya confirmadas las anteriores;
  // sin él (índice aún no aplicado) es la defensa: la última en crearse se retira.
  const { data: hermanas } = await sb
    .from("reservas_pagos")
    .select("id, importe, estado, creado_en")
    .eq("pago_origen_id", origen.id)
    .eq("tipo", "devolucion")
    .in("estado", ["iniciado", "devuelto"])
    .order("creado_en", { ascending: true })
    .order("id", { ascending: true });
  let acumulado = 0;
  for (const h of hermanas ?? []) {
    acumulado = redondear(acumulado + Number(h.importe));
    if (h.id === dev.id) break;
  }
  if (acumulado > redondear(Number(origen.importe))) {
    await sb.from("reservas_pagos").update({ estado: "cancelado" }).eq("id", dev.id);
    return { ok: false, error: "en_curso" };
  }

  const resp = await devolverCobro(cfg, origen.ds_order, centimos(importe));
  return cerrarOperacion(sb, dev, resp, motivo ? { _motivo: motivo } : {});
}

/**
 * Cierra un cargo o devolución con la respuesta REST del banco. Respuesta incierta → la fila
 * se queda «iniciado» marcada `_incierto` (bloquea reintentos hasta resolverla a mano).
 */
async function cerrarOperacion(sb: Servicio, op: Pago, resp: RespuestaRest, extra: Record<string, string>): Promise<Resultado<Pago>> {
  const respuesta = { ...resp.parametros, ...extra, ...(resp.error ? { _error: resp.error } : {}) };
  if (resp.incierto) {
    await sb.from("reservas_pagos").update({ respuesta: { ...respuesta, _incierto: true } }).eq("id", op.id);
    console.error("[pagos-reservas] respuesta incierta del banco", op.tipo, op.id, resp.error);
    return { ok: false, error: "incierto" };
  }
  const final = await aplicarDesenlace(sb, op, resp.ok, { respuesta, autorizacion: resp.autorizacion });
  if (!resp.ok) return { ok: false, error: resp.error || "rechazado" };
  return { ok: true, data: final };
}

/** Deja un cargo / devolución en su estado final y propaga a cobro original y reserva. */
async function aplicarDesenlace(
  sb: Servicio,
  op: Pago,
  ok: boolean,
  datos: { respuesta?: Database["public"]["Tables"]["reservas_pagos"]["Update"]["respuesta"]; autorizacion?: string | null },
): Promise<Pago> {
  const esCargo = op.tipo === "cargo_noshow";
  const { data: final } = await sb
    .from("reservas_pagos")
    .update({
      estado: ok ? (esCargo ? "cobrado" : "devuelto") : "fallido",
      ...(datos.autorizacion !== undefined ? { autorizacion: datos.autorizacion } : {}),
      ...(datos.respuesta !== undefined ? { respuesta: datos.respuesta } : {}),
    })
    .eq("id", op.id)
    .select("*")
    .single();

  if (esCargo) {
    await sb.from("reservas_reservas").update({ estado_pago: ok ? "cobrado_noshow" : "fallido" }).eq("id", op.reserva_id);
  } else if (ok && op.pago_origen_id) {
    // ¿Queda devuelto entero el cobro original?
    const { data: origen } = await sb.from("reservas_pagos").select("*").eq("id", op.pago_origen_id).maybeSingle();
    if (origen) {
      const pagos = await pagosDeReserva(sb, op.reserva_id);
      if (devueltoDe(pagos, origen.id, false) >= redondear(Number(origen.importe))) {
        await sb.from("reservas_pagos").update({ estado: "devuelto" }).eq("id", origen.id);
        await sb.from("reservas_reservas").update({ estado_pago: estadoPagoTrasDevolucion(pagos, origen.id) }).eq("id", op.reserva_id);
      }
    }
  }
  return final ?? op;
}

/**
 * Estado de pago de la reserva cuando un cobro queda devuelto entero: «devuelto» solo si no le
 * queda NINGÚN otro cobro vigente. Caso real: prepago pagado dos veces (dos pestañas); se
 * devuelve el duplicado, pero el primero sigue cobrado → la reserva sigue «pagada» y en sala se
 * descuenta. Si queda un cargo de garantía cobrado → «cobrado_noshow».
 */
function estadoPagoTrasDevolucion(pagos: Pago[], origenId: string): string {
  // Cobros con algo aún no devuelto (las devoluciones en curso no cuentan: aún pueden fallar).
  const vigentes = pagos.filter(
    (p) =>
      p.id !== origenId && p.estado === "cobrado" && (p.tipo === "prepago" || p.tipo === "cargo_noshow") &&
      redondear(Number(p.importe) - devueltoDe(pagos, p.id, false)) > 0,
  );
  if (!vigentes.length) return "devuelto";
  return vigentes.some((p) => p.tipo === "cargo_noshow") ? "cobrado_noshow" : "pagada";
}

/**
 * Resuelve a mano un cargo o devolución que quedó incierto (el banco no contestó) después de
 * mirarlo en el portal del TPV: `cobrado = true` si la operación aparece autorizada allí.
 */
export async function resolverIncierto(
  sb: Servicio,
  args: { pagoId: string; hecho: boolean; resueltoPor?: string | null },
): Promise<Resultado<Pago>> {
  const { data: op } = await sb.from("reservas_pagos").select("*").eq("id", args.pagoId).maybeSingle();
  if (!op) return { ok: false, error: "no_encontrado" };
  if (!requiereRevision(op)) return { ok: false, error: "no_incierto" };
  const previa = op.respuesta && typeof op.respuesta === "object" && !Array.isArray(op.respuesta) ? op.respuesta : {};
  const final = await aplicarDesenlace(sb, op, args.hecho, {
    respuesta: { ...previa, _incierto: false, _resuelto_a_mano: args.hecho ? "si" : "no", _resuelto_por: args.resueltoPor ?? null, _resuelto_en: new Date().toISOString() },
  });
  return { ok: true, data: final };
}

/** Lo que puede tardar como mucho un cargo REST (peticionRest corta a los 25 s) más un margen. */
const CARGO_MAX_MS = 27_000;

/**
 * Ejecuta los cargos de garantía de los no-shows que lo piden (cobrar = true) y devuelve el
 * recuento. Sin TPV configurado no hace nada (cobra dirección a mano).
 * `opciones.hasta` (ms, Date.now()): no empieza un cargo si no le daría tiempo a terminar antes
 * de ese instante (el cron tiene maxDuration = 60 s). Los que se quedan sin intentar cuentan en
 * `sin_tiempo` y los recoge la pasada siguiente con noShowsPorCobrar().
 * `errores` y `inciertos_ids` son para el log del cron (Vercel).
 */
export async function cobrarNoShowsPendientes(
  sb: Servicio,
  cfg: ConfigTpv | null,
  filas: Array<{ reserva_id: string; cobrar: boolean }>,
  opciones?: { hasta?: number },
): Promise<{ cobrados: number; fallidos: number; inciertos: number; sin_tiempo: number; errores: string[]; inciertos_ids: string[] }> {
  const out = { cobrados: 0, fallidos: 0, inciertos: 0, sin_tiempo: 0, errores: [] as string[], inciertos_ids: [] as string[] };
  if (!cfg) return out;
  const pendientes = filas.filter((f) => f.cobrar);
  for (let i = 0; i < pendientes.length; i++) {
    if (opciones?.hasta && Date.now() + CARGO_MAX_MS > opciones.hasta) {
      out.sin_tiempo = pendientes.length - i;
      break;
    }
    const f = pendientes[i];
    const res = await cobrarGarantia(sb, cfg, { reservaId: f.reserva_id, motivo: "no_show" });
    if (res.ok) out.cobrados++;
    else if (res.error === "incierto") {
      out.inciertos++;
      out.inciertos_ids.push(f.reserva_id);
    } else if (!["ya_cobrado", "en_curso"].includes(res.error)) {
      out.fallidos++;
      out.errores.push(`${f.reserva_id}: ${res.error}`);
    }
  }
  return out;
}

/** Fecha AAAA-MM-DD de hoy − n días en Madrid (las fechas de reserva son locales). */
function fechaHaceDias(n: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() - n * 86_400_000),
  );
}

export type NoShowPorCobrar = {
  reserva_id: string;
  restaurante_id: string;
  fecha: string;
  hora: string;
  localizador: string | null;
  importe: number;
  estado_pago: string;
  /** El restaurante tiene el cobro automático de no-show activado. */
  automatico: boolean;
  /** Hay garantía autorizada con referencia COF (se puede cobrar). */
  con_tarjeta: boolean;
  /** Cargos ya intentados y denegados por el banco. */
  intentos_fallidos: number;
  /** Para el cron: automático, con tarjeta y sin intentos denegados (no se insiste con la misma
   *  tarjeta tras una denegación: eso lo decide dirección desde el panel). */
  cobrar: boolean;
};

/**
 * No-shows garantizados que siguen sin cobrar: reserva en no_show, estado_pago garantizada o
 * fallido, de los últimos `desdeDias` días, sin cover_id (las de Cover las cobra Cover), con
 * importe de garantía y sin cargo cobrado ni en curso (los inciertos salen en la lista de
 * revisión). Por defecto solo restaurantes con cobro automático (lo que usa el cron como
 * reintento en cada pasada); el Inbox la pide con `soloAutomatico: false` y su restaurante.
 */
export async function noShowsPorCobrar(
  sb: Servicio,
  desdeDias = 3,
  opciones?: { restauranteId?: string | null; soloAutomatico?: boolean },
): Promise<NoShowPorCobrar[]> {
  const soloAuto = opciones?.soloAutomatico ?? true;
  let q = sb
    .from("reservas_reservas")
    .select("id, restaurante_id, fecha, hora, localizador, importe_garantia, estado_pago, reservas_restaurantes!inner(cobro_noshow_automatico)")
    .eq("estado", "no_show")
    .in("estado_pago", ["garantizada", "fallido"])
    .is("cover_id", null)
    .gt("importe_garantia", 0)
    .gte("fecha", fechaHaceDias(Math.max(0, desdeDias)))
    .order("fecha", { ascending: true })
    .limit(200);
  if (opciones?.restauranteId) q = q.eq("restaurante_id", opciones.restauranteId);
  const { data: reservas } = await q;
  const lista = (reservas ?? []).filter((r) => !soloAuto || r.reservas_restaurantes?.cobro_noshow_automatico);
  if (!lista.length) return [];

  const { data: pagos } = await sb
    .from("reservas_pagos")
    .select("reserva_id, tipo, estado, ds_order, identificador_cof")
    .in("reserva_id", lista.map((r) => r.id))
    .in("tipo", ["garantia", "cargo_noshow"]);
  const porReserva = new Map<string, NonNullable<typeof pagos>>();
  for (const p of pagos ?? []) porReserva.set(p.reserva_id, [...(porReserva.get(p.reserva_id) ?? []), p]);

  const out: NoShowPorCobrar[] = [];
  for (const r of lista) {
    const ps = porReserva.get(r.id) ?? [];
    const cargos = ps.filter((p) => p.tipo === "cargo_noshow" && p.ds_order);
    if (cargos.some((p) => p.estado === "cobrado" || p.estado === "iniciado")) continue;
    const conTarjeta = ps.some((p) => p.tipo === "garantia" && p.estado === "autorizado" && p.identificador_cof);
    const fallidos = cargos.filter((p) => p.estado === "fallido").length;
    const automatico = !!r.reservas_restaurantes?.cobro_noshow_automatico;
    out.push({
      reserva_id: r.id,
      restaurante_id: r.restaurante_id,
      fecha: r.fecha,
      hora: r.hora,
      localizador: r.localizador,
      importe: Number(r.importe_garantia ?? 0),
      estado_pago: r.estado_pago,
      automatico,
      con_tarjeta: conTarjeta,
      intentos_fallidos: fallidos,
      cobrar: automatico && conTarjeta && fallidos === 0,
    });
  }
  return out;
}

/** ¿Lo ha dado dirección por revisado (decidió no devolver)? */
const revisado = (p: Pick<Pago, "respuesta">) =>
  !!p.respuesta && typeof p.respuesta === "object" && !Array.isArray(p.respuesta) && (p.respuesta as Record<string, unknown>)._revisado === true;

/**
 * ¿Hay que revisar este cobro (probablemente devolverlo)? Devuelve la frase para el panel o null.
 * Solo mira el cobro y el estado de su reserva; el importe disponible lo calcula quien llama.
 */
export function motivoRevisionCobro(p: Pick<Pago, "tipo" | "estado" | "ds_order" | "respuesta">, estadoReserva: string): string | null {
  if (p.estado !== "cobrado" || !p.ds_order || !["prepago", "cargo_noshow"].includes(p.tipo) || revisado(p)) return null;
  if (porDevolverAMano(p)) return "Cobro que llegó tarde o duplicado y no se pudo devolver solo: hay que devolverlo.";
  if (p.tipo === "prepago" && estadoReserva === "cancelada") return "Prepago cobrado en una reserva cancelada: decide si se devuelve.";
  if (p.tipo === "cargo_noshow" && !ESTADOS_COBRABLES.includes(estadoReserva))
    return "Cargo de garantía cobrado, pero la reserva ya no está en no-show ni cancelada.";
  return null;
}

export type CobroPorRevisar = {
  pago: Pago;
  /** Importe aún devolvible (descontando devoluciones hechas y en curso). */
  disponible: number;
  reserva_id: string;
  estado_reserva: string;
  fecha: string;
  hora: string;
  localizador: string | null;
  /** Frase lista para enseñar. */
  motivo: string;
};

/**
 * Cobros que alguien del restaurante tiene que mirar porque probablemente hay que devolverlos:
 *   - la devolución automática de un cobro tardío o duplicado no salió (`_devolver_a_mano`);
 *   - prepago cobrado en una reserva que luego se canceló (no hay devolución automática);
 *   - cargo de garantía cobrado en una reserva que ya no está en no-show ni cancelada (p. ej. el
 *     cron cobró el no-show y después se vio que el cliente llegó tarde).
 * Solo cobros con importe aún devolvible y que dirección no haya dado por revisados. Reservas de
 * los últimos `desdeDias` días en adelante.
 */
export async function cobrosPorRevisar(sb: Servicio, restauranteId: string, desdeDias = 60): Promise<CobroPorRevisar[]> {
  const { data: cobros } = await sb
    .from("reservas_pagos")
    .select("*, reservas_reservas!inner(id, estado, fecha, hora, localizador)")
    .eq("restaurante_id", restauranteId)
    .eq("estado", "cobrado")
    .in("tipo", ["prepago", "cargo_noshow"])
    .not("ds_order", "is", null)
    .gte("reservas_reservas.fecha", fechaHaceDias(desdeDias))
    .limit(500);
  const candidatos = (cobros ?? []).flatMap((c) => {
    const { reservas_reservas: r, ...pago } = c;
    const motivo = r ? motivoRevisionCobro(pago, r.estado) : null;
    return r && motivo ? [{ pago: pago as Pago, r, motivo }] : [];
  });
  if (!candidatos.length) return [];

  const { data: devs } = await sb
    .from("reservas_pagos")
    .select("*")
    .eq("tipo", "devolucion")
    .in("pago_origen_id", candidatos.map((c) => c.pago.id));
  const out: CobroPorRevisar[] = [];
  for (const c of candidatos) {
    const disponible = redondear(Number(c.pago.importe) - devueltoDe(devs ?? [], c.pago.id, true));
    if (!(disponible > 0)) continue;
    out.push({
      pago: c.pago,
      disponible,
      reserva_id: c.r.id,
      estado_reserva: c.r.estado,
      fecha: c.r.fecha,
      hora: c.r.hora,
      localizador: c.r.localizador,
      motivo: c.motivo,
    });
  }
  return out.sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
}

/** Dirección decide que un cobro de cobrosPorRevisar se queda (no se devuelve): deja de salir. */
export async function marcarCobroRevisado(
  sb: Servicio,
  args: { pagoId: string; revisadoPor?: string | null },
): Promise<Resultado<Pago>> {
  const { data: p } = await sb.from("reservas_pagos").select("*").eq("id", args.pagoId).maybeSingle();
  if (!p) return { ok: false, error: "no_encontrado" };
  if (p.estado !== "cobrado") return { ok: false, error: "no_devolvible" };
  const previa = p.respuesta && typeof p.respuesta === "object" && !Array.isArray(p.respuesta) ? p.respuesta : {};
  const { data } = await sb
    .from("reservas_pagos")
    .update({ respuesta: { ...previa, _revisado: true, _revisado_por: args.revisadoPor ?? null, _revisado_en: new Date().toISOString() } })
    .eq("id", p.id)
    .select("*")
    .single();
  return { ok: true, data: data ?? p };
}

/** Texto de cara al panel para cada estado_pago de la reserva. */
export const ESTADO_PAGO_TXT: Record<string, string> = {
  no_requerido: "Sin pago",
  pendiente_tarjeta: "Tarjeta pendiente",
  garantizada: "Garantizada con tarjeta",
  pagada: "Prepago cobrado",
  cobrado_noshow: "Cargo por no-show cobrado",
  devuelto: "Devuelto",
  fallido: "Cobro fallido",
};

/** Texto de cara al panel para cada tipo/estado de fila de reservas_pagos. */
export const TIPO_PAGO_TXT: Record<string, string> = {
  garantia: "Garantía (tarjeta)",
  prepago: "Prepago",
  cargo_noshow: "Cargo de garantía",
  devolucion: "Devolución",
};
export const ESTADO_FILA_TXT: Record<string, string> = {
  iniciado: "En curso",
  autorizado: "Tarjeta registrada",
  cobrado: "Cobrado",
  devuelto: "Devuelto",
  fallido: "Fallido",
  cancelado: "Anulado",
};
