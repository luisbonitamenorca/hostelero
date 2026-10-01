"use server";

/* Acciones de servidor de la sección Ajustes (plan 2.8).
   Todo pasa por el cliente autenticado: la RLS decide (solo gestores escriben aquí).
   Las acciones de catálogos simples (departamentos, contratos, matriz, tablets) siguen en ../acciones.ts. */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables } from "@hostelero/db";
import type { CentroConfig, Convenio } from "../tipos";

/** Solo dirección o administración (rrhh_es_gestor). exigirModulo deja pasar a encargados y la RLS de los
    catálogos no da error cuando no toca filas: sin esta comprobación una acción de varios pasos podría
    dejar datos a medias (p. ej. renombrar el texto de los turnos sin haber renombrado el catálogo). */
async function cliente() {
  const { supabase, perfil } = await exigirModulo("rrhh");
  const { data: gestor } = await supabase.rpc("rrhh_es_gestor");
  if (!gestor) throw new Error("Solo dirección o administración pueden cambiar los ajustes");
  return { sb: supabase, perfil };
}

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

/** Mensaje de error legible: las claves únicas (23505) se traducen; el resto va tal cual. */
const errorLegible = (e: { code?: string; message: string }, duplicado: string) => (e.code === "23505" ? duplicado : e.message);

export type PuestoCat = Tables<"rrhh_puestos_cat">;
export type TipoAusenciaCat = Tables<"rrhh_tipos_ausencia">;
export type Festivo = Tables<"rrhh_festivos">;
export type PlantillaTurno = Tables<"rrhh_plantillas_turno">;
export type PerfilMin = { id: string; nombre: string | null; correo: string; rol: string };
export type CentroAj = { id: string; nombre: string; lat: number | null; lng: number | null };

const ROLES_ENCARGADO = ["responsable_area", "jefe_sala"];

/* ================= Carga ================= */

/** Todo lo que necesita la sección, en una sola ida (las listas son cortas: < 200 filas cada una). */
export async function cargarAjustes() {
  const { sb, perfil } = await cliente();
  // centros, departamentos y perfiles tienen «or es_operador()» en su RLS: se filtra por cuenta para que un
  // operador no vea (ni escriba sobre) filas de otras cuentas.
  const cuenta = perfil.cuenta_id;
  const [convenios, centros, config, tiposAus, deptos, contratos, matriz, puestos, plantillas, encargados, operador] = await Promise.all([
    sb.from("rrhh_convenios").select("*").order("nombre"),
    sb.from("centros").select("id, nombre, lat, lng").eq("cuenta_id", cuenta).order("nombre"),
    sb.from("rrhh_centros_config").select("*"),
    sb.from("rrhh_tipos_ausencia").select("*").order("orden").order("nombre"),
    sb.from("departamentos").select("*").eq("cuenta_id", cuenta).order("orden").order("nombre"),
    sb.from("rrhh_tipos_contrato").select("*").order("orden").order("nombre"),
    sb.from("centros_departamentos").select("centro_id, departamento_id").eq("cuenta_id", cuenta),
    sb.from("rrhh_puestos_cat").select("*").order("orden").order("nombre"),
    sb.from("rrhh_plantillas_turno").select("*").order("orden").order("nombre"),
    sb.from("rrhh_encargados_centro").select("user_id, centro_id"),
    sb.rpc("es_operador"),
  ]);
  // Perfiles: la RLS solo deja leerlos a dirección (y al operador); a los demás no les da error, les
  // devuelve 0 filas. Por eso la visibilidad se deriva del rol, no del error.
  const perfilesVisibles = perfil.rol === "direccion" || !!operador.data;
  const idsEncargados = [...new Set((encargados.data ?? []).map((e) => e.user_id))];
  const [perfilesRol, perfilesExtra] = await Promise.all([
    sb.from("perfiles").select("id, nombre, correo, rol").eq("cuenta_id", cuenta).in("rol", ROLES_ENCARGADO).order("correo"),
    idsEncargados.length
      ? sb.from("perfiles").select("id, nombre, correo, rol").eq("cuenta_id", cuenta).in("id", idsEncargados)
      : Promise.resolve({ data: [] as PerfilMin[], error: null }),
  ]);
  const vistos = new Set<string>();
  const perfiles: PerfilMin[] = [];
  for (const p of [...(perfilesRol.data ?? []), ...(perfilesExtra.data ?? [])]) {
    if (!vistos.has(p.id)) { vistos.add(p.id); perfiles.push(p); }
  }

  return {
    convenios: (convenios.data ?? []) as Convenio[],
    centros: (centros.data ?? []) as CentroAj[],
    config: (config.data ?? []) as CentroConfig[],
    tiposAusencia: (tiposAus.data ?? []) as TipoAusenciaCat[],
    departamentos: deptos.data ?? [],
    tiposContrato: contratos.data ?? [],
    matriz: matriz.data ?? [],
    puestos: (puestos.data ?? []) as PuestoCat[],
    plantillas: (plantillas.data ?? []) as PlantillaTurno[],
    encargados: encargados.data ?? [],
    perfiles,
    perfilesVisibles,
  };
}

/* ================= Convenios ================= */

const DUP_CONVENIO = "Ya hay un convenio con ese nombre";

/** `es_por_defecto` no entra aquí: solo lo cambia marcarConvenioDefecto (así nunca hay dos por defecto). */
export type CamposConvenio = Partial<Omit<Convenio, "id" | "cuenta_id" | "creado_en" | "es_por_defecto">>;

export async function guardarConvenio(id: string, campos: CamposConvenio): Promise<R> {
  const { sb } = await cliente();
  if (campos.nombre !== undefined && !campos.nombre.trim()) return { ok: false, error: "El nombre no puede estar vacío" };
  // Tasa de coste de empresa (Skello: 32,15 %): la columna es not null; fuera de 0–100 es un error de tecleo.
  if (campos.coste_empresa_pct !== undefined) {
    const p = Number(campos.coste_empresa_pct);
    if (!Number.isFinite(p) || p < 0 || p > 100) return { ok: false, error: "El coste de empresa sobre el bruto tiene que estar entre 0 y 100 %" };
    campos.coste_empresa_pct = Math.round(p * 100) / 100;
  }
  const { error } = await sb.from("rrhh_convenios").update(campos).eq("id", id);
  return error ? { ok: false, error: errorLegible(error, DUP_CONVENIO) } : { ok: true };
}

/** Crea un convenio nuevo. Si `copiaDeId` viene, duplica sus reglas con el nombre nuevo. */
export async function crearConvenio(nombre: string, copiaDeId: string | null): Promise<R<string>> {
  const { sb } = await cliente();
  const n = nombre.trim();
  if (!n) return { ok: false, error: "Escribe un nombre" };
  let base: CamposConvenio = {};
  if (copiaDeId) {
    const { data } = await sb.from("rrhh_convenios").select("*").eq("id", copiaDeId).maybeSingle();
    if (data) {
      const { id: _id, cuenta_id: _c, creado_en: _e, nombre: _n, es_por_defecto: _d, ...resto } = data;
      void _id; void _c; void _e; void _n; void _d;
      base = resto;
    }
  }
  const { data, error } = await sb.from("rrhh_convenios").insert({ ...base, nombre: n, es_por_defecto: false }).select("id").single();
  return error || !data ? { ok: false, error: error ? errorLegible(error, DUP_CONVENIO) : undefined } : { ok: true, data: data.id };
}

/** Marca un convenio como el de la cuenta (el que usa un centro sin convenio propio). Dos sentencias:
    primero se marca el nuevo y después se desmarca el resto, así nunca hay un instante sin convenio por
    defecto (si fallara a medias, rrhh_convenio_centro caería a los valores fijos para todos los centros). */
export async function marcarConvenioDefecto(id: string): Promise<R> {
  const { sb } = await cliente();
  const { data: fila, error: e1 } = await sb.from("rrhh_convenios").update({ es_por_defecto: true }).eq("id", id).select("id");
  if (e1) return { ok: false, error: e1.message };
  if (!fila?.length) return { ok: false, error: "No encuentro ese convenio" };
  const { error: e2 } = await sb.from("rrhh_convenios").update({ es_por_defecto: false }).neq("id", id).eq("es_por_defecto", true);
  return e2 ? { ok: false, error: "Marcado, pero no se pudo desmarcar el anterior: " + e2.message } : { ok: true };
}

/* ================= Centros y fichaje ================= */

export type CamposCentroConfig = {
  radio_fichaje_m: number;
  convenio_id: string | null;
  pacto_descanso_10h: boolean;
  regla_horas: "planificado" | "fichado" | "plan_tolerancia";
  tolerancia_min: number;
  redondeo_min: 0 | 5 | 10 | 15;
  aviso_retraso_min: number;
};

/** Guarda las reglas del centro y, si han cambiado, sus coordenadas (centros solo lo edita el operador). */
export async function guardarCentroConfig(
  centroId: string,
  campos: CamposCentroConfig,
  geo: { lat: number | null; lng: number | null } | null,
): Promise<R<{ geoGuardada: boolean }>> {
  const { sb } = await cliente();
  if (![0, 5, 10, 15].includes(campos.redondeo_min)) return { ok: false, error: "El redondeo debe ser 0, 5, 10 o 15 minutos" };
  if (campos.tolerancia_min < 0 || campos.aviso_retraso_min < 0) return { ok: false, error: "Los minutos no pueden ser negativos" };
  if (!Number.isFinite(campos.radio_fichaje_m) || campos.radio_fichaje_m < 20) return { ok: false, error: "El radio de fichaje debe ser de al menos 20 m" };
  if (geo) {
    const { lat, lng } = geo;
    if ((lat == null) !== (lng == null)) return { ok: false, error: "Latitud y longitud van juntas: rellena las dos o ninguna" };
    if (lat != null && lng != null && (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)) {
      return { ok: false, error: "Coordenadas fuera de rango (latitud ±90, longitud ±180)" };
    }
  }
  const { error } = await sb.from("rrhh_centros_config").update(campos).eq("centro_id", centroId);
  if (error) return { ok: false, error: error.message };
  if (!geo) return { ok: true, data: { geoGuardada: true } };
  const { data: fila, error: e2 } = await sb.from("centros").update(geo).eq("id", centroId).select("id");
  // Sin permiso sobre `centros` la RLS no toca ninguna fila (no da error): se avisa.
  if (e2 || !fila?.length) return { ok: true, data: { geoGuardada: false } };
  return { ok: true, data: { geoGuardada: true } };
}

/* ================= Puestos ================= */

export type CamposPuesto = Partial<Pick<PuestoCat, "nombre" | "color" | "departamento_id" | "activo" | "orden">>;

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function guardarPuesto(id: string, campos: CamposPuesto): Promise<R> {
  const { sb } = await cliente();
  if (campos.nombre !== undefined) {
    campos.nombre = campos.nombre.replace(/\s+/g, " ").trim();
    if (!campos.nombre) return { ok: false, error: "El nombre no puede estar vacío" };
  }
  if (campos.color !== undefined && !HEX.test(campos.color)) return { ok: false, error: "Color no válido" };
  const { data: fila, error } = await sb.from("rrhh_puestos_cat").update(campos).eq("id", id).select("id");
  if (error) return { ok: false, error: errorLegible(error, "Ya hay un puesto con ese nombre") };
  // Si la RLS no deja tocar el catálogo no hay error, hay 0 filas: se para aquí, antes de tocar los turnos.
  if (!fila?.length) return { ok: false, error: "No encuentro ese puesto o no tienes permiso para cambiarlo" };
  // El texto `puesto` de los turnos se mantiene sincronizado con el catálogo (Ratios lo lee por nombre).
  // Todos los turnos con ese puesto_id (también los que tuvieran el texto a null).
  if (campos.nombre !== undefined) {
    const { error: e2 } = await sb.from("rrhh_turnos").update({ puesto: campos.nombre }).eq("puesto_id", id);
    if (e2) return { ok: false, error: "Puesto renombrado, pero no se pudo actualizar el texto de los turnos: " + e2.message };
  }
  return { ok: true };
}

export async function crearPuesto(input: { nombre: string; departamento_id: string | null; color: string }): Promise<R<string>> {
  const { sb } = await cliente();
  const nombre = input.nombre.replace(/\s+/g, " ").trim();
  if (!nombre) return { ok: false, error: "Escribe un nombre" };
  if (!HEX.test(input.color)) return { ok: false, error: "Color no válido" };
  const { data, error } = await sb
    .from("rrhh_puestos_cat")
    .insert({ nombre, departamento_id: input.departamento_id, color: input.color, activo: true, orden: 100 })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error ? errorLegible(error, "Ya hay un puesto con ese nombre") : undefined };
  return { ok: true, data: data.id };
}

/** Cuántas cosas apuntan a un puesto (para avisar antes de fusionar). */
export async function usoPuesto(id: string): Promise<{ turnos: number; empleados: number; plantillas: number }> {
  const { sb } = await cliente();
  const [t, e, p] = await Promise.all([
    sb.from("rrhh_turnos").select("id", { count: "exact", head: true }).eq("puesto_id", id),
    sb.from("empleados").select("id", { count: "exact", head: true }).eq("puesto_defecto_id", id),
    sb.from("rrhh_plantillas_turno").select("id", { count: "exact", head: true }).eq("puesto_id", id),
  ]);
  return { turnos: t.count ?? 0, empleados: e.count ?? 0, plantillas: p.count ?? 0 };
}

/**
 * Fusiona el puesto `origenId` en `destinoId`: reasigna turnos (puesto_id y texto), puesto por defecto
 * de los empleados y plantillas, y desactiva el origen.
 *
 * RIESGO: son varias sentencias sin transacción (PostgREST no las agrupa). Si una falla a medias, los
 * turnos ya movidos se quedan en el destino y el origen sigue activo. Se hace en este orden (datos primero,
 * desactivar al final) para que repetir la fusión termine el trabajo sin romper nada: cada paso es
 * idempotente. Cada turno tocado deja su fila en rrhh_turnos_historial (trigger), así se puede auditar.
 */
export async function fusionarPuestos(origenId: string, destinoId: string): Promise<R<{ turnos: number; empleados: number; plantillas: number }>> {
  const { sb } = await cliente();
  if (origenId === destinoId) return { ok: false, error: "Elige un puesto distinto" };
  const { data: ambos, error: e0 } = await sb.from("rrhh_puestos_cat").select("id, nombre, activo").in("id", [origenId, destinoId]);
  if (e0) return { ok: false, error: e0.message };
  const origen = ambos?.find((p) => p.id === origenId);
  const destino = ambos?.find((p) => p.id === destinoId);
  if (!origen || !destino) return { ok: false, error: "No encuentro alguno de los dos puestos" };
  if (!destino.activo) return { ok: false, error: "El puesto de destino está desactivado: actívalo primero" };

  // 0. Comprobar que se puede escribir en el catálogo ANTES de tocar turnos: la RLS no da error cuando no
  //    toca filas, devuelve 0. Es un update sin cambios (el destino ya está activo).
  const { data: permiso, error: ePerm } = await sb.from("rrhh_puestos_cat").update({ activo: true }).eq("id", destinoId).select("id");
  if (ePerm) return { ok: false, error: ePerm.message };
  if (!permiso?.length) return { ok: false, error: "No tienes permiso para cambiar el catálogo de puestos" };

  const uso = await usoPuesto(origenId);

  // 1. Turnos por id de puesto (y los que solo llevan el texto exacto, por si quedó alguno sin casar).
  const { error: e1 } = await sb.from("rrhh_turnos").update({ puesto_id: destinoId, puesto: destino.nombre }).eq("puesto_id", origenId);
  if (e1) return { ok: false, error: "Al mover los turnos: " + e1.message };
  const { error: e1b } = await sb.from("rrhh_turnos").update({ puesto_id: destinoId, puesto: destino.nombre }).is("puesto_id", null).eq("puesto", origen.nombre);
  if (e1b) return { ok: false, error: "Turnos movidos, pero falló el casado por texto: " + e1b.message };
  // 2. Puesto por defecto de los empleados.
  const { error: e2 } = await sb.from("empleados").update({ puesto_defecto_id: destinoId }).eq("puesto_defecto_id", origenId);
  if (e2) return { ok: false, error: "Turnos movidos, pero no se pudo cambiar el puesto por defecto de los empleados: " + e2.message };
  // 3. Plantillas de turno.
  const { error: e3 } = await sb.from("rrhh_plantillas_turno").update({ puesto_id: destinoId }).eq("puesto_id", origenId);
  if (e3) return { ok: false, error: "Turnos y empleados movidos, pero no las plantillas: " + e3.message };
  // 4. Desactivar el origen (no se borra: queda como rastro y por si alguien lo tenía en un modelo de semana).
  const { data: f4, error: e4 } = await sb.from("rrhh_puestos_cat").update({ activo: false }).eq("id", origenId).select("id");
  if (e4) return { ok: false, error: "Todo movido, pero no se pudo desactivar el origen: " + e4.message };
  if (!f4?.length) return { ok: false, error: "Todo movido, pero el origen no se ha desactivado (sin permiso o ya no existe)" };
  return { ok: true, data: uso };
}

/* ================= Tipos de ausencia ================= */

export type CamposTipoAusencia = Partial<
  Pick<TipoAusenciaCat, "nombre" | "categoria" | "color" | "codigo" | "computa_contador" | "computa_vacaciones" | "solicitable_empleado" | "requiere_justificante" | "activo" | "orden">
>;

const DUP_TIPO = "Ya hay un tipo de ausencia con ese nombre";
const CATEGORIAS_AUSENCIA = ["retribuida_empresa", "retribuida_terceros", "no_retribuida", "neutra"] as const;
export type CategoriaAusencia = (typeof CATEGORIAS_AUSENCIA)[number];

export async function guardarTipoAusencia(id: string, campos: CamposTipoAusencia): Promise<R> {
  const { sb } = await cliente();
  if (campos.nombre !== undefined && !campos.nombre.trim()) return { ok: false, error: "El nombre no puede estar vacío" };
  if (campos.categoria !== undefined && !(CATEGORIAS_AUSENCIA as readonly string[]).includes(campos.categoria)) return { ok: false, error: "Categoría no válida" };
  if (campos.color && !HEX.test(campos.color)) return { ok: false, error: "Color no válido" };
  if (campos.codigo !== undefined) campos.codigo = campos.codigo?.trim().toUpperCase().slice(0, 8) || null;
  const { error } = await sb.from("rrhh_tipos_ausencia").update(campos).eq("id", id);
  return error ? { ok: false, error: errorLegible(error, DUP_TIPO) } : { ok: true };
}

export async function crearTipoAusencia(input: {
  nombre: string;
  categoria: CategoriaAusencia;
  color: string;
  codigo: string | null;
  computa_contador: boolean;
  computa_vacaciones: boolean;
  solicitable_empleado: boolean;
  requiere_justificante: boolean;
}): Promise<R<string>> {
  const { sb } = await cliente();
  const nombre = input.nombre.trim();
  if (!nombre) return { ok: false, error: "Escribe un nombre" };
  if (!HEX.test(input.color)) return { ok: false, error: "Color no válido" };
  const { data, error } = await sb
    .from("rrhh_tipos_ausencia")
    .insert({ ...input, nombre, codigo: input.codigo?.trim().toUpperCase().slice(0, 8) || null, activo: true, orden: 200 })
    .select("id")
    .single();
  return error || !data ? { ok: false, error: error ? errorLegible(error, DUP_TIPO) : undefined } : { ok: true, data: data.id };
}

/* ================= Festivos ================= */

export async function listarFestivos(anio: number): Promise<Festivo[]> {
  const { sb } = await cliente();
  const { data } = await sb
    .from("rrhh_festivos")
    .select("*")
    .gte("fecha", `${anio}-01-01`)
    .lte("fecha", `${anio}-12-31`)
    .order("fecha")
    .order("ambito")
    .limit(1000);
  return (data ?? []) as Festivo[];
}

export async function crearFestivo(input: { fecha: string; nombre: string; ambito: "nacional" | "autonomico" | "local"; centro_id: string | null }): Promise<R> {
  const { sb } = await cliente();
  const nombre = input.nombre.trim();
  if (!nombre) return { ok: false, error: "Escribe el nombre del festivo" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha)) return { ok: false, error: "Fecha no válida" };
  if (input.ambito === "local" && !input.centro_id) return { ok: false, error: "Un festivo local necesita centro" };
  const { error } = await sb.from("rrhh_festivos").insert({
    fecha: input.fecha,
    nombre,
    ambito: input.ambito,
    centro_id: input.ambito === "local" ? input.centro_id : null,
    activo: true,
  });
  // El índice único es (cuenta, fecha, centro): un nacional y un autonómico el mismo día chocan aunque el ámbito sea distinto.
  if (error) return { ok: false, error: errorLegible(error, input.ambito === "local" ? "Ya hay un festivo ese día en ese centro; edítalo" : "Ya hay un festivo de cuenta ese día (nacional o autonómico); edítalo o cámbiale el centro") };
  return { ok: true };
}

export async function guardarFestivo(id: string, campos: { activo?: boolean; nombre?: string; comentario?: string | null }): Promise<R> {
  const { sb } = await cliente();
  if (campos.nombre !== undefined && !campos.nombre.trim()) return { ok: false, error: "El nombre no puede estar vacío" };
  const { error } = await sb.from("rrhh_festivos").update(campos).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function borrarFestivo(id: string): Promise<R> {
  const { sb } = await cliente();
  const { data, error } = await sb.from("rrhh_festivos").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  return data?.length ? { ok: true } : { ok: false, error: "No se ha quitado nada: ya no existe o no tienes permiso" };
}

/* ================= Plantillas de turno ================= */

export type CamposPlantilla = {
  nombre: string;
  centro_id: string | null;
  hora_inicio: string;
  hora_fin: string;
  pausa_min: number;
  puesto_id: string | null;
  orden: number;
  activo: boolean;
};

export async function guardarPlantilla(id: string | null, fila: CamposPlantilla): Promise<R<string>> {
  const { sb } = await cliente();
  const nombre = fila.nombre.trim();
  if (!nombre) return { ok: false, error: "Escribe un nombre" };
  if (!/^\d{2}:\d{2}/.test(fila.hora_inicio) || !/^\d{2}:\d{2}/.test(fila.hora_fin)) return { ok: false, error: "Horas no válidas" };
  if (fila.pausa_min < 0) return { ok: false, error: "La pausa no puede ser negativa" };
  const datos = { ...fila, nombre, hora_inicio: fila.hora_inicio.slice(0, 5), hora_fin: fila.hora_fin.slice(0, 5) };
  if (id) {
    const { error } = await sb.from("rrhh_plantillas_turno").update(datos).eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true, data: id };
  }
  const { data, error } = await sb.from("rrhh_plantillas_turno").insert(datos).select("id").single();
  return error || !data ? { ok: false, error: error?.message } : { ok: true, data: data.id };
}

export async function borrarPlantilla(id: string): Promise<R> {
  const { sb } = await cliente();
  const { data, error } = await sb.from("rrhh_plantillas_turno").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  return data?.length ? { ok: true } : { ok: false, error: "No se ha quitado nada: ya no existe o no tienes permiso" };
}

/* ================= Encargados por centro ================= */

export async function toggleEncargado(userId: string, centroId: string, activo: boolean): Promise<R> {
  const { sb } = await cliente();
  if (activo) {
    const { error } = await sb.from("rrhh_encargados_centro").insert({ user_id: userId, centro_id: centroId });
    if (error && error.code === "23505") return { ok: true }; // ya estaba
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  const { data, error } = await sb.from("rrhh_encargados_centro").delete().eq("user_id", userId).eq("centro_id", centroId).select("user_id");
  if (error) return { ok: false, error: error.message };
  return data?.length ? { ok: true } : { ok: false, error: "No se ha quitado nada: ya no estaba o no tienes permiso" };
}
