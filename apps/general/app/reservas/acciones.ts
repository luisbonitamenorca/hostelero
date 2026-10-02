"use server";

import { exigirModulo } from "@/lib/supabase/server";
import type { Reserva } from "./tipos";

// Lecturas comunes del panel (salas+mesas+turnos y reservas del día). El resto de acciones vive
// en acciones/<seccion>.ts. Cliente autenticado bajo RLS (cuenta_id = cuenta_actual()).
async function cliente() {
  const { supabase } = await exigirModulo("reservas");
  return supabase;
}

/* ================= Lecturas ================= */

export async function cargarLocal(restauranteId: string) {
  const sb = await cliente();
  const [salas, turnos] = await Promise.all([
    sb
      .from("reservas_salas")
      .select("*, mesas:reservas_mesas(*)")
      .eq("restaurante_id", restauranteId)
      .order("orden"),
    sb.from("reservas_turnos").select("*").eq("restaurante_id", restauranteId).order("hora_inicio"),
  ]);
  return { salas: salas.data ?? [], turnos: turnos.data ?? [] };
}

/** Reservas del día con cliente y mesas (las usa el Cronograma). `_hoy` se mantiene por compatibilidad. */
export async function cargarDia(restauranteId: string, fecha: string, _hoy?: string) {
  const sb = await cliente();
  const res = await sb
    .from("reservas_reservas")
    .select("*, reservas_clientes(*), reservas_reserva_mesas(mesa_id)")
    .eq("restaurante_id", restauranteId)
    .eq("fecha", fecha)
    .order("hora");
  return { reservas: (res.data ?? []) as unknown as Reserva[] };
}
