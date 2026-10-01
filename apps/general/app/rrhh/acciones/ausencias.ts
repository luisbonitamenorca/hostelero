"use server";

/* Acciones de servidor de la sección Ausencias (plan 2.4).
   Todo pasa por el cliente autenticado: la RLS decide (gestor todo · empleado lo suyo). */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables } from "@hostelero/db";
import type { Ausencia } from "../tipos";

async function cliente() {
  const { supabase, perfil } = await exigirModulo("rrhh");
  return { sb: supabase, perfil };
}

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

export type TipoAusenciaCat = Tables<"rrhh_tipos_ausencia">;
export type Festivo = Tables<"rrhh_festivos">;
export type AusenciaFila = Tables<"rrhh_ausencias">;
export type EmpleadoAus = {
  id: string;
  nombre: string;
  apellidos: string | null;
  codigo_nomina: string | null;
  departamento: string | null;
  centro_principal_id: string | null;
  fecha_alta: string | null;
  fecha_baja: string | null;
  horas_semana: number | null;
};
export type AsignacionAus = { empleado_id: string; centro_id: string; fecha_inicio: string | null; fecha_fin: string | null };
export type SaldoVacaciones = {
  derecho_anual: number;
  devengado_hoy: number;
  disfrutados: number;
  pendientes_aprobar: number;
  resto: number;
};

/** Enum `tipo` derivado del nombre del tipo del catálogo (mapa del plan 1.1). */
function enumDeTipo(nombre: string): Ausencia["tipo"] {
  const n = nombre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (n.includes("vacacion")) return "vacaciones";
  if (n.includes("baja") || n.includes("accidente") || n.includes("maternidad") || n.includes("paternidad")) return "baja";
  if (n.startsWith("permiso") || n.includes("formacion") || n.includes("descanso compensatorio") || n.includes("fuerza mayor")) return "permiso";
  return "otro";
}

/** Mensaje de la casa para los errores de RLS / triggers (en vez del texto crudo de Postgres). */
function traducirError(e: { code?: string; message?: string } | null, fallback: string): string {
  if (!e) return fallback;
  const m = e.message || "";
  if (e.code === "42501" || /row-level security/i.test(m)) return "No tienes permiso para registrar esta ausencia";
  if (/no se puede solicitar|otra cuenta/i.test(m)) return "Ese tipo de ausencia no se puede solicitar desde aquí. Pídeselo a RRHH.";
  return m || fallback;
}

/* ================= Carga ================= */

/** Maestros de la sección: catálogo de tipos, empleados, asignaciones a centros y mi empleado (para quien no es gestor). */
export async function cargarBaseAusencias() {
  const { sb } = await cliente();
  const [tipos, emps, asigs, mio] = await Promise.all([
    sb.from("rrhh_tipos_ausencia").select("*").order("orden").order("nombre"),
    sb
      .from("empleados")
      .select("id, nombre, apellidos, codigo_nomina, departamento, centro_principal_id, fecha_alta, fecha_baja, horas_semana")
      .order("apellidos")
      .order("nombre"),
    sb.from("rrhh_asignaciones").select("empleado_id, centro_id, fecha_inicio, fecha_fin"),
    sb.rpc("mi_empleado_id"),
  ]);
  if (tipos.error) throw new Error(tipos.error.message);
  if (emps.error) throw new Error(emps.error.message);
  if (asigs.error) throw new Error(asigs.error.message);
  return {
    tipos: (tipos.data ?? []) as TipoAusenciaCat[],
    empleados: (emps.data ?? []) as EmpleadoAus[],
    asignaciones: (asigs.data ?? []) as AsignacionAus[],
    miEmpleadoId: (mio.error ? null : mio.data) || null,
  };
}

/** Ausencias que tocan el rango + todas las solicitadas (de cualquier fecha) + festivos del rango. */
export async function cargarMesAusencias(desde: string, hasta: string) {
  const { sb } = await cliente();
  const [mes, pendientes, festivos] = await Promise.all([
    sb
      .from("rrhh_ausencias")
      .select("*")
      .lte("fecha_inicio", hasta)
      .gte("fecha_fin", desde)
      .order("fecha_inicio", { ascending: false })
      .limit(5000),
    sb.from("rrhh_ausencias").select("*").eq("estado", "solicitada").order("creado_en", { ascending: false }).limit(1000),
    sb.from("rrhh_festivos").select("*").eq("activo", true).gte("fecha", desde).lte("fecha", hasta),
  ]);
  if (mes.error) throw new Error(mes.error.message);
  if (pendientes.error) throw new Error(pendientes.error.message);
  if (festivos.error) throw new Error(festivos.error.message);
  const vistos = new Set<string>();
  const ausencias: AusenciaFila[] = [];
  for (const a of [...(pendientes.data ?? []), ...(mes.data ?? [])] as AusenciaFila[]) {
    if (vistos.has(a.id)) continue;
    vistos.add(a.id);
    ausencias.push(a);
  }
  return { ausencias, festivos: (festivos.data ?? []) as Festivo[] };
}

export async function saldoVacaciones(empleadoId: string, anio: number): Promise<SaldoVacaciones | null> {
  const { sb } = await cliente();
  const { data, error } = await sb.rpc("rrhh_saldo_vacaciones", { p_empleado_id: empleadoId, p_anio: anio });
  if (error || !data?.length) return null;
  const s = data[0];
  return {
    derecho_anual: Number(s.derecho_anual) || 0,
    devengado_hoy: Number(s.devengado_hoy) || 0,
    disfrutados: Number(s.disfrutados) || 0,
    pendientes_aprobar: Number(s.pendientes_aprobar) || 0,
    resto: Number(s.resto) || 0,
  };
}

/* ================= Escritura ================= */

export type AusenciaInput = {
  empleado_id: string;
  tipo_id: string;
  fecha_inicio: string;
  fecha_fin: string;
  medio_dia: boolean;
  horas: number | null;
  nota: string | null;
  centro_id: string | null;
  estado: "solicitada" | "aprobada";
};

export async function guardarAusencia(id: string | null, input: AusenciaInput): Promise<R<string>> {
  const { sb, perfil } = await cliente();
  if (!input.empleado_id) return { ok: false, error: "Elige un empleado" };
  if (!input.tipo_id) return { ok: false, error: "Elige un tipo de ausencia" };
  if (!input.fecha_inicio || !input.fecha_fin) return { ok: false, error: "Faltan las fechas" };
  if (input.fecha_fin < input.fecha_inicio) return { ok: false, error: "El fin no puede ser anterior al inicio" };
  if (input.medio_dia && input.fecha_inicio !== input.fecha_fin) return { ok: false, error: "Medio día solo vale para un único día" };
  if (input.horas != null && !(input.horas > 0 && input.horas <= 24)) return { ok: false, error: "Las horas deben estar entre 0 y 24" };
  if (input.medio_dia && input.horas != null) return { ok: false, error: "Elige medio día o horas, no las dos cosas" };

  const { data: tipo, error: eTipo } = await sb.from("rrhh_tipos_ausencia").select("nombre, activo").eq("id", input.tipo_id).maybeSingle();
  if (eTipo || !tipo) return { ok: false, error: "Tipo de ausencia no válido" };

  const base = {
    empleado_id: input.empleado_id,
    tipo_id: input.tipo_id,
    tipo: enumDeTipo(tipo.nombre),
    fecha_inicio: input.fecha_inicio,
    fecha_fin: input.fecha_fin,
    medio_dia: input.medio_dia,
    horas: input.horas,
    nota: input.nota?.trim() || null,
    centro_id: input.centro_id || null,
    estado: input.estado,
  };
  const ahora = new Date().toISOString();

  if (id) {
    const { data: actual } = await sb.from("rrhh_ausencias").select("estado").eq("id", id).maybeSingle();
    const cambiaEstado = actual?.estado !== input.estado;
    // Solo los gestores tienen UPDATE en la RLS: si no toca ninguna fila, no hay permiso.
    const { error, count } = await sb
      .from("rrhh_ausencias")
      .update(
        {
          ...base,
          ...(input.estado === "aprobada" && cambiaEstado ? { resuelta_por: perfil.id, resuelta_en: ahora, motivo_rechazo: null } : {}),
          ...(input.estado === "solicitada" && cambiaEstado ? { resuelta_por: null, resuelta_en: null, motivo_rechazo: null } : {}),
        },
        { count: "exact" },
      )
      .eq("id", id);
    if (error) return { ok: false, error: traducirError(error, "No se pudo guardar") };
    if (!count) return { ok: false, error: "No tienes permiso para cambiar esta ausencia" };
    return { ok: true, data: id };
  }

  const { data, error } = await sb
    .from("rrhh_ausencias")
    .insert({
      ...base,
      solicitada_por: perfil.id,
      ...(input.estado === "aprobada" ? { resuelta_por: perfil.id, resuelta_en: ahora } : {}),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: traducirError(error, "No se pudo guardar") };
  return { ok: true, data: data.id };
}

/** Aprobar o rechazar una solicitud. Rechazar exige motivo. */
export async function resolverAusenciaV2(id: string, estado: "aprobada" | "rechazada", motivo?: string): Promise<R> {
  const { sb, perfil } = await cliente();
  const m = (motivo ?? "").trim();
  if (estado === "rechazada" && !m) return { ok: false, error: "Escribe el motivo del rechazo" };
  const { error, count } = await sb
    .from("rrhh_ausencias")
    .update(
      {
        estado,
        resuelta_por: perfil.id,
        resuelta_en: new Date().toISOString(),
        motivo_rechazo: estado === "rechazada" ? m : null,
      },
      { count: "exact" },
    )
    .eq("id", id);
  if (error) return { ok: false, error: traducirError(error, "No se pudo resolver la solicitud") };
  if (!count) return { ok: false, error: "No tienes permiso para resolver esta solicitud" };
  return { ok: true };
}

export async function borrarAusencia(id: string): Promise<R> {
  const { sb } = await cliente();
  const { error, count } = await sb.from("rrhh_ausencias").delete({ count: "exact" }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "No tienes permiso para borrar esta ausencia" };
  return { ok: true };
}
