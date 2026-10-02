"use server";

/* Acciones de la pantalla Día (lista + plano). Cliente autenticado bajo RLS: nada de
   service key. Los sellos de llegada/sentada/salida/cancelación los pone el trigger
   reservas_reservas_sellar al cambiar de estado; aquí solo se escribe el estado y lo que
   el trigger no sabe (pax llegados, motivo, quién cancela). */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables, TablesUpdate } from "@hostelero/db";
import { EST, ORIGEN, TIPO_RESERVA, dowDe, h5, textoCanal, type Espera, type Reserva, type Sala, type Turno } from "../tipos";

async function cliente() {
  const { supabase, perfil } = await exigirModulo("reservas");
  return { sb: supabase, perfil };
}

type R<T = undefined> = { ok: boolean; error?: string; data?: T };
type Sb = Awaited<ReturnType<typeof cliente>>["sb"];

/* ==================== Validación de entrada ==================== */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}(:\d{2})?$/;
const esUuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);

/* ==================== Permisos (reservas_permisos_perfil) ==================== */

type Permiso = "puede_cambiar_estado" | "puede_mover" | null;

/** Mismo patrón que exigirEdicionPlano (acciones/plano.ts): dirección pasa siempre; sin fila
    de permisos, valen los valores por defecto de la tabla (todo permitido); con fila, se exige
    el flag (si se pide) y que el restaurante esté en su lista (si la lista no es null). */
async function exigirPermiso(permiso: Permiso, restauranteId: string | null) {
  const { sb, perfil } = await cliente();
  if (perfil.rol === "direccion") return { sb, perfil };
  const { data } = await sb
    .from("reservas_permisos_perfil")
    .select("puede_cambiar_estado, puede_mover, restaurantes")
    .eq("perfil_id", perfil.id)
    .maybeSingle();
  if (!data) return { sb, perfil };
  if (permiso === "puede_cambiar_estado" && !data.puede_cambiar_estado) throw new Error("No tienes permiso para cambiar el estado de las reservas.");
  if (permiso === "puede_mover" && !data.puede_mover) throw new Error("No tienes permiso para mover reservas.");
  if (restauranteId && data.restaurantes && !data.restaurantes.includes(restauranteId)) {
    throw new Error("No tienes permiso sobre este restaurante.");
  }
  return { sb, perfil };
}

/** Lee el restaurante de una reserva (y de paso comprueba que existe y es de la cuenta). */
async function restauranteDeReserva(sb: Sb, reservaId: string): Promise<string | null> {
  const { data } = await sb.from("reservas_reservas").select("restaurante_id").eq("id", reservaId).maybeSingle();
  return data?.restaurante_id ?? null;
}

/** Permiso sobre una reserva concreta: valida el id, lee su restaurante y aplica exigirPermiso. */
async function permisoReserva(permiso: Permiso, reservaId: string) {
  if (!esUuid(reservaId)) throw new Error("Reserva no válida.");
  const { sb } = await cliente();
  const restId = await restauranteDeReserva(sb, reservaId);
  if (!restId) throw new Error("La reserva ya no existe.");
  const r = await exigirPermiso(permiso, restId);
  return { ...r, restId };
}

const fallo = (e: unknown): { ok: false; error: string } => ({ ok: false, error: (e as Error)?.message || "No se ha podido guardar." });

/** Turno activo que cubre esa fecha y hora (misma regla que cronograma.ts y reserva.ts). */
function turnoPara(turnos: Turno[], fecha: string, hora: string): Turno | null {
  const dow = dowDe(fecha);
  const h = h5(hora);
  return turnos.find((t) => t.activo && (t.dias_semana || []).includes(dow) && h >= h5(t.hora_inicio) && h <= h5(t.hora_fin)) ?? null;
}

/* ==================== Tipos que devuelve la pantalla ==================== */

/** Reserva del día con lo que la lista necesita además de la fila: visitas y riesgo del
    cliente (vista reservas_clientes_stats) y el nombre del prescriptor. */
export type ReservaDia = Reserva & {
  visitas: number;
  no_shows: number;
  riesgo_no_show: number | null;
  prescriptor_nombre: string | null;
};

export type DiaCompleto = {
  reservas: ReservaDia[];
  salas: Sala[];
  objetos: Tables<"reservas_plano_objetos">[];
  bloqueos: Tables<"reservas_bloqueos">[];
  cupos: Tables<"reservas_cupos">[];
  turnos: Turno[];
  espera: Espera[];
  notas_dia: Tables<"reservas_notas_dia">[];
  /** Catálogo de etiquetas (reserva, cliente y alérgeno) para resolver los uuid de las filas. */
  etiquetas: Tables<"reservas_etiquetas">[];
  /** Cierres del día (reservas_cierres): turno_id null = todo el día. La barra los usa para «cerrado». */
  cierres?: Tables<"reservas_cierres">[];
};

/** Estados válidos del catálogo (misma lista que la check constraint de la base). */
const ESTADOS_VALIDOS = [
  "pendiente", "confirmada", "reconfirmada", "llegada", "sentada", "postre", "cuenta",
  "terminada", "no_show", "cancelada", "a_revisar", "tarjeta_pendiente", "lista_espera",
];

/* ==================== Lectura ==================== */

export async function cargarDiaCompleto(restauranteId: string, fecha: string): Promise<DiaCompleto> {
  if (!esUuid(restauranteId) || !FECHA.test(fecha)) throw new Error("Restaurante o fecha no válidos.");
  const { sb } = await cliente();
  const [res, salas, turnos, bloqueos, cupos, espera, notas, etiquetas, cierres] = await Promise.all([
    sb
      .from("reservas_reservas")
      .select("*, reservas_clientes(*), reservas_reserva_mesas(mesa_id)")
      .eq("restaurante_id", restauranteId)
      .eq("fecha", fecha)
      .order("hora"),
    sb.from("reservas_salas").select("*, mesas:reservas_mesas(*)").eq("restaurante_id", restauranteId).order("orden"),
    sb.from("reservas_turnos").select("*").eq("restaurante_id", restauranteId).order("hora_inicio"),
    sb.from("reservas_bloqueos").select("*").eq("restaurante_id", restauranteId).eq("fecha", fecha).order("hora_inicio"),
    sb.from("reservas_cupos").select("*").eq("restaurante_id", restauranteId).eq("fecha", fecha),
    sb.from("reservas_lista_espera").select("*").eq("restaurante_id", restauranteId).eq("fecha", fecha).order("creado_en"),
    sb.from("reservas_notas_dia").select("*").eq("restaurante_id", restauranteId).eq("fecha", fecha).order("creado_en"),
    sb.from("reservas_etiquetas").select("*").eq("activa", true).order("orden"),
    sb.from("reservas_cierres").select("*").eq("restaurante_id", restauranteId).eq("fecha", fecha),
  ]);

  // Las consultas que sostienen la pantalla no pueden fallar en silencio: un día vacío por un
  // JWT caducado o un timeout parecería que las reservas han desaparecido. Se lanza y el
  // cliente conserva lo que ya tenía y avisa. Bloqueos y cupos también: sin ellos el plano
  // dejaría usar mesas bloqueadas o diría que un turno cerrado está abierto.
  const principal = [res, salas, turnos, bloqueos, cupos].find((x) => x.error);
  if (principal?.error) throw new Error(principal.error.message);
  // Secundarias: se registran y se sigue con lo que haya.
  for (const [nombre, x] of [["lista de espera", espera], ["notas", notas], ["etiquetas", etiquetas], ["cierres", cierres]] as const) {
    if (x.error) console.error(`[reservas/dia] ${nombre}: ${x.error.message}`);
  }

  const reservasBase = (res.data ?? []) as unknown as Reserva[];
  const salasConMesas = (salas.data ?? []) as unknown as Sala[];
  for (const s of salasConMesas) {
    s.mesas = (s.mesas ?? []).map((m) => ({ ...m, sala_nombre: s.nombre }));
  }

  // Segunda tanda: depende de la primera (objetos por sala, estadísticas y prescriptores por reserva).
  const salaIds = salasConMesas.map((s) => s.id);
  const clienteIds = [...new Set(reservasBase.map((r) => r.cliente_id).filter((x): x is string => !!x))];
  const prescIds = [...new Set(reservasBase.map((r) => r.prescriptor_id).filter((x): x is string => !!x))];
  type Resp<T> = { data: T[] | null; error: { message: string } | null };
  const [objetos, stats, presc] = await Promise.all([
    salaIds.length
      ? sb.from("reservas_plano_objetos").select("*").in("sala_id", salaIds)
      : Promise.resolve<Resp<Tables<"reservas_plano_objetos">>>({ data: [], error: null }),
    clienteIds.length
      ? sb.from("reservas_clientes_stats").select("cliente_id, visitas, no_shows, riesgo_no_show").in("cliente_id", clienteIds)
      : Promise.resolve<Resp<{ cliente_id: string | null; visitas: number | null; no_shows: number | null; riesgo_no_show: number | null }>>({ data: [], error: null }),
    prescIds.length
      ? sb.from("reservas_prescriptores").select("id, nombre").in("id", prescIds)
      : Promise.resolve<Resp<{ id: string; nombre: string }>>({ data: [], error: null }),
  ]);
  for (const [nombre, x] of [["objetos del plano", objetos], ["estadísticas de clientes", stats], ["prescriptores", presc]] as const) {
    if (x.error) console.error(`[reservas/dia] ${nombre}: ${x.error.message}`);
  }

  const statsPor: Record<string, { visitas: number; no_shows: number; riesgo: number | null }> = {};
  for (const s of stats.data ?? []) {
    if (s.cliente_id) statsPor[s.cliente_id] = { visitas: s.visitas ?? 0, no_shows: s.no_shows ?? 0, riesgo: s.riesgo_no_show ?? null };
  }
  const prescPor: Record<string, string> = {};
  for (const p of presc.data ?? []) prescPor[p.id] = p.nombre;

  const reservas: ReservaDia[] = reservasBase.map((r) => {
    const st = r.cliente_id ? statsPor[r.cliente_id] : undefined;
    return {
      ...r,
      visitas: st?.visitas ?? 0,
      no_shows: st?.no_shows ?? 0,
      riesgo_no_show: st?.riesgo ?? null,
      prescriptor_nombre: r.prescriptor_id ? prescPor[r.prescriptor_id] ?? null : null,
    };
  });

  return {
    reservas,
    salas: salasConMesas,
    objetos: objetos.data ?? [],
    bloqueos: bloqueos.data ?? [],
    cupos: cupos.data ?? [],
    turnos: (turnos.data ?? []) as Turno[],
    espera: (espera.data ?? []) as Espera[],
    notas_dia: notas.data ?? [],
    etiquetas: etiquetas.data ?? [],
    cierres: cierres.data ?? [],
  };
}

/* ==================== Estado de la reserva ==================== */

const EN_SALA = ["llegada", "sentada", "postre", "cuenta"];

/** Cambia el estado. `pax_llegados` solo tiene sentido al sentar (si no se pasa, el trigger
    pone el pax de la reserva). `motivo` y `cancelada_por` solo al cancelar. */
export async function cambiarEstado(
  reservaId: string,
  estado: string,
  extra?: { pax_llegados?: number | null; motivo?: string | null; cancelada_por?: "cliente" | "restaurante" },
): Promise<R> {
  if (!ESTADOS_VALIDOS.includes(estado)) return { ok: false, error: "Estado desconocido." };
  let sb: Sb;
  try {
    ({ sb } = await permisoReserva("puede_cambiar_estado", reservaId));
  } catch (e) {
    return fallo(e);
  }
  const fila: TablesUpdate<"reservas_reservas"> = { estado, actualizado_en: new Date().toISOString() };
  if (extra?.pax_llegados != null && EN_SALA.includes(estado)) {
    fila.pax_llegados = Math.max(0, Math.floor(extra.pax_llegados));
  }
  if (estado === "cancelada") {
    fila.motivo_cancelacion = extra?.motivo?.trim().slice(0, 500) || null;
    fila.cancelada_por = extra?.cancelada_por === "cliente" ? "cliente" : "restaurante";
  }
  // Volver a un estado previo a la sala limpia los sellos de llegada (para que el cron no la
  // trate como sentada) y los de cancelación (si se reactiva una cancelada por error y luego se
  // vuelve a cancelar, el trigger tiene que sellar la fecha nueva, no conservar la antigua).
  if (["pendiente", "confirmada", "reconfirmada"].includes(estado)) {
    fila.llegada_en = null;
    fila.sentada_en = null;
    fila.salida_en = null;
    fila.pax_llegados = null;
    fila.cancelada_en = null;
    fila.cancelada_por = null;
    fila.motivo_cancelacion = null;
  }
  const { data, error } = await sb.from("reservas_reservas").update(fila).eq("id", reservaId).select("id").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "La reserva ya no existe." };
  return { ok: true };
}

/** Liberar = terminada (la mesa queda libre). Solo para quien está en la sala: «terminada»
    cuenta como visita en reservas_clientes_stats y como comensales en Ratios, así que liberar
    una reserva que no ha llegado inventaría una visita. Para soltar la mesa de una reserva
    que aún no ha llegado, asignarMesa(id, []). */
export async function liberar(reservaId: string): Promise<R> {
  let sb: Sb;
  try {
    ({ sb } = await permisoReserva("puede_cambiar_estado", reservaId));
  } catch (e) {
    return fallo(e);
  }
  const { data, error } = await sb
    .from("reservas_reservas")
    .update({ estado: "terminada", actualizado_en: new Date().toISOString() })
    .eq("id", reservaId)
    .in("estado", EN_SALA)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Solo se puede liberar una mesa ocupada (llegada, sentada, postre o cuenta)." };
  return { ok: true };
}

export async function noShow(reservaId: string): Promise<R> {
  return cambiarEstado(reservaId, "no_show");
}

/* ==================== Mesas ==================== */

/** Escribe la mesa principal y sincroniza las extras. Supone permisos ya comprobados. */
async function escribirMesas(sb: Sb, reservaId: string, ids: string[]): Promise<R> {
  const { data, error } = await sb
    .from("reservas_reservas")
    .update({ mesa_id: ids[0] ?? null, actualizado_en: new Date().toISOString() })
    .eq("id", reservaId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "La reserva ya no existe." };
  if (ids.length) {
    // ids validados como uuid antes de llegar aquí: el filtro de texto no admite nada raro.
    const { error: e1 } = await sb
      .from("reservas_reserva_mesas")
      .delete()
      .eq("reserva_id", reservaId)
      .not("mesa_id", "in", `(${ids.join(",")})`);
    if (e1) return { ok: false, error: e1.message };
    const { error: e2 } = await sb
      .from("reservas_reserva_mesas")
      .upsert(ids.map((id) => ({ reserva_id: reservaId, mesa_id: id })), { onConflict: "reserva_id,mesa_id", ignoreDuplicates: true });
    if (e2) return { ok: false, error: e2.message };
  } else {
    const { error: e3 } = await sb.from("reservas_reserva_mesas").delete().eq("reserva_id", reservaId);
    if (e3) return { ok: false, error: e3.message };
  }
  return { ok: true };
}

/** Asigna la mesa principal (la primera) y las extras de una combinación. Lista vacía = quitar mesa.
    El trigger de reservas_reserva_mesas ya mete la principal; aquí se sincroniza el resto. */
export async function asignarMesa(reservaId: string, mesaIds: string[]): Promise<R> {
  const ids = [...new Set((mesaIds || []).filter(Boolean))];
  if (!ids.every(esUuid)) return { ok: false, error: "Mesa no válida." };
  let sb: Sb;
  try {
    ({ sb } = await permisoReserva("puede_mover", reservaId));
  } catch (e) {
    return fallo(e);
  }
  return escribirMesas(sb, reservaId, ids);
}

/** «Desplazar»: cambia hora (y día si hace falta) y/o mesas sin pasar por el modal completo.
    `mesaIds` undefined = no tocar las mesas. Si cambia la fecha o la hora, el turno se
    recalcula aquí (como en cronograma.ts y en el RPC público de modificación): la hora tiene
    que caer dentro de un turno, y si se pasa a otro turno u otro día, ese cupo tiene que estar
    abierto. El `turno_id` que mande el cliente solo se usa si no cambian ni fecha ni hora. */
export async function desplazarReserva(
  reservaId: string,
  cambios: { fecha?: string; hora?: string; duracion_min?: number; mesaIds?: string[]; turno_id?: string | null },
): Promise<R> {
  if (cambios.fecha && !FECHA.test(cambios.fecha)) return { ok: false, error: "Fecha no válida." };
  if (cambios.hora && !HORA.test(cambios.hora)) return { ok: false, error: "Hora no válida." };
  if (cambios.turno_id != null && !esUuid(cambios.turno_id)) return { ok: false, error: "Turno no válido." };
  const mesaIds = cambios.mesaIds ? [...new Set(cambios.mesaIds.filter(Boolean))] : undefined;
  if (mesaIds && !mesaIds.every(esUuid)) return { ok: false, error: "Mesa no válida." };

  let sb: Sb;
  try {
    ({ sb } = await permisoReserva("puede_mover", reservaId));
  } catch (e) {
    return fallo(e);
  }
  const { data: r, error: eR } = await sb
    .from("reservas_reservas")
    .select("restaurante_id, fecha, hora, turno_id, estado")
    .eq("id", reservaId)
    .maybeSingle();
  if (eR) return { ok: false, error: eR.message };
  if (!r) return { ok: false, error: "La reserva ya no existe." };

  const fila: TablesUpdate<"reservas_reservas"> = { actualizado_en: new Date().toISOString() };
  const fecha = cambios.fecha || r.fecha;
  const hora = cambios.hora ? (cambios.hora.length === 5 ? cambios.hora + ":00" : cambios.hora) : r.hora;
  const cambiaMomento = fecha !== r.fecha || h5(hora) !== h5(r.hora);
  if (fecha !== r.fecha) fila.fecha = fecha;
  if (h5(hora) !== h5(r.hora)) fila.hora = hora;
  if (cambios.duracion_min) fila.duracion_min = Math.max(15, Math.min(600, Math.floor(cambios.duracion_min)));

  if (cambiaMomento) {
    const { data: tData, error: eT } = await sb.from("reservas_turnos").select("*").eq("restaurante_id", r.restaurante_id).eq("activo", true);
    if (eT) return { ok: false, error: eT.message };
    const turnos = (tData ?? []) as Turno[];
    const turno = turnoPara(turnos, fecha, hora);
    if (!turno) {
      const dow = dowDe(fecha);
      const delDia = turnos.filter((t) => (t.dias_semana || []).includes(dow));
      if (!delDia.length) return { ok: false, error: "Ese día el restaurante no tiene turnos." };
      const rangos = delDia.map((t) => `${t.nombre} ${h5(t.hora_inicio)}–${h5(t.hora_fin)}`).join(", ");
      return { ok: false, error: `La hora tiene que estar dentro de un turno (${rangos}).` };
    }
    fila.turno_id = turno.id;
    // Cupo y cierres solo si la reserva entra en otro turno u otro día: mover 15 minutos dentro
    // de un turno ya lleno (cupo cerrado) tiene que seguir siendo posible.
    const vivo = ESTADOS_VALIDOS.includes(r.estado) && !["terminada", "no_show", "cancelada"].includes(r.estado);
    if (vivo && (fecha !== r.fecha || turno.id !== r.turno_id)) {
      const [{ data: cupos, error: eC }, { data: cierres, error: eCi }] = await Promise.all([
        sb.from("reservas_cupos").select("turno_id, cerrado").eq("restaurante_id", r.restaurante_id).eq("fecha", fecha),
        sb.from("reservas_cierres").select("turno_id").eq("restaurante_id", r.restaurante_id).eq("fecha", fecha),
      ]);
      if (eC || eCi) return { ok: false, error: (eC ?? eCi)!.message };
      const cupo = (cupos ?? []).find((c) => c.turno_id === turno.id) ?? (cupos ?? []).find((c) => c.turno_id === null);
      const cerrado = !!cupo?.cerrado || (cierres ?? []).some((c) => c.turno_id === null || c.turno_id === turno.id);
      if (cerrado) return { ok: false, error: `El turno ${turno.nombre} está cerrado ese día. Ábrelo en Cupos o usa el modal de la reserva.` };
    }
  } else if (cambios.turno_id !== undefined) {
    fila.turno_id = cambios.turno_id;
  }

  if (Object.keys(fila).length > 1) {
    const { error } = await sb.from("reservas_reservas").update(fila).eq("id", reservaId);
    if (error) return { ok: false, error: error.message };
  }
  if (mesaIds) return escribirMesas(sb, reservaId, mesaIds);
  return { ok: true };
}

/* ==================== Walk-in ==================== */

/** Sienta ahora a alguien sin reserva en una mesa libre: crea la reserva «sentada», origen
    walkin, con el turno que toque a esa hora. Si se da nombre, se crea la ficha del cliente. */
export async function walkIn(input: {
  restauranteId: string;
  fecha: string;
  hora: string; // "HH:MM"
  mesaId: string;
  pax: number;
  nombre?: string | null;
  duracion_min?: number | null;
}): Promise<R<{ id: string }>> {
  if (!esUuid(input.restauranteId) || !esUuid(input.mesaId)) return { ok: false, error: "Mesa no válida." };
  if (!FECHA.test(input.fecha) || !HORA.test(input.hora)) return { ok: false, error: "Fecha u hora no válidas." };
  const pax = Math.floor(Number(input.pax));
  if (!(pax > 0 && pax <= 99)) return { ok: false, error: "Las personas tienen que ser entre 1 y 99." };
  let sb: Sb, perfil: Awaited<ReturnType<typeof cliente>>["perfil"];
  try {
    ({ sb, perfil } = await exigirPermiso("puede_cambiar_estado", input.restauranteId));
  } catch (e) {
    return fallo(e);
  }
  const hora = h5(input.hora) + ":00";
  const dur = Math.max(30, Math.min(600, Math.round(input.duracion_min || 120)));
  const [{ data: mesa }, { data: tData }, { data: ocupada }] = await Promise.all([
    sb.from("reservas_mesas").select("id, sala_id, nombre, etiqueta").eq("id", input.mesaId).maybeSingle(),
    sb.from("reservas_turnos").select("*").eq("restaurante_id", input.restauranteId).eq("activo", true),
    sb.rpc("reservas_mesa_ocupada", { p_mesa: input.mesaId, p_fecha: input.fecha, p_hora: hora, p_duracion: dur }),
  ]);
  if (!mesa) return { ok: false, error: "La mesa no existe." };
  // Otra tablet puede haberla ocupado entre el clic y aquí.
  if (ocupada) return { ok: false, error: `La mesa ${mesa.etiqueta || mesa.nombre} ya está ocupada a esa hora.` };
  const turno = turnoPara((tData ?? []) as Turno[], input.fecha, hora);

  let clienteId: string | null = null;
  const nombre = input.nombre?.trim().slice(0, 120);
  if (nombre) {
    const { data: c, error: eC } = await sb.from("reservas_clientes").insert({ nombre }).select("id").single();
    if (eC) return { ok: false, error: eC.message };
    clienteId = c.id;
  }
  const { data, error } = await sb
    .from("reservas_reservas")
    .insert({
      restaurante_id: input.restauranteId,
      cliente_id: clienteId,
      mesa_id: mesa.id,
      zona_id: mesa.sala_id,
      turno_id: turno?.id ?? null,
      fecha: input.fecha,
      hora,
      duracion_min: dur,
      pax,
      pax_llegados: pax,
      estado: "sentada",
      origen: "walkin",
      notificar: false,
      anotado_por: perfil.id,
      creado_por: perfil.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: data.id } };
}

/* ==================== Cupos del día ==================== */

/** Cupo de un turno (turno_id null = todo el día). El unique (restaurante, fecha, turno) no
    cubre turno_id null en Postgres, así que se busca antes de insertar. */
export async function guardarCupo(
  restauranteId: string,
  fecha: string,
  turnoId: string | null,
  valores: { cerrado: boolean; max_pax_online: number | null; max_pax_total: number | null; nota: string | null },
): Promise<R<Tables<"reservas_cupos">>> {
  if (!esUuid(restauranteId) || !FECHA.test(fecha) || (turnoId != null && !esUuid(turnoId))) return { ok: false, error: "Datos no válidos." };
  let sb: Sb;
  try {
    ({ sb } = await exigirPermiso(null, restauranteId));
  } catch (e) {
    return fallo(e);
  }
  let q = sb.from("reservas_cupos").select("id").eq("restaurante_id", restauranteId).eq("fecha", fecha);
  q = turnoId ? q.eq("turno_id", turnoId) : q.is("turno_id", null);
  const { data: existe, error: eE } = await q.maybeSingle();
  if (eE) return { ok: false, error: eE.message };
  const fila = {
    cerrado: valores.cerrado,
    max_pax_online: valores.max_pax_online,
    max_pax_total: valores.max_pax_total,
    nota: valores.nota?.trim().slice(0, 500) || null,
    actualizado_en: new Date().toISOString(),
  };
  const res = existe
    ? await sb.from("reservas_cupos").update(fila).eq("id", existe.id).select("*").single()
    : await sb.from("reservas_cupos").insert({ ...fila, restaurante_id: restauranteId, fecha, turno_id: turnoId }).select("*").single();
  return res.error ? { ok: false, error: res.error.message } : { ok: true, data: res.data };
}

/* ==================== Bloqueos ==================== */

export async function crearBloqueo(input: {
  restauranteId: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  mesa_id: string | null;
  sala_id: string | null;
  motivo: string | null;
}): Promise<R<Tables<"reservas_bloqueos">>> {
  if (!input.mesa_id && !input.sala_id) return { ok: false, error: "Elige una mesa o una sala." };
  if (!esUuid(input.restauranteId) || !FECHA.test(input.fecha)) return { ok: false, error: "Datos no válidos." };
  if (!HORA.test(input.hora_inicio) || !HORA.test(input.hora_fin)) return { ok: false, error: "Horas no válidas." };
  if ((input.mesa_id && !esUuid(input.mesa_id)) || (input.sala_id && !esUuid(input.sala_id))) return { ok: false, error: "Mesa o sala no válida." };
  if (input.hora_fin <= input.hora_inicio) return { ok: false, error: "La hora de fin tiene que ser posterior a la de inicio." };
  let sb: Sb, perfil: Awaited<ReturnType<typeof cliente>>["perfil"];
  try {
    ({ sb, perfil } = await exigirPermiso(null, input.restauranteId));
  } catch (e) {
    return fallo(e);
  }
  const { data, error } = await sb
    .from("reservas_bloqueos")
    .insert({
      restaurante_id: input.restauranteId,
      fecha: input.fecha,
      hora_inicio: input.hora_inicio,
      hora_fin: input.hora_fin,
      mesa_id: input.mesa_id,
      sala_id: input.mesa_id ? null : input.sala_id,
      motivo: input.motivo?.trim().slice(0, 200) || null,
      creado_por: perfil.id,
    })
    .select("*")
    .single();
  return error ? { ok: false, error: error.message } : { ok: true, data };
}

export async function borrarBloqueo(id: string): Promise<R> {
  if (!esUuid(id)) return { ok: false, error: "Bloqueo no válido." };
  let sb: Sb;
  try {
    ({ sb } = await cliente());
    const { data: b } = await sb.from("reservas_bloqueos").select("restaurante_id").eq("id", id).maybeSingle();
    if (!b) return { ok: false, error: "El bloqueo ya no existe." };
    await exigirPermiso(null, b.restaurante_id);
  } catch (e) {
    return fallo(e);
  }
  const { error } = await sb.from("reservas_bloqueos").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ==================== Nota del día ==================== */

/** Una nota por día y restaurante: se actualiza la última si existe; texto vacío = se borra. */
export async function guardarNotaDia(restauranteId: string, fecha: string, texto: string): Promise<R<Tables<"reservas_notas_dia"> | null>> {
  if (!esUuid(restauranteId) || !FECHA.test(fecha)) return { ok: false, error: "Datos no válidos." };
  let sb: Sb, perfil: Awaited<ReturnType<typeof cliente>>["perfil"];
  try {
    ({ sb, perfil } = await exigirPermiso(null, restauranteId));
  } catch (e) {
    return fallo(e);
  }
  const t = texto.trim().slice(0, 2000);
  const { data: existentes, error: eE } = await sb
    .from("reservas_notas_dia")
    .select("id")
    .eq("restaurante_id", restauranteId)
    .eq("fecha", fecha)
    .order("creado_en", { ascending: false });
  if (eE) return { ok: false, error: eE.message };
  const ultima = existentes?.[0];
  if (!t) {
    if (existentes?.length) {
      const { error } = await sb.from("reservas_notas_dia").delete().in("id", existentes.map((n) => n.id));
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true, data: null };
  }
  const res = ultima
    ? await sb.from("reservas_notas_dia").update({ texto: t }).eq("id", ultima.id).select("*").single()
    : await sb.from("reservas_notas_dia").insert({ restaurante_id: restauranteId, fecha, texto: t, creado_por: perfil.id }).select("*").single();
  return res.error ? { ok: false, error: res.error.message } : { ok: true, data: res.data };
}

/* ==================== Exportar ==================== */

/** Celda CSV. Neutraliza la inyección de fórmulas: nombre, apellidos, notas y alergias llegan
    del widget público, y una celda que empieza por = + - @ (o tabulador / retorno) Excel la
    ejecuta como fórmula. Se antepone un apóstrofo y después se entrecomilla como siempre.
    Los números (pax) no pasan por aquí como texto, así que un «-» legítimo no se toca. */
const csvCelda = (v: unknown) => {
  if (typeof v === "number") return String(v);
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV del día (separador «;» para que Excel en español lo abra directo). Si se pasa turno,
    solo ese turno con la misma regla que la pantalla: su turno_id o, sin turno_id, la hora
    dentro de la franja. Sin canceladas ni no-shows salvo `incluirFinales`. El nombre de la
    mesa y los estados se resuelven aquí para que el fichero sea legible. */
export async function exportarDiaCsv(restauranteId: string, fecha: string, turnoId?: string | null, incluirFinales = false): Promise<R<string>> {
  if (!esUuid(restauranteId) || !FECHA.test(fecha) || (turnoId != null && !esUuid(turnoId))) return { ok: false, error: "Datos no válidos." };
  const { sb } = await cliente();
  const [{ data, error }, { data: mesas }, { data: presc }, { data: turno, error: eT }] = await Promise.all([
    sb
      .from("reservas_reservas")
      .select("*, reservas_clientes(*), reservas_reserva_mesas(mesa_id)")
      .eq("restaurante_id", restauranteId)
      .eq("fecha", fecha)
      .order("hora"),
    sb.from("reservas_mesas").select("id, nombre, etiqueta"),
    sb.from("reservas_prescriptores").select("id, nombre"),
    turnoId
      ? sb.from("reservas_turnos").select("id, hora_inicio, hora_fin").eq("id", turnoId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (error) return { ok: false, error: error.message };
  if (eT) return { ok: false, error: eT.message };
  if (turnoId && !turno) return { ok: false, error: "El turno ya no existe." };
  const nombreMesa: Record<string, string> = {};
  for (const m of mesas ?? []) nombreMesa[m.id] = m.etiqueta || m.nombre;
  const nombrePresc: Record<string, string> = {};
  for (const p of presc ?? []) nombrePresc[p.id] = p.nombre;

  let reservas = (data ?? []) as unknown as Reserva[];
  if (turno) {
    reservas = reservas.filter((r) =>
      r.turno_id ? r.turno_id === turno.id : h5(r.hora) >= h5(turno.hora_inicio) && h5(r.hora) <= h5(turno.hora_fin),
    );
  }
  if (!incluirFinales) reservas = reservas.filter((r) => r.estado !== "cancelada" && r.estado !== "no_show");

  const cab = [
    "Fecha", "Hora", "Mesa", "Nombre", "Apellidos", "Teléfono", "Email", "Pax", "Pax llegados", "Estado", "Tipo", "Origen", "Canal",
    "Prescriptor", "Idioma", "Localizador", "Alergias", "Nota cliente", "Nota interna", "Reserva hecha", "Llegada", "Sentada", "Salida",
  ];
  const filas = reservas.map((r) => {
    const c = r.reservas_clientes;
    const ids = (r.reservas_reserva_mesas || []).map((x) => x.mesa_id);
    if (r.mesa_id && !ids.includes(r.mesa_id)) ids.unshift(r.mesa_id);
    const sello = (t: string | null) => (t ? new Date(t).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }) : "");
    return [
      r.fecha, h5(r.hora), ids.map((id) => nombreMesa[id] ?? "?").join("+"),
      c?.nombre ?? "", c?.apellidos ?? "", c?.telefono ?? "", c?.email ?? "", r.pax, r.pax_llegados ?? "",
      EST[r.estado]?.txt ?? r.estado, TIPO_RESERVA[r.tipo] ?? r.tipo, ORIGEN[r.origen] ?? r.origen, textoCanal(r.canal),
      r.prescriptor_id ? nombrePresc[r.prescriptor_id] ?? "" : "", (r.idioma || "").toUpperCase(),
      r.localizador, r.alergias ?? c?.alergias ?? "", r.notas_cliente ?? "", r.notas_internas ?? "",
      sello(r.creado_en), sello(r.llegada_en), sello(r.sentada_en), sello(r.salida_en),
    ].map(csvCelda).join(";");
  });
  // BOM para que Excel reconozca UTF-8 (tildes y eñes).
  return { ok: true, data: "\ufeff" + [cab.join(";"), ...filas].join("\r\n") };
}
