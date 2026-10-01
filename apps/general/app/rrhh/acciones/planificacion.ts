"use server";

/* Acciones de servidor de la sección Planificación (v2).
   Mismo patrón que ../acciones.ts: cliente autenticado, la RLS decide. */

import { after } from "next/server";
import type { Tables } from "@hostelero/db";
import { exigirModulo } from "@/lib/supabase/server";
import { enviarCorreo } from "@/lib/correo";
import type { Ausencia, Convenio, Empleado, Turno } from "../tipos";
import { agruparJornadas, calcularDiaMin, efectivosMin, hoyMadrid, isoMadrid, resumenJornada, type FichajeMin } from "../secciones/fichajes-calculo";

async function cliente() {
  const { supabase, perfil } = await exigirModulo("rrhh");
  return { sb: supabase, perfil };
}
type Sb = Awaited<ReturnType<typeof cliente>>["sb"];

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

const MSG_DIA_CERRADO = "Día cerrado en Fichajes: reábrelo para cambiar turnos";

/** Candado: si alguno de los pares (empleado, fecha) tiene rrhh_horas_dia validada, el día está cerrado
    en Fichajes y no se tocan sus turnos. Devuelve el mensaje de error o null si se puede seguir. */
async function diaCerrado(sb: Sb, pares: { empleado_id: string | null; fecha: string }[]): Promise<string | null> {
  const r = await paresCerrados(sb, pares);
  if (typeof r === "string") return r;
  return pares.some((p) => p.empleado_id && r.has(`${p.empleado_id}|${p.fecha}`)) ? MSG_DIA_CERRADO : null;
}

/** Conjunto «empleado|fecha» de los pares que están cerrados en Fichajes (o el mensaje de error de la consulta). */
async function paresCerrados(sb: Sb, pares: { empleado_id: string | null; fecha: string }[]): Promise<Set<string> | string> {
  const validos = pares.filter((p): p is { empleado_id: string; fecha: string } => !!p.empleado_id);
  if (!validos.length) return new Set();
  const { data, error } = await sb
    .from("rrhh_horas_dia")
    .select("empleado_id, fecha")
    .eq("estado", "validada")
    .in("empleado_id", [...new Set(validos.map((p) => p.empleado_id))])
    .in("fecha", [...new Set(validos.map((p) => p.fecha))]);
  if (error) return error.message;
  return new Set((data ?? []).map((h) => `${h.empleado_id}|${h.fecha}`));
}

export type PuestoCat = Pick<Tables<"rrhh_puestos_cat">, "id" | "nombre" | "color" | "departamento_id" | "activo" | "orden">;
export type PlantillaTurno = Tables<"rrhh_plantillas_turno">;
export type ModeloSemana = Pick<Tables<"rrhh_plantillas_semana">, "id" | "nombre" | "creado_en" | "turnos">;
export type Festivo = Pick<Tables<"rrhh_festivos">, "id" | "fecha" | "nombre" | "ambito" | "centro_id">;
export type AusenciaPlan = Ausencia & { rrhh_tipos_ausencia?: { nombre: string; color: string | null } | null };
/** Turno de otro centro de un empleado de este cuadrante (solo lectura, se pinta en gris). */
export type TurnoAjeno = Pick<Turno, "id" | "empleado_id" | "centro_id" | "fecha" | "hora_inicio" | "hora_fin" | "pausa_min" | "estado"> & {
  centro_nombre: string;
};
/** Lo justo para pintar el cuadrante: sin email ni fecha de nacimiento (PII que la UI no necesita). */
export type EmpleadoPlan = Pick<Empleado, "id" | "nombre" | "apellidos" | "departamento" | "puesto_defecto_id"> & {
  /** Horas de contrato de la semana (prorrateadas si hay alta/baja a mitad de semana); null = sin horas de contrato. */
  horas_vigentes: number | null;
  /** Menor de 18 años al empezar la semana (para el aviso de turno nocturno). */
  menor_en_semana: boolean;
};
/** Lo fichado de verdad por un empleado un día (jornada agrupada como en Fichajes): para pintarlo bajo el turno planificado. */
export type FichadoDia = {
  empleado_id: string;
  fecha: string;
  entrada: string | null; // "HH:MM"
  salida: string | null; // "HH:MM" (puede ser de madrugada del día siguiente)
  pausas_min: number;
  horas: number; // netas fichadas
  incidencias: string[];
  en_curso: boolean;
};
export type HorasDiaPlan = Pick<Tables<"rrhh_horas_dia">, "empleado_id" | "fecha" | "estado" | "horas_retenidas" | "horas_fichadas">;
export type DisponibilidadPlan = Pick<Tables<"rrhh_disponibilidades">, "id" | "empleado_id" | "fecha" | "tipo" | "nota">;
/** Tareas y archivos del turno (modal de Skello): se cargan al abrir el modal de un turno ya guardado. */
export type TareaTurno = Pick<Tables<"rrhh_turno_tareas">, "id" | "turno_id" | "texto" | "hecha" | "hecha_en" | "orden">;
export type ArchivoTurno = Pick<Tables<"rrhh_turno_archivos">, "id" | "turno_id" | "nombre" | "ruta" | "tamano" | "tipo_mime" | "creado_en">;
/** Resumen por turno para el chip del cuadrante: «☑ 2/3» y «📎». */
export type ExtrasTurno = { tareas: number; hechas: number; archivos: number };

const MAX_ARCHIVOS_TURNO = 6;
const MAX_MB_ARCHIVO = 10;
const FIRMA_SEGUNDOS = 300;
const tipoPermitido = (tipo: string | null | undefined, nombre: string) =>
  (!!tipo && (tipo.startsWith("image/") || tipo === "application/pdf")) || /\.(pdf|jpe?g|png|gif|webp|heic|heif)$/i.test(nombre);
const slug = (s: string) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "archivo";

const iso = (d: Date) => d.toLocaleDateString("sv-SE");
const suma = (isoFecha: string, n: number) => {
  const d = new Date(isoFecha + "T12:00");
  d.setDate(d.getDate() + n);
  return iso(d);
};
const fmtDdMm = (isoFecha: string) => {
  const [, m, d] = isoFecha.slice(0, 10).split("-");
  return `${d}/${m}`;
};
const hhmm = (h: string) => h.slice(0, 5);
const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
/** Días naturales entre dos fechas ISO, ambas incluidas. */
const diasIncl = (a: string, b: string) => Math.round((new Date(b + "T12:00").getTime() - new Date(a + "T12:00").getTime()) / 86400000) + 1;
const edadEn = (nacimiento: string, fecha: string) => {
  const n = new Date(nacimiento + "T12:00"), f = new Date(fecha + "T12:00");
  let edad = f.getFullYear() - n.getFullYear();
  if (f.getMonth() < n.getMonth() || (f.getMonth() === n.getMonth() && f.getDate() < n.getDate())) edad--;
  return edad;
};

/** Horas de contrato de la semana [desde, hasta] a partir de los periodos del empleado, igual que
    rrhh_horas_contrato_semana: periodos sin solapes (cada uno se cierra en la víspera del siguiente)
    y prorrateo por los días del periodo dentro de la semana. null si no hay ningún periodo con horas. */
function horasContratoSemana(
  periodos: { fecha_alta: string; fecha_baja: string | null; horas_semana: number | null; creado_en: string }[],
  horasEmpleado: number | null,
  desde: string,
  hasta: string,
): number | null {
  if (!periodos.length) return null;
  if (periodos.every((p) => p.horas_semana == null) && horasEmpleado == null) return null;
  const ps = [...periodos].sort((a, b) => a.fecha_alta.localeCompare(b.fecha_alta) || a.creado_en.localeCompare(b.creado_en));
  let total = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const sig = ps[i + 1];
    let baja = p.fecha_baja;
    if (sig) {
      const vispera = suma(sig.fecha_alta, -1);
      baja = baja == null || baja > vispera ? vispera : baja;
    }
    const ini = p.fecha_alta > desde ? p.fecha_alta : desde;
    const fin = baja == null || baja > hasta ? hasta : baja;
    const dias = Math.max(0, diasIncl(ini, fin));
    total += (Number(p.horas_semana ?? horasEmpleado ?? 0) * dias) / 7;
  }
  return Math.round(total * 100) / 100;
}

/* ================= Carga ================= */

/** Toda la semana de un centro en una sola llamada: dos tandas en Promise.all
    (la segunda necesita los ids de los empleados para los turnos en otros centros). */
export async function cargarSemanaPlan(centroId: string, desde: string, hasta: string) {
  const { sb } = await cliente();
  const desdePrev = suma(desde, -7); // semana anterior: días seguidos y descanso entre semanas
  const hoy = hoyMadrid();

  const [config, emps, nAsignaciones, periodos, turnos, ausencias, puestos, plantillas, modelos, festivos, centros, fichajes, horasDia] = await Promise.all([
    sb.from("rrhh_centros_config").select("*, rrhh_convenios(*)").eq("centro_id", centroId).maybeSingle(),
    sb
      .from("rrhh_asignaciones")
      .select("empleado_id, empleados!inner(id, nombre, apellidos, fecha_alta, fecha_baja, horas_semana, departamento, puesto_defecto_id, fecha_nacimiento)")
      .eq("centro_id", centroId)
      .or(`fecha_fin.is.null,fecha_fin.gte.${desde}`),
    // Mismo filtro sin el join: si hay asignaciones pero el join a empleados no devuelve nada,
    // es que la RLS de `empleados` no deja ver la plantilla (encargado sin política de lectura).
    sb.from("rrhh_asignaciones").select("id", { count: "exact", head: true }).eq("centro_id", centroId).or(`fecha_fin.is.null,fecha_fin.gte.${desde}`),
    sb
      .from("rrhh_periodos_contrato")
      .select("empleado_id, fecha_alta, fecha_baja, horas_semana, creado_en")
      .lte("fecha_alta", hasta)
      .or(`fecha_baja.is.null,fecha_baja.gte.${desde}`),
    sb.from("rrhh_turnos").select("*").eq("centro_id", centroId).gte("fecha", desdePrev).lte("fecha", hasta).limit(5000),
    sb
      .from("rrhh_ausencias")
      .select("*, rrhh_tipos_ausencia(nombre, color)")
      .eq("estado", "aprobada")
      .lte("fecha_inicio", hasta)
      .gte("fecha_fin", desde)
      .or(`centro_id.is.null,centro_id.eq.${centroId}`),
    sb.from("rrhh_puestos_cat").select("id, nombre, color, departamento_id, activo, orden").order("orden").order("nombre"),
    sb
      .from("rrhh_plantillas_turno")
      .select("*")
      .eq("activo", true)
      .or(`centro_id.is.null,centro_id.eq.${centroId}`)
      .order("orden")
      .order("hora_inicio"),
    sb.from("rrhh_plantillas_semana").select("id, nombre, creado_en, turnos").eq("centro_id", centroId).order("nombre"),
    sb
      .from("rrhh_festivos")
      .select("id, fecha, nombre, ambito, centro_id")
      .eq("activo", true)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .or(`centro_id.is.null,centro_id.eq.${centroId}`),
    sb.from("centros").select("id, nombre"),
    // Fichajes de la semana (semanas futuras: ninguno). Ventana como en Fichajes: lunes 00:00 → lunes siguiente 06:00
    // (las salidas de madrugada del domingo). Se agrupan por jornada abajo.
    desde <= hoy
      ? sb
          .from("rrhh_fichajes")
          .select("id, empleado_id, centro_id, tipo, ts, metodo, corrige_a, motivo_correccion")
          .eq("centro_id", centroId)
          .gte("ts", isoMadrid(desde, "00:00"))
          .lt("ts", isoMadrid(suma(desde, 7), "06:00"))
          .order("ts")
          .limit(5000)
      : Promise.resolve({ data: [] as FichajeMin[], error: null }),
    sb.from("rrhh_horas_dia").select("empleado_id, fecha, estado, horas_retenidas, horas_fichadas").eq("centro_id", centroId).gte("fecha", desde).lte("fecha", hasta),
  ]);

  const fallo = [config, emps, nAsignaciones, periodos, turnos, ausencias, fichajes, horasDia].find((q) => q.error)?.error;
  if (fallo) throw new Error(fallo.message);

  type EmpFila = Pick<Empleado, "id" | "nombre" | "apellidos" | "fecha_alta" | "fecha_baja" | "horas_semana" | "departamento" | "puesto_defecto_id" | "fecha_nacimiento">;
  const periodosPorEmp: Record<string, NonNullable<typeof periodos.data>> = {};
  for (const p of periodos.data ?? []) (periodosPorEmp[p.empleado_id] ??= []).push(p);

  const vistos = new Set<string>();
  const asignados = (emps.data ?? [])
    .map((r) => r.empleados as unknown as EmpFila)
    .filter((e) => e && !vistos.has(e.id) && !!vistos.add(e.id));
  // Asignados sin ningún periodo que toque la semana: o están de baja (periodos fuera de la
  // semana) o nunca se les dio de alta un periodo. Para distinguirlos hace falta una consulta más.
  const sinPeriodoSemana = asignados.filter((e) => !periodosPorEmp[e.id] && (!e.fecha_baja || e.fecha_baja >= desde) && (!e.fecha_alta || e.fecha_alta <= hasta));
  const sinPermisoPlantilla = (nAsignaciones.count ?? 0) > 0 && asignados.length === 0;

  // Segunda tanda: turnos de los asignados en OTROS centros (misma semana + anterior) y
  // comprobación de quién no tiene ningún periodo de contrato.
  const ids = asignados.map((e) => e.id);
  const todos = (turnos.data ?? []) as Turno[];
  const idsTurnosSemana = todos.filter((t) => t.fecha >= desde).map((t) => t.id);
  const [ajenosQ, conPeriodoQ, dispQ, tareasQ, archivosQ] = await Promise.all([
    ids.length
      ? sb
          .from("rrhh_turnos")
          .select("id, empleado_id, centro_id, fecha, hora_inicio, hora_fin, pausa_min, estado")
          .in("empleado_id", ids)
          .neq("centro_id", centroId)
          .gte("fecha", desdePrev)
          .lte("fecha", hasta)
          .limit(5000)
      : Promise.resolve({ data: [] as Pick<Turno, "id" | "empleado_id" | "centro_id" | "fecha" | "hora_inicio" | "hora_fin" | "pausa_min" | "estado">[], error: null }),
    sinPeriodoSemana.length
      ? sb.from("rrhh_periodos_contrato").select("empleado_id").in("empleado_id", sinPeriodoSemana.map((e) => e.id))
      : Promise.resolve({ data: [] as { empleado_id: string }[], error: null }),
    // Disponibilidades que marcó el empleado («no puedo» / «prefiero»): el planificador las ve antes de poner turno.
    ids.length
      ? sb.from("rrhh_disponibilidades").select("id, empleado_id, fecha, tipo, nota").in("empleado_id", ids).gte("fecha", desde).lte("fecha", hasta)
      : Promise.resolve({ data: [] as DisponibilidadPlan[], error: null }),
    // Tareas y archivos de los turnos de la semana, agregados por turno (dos consultas, sin N+1).
    idsTurnosSemana.length
      ? sb.from("rrhh_turno_tareas").select("turno_id, hecha").in("turno_id", idsTurnosSemana).limit(10000)
      : Promise.resolve({ data: [] as { turno_id: string; hecha: boolean }[], error: null }),
    idsTurnosSemana.length
      ? sb.from("rrhh_turno_archivos").select("turno_id").in("turno_id", idsTurnosSemana).limit(10000)
      : Promise.resolve({ data: [] as { turno_id: string }[], error: null }),
  ]);
  const tienePeriodo = new Set((conPeriodoQ.data ?? []).map((p) => p.empleado_id));
  const extras: Record<string, ExtrasTurno> = {};
  for (const x of tareasQ.data ?? []) {
    const e = (extras[x.turno_id] ??= { tareas: 0, hechas: 0, archivos: 0 });
    e.tareas++;
    if (x.hecha) e.hechas++;
  }
  for (const x of archivosQ.data ?? []) (extras[x.turno_id] ??= { tareas: 0, hechas: 0, archivos: 0 }).archivos++;

  const empleados: EmpleadoPlan[] = asignados
    .filter((e) => !!periodosPorEmp[e.id] || (sinPeriodoSemana.includes(e) && !tienePeriodo.has(e.id)))
    .map((e) => ({
      id: e.id,
      nombre: e.nombre,
      apellidos: e.apellidos,
      departamento: e.departamento,
      puesto_defecto_id: e.puesto_defecto_id,
      horas_vigentes: periodosPorEmp[e.id]
        ? horasContratoSemana(periodosPorEmp[e.id], e.horas_semana, desde, hasta)
        : e.horas_semana != null && Number(e.horas_semana) > 0 ? Number(e.horas_semana) : null,
      menor_en_semana: !!e.fecha_nacimiento && edadEn(e.fecha_nacimiento, desde) < 18,
    }))
    .sort((a, b) => (a.departamento || "zz").localeCompare(b.departamento || "zz") || a.nombre.localeCompare(b.nombre));
  const idsVisibles = new Set(empleados.map((e) => e.id));

  const nombreCentro: Record<string, string> = {};
  for (const c of centros.data ?? []) nombreCentro[c.id] = c.nombre;
  const ajenos: TurnoAjeno[] = (ajenosQ.data ?? [])
    .filter((t) => t.empleado_id && idsVisibles.has(t.empleado_id))
    .map((t) => ({ ...t, centro_nombre: nombreCentro[t.centro_id] ?? "otro centro" }));

  // Fichajes efectivos (sin los anulados por corrección) agrupados por jornada, como hace Fichajes:
  // una salida de madrugada pertenece al día de la entrada. Solo de los empleados visibles.
  const { efectivos } = efectivosMin((fichajes.data ?? []) as FichajeMin[]);
  const fichPorEmp: Record<string, FichajeMin[]> = {};
  for (const f of efectivos) if (idsVisibles.has(f.empleado_id)) (fichPorEmp[f.empleado_id] ??= []).push(f);
  // Minutos absolutos de la jornada (la salida puede pasar de 1440) → "HH:MM" del reloj.
  const hhDe = (m: number | null) => {
    if (m == null) return null;
    const n = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  };
  const fichados: FichadoDia[] = [];
  for (const [empId, fs] of Object.entries(fichPorEmp)) {
    for (const [fecha, efs] of Object.entries(agruparJornadas(fs))) {
      if (fecha < desde || fecha > hasta) continue;
      const { entrada, salida, pausasMin } = resumenJornada(fecha, efs);
      const dia = calcularDiaMin(efs, fecha === hoy);
      fichados.push({
        empleado_id: empId,
        fecha,
        entrada: hhDe(entrada),
        salida: hhDe(salida),
        pausas_min: pausasMin,
        horas: Math.round(dia.horas * 100) / 100,
        incidencias: dia.inc,
        en_curso: dia.enCurso,
      });
    }
  }

  return {
    reglas: (config.data?.rrhh_convenios as Convenio | null) ?? null,
    pacto10h: config.data?.pacto_descanso_10h ?? false,
    /** true = hay empleados asignados pero la RLS de `empleados` no deja verlos (encargado sin política). */
    sinPermisoPlantilla,
    empleados,
    turnos: todos.filter((t) => t.fecha >= desde),
    turnosPrevios: todos.filter((t) => t.fecha < desde),
    ajenos,
    ausencias: (ausencias.data ?? []) as unknown as AusenciaPlan[],
    puestos: (puestos.data ?? []) as PuestoCat[],
    plantillas: (plantillas.data ?? []) as PlantillaTurno[],
    modelos: (modelos.data ?? []) as ModeloSemana[],
    festivos: (festivos.data ?? []) as Festivo[],
    /** Fichado real por empleado y día (días pasados): se pinta bajo el turno planificado. */
    fichados,
    /** Filas de rrhh_horas_dia del centro en la semana: horas retenidas y candado (todas validadas = día cerrado). */
    horasDia: (horasDia.data ?? []) as HorasDiaPlan[],
    disponibilidades: (dispQ.data ?? []) as DisponibilidadPlan[],
    /** Por turno: cuántas tareas (y hechas) y cuántos archivos tiene, para los iconos del chip. */
    extras,
  };
}

/* ================= Vista Mes ================= */

/** Lo justo del turno para la barra del mes (sin nota ni creado_por). */
export type TurnoMes = Pick<Turno, "id" | "empleado_id" | "fecha" | "hora_inicio" | "hora_fin" | "pausa_min" | "puesto_id" | "puesto" | "color" | "estado">;
export type EmpleadoMes = Pick<Empleado, "id" | "nombre" | "apellidos" | "departamento" | "puesto_defecto_id"> & {
  /** Horas de contrato del mes: contrato semanal × (días del mes / 7), prorrateado por periodos. null = sin horas de contrato. */
  horas_contrato_mes: number | null;
};

/** Un centro-mes en una sola llamada (solo lectura): turnos (borradores y publicados), ausencias aprobadas,
    festivos, puestos y plantilla con sus horas de contrato del mes. Un centro-mes son < 1.500 turnos:
    el tope de 10.000 filas no se toca. */
export async function cargarMesPlan(centroId: string, desde: string, hasta: string) {
  const { sb } = await cliente();
  const [emps, nAsignaciones, periodos, turnos, ausencias, puestos, festivos] = await Promise.all([
    sb
      .from("rrhh_asignaciones")
      .select("empleado_id, empleados!inner(id, nombre, apellidos, fecha_alta, fecha_baja, horas_semana, departamento, puesto_defecto_id)")
      .eq("centro_id", centroId)
      .or(`fecha_fin.is.null,fecha_fin.gte.${desde}`),
    sb.from("rrhh_asignaciones").select("id", { count: "exact", head: true }).eq("centro_id", centroId).or(`fecha_fin.is.null,fecha_fin.gte.${desde}`),
    sb
      .from("rrhh_periodos_contrato")
      .select("empleado_id, fecha_alta, fecha_baja, horas_semana, creado_en")
      .lte("fecha_alta", hasta)
      .or(`fecha_baja.is.null,fecha_baja.gte.${desde}`),
    sb
      .from("rrhh_turnos")
      .select("id, empleado_id, fecha, hora_inicio, hora_fin, pausa_min, puesto_id, puesto, color, estado")
      .eq("centro_id", centroId)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha")
      .order("hora_inicio")
      .limit(10000),
    sb
      .from("rrhh_ausencias")
      .select("*, rrhh_tipos_ausencia(nombre, color)")
      .eq("estado", "aprobada")
      .lte("fecha_inicio", hasta)
      .gte("fecha_fin", desde)
      .or(`centro_id.is.null,centro_id.eq.${centroId}`),
    sb.from("rrhh_puestos_cat").select("id, nombre, color, departamento_id, activo, orden").order("orden").order("nombre"),
    sb
      .from("rrhh_festivos")
      .select("id, fecha, nombre, ambito, centro_id")
      .eq("activo", true)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .or(`centro_id.is.null,centro_id.eq.${centroId}`),
  ]);
  const fallo = [emps, nAsignaciones, periodos, turnos, ausencias, puestos, festivos].find((q) => q.error)?.error;
  if (fallo) throw new Error(fallo.message);

  type EmpFila = Pick<Empleado, "id" | "nombre" | "apellidos" | "fecha_alta" | "fecha_baja" | "horas_semana" | "departamento" | "puesto_defecto_id">;
  const periodosPorEmp: Record<string, NonNullable<typeof periodos.data>> = {};
  for (const p of periodos.data ?? []) (periodosPorEmp[p.empleado_id] ??= []).push(p);
  const vistos = new Set<string>();
  const asignados = (emps.data ?? [])
    .map((r) => r.empleados as unknown as EmpFila)
    .filter((e) => e && !vistos.has(e.id) && !!vistos.add(e.id));
  const sinPermisoPlantilla = (nAsignaciones.count ?? 0) > 0 && asignados.length === 0;
  // Mismo criterio que la semana: quien no tiene ningún periodo que toque el mes solo entra si no tiene
  // periodos en absoluto (nunca se le dio de alta uno); si los tiene fuera del mes, está de baja.
  const sinPeriodoMes = asignados.filter((e) => !periodosPorEmp[e.id] && (!e.fecha_baja || e.fecha_baja >= desde) && (!e.fecha_alta || e.fecha_alta <= hasta));
  const conPeriodo = sinPeriodoMes.length
    ? await sb.from("rrhh_periodos_contrato").select("empleado_id").in("empleado_id", sinPeriodoMes.map((e) => e.id))
    : { data: [] as { empleado_id: string }[], error: null };
  if (conPeriodo.error) throw new Error(conPeriodo.error.message);
  const tienePeriodo = new Set((conPeriodo.data ?? []).map((p) => p.empleado_id));

  const empleados: EmpleadoMes[] = asignados
    .filter((e) => !!periodosPorEmp[e.id] || (sinPeriodoMes.includes(e) && !tienePeriodo.has(e.id)))
    .map((e) => ({
      id: e.id,
      nombre: e.nombre,
      apellidos: e.apellidos,
      departamento: e.departamento,
      puesto_defecto_id: e.puesto_defecto_id,
      horas_contrato_mes: periodosPorEmp[e.id]
        ? horasContratoSemana(periodosPorEmp[e.id], e.horas_semana, desde, hasta)
        : e.horas_semana != null && Number(e.horas_semana) > 0 ? Math.round((Number(e.horas_semana) * diasIncl(desde, hasta) * 100) / 7) / 100 : null,
    }))
    .sort((a, b) => (a.departamento || "zz").localeCompare(b.departamento || "zz") || a.nombre.localeCompare(b.nombre));

  return {
    sinPermisoPlantilla,
    empleados,
    turnos: (turnos.data ?? []) as TurnoMes[],
    ausencias: (ausencias.data ?? []) as unknown as AusenciaPlan[],
    puestos: (puestos.data ?? []) as PuestoCat[],
    festivos: (festivos.data ?? []) as Festivo[],
  };
}

/* ================= Turnos ================= */

export type TurnoInput = {
  empleado_id: string | null;
  centro_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  pausa_min: number;
  puesto_id: string | null;
  puesto: string | null; // texto del puesto (se conserva para Ratios)
  nota: string | null;
};

export async function guardarTurnoPlan(turnoId: string | null, fila: TurnoInput): Promise<R<string>> {
  const { sb, perfil } = await cliente();
  if (turnoId) {
    const { data: actual, error: e0 } = await sb.from("rrhh_turnos").select("empleado_id, fecha").eq("id", turnoId).maybeSingle();
    if (e0) return { ok: false, error: e0.message };
    if (!actual) return { ok: false, error: "No tienes permiso sobre este turno" };
    // Candado: ni el día de donde sale ni el día donde queda pueden estar cerrados en Fichajes.
    const cerrado = await diaCerrado(sb, [actual, { empleado_id: fila.empleado_id, fecha: fila.fecha }]);
    if (cerrado) return { ok: false, error: cerrado };
    // .select("id"): si la RLS no deja ver el turno, el update no toca nada y hay que decirlo.
    const { data, error } = await sb.from("rrhh_turnos").update(fila).eq("id", turnoId).select("id");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, error: "No tienes permiso sobre este turno" };
    return { ok: true, data: turnoId };
  }
  const cerrado = await diaCerrado(sb, [{ empleado_id: fila.empleado_id, fecha: fila.fecha }]);
  if (cerrado) return { ok: false, error: cerrado };
  const { data, error } = await sb.from("rrhh_turnos").insert({ ...fila, creado_por: perfil.id }).select("id").single();
  return error || !data ? { ok: false, error: error?.message } : { ok: true, data: data.id };
}

/** Mueve un turno a otra celda (empleado y/o fecha). empleado_id null = sin asignar. */
export async function moverTurno(turnoId: string, destino: { empleado_id: string | null; fecha: string }): Promise<R> {
  const { sb } = await cliente();
  const { data: actual, error: e0 } = await sb.from("rrhh_turnos").select("empleado_id, fecha").eq("id", turnoId).maybeSingle();
  if (e0) return { ok: false, error: e0.message };
  if (!actual) return { ok: false, error: "No tienes permiso sobre este turno" };
  const cerrado = await diaCerrado(sb, [actual, destino]);
  if (cerrado) return { ok: false, error: cerrado };
  const { data, error } = await sb.from("rrhh_turnos").update(destino).eq("id", turnoId).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "No tienes permiso sobre este turno" };
  return { ok: true };
}

/** Duplica un turno en otra celda (o en la misma) como borrador. */
export async function duplicarTurno(turnoId: string, destino: { empleado_id: string | null; fecha: string }): Promise<R<string>> {
  const { sb, perfil } = await cliente();
  const { data: t, error } = await sb.from("rrhh_turnos").select("*").eq("id", turnoId).single();
  if (error || !t) return { ok: false, error: error?.message || "Turno no encontrado" };
  const cerrado = await diaCerrado(sb, [destino]);
  if (cerrado) return { ok: false, error: cerrado };
  const { data, error: e2 } = await sb
    .from("rrhh_turnos")
    .insert({
      empleado_id: destino.empleado_id,
      centro_id: t.centro_id,
      fecha: destino.fecha,
      hora_inicio: t.hora_inicio,
      hora_fin: t.hora_fin,
      pausa_min: t.pausa_min,
      puesto: t.puesto,
      puesto_id: t.puesto_id,
      nota: t.nota,
      color: t.color,
      estado: "borrador",
      creado_por: perfil.id,
    })
    .select("id")
    .single();
  return e2 || !data ? { ok: false, error: e2?.message } : { ok: true, data: data.id };
}

/**
 * Arrastre múltiple: mueve (o duplica como borrador) varios turnos a la vez, todos con el mismo desplazamiento
 * en días. `empleadoId` = reasignar todos a ese empleado; null = cada uno se queda con el suyo.
 * Valida en servidor (mismo centro, días cerrados en Fichajes en origen y destino) y escribe en una sola pasada:
 * un insert con todas las copias o un upsert por id con las fechas/empleado nuevos. data = turnos escritos.
 */
export async function moverTurnos(ids: string[], deltaDias: number, empleadoId: string | null, duplicar: boolean): Promise<R<number>> {
  const { sb, perfil } = await cliente();
  const lista = [...new Set(ids)].filter(Boolean);
  if (!lista.length) return { ok: false, error: "No hay turnos que mover" };
  if (lista.length > 200) return { ok: false, error: "Como mucho 200 turnos a la vez" };
  const delta = Math.trunc(Number(deltaDias));
  if (!Number.isFinite(delta) || Math.abs(delta) > 366) return { ok: false, error: "Desplazamiento no válido" };
  if (!duplicar && delta === 0 && empleadoId === null) return { ok: true, data: 0 };

  const { data: turnos, error: e0 } = await sb.from("rrhh_turnos").select("*").in("id", lista);
  if (e0) return { ok: false, error: e0.message };
  if (!turnos || turnos.length !== lista.length) return { ok: false, error: "No tienes permiso sobre alguno de los turnos" };
  const centros = new Set(turnos.map((t) => t.centro_id));
  if (centros.size !== 1) return { ok: false, error: "Los turnos seleccionados son de centros distintos" };
  const centroId = turnos[0].centro_id;
  if (empleadoId) {
    // El empleado de destino tiene que estar asignado al centro de los turnos.
    const { data: asig, error: eA } = await sb.from("rrhh_asignaciones").select("id").eq("centro_id", centroId).eq("empleado_id", empleadoId).limit(1);
    if (eA) return { ok: false, error: eA.message };
    if (!asig?.length) return { ok: false, error: "El empleado no está asignado a este centro" };
  }

  const destinos = turnos.map((t) => ({ empleado_id: empleadoId ?? t.empleado_id, fecha: suma(t.fecha, delta) }));
  // Candado: ni los días de donde salen (si se mueven) ni los días donde caen pueden estar cerrados.
  const cerrados = await paresCerrados(sb, duplicar ? destinos : [...turnos, ...destinos]);
  if (typeof cerrados === "string") return { ok: false, error: cerrados };
  const clave = (p: { empleado_id: string | null; fecha: string }) => `${p.empleado_id}|${p.fecha}`;
  if ((duplicar ? destinos : [...turnos, ...destinos]).some((p) => p.empleado_id && cerrados.has(clave(p)))) return { ok: false, error: MSG_DIA_CERRADO };

  if (duplicar) {
    const copias = turnos.map((t, i) => ({
      empleado_id: destinos[i].empleado_id,
      centro_id: t.centro_id,
      fecha: destinos[i].fecha,
      hora_inicio: t.hora_inicio,
      hora_fin: t.hora_fin,
      pausa_min: t.pausa_min,
      puesto: t.puesto,
      puesto_id: t.puesto_id,
      nota: t.nota,
      color: t.color,
      estado: "borrador" as const,
      creado_por: perfil.id,
    }));
    const { data, error } = await sb.from("rrhh_turnos").insert(copias).select("id");
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data?.length ?? 0 };
  }
  // Mover: cada turno va a una fecha distinta, así que un update plano no vale; el upsert por id lo hace en una sentencia.
  const filas = turnos.map((t, i) => ({ ...t, empleado_id: destinos[i].empleado_id, fecha: destinos[i].fecha }));
  const { data, error } = await sb.from("rrhh_turnos").upsert(filas, { onConflict: "id" }).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "No tienes permiso sobre estos turnos" };
  return { ok: true, data: data.length };
}

export async function borrarTurnos(ids: string[]): Promise<R<number>> {
  const { sb } = await cliente();
  if (!ids.length) return { ok: true, data: 0 };
  const { data: lista, error: e0 } = await sb.from("rrhh_turnos").select("empleado_id, fecha").in("id", ids);
  if (e0) return { ok: false, error: e0.message };
  const cerrado = await diaCerrado(sb, lista ?? []);
  if (cerrado) return { ok: false, error: cerrado };
  // Los archivos del turno: la fila cae en cascada, el fichero del bucket hay que quitarlo a mano.
  const { data: archivos } = await sb.from("rrhh_turno_archivos").select("ruta").in("turno_id", ids);
  // Devuelve los borrados de verdad (la RLS puede dejar fuera alguno).
  const { data, error } = await sb.from("rrhh_turnos").delete().in("id", ids).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "No tienes permiso sobre estos turnos" };
  if (archivos?.length) await sb.storage.from("docs").remove(archivos.map((a) => a.ruta));
  return { ok: true, data: data.length };
}

/* ================= Tareas y archivos del turno ================= */

/** Tareas (por orden) y archivos de un turno ya guardado. La RLS deja ver solo los de mis centros. */
export async function cargarExtrasTurno(turnoId: string): Promise<{ tareas: TareaTurno[]; archivos: ArchivoTurno[] }> {
  const { sb } = await cliente();
  const [t, a] = await Promise.all([
    sb.from("rrhh_turno_tareas").select("id, turno_id, texto, hecha, hecha_en, orden").eq("turno_id", turnoId).order("orden").order("creado_en"),
    sb.from("rrhh_turno_archivos").select("id, turno_id, nombre, ruta, tamano, tipo_mime, creado_en").eq("turno_id", turnoId).order("creado_en"),
  ]);
  const fallo = t.error ?? a.error;
  if (fallo) throw new Error(fallo.message);
  return { tareas: (t.data ?? []) as TareaTurno[], archivos: (a.data ?? []) as ArchivoTurno[] };
}

export async function crearTareaTurno(turnoId: string, texto: string): Promise<R<TareaTurno>> {
  const { sb } = await cliente();
  const limpio = texto.trim().slice(0, 300);
  if (!limpio) return { ok: false, error: "Escribe la tarea" };
  const { data: ult } = await sb.from("rrhh_turno_tareas").select("orden").eq("turno_id", turnoId).order("orden", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await sb
    .from("rrhh_turno_tareas")
    .insert({ turno_id: turnoId, texto: limpio, orden: (ult?.orden ?? -1) + 1 })
    .select("id, turno_id, texto, hecha, hecha_en, orden")
    .single();
  if (error || !data) return { ok: false, error: error?.message || "No tienes permiso sobre este turno" };
  return { ok: true, data: data as TareaTurno };
}

export async function actualizarTareaTurno(id: string, cambios: { texto?: string; hecha?: boolean }): Promise<R> {
  const { sb } = await cliente();
  const fila: { texto?: string; hecha?: boolean } = {};
  if (cambios.texto !== undefined) {
    const limpio = cambios.texto.trim().slice(0, 300);
    if (!limpio) return { ok: false, error: "La tarea no puede quedar vacía" };
    fila.texto = limpio;
  }
  if (cambios.hecha !== undefined) fila.hecha = cambios.hecha;
  const { data, error } = await sb.from("rrhh_turno_tareas").update(fila).eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "No tienes permiso sobre esta tarea" };
  return { ok: true };
}

export async function borrarTareaTurno(id: string): Promise<R> {
  const { sb } = await cliente();
  const { data, error } = await sb.from("rrhh_turno_tareas").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "No tienes permiso sobre esta tarea" };
  return { ok: true };
}

/** Nuevo orden de las tareas de un turno: la posición en `ids` pasa a ser `orden`. */
export async function reordenarTareasTurno(turnoId: string, ids: string[]): Promise<R> {
  const { sb } = await cliente();
  const rs = await Promise.all(ids.map((id, i) => sb.from("rrhh_turno_tareas").update({ orden: i }).eq("id", id).eq("turno_id", turnoId)));
  const fallo = rs.find((r) => r.error)?.error;
  return fallo ? { ok: false, error: fallo.message } : { ok: true };
}

/**
 * Prepara la subida de un archivo al turno: comprueba límites (6 por turno, 10 MB, imágenes y PDF) y
 * devuelve una URL firmada de subida para que el navegador suba el fichero directo al bucket `docs`
 * (como en Documentos: el binario no pasa por el servidor de Next). Ruta: <cuenta>/rrhh/turnos/<turno>/<ts>-<nombre>.
 */
export async function prepararSubidaArchivoTurno(entrada: { turnoId: string; nombre: string; tamano: number; tipo: string | null }): Promise<R<{ ruta: string; urlSubida: string }>> {
  const { sb, perfil } = await cliente();
  if (!entrada.nombre) return { ok: false, error: "Falta el fichero" };
  if (!(entrada.tamano > 0) || entrada.tamano > MAX_MB_ARCHIVO * 1024 * 1024) return { ok: false, error: `El fichero supera el máximo de ${MAX_MB_ARCHIVO} MB` };
  if (!tipoPermitido(entrada.tipo, entrada.nombre)) return { ok: false, error: "Solo se admiten imágenes y PDF" };
  const { data: turno, error: eT } = await sb.from("rrhh_turnos").select("id").eq("id", entrada.turnoId).maybeSingle();
  if (eT) return { ok: false, error: eT.message };
  if (!turno) return { ok: false, error: "No tienes permiso sobre este turno" };
  const { count } = await sb.from("rrhh_turno_archivos").select("id", { count: "exact", head: true }).eq("turno_id", entrada.turnoId);
  if ((count ?? 0) >= MAX_ARCHIVOS_TURNO) return { ok: false, error: `Un turno admite como mucho ${MAX_ARCHIVOS_TURNO} archivos` };
  const ruta = `${perfil.cuenta_id}/rrhh/turnos/${entrada.turnoId}/${Date.now()}-${slug(entrada.nombre)}`;
  const { data, error } = await sb.storage.from("docs").createSignedUploadUrl(ruta);
  if (error || !data) return { ok: false, error: "No se pudo preparar la subida" };
  return { ok: true, data: { ruta: data.path, urlSubida: data.signedUrl } };
}

/** Registra la fila una vez subido el fichero al bucket. */
export async function registrarArchivoTurno(entrada: { turnoId: string; nombre: string; ruta: string; tamano: number; tipo: string | null }): Promise<R<ArchivoTurno>> {
  const { sb, perfil } = await cliente();
  // La ruta tiene que colgar de la cuenta y del turno: de esto depende el aislamiento del bucket.
  if (!entrada.ruta.startsWith(`${perfil.cuenta_id}/rrhh/turnos/${entrada.turnoId}/`)) return { ok: false, error: "Ruta de fichero no válida" };
  const { count } = await sb.from("rrhh_turno_archivos").select("id", { count: "exact", head: true }).eq("turno_id", entrada.turnoId);
  if ((count ?? 0) >= MAX_ARCHIVOS_TURNO) {
    await sb.storage.from("docs").remove([entrada.ruta]);
    return { ok: false, error: `Un turno admite como mucho ${MAX_ARCHIVOS_TURNO} archivos` };
  }
  const { data, error } = await sb
    .from("rrhh_turno_archivos")
    .insert({ turno_id: entrada.turnoId, nombre: entrada.nombre.slice(0, 200), ruta: entrada.ruta, tamano: Math.round(entrada.tamano), tipo_mime: entrada.tipo, subido_por: perfil.id })
    .select("id, turno_id, nombre, ruta, tamano, tipo_mime, creado_en")
    .single();
  if (error || !data) {
    await sb.storage.from("docs").remove([entrada.ruta]);
    return { ok: false, error: error?.message || "No se pudo registrar el archivo" };
  }
  return { ok: true, data: data as ArchivoTurno };
}

/** URL firmada (5 min) para ver o descargar un archivo del turno. */
export async function urlArchivoTurno(archivoId: string, descargar = false): Promise<R<{ url: string }>> {
  const { sb } = await cliente();
  const { data: a, error } = await sb.from("rrhh_turno_archivos").select("ruta, nombre").eq("id", archivoId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!a) return { ok: false, error: "Archivo no encontrado" };
  const { data, error: eF } = await sb.storage.from("docs").createSignedUrl(a.ruta, FIRMA_SEGUNDOS, { download: descargar ? a.nombre : undefined });
  if (eF || !data) return { ok: false, error: "No se pudo firmar la URL" };
  return { ok: true, data: { url: data.signedUrl } };
}

export async function borrarArchivoTurno(archivoId: string): Promise<R> {
  const { sb } = await cliente();
  const { data: a, error: e0 } = await sb.from("rrhh_turno_archivos").select("id, ruta").eq("id", archivoId).maybeSingle();
  if (e0) return { ok: false, error: e0.message };
  if (!a) return { ok: false, error: "Archivo no encontrado" };
  const { data, error } = await sb.from("rrhh_turno_archivos").delete().eq("id", a.id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "No tienes permiso sobre este archivo" };
  // Primero la fila (es la referencia visible); si el fichero no se pudo quitar del bucket, se avisa.
  const { error: eS } = await sb.storage.from("docs").remove([a.ruta]);
  return eS ? { ok: true, error: "Archivo quitado del turno, pero el fichero no se pudo borrar del almacenamiento" } : { ok: true };
}

/* ================= Semana ================= */

export async function copiarSemanaAnteriorPlan(centroId: string, lunes: string, empleadosActivos: string[]): Promise<R<number>> {
  const { sb, perfil } = await cliente();
  const { data: previos, error } = await sb
    .from("rrhh_turnos")
    .select("*")
    .eq("centro_id", centroId)
    .gte("fecha", suma(lunes, -7))
    .lte("fecha", suma(lunes, -1));
  if (error) return { ok: false, error: error.message };
  if (!previos?.length) return { ok: false, error: "La semana anterior está vacía" };
  const activos = new Set(empleadosActivos);
  const nuevos = previos
    .filter((t) => !t.empleado_id || activos.has(t.empleado_id))
    .map((t) => ({
      empleado_id: t.empleado_id,
      centro_id: t.centro_id,
      fecha: suma(t.fecha, 7),
      hora_inicio: t.hora_inicio,
      hora_fin: t.hora_fin,
      pausa_min: t.pausa_min,
      puesto: t.puesto,
      puesto_id: t.puesto_id,
      nota: t.nota,
      color: t.color,
      estado: "borrador" as const,
      creado_por: perfil.id,
    }));
  if (!nuevos.length) return { ok: false, error: "Ningún turno de la semana anterior es de un empleado activo" };
  // Días ya cerrados en Fichajes se saltan (no se puede meter un turno en un día validado).
  const cerrados = await paresCerrados(sb, nuevos);
  if (typeof cerrados === "string") return { ok: false, error: cerrados };
  const abiertos = nuevos.filter((t) => !t.empleado_id || !cerrados.has(`${t.empleado_id}|${t.fecha}`));
  if (!abiertos.length) return { ok: false, error: MSG_DIA_CERRADO };
  const { error: e2 } = await sb.from("rrhh_turnos").insert(abiertos);
  return e2 ? { ok: false, error: e2.message } : { ok: true, data: abiertos.length };
}

type TurnoModelo = { empleado_id: string | null; dow: number; hora_inicio: string; hora_fin: string; pausa_min: number; puesto_id: string | null };

/** Guarda los turnos de la semana como modelo reutilizable (rrhh_plantillas_semana). */
export async function guardarModeloSemana(centroId: string, nombre: string, lunes: string): Promise<R<number>> {
  const { sb, perfil } = await cliente();
  if (!nombre.trim()) return { ok: false, error: "Ponle un nombre al modelo" };
  const { data: turnos, error } = await sb
    .from("rrhh_turnos")
    .select("empleado_id, fecha, hora_inicio, hora_fin, pausa_min, puesto_id")
    .eq("centro_id", centroId)
    .gte("fecha", lunes)
    .lte("fecha", suma(lunes, 6));
  if (error) return { ok: false, error: error.message };
  if (!turnos?.length) return { ok: false, error: "Esta semana no tiene turnos que guardar" };
  const modelo: TurnoModelo[] = turnos.map((t) => ({
    empleado_id: t.empleado_id,
    dow: (new Date(t.fecha + "T12:00").getDay() + 6) % 7,
    hora_inicio: t.hora_inicio,
    hora_fin: t.hora_fin,
    pausa_min: t.pausa_min,
    puesto_id: t.puesto_id,
  }));
  const { error: e2 } = await sb
    .from("rrhh_plantillas_semana")
    .insert({ centro_id: centroId, nombre: nombre.trim(), turnos: modelo, creado_por: perfil.id });
  return e2 ? { ok: false, error: e2.message } : { ok: true, data: modelo.length };
}

/** Aplica un modelo a la semana: crea borradores para los empleados que sigan activos (y los huecos). */
export async function aplicarModeloSemana(modeloId: string, centroId: string, lunes: string, empleadosActivos: string[]): Promise<R<number>> {
  const { sb, perfil } = await cliente();
  const [{ data: m, error }, { data: puestos }] = await Promise.all([
    sb.from("rrhh_plantillas_semana").select("turnos, centro_id").eq("id", modeloId).single(),
    sb.from("rrhh_puestos_cat").select("id, nombre"),
  ]);
  if (error || !m) return { ok: false, error: error?.message || "Modelo no encontrado" };
  if (m.centro_id !== centroId) return { ok: false, error: "El modelo es de otro centro" };
  const nombrePuesto: Record<string, string> = {};
  for (const p of puestos ?? []) nombrePuesto[p.id] = p.nombre;
  const activos = new Set(empleadosActivos);
  const lista = (Array.isArray(m.turnos) ? m.turnos : []) as TurnoModelo[];
  const nuevos = lista
    .filter((t) => t && typeof t.dow === "number" && t.hora_inicio && t.hora_fin && (!t.empleado_id || activos.has(t.empleado_id)))
    .map((t) => ({
      empleado_id: t.empleado_id ?? null,
      centro_id: centroId,
      fecha: suma(lunes, Math.max(0, Math.min(6, t.dow))),
      hora_inicio: t.hora_inicio,
      hora_fin: t.hora_fin,
      pausa_min: Number(t.pausa_min) || 0,
      puesto_id: t.puesto_id ?? null,
      puesto: t.puesto_id ? nombrePuesto[t.puesto_id] ?? null : null,
      estado: "borrador" as const,
      creado_por: perfil.id,
    }));
  if (!nuevos.length) return { ok: false, error: "El modelo no tiene turnos de empleados activos" };
  const cerrados = await paresCerrados(sb, nuevos);
  if (typeof cerrados === "string") return { ok: false, error: cerrados };
  const abiertos = nuevos.filter((t) => !t.empleado_id || !cerrados.has(`${t.empleado_id}|${t.fecha}`));
  if (!abiertos.length) return { ok: false, error: MSG_DIA_CERRADO };
  const { error: e2 } = await sb.from("rrhh_turnos").insert(abiertos);
  return e2 ? { ok: false, error: e2.message } : { ok: true, data: abiertos.length };
}

export async function borrarModeloSemana(modeloId: string): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb.from("rrhh_plantillas_semana").delete().eq("id", modeloId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ================= Publicar ================= */

/** Publica los borradores de la semana y avisa por correo (fire-and-forget) a quien tenga email.
    data.correos = cuántos correos se mandan (0 si no hay RESEND_API_KEY o nadie tiene email). */
export async function publicarSemanaPlan(centroId: string, desde: string, hasta: string): Promise<R<{ publicados: number; correos: number }>> {
  const { sb } = await cliente();
  const { data: publicados, error } = await sb
    .from("rrhh_turnos")
    .update({ estado: "publicado", publicado_at: new Date().toISOString() })
    .eq("centro_id", centroId)
    .eq("estado", "borrador")
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .select("empleado_id");
  if (error) return { ok: false, error: error.message };

  const afectados = [...new Set((publicados ?? []).map((t) => t.empleado_id).filter(Boolean) as string[])];
  let nCorreos = 0;
  if (afectados.length && process.env.RESEND_API_KEY) {
    // Se consulta ahora (con la sesión viva) y se envía después de responder.
    const [{ data: emps }, { data: turnos }, { data: centro }] = await Promise.all([
      sb.from("empleados").select("id, nombre, email").in("id", afectados).not("email", "is", null),
      sb
        .from("rrhh_turnos")
        .select("empleado_id, fecha, hora_inicio, hora_fin, pausa_min, puesto")
        .eq("centro_id", centroId)
        .eq("estado", "publicado")
        .in("empleado_id", afectados)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha")
        .order("hora_inicio"),
      sb.from("centros").select("nombre").eq("id", centroId).maybeSingle(),
    ]);
    const nombreCentro = centro?.nombre ?? "";
    const correos = (emps ?? [])
      .filter((e) => e.email && e.email.includes("@"))
      .map((e) => {
        const suyos = (turnos ?? []).filter((t) => t.empleado_id === e.id);
        const filas = suyos
          .map(
            (t) =>
              `<tr><td style="padding:4px 10px 4px 0">${DIAS[(new Date(t.fecha + "T12:00").getDay() + 6) % 7]} ${fmtDdMm(t.fecha)}</td>` +
              `<td style="padding:4px 10px 4px 0"><b>${hhmm(t.hora_inicio)}–${hhmm(t.hora_fin)}</b>${t.pausa_min ? ` (pausa ${Number(t.pausa_min)} min)` : ""}</td>` +
              `<td style="padding:4px 0">${esc(t.puesto)}</td></tr>`,
          )
          .join("");
        return {
          para: e.email as string,
          asunto: `Tu horario de la semana del ${fmtDdMm(desde)}`,
          html:
            `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1a1a1a">` +
            `<p>Hola ${esc(e.nombre)},</p>` +
            `<p>Ya está publicado tu horario${nombreCentro ? ` en ${esc(nombreCentro)}` : ""} para la semana del ${fmtDdMm(desde)} al ${fmtDdMm(hasta)}:</p>` +
            `<table style="border-collapse:collapse">${filas || "<tr><td>Sin turnos esta semana.</td></tr>"}</table>` +
            `<p style="color:#888;font-size:12px">Puedes verlo siempre actualizado en la app del empleado.</p></div>`,
        };
      });
    nCorreos = correos.length;
    after(async () => {
      await Promise.allSettled(correos.map((c) => enviarCorreo(c)));
    });
  }
  return { ok: true, data: { publicados: (publicados ?? []).length, correos: nCorreos } };
}

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
