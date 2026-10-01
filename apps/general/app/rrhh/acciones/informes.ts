"use server";

/* Acciones de servidor de la sección Informes (plan 2.6).
   Todo con el cliente autenticado: la RLS decide qué ve cada uno. */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables } from "@hostelero/db";

async function cliente() {
  const { supabase, perfil } = await exigirModulo("rrhh");
  return { sb: supabase, perfil };
}

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

export type FilaNomina = {
  empleado_id: string;
  nombre: string;
  apellidos: string | null;
  codigo_nomina: string | null;
  centro_principal_id: string | null;
  departamento_id: string | null;
  tipo_contrato: string | null;
  horas_semana: number;
  horas_contrato_mes: number;
  dias_contrato: number;
  dias_trabajados: number;
  horas_retenidas: number;
  horas_ausencia_contador: number;
  horas_extra: number;
  horas_nocturnas: number;
  horas_domingo: number;
  horas_festivo: number;
  /** {codigo: {dias, horas}} */
  ausencias: Record<string, { dias: number; horas: number }>;
  /** {concepto: importe} */
  variables: Record<string, number>;
  comentario: string;
};

export type FilaSemana = {
  empleado_id: string;
  anio: number;
  semana: number;
  lunes: string;
  horas_contrato: number;
  horas_plan: number;
  horas_retenidas: number;
  horas_ausencia_contador: number;
  diferencia: number;
};

export type AusenciaMes = {
  id: string;
  empleado_id: string;
  fecha_inicio: string;
  fecha_fin: string;
  medio_dia: boolean;
  horas: number | null;
  nota: string | null;
  tipo: string;
  tipo_nombre: string;
  tipo_codigo: string;
};

export type VariableNomina = Tables<"rrhh_variables_nomina">;
export type TipoAusenciaMin = { id: string; nombre: string; codigo: string | null; color: string | null; computa_contador: boolean };

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);

function rangoMesSrv(anio: number, mes: number) {
  const desde = `${anio}-${String(mes).padStart(2, "0")}-01`;
  const ultimo = new Date(anio, mes, 0).getDate();
  return { desde, hasta: `${anio}-${String(mes).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}` };
}

/* ================= Coste estimado (solo dirección) ================= */

type SB = Awaited<ReturnType<typeof cliente>>["sb"];
type TramoCoste = { desde: string; coste_hora: number };

/** Coste estimado del mes por empleado: (h retenidas + ausencias del contador) × coste/hora vigente el día 1
    × (1 + coste de empresa del convenio del centro principal). Solo dirección: a los demás no se consulta
    nada (la RLS de rrhh_coste_hora devolvería vacío) y se devuelve null, así la UI no pinta la columna.
    null por empleado = sin coste/hora ese día. */
async function costeEstimado(
  sb: SB,
  perfil: { rol: string; cuenta_id: string },
  filas: Pick<FilaNomina, "empleado_id" | "centro_principal_id" | "horas_retenidas" | "horas_ausencia_contador">[],
  primerDia: string,
): Promise<Record<string, number | null> | null> {
  if (perfil.rol !== "direccion" || !filas.length) return null;
  const ids = filas.map((f) => f.empleado_id);
  const [tramos, convenios, configs] = await Promise.all([
    sb.from("rrhh_coste_hora").select("empleado_id, desde, coste_hora").in("empleado_id", ids).order("desde", { ascending: false }).limit(10000),
    sb.from("rrhh_convenios").select("id, es_por_defecto, coste_empresa_pct").eq("cuenta_id", perfil.cuenta_id),
    sb.from("rrhh_centros_config").select("centro_id, convenio_id").eq("cuenta_id", perfil.cuenta_id),
  ]);
  const err = tramos.error ?? convenios.error ?? configs.error;
  if (err) throw new Error("coste estimado: " + err.message);

  const porEmp: Record<string, TramoCoste[]> = {};
  for (const t of tramos.data ?? []) (porEmp[t.empleado_id] = porEmp[t.empleado_id] || []).push({ desde: t.desde, coste_hora: num(t.coste_hora) });
  const convs = convenios.data ?? [];
  const base = convs.find((c) => c.es_por_defecto) ?? convs[0];
  const pctDefecto = base?.coste_empresa_pct == null ? 32.15 : num(base.coste_empresa_pct);
  const pctPorCentro: Record<string, number> = {};
  for (const cfg of configs.data ?? []) {
    const c = cfg.convenio_id ? convs.find((x) => x.id === cfg.convenio_id) : null;
    pctPorCentro[cfg.centro_id] = c?.coste_empresa_pct == null ? pctDefecto : num(c.coste_empresa_pct);
  }

  const out: Record<string, number | null> = {};
  for (const f of filas) {
    const ch = porEmp[f.empleado_id]?.find((t) => t.desde <= primerDia)?.coste_hora ?? null;
    if (ch == null) { out[f.empleado_id] = null; continue; }
    const pct = f.centro_principal_id ? pctPorCentro[f.centro_principal_id] ?? pctDefecto : pctDefecto;
    out[f.empleado_id] = Math.round((f.horas_retenidas + f.horas_ausencia_contador) * ch * (1 + pct / 100) * 100) / 100;
  }
  return out;
}

/* ================= Informe de nómina ================= */

/** Todo lo que necesita el informe de nómina de un mes, en una sola ida (Promise.all, sin N+1). */
export async function informeNomina(anio: number, mes: number, centroId: string | null) {
  const { sb, perfil } = await cliente();
  const { desde, hasta } = rangoMesSrv(anio, mes);
  const [inf, sem, aus, vars, tipos, deptos] = await Promise.all([
    sb.rpc("rrhh_informe_nomina", centroId ? { p_anio: anio, p_mes: mes, p_centro_id: centroId } : { p_anio: anio, p_mes: mes }),
    sb.rpc("rrhh_resumen_semana", { p_centro_id: centroId as unknown as string, p_desde: desde, p_hasta: hasta }),
    sb
      .from("rrhh_ausencias")
      .select("id, empleado_id, fecha_inicio, fecha_fin, medio_dia, horas, nota, tipo, rrhh_tipos_ausencia(nombre, codigo)")
      .eq("estado", "aprobada")
      .lte("fecha_inicio", hasta)
      .gte("fecha_fin", desde)
      .order("fecha_inicio"),
    sb.from("rrhh_variables_nomina").select("*").eq("anio", anio).eq("mes", mes).order("creado_en"),
    sb.from("rrhh_tipos_ausencia").select("id, nombre, codigo, color, computa_contador").order("orden"),
    sb.from("departamentos").select("id, nombre"),
  ]);
  // Si falla cualquier bloque, el informe no sale: un Excel con la hoja «Ausencias» o «Horas por semana» vacía iría a la gestoría sin que nadie lo note.
  const fallo = (
    [
      ["informe", inf.error], ["horas por semana", sem.error], ["ausencias", aus.error],
      ["variables", vars.error], ["tipos de ausencia", tipos.error], ["departamentos", deptos.error],
    ] as const
  ).find(([, e]) => e);
  if (fallo) return { ok: false as const, error: `${fallo[0]}: ${fallo[1]!.message}` };

  const filas: FilaNomina[] = (inf.data ?? []).map((r) => ({
    empleado_id: r.empleado_id,
    nombre: r.nombre,
    apellidos: r.apellidos,
    codigo_nomina: r.codigo_nomina,
    centro_principal_id: r.centro_principal_id,
    departamento_id: r.departamento_id,
    tipo_contrato: r.tipo_contrato,
    horas_semana: num(r.horas_semana),
    horas_contrato_mes: num(r.horas_contrato_mes),
    dias_contrato: num(r.dias_contrato),
    dias_trabajados: num(r.dias_trabajados),
    horas_retenidas: num(r.horas_retenidas),
    horas_ausencia_contador: num(r.horas_ausencia_contador),
    horas_extra: num(r.horas_extra),
    horas_nocturnas: num(r.horas_nocturnas),
    horas_domingo: num(r.horas_domingo),
    horas_festivo: num(r.horas_festivo),
    ausencias: Object.fromEntries(
      Object.entries((r.ausencias ?? {}) as Record<string, { dias?: unknown; horas?: unknown }>).map(([k, v]) => [k, { dias: num(v?.dias), horas: num(v?.horas) }]),
    ),
    variables: Object.fromEntries(Object.entries((r.variables ?? {}) as Record<string, unknown>).map(([k, v]) => [k, num(v)])),
    comentario: r.comentario ?? "",
  }));
  const ids = new Set(filas.map((f) => f.empleado_id));

  const semanas: FilaSemana[] = (sem.data ?? [])
    .filter((s) => ids.has(s.empleado_id))
    .map((s) => ({
      empleado_id: s.empleado_id,
      anio: s.anio,
      semana: s.semana,
      lunes: s.lunes,
      horas_contrato: num(s.horas_contrato),
      horas_plan: num(s.horas_plan),
      horas_retenidas: num(s.horas_retenidas),
      horas_ausencia_contador: num(s.horas_ausencia_contador),
      diferencia: num(s.diferencia),
    }));

  const ausencias: AusenciaMes[] = (aus.data ?? [])
    .filter((a) => ids.has(a.empleado_id))
    .map((a) => {
      const t = a.rrhh_tipos_ausencia as unknown as { nombre: string; codigo: string | null } | null;
      return {
        id: a.id,
        empleado_id: a.empleado_id,
        fecha_inicio: a.fecha_inicio,
        fecha_fin: a.fecha_fin,
        medio_dia: !!a.medio_dia,
        horas: a.horas == null ? null : num(a.horas),
        nota: a.nota,
        tipo: a.tipo,
        tipo_nombre: t?.nombre ?? a.tipo,
        // Mismo orden que la RPC (coalesce(codigo, nombre, enum)) para que case con la clave del Resumen.
        tipo_codigo: t?.codigo ?? t?.nombre ?? a.tipo,
      };
    });

  // Coste estimado: solo dirección (null para el resto → la UI no enseña la columna). Si falla, el informe
  // sale igual sin coste: no es dato de nómina, es orientativo para dirección.
  let coste: Record<string, number | null> | null = null;
  let costeError: string | null = null;
  try {
    coste = await costeEstimado(sb, perfil, filas, desde);
  } catch (e) {
    costeError = e instanceof Error ? e.message : "no se pudo calcular el coste estimado";
  }

  return {
    ok: true as const,
    filas,
    semanas,
    ausencias,
    variables: ((vars.data ?? []) as VariableNomina[]).filter((v) => ids.has(v.empleado_id)),
    tipos: (tipos.data ?? []) as TipoAusenciaMin[],
    departamentos: Object.fromEntries((deptos.data ?? []).map((d) => [d.id, d.nombre])) as Record<string, string>,
    /** Coste estimado por empleado (solo dirección); null = no se enseña. */
    coste,
    /** Solo si dirección y el cálculo ha fallado: el informe sale igual, sin la columna. */
    costeError,
  };
}

export async function guardarVariable(
  id: string | null,
  fila: { empleado_id: string; anio: number; mes: number; concepto: string; importe: number; descripcion: string | null },
): Promise<R<VariableNomina>> {
  const { sb, perfil } = await cliente();
  const concepto = fila.concepto.trim();
  if (!concepto) return { ok: false, error: "Indica el concepto" };
  if (!Number.isFinite(fila.importe)) return { ok: false, error: "El importe no es válido" };
  const campos = { ...fila, concepto, descripcion: fila.descripcion?.trim() || null };
  const q = id
    ? sb.from("rrhh_variables_nomina").update(campos).eq("id", id).select("*").single()
    : sb.from("rrhh_variables_nomina").insert({ ...campos, creado_por: perfil.id }).select("*").single();
  const { data, error } = await q;
  return error || !data ? { ok: false, error: error?.message || "No se pudo guardar" } : { ok: true, data: data as VariableNomina };
}

export async function borrarVariable(id: string): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb.from("rrhh_variables_nomina").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Comentario para la gestoría. Va en rrhh_nomina_comentarios (empleado, año, mes); vacío = se borra. */
export async function guardarComentario(empleadoId: string, anio: number, mes: number, comentario: string): Promise<R> {
  const { sb, perfil } = await cliente();
  const texto = comentario.trim();
  const { error } = texto
    ? await sb
        .from("rrhh_nomina_comentarios")
        .upsert(
          { empleado_id: empleadoId, anio, mes, comentario: texto, modificado_por: perfil.id, modificado_en: new Date().toISOString() },
          { onConflict: "empleado_id,anio,mes" },
        )
    : await sb.from("rrhh_nomina_comentarios").delete().eq("empleado_id", empleadoId).eq("anio", anio).eq("mes", mes);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ================= Plantilla (fijos discontinuos) ================= */

export type EmpleadoPlantilla = Pick<
  Tables<"empleados">,
  "id" | "nombre" | "apellidos" | "codigo_nomina" | "centro_principal_id" | "departamento" | "tipo_contrato" | "horas_semana" | "fecha_alta" | "fecha_baja"
>;
export type PeriodoMin = Pick<Tables<"rrhh_periodos_contrato">, "id" | "empleado_id" | "fecha_alta" | "fecha_baja" | "horas_semana">;

export async function datosPlantilla() {
  const { sb } = await cliente();
  const [emps, pers] = await Promise.all([
    sb
      .from("empleados")
      .select("id, nombre, apellidos, codigo_nomina, centro_principal_id, departamento, tipo_contrato, horas_semana, fecha_alta, fecha_baja")
      .order("apellidos")
      .order("nombre"),
    sb.from("rrhh_periodos_contrato").select("id, empleado_id, fecha_alta, fecha_baja, horas_semana").order("fecha_alta"),
  ]);
  const err = emps.error ?? pers.error;
  if (err) throw new Error(err.message);
  return {
    empleados: (emps.data ?? []) as EmpleadoPlantilla[],
    periodos: (pers.data ?? []) as PeriodoMin[],
  };
}
