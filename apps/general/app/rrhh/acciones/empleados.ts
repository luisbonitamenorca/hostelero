"use server";

/* Acciones de servidor de la sección Empleados (plan 2.7).
   Todo pasa por el cliente autenticado: la RLS decide (gestor todo · encargado sus centros · empleado lo suyo).
   Las escrituras exigen además rrhh_es_gestor() en servidor: la ficha solo deja escribir a gestores y la RLS de
   asignaciones permitiría a un encargado abrir/cerrar centros (incluido el principal) saltándose la ficha.
   borrarPeriodo de ../acciones.ts se sigue reutilizando desde el cliente. */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables } from "@hostelero/db";
import type { Fichaje, Periodo } from "../tipos";

async function cliente() {
  const { supabase, perfil } = await exigirModulo("rrhh");
  return { sb: supabase, perfil };
}

type Sb = Awaited<ReturnType<typeof cliente>>["sb"];
type R<T = undefined> = { ok: boolean; error?: string; data?: T };

/** Gestor (dirección/administración/jefe de sala). Un encargado ve, pero no escribe desde aquí. */
async function esGestor(sb: Sb): Promise<boolean> {
  const { data } = await sb.rpc("rrhh_es_gestor");
  return data === true;
}
const SOLO_GESTOR = "Solo un gestor de RRHH puede hacer esto";
const SOLO_DIRECCION = "El coste por hora solo lo ve y lo cambia dirección";

/** Dato salarial: solo dirección. La RLS de rrhh_coste_hora ya devuelve vacío a los demás; esto evita
    hasta la consulta y deja claro en la UI que no hay nada que enseñar. */
const esDireccion = (perfil: { rol: string }) => perfil.rol === "direccion";

/** ¿El usuario actual es dirección? Las secciones lo usan para no pintar nada de coste a otros roles. */
export async function soyDireccion(): Promise<boolean> {
  const { perfil } = await cliente();
  return esDireccion(perfil);
}

/* ================= Tipos ================= */

/** Ficha sin pin_hash, dni_ultimos ni user_id: al navegador solo va si tiene PIN. */
export type EmpleadoFila = Omit<Tables<"empleados">, "pin_hash" | "dni_ultimos" | "user_id"> & { tiene_pin: boolean };
export type Asignacion = Tables<"rrhh_asignaciones">;
export type PeriodoFila = Tables<"rrhh_periodos_contrato">;
export type PuestoCat = Pick<Tables<"rrhh_puestos_cat">, "id" | "nombre" | "departamento_id" | "color" | "activo">;
export type EstadoEmp = "activo" | "inactivo" | "baja";
/** Precio por hora medio (Skello) con fecha «desde». Solo dirección. */
export type CosteHora = Tables<"rrhh_coste_hora">;
export type EmpleadoLista = EmpleadoFila & {
  /** activo = periodo vigente hoy · inactivo = fijo-discontinuo entre temporadas (o periodo futuro) · baja = contrato terminado */
  _estado: EstadoEmp;
  /** Último día trabajado (inactivo/baja) o inicio del periodo vigente (activo). */
  _desde: string | null;
  /** Si está inactivo con un periodo ya registrado que aún no ha empezado: primer día de ese periodo. */
  _vuelve: string | null;
  /** Horas/semana del periodo vigente (o del último). */
  _horas: number | null;
  _centros: string[];
};
export type SaldoVacaciones = {
  derecho_anual: number;
  devengado_hoy: number;
  disfrutados: number;
  pendientes_aprobar: number;
  resto: number;
};

/** Hoy en Europe/Madrid (el servidor va en UTC: entre las 00:00 y las 02:00 «hoy» sería ayer). */
const hoyIso = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
const esFecha = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const ddmmaaaa = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// Un solo literal: supabase-js solo infiere las columnas si el select es un literal de tipo
const COLS_EMPLEADO =
  "id, cuenta_id, nombre, apellidos, email, telefono, centro_principal_id, departamento, departamento_id, puesto_defecto_id, tipo_contrato, codigo_nomina, fecha_nacimiento, nota, fichaje_movil, horas_semana, fecha_alta, fecha_baja, contador_inicial_h, contador_inicial_fecha, vacaciones_ajuste_dias, area_funcional, creado_en, pin_hash" as const;

/* ================= Maestros ================= */

/** Centros, departamentos (con id), tipos de contrato, matriz centro↔departamento y catálogo de puestos. */
export async function cargarMaestrosEmp() {
  const { sb } = await cliente();
  const [centros, deptos, contratos, matriz, puestos] = await Promise.all([
    sb.from("centros").select("id, nombre").order("nombre"),
    sb.from("departamentos").select("id, nombre").eq("activo", true).order("orden"),
    sb.from("rrhh_tipos_contrato").select("nombre").eq("activo", true).order("orden"),
    sb.from("centros_departamentos").select("centro_id, departamentos(nombre)"),
    sb.from("rrhh_puestos_cat").select("id, nombre, departamento_id, color, activo").order("orden").order("nombre"),
  ]);
  const deptosPorCentro: Record<string, string[]> = {};
  for (const r of matriz.data ?? []) {
    const n = (r.departamentos as { nombre: string } | null)?.nombre;
    if (n) (deptosPorCentro[r.centro_id] = deptosPorCentro[r.centro_id] || []).push(n);
  }
  return {
    centros: (centros.data ?? []) as { id: string; nombre: string }[],
    departamentos: (deptos.data ?? []) as { id: string; nombre: string }[],
    contratos: (contratos.data ?? []).map((c) => c.nombre),
    deptosPorCentro,
    puestos: (puestos.data ?? []) as PuestoCat[],
  };
}

/* ================= Lista ================= */

/** Todos los empleados visibles con su estado calculado y sus centros. Tres consultas, sin N+1. */
export async function cargarEmpleadosV2() {
  const { sb } = await cliente();
  const hoy = hoyIso();
  const [emps, asigs, pers] = await Promise.all([
    sb.from("empleados").select(COLS_EMPLEADO).order("apellidos").order("nombre").limit(10000),
    sb.from("rrhh_asignaciones").select("*").limit(10000),
    sb.from("rrhh_periodos_contrato").select("empleado_id, fecha_alta, fecha_baja, horas_semana").limit(10000),
  ]);

  const periodos: Record<string, { fecha_alta: string; fecha_baja: string | null; horas_semana: number | null }[]> = {};
  for (const p of pers.data ?? []) (periodos[p.empleado_id] = periodos[p.empleado_id] || []).push(p);
  const asignaciones: Record<string, Asignacion[]> = {};
  for (const a of asigs.data ?? []) (asignaciones[a.empleado_id] = asignaciones[a.empleado_id] || []).push(a);

  const empleados: EmpleadoLista[] = (emps.data ?? []).map((fila) => {
    const { pin_hash, ...resto } = fila;
    const e: EmpleadoFila = { ...resto, tiene_pin: !!pin_hash };
    const ps = periodos[e.id] ?? [];
    const vigente = ps.find((p) => p.fecha_alta <= hoy && (!p.fecha_baja || p.fecha_baja >= hoy));
    const futuros = ps.filter((p) => p.fecha_alta > hoy);
    const vuelve = futuros.length ? futuros.reduce((m, p) => (p.fecha_alta < m.fecha_alta ? p : m)).fecha_alta : null;
    // Último periodo ya terminado (el de mayor fecha_baja pasada): de ahí sale el «último día trabajado»
    const pasados = ps.filter((p) => p.fecha_baja && p.fecha_baja < hoy);
    const ultimoPasado = pasados.length ? pasados.reduce((m, p) => (p.fecha_baja! > m.fecha_baja! ? p : m)) : null;
    // Horas de referencia: el más reciente por alta, igual que empleados.horas_semana (sincronizado)
    const ultimo = ps.length ? ps.reduce((m, p) => (p.fecha_alta > m.fecha_alta ? p : m)) : null;
    const fijoDisc = /discontinu/i.test(e.tipo_contrato ?? "");
    let estado: EstadoEmp;
    let desde: string | null;
    if (vigente) {
      estado = "activo";
      desde = vigente.fecha_alta;
    } else if (!ps.length && !e.fecha_baja && (!e.fecha_alta || e.fecha_alta <= hoy)) {
      // Sin periodos registrados y sin baja: lo tratamos como activo
      estado = "activo";
      desde = e.fecha_alta ?? null;
    } else if (fijoDisc || futuros.length) {
      estado = "inactivo";
      desde = ultimoPasado?.fecha_baja ?? (e.fecha_baja && e.fecha_baja < hoy ? e.fecha_baja : null);
    } else {
      estado = "baja";
      desde = ultimoPasado?.fecha_baja ?? (e.fecha_baja && e.fecha_baja < hoy ? e.fecha_baja : null);
    }
    const centros = [
      ...new Set(
        (asignaciones[e.id] ?? [])
          .filter((a) => (!a.fecha_inicio || a.fecha_inicio <= hoy) && (!a.fecha_fin || a.fecha_fin >= hoy))
          .map((a) => a.centro_id),
      ),
    ];
    return {
      ...e,
      _estado: estado,
      _desde: desde,
      _vuelve: estado === "inactivo" ? vuelve : null,
      _horas: vigente?.horas_semana ?? ultimo?.horas_semana ?? e.horas_semana ?? null,
      _centros: centros,
    };
  });

  return { empleados, asignaciones };
}

/* ================= Ficha ================= */

/** Todo lo que necesita la ficha en una sola ida: periodos, centros, saldos y fichajes de 14 días. */
export async function cargarFicha(empleadoId: string) {
  const { sb, perfil } = await cliente();
  const hoy = hoyIso();
  const anio = Number(hoy.slice(0, 4));
  const desde = new Date();
  desde.setDate(desde.getDate() - 14);
  desde.setHours(0, 0, 0, 0);
  const direccion = esDireccion(perfil);
  const [periodos, asigs, saldoH, saldoV, historial, coste] = await Promise.all([
    sb.from("rrhh_periodos_contrato").select("*").eq("empleado_id", empleadoId).order("fecha_alta", { ascending: false }),
    sb.from("rrhh_asignaciones").select("*").eq("empleado_id", empleadoId).order("fecha_inicio", { ascending: false }),
    sb.rpc("rrhh_saldo_horas", { p_empleado_id: empleadoId, p_hasta: hoy }),
    sb.rpc("rrhh_saldo_vacaciones", { p_empleado_id: empleadoId, p_anio: anio }),
    sb.from("rrhh_fichajes").select("*").eq("empleado_id", empleadoId).gte("ts", desde.toISOString()).order("ts"),
    // Dato salarial: ni se consulta si no es dirección (la RLS devolvería vacío igualmente).
    direccion
      ? sb.from("rrhh_coste_hora").select("*").eq("empleado_id", empleadoId).order("desde", { ascending: false })
      : Promise.resolve({ data: null as CosteHora[] | null }),
  ]);
  const v = Array.isArray(saldoV.data) ? saldoV.data[0] : null;
  return {
    periodos: (periodos.data ?? []) as Periodo[],
    asignaciones: (asigs.data ?? []) as Asignacion[],
    saldoHoras: saldoH.error || saldoH.data == null ? null : Number(saldoH.data),
    saldoVacaciones: v ? ({ ...v } as SaldoVacaciones) : null,
    historial: (historial.data ?? []) as Fichaje[],
    /** null = no es dirección (no se enseña nada de coste). */
    costeHora: direccion ? ((coste.data ?? []) as CosteHora[]).map((c) => ({ ...c, coste_hora: Number(c.coste_hora) })) : null,
  };
}

/* ================= Coste por hora (solo dirección) ================= */

/** Alta o edición de un tramo de coste/hora. La clave (empleado, desde) es única: un día, un precio. */
export async function guardarCosteHora(
  id: string | null,
  empleadoId: string,
  fila: { desde: string; coste_hora: number; nota: string | null },
): Promise<R<CosteHora>> {
  const { sb, perfil } = await cliente();
  if (!esDireccion(perfil)) return { ok: false, error: SOLO_DIRECCION };
  if (!esFecha(fila.desde)) return { ok: false, error: "Indica desde cuándo aplica" };
  const coste = Number(fila.coste_hora);
  if (!Number.isFinite(coste) || coste < 0 || coste > 500) return { ok: false, error: "El coste por hora no es razonable (0 a 500 €)" };
  const datos = { desde: fila.desde, coste_hora: Math.round(coste * 10000) / 10000, nota: fila.nota?.trim() || null };
  const { data, error } = id
    ? await sb.from("rrhh_coste_hora").update(datos).eq("id", id).select("*").single()
    : await sb.from("rrhh_coste_hora").insert({ ...datos, empleado_id: empleadoId, creado_por: perfil.id }).select("*").single();
  if (error || !data) {
    return { ok: false, error: error?.code === "23505" ? `Ya hay un coste con fecha ${ddmmaaaa(fila.desde)}: edítalo en vez de añadir otro` : error?.message ?? "No se pudo guardar" };
  }
  return { ok: true, data: { ...data, coste_hora: Number(data.coste_hora) } as CosteHora };
}

export async function borrarCosteHora(id: string): Promise<R> {
  const { sb, perfil } = await cliente();
  if (!esDireccion(perfil)) return { ok: false, error: SOLO_DIRECCION };
  const { data, error } = await sb.from("rrhh_coste_hora").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "No se encontró ese coste (quizá ya estaba borrado)" };
  return { ok: true };
}

/* ================= Alta y datos ================= */

export type DatosEmpleado = {
  nombre: string;
  apellidos: string | null;
  email: string | null;
  telefono: string | null;
  centro_principal_id: string;
  departamento: string | null;
  puesto_defecto_id: string | null;
  tipo_contrato: string | null;
  codigo_nomina: string | null;
  fecha_nacimiento: string | null;
  nota: string | null;
  fichaje_movil: boolean;
  contador_inicial_h: number;
  contador_inicial_fecha: string | null;
};

function validarDatos(d: Partial<DatosEmpleado>): string | null {
  if (!d.nombre?.trim()) return "El nombre es obligatorio";
  if (!d.centro_principal_id) return "Elige el centro principal";
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return "El email no tiene buena pinta";
  if (d.fecha_nacimiento && !esFecha(d.fecha_nacimiento)) return "La fecha de nacimiento no es válida";
  if (d.contador_inicial_fecha && !esFecha(d.contador_inicial_fecha)) return "La fecha del contador inicial no es válida";
  return null;
}

const horasValidas = (h: number | null) => h == null || (Number.isFinite(h) && h >= 0 && h <= 80);

/** Id del departamento por nombre (sin distinguir mayúsculas, sin comodines). Con varias filas (operador) se queda con la primera. */
async function departamentoId(sb: Sb, nombre: string | null): Promise<string | null> {
  if (!nombre) return null;
  const patron = nombre.trim().replace(/[\\%_]/g, (c) => "\\" + c);
  const { data } = await sb.from("departamentos").select("id").ilike("nombre", patron).order("orden").limit(1);
  return data?.[0]?.id ?? null;
}

/** Alta completa: empleado + asignación al centro principal + primer periodo de contrato. */
export async function altaEmpleadoV2(input: Omit<DatosEmpleado, "fichaje_movil" | "contador_inicial_h" | "contador_inicial_fecha"> & {
  horas_semana: number | null;
  fecha_alta: string;
}): Promise<R<string>> {
  const { sb } = await cliente();
  if (!(await esGestor(sb))) return { ok: false, error: SOLO_GESTOR };
  const err = validarDatos(input);
  if (err) return { ok: false, error: err };
  if (!esFecha(input.fecha_alta)) return { ok: false, error: "Indica la fecha de alta" };
  if (!horasValidas(input.horas_semana)) return { ok: false, error: "Las horas/semana no son razonables (0 a 80)" };

  const departamento_id = await departamentoId(sb, input.departamento);
  const { data, error } = await sb
    .from("empleados")
    .insert({
      nombre: input.nombre.trim(),
      apellidos: input.apellidos?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      telefono: input.telefono?.trim() || null,
      centro_principal_id: input.centro_principal_id,
      departamento: input.departamento || null,
      departamento_id,
      puesto_defecto_id: input.puesto_defecto_id || null,
      tipo_contrato: input.tipo_contrato || null,
      codigo_nomina: input.codigo_nomina?.trim() || null,
      fecha_nacimiento: input.fecha_nacimiento || null,
      nota: input.nota?.trim() || null,
      horas_semana: input.horas_semana,
      fecha_alta: input.fecha_alta,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "No se pudo crear" };

  const [a, p] = await Promise.all([
    sb.from("rrhh_asignaciones").insert({ empleado_id: data.id, centro_id: input.centro_principal_id, fecha_inicio: input.fecha_alta }),
    sb.from("rrhh_periodos_contrato").insert({ empleado_id: data.id, fecha_alta: input.fecha_alta, horas_semana: input.horas_semana }),
  ]);
  if (a.error || p.error) return { ok: true, data: data.id, error: "Creado, pero falló " + (a.error ? "la asignación al centro" : "el periodo de contrato") };
  return { ok: true, data: data.id };
}

/** Guarda la ficha (conoce las columnas nuevas).
    Si cambia el centro principal y la persona tiene periodo vigente, abre la asignación al centro nuevo desde hoy
    (la del centro anterior se deja abierta: se cierra desde «Centros» si procede). Sin periodo vigente no se toca
    nada: la asignación la abrirá «Reactivar» con la fecha del llamamiento. Devuelve ok:true con `error` como aviso. */
export async function guardarEmpleadoV2(id: string, campos: DatosEmpleado): Promise<R> {
  const { sb } = await cliente();
  if (!(await esGestor(sb))) return { ok: false, error: SOLO_GESTOR };
  const err = validarDatos(campos);
  if (err) return { ok: false, error: err };

  const [{ data: antes }, departamento_id] = await Promise.all([
    sb.from("empleados").select("centro_principal_id, fecha_baja").eq("id", id).maybeSingle(),
    departamentoId(sb, campos.departamento),
  ]);
  if (!antes) return { ok: false, error: "No se encontró la ficha" };

  const { error } = await sb
    .from("empleados")
    .update({
      nombre: campos.nombre.trim(),
      apellidos: campos.apellidos?.trim() || null,
      email: campos.email?.trim().toLowerCase() || null,
      telefono: campos.telefono?.trim() || null,
      centro_principal_id: campos.centro_principal_id,
      departamento: campos.departamento || null,
      departamento_id,
      puesto_defecto_id: campos.puesto_defecto_id || null,
      tipo_contrato: campos.tipo_contrato || null,
      codigo_nomina: campos.codigo_nomina?.trim() || null,
      fecha_nacimiento: campos.fecha_nacimiento || null,
      nota: campos.nota?.trim() || null,
      fichaje_movil: campos.fichaje_movil,
      contador_inicial_h: Number(campos.contador_inicial_h) || 0,
      contador_inicial_fecha: campos.contador_inicial_fecha || null,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  if (antes.centro_principal_id === campos.centro_principal_id) return { ok: true };

  // Cambio de centro principal: ¿tiene periodo vigente (o abierto) hoy?
  const hoy = hoyIso();
  const { data: ps } = await sb.from("rrhh_periodos_contrato").select("fecha_alta, fecha_baja").eq("empleado_id", id);
  const vigente = ps?.length
    ? ps.some((p) => p.fecha_alta <= hoy && (!p.fecha_baja || p.fecha_baja >= hoy))
    : !antes.fecha_baja; // sin periodos: lo que diga la ficha
  if (!vigente) return { ok: true, error: "Centro principal cambiado. Como no tiene periodo vigente, la asignación se abrirá al reactivar." };

  const { data: abiertas } = await sb
    .from("rrhh_asignaciones")
    .select("id")
    .eq("empleado_id", id)
    .eq("centro_id", campos.centro_principal_id)
    .is("fecha_fin", null)
    .limit(1);
  if (abiertas?.length) return { ok: true };
  const { error: eA } = await sb.from("rrhh_asignaciones").insert({ empleado_id: id, centro_id: campos.centro_principal_id, fecha_inicio: hoy });
  if (eA) return { ok: true, error: "Ficha guardada, pero no se pudo abrir la asignación al centro nuevo: " + eA.message };
  return { ok: true, error: "Centro principal cambiado y asignación abierta desde hoy. La del centro anterior sigue abierta: ciérrala en «Centros» si ya no va a tener turnos allí." };
}

/* ================= Centros (asignaciones) ================= */

export async function anadirAsignacion(empleadoId: string, centroId: string, fechaInicio: string): Promise<R> {
  const { sb } = await cliente();
  if (!(await esGestor(sb))) return { ok: false, error: SOLO_GESTOR };
  if (!centroId) return { ok: false, error: "Elige un centro" };
  if (!esFecha(fechaInicio)) return { ok: false, error: "Indica desde cuándo" };
  const { data: existentes } = await sb
    .from("rrhh_asignaciones")
    .select("id, fecha_inicio, fecha_fin")
    .eq("empleado_id", empleadoId)
    .eq("centro_id", centroId);
  if (existentes?.some((a) => !a.fecha_fin)) return { ok: false, error: "Ya trabaja en ese centro" };
  const cubre = existentes?.find((a) => (!a.fecha_inicio || a.fecha_inicio <= fechaInicio) && a.fecha_fin! >= fechaInicio);
  if (cubre) return { ok: false, error: `Ya tiene una asignación a ese centro que cubre esa fecha (hasta el ${ddmmaaaa(cubre.fecha_fin!)})` };
  const { error } = await sb.from("rrhh_asignaciones").insert({ empleado_id: empleadoId, centro_id: centroId, fecha_inicio: fechaInicio });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Cierra una asignación. El centro principal no se puede cerrar: hay que cambiarlo antes en la ficha. */
export async function cerrarAsignacion(asignacionId: string, fechaFin: string): Promise<R> {
  const { sb } = await cliente();
  if (!(await esGestor(sb))) return { ok: false, error: SOLO_GESTOR };
  if (!esFecha(fechaFin)) return { ok: false, error: "Indica el último día" };
  const { data: a } = await sb.from("rrhh_asignaciones").select("empleado_id, centro_id, fecha_inicio, empleados(centro_principal_id)").eq("id", asignacionId).maybeSingle();
  if (!a) return { ok: false, error: "No se encontró la asignación" };
  const emp = a.empleados as { centro_principal_id: string | null } | null;
  if (!emp) return { ok: false, error: "No se pudo comprobar el centro principal" };
  if (emp.centro_principal_id === a.centro_id) return { ok: false, error: "Es su centro principal: cámbialo en la ficha antes de cerrarlo" };
  if (a.fecha_inicio && fechaFin < a.fecha_inicio) return { ok: false, error: "El fin no puede ser anterior al inicio" };
  const { error } = await sb.from("rrhh_asignaciones").update({ fecha_fin: fechaFin }).eq("id", asignacionId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ================= Periodos de contrato ================= */

/** Mantiene empleados.fecha_alta / fecha_baja / horas_semana en línea con el último periodo (mismo criterio que acciones.ts). */
async function sincronizarEmpleado(sb: Sb, empleadoId: string) {
  const { data } = await sb
    .from("rrhh_periodos_contrato")
    .select("fecha_alta, fecha_baja, horas_semana")
    .eq("empleado_id", empleadoId)
    .order("fecha_alta", { ascending: false })
    .limit(1);
  const ult = data?.[0];
  if (ult) {
    await sb.from("empleados").update({ fecha_alta: ult.fecha_alta, fecha_baja: ult.fecha_baja, horas_semana: ult.horas_semana }).eq("id", empleadoId);
  }
}

/** Periodo del empleado que se solapa con [alta, baja] (sin contar `excluirId`). */
function periodoSolapado(
  ps: { id: string; fecha_alta: string; fecha_baja: string | null }[],
  alta: string,
  baja: string | null,
  excluirId: string | null,
) {
  return ps.find((p) => p.id !== excluirId && (!baja || p.fecha_alta <= baja) && (!p.fecha_baja || p.fecha_baja >= alta)) ?? null;
}
const txtPeriodo = (p: { fecha_alta: string; fecha_baja: string | null }) =>
  p.fecha_baja ? `del ${ddmmaaaa(p.fecha_alta)} al ${ddmmaaaa(p.fecha_baja)}` : `abierto desde el ${ddmmaaaa(p.fecha_alta)}`;

export async function guardarPeriodoV2(
  periodoId: string | null,
  empleadoId: string,
  fila: { fecha_alta: string; fecha_baja: string | null; horas_semana: number | null; nota: string | null },
): Promise<R> {
  const { sb } = await cliente();
  if (!(await esGestor(sb))) return { ok: false, error: SOLO_GESTOR };
  if (!esFecha(fila.fecha_alta)) return { ok: false, error: "Indica la fecha de alta" };
  if (fila.fecha_baja && !esFecha(fila.fecha_baja)) return { ok: false, error: "La fecha de baja no es válida" };
  if (fila.fecha_baja && fila.fecha_baja < fila.fecha_alta) return { ok: false, error: "La baja no puede ser anterior al alta" };
  if (!horasValidas(fila.horas_semana)) return { ok: false, error: "Las horas/semana no son razonables (0 a 80)" };

  const { data: ps } = await sb.from("rrhh_periodos_contrato").select("id, fecha_alta, fecha_baja").eq("empleado_id", empleadoId);
  const choque = periodoSolapado(ps ?? [], fila.fecha_alta, fila.fecha_baja, periodoId);
  if (choque) return { ok: false, error: `Se solapa con el periodo ${txtPeriodo(choque)}. Ajusta las fechas: cada día pertenece a un solo periodo.` };

  const datos = { ...fila, nota: fila.nota?.trim() || null };
  const { error } = periodoId
    ? await sb.from("rrhh_periodos_contrato").update(datos).eq("id", periodoId)
    : await sb.from("rrhh_periodos_contrato").insert({ ...datos, empleado_id: empleadoId });
  if (error) return { ok: false, error: error.message };
  await sincronizarEmpleado(sb, empleadoId);
  return { ok: true };
}

/* ================= Baja y reactivación ================= */

/** Cierra el periodo abierto y las asignaciones abiertas en el último día; apunta el motivo en el periodo.
    Valida todo antes de escribir y escribe en orden (asignaciones → periodos → ficha) para no dejar nada a medias. */
export async function darDeBaja(empleadoId: string, ultimoDia: string, motivo: string, detalle: string | null): Promise<R> {
  const { sb } = await cliente();
  if (!(await esGestor(sb))) return { ok: false, error: SOLO_GESTOR };
  if (!esFecha(ultimoDia)) return { ok: false, error: "Indica el último día" };
  if (!motivo.trim()) return { ok: false, error: "Indica el motivo" };
  const texto = `Baja ${ddmmaaaa(ultimoDia)}: ${motivo}${detalle?.trim() ? " · " + detalle.trim() : ""}`;

  const [{ data: abiertos, error: e0 }, { data: asigAbiertas, error: e1 }, { data: emp, error: e2 }] = await Promise.all([
    sb.from("rrhh_periodos_contrato").select("id, fecha_alta, nota").eq("empleado_id", empleadoId).is("fecha_baja", null),
    sb.from("rrhh_asignaciones").select("id, centro_id, fecha_inicio").eq("empleado_id", empleadoId).is("fecha_fin", null),
    sb.from("empleados").select("nota, fecha_alta").eq("id", empleadoId).maybeSingle(),
  ]);
  if (e0 || e1 || e2) return { ok: false, error: (e0 ?? e1 ?? e2)!.message };
  if (!emp) return { ok: false, error: "No se encontró la ficha" };

  // Validar antes de tocar nada (los checks de la base darían un error a medias y en crudo)
  for (const p of abiertos ?? []) {
    if (p.fecha_alta > ultimoDia) return { ok: false, error: `Tiene un periodo que empieza el ${ddmmaaaa(p.fecha_alta)}, después del último día. Revísalo antes.` };
  }
  for (const a of asigAbiertas ?? []) {
    if (a.fecha_inicio && a.fecha_inicio > ultimoDia) return { ok: false, error: `Tiene una asignación a un centro que empieza el ${ddmmaaaa(a.fecha_inicio)}, después del último día. Ciérrala o cambia la fecha antes.` };
  }
  if (emp.fecha_alta && emp.fecha_alta > ultimoDia) return { ok: false, error: `Su fecha de alta es el ${ddmmaaaa(emp.fecha_alta)}: el último día no puede ser anterior.` };

  // 1) Asignaciones
  if (asigAbiertas?.length) {
    const { error } = await sb.from("rrhh_asignaciones").update({ fecha_fin: ultimoDia }).eq("empleado_id", empleadoId).is("fecha_fin", null);
    if (error) return { ok: false, error: "No se pudieron cerrar sus centros: " + error.message };
  }
  // 2) Periodos, uno a uno
  for (const p of abiertos ?? []) {
    const { error } = await sb
      .from("rrhh_periodos_contrato")
      .update({ fecha_baja: ultimoDia, nota: p.nota ? `${p.nota}\n${texto}` : texto })
      .eq("id", p.id);
    if (error) return { ok: false, error: "Centros cerrados, pero no se pudo cerrar el periodo de contrato: " + error.message };
  }
  // 3) Ficha
  const { error } = await sb
    .from("empleados")
    .update({
      fecha_baja: ultimoDia,
      // Si no había periodo abierto, el motivo queda en la nota de la ficha para no perderlo
      ...(abiertos?.length ? {} : { nota: emp.nota ? `${emp.nota}\n${texto}` : texto }),
    })
    .eq("id", empleadoId);
  if (error) return { ok: false, error: "Periodo cerrado, pero no se pudo actualizar la ficha: " + error.message };
  return { ok: true };
}

/** Llamamiento / reactivación: nuevo periodo desde una fecha y asignación al centro principal si no la tiene abierta.
    El primer día tiene que ser posterior al último trabajado (ningún periodo puede cubrirlo ni empezar después). */
export async function reactivar(empleadoId: string, fechaAlta: string, horasSemana: number | null, nota: string | null): Promise<R> {
  const { sb } = await cliente();
  if (!(await esGestor(sb))) return { ok: false, error: SOLO_GESTOR };
  if (!esFecha(fechaAlta)) return { ok: false, error: "Indica la fecha de alta" };
  if (!horasValidas(horasSemana)) return { ok: false, error: "Las horas/semana no son razonables (0 a 80)" };

  const { data: ps } = await sb.from("rrhh_periodos_contrato").select("id, fecha_alta, fecha_baja").eq("empleado_id", empleadoId);
  if (ps?.some((p) => !p.fecha_baja)) return { ok: false, error: "Ya tiene un periodo abierto" };
  const ultimaBaja = (ps ?? []).reduce<string | null>((m, p) => (p.fecha_baja && (!m || p.fecha_baja > m) ? p.fecha_baja : m), null);
  if (ultimaBaja && fechaAlta <= ultimaBaja) {
    return { ok: false, error: `El primer día tiene que ser posterior al último trabajado (${ddmmaaaa(ultimaBaja)})` };
  }

  const { error } = await sb.from("rrhh_periodos_contrato").insert({ empleado_id: empleadoId, fecha_alta: fechaAlta, horas_semana: horasSemana, nota: nota?.trim() || null });
  if (error) return { ok: false, error: error.message };

  const { data: emp } = await sb.from("empleados").select("centro_principal_id").eq("id", empleadoId).maybeSingle();
  if (emp?.centro_principal_id) {
    const { data: asig } = await sb
      .from("rrhh_asignaciones")
      .select("id")
      .eq("empleado_id", empleadoId)
      .eq("centro_id", emp.centro_principal_id)
      .is("fecha_fin", null)
      .limit(1);
    if (!asig?.length) await sb.from("rrhh_asignaciones").insert({ empleado_id: empleadoId, centro_id: emp.centro_principal_id, fecha_inicio: fechaAlta });
  }
  await sincronizarEmpleado(sb, empleadoId);
  return { ok: true };
}
