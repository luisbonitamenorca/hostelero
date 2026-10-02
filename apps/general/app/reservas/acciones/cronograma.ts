"use server";

/* Acciones de servidor de la sección Cronograma (mesas × horas).
   Todo pasa por el cliente autenticado bajo RLS; nada de service key. */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables } from "@hostelero/db";

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

export type Bloqueo = Tables<"reservas_bloqueos">;

const RE_UUID = /^[0-9a-f-]{36}$/i;
const RE_HORA = /^\d{2}:\d{2}(:\d{2})?$/;

async function cliente() {
  const { supabase } = await exigirModulo("reservas");
  return supabase;
}

/** "13:30" o "13:30:00" → "13:30:00" (lo que guarda la columna time). */
function horaSql(h: string): string {
  const [hh = "0", mm = "0"] = h.split(":");
  return `${hh.padStart(2, "0")}:${mm.padStart(2, "0")}:00`;
}

/** Lunes = 1 … domingo = 7 (como reservas_turnos.dias_semana). */
function isoDow(fecha: string): number {
  return ((new Date(fecha + "T12:00:00").getDay() + 6) % 7) + 1;
}

/** Bloqueos del día (mesa, sala o restaurante entero) para pintar las franjas rayadas. */
export async function bloqueosDia(restauranteId: string, fecha: string): Promise<Bloqueo[]> {
  const sb = await cliente();
  const { data } = await sb
    .from("reservas_bloqueos")
    .select("*")
    .eq("restaurante_id", restauranteId)
    .eq("fecha", fecha)
    .order("hora_inicio");
  return data ?? [];
}

/**
 * Mueve una reserva a otra hora y, si se indica, a otra mesa.
 * - `mesaId` undefined: solo cambia la hora.
 * - `mesaId` null: libera la mesa (pasa a «Sin mesa»). Si se arrastró una mesa secundaria de una
 *   combinación (`mesaOrigen`), solo se quita esa mesa y la reserva conserva las demás.
 * - `mesaOrigen`: mesa desde la que se arrastró. Si la reserva ocupa varias mesas, solo se
 *   sustituye esa dentro de la combinación; si no, la combinación pasa a ser la mesa nueva.
 * El turno se recalcula con la hora nueva (null si queda fuera de todos).
 */
export async function moverReserva(
  id: string,
  hora: string,
  mesaId?: string | null,
  mesaOrigen?: string | null,
): Promise<R> {
  // Validación de entrada: nada llega a los filtros de PostgREST sin pasar por aquí
  if (typeof id !== "string" || !RE_UUID.test(id)) return { ok: false, error: "Reserva no válida." };
  if (typeof hora !== "string" || !RE_HORA.test(hora)) return { ok: false, error: "Hora no válida." };
  const [hh, mm] = hora.split(":").map(Number);
  if (hh > 23 || mm > 59) return { ok: false, error: "Hora no válida." };
  if (mesaId != null && (typeof mesaId !== "string" || !RE_UUID.test(mesaId))) return { ok: false, error: "Mesa no válida." };
  if (mesaOrigen != null && (typeof mesaOrigen !== "string" || !RE_UUID.test(mesaOrigen))) return { ok: false, error: "Mesa de origen no válida." };

  const sb = await cliente();
  const { data: r, error: eR } = await sb
    .from("reservas_reservas")
    .select("id, restaurante_id, fecha, mesa_id, reservas_reserva_mesas(mesa_id)")
    .eq("id", id)
    .maybeSingle();
  if (eR) return { ok: false, error: eR.message };
  if (!r) return { ok: false, error: "La reserva ya no existe." };

  // La mesa de destino tiene que ser del mismo restaurante que la reserva
  if (typeof mesaId === "string") {
    const { data: mesa, error: eM } = await sb
      .from("reservas_mesas")
      .select("id, reservas_salas!inner(restaurante_id)")
      .eq("id", mesaId)
      .eq("reservas_salas.restaurante_id", r.restaurante_id)
      .maybeSingle();
    if (eM) return { ok: false, error: eM.message };
    if (!mesa) return { ok: false, error: "Esa mesa no es de este restaurante." };
  }

  // Turno que corresponde a la hora nueva (también los que cruzan la medianoche)
  const h = horaSql(hora);
  const { data: turnos } = await sb
    .from("reservas_turnos")
    .select("id, hora_inicio, hora_fin, dias_semana, activo")
    .eq("restaurante_id", r.restaurante_id);
  const dow = isoDow(r.fecha);
  const turno = (turnos ?? []).find((t) => {
    if (!t.activo || !(t.dias_semana || []).includes(dow)) return false;
    return t.hora_fin < t.hora_inicio ? h >= t.hora_inicio || h <= t.hora_fin : h >= t.hora_inicio && h <= t.hora_fin;
  });

  const fila: { hora: string; turno_id: string | null; actualizado_en: string; mesa_id?: string | null } = {
    hora: h,
    turno_id: turno?.id ?? null,
    actualizado_en: new Date().toISOString(),
  };

  // Combinación de mesas resultante
  let combinacion: string[] | null = null;
  if (mesaId !== undefined) {
    const actuales = (r.reservas_reserva_mesas ?? []).map((x) => x.mesa_id);
    if (r.mesa_id && !actuales.includes(r.mesa_id)) actuales.push(r.mesa_id);
    const enCombinacion = !!mesaOrigen && actuales.length > 1 && actuales.includes(mesaOrigen);
    if (mesaId === null) {
      if (enCombinacion) {
        // Solo sale de la combinación la mesa arrastrada
        combinacion = actuales.filter((m) => m !== mesaOrigen);
        fila.mesa_id = r.mesa_id && r.mesa_id !== mesaOrigen ? r.mesa_id : combinacion[0];
      } else {
        combinacion = [];
        fila.mesa_id = null;
      }
    } else if (enCombinacion) {
      combinacion = [...new Set(actuales.map((m) => (m === mesaOrigen ? mesaId : m)))];
      fila.mesa_id = r.mesa_id === mesaOrigen || !r.mesa_id ? mesaId : r.mesa_id;
    } else {
      combinacion = [mesaId];
      fila.mesa_id = mesaId;
    }
  }

  const { error } = await sb.from("reservas_reservas").update(fila).eq("id", id);
  if (error) return { ok: false, error: error.message };

  // Primero se añade la combinación nueva y después se quitan las sobrantes: si algo falla a
  // medias, la reserva se queda con mesas de más (visible y corregible), nunca sin ninguna.
  // (Lo ideal sería una RPC transaccional; queda anotado para el integrador.)
  if (combinacion) {
    if (combinacion.length) {
      const { error: eU } = await sb
        .from("reservas_reserva_mesas")
        .upsert(
          combinacion.map((m) => ({ reserva_id: id, mesa_id: m })),
          { onConflict: "reserva_id,mesa_id", ignoreDuplicates: true },
        );
      if (eU) return { ok: false, error: eU.message };
      const { error: eD } = await sb
        .from("reservas_reserva_mesas")
        .delete()
        .eq("reserva_id", id)
        .not("mesa_id", "in", `(${combinacion.join(",")})`);
      if (eD) return { ok: false, error: eD.message };
    } else {
      const { error: eD } = await sb.from("reservas_reserva_mesas").delete().eq("reserva_id", id);
      if (eD) return { ok: false, error: eD.message };
    }
  }
  return { ok: true };
}

/** Cambia la duración (minutos, en bloques de 15, entre 15 y 600). */
export async function cambiarDuracion(id: string, min: number): Promise<R> {
  if (typeof id !== "string" || !RE_UUID.test(id)) return { ok: false, error: "Reserva no válida." };
  if (typeof min !== "number" || !Number.isFinite(min)) return { ok: false, error: "Duración no válida." };
  const sb = await cliente();
  const dur = Math.max(15, Math.min(600, Math.round(min / 15) * 15));
  const { error } = await sb
    .from("reservas_reservas")
    .update({ duracion_min: dur, actualizado_en: new Date().toISOString() })
    .eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
