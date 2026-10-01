"use server";

/* Acciones de servidor de la sección Fichajes v2 (validación semanal).
   Mismo patrón que ../acciones.ts: cliente autenticado, la RLS decide. */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables, TablesInsert } from "@hostelero/db";
import type { Empleado, Fichaje, Turno } from "../tipos";
import { lunesDe, sumaDia } from "../tipos";
import {
  agruparJornadas, calcularPropuesta, efectivosMin, franjaANota, horasFranja, hoyMadrid, isoMadrid, minutosDe,
  type ConfigCalculo, type FichajeMin, type FranjaRetenida,
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

/* ==================== Jornada (vista por día, como el «Control horario» de Skello) ==================== */

/** Fichaje con los campos que necesita la vista Jornada (posición = movil_geo + dentro_radio). */
export type FichajeDia = Fichaje;

export type Jornada = {
  fecha: string;
  config: ConfigCalculo & { aviso_retraso_min: number };
  empleados: EmpleadoSemana[];
  turnos: Turno[];
  /** Fichajes desde las 00:00 del día hasta las 06:00 del siguiente (salidas tras medianoche), todos los campos. */
  fichajes: FichajeDia[];
  ausencias: AusenciaSemana[];
  horasDia: HorasDia[];
  /** Días de la semana (lunes–domingo) con jornada confirmada: hay filas y todas están validadas. */
  confirmados: string[];
  plantillaOculta: boolean;
};


/** Fila que envía la vista Jornada al confirmar. Las horas se recalculan en el servidor. */
export type FilaJornada = FranjaRetenida & {
  empleado_id: string;
  horas_plan: number;
  horas_fichadas: number;
  retraso_min: number;
  salida_antic_min: number;
  incidencias: string[];
  nota: string | null;
};

const fechaValida = (f: string) => /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(new Date(f + "T12:00:00Z").getTime());

/** Carga todo lo que necesita la vista Jornada de un centro y día: una ida por tabla, en paralelo. */
export async function cargarJornada(centroId: string, fecha: string): Promise<R<Jornada>> {
  if (!fechaValida(fecha)) return { ok: false, error: "Fecha no válida" };
  const { sb } = await cliente();
  const lunes = lunesDe(fecha);
  const domingo = sumaDia(lunes, 6);
  const tsDesde = isoMadrid(fecha, "00:00");
  const tsHasta = isoMadrid(sumaDia(fecha, 1), "06:00");

  const [config, asigs, periodos, turnos, fichajes, ausencias, horasDia, horasSemana] = await Promise.all([
    sb.from("rrhh_centros_config").select("regla_horas, tolerancia_min, redondeo_min, aviso_retraso_min").eq("centro_id", centroId).maybeSingle(),
    sb
      .from("rrhh_asignaciones")
      .select("empleado_id, empleados!inner(id, nombre, apellidos, departamento)")
      .eq("centro_id", centroId)
      .or(`fecha_fin.is.null,fecha_fin.gte.${fecha}`)
      .or(`fecha_inicio.is.null,fecha_inicio.lte.${fecha}`),
    sb
      .from("rrhh_periodos_contrato")
      .select("empleado_id, fecha_alta, horas_semana")
      .lte("fecha_alta", fecha)
      .or(`fecha_baja.is.null,fecha_baja.gte.${fecha}`),
    sb.from("rrhh_turnos").select("*").eq("centro_id", centroId).eq("estado", "publicado").not("empleado_id", "is", null).eq("fecha", fecha),
    sb.from("rrhh_fichajes").select("*").eq("centro_id", centroId).gte("ts", tsDesde).lt("ts", tsHasta).order("ts"),
    sb
      .from("rrhh_ausencias")
      .select("id, empleado_id, fecha_inicio, fecha_fin, medio_dia, horas, tipo, centro_id, rrhh_tipos_ausencia(nombre, color)")
      .eq("estado", "aprobada")
      .or(`centro_id.is.null,centro_id.eq.${centroId}`)
      .lte("fecha_inicio", fecha)
      .gte("fecha_fin", fecha),
    sb.from("rrhh_horas_dia").select("*").eq("centro_id", centroId).eq("fecha", fecha),
    sb.from("rrhh_horas_dia").select("fecha, estado").eq("centro_id", centroId).gte("fecha", lunes).lte("fecha", domingo),
  ]);

  const fallo = [config, asigs, periodos, turnos, fichajes, ausencias, horasDia, horasSemana].find((r) => r.error);
  if (fallo?.error) return { ok: false, error: fallo.error.message };

  const horasPorEmp: Record<string, { fecha_alta: string; horas: number | null }> = {};
  for (const p of periodos.data ?? []) {
    const prev = horasPorEmp[p.empleado_id];
    if (!prev || p.fecha_alta > prev.fecha_alta) horasPorEmp[p.empleado_id] = { fecha_alta: p.fecha_alta, horas: p.horas_semana };
  }
  const filtrarPorPeriodo = Object.keys(horasPorEmp).length > 0;
  const vistos = new Set<string>();
  const empleados: EmpleadoSemana[] = (asigs.data ?? [])
    .map((r) => r.empleados as unknown as EmpleadoSemana)
    .filter((e) => e && (!filtrarPorPeriodo || e.id in horasPorEmp) && !vistos.has(e.id) && !!vistos.add(e.id))
    .map((e) => ({ ...e, horas_vigentes: horasPorEmp[e.id]?.horas ?? null }));

  const listaTurnos = (turnos.data ?? []) as Turno[];
  const listaFichajes = (fichajes.data ?? []) as FichajeDia[];
  const listaAus = (ausencias.data ?? []) as unknown as AusenciaSemana[];
  const listaHd = (horasDia.data ?? []) as HorasDia[];
  const faltan = [...new Set([
    ...listaTurnos.map((t) => t.empleado_id as string),
    ...listaFichajes.map((f) => f.empleado_id),
    ...listaHd.map((h) => h.empleado_id),
    ...listaAus.map((a) => a.empleado_id),
  ])].filter((id) => !vistos.has(id));
  if (faltan.length) {
    const extra = await sb.from("empleados").select("id, nombre, apellidos, departamento").in("id", faltan);
    if (extra.error) return { ok: false, error: extra.error.message };
    for (const e of extra.data ?? []) {
      if (vistos.has(e.id)) continue;
      vistos.add(e.id);
      // Las ausencias llegan sin centro: quien solo tiene ausencia y no está asignado aquí no es «prestado», solo no aparece.
      const tieneAlgo = listaTurnos.some((t) => t.empleado_id === e.id) || listaFichajes.some((f) => f.empleado_id === e.id) || listaHd.some((h) => h.empleado_id === e.id);
      if (tieneAlgo) empleados.push({ ...e, horas_vigentes: horasPorEmp[e.id]?.horas ?? null, prestado: true });
    }
  }
  const dep = (e: EmpleadoSemana) => (e.prestado ? "zzz" : e.departamento || "zz");
  empleados.sort((a, b) => dep(a).localeCompare(dep(b)) || a.nombre.localeCompare(b.nombre));

  const porFecha: Record<string, { n: number; validadas: number }> = {};
  for (const h of horasSemana.data ?? []) {
    const x = (porFecha[h.fecha] = porFecha[h.fecha] || { n: 0, validadas: 0 });
    x.n++;
    if (h.estado === "validada") x.validadas++;
  }
  const confirmados = Object.entries(porFecha).filter(([, x]) => x.n > 0 && x.n === x.validadas).map(([f]) => f).sort();

  return {
    ok: true,
    data: {
      fecha,
      config: config.data ?? CONFIG_DEF,
      empleados,
      turnos: listaTurnos,
      fichajes: listaFichajes,
      ausencias: listaAus,
      horasDia: listaHd,
      confirmados,
      plantillaOculta: !empleados.length && (listaTurnos.length > 0 || listaFichajes.length > 0),
    },
  };
}

/**
 * Confirma la jornada de un centro y día (Skello «Confirmar jornada»): guarda cada fila en rrhh_horas_dia
 * como validada. horas_retenidas = salida − entrada retenidas − descanso retenido (recalculado aquí); ausente → 0 h.
 * No se confirman días futuros. Devuelve cuántas filas se han guardado.
 */
export async function confirmarJornada(centroId: string, fecha: string, filas: FilaJornada[]): Promise<R<number>> {
  if (!fechaValida(fecha)) return { ok: false, error: "Fecha no válida" };
  if (fecha > hoyMadrid()) return { ok: false, error: "No se puede confirmar un día futuro" };
  const { sb, perfil } = await cliente();
  const ahora = new Date().toISOString();
  const inserts: TablesInsert<"rrhh_horas_dia">[] = [];
  const franjas: FranjaRetenida[] = [];
  for (const f of filas) {
    if (!f.empleado_id) continue;
    const ent = minutosDe(f.entrada_ret);
    const sal = minutosDe(f.salida_ret);
    const desc = Math.max(0, Math.round(Number(f.descanso_ret_min) || 0));
    if (!f.ausente && (ent == null) !== (sal == null)) return { ok: false, error: "Una fila tiene entrada sin salida (o al revés). Completa las dos horas o déjala vacía." };
    const horas = f.ausente ? 0 : (horasFranja(ent, sal, desc) ?? 0);
    if (horas > 24) return { ok: false, error: "Una fila supera las 24 h." };
    const incidencias = [...new Set([...(Array.isArray(f.incidencias) ? f.incidencias.map(String) : []), ...(f.ausente ? ["ausente"] : [])])];
    const franja: FranjaRetenida = {
      entrada_ret: f.ausente ? null : (ent == null ? null : f.entrada_ret),
      salida_ret: f.ausente ? null : (sal == null ? null : f.salida_ret),
      descanso_ret_min: f.ausente ? 0 : desc,
      ausente: !!f.ausente,
    };
    franjas.push(franja);
    inserts.push({
      empleado_id: f.empleado_id,
      centro_id: centroId,
      fecha,
      horas_plan: Math.round((Number(f.horas_plan) || 0) * 100) / 100,
      horas_fichadas: Math.round((Number(f.horas_fichadas) || 0) * 100) / 100,
      horas_retenidas: Math.round(horas * 100) / 100,
      retraso_min: Math.max(0, Math.round(Number(f.retraso_min) || 0)),
      salida_antic_min: Math.max(0, Math.round(Number(f.salida_antic_min) || 0)),
      incidencias,
      estado: "validada",
      nota: (f.nota ?? "").trim() || null,
      validado_por: perfil.id,
      validado_en: ahora,
      modificado_en: ahora,
    });
  }
  if (!inserts.length) return { ok: true, data: 0 };

  // Primero con las columnas propias de la franja (entrada_ret, salida_ret, descanso_ret_min, ausente).
  // Si la migración no está aplicada, PostgREST devuelve PGRST204 y se guarda la franja en la nota.
  const conColumnas = inserts.map((r, i) => ({ ...r, ...franjas[i] })) as unknown as TablesInsert<"rrhh_horas_dia">[];
  const r1 = await sb.from("rrhh_horas_dia").upsert(conColumnas, { onConflict: "empleado_id,fecha,centro_id" });
  if (!r1.error) return { ok: true, data: inserts.length };
  if (r1.error.code !== "PGRST204") return { ok: false, error: r1.error.message };
  const sinColumnas = inserts.map((r, i) => ({ ...r, nota: franjaANota(r.nota ?? null, franjas[i]) }));
  const r2 = await sb.from("rrhh_horas_dia").upsert(sinColumnas, { onConflict: "empleado_id,fecha,centro_id" });
  return r2.error ? { ok: false, error: r2.error.message } : { ok: true, data: inserts.length };
}

/** Vuelve a 'propuesta' las filas de un centro y día para poder corregirlas. Solo gestores. */
export async function reabrirJornada(centroId: string, fecha: string): Promise<R<number>> {
  if (!fechaValida(fecha)) return { ok: false, error: "Fecha no válida" };
  const { sb } = await cliente();
  const { data: esGestor } = await sb.rpc("rrhh_es_gestor");
  if (!esGestor) return { ok: false, error: "Solo dirección o administración pueden reabrir una jornada" };
  const { data, error } = await sb
    .from("rrhh_horas_dia")
    .update({ estado: "propuesta", validado_por: null, validado_en: null, modificado_en: new Date().toISOString() })
    .eq("centro_id", centroId)
    .eq("fecha", fecha)
    .eq("estado", "validada")
    .select("id");
  return error ? { ok: false, error: error.message } : { ok: true, data: data?.length ?? 0 };
}
