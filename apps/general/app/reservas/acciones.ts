"use server";

import { exigirModulo } from "@/lib/supabase/server";
import type { Cliente, Espera, Reserva } from "./tipos";

// Todas las lecturas y escrituras del panel pasan por aquí: cliente autenticado
// del esqueleto bajo RLS (cuenta_id = cuenta_actual()). Sin Supabase en el navegador.
async function cliente() {
  const { supabase } = await exigirModulo("reservas");
  return supabase;
}

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

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

export async function cargarDia(restauranteId: string, fecha: string, hoy: string) {
  const sb = await cliente();
  const [res, esp, cie, prox] = await Promise.all([
    sb
      .from("reservas_reservas")
      .select("*, reservas_clientes(*), reservas_reserva_mesas(mesa_id)")
      .eq("restaurante_id", restauranteId)
      .eq("fecha", fecha)
      .order("hora"),
    sb
      .from("reservas_lista_espera")
      .select("*")
      .eq("restaurante_id", restauranteId)
      .eq("fecha", fecha)
      .order("creado_en"),
    sb.from("reservas_cierres").select("*").eq("restaurante_id", restauranteId).eq("fecha", fecha),
    sb
      .from("reservas_reservas")
      .select("fecha, restaurante_id")
      .gte("fecha", hoy)
      .in("estado", ["pendiente", "confirmada"])
      .order("fecha"),
  ]);
  return {
    reservas: (res.data ?? []) as unknown as Reserva[],
    espera: (esp.data ?? []) as Espera[],
    cierres: cie.data ?? [],
    proximas: prox.data ?? [],
  };
}

export async function buscarClientes(q: string): Promise<Cliente[]> {
  const sb = await cliente();
  let query = sb.from("reservas_clientes").select("*").order("creado_en", { ascending: false }).limit(25);
  const t = q.trim();
  if (t) {
    const tel = t.replace(/\D/g, "") || t;
    query = sb
      .from("reservas_clientes")
      .select("*")
      .or(`nombre.ilike.%${t}%,telefono.ilike.%${tel}%`)
      .limit(25);
  }
  const { data } = await query;
  return data ?? [];
}

export async function sugerirClientes(q: string): Promise<Cliente[]> {
  const sb = await cliente();
  const t = q.trim();
  if (t.length < 2) return [];
  const tel = t.replace(/\D/g, "") || t;
  const { data } = await sb
    .from("reservas_clientes")
    .select("*")
    .or(`nombre.ilike.%${t}%,telefono.ilike.%${tel}%`)
    .limit(6);
  return data ?? [];
}

export async function fichaCliente(id: string) {
  const sb = await cliente();
  const [{ data: c }, { data: hist }] = await Promise.all([
    sb.from("reservas_clientes").select("*").eq("id", id).single(),
    sb
      .from("reservas_reservas")
      .select("fecha, hora, pax, estado, restaurante_id")
      .eq("cliente_id", id)
      .order("fecha", { ascending: false })
      .limit(30),
  ]);
  return { cliente: c, historial: hist ?? [] };
}

export async function datosRango(restauranteId: string, ini: string, fin: string) {
  const sb = await cliente();
  const { data, error } = await sb
    .from("reservas_reservas")
    .select("fecha, hora, pax, estado, origen, canal, cliente_id")
    .eq("restaurante_id", restauranteId)
    .gte("fecha", ini)
    .lte("fecha", fin)
    .range(0, 19999);
  if (error) return { ok: false as const, rows: [], nombres: {} as Record<string, { nombre: string; vip: boolean }> };
  const rows = data ?? [];
  // Top clientes del periodo (por visitas asistidas)
  const porCliente: Record<string, number> = {};
  rows
    .filter((r) => r.estado === "terminada" || r.estado === "sentada")
    .forEach((r) => {
      if (r.cliente_id) porCliente[r.cliente_id] = (porCliente[r.cliente_id] || 0) + 1;
    });
  const topIds = Object.entries(porCliente).sort((a, b) => b[1] - a[1]).slice(0, 8).map((x) => x[0]);
  const nombres: Record<string, { nombre: string; vip: boolean }> = {};
  if (topIds.length) {
    const { data: cs } = await sb.from("reservas_clientes").select("id, nombre, vip").in("id", topIds);
    (cs ?? []).forEach((c) => (nombres[c.id] = { nombre: c.nombre ?? "—", vip: !!c.vip }));
  }
  return { ok: true as const, rows, nombres };
}

export async function mesDatos(restauranteId: string, ini: string, fin: string) {
  const sb = await cliente();
  const [res, cie] = await Promise.all([
    sb
      .from("reservas_reservas")
      .select("fecha, hora, pax, estado, mesa_id")
      .eq("restaurante_id", restauranteId)
      .gte("fecha", ini)
      .lte("fecha", fin)
      .in("estado", ["pendiente", "confirmada", "sentada", "terminada"]),
    sb
      .from("reservas_cierres")
      .select("fecha, turno_id")
      .eq("restaurante_id", restauranteId)
      .gte("fecha", ini)
      .lte("fecha", fin),
  ]);
  return { reservas: res.data ?? [], cierres: cie.data ?? [] };
}

export async function cierresFuturos(restauranteId: string, desde: string) {
  const sb = await cliente();
  const { data } = await sb
    .from("reservas_cierres")
    .select("*, reservas_turnos(nombre)")
    .eq("restaurante_id", restauranteId)
    .gte("fecha", desde)
    .order("fecha");
  return data ?? [];
}

export async function emailsRecientes(restauranteId: string) {
  const sb = await cliente();
  const { data } = await sb
    .from("reservas_emails_salientes")
    .select("id, destinatario, asunto, estado, creado_en")
    .eq("restaurante_id", restauranteId)
    .order("creado_en", { ascending: false })
    .limit(15);
  return data ?? [];
}

export async function verEmail(id: string) {
  const sb = await cliente();
  const { data } = await sb.from("reservas_emails_salientes").select("*").eq("id", id).single();
  return data;
}

/* ================= Escrituras ================= */

export async function setEstadoReserva(id: string, estado: string): Promise<R> {
  const sb = await cliente();
  const { error } = await sb
    .from("reservas_reservas")
    .update({ estado, actualizado_en: new Date().toISOString() })
    .eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function asignarMesa(reservaId: string, mesaId: string): Promise<R> {
  const sb = await cliente();
  const { error } = await sb.from("reservas_reservas").update({ mesa_id: mesaId }).eq("id", reservaId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function crearClienteRapido(nombre: string, telefono: string | null): Promise<R<Cliente>> {
  const sb = await cliente();
  const telNorm = (telefono || "").replace(/\D/g, "") || null;
  if (telNorm) {
    const { data: exist } = await sb
      .from("reservas_clientes")
      .select("*")
      .eq("telefono", telNorm)
      .maybeSingle();
    if (exist) return { ok: true, data: exist };
  }
  const { data, error } = await sb
    .from("reservas_clientes")
    .insert({ nombre, telefono: telNorm })
    .select("*")
    .single();
  return error ? { ok: false, error: error.message } : { ok: true, data: data as Cliente };
}

export async function guardarReserva(
  reservaId: string | null,
  fila: {
    restaurante_id: string;
    fecha: string;
    hora: string;
    pax: number;
    duracion_min: number;
    mesa_id: string | null;
    turno_id: string | null;
    origen: string;
    estado: string;
    notas_cliente: string | null;
    notas_internas: string | null;
    cliente_id?: string;
  },
  mesaIds: string[],
): Promise<R> {
  const sb = await cliente();
  let error = null;
  let idFinal = reservaId;
  if (reservaId) {
    ({ error } = await sb.from("reservas_reservas").update(fila).eq("id", reservaId));
  } else {
    const res = await sb.from("reservas_reservas").insert(fila).select("id").single();
    error = res.error;
    idFinal = res.data?.id ?? null;
  }
  if (error) return { ok: false, error: error.message };
  // Sincronizar combinación de mesas (el trigger ya mete la principal)
  if (idFinal) {
    if (mesaIds.length) {
      await sb
        .from("reservas_reserva_mesas")
        .delete()
        .eq("reserva_id", idFinal)
        .not("mesa_id", "in", `(${mesaIds.join(",")})`);
      await sb
        .from("reservas_reserva_mesas")
        .upsert(
          mesaIds.map((id) => ({ reserva_id: idFinal as string, mesa_id: id })),
          { onConflict: "reserva_id,mesa_id", ignoreDuplicates: true },
        );
    } else {
      await sb.from("reservas_reserva_mesas").delete().eq("reserva_id", idFinal);
    }
  }
  return { ok: true };
}

export async function crearWalkin(input: {
  restauranteId: string;
  mesaId: string;
  pax: number;
  nombre: string;
  fecha: string;
  hora: string;
  turnoId: string | null;
  duracionMin: number;
}): Promise<R> {
  const sb = await cliente();
  const { data: cli } = await sb
    .from("reservas_clientes")
    .insert({ nombre: input.nombre })
    .select("id")
    .single();
  const { error } = await sb.from("reservas_reservas").insert({
    restaurante_id: input.restauranteId,
    cliente_id: cli?.id ?? null,
    mesa_id: input.mesaId,
    turno_id: input.turnoId,
    fecha: input.fecha,
    hora: input.hora,
    duracion_min: input.duracionMin,
    pax: input.pax,
    estado: "sentada",
    origen: "walkin",
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function guardarPosiciones(cambios: Record<string, { pos_x: number; pos_y: number }>): Promise<R> {
  const sb = await cliente();
  for (const [id, pos] of Object.entries(cambios)) {
    const { error } = await sb.from("reservas_mesas").update(pos).eq("id", id);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function guardarMesa(
  mesaId: string | null,
  fila: {
    nombre: string;
    sala_id: string;
    cap_min: number;
    cap_max: number;
    forma: string;
    reservable_online: boolean;
    activa?: boolean;
  },
): Promise<R> {
  const sb = await cliente();
  const { error } = mesaId
    ? await sb.from("reservas_mesas").update(fila).eq("id", mesaId)
    : await sb.from("reservas_mesas").insert({ ...fila, pos_x: 50, pos_y: 35 });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function guardarCliente(
  id: string,
  ficha: {
    nombre: string;
    telefono: string | null;
    email: string | null;
    alergias: string | null;
    notas: string | null;
    vip: boolean;
  },
): Promise<R> {
  const sb = await cliente();
  const { error } = await sb.from("reservas_clientes").update(ficha).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function crearEspera(input: {
  restauranteId: string;
  fecha: string;
  nombre: string;
  telefono: string | null;
  pax: number;
  notas: string | null;
}): Promise<R> {
  const sb = await cliente();
  const { error } = await sb.from("reservas_lista_espera").insert({
    restaurante_id: input.restauranteId,
    fecha: input.fecha,
    nombre: input.nombre,
    telefono: input.telefono ?? "",
    pax: input.pax,
    notas: input.notas,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function setEspera(id: string, estado: string): Promise<R> {
  const sb = await cliente();
  const { error } = await sb.from("reservas_lista_espera").update({ estado }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function buscarClientePorTelefono(telefono: string): Promise<Cliente | null> {
  const sb = await cliente();
  const { data } = await sb.from("reservas_clientes").select("*").eq("telefono", telefono).maybeSingle();
  return data;
}

export async function guardarRestaurante(
  id: string,
  campos: {
    online_activo: boolean;
    antelacion_min_horas: number;
    antelacion_max_dias: number;
    telefono: string | null;
    email_reservas: string | null;
    descripcion: string | null;
  },
): Promise<R> {
  const sb = await cliente();
  const { error } = await sb.from("reservas_restaurantes").update(campos).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function guardarTurno(
  turnoId: string | null,
  restauranteId: string,
  fila: {
    nombre: string;
    hora_inicio: string;
    hora_fin: string;
    intervalo_min: number;
    duracion_min: number;
    max_pax_online: number;
    dias_semana: number[];
    activo?: boolean;
  },
): Promise<R> {
  const sb = await cliente();
  const { error } = turnoId
    ? await sb.from("reservas_turnos").update(fila).eq("id", turnoId)
    : await sb.from("reservas_turnos").insert({ ...fila, restaurante_id: restauranteId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function crearCierre(input: {
  restauranteId: string;
  fecha: string;
  turnoId: string | null;
  motivo: string | null;
}): Promise<R> {
  const sb = await cliente();
  const { error } = await sb.from("reservas_cierres").insert({
    restaurante_id: input.restauranteId,
    fecha: input.fecha,
    turno_id: input.turnoId,
    motivo: input.motivo,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function borrarCierre(id: string): Promise<R> {
  const sb = await cliente();
  const { error } = await sb.from("reservas_cierres").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function guardarSala(
  salaId: string | null,
  restauranteId: string,
  nombre: string,
  activa: boolean,
  orden: number,
): Promise<R> {
  const sb = await cliente();
  const { error } = salaId
    ? await sb.from("reservas_salas").update({ nombre, activa }).eq("id", salaId)
    : await sb.from("reservas_salas").insert({ restaurante_id: restauranteId, nombre, orden });
  return error ? { ok: false, error: error.message } : { ok: true };
}
