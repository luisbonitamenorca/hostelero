"use server";

import { crearClienteServidor } from "@/lib/supabase/server";
import type { Tables } from "@hostelero/db";

// Acciones de la app del empleado. Todo con el cliente autenticado: la RLS
// limita a "lo suyo" (turnos publicados, sus fichajes, sus ausencias).
type Turno = Tables<"rrhh_turnos"> & { centros?: { nombre: string } | null };
type Fichaje = Tables<"rrhh_fichajes">;
type Ausencia = Tables<"rrhh_ausencias">;
type R<T = undefined> = { ok: boolean; error?: string; data?: T };

async function contexto() {
  const sb = await crearClienteServidor();
  const { data: empId } = await sb.rpc("mi_empleado_id");
  return { sb, empId: (empId as string | null) ?? null };
}

export async function misTurnos(desde: string, hasta: string) {
  const { sb, empId } = await contexto();
  if (!empId) return { turnos: [] as Turno[], ausencias: [] as Ausencia[] };
  const [turnos, ausencias] = await Promise.all([
    sb
      .from("rrhh_turnos")
      .select("*, centros(nombre)")
      .eq("empleado_id", empId)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha")
      .order("hora_inicio"),
    sb
      .from("rrhh_ausencias")
      .select("*")
      .eq("empleado_id", empId)
      .eq("estado", "aprobada")
      .lte("fecha_inicio", hasta)
      .gte("fecha_fin", desde),
  ]);
  return { turnos: (turnos.data ?? []) as Turno[], ausencias: (ausencias.data ?? []) as Ausencia[] };
}

export async function misFichajes(desdeISO: string): Promise<Fichaje[]> {
  const { sb, empId } = await contexto();
  if (!empId) return [];
  const { data } = await sb.from("rrhh_fichajes").select("*").eq("empleado_id", empId).gte("ts", desdeISO).order("ts");
  return (data ?? []) as Fichaje[];
}

export async function misAusencias(): Promise<Ausencia[]> {
  const { sb, empId } = await contexto();
  if (!empId) return [];
  const { data } = await sb
    .from("rrhh_ausencias")
    .select("*")
    .eq("empleado_id", empId)
    .order("fecha_inicio", { ascending: false })
    .limit(20);
  return (data ?? []) as Ausencia[];
}

export async function solicitarAusencia(tipo: string, desde: string, hasta: string): Promise<R> {
  const { sb, empId } = await contexto();
  if (!empId) return { ok: false, error: "Sin ficha de empleado" };
  if (!desde || !hasta || hasta < desde) return { ok: false, error: "Revisa las fechas" };
  const {
    data: { user },
  } = await sb.auth.getUser();
  const { error } = await sb.from("rrhh_ausencias").insert({
    empleado_id: empId,
    tipo: tipo as Ausencia["tipo"],
    fecha_inicio: desde,
    fecha_fin: hasta,
    estado: "solicitada",
    solicitada_por: user?.id ?? null,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Fichaje móvil con geolocalización: dentro_radio se calcula en el servidor. */
export async function ficharMovil(input: {
  centroId: string;
  tipo: "entrada" | "salida" | "pausa_inicio" | "pausa_fin";
  lat: number;
  lng: number;
}): Promise<R<{ dentro: boolean | null }>> {
  const { sb, empId } = await contexto();
  if (!empId) return { ok: false, error: "Sin ficha de empleado" };

  const [{ data: centro }, { data: cfg }] = await Promise.all([
    sb.from("centros").select("lat, lng").eq("id", input.centroId).maybeSingle(),
    sb.from("rrhh_centros_config").select("radio_fichaje_m").eq("centro_id", input.centroId).maybeSingle(),
  ]);
  let dentro: boolean | null = null;
  if (centro?.lat != null && centro?.lng != null) {
    const R = 6371000;
    const r = (x: number) => (x * Math.PI) / 180;
    const dLat = r(centro.lat - input.lat);
    const dLng = r(centro.lng - input.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(input.lat)) * Math.cos(r(centro.lat)) * Math.sin(dLng / 2) ** 2;
    const dist = 2 * R * Math.asin(Math.sqrt(a));
    dentro = dist <= (cfg?.radio_fichaje_m ?? 150);
  }
  const { error } = await sb.from("rrhh_fichajes").insert({
    empleado_id: empId,
    centro_id: input.centroId,
    tipo: input.tipo,
    metodo: "movil_geo",
    lat: input.lat,
    lng: input.lng,
    dentro_radio: dentro,
  });
  return error ? { ok: false, error: error.message } : { ok: true, data: { dentro } };
}
