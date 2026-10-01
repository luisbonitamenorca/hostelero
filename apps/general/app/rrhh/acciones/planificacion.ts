"use server";

/* Acciones de servidor de la sección Planificación (v2).
   Mismo patrón que ../acciones.ts: cliente autenticado, la RLS decide. */

import { after } from "next/server";
import type { Tables } from "@hostelero/db";
import { exigirModulo } from "@/lib/supabase/server";
import { enviarCorreo } from "@/lib/correo";
import type { Ausencia, Convenio, Empleado, Turno } from "../tipos";

async function cliente() {
  const { supabase, perfil } = await exigirModulo("rrhh");
  return { sb: supabase, perfil };
}

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

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

  const [config, emps, nAsignaciones, periodos, turnos, ausencias, puestos, plantillas, modelos, festivos, centros] = await Promise.all([
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
  ]);

  const fallo = [config, emps, nAsignaciones, periodos, turnos, ausencias].find((q) => q.error)?.error;
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
  const [ajenosQ, conPeriodoQ] = await Promise.all([
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
  ]);
  const tienePeriodo = new Set((conPeriodoQ.data ?? []).map((p) => p.empleado_id));

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

  const todos = (turnos.data ?? []) as Turno[];
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
    // .select("id"): si la RLS no deja ver el turno, el update no toca nada y hay que decirlo.
    const { data, error } = await sb.from("rrhh_turnos").update(fila).eq("id", turnoId).select("id");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, error: "No tienes permiso sobre este turno" };
    return { ok: true, data: turnoId };
  }
  const { data, error } = await sb.from("rrhh_turnos").insert({ ...fila, creado_por: perfil.id }).select("id").single();
  return error || !data ? { ok: false, error: error?.message } : { ok: true, data: data.id };
}

/** Mueve un turno a otra celda (empleado y/o fecha). empleado_id null = sin asignar. */
export async function moverTurno(turnoId: string, destino: { empleado_id: string | null; fecha: string }): Promise<R> {
  const { sb } = await cliente();
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

export async function borrarTurnos(ids: string[]): Promise<R<number>> {
  const { sb } = await cliente();
  if (!ids.length) return { ok: true, data: 0 };
  // Devuelve los borrados de verdad (la RLS puede dejar fuera alguno).
  const { data, error } = await sb.from("rrhh_turnos").delete().in("id", ids).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "No tienes permiso sobre estos turnos" };
  return { ok: true, data: data.length };
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
  const { error: e2 } = await sb.from("rrhh_turnos").insert(nuevos);
  return e2 ? { ok: false, error: e2.message } : { ok: true, data: nuevos.length };
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
  const { error: e2 } = await sb.from("rrhh_turnos").insert(nuevos);
  return e2 ? { ok: false, error: e2.message } : { ok: true, data: nuevos.length };
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
