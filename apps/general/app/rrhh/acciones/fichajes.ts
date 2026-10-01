"use server";

/* Acciones de servidor de la sección Fichajes v2 (validación semanal).
   Mismo patrón que ../acciones.ts: cliente autenticado, la RLS decide. */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables, TablesInsert } from "@hostelero/db";
import type { Empleado, Turno } from "../tipos";
import { lunesDe, sumaDia } from "../tipos";
import {
  agruparJornadas, calcularPropuesta, efectivosMin, hoyMadrid, isoMadrid, type ConfigCalculo, type FichajeMin,
} from "../secciones/fichajes-calculo";

async function cliente() {
  const { supabase, perfil } = await exigirModulo("rrhh");
  return { sb: supabase, perfil };
}

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

export type HorasDia = Tables<"rrhh_horas_dia">;
export type AusenciaSemana = Pick<Tables<"rrhh_ausencias">, "id" | "empleado_id" | "fecha_inicio" | "fecha_fin" | "medio_dia" | "horas" | "tipo" | "centro_id"> & {
  rrhh_tipos_ausencia: { nombre: string; color: string | null } | null;
};
export type EmpleadoSemana = Pick<Empleado, "id" | "nombre" | "apellidos" | "departamento"> & {
  horas_vigentes: number | null;
  /** Tiene turno o fichajes en el centro pero no está asignado a él esta semana (préstamo entre centros). */
  prestado?: boolean;
};

export type SemanaFichajes = {
  config: ConfigCalculo & { aviso_retraso_min: number };
  empleados: EmpleadoSemana[];
  turnos: Turno[];
  fichajes: FichajeMin[];
  ausencias: AusenciaSemana[];
  horasDia: HorasDia[];
  /** Hay turnos o fichajes pero la RLS no deja ver a los empleados (encargado sin permiso de lectura de plantilla). */
  plantillaOculta: boolean;
};

const CONFIG_DEF = { regla_horas: "plan_tolerancia", tolerancia_min: 10, redondeo_min: 0, aviso_retraso_min: 10 };
const COLS_FICHAJE = "id, empleado_id, centro_id, tipo, ts, metodo, corrige_a, motivo_correccion";

/** `lunes` debe ser una fecha válida yyyy-mm-dd y, además, lunes. */
function semanaValida(lunes: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(lunes) && lunesDe(lunes) === lunes;
}

/** Ausencia aprobada que cubre el día entero (no medio día ni horas sueltas). */
function ausenciaCompletaDe(ausencias: AusenciaSemana[]) {
  const porEmp: Record<string, AusenciaSemana[]> = {};
  for (const a of ausencias) (porEmp[a.empleado_id] = porEmp[a.empleado_id] || []).push(a);
  return (empId: string, fecha: string) =>
    (porEmp[empId] ?? []).some((a) => a.fecha_inicio <= fecha && a.fecha_fin >= fecha && !a.medio_dia && a.horas == null);
}

/** Carga todo lo que necesita el cuadrante semanal de un centro: una ida por tabla, sin N+1. */
export async function cargarSemanaFichajes(centroId: string, lunes: string): Promise<R<SemanaFichajes>> {
  if (!semanaValida(lunes)) return { ok: false, error: "Semana no válida" };
  const { sb } = await cliente();
  const domingo = sumaDia(lunes, 6);
  // Los fichajes se leen desde el lunes 00:00 hasta el lunes siguiente a las 06:00 (salidas tras medianoche).
  const tsDesde = isoMadrid(lunes, "00:00");
  const tsHasta = isoMadrid(sumaDia(lunes, 7), "06:00");

  const [config, asigs, periodos, turnos, fichajes, ausencias, horasDia] = await Promise.all([
    sb.from("rrhh_centros_config").select("regla_horas, tolerancia_min, redondeo_min, aviso_retraso_min").eq("centro_id", centroId).maybeSingle(),
    sb
      .from("rrhh_asignaciones")
      .select("empleado_id, empleados!inner(id, nombre, apellidos, departamento)")
      .eq("centro_id", centroId)
      .or(`fecha_fin.is.null,fecha_fin.gte.${lunes}`)
      .or(`fecha_inicio.is.null,fecha_inicio.lte.${domingo}`),
    sb
      .from("rrhh_periodos_contrato")
      .select("empleado_id, fecha_alta, horas_semana")
      .lte("fecha_alta", domingo)
      .or(`fecha_baja.is.null,fecha_baja.gte.${lunes}`),
    sb
      .from("rrhh_turnos")
      .select("*")
      .eq("centro_id", centroId)
      .eq("estado", "publicado")
      .not("empleado_id", "is", null)
      .gte("fecha", lunes)
      .lte("fecha", domingo),
    sb.from("rrhh_fichajes").select(COLS_FICHAJE).eq("centro_id", centroId).gte("ts", tsDesde).lt("ts", tsHasta).order("ts"),
    sb
      .from("rrhh_ausencias")
      .select("id, empleado_id, fecha_inicio, fecha_fin, medio_dia, horas, tipo, centro_id, rrhh_tipos_ausencia(nombre, color)")
      .eq("estado", "aprobada")
      .or(`centro_id.is.null,centro_id.eq.${centroId}`)
      .lte("fecha_inicio", domingo)
      .gte("fecha_fin", lunes),
    sb.from("rrhh_horas_dia").select("*").eq("centro_id", centroId).gte("fecha", lunes).lte("fecha", domingo),
  ]);

  // Si falla cualquier consulta no se sigue con datos a medias (se propondrían ceros a toda la plantilla).
  const fallo = [config, asigs, periodos, turnos, fichajes, ausencias, horasDia].find((r) => r.error);
  if (fallo?.error) return { ok: false, error: fallo.error.message };

  const horasPorEmp: Record<string, { fecha_alta: string; horas: number | null }> = {};
  for (const p of periodos.data ?? []) {
    const prev = horasPorEmp[p.empleado_id];
    if (!prev || p.fecha_alta > prev.fecha_alta) horasPorEmp[p.empleado_id] = { fecha_alta: p.fecha_alta, horas: p.horas_semana };
  }
  // Sin periodos legibles (RLS de encargado) no se filtra por ellos: se muestran las asignaciones tal cual.
  const filtrarPorPeriodo = Object.keys(horasPorEmp).length > 0;
  const vistos = new Set<string>();
  const empleados: EmpleadoSemana[] = (asigs.data ?? [])
    .map((r) => r.empleados as unknown as EmpleadoSemana)
    .filter((e) => e && (!filtrarPorPeriodo || e.id in horasPorEmp) && !vistos.has(e.id) && !!vistos.add(e.id))
    .map((e) => ({ ...e, horas_vigentes: horasPorEmp[e.id]?.horas ?? null }));

  // Quien tiene turno o fichajes en el centro sin estar asignado (préstamo entre centros): una consulta más, no N+1.
  const listaTurnos = (turnos.data ?? []) as Turno[];
  const listaFichajes = (fichajes.data ?? []) as FichajeMin[];
  const faltan = [...new Set([...listaTurnos.map((t) => t.empleado_id as string), ...listaFichajes.map((f) => f.empleado_id)])].filter((id) => !vistos.has(id));
  if (faltan.length) {
    const extra = await sb.from("empleados").select("id, nombre, apellidos, departamento").in("id", faltan);
    if (extra.error) return { ok: false, error: extra.error.message };
    for (const e of extra.data ?? []) {
      if (vistos.has(e.id)) continue;
      vistos.add(e.id);
      empleados.push({ ...e, horas_vigentes: horasPorEmp[e.id]?.horas ?? null, prestado: true });
    }
  }
  const dep = (e: EmpleadoSemana) => (e.prestado ? "zzz" : e.departamento || "zz");
  empleados.sort((a, b) => dep(a).localeCompare(dep(b)) || a.nombre.localeCompare(b.nombre));

  return {
    ok: true,
    data: {
      config: config.data ?? CONFIG_DEF,
      empleados,
      turnos: listaTurnos,
      fichajes: listaFichajes,
      ausencias: (ausencias.data ?? []) as unknown as AusenciaSemana[],
      horasDia: (horasDia.data ?? []) as HorasDia[],
      plantillaOculta: !empleados.length && (listaTurnos.length > 0 || listaFichajes.length > 0),
    },
  };
}

/**
 * Calcula las horas retenidas de cada empleado y día de la semana con la regla del centro y las
 * guarda en rrhh_horas_dia como 'propuesta'. No toca los días ya validados. Hoy y los días futuros
 * no se proponen (hoy se propone mañana). Un día con ausencia aprobada de jornada completa y sin
 * fichajes tampoco genera fila: es ausencia, no «no fichó».
 * Devuelve cuántos días se han propuesto.
 */
export async function proponerHoras(centroId: string, lunes: string): Promise<R<number>> {
  if (!semanaValida(lunes)) return { ok: false, error: "Semana no válida" };
  const { sb } = await cliente();
  const carga = await cargarSemanaFichajes(centroId, lunes);
  if (!carga.ok || !carga.data) return { ok: false, error: carga.error ?? "No se pudo cargar la semana" };
  const datos = carga.data;
  if (datos.plantillaOculta) return { ok: false, error: "No tienes permiso para ver la plantilla de este centro, así que no se pueden proponer horas." };
  const hoy = hoyMadrid();
  const validados = new Set(datos.horasDia.filter((h) => h.estado === "validada").map((h) => `${h.empleado_id}|${h.fecha}`));
  const { efectivos } = efectivosMin(datos.fichajes);
  const ausenciaCompleta = ausenciaCompletaDe(datos.ausencias);

  const porEmp: Record<string, FichajeMin[]> = {};
  for (const f of efectivos) (porEmp[f.empleado_id] = porEmp[f.empleado_id] || []).push(f);
  const turnosPorEmp: Record<string, Turno[]> = {};
  for (const t of datos.turnos) if (t.empleado_id) (turnosPorEmp[t.empleado_id] = turnosPorEmp[t.empleado_id] || []).push(t);

  // Empleados del centro + cualquiera con turno o fichaje en el centro esa semana (aunque ya no esté asignado).
  const empIds = new Set<string>([...datos.empleados.map((e) => e.id), ...Object.keys(porEmp), ...Object.keys(turnosPorEmp)]);

  const filas: TablesInsert<"rrhh_horas_dia">[] = [];
  for (const empId of empIds) {
    const jornadas = agruparJornadas(porEmp[empId] ?? []);
    for (let i = 0; i < 7; i++) {
      const fecha = sumaDia(lunes, i);
      if (fecha >= hoy) continue; // hoy se propone mañana: puede haber turnos que aún no han empezado
      if (validados.has(`${empId}|${fecha}`)) continue;
      const efs = jornadas[fecha] ?? [];
      if (!efs.length && ausenciaCompleta(empId, fecha)) continue; // ausencia aprobada: no es «no fichó»
      const turnos = (turnosPorEmp[empId] ?? []).filter((t) => t.fecha === fecha);
      const p = calcularPropuesta({ fecha, turnos, efectivos: efs, cfg: datos.config, esHoy: false });
      if (!p) continue;
      filas.push({
        empleado_id: empId,
        centro_id: centroId,
        fecha,
        horas_plan: p.horas_plan,
        horas_fichadas: p.horas_fichadas,
        horas_retenidas: p.horas_retenidas,
        retraso_min: p.retraso_min,
        salida_antic_min: p.salida_antic_min,
        incidencias: p.incidencias,
        estado: "propuesta",
        modificado_en: new Date().toISOString(),
      });
    }
  }
  if (!filas.length) return { ok: true, data: 0 };
  const { error } = await sb.from("rrhh_horas_dia").upsert(filas, { onConflict: "empleado_id,fecha,centro_id" });
  return error ? { ok: false, error: error.message } : { ok: true, data: filas.length };
}

/** Edita a mano las horas retenidas (y la nota) de una propuesta. Las validadas no se tocan. */
export async function editarHorasDia(id: string, horasRetenidas: number, nota: string | null): Promise<R> {
  const { sb } = await cliente();
  if (!(horasRetenidas >= 0 && horasRetenidas <= 24)) return { ok: false, error: "Las horas deben estar entre 0 y 24" };
  const { data, error } = await sb
    .from("rrhh_horas_dia")
    .update({ horas_retenidas: horasRetenidas, nota: nota?.trim() || null, modificado_en: new Date().toISOString() })
    .eq("id", id)
    .eq("estado", "propuesta")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Este día ya está validado. Reábrelo para cambiarlo." };
  return { ok: true };
}

/** Pasa todas las propuestas del centro y semana a 'validada'. Devuelve cuántas. */
export async function validarSemana(centroId: string, lunes: string): Promise<R<number>> {
  if (!semanaValida(lunes)) return { ok: false, error: "Semana no válida" };
  const { sb, perfil } = await cliente();
  const { data, error } = await sb
    .from("rrhh_horas_dia")
    .update({ estado: "validada", validado_por: perfil.id, validado_en: new Date().toISOString(), modificado_en: new Date().toISOString() })
    .eq("centro_id", centroId)
    .eq("estado", "propuesta")
    .gte("fecha", lunes)
    .lte("fecha", sumaDia(lunes, 6))
    .select("id");
  return error ? { ok: false, error: error.message } : { ok: true, data: data?.length ?? 0 };
}

/** Vuelve a 'propuesta' los días validados de la semana. Solo gestores. */
export async function reabrirSemana(centroId: string, lunes: string): Promise<R<number>> {
  if (!semanaValida(lunes)) return { ok: false, error: "Semana no válida" };
  const { sb } = await cliente();
  const { data: esGestor } = await sb.rpc("rrhh_es_gestor");
  if (!esGestor) return { ok: false, error: "Solo dirección o administración pueden reabrir una semana" };
  const { data, error } = await sb
    .from("rrhh_horas_dia")
    .update({ estado: "propuesta", validado_por: null, validado_en: null, modificado_en: new Date().toISOString() })
    .eq("centro_id", centroId)
    .eq("estado", "validada")
    .gte("fecha", lunes)
    .lte("fecha", sumaDia(lunes, 6))
    .select("id");
  return error ? { ok: false, error: error.message } : { ok: true, data: data?.length ?? 0 };
}
