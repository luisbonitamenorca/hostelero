"use server";

import { createHash, randomBytes } from "node:crypto";
import { exigirModulo } from "@/lib/supabase/server";
import type { Ausencia, CentroConfig, CentroMin, Convenio, Dispositivo, Empleado, Fichaje, Periodo, Turno } from "./tipos";

// Todo el acceso a datos del panel pasa por aquí con el cliente autenticado:
// la RLS de tres niveles decide (gestor todo · encargado sus centros · empleado lo suyo).
async function cliente() {
  const { supabase, perfil } = await exigirModulo("rrhh");
  return { sb: supabase, perfil };
}

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

/* ================= Contexto ================= */

export async function contexto() {
  const { sb, perfil } = await cliente();
  const { data: esGestor } = await sb.rpc("rrhh_es_gestor");
  let centros: CentroMin[] = [];
  if (esGestor) {
    const { data } = await sb.from("centros").select("id, nombre").order("nombre");
    centros = data ?? [];
  } else {
    const { data } = await sb.from("rrhh_encargados_centro").select("centros(id, nombre)").eq("user_id", perfil.id);
    centros = (data ?? []).map((r) => r.centros).filter(Boolean) as CentroMin[];
    centros.sort((a, b) => a.nombre.localeCompare(b.nombre));
  }
  return { esGestor: !!esGestor, centros, userId: perfil.id };
}

/* ================= Planificación ================= */

export async function cargarSemana(centroId: string, desde: string, hasta: string) {
  const { sb } = await cliente();
  const [config, emps, turnos, ausencias, periodos] = await Promise.all([
    sb.from("rrhh_centros_config").select("*, rrhh_convenios(*)").eq("centro_id", centroId).maybeSingle(),
    sb
      .from("rrhh_asignaciones")
      .select("empleado_id, empleados!inner(id, nombre, apellidos, fecha_baja, departamento)")
      .eq("centro_id", centroId)
      .or(`fecha_fin.is.null,fecha_fin.gte.${desde}`),
    sb.from("rrhh_turnos").select("*").eq("centro_id", centroId).gte("fecha", desde).lte("fecha", hasta),
    sb.from("rrhh_ausencias").select("*").eq("estado", "aprobada").lte("fecha_inicio", hasta).gte("fecha_fin", desde),
    sb
      .from("rrhh_periodos_contrato")
      .select("empleado_id, fecha_alta, horas_semana")
      .lte("fecha_alta", hasta)
      .or(`fecha_baja.is.null,fecha_baja.gte.${desde}`),
  ]);

  const horasPorEmp: Record<string, { fecha_alta: string; horas: number | null }> = {};
  for (const p of periodos.data ?? []) {
    const prev = horasPorEmp[p.empleado_id];
    if (!prev || p.fecha_alta > prev.fecha_alta) horasPorEmp[p.empleado_id] = { fecha_alta: p.fecha_alta, horas: p.horas_semana };
  }
  const activos = new Set(Object.keys(horasPorEmp));
  const vistos = new Set<string>();
  const empleados = (emps.data ?? [])
    .map((r) => r.empleados as unknown as Empleado)
    .filter((e) => e && activos.has(e.id) && !vistos.has(e.id) && !!vistos.add(e.id))
    .map((e) => ({ ...e, horas_vigentes: horasPorEmp[e.id]?.horas ?? null }))
    .sort(
      (a, b) =>
        (a.departamento || "zz").localeCompare(b.departamento || "zz") || a.nombre.localeCompare(b.nombre),
    );

  return {
    reglas: (config.data?.rrhh_convenios as Convenio | null) ?? null,
    pacto10h: config.data?.pacto_descanso_10h ?? false,
    empleados,
    turnos: (turnos.data ?? []) as Turno[],
    ausencias: (ausencias.data ?? []) as Ausencia[],
  };
}

export async function guardarTurno(
  turnoId: string | null,
  fila: {
    empleado_id: string;
    centro_id: string;
    fecha: string;
    hora_inicio: string;
    hora_fin: string;
    pausa_min: number;
    puesto: string | null;
  },
): Promise<R> {
  const { sb, perfil } = await cliente();
  const { error } = turnoId
    ? await sb.from("rrhh_turnos").update(fila).eq("id", turnoId)
    : await sb.from("rrhh_turnos").insert({ ...fila, creado_por: perfil.id });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function borrarTurno(turnoId: string): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb.from("rrhh_turnos").delete().eq("id", turnoId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function publicarSemana(centroId: string, desde: string, hasta: string): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb
    .from("rrhh_turnos")
    .update({ estado: "publicado", publicado_at: new Date().toISOString() })
    .eq("centro_id", centroId)
    .eq("estado", "borrador")
    .gte("fecha", desde)
    .lte("fecha", hasta);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function copiarSemanaAnterior(centroId: string, lunes: string, empleadosActivos: string[]): Promise<R<number>> {
  const { sb, perfil } = await cliente();
  const desde = new Date(lunes + "T12:00");
  desde.setDate(desde.getDate() - 7);
  const hasta = new Date(lunes + "T12:00");
  hasta.setDate(hasta.getDate() - 1);
  const iso = (d: Date) => d.toLocaleDateString("sv-SE");
  const { data: previos, error } = await sb
    .from("rrhh_turnos")
    .select("*")
    .eq("centro_id", centroId)
    .gte("fecha", iso(desde))
    .lte("fecha", iso(hasta));
  if (error) return { ok: false, error: error.message };
  if (!previos?.length) return { ok: false, error: "La semana anterior está vacía" };
  const activos = new Set(empleadosActivos);
  const nuevos = previos
    .filter((t) => activos.has(t.empleado_id))
    .map((t) => {
      const f = new Date(t.fecha + "T12:00");
      f.setDate(f.getDate() + 7);
      return {
        empleado_id: t.empleado_id,
        centro_id: t.centro_id,
        fecha: iso(f),
        hora_inicio: t.hora_inicio,
        hora_fin: t.hora_fin,
        pausa_min: t.pausa_min,
        puesto: t.puesto,
        estado: "borrador" as const,
        creado_por: perfil.id,
      };
    });
  const { error: e2 } = await sb.from("rrhh_turnos").insert(nuevos);
  return e2 ? { ok: false, error: e2.message } : { ok: true, data: nuevos.length };
}

/* ================= Fichajes ================= */

export async function fichajesDia(centroId: string, fecha: string) {
  const { sb } = await cliente();
  const ini = new Date(fecha + "T00:00").toISOString();
  const finD = new Date(fecha + "T00:00");
  finD.setDate(finD.getDate() + 1);
  const [emps, fichs] = await Promise.all([
    sb
      .from("rrhh_asignaciones")
      .select("empleados!inner(id, nombre, apellidos, fecha_baja)")
      .eq("centro_id", centroId)
      .or(`fecha_fin.is.null,fecha_fin.gte.${fecha}`),
    sb.from("rrhh_fichajes").select("*").eq("centro_id", centroId).gte("ts", ini).lt("ts", finD.toISOString()).order("ts"),
  ]);
  const vistos = new Set<string>();
  const empleados = (emps.data ?? [])
    .map((r) => r.empleados as unknown as Empleado)
    .filter((e) => e && !e.fecha_baja && !vistos.has(e.id) && !!vistos.add(e.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  return { empleados, fichajes: (fichs.data ?? []) as Fichaje[] };
}

export async function corregirFichaje(fila: {
  empleado_id: string;
  centro_id: string;
  tipo: string;
  ts: string;
  corrige_a: string | null;
  motivo_correccion: string;
}): Promise<R> {
  const { sb, perfil } = await cliente();
  if (!fila.motivo_correccion.trim()) return { ok: false, error: "El motivo es obligatorio" };
  // Append-only: la corrección es un insert que anula al original, nunca un update.
  const { error } = await sb.from("rrhh_fichajes").insert({
    ...fila,
    tipo: fila.tipo as Fichaje["tipo"],
    metodo: "correccion",
    corregido_por: perfil.id,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ================= Informes ================= */

export async function datosInforme(centroId: string, desde: string, hasta: string) {
  const { sb } = await cliente();
  const finTs = new Date(hasta + "T00:00");
  finTs.setDate(finTs.getDate() + 1);
  const [emps, turnos, fichs] = await Promise.all([
    sb.from("empleados").select("id, nombre, apellidos"),
    sb.from("rrhh_turnos").select("*").eq("centro_id", centroId).eq("estado", "publicado").gte("fecha", desde).lte("fecha", hasta),
    sb
      .from("rrhh_fichajes")
      .select("*")
      .eq("centro_id", centroId)
      .gte("ts", new Date(desde + "T00:00").toISOString())
      .lt("ts", finTs.toISOString())
      .order("ts"),
  ]);
  return {
    empleados: emps.data ?? [],
    turnos: (turnos.data ?? []) as Turno[],
    fichajes: (fichs.data ?? []) as Fichaje[],
  };
}

/* ================= Empleados ================= */

export async function cargarMaestros() {
  const { sb } = await cliente();
  const [centros, deptos, contratos, matriz] = await Promise.all([
    sb.from("centros").select("id, nombre").order("nombre"),
    sb.from("departamentos").select("id, nombre").eq("activo", true).order("orden"),
    sb.from("rrhh_tipos_contrato").select("nombre").eq("activo", true).order("orden"),
    sb.from("centros_departamentos").select("centro_id, departamentos(nombre)"),
  ]);
  const deptosPorCentro: Record<string, string[]> = {};
  for (const r of matriz.data ?? []) {
    const n = (r.departamentos as { nombre: string } | null)?.nombre;
    if (n) (deptosPorCentro[r.centro_id] = deptosPorCentro[r.centro_id] || []).push(n);
  }
  return {
    centros: centros.data ?? [],
    departamentos: (deptos.data ?? []).map((d) => d.nombre),
    contratos: (contratos.data ?? []).map((c) => c.nombre),
    deptosPorCentro,
  };
}

export async function cargarEmpleados() {
  const { sb } = await cliente();
  const hoy = new Date().toLocaleDateString("sv-SE");
  const [emps, asigs, pers] = await Promise.all([
    sb.from("empleados").select("*").order("nombre"),
    sb.from("rrhh_asignaciones").select("empleado_id, centro_id"),
    sb.from("rrhh_periodos_contrato").select("empleado_id, fecha_alta, fecha_baja"),
  ]);
  const activos = new Set<string>();
  for (const p of pers.data ?? []) if (p.fecha_alta <= hoy && (!p.fecha_baja || p.fecha_baja >= hoy)) activos.add(p.empleado_id);
  const asignaciones: Record<string, string[]> = {};
  for (const a of asigs.data ?? []) (asignaciones[a.empleado_id] = asignaciones[a.empleado_id] || []).push(a.centro_id);
  return {
    empleados: ((emps.data ?? []) as Empleado[]).map((e) => ({ ...e, _activo: activos.has(e.id) })),
    asignaciones,
  };
}

export async function guardarEmpleado(
  id: string,
  campos: {
    nombre: string;
    apellidos: string | null;
    email: string | null;
    telefono: string | null;
    centro_principal_id: string;
    tipo_contrato: string | null;
    departamento: string | null;
    fichaje_movil: boolean;
  },
  centrosAsignados: string[],
): Promise<R> {
  const { sb } = await cliente();
  // departamento_id se mantiene sincronizado con el texto casando contra el maestro
  let departamento_id: string | null = null;
  if (campos.departamento) {
    const { data: d } = await sb.from("departamentos").select("id").ilike("nombre", campos.departamento).maybeSingle();
    departamento_id = d?.id ?? null;
  }
  const { error } = await sb.from("empleados").update({ ...campos, departamento_id }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (!centrosAsignados.includes(campos.centro_principal_id)) {
    await sb.from("rrhh_asignaciones").insert({ empleado_id: id, centro_id: campos.centro_principal_id });
  }
  return { ok: true };
}

export async function altaEmpleado(input: {
  nombre: string;
  apellidos: string;
  centroId: string;
  horasSemana: number | null;
}): Promise<R<string>> {
  const { sb } = await cliente();
  const hoy = new Date().toLocaleDateString("sv-SE");
  const { data, error } = await sb
    .from("empleados")
    .insert({
      nombre: input.nombre,
      apellidos: input.apellidos || null,
      centro_principal_id: input.centroId,
      fecha_alta: hoy,
      horas_semana: input.horasSemana,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message };
  await sb.from("rrhh_asignaciones").insert({ empleado_id: data.id, centro_id: input.centroId });
  await sb.from("rrhh_periodos_contrato").insert({ empleado_id: data.id, fecha_alta: hoy, horas_semana: input.horasSemana });
  return { ok: true, data: data.id };
}

export async function periodosDe(empleadoId: string): Promise<Periodo[]> {
  const { sb } = await cliente();
  const { data } = await sb
    .from("rrhh_periodos_contrato")
    .select("*")
    .eq("empleado_id", empleadoId)
    .order("fecha_alta", { ascending: false });
  return (data ?? []) as Periodo[];
}

async function sincronizarEmpleadoTrasPeriodo(sb: Awaited<ReturnType<typeof cliente>>["sb"], empleadoId: string) {
  const { data } = await sb
    .from("rrhh_periodos_contrato")
    .select("fecha_alta, fecha_baja, horas_semana")
    .eq("empleado_id", empleadoId)
    .order("fecha_alta", { ascending: false })
    .limit(1);
  const ult = data?.[0];
  if (ult) {
    await sb
      .from("empleados")
      .update({ fecha_alta: ult.fecha_alta, fecha_baja: ult.fecha_baja, horas_semana: ult.horas_semana })
      .eq("id", empleadoId);
  }
}

export async function guardarPeriodo(
  periodoId: string | null,
  empleadoId: string,
  fila: { fecha_alta: string; fecha_baja: string | null; horas_semana: number | null },
): Promise<R> {
  const { sb } = await cliente();
  if (fila.fecha_baja && fila.fecha_baja < fila.fecha_alta) return { ok: false, error: "La baja no puede ser anterior al alta" };
  const { error } = periodoId
    ? await sb.from("rrhh_periodos_contrato").update(fila).eq("id", periodoId)
    : await sb.from("rrhh_periodos_contrato").insert({ ...fila, empleado_id: empleadoId });
  if (error) return { ok: false, error: error.message };
  await sincronizarEmpleadoTrasPeriodo(sb, empleadoId);
  return { ok: true };
}

export async function borrarPeriodo(periodoId: string, empleadoId: string): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb.from("rrhh_periodos_contrato").delete().eq("id", periodoId);
  if (error) return { ok: false, error: error.message };
  await sincronizarEmpleadoTrasPeriodo(sb, empleadoId);
  return { ok: true };
}

export async function historicoFichajes(empleadoId: string): Promise<Fichaje[]> {
  const { sb } = await cliente();
  const desde = new Date();
  desde.setDate(desde.getDate() - 14);
  desde.setHours(0, 0, 0, 0);
  const { data } = await sb
    .from("rrhh_fichajes")
    .select("*")
    .eq("empleado_id", empleadoId)
    .gte("ts", desde.toISOString())
    .order("ts");
  return (data ?? []) as Fichaje[];
}

/* ================= Ausencias ================= */

export async function listarAusencias(): Promise<Ausencia[]> {
  const { sb } = await cliente();
  const { data } = await sb
    .from("rrhh_ausencias")
    .select("*, empleados(nombre, apellidos)")
    .order("creado_en", { ascending: false })
    .limit(200);
  return (data ?? []) as unknown as Ausencia[];
}

export async function crearAusencia(input: {
  empleadoId: string;
  tipo: string;
  desde: string;
  hasta: string;
  estado: "solicitada" | "aprobada";
}): Promise<R> {
  const { sb, perfil } = await cliente();
  if (input.hasta < input.desde) return { ok: false, error: "El fin no puede ser anterior al inicio" };
  const { error } = await sb.from("rrhh_ausencias").insert({
    empleado_id: input.empleadoId,
    tipo: input.tipo as Ausencia["tipo"],
    fecha_inicio: input.desde,
    fecha_fin: input.hasta,
    estado: input.estado,
    solicitada_por: perfil.id,
    ...(input.estado === "aprobada" ? { resuelta_por: perfil.id } : {}),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function resolverAusencia(id: string, estado: "aprobada" | "rechazada"): Promise<R> {
  const { sb, perfil } = await cliente();
  const { error } = await sb.from("rrhh_ausencias").update({ estado, resuelta_por: perfil.id }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ================= Dispositivos ================= */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function listarDispositivos(): Promise<Dispositivo[]> {
  const { sb } = await cliente();
  const { data } = await sb.from("rrhh_dispositivos").select("*, centros(nombre)").order("nombre");
  return (data ?? []) as unknown as Dispositivo[];
}

/** Crea una tablet y devuelve su token UNA sola vez (solo se guarda el hash). */
export async function crearDispositivo(centroId: string, nombre: string): Promise<R<string>> {
  const { sb } = await cliente();
  const token = randomBytes(16).toString("hex");
  const { error } = await sb.from("rrhh_dispositivos").insert({
    centro_id: centroId,
    nombre,
    token_hash: sha256(token),
    activo: true,
  });
  return error ? { ok: false, error: error.message } : { ok: true, data: token };
}

/** Regenera el token de una tablet existente (el anterior deja de funcionar). */
export async function regenerarToken(dispositivoId: string): Promise<R<string>> {
  const { sb } = await cliente();
  const token = randomBytes(16).toString("hex");
  const { error } = await sb.from("rrhh_dispositivos").update({ token_hash: sha256(token) }).eq("id", dispositivoId);
  return error ? { ok: false, error: error.message } : { ok: true, data: token };
}

export async function toggleDispositivo(dispositivoId: string, activo: boolean): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb.from("rrhh_dispositivos").update({ activo }).eq("id", dispositivoId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ================= Ajustes ================= */

export async function cargarAjustes() {
  const { sb } = await cliente();
  const [convenios, centros, config, tiposAus, deptos, contratos, matriz] = await Promise.all([
    sb.from("rrhh_convenios").select("*").order("nombre"),
    sb.from("centros").select("id, nombre, lat, lng").order("nombre"),
    sb.from("rrhh_centros_config").select("*"),
    sb.from("rrhh_tipos_ausencia").select("*").order("orden"),
    sb.from("departamentos").select("*").order("orden"),
    sb.from("rrhh_tipos_contrato").select("*").order("orden"),
    sb.from("centros_departamentos").select("centro_id, departamento_id"),
  ]);
  return {
    convenios: (convenios.data ?? []) as Convenio[],
    centros: centros.data ?? [],
    config: (config.data ?? []) as CentroConfig[],
    tiposAusencia: tiposAus.data ?? [],
    departamentos: deptos.data ?? [],
    tiposContrato: contratos.data ?? [],
    matriz: matriz.data ?? [],
  };
}

export async function guardarConvenio(id: string, campos: Partial<Convenio>): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb.from("rrhh_convenios").update(campos).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function guardarCentroConfig(
  centroId: string,
  campos: { radio_fichaje_m?: number; convenio_id?: string; pacto_descanso_10h?: boolean },
  geo?: { lat: number | null; lng: number | null },
): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb.from("rrhh_centros_config").update(campos).eq("centro_id", centroId);
  if (error) return { ok: false, error: error.message };
  if (geo) {
    const { error: e2 } = await sb.from("centros").update(geo).eq("id", centroId);
    if (e2) return { ok: false, error: e2.message };
  }
  return { ok: true };
}

export async function guardarCatalogo(
  tabla: "rrhh_tipos_ausencia" | "rrhh_tipos_contrato" | "departamentos",
  id: string,
  campos: { activo?: boolean; computa_vacaciones?: boolean; solicitable_empleado?: boolean; nombre?: string },
): Promise<R> {
  const { sb } = await cliente();
  // El union de tablas rechaza propiedades sobrantes: se separa por rama.
  const { error } =
    tabla === "rrhh_tipos_ausencia"
      ? await sb.from("rrhh_tipos_ausencia").update(campos).eq("id", id)
      : tabla === "rrhh_tipos_contrato"
        ? await sb.from("rrhh_tipos_contrato").update({ activo: campos.activo, nombre: campos.nombre }).eq("id", id)
        : await sb.from("departamentos").update({ activo: campos.activo, nombre: campos.nombre }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function anadirCatalogo(
  tabla: "rrhh_tipos_ausencia" | "rrhh_tipos_contrato" | "departamentos",
  nombre: string,
): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb.from(tabla).insert({ nombre, orden: 200 });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function borrarCatalogo(
  tabla: "rrhh_tipos_contrato" | "departamentos",
  id: string,
): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb.from(tabla).delete().eq("id", id);
  return error ? { ok: false, error: "No se pudo quitar (puede estar en uso). Desactívalo en su lugar." } : { ok: true };
}

export async function toggleMatriz(centroId: string, departamentoId: string, activo: boolean): Promise<R> {
  const { sb } = await cliente();
  const { error } = activo
    ? await sb.from("centros_departamentos").insert({ centro_id: centroId, departamento_id: departamentoId })
    : await sb.from("centros_departamentos").delete().eq("centro_id", centroId).eq("departamento_id", departamentoId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
