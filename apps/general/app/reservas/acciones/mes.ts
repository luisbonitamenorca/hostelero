"use server";

/* Acciones de servidor de la sección Mes (ocupación por día y turno, cupos en bloque).
   Cliente autenticado bajo RLS; la UI nueva escribe en reservas_cupos (los reservas_cierres
   antiguos siguen contando como «cerrado» en la RPC). */

import { exigirModulo } from "@/lib/supabase/server";

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

const RE_UUID = /^[0-9a-f-]{36}$/i;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Una fila por día y turno, tal como la devuelve reservas_ocupacion_mes. */
export type OcupacionTurno = {
  fecha: string;
  turno_id: string;
  turno: string;
  reservas: number;
  pax: number;
  aforo: number;
  mesas_ocupadas: number;
  mesas_total: number;
  cerrado: boolean;
  max_pax_online: number | null;
  nota: string | null;
};

export type DatosMes = {
  ok: boolean;
  error?: string;
  filas: OcupacionTurno[];
  /** Nº de entradas vivas en lista de espera por fecha. */
  espera: Record<string, number>;
  /** Notas del día (reservas_notas_dia) por fecha, en orden de creación. */
  notas: Record<string, string[]>;
  /** Cupos de día completo (turno_id null) por fecha: cerrado / aforo online / nota. */
  cuposDia: Record<string, { cerrado: boolean; max_pax_online: number | null; nota: string | null }>;
};

/** "2026-10-01" + n días (en UTC, sin sorpresas de horario de verano). */
function sumarDias(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function cliente() {
  const { supabase } = await exigirModulo("reservas");
  return supabase;
}

const VACIO = { filas: [], espera: {}, notas: {}, cuposDia: {} };

/** Ocupación del rango (máx. 93 días, como la RPC) + lista de espera + notas del día. */
export async function ocupacionMes(restId: string, desde: string, hasta: string): Promise<DatosMes> {
  if (!RE_FECHA.test(desde) || !RE_FECHA.test(hasta)) return { ok: false, error: "Rango de fechas no válido.", ...VACIO };
  // Mismo tope que reservas_ocupacion_mes: el resto de consultas no deben ir más allá
  const tope = sumarDias(desde, 92);
  if (hasta > tope) hasta = tope;

  const sb = await cliente();
  const [rpc, esp, notas, cupos] = await Promise.all([
    sb.rpc("reservas_ocupacion_mes", { p_restaurante: restId, p_desde: desde, p_hasta: hasta }),
    sb
      .from("reservas_lista_espera")
      .select("fecha")
      .eq("restaurante_id", restId)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .in("estado", ["esperando", "avisado"]),
    sb
      .from("reservas_notas_dia")
      .select("fecha, texto")
      .eq("restaurante_id", restId)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("creado_en"),
    sb
      .from("reservas_cupos")
      .select("fecha, cerrado, max_pax_online, nota")
      .eq("restaurante_id", restId)
      .is("turno_id", null)
      .gte("fecha", desde)
      .lte("fecha", hasta),
  ]);
  const fallo = rpc.error || esp.error || notas.error || cupos.error;
  if (fallo) return { ok: false, error: fallo.message, ...VACIO };

  const espera: Record<string, number> = {};
  (esp.data ?? []).forEach((e) => { espera[e.fecha] = (espera[e.fecha] || 0) + 1; });
  const notasMap: Record<string, string[]> = {};
  (notas.data ?? []).forEach((n) => { (notasMap[n.fecha] = notasMap[n.fecha] || []).push(n.texto); });
  const cuposDia: DatosMes["cuposDia"] = {};
  (cupos.data ?? []).forEach((c) => { cuposDia[c.fecha] = { cerrado: c.cerrado, max_pax_online: c.max_pax_online, nota: c.nota }; });

  return { ok: true, filas: (rpc.data ?? []) as OcupacionTurno[], espera, notas: notasMap, cuposDia };
}

export type CambiosCupo = {
  cerrado?: boolean;
  max_pax_online?: number | null;
  max_pax_total?: number | null;
  nota?: string | null;
};

/**
 * Aplica los mismos cambios de cupo a varias fechas (y a un turno, o al día completo si
 * turnoId es null). Crea la fila de reservas_cupos si no existe y actualiza si existe.
 *
 * Reglas para que lo que se ve cuadre con lo que aplican las RPC (que miran primero la fila
 * del turno y, si no hay, la del día):
 * - ABRIR el día completo abre también los turnos cerrados de esas fechas y borra todos los
 *   reservas_cierres antiguos (de día y de turno).
 * - ABRIR un turno de un día cerrado entero no se puede: se pide abrir el día completo.
 * - Fijar aforo online / total en el día completo lo copia a las filas de turno que ya existan;
 *   una fila de turno nueva hereda esos límites de la fila del día.
 */
export async function cuposMasivo(
  restId: string,
  fechas: string[],
  turnoId: string | null,
  cambios: CambiosCupo,
): Promise<R<{ afectadas: number }>> {
  if (typeof restId !== "string" || !RE_UUID.test(restId)) return { ok: false, error: "Restaurante no válido." };
  if (turnoId !== null && (typeof turnoId !== "string" || !RE_UUID.test(turnoId))) return { ok: false, error: "Turno no válido." };
  const lista = [...new Set((fechas ?? []).filter((f) => typeof f === "string" && RE_FECHA.test(f)))].sort();
  if (!lista.length) return { ok: false, error: "No hay fechas seleccionadas." };
  if (lista.length > 93) return { ok: false, error: "Como mucho 93 días de una vez." };
  const campos: CambiosCupo = {};
  if (cambios.cerrado !== undefined) campos.cerrado = !!cambios.cerrado;
  if (cambios.max_pax_online !== undefined) {
    if (cambios.max_pax_online !== null && !Number.isFinite(cambios.max_pax_online)) return { ok: false, error: "Aforo no válido." };
    campos.max_pax_online = cambios.max_pax_online === null ? null : Math.max(0, Math.round(cambios.max_pax_online));
  }
  if (cambios.max_pax_total !== undefined) {
    if (cambios.max_pax_total !== null && !Number.isFinite(cambios.max_pax_total)) return { ok: false, error: "Aforo no válido." };
    campos.max_pax_total = cambios.max_pax_total === null ? null : Math.max(0, Math.round(cambios.max_pax_total));
  }
  if (cambios.nota !== undefined) campos.nota = (cambios.nota ?? "").trim().slice(0, 500) || null;
  if (!Object.keys(campos).length) return { ok: false, error: "No hay nada que cambiar." };

  const sb = await cliente();

  // El restaurante (y el turno) se leen bajo RLS: si no es de la cuenta, no existe
  const { data: rest, error: eRest } = await sb
    .from("reservas_restaurantes")
    .select("id, cuenta_id")
    .eq("id", restId)
    .maybeSingle();
  if (eRest) return { ok: false, error: eRest.message };
  if (!rest) return { ok: false, error: "Restaurante no encontrado." };
  if (turnoId) {
    const { data: t, error: eT } = await sb
      .from("reservas_turnos")
      .select("id")
      .eq("id", turnoId)
      .eq("restaurante_id", restId)
      .maybeSingle();
    if (eT) return { ok: false, error: eT.message };
    if (!t) return { ok: false, error: "Ese turno no es de este restaurante." };
  }

  // Filas de día completo de esas fechas (para heredar límites y para saber si el día está cerrado)
  const { data: filasDia, error: eDia } = await sb
    .from("reservas_cupos")
    .select("id, fecha, cerrado, max_pax_online, max_pax_total")
    .eq("restaurante_id", restId)
    .is("turno_id", null)
    .in("fecha", lista);
  if (eDia) return { ok: false, error: eDia.message };
  const diaPorFecha = new Map((filasDia ?? []).map((x) => [x.fecha, x]));

  // Abrir un turno con el día entero cerrado: la RPC seguiría viéndolo cerrado
  if (turnoId && campos.cerrado === false) {
    const { data: cierresDia, error: eC } = await sb
      .from("reservas_cierres")
      .select("fecha")
      .eq("restaurante_id", restId)
      .is("turno_id", null)
      .in("fecha", lista);
    if (eC) return { ok: false, error: eC.message };
    const cerradas = new Set([
      ...(filasDia ?? []).filter((x) => x.cerrado).map((x) => x.fecha),
      ...(cierresDia ?? []).map((x) => x.fecha),
    ]);
    if (cerradas.size) {
      const n = cerradas.size;
      return {
        ok: false,
        error: `${n === 1 ? "Hay 1 día cerrado" : `Hay ${n} días cerrados`} entero${n === 1 ? "" : "s"} en la selección: ábre${n === 1 ? "lo" : "los"} con «Día completo».`,
      };
    }
  }

  const ahora = new Date().toISOString();

  // Filas existentes para esas fechas y ese turno (o día completo)
  let existentes: { id: string; fecha: string }[];
  if (turnoId) {
    const { data, error } = await sb
      .from("reservas_cupos")
      .select("id, fecha")
      .eq("restaurante_id", restId)
      .eq("turno_id", turnoId)
      .in("fecha", lista);
    if (error) return { ok: false, error: error.message };
    existentes = data ?? [];
  } else {
    existentes = (filasDia ?? []).map((x) => ({ id: x.id, fecha: x.fecha }));
  }

  const idsExist = existentes.map((x) => x.id);
  const fechasExist = new Set(existentes.map((x) => x.fecha));
  if (idsExist.length) {
    const { error } = await sb
      .from("reservas_cupos")
      .update({ ...campos, actualizado_en: ahora })
      .in("id", idsExist);
    if (error) return { ok: false, error: error.message };
  }
  const nuevas = lista.filter((f) => !fechasExist.has(f));
  if (nuevas.length) {
    const { error } = await sb.from("reservas_cupos").insert(
      nuevas.map((fecha) => {
        // Una fila de turno nueva hereda los límites del día (si no se están fijando ahora)
        const dia = turnoId ? diaPorFecha.get(fecha) : undefined;
        return {
          cuenta_id: rest.cuenta_id,
          restaurante_id: restId,
          fecha,
          turno_id: turnoId,
          max_pax_online: dia?.max_pax_online ?? null,
          max_pax_total: dia?.max_pax_total ?? null,
          ...campos,
        };
      }),
    );
    if (error) return { ok: false, error: error.message };
  }

  if (!turnoId) {
    // Día completo: los límites de aforo se copian a las filas de turno que ya existan
    const limites: { max_pax_online?: number | null; max_pax_total?: number | null } = {};
    if (campos.max_pax_online !== undefined) limites.max_pax_online = campos.max_pax_online;
    if (campos.max_pax_total !== undefined) limites.max_pax_total = campos.max_pax_total;
    if (Object.keys(limites).length) {
      const { error } = await sb
        .from("reservas_cupos")
        .update({ ...limites, actualizado_en: ahora })
        .eq("restaurante_id", restId)
        .not("turno_id", "is", null)
        .in("fecha", lista);
      if (error) return { ok: false, error: error.message };
    }
    // Abrir el día completo abre también los turnos de esas fechas
    if (campos.cerrado === false) {
      const { error } = await sb
        .from("reservas_cupos")
        .update({ cerrado: false, actualizado_en: ahora })
        .eq("restaurante_id", restId)
        .not("turno_id", "is", null)
        .eq("cerrado", true)
        .in("fecha", lista);
      if (error) return { ok: false, error: error.message };
    }
  }

  // Abrir: quitar también los cierres del esquema anterior (todos si es el día completo)
  if (campos.cerrado === false) {
    let d = sb.from("reservas_cierres").delete().eq("restaurante_id", restId).in("fecha", lista);
    if (turnoId) d = d.eq("turno_id", turnoId);
    const { error } = await d;
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true, data: { afectadas: lista.length } };
}
