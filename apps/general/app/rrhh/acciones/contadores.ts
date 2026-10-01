"use server";

/* Acciones de servidor de la sección Contadores (plan 2.5).
   Todo con el cliente autenticado: la RLS decide qué ve cada uno. */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables } from "@hostelero/db";
import { lunesDe, sumaDia } from "../tipos";

async function cliente() {
  const { supabase, perfil } = await exigirModulo("rrhh");
  return { sb: supabase, perfil };
}

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

/* ==================== Tipos ==================== */

export type FilaSemana = {
  anio: number;
  semana: number;
  lunes: string;
  empleado_id: string;
  horas_contrato: number;
  horas_plan: number;
  horas_retenidas: number;
  horas_ausencia_contador: number;
  diferencia: number;
  dias_plan: number;
  dias_validados: number;
  /** Coste de personal de la semana (solo dirección): realizadas × coste/hora vigente el lunes × (1 + coste de empresa).
      undefined = no se calcula (no es dirección) · null = el empleado no tiene coste/hora para ese lunes. */
  coste?: number | null;
};

export type EmpContador = {
  id: string;
  nombre: string;
  apellidos: string | null;
  departamento: string | null;
  centro_principal_id: string | null;
  horas_semana: number | null;
  tipo_contrato: string | null;
  fecha_baja: string | null;
  contador_inicial_h: number;
  contador_inicial_fecha: string | null;
  vacaciones_ajuste_dias: number;
  nota: string | null;
};

export type ReglasContador = { horas_extra_max_anual: number; complementarias_max_pct: number; coste_empresa_pct: number };

export type Ajuste = Tables<"rrhh_contador_ajustes">;

export type SaldoEmp = {
  saldo: number;
  extrasAnio: number;
  contratoAnio: number;
  complementariasPct: number | null;
  horasSemana: number;
  desde: string;
};

export type FilaVacaciones = {
  empleado: EmpContador;
  derecho_anual: number;
  devengado_hoy: number;
  disfrutados: number;
  pendientes_aprobar: number;
  resto: number;
};

/* ==================== Helpers ==================== */

const COLS_EMP =
  "id, nombre, apellidos, departamento, centro_principal_id, horas_semana, tipo_contrato, fecha_baja, contador_inicial_h, contador_inicial_fecha, vacaciones_ajuste_dias, nota";

type SB = Awaited<ReturnType<typeof cliente>>["sb"];

const n = (v: unknown) => Number(v) || 0;

/** rrhh_resumen_semana paginada. centroId null = todos.
    El proyecto tiene pgrst.db_max_rows = 10.000, pero no se da por hecho: se avanza por lo recibido
    y, si una página viene «redonda» (múltiplo de 1.000, el límite por defecto de Supabase), se pide
    la siguiente por si el servidor cortó antes. Cada página recalcula la función entera (es lenta),
    así que no se pagina de 1.000 en 1.000 a propósito. */
async function resumen(sb: SB, centroId: string | null, desde: string, hasta: string): Promise<FilaSemana[]> {
  const out: FilaSemana[] = [];
  const PAG = 10000;
  for (let i = 0; ; ) {
    const { data, error } = await sb
      .rpc("rrhh_resumen_semana", { p_centro_id: (centroId ?? null) as unknown as string, p_desde: desde, p_hasta: hasta })
      .range(i, i + PAG - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      out.push({
        anio: r.anio,
        semana: r.semana,
        lunes: r.lunes,
        empleado_id: r.empleado_id,
        horas_contrato: n(r.horas_contrato),
        horas_plan: n(r.horas_plan),
        horas_retenidas: n(r.horas_retenidas),
        horas_ausencia_contador: n(r.horas_ausencia_contador),
        diferencia: n(r.diferencia),
        dias_plan: r.dias_plan,
        dias_validados: r.dias_validados,
      });
    }
    const len = data?.length ?? 0;
    if (len === 0 || (len < PAG && len % 1000 !== 0)) break;
    i += len;
  }
  return out;
}

/** Empleados de la cuenta con las columnas que usa la sección.
    Se filtra por cuenta además de la RLS: a un operador la RLS le enseña todas las cuentas. */
async function empleados(sb: SB, cuentaId: string, ids?: string[]): Promise<EmpContador[]> {
  let q = sb.from("empleados").select(COLS_EMP).eq("cuenta_id", cuentaId).order("apellidos").order("nombre");
  if (ids) q = q.in("id", ids);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((e) => ({
    ...e,
    contador_inicial_h: n(e.contador_inicial_h),
    vacaciones_ajuste_dias: n(e.vacaciones_ajuste_dias),
  }));
}

/** Reglas del convenio que aplica a cada centro (config del centro → convenio por defecto → 80 h / 30 %). */
async function reglasPorCentro(sb: SB, cuentaId: string): Promise<{ porCentro: Record<string, ReglasContador>; defecto: ReglasContador }> {
  const [{ data: convenios }, { data: configs }] = await Promise.all([
    sb.from("rrhh_convenios").select("id, es_por_defecto, horas_extra_max_anual, complementarias_max_pct, coste_empresa_pct").eq("cuenta_id", cuentaId),
    sb.from("rrhh_centros_config").select("centro_id, convenio_id").eq("cuenta_id", cuentaId),
  ]);
  const base = (convenios ?? []).find((c) => c.es_por_defecto) ?? (convenios ?? [])[0];
  const reglasDe = (c: typeof base | null | undefined): ReglasContador => ({
    horas_extra_max_anual: n(c?.horas_extra_max_anual) || 80,
    complementarias_max_pct: n(c?.complementarias_max_pct) || 30,
    // Tasa de empresa sobre el bruto (Skello: 32,15 %). 0 es un valor legítimo: solo cae al defecto si falta.
    coste_empresa_pct: c?.coste_empresa_pct == null ? 32.15 : n(c.coste_empresa_pct),
  });
  const defecto = reglasDe(base);
  const porId = new Map((convenios ?? []).map((c) => [c.id, c]));
  const porCentro: Record<string, ReglasContador> = {};
  for (const cfg of configs ?? []) {
    const c = cfg.convenio_id ? porId.get(cfg.convenio_id) : null;
    porCentro[cfg.centro_id] = c ? reglasDe(c) : defecto;
  }
  return { porCentro, defecto };
}

/* ==================== Coste de personal (solo dirección) ==================== */

type TramoCoste = { desde: string; coste_hora: number };

/** Coste/hora vigente en una fecha: el tramo con «desde» más reciente que no sea posterior. `tramos` ordenados desc. */
const costeVigente = (tramos: TramoCoste[] | undefined, fecha: string): number | null =>
  tramos?.find((t) => t.desde <= fecha)?.coste_hora ?? null;

/** Tramos de coste/hora por empleado, ordenados por «desde» descendente. Solo dirección: a los demás ni se
    les consulta (la RLS devolvería 0 filas y la UI no debe enseñar nada de coste). */
async function tramosCoste(sb: SB, perfil: { rol: string }, ids: string[]): Promise<Record<string, TramoCoste[]> | null> {
  if (perfil.rol !== "direccion" || !ids.length) return null;
  const { data, error } = await sb
    .from("rrhh_coste_hora")
    .select("empleado_id, desde, coste_hora")
    .in("empleado_id", ids)
    .order("desde", { ascending: false })
    .limit(10000);
  if (error) throw new Error(error.message);
  const out: Record<string, TramoCoste[]> = {};
  for (const t of data ?? []) (out[t.empleado_id] = out[t.empleado_id] || []).push({ desde: t.desde, coste_hora: n(t.coste_hora) });
  return out;
}

/** horas × €/hora × (1 + pct/100), a céntimos. */
const costeDe = (horas: number, costeHora: number, pct: number) => Math.round(horas * costeHora * (1 + pct / 100) * 100) / 100;

/** Desde cuándo cuenta el contador de un empleado (misma regla que rrhh_saldo_horas):
    saldo inicial a cierre de ese día → si no es lunes, el lunes siguiente; sin fecha, 1 de enero del año de `hasta`. */
function desdeContador(e: EmpContador, hasta: string): string {
  if (!e.contador_inicial_fecha) return hasta.slice(0, 4) + "-01-01";
  const f = e.contador_inicial_fecha;
  return lunesDe(f) === f ? f : sumaDia(lunesDe(f), 7);
}

/* ==================== Tabla principal ==================== */

export async function cargarContadores(centroId: string | null, desde: string, hasta: string) {
  const { sb, perfil } = await cliente();
  const [filas, reglas] = await Promise.all([resumen(sb, centroId, desde, hasta), reglasPorCentro(sb, perfil.cuenta_id)]);
  const ids = [...new Set(filas.map((f) => f.empleado_id))];
  const [emps, tramos] = await Promise.all([
    ids.length ? empleados(sb, perfil.cuenta_id, ids) : Promise.resolve([] as EmpContador[]),
    tramosCoste(sb, perfil, ids),
  ]);
  const reglasPorEmp: Record<string, ReglasContador> = {};
  for (const e of emps) reglasPorEmp[e.id] = (e.centro_principal_id && reglas.porCentro[e.centro_principal_id]) || reglas.defecto;

  // Coste de personal (solo dirección): realizadas (retenidas + ausencias que computan) × coste/hora vigente el
  // lunes × (1 + coste de empresa del convenio del centro principal). Sin coste/hora ese lunes → null («—»).
  let coste: { sinCosteHora: string[] } | null = null;
  if (tramos) {
    const sin = new Set<string>();
    for (const f of filas) {
      const ch = costeVigente(tramos[f.empleado_id], f.lunes);
      if (ch == null) { f.coste = null; sin.add(f.empleado_id); continue; }
      const pct = (reglasPorEmp[f.empleado_id] ?? reglas.defecto).coste_empresa_pct;
      f.coste = costeDe(f.horas_retenidas + f.horas_ausencia_contador, ch, pct);
    }
    coste = { sinCosteHora: emps.filter((e) => sin.has(e.id)).map((e) => e.id) };
  }
  return { filas, empleados: emps, reglasPorEmp, coste };
}

/** Saldos acumulados y alertas del año en curso (año de `hasta`), para los empleados pedidos.
    Se llama en segundo plano desde el cliente y se cachea por empleado y fecha final.
    El saldo lo da rrhh_saldos_horas(p_hasta) en una sola llamada para toda la plantilla (saldo inicial +
    diferencias desde `desde` + ajustes; es de la persona, todos sus centros). Las extras y complementarias
    del año se siguen sacando del resumen semanal del año (sin centro, por el mismo motivo). */
export async function cargarSaldos(hasta: string, empleadoIds: string[]) {
  const { sb, perfil } = await cliente();
  if (!empleadoIds.length) return { saldos: {} as Record<string, SaldoEmp> };
  const anio = hasta.slice(0, 4);
  const [emps, filas, { data: saldosRpc, error }] = await Promise.all([
    empleados(sb, perfil.cuenta_id, empleadoIds),
    resumen(sb, null, anio + "-01-01", hasta),
    sb.rpc("rrhh_saldos_horas", { p_hasta: hasta }),
  ]);
  if (error) throw new Error(error.message);
  const rpcPorEmp = new Map((saldosRpc ?? []).map((s) => [s.empleado_id, s]));
  const lunesHasta = lunesDe(hasta);
  const saldos: Record<string, SaldoEmp> = {};
  for (const e of emps) {
    const s = rpcPorEmp.get(e.id);
    const desde = s?.desde ?? desdeContador(e, hasta);
    const saldo = s ? n(s.saldo) : e.contador_inicial_h;
    let extras = 0, contrato = 0, horasSemana = 0, ultimoLunes = "";
    for (const f of filas) {
      if (f.empleado_id !== e.id) continue;
      if (f.lunes.slice(0, 4) === anio && f.lunes <= lunesHasta) {
        if (f.diferencia > 0) extras += f.diferencia;
        contrato += f.horas_contrato;
        if (f.horas_contrato > 0 && f.lunes > ultimoLunes) { ultimoLunes = f.lunes; horasSemana = f.horas_contrato; }
      }
    }
    if (!horasSemana) horasSemana = n(e.horas_semana);
    saldos[e.id] = {
      saldo: Math.round(saldo * 100) / 100,
      extrasAnio: Math.round(extras * 100) / 100,
      contratoAnio: Math.round(contrato * 100) / 100,
      complementariasPct: contrato > 0 ? Math.round((extras / contrato) * 1000) / 10 : null,
      horasSemana,
      desde,
    };
  }
  return { saldos };
}

/* ==================== Detalle de un empleado ==================== */

export async function detalleContador(empleadoId: string, hasta: string) {
  const { sb } = await cliente();
  const [{ data: saldo, error: e1 }, { data: ajustes, error: e2 }] = await Promise.all([
    sb.rpc("rrhh_saldo_horas", { p_empleado_id: empleadoId, p_hasta: hasta }),
    sb.from("rrhh_contador_ajustes").select("*").eq("empleado_id", empleadoId).order("fecha", { ascending: false }).order("creado_en", { ascending: false }),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  return { saldo: n(saldo), ajustes: (ajustes ?? []) as Ajuste[] };
}

export async function anadirAjuste(fila: {
  empleado_id: string;
  fecha: string;
  horas: number;
  tipo: "ajuste" | "pago" | "descanso" | "inicial";
  motivo: string;
}): Promise<R<Ajuste>> {
  const { sb, perfil } = await cliente();
  if (!fila.motivo.trim()) return { ok: false, error: "El motivo es obligatorio" };
  if (!Number.isFinite(fila.horas) || fila.horas === 0) return { ok: false, error: "Indica las horas (con signo)" };
  const { data, error } = await sb
    .from("rrhh_contador_ajustes")
    .insert({ ...fila, motivo: fila.motivo.trim(), creado_por: perfil.id })
    .select("*")
    .single();
  return error ? { ok: false, error: error.message } : { ok: true, data: data as Ajuste };
}

/* ==================== Vacaciones ==================== */

export async function cargarVacaciones(centroId: string | null, anio: number) {
  const { sb, perfil } = await cliente();
  const ini = `${anio}-01-01`, fin = `${anio}-12-31`;
  // Activos en el año (sin baja o baja dentro del año), del centro si se filtra.
  const [{ data: emps, error }, { data: asig }] = await Promise.all([
    sb.from("empleados").select(COLS_EMP).eq("cuenta_id", perfil.cuenta_id).or(`fecha_baja.is.null,fecha_baja.gte.${ini}`).order("apellidos").order("nombre"),
    centroId
      ? sb.from("rrhh_asignaciones").select("empleado_id").eq("centro_id", centroId).or(`fecha_fin.is.null,fecha_fin.gte.${ini}`).lte("fecha_inicio", fin)
      : Promise.resolve({ data: [] as { empleado_id: string }[] }),
  ]);
  if (error) throw new Error(error.message);
  const asignados = new Set((asig ?? []).map((a) => a.empleado_id));
  const lista = (emps ?? [])
    .filter((e) => !centroId || e.centro_principal_id === centroId || asignados.has(e.id))
    .map((e) => ({ ...e, contador_inicial_h: n(e.contador_inicial_h), vacaciones_ajuste_dias: n(e.vacaciones_ajuste_dias) }));
  // Una llamada por empleado, en paralelo por lotes.
  const filas: FilaVacaciones[] = [];
  const LOTE = 25;
  for (let i = 0; i < lista.length; i += LOTE) {
    const lote = lista.slice(i, i + LOTE);
    const res = await Promise.all(lote.map((e) => sb.rpc("rrhh_saldo_vacaciones", { p_empleado_id: e.id, p_anio: anio })));
    res.forEach((r, j) => {
      if (r.error) throw new Error(r.error.message);
      const v = r.data?.[0];
      filas.push({
        empleado: lote[j],
        derecho_anual: n(v?.derecho_anual),
        devengado_hoy: n(v?.devengado_hoy),
        disfrutados: n(v?.disfrutados),
        pendientes_aprobar: n(v?.pendientes_aprobar),
        resto: n(v?.resto),
      });
    });
  }
  return { filas };
}

/** Ajuste manual del saldo de vacaciones del AÑO EN CURSO.
    `diasSaldo` son días que se AÑADEN al saldo (como la columna «Ajuste» de Skello: +2 = dos días más).
    En la base, `empleados.vacaciones_ajuste_dias` se suma a «disfrutados» (rrhh_saldo_vacaciones), así que
    se guarda con el signo invertido. La columna no tiene año: por eso solo se admite el año en curso.
    Deja el motivo en la nota del empleado. */
export async function ajustarVacaciones(empleadoId: string, diasSaldo: number, motivo: string, anio: number): Promise<R<{ nota: string }>> {
  const { sb } = await cliente();
  if (!Number.isFinite(diasSaldo)) return { ok: false, error: "Indica los días (con signo)" };
  if (!motivo.trim()) return { ok: false, error: "El motivo es obligatorio" };
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const [a, m, d] = hoy.split("-");
  if (anio !== Number(a)) return { ok: false, error: "El ajuste manual solo aplica al año en curso" };
  const { data: emp, error: e1 } = await sb.from("empleados").select("nota").eq("id", empleadoId).single();
  if (e1) return { ok: false, error: e1.message };
  const linea = `${d}/${m}/${a} · Vacaciones ${a}: ajuste ${diasSaldo > 0 ? "+" : ""}${String(diasSaldo).replace(".", ",")} días de saldo. ${motivo.trim()}`;
  const nota = emp?.nota ? `${emp.nota}\n${linea}` : linea;
  // Condición sobre la nota leída: si alguien la cambió entre medias, no se pisa.
  let q = sb.from("empleados").update({ vacaciones_ajuste_dias: -diasSaldo, nota }).eq("id", empleadoId);
  q = emp?.nota == null ? q.is("nota", null) : q.eq("nota", emp.nota);
  const { data: filas, error } = await q.select("id");
  if (error) return { ok: false, error: error.message };
  if (!filas?.length) return { ok: false, error: "No se ha podido guardar: la ficha ha cambiado mientras ajustabas. Vuelve a abrir y repite." };
  return { ok: true, data: { nota } };
}

/* Ratios: ya no hay «Enviar a Ratios». Ratios lee estas horas en vivo desde la vista
   rrhh_desde_personal (migración 20261001070000_rrhh_vista_ratios.sql); rrhh_exportar_ratios
   sigue existiendo en la base como respaldo manual, sin botón. */
