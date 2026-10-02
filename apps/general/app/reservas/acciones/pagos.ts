"use server";

/* Acciones de servidor de PAGOS del panel de Reservas (las llama el modal de reserva).
   Permisos: cualquier usuario del módulo puede VER los pagos de una reserva; COBRAR la garantía,
   DEVOLVER y RESOLVER operaciones inciertas solo dirección (perfil.rol = 'direccion', lo mismo
   que es_direccion() en la base).

   Escritura: reservas_pagos solo lo escribe el servidor (RLS: authenticated no tiene insert/
   update). Por eso, tras comprobar sesión, módulo, rol y que la reserva / el pago es de la cuenta
   con el cliente autenticado (RLS), la operación con el banco y las filas de pago se escriben
   con el cliente de servicio DESDE ESTA ACCIÓN DE SERVIDOR: la service key no sale del servidor
   ni llega a ningún componente. */

import { exigirModulo } from "@/lib/supabase/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { configTpv } from "@/lib/redsys";
import {
  cobrarGarantia,
  cobrosPorRevisar,
  devolverPago,
  devolvibles,
  ESTADO_FILA_TXT,
  ESTADO_PAGO_TXT,
  ESTADOS_COBRABLES,
  marcarCobroRevisado,
  motivoCobrable,
  motivoRevisionCobro,
  noShowsPorCobrar,
  pagosDeReserva,
  porDevolverAMano,
  requiereRevision,
  resolverIncierto,
  TIPO_PAGO_TXT,
  type CobroPorRevisar,
  type MotivoCargo,
  type NoShowPorCobrar,
  type Pago,
} from "@/lib/pagos-reservas";

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

const ERRORES: Record<string, string> = {
  no_encontrada: "Reserva no encontrada.",
  no_encontrado: "Pago no encontrado.",
  estado_no_cobrable: "Solo se cobra la garantía de reservas en no-show o canceladas por el cliente. Marca antes el no-show.",
  cancelacion_en_plazo: "El cliente canceló dentro de plazo: no procede cargo.",
  cancelada_no_cliente: "La reserva no la canceló el cliente (la canceló el restaurante o el sistema): no procede cargo.",
  sin_garantia: "La reserva no tiene garantía activa.",
  sin_importe: "La reserva no tiene importe de garantía.",
  importe_invalido: "El importe no es válido (mayor que cero y sin pasar del máximo).",
  sin_tarjeta: "No hay tarjeta registrada para esta reserva.",
  ya_cobrado: "El cargo ya se cobró.",
  en_curso: "Ya hay una operación en curso para esta reserva. Espera unos segundos y vuelve a mirar.",
  incierto:
    "El banco no ha contestado y no sabemos si la operación se ha hecho. Antes de reintentar, búscala en el portal del TPV de CaixaBank y márcala como hecha o no hecha.",
  no_incierto: "Esta operación ya está resuelta.",
  no_devolvible: "Este pago no se puede devolver (solo cobros completados con importe pendiente).",
  no_iniciado: "No se pudo registrar la operación.",
  firma_invalida: "La respuesta del banco no es válida.",
  tpv: "El TPV no está configurado (variables TPV_* en Vercel).",
  permiso: "Solo dirección puede cobrar, devolver o resolver pagos.",
};

const mensaje = (e: string) =>
  ERRORES[e] ??
  (e.startsWith("DS_RESPONSE_")
    ? `El banco ha denegado la operación (${e.replace("DS_RESPONSE_", "código ")}).`
    : e.startsWith("SIS")
      ? `Error del TPV ${e}.`
      : "Operación rechazada.");

async function contexto() {
  const { supabase, perfil } = await exigirModulo("reservas");
  return { sb: supabase, perfil, esDireccion: perfil.rol === "direccion" };
}

export type FilaPago = Pago & {
  tipo_txt: string;
  estado_txt: string;
  /** Cargo o devolución sin respuesta del banco: dirección debe resolverla mirando el portal. */
  revisar: boolean;
  /** Cobro que probablemente hay que devolver (frase para enseñar), o null. */
  aviso: string | null;
  /** Importe que aún se puede devolver de este cobro (0 si nada). */
  devolvible: number;
};

export type EstadoPagos = {
  estado: string;
  estado_pago: string;
  estado_pago_txt: string;
  tipo: string;
  importe_garantia: number | null;
  importe_prepago: number | null;
  /** Tarjeta registrada (máscara y caducidad AAMM) del último pago que la trae, si lo hay. */
  tarjeta: { mascara: string | null; caducidad: string | null } | null;
  /** Historial, del más reciente al más antiguo. */
  pagos: FilaPago[];
  /** Hay garantía con tarjeta, la reserva está en no-show/cancelada y no hay cargo cobrado ni en curso. */
  puede_cobrar: boolean;
  /** Motivo por el que no se puede cobrar (para el tooltip del botón), o null. */
  motivo_no_cobrar: string | null;
  /** Máximo que se puede cobrar (importe_garantia). */
  cobro_max: number;
  /** Motivo con el que se cobraría (sale del estado de la reserva), o null si no procede. */
  motivo_cargo: MotivoCargo | null;
  /** Primer cobro con importe devolvible (atajo para el botón «Devolver»), o null. */
  devolvible_id: string | null;
  devolvible_max: number;
  /** Hay operaciones inciertas que dirección tiene que resolver. */
  hay_revision: boolean;
  /** Hay cobros que probablemente hay que devolver (filas con `aviso`). */
  hay_por_devolver: boolean;
  es_direccion: boolean;
  /** Enlace público para meter la tarjeta / pagar (solo con la reserva en tarjeta_pendiente). */
  enlace_pago: string | null;
};

/** Estado de pago de una reserva y su historial de operaciones (lectura bajo RLS). */
export async function estadoPagos(reservaId: string): Promise<R<EstadoPagos>> {
  const { sb, esDireccion } = await contexto();
  const [{ data: r }, { data: pagos }] = await Promise.all([
    sb
      .from("reservas_reservas")
      .select(
        "id, estado, estado_pago, tipo, importe_garantia, importe_prepago, token, restaurante_id, fecha, hora, cancelada_por, cancelada_en, reservas_restaurantes(zona_horaria, politica_cancelacion_horas)",
      )
      .eq("id", reservaId)
      .maybeSingle(),
    sb.from("reservas_pagos").select("*").eq("reserva_id", reservaId).order("creado_en", { ascending: false }),
  ]);
  if (!r) return { ok: false, error: ERRORES.no_encontrada };
  const lista = pagos ?? [];

  const garantia = lista.find((p) => p.tipo === "garantia" && p.estado === "autorizado" && p.identificador_cof);
  const conTarjeta = lista.find((p) => p.tarjeta_mascara);
  const yaCobrado = lista.some((p) => p.tipo === "cargo_noshow" && p.estado === "cobrado");
  const enVuelo = lista.find((p) => p.tipo === "cargo_noshow" && p.estado === "iniciado" && p.ds_order);
  const cobroMax = Number(r.importe_garantia ?? 0);
  const devs = devolvibles(lista);
  const porDevolver = new Map(devs.map((d) => [d.pago.id, d.disponible]));

  // Mismo criterio que cobrarGarantia: no-show, o cancelación tardía hecha por el cliente.
  const procede = ESTADOS_COBRABLES.includes(r.estado) ? motivoCobrable(r, r.reservas_restaurantes) : null;

  let motivo: string | null = null;
  if (!garantia) motivo = r.estado_pago === "garantizada" ? ERRORES.sin_tarjeta : ERRORES.sin_garantia;
  else if (yaCobrado) motivo = ERRORES.ya_cobrado;
  else if (enVuelo) motivo = requiereRevision(enVuelo) ? ERRORES.incierto : ERRORES.en_curso;
  else if (!["garantizada", "fallido"].includes(r.estado_pago)) motivo = ERRORES.sin_garantia;
  else if (!(cobroMax > 0)) motivo = ERRORES.sin_importe;
  else if (!procede) motivo = ERRORES.estado_no_cobrable;
  else if (!procede.ok) motivo = mensaje(procede.error);

  let enlace: string | null = null;
  if (r.estado === "tarjeta_pendiente" && r.token) {
    const { data: base } = await sb.rpc("reservas_url_base", { p_restaurante: r.restaurante_id });
    enlace = `${base || ""}/reserva/${r.token}/pago`;
  }

  const filas: FilaPago[] = lista.map((p) => ({
    ...p,
    tipo_txt: TIPO_PAGO_TXT[p.tipo] ?? p.tipo,
    estado_txt: requiereRevision(p) ? "Sin respuesta del banco" : (ESTADO_FILA_TXT[p.estado] ?? p.estado),
    revisar: requiereRevision(p),
    aviso: porDevolver.has(p.id) ? motivoRevisionCobro(p, r.estado) : null,
    devolvible: porDevolver.get(p.id) ?? 0,
  }));

  return {
    ok: true,
    data: {
      estado: r.estado,
      estado_pago: r.estado_pago,
      estado_pago_txt: ESTADO_PAGO_TXT[r.estado_pago] ?? r.estado_pago,
      tipo: r.tipo,
      importe_garantia: r.importe_garantia,
      importe_prepago: r.importe_prepago,
      tarjeta: conTarjeta ? { mascara: conTarjeta.tarjeta_mascara, caducidad: conTarjeta.tarjeta_caducidad } : null,
      pagos: filas,
      puede_cobrar: motivo === null,
      motivo_no_cobrar: motivo,
      cobro_max: cobroMax,
      motivo_cargo: procede?.ok ? procede.motivo : null,
      devolvible_id: devs[0]?.pago.id ?? null,
      devolvible_max: devs[0]?.disponible ?? 0,
      hay_revision: filas.some((f) => f.revisar),
      hay_por_devolver: filas.some((f) => !!f.aviso),
      es_direccion: esDireccion,
      enlace_pago: enlace,
    },
  };
}

/**
 * Cobra la garantía de la reserva con la tarjeta guardada (no-show o cancelación tardía).
 * Solo dirección. Sin importe = importe_garantia entero; con importe = cargo parcial (nunca más
 * que la garantía). No cobra dos veces.
 */
export async function cobrarNoShow(reservaId: string, motivo: MotivoCargo = "no_show", importe?: number | null): Promise<R<Pago>> {
  const { sb, perfil, esDireccion } = await contexto();
  if (!esDireccion) return { ok: false, error: ERRORES.permiso };
  // La reserva tiene que ser visible para el usuario (RLS por cuenta) antes de tocar nada.
  const { data: r } = await sb.from("reservas_reservas").select("id").eq("id", reservaId).maybeSingle();
  if (!r) return { ok: false, error: ERRORES.no_encontrada };
  if (motivo !== "no_show" && motivo !== "cancelacion_tardia") motivo = "no_show";

  const cfg = configTpv();
  const servicio = crearClienteServicio();
  if (!cfg || !servicio) return { ok: false, error: ERRORES.tpv };

  const res = await cobrarGarantia(servicio, cfg, { reservaId, motivo, importe: importe ?? null, creadoPor: perfil.id });
  if (!res.ok) return { ok: false, error: mensaje(res.error) };
  return { ok: true, data: res.data };
}

/** Devuelve un cobro (prepago o cargo por no-show), entero o en parte. Solo dirección. */
export async function devolver(pagoId: string, importe?: number | null): Promise<R<Pago>> {
  const { sb, perfil, esDireccion } = await contexto();
  if (!esDireccion) return { ok: false, error: ERRORES.permiso };
  const { data: p } = await sb.from("reservas_pagos").select("id").eq("id", pagoId).maybeSingle();
  if (!p) return { ok: false, error: ERRORES.no_encontrado };

  const cfg = configTpv();
  const servicio = crearClienteServicio();
  if (!cfg || !servicio) return { ok: false, error: ERRORES.tpv };

  const res = await devolverPago(servicio, cfg, { pagoId, importe: importe ?? null, creadoPor: perfil.id });
  if (!res.ok) return { ok: false, error: mensaje(res.error) };
  return { ok: true, data: res.data };
}

/**
 * Resuelve un cargo o devolución que se quedó sin respuesta del banco, después de mirarlo en el
 * portal del TPV: `hecho = true` si allí aparece autorizado. Solo dirección.
 */
export async function resolverPagoIncierto(pagoId: string, hecho: boolean): Promise<R<Pago>> {
  const { sb, perfil, esDireccion } = await contexto();
  if (!esDireccion) return { ok: false, error: ERRORES.permiso };
  const { data: p } = await sb.from("reservas_pagos").select("id").eq("id", pagoId).maybeSingle();
  if (!p) return { ok: false, error: ERRORES.no_encontrado };
  const servicio = crearClienteServicio();
  if (!servicio) return { ok: false, error: ERRORES.tpv };
  const res = await resolverIncierto(servicio, { pagoId, hecho: !!hecho, resueltoPor: perfil.id });
  if (!res.ok) return { ok: false, error: mensaje(res.error) };
  return { ok: true, data: res.data };
}

/** Historial de pagos de una reserva (para listados o el tracking). */
export async function listarPagos(reservaId: string): Promise<Pago[]> {
  const { sb } = await contexto();
  return pagosDeReserva(sb, reservaId);
}

/**
 * Reservas (de entre estas) con algo de pagos por resolver: operaciones sin respuesta del banco o
 * cobros cuya devolución automática no salió. Atajo para pintar un aviso en listas. Para el Inbox
 * es mejor pagosPorRevisar(restauranteId), que no necesita la lista de ids.
 */
export async function hayPagosInciertos(reservaIds: string[]): Promise<string[]> {
  const { sb } = await contexto();
  if (!reservaIds.length) return [];
  const { data } = await sb
    .from("reservas_pagos")
    .select("reserva_id, respuesta, estado, tipo, ds_order, creado_en")
    .in("reserva_id", reservaIds.slice(0, 200))
    .in("estado", ["iniciado", "cobrado"])
    .in("tipo", ["prepago", "cargo_noshow", "devolucion"]);
  const marcadas = (data ?? []).filter((p) => (p.estado === "iniciado" ? requiereRevision(p) : porDevolverAMano(p)));
  return [...new Set(marcadas.map((p) => p.reserva_id))];
}

/** Datos de la reserva para pintar una fila de la lista de pagos por revisar. */
export type ReservaRevision = {
  id: string;
  fecha: string;
  hora: string;
  pax: number;
  estado: string;
  localizador: string | null;
  nombre: string;
};

export type PagosPorRevisar = {
  /** Cargos o devoluciones sin respuesta del banco: mirar el portal del TPV y resolver. */
  inciertos: Array<{ pago: Pago; reserva: ReservaRevision | null }>;
  /** Cobros que probablemente hay que devolver (cancelada con prepago, devolución automática fallida…). */
  cobros: Array<CobroPorRevisar & { reserva: ReservaRevision | null }>;
  /** No-shows garantizados sin cobrar de los últimos días. */
  noshows: Array<NoShowPorCobrar & { reserva: ReservaRevision | null }>;
  total: number;
  es_direccion: boolean;
};

/**
 * Todo lo de pagos que alguien del restaurante tiene que mirar (apartado «Pagos» del Inbox).
 * Lectura bajo RLS con el cliente del usuario; filtra por restaurante, sin pasar ids.
 */
export async function pagosPorRevisar(restauranteId: string): Promise<R<PagosPorRevisar>> {
  const { sb, esDireccion } = await contexto();
  if (!restauranteId) return { ok: false, error: ERRORES.no_encontrada };
  const [{ data: iniciados }, cobros, noshows] = await Promise.all([
    sb
      .from("reservas_pagos")
      .select("*")
      .eq("restaurante_id", restauranteId)
      .eq("estado", "iniciado")
      .in("tipo", ["cargo_noshow", "devolucion"])
      .order("creado_en", { ascending: true })
      .limit(200),
    cobrosPorRevisar(sb, restauranteId),
    noShowsPorCobrar(sb, 7, { restauranteId, soloAutomatico: false }),
  ]);
  const inciertos = (iniciados ?? []).filter((p) => requiereRevision(p));

  const ids = [...new Set([...inciertos.map((p) => p.reserva_id), ...cobros.map((c) => c.reserva_id), ...noshows.map((n) => n.reserva_id)])];
  const reservas = new Map<string, ReservaRevision>();
  if (ids.length) {
    const { data } = await sb
      .from("reservas_reservas")
      .select("id, fecha, hora, pax, estado, localizador, reservas_clientes(nombre, apellidos)")
      .in("id", ids);
    for (const r of data ?? []) {
      const c = r.reservas_clientes;
      reservas.set(r.id, {
        id: r.id,
        fecha: r.fecha,
        hora: r.hora,
        pax: r.pax,
        estado: r.estado,
        localizador: r.localizador,
        nombre: [c?.nombre, c?.apellidos].filter(Boolean).join(" ") || "Sin nombre",
      });
    }
  }
  const de = (id: string) => reservas.get(id) ?? null;
  return {
    ok: true,
    data: {
      inciertos: inciertos.map((pago) => ({ pago, reserva: de(pago.reserva_id) })),
      cobros: cobros.map((c) => ({ ...c, reserva: de(c.reserva_id) })),
      noshows: noshows.map((n) => ({ ...n, reserva: de(n.reserva_id) })),
      total: inciertos.length + cobros.length + noshows.length,
      es_direccion: esDireccion,
    },
  };
}

/** Dirección decide que un cobro de la lista de revisión se queda (no se devuelve). */
export async function darCobroPorRevisado(pagoId: string): Promise<R<Pago>> {
  const { sb, perfil, esDireccion } = await contexto();
  if (!esDireccion) return { ok: false, error: ERRORES.permiso };
  const { data: p } = await sb.from("reservas_pagos").select("id").eq("id", pagoId).maybeSingle();
  if (!p) return { ok: false, error: ERRORES.no_encontrado };
  const servicio = crearClienteServicio();
  if (!servicio) return { ok: false, error: ERRORES.tpv };
  const res = await marcarCobroRevisado(servicio, { pagoId, revisadoPor: perfil.id });
  if (!res.ok) return { ok: false, error: mensaje(res.error) };
  return { ok: true, data: res.data };
}
