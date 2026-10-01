"use server";

import { crearClienteServidor } from "@/lib/supabase/server";
import type { Tables } from "@hostelero/db";
import { finAbsoluto, minutos } from "../rrhh/tipos";

// Acciones de la app del empleado. Todo con el cliente autenticado: la RLS
// limita a "lo suyo" (turnos publicados, huecos de sus centros, sus fichajes,
// sus ausencias, sus cambios de turno y sus disponibilidades).
//
// Lecturas: si Supabase devuelve error se lanza (la pestaña enseña «No se pudo
// cargar» con Reintentar) en vez de devolver una lista vacía que se confunde
// con «no tienes nada». Escrituras: devuelven R con un mensaje en castellano.

export type PuestoMin = { nombre: string; color: string } | null;
export type Turno = Tables<"rrhh_turnos"> & { centros?: { nombre: string } | null; rrhh_puestos_cat?: PuestoMin };
export type Fichaje = Tables<"rrhh_fichajes">;
export type TipoAusenciaMin = { nombre: string; color: string | null } | null;
export type Ausencia = Tables<"rrhh_ausencias"> & { rrhh_tipos_ausencia?: TipoAusenciaMin };
export type TipoAusencia = Pick<Tables<"rrhh_tipos_ausencia">, "id" | "nombre" | "color" | "computa_vacaciones" | "requiere_justificante">;
export type Festivo = Pick<Tables<"rrhh_festivos">, "fecha" | "nombre" | "ambito" | "centro_id">;
export type Cambio = Tables<"rrhh_cambios_turno"> & {
  rrhh_turnos?: (Pick<Tables<"rrhh_turnos">, "id" | "fecha" | "hora_inicio" | "hora_fin" | "puesto" | "centro_id"> & { centros?: { nombre: string } | null }) | null;
  solicitante?: { nombre: string; apellidos: string | null } | null;
  destinatario?: { nombre: string; apellidos: string | null } | null;
};
export type Companero = { id: string; nombre: string };
export type Disponibilidad = Tables<"rrhh_disponibilidades">;
export type SaldoVacaciones = { derecho_anual: number; devengado_hoy: number; disfrutados: number; pendientes_aprobar: number; resto: number };
export type SemanaResumen = { anio: number; semana: number; lunes: string; horas_contrato: number; horas_plan: number; horas_retenidas: number; horas_ausencia_contador: number; diferencia: number };
export type R<T = undefined> = { ok: boolean; error?: string; data?: T };

const SEL_TURNO = "*, centros(nombre), rrhh_puestos_cat(nombre, color)";
// En una sola cadena literal: concatenar con + la convierte en `string` y el parser de tipos de supabase-js deja de entenderla.
const SEL_CAMBIO =
  "*, rrhh_turnos(id, fecha, hora_inicio, hora_fin, puesto, centro_id, centros(nombre)), solicitante:empleados!rrhh_cambios_turno_solicitante_id_fkey(nombre, apellidos), destinatario:empleados!rrhh_cambios_turno_destinatario_id_fkey(nombre, apellidos)";

async function contexto() {
  const sb = await crearClienteServidor();
  const { data: empId } = await sb.rpc("mi_empleado_id");
  return { sb, empId: (empId as string | null) ?? null };
}

/* ---------- Fechas en hora española (el servidor de Vercel va en UTC) ---------- */
const TZ = "Europe/Madrid";
const hoyIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const sumaDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dowDe = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = domingo
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const hh = (t: { hora_inicio: string; hora_fin: string }) => `${t.hora_inicio.slice(0, 5)} a ${t.hora_fin.slice(0, 5)}`;

/* ---------- Errores ---------- */
type ErrPg = { code?: string; message: string };

/** Mensaje para el empleado: los RAISE de los triggers ya van en castellano; el resto se traduce. */
function msg(e: ErrPg): string {
  if (e.code === "P0001") return e.message;
  if (e.code === "42501" || /row-level security/i.test(e.message)) return "No tienes permiso para hacer esto";
  if (e.code === "23505") return "Ya existe una petición igual";
  if (e.code === "23514") return "No se pudo guardar: revisa los datos";
  console.error("[empleado]", e.code, e.message);
  return "No se pudo guardar. Inténtalo de nuevo";
}

/** Lecturas: con error, se lanza (el cliente lo enseña como «No se pudo cargar»). */
function lista<T>(r: { data: T[] | null; error: ErrPg | null }, que: string): T[] {
  if (r.error) {
    console.error(`[empleado] ${que}:`, r.error.code, r.error.message);
    throw new Error("No se pudo cargar");
  }
  return r.data ?? [];
}

/* ==================== Turnos ==================== */

/** Turnos publicados, ausencias aprobadas y festivos activos del rango. Los cambios de turno van en misCambios(). */
export async function misTurnos(desde: string, hasta: string) {
  const { sb, empId } = await contexto();
  const vacio = { turnos: [] as Turno[], ausencias: [] as Ausencia[], festivos: [] as Festivo[] };
  if (!empId) return vacio;
  const [turnos, ausencias, festivos] = await Promise.all([
    sb.from("rrhh_turnos").select(SEL_TURNO).eq("empleado_id", empId).gte("fecha", desde).lte("fecha", hasta).order("fecha").order("hora_inicio"),
    sb
      .from("rrhh_ausencias")
      .select("*, rrhh_tipos_ausencia(nombre, color)")
      .eq("empleado_id", empId)
      .eq("estado", "aprobada")
      .lte("fecha_inicio", hasta)
      .gte("fecha_fin", desde),
    sb.from("rrhh_festivos").select("fecha, nombre, ambito, centro_id").eq("activo", true).gte("fecha", desde).lte("fecha", hasta).order("fecha"),
  ]);
  return {
    turnos: lista(turnos, "turnos") as Turno[],
    ausencias: lista(ausencias, "ausencias") as Ausencia[],
    festivos: lista(festivos, "festivos") as Festivo[],
  };
}

/** Huecos: turnos publicados sin empleado en mis centros, de hoy al domingo de la semana que viene (la RLS filtra los centros). */
export async function huecos(): Promise<Turno[]> {
  const { sb, empId } = await contexto();
  if (!empId) return [];
  const hoy = hoyIso();
  const domingoProx = sumaDias(hoy, ((7 - dowDe(hoy)) % 7) + 7);
  const r = await sb
    .from("rrhh_turnos")
    .select(SEL_TURNO)
    .is("empleado_id", null)
    .eq("estado", "publicado")
    .gte("fecha", hoy)
    .lte("fecha", domingoProx)
    .order("fecha")
    .order("hora_inicio");
  return lista(r, "huecos") as Turno[];
}

/**
 * Apuntarme a un hueco: me asigno el turno (política rrhh_turnos_hueco_apuntarse; el trigger
 * trg_rrhh_turnos_guard_apuntarse impide tocar nada más). Queda en rrhh_turnos_historial con mi user_id.
 * Antes se comprueba que no se pise con un turno mío publicado (mismo día, víspera o día siguiente
 * si cruzan medianoche): ni la política ni el trigger lo miran.
 */
export async function apuntarmeHueco(turnoId: string): Promise<R> {
  const { sb, empId } = await contexto();
  if (!empId) return { ok: false, error: "Sin ficha de empleado" };

  const { data: hueco, error: eH } = await sb.from("rrhh_turnos").select("fecha, hora_inicio, hora_fin").eq("id", turnoId).is("empleado_id", null).maybeSingle();
  if (eH) return { ok: false, error: msg(eH) };
  if (!hueco) return { ok: false, error: "Ese hueco ya no está libre" };

  const { data: mios, error: eM } = await sb
    .from("rrhh_turnos")
    .select("fecha, hora_inicio, hora_fin, centros(nombre)")
    .eq("empleado_id", empId)
    .eq("estado", "publicado")
    .gte("fecha", sumaDias(hueco.fecha, -1))
    .lte("fecha", sumaDias(hueco.fecha, 1));
  if (eM) return { ok: false, error: msg(eM) };
  const h0 = minutos(hueco.hora_inicio);
  const h1 = finAbsoluto(hueco);
  const solapa = (mios ?? []).find((t) => {
    const off = t.fecha < hueco.fecha ? -1440 : t.fecha > hueco.fecha ? 1440 : 0;
    return minutos(t.hora_inicio) + off < h1 && h0 < finAbsoluto(t) + off;
  });
  if (solapa) {
    const donde = solapa.centros?.nombre ? ` en ${solapa.centros.nombre}` : "";
    const ddmm = `${solapa.fecha.slice(8, 10)}/${solapa.fecha.slice(5, 7)}`;
    return {
      ok: false,
      error: solapa.fecha === hueco.fecha ? `Ese día ya tienes turno de ${hh(solapa)}${donde}` : `Se pisa con tu turno del ${ddmm} de ${hh(solapa)}${donde}`,
    };
  }

  const { data, error } = await sb.from("rrhh_turnos").update({ empleado_id: empId }).eq("id", turnoId).is("empleado_id", null).select("id");
  if (error) return { ok: false, error: msg(error) };
  if (!data?.length) return { ok: false, error: "Ese hueco ya no está libre" };
  return { ok: true };
}

/** Compañeros de mis centros (solo id y nombre). Necesita la RPC rrhh_companeros_centro (ver informe); si no existe, lista vacía. */
export async function companeros(): Promise<Companero[]> {
  const { sb, empId } = await contexto();
  if (!empId) return [];
  // La RPC aún no está en los tipos generados: llamada sin tipar y tolerante a que no exista.
  const rpc = sb.rpc.bind(sb) as unknown as (fn: string) => PromiseLike<{ data: unknown; error: unknown }>;
  const { data, error } = await rpc("rrhh_companeros_centro");
  if (error || !Array.isArray(data)) return [];
  return (data as { id: string; nombre: string; apellidos: string | null }[])
    .filter((c) => c.id !== empId)
    .map((c) => ({ id: c.id, nombre: [c.nombre, c.apellidos].filter(Boolean).join(" ") }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Pedir cambio de un turno mío publicado: a un compañero concreto o abierto (destinatario null). */
export async function pedirCambio(turnoId: string, destinatarioId: string | null, nota: string): Promise<R> {
  const { sb, empId } = await contexto();
  if (!empId) return { ok: false, error: "Sin ficha de empleado" };
  // No hay unique en la base: dos toques seguidos dejarían una petición «fantasma» que solo ve el gestor.
  const { data: abierta, error: eA } = await sb
    .from("rrhh_cambios_turno")
    .select("id")
    .eq("turno_id", turnoId)
    .eq("solicitante_id", empId)
    .in("estado", ["pendiente", "aceptado_companero"])
    .limit(1);
  if (eA) return { ok: false, error: msg(eA) };
  if (abierta?.length) return { ok: false, error: "Ya tienes una petición abierta para este turno" };
  const { error } = await sb.from("rrhh_cambios_turno").insert({
    turno_id: turnoId,
    solicitante_id: empId,
    destinatario_id: destinatarioId,
    estado: "pendiente",
    nota: nota.trim() || null,
  });
  return error ? { ok: false, error: msg(error) } : { ok: true };
}

/** Cambios donde soy solicitante o destinatario (la RLS decide), más recientes primero. */
export async function misCambios(): Promise<Cambio[]> {
  const { sb, empId } = await contexto();
  if (!empId) return [];
  const r = await sb.from("rrhh_cambios_turno").select(SEL_CAMBIO).order("creado_en", { ascending: false }).limit(50);
  return lista(r, "cambios") as Cambio[];
}

/** El destinatario acepta/rechaza; el solicitante cancela. El trigger de la base vigila las transiciones. */
export async function responderCambio(id: string, estado: "aceptado_companero" | "rechazado" | "cancelado"): Promise<R> {
  const { sb, empId } = await contexto();
  if (!empId) return { ok: false, error: "Sin ficha de empleado" };
  const { data, error } = await sb.from("rrhh_cambios_turno").update({ estado }).eq("id", id).select("id");
  if (error) return { ok: false, error: msg(error) };
  if (!data?.length) return { ok: false, error: "La petición ya no está disponible" };
  return { ok: true };
}

/* ==================== Fichar ==================== */

export async function misFichajes(desdeISO: string): Promise<Fichaje[]> {
  const { sb, empId } = await contexto();
  if (!empId) return [];
  const r = await sb.from("rrhh_fichajes").select("*").eq("empleado_id", empId).gte("ts", desdeISO).order("ts");
  return lista(r, "fichajes") as Fichaje[];
}

/**
 * Mi contrato: horas semanales vigentes hoy y horas del mes (anio, mes 1-12) con el mismo criterio
 * que rrhh_informe_nomina: Σ horas_semana × 52/12 × días del periodo dentro del mes / días del mes
 * (periodos sin solapes de rrhh_periodos_efectivos). null si no hay periodos.
 */
export async function miContrato(anio: number, mes: number): Promise<{ semana: number | null; mes: number | null }> {
  const { sb, empId } = await contexto();
  if (!empId) return { semana: null, mes: null };
  const [sem, per] = await Promise.all([
    sb.rpc("rrhh_horas_vigentes", { emp: empId, dia: hoyIso() }),
    sb.rpc("rrhh_periodos_efectivos", { p_empleado_id: empId }),
  ]);
  const semana = sem.error || sem.data == null ? null : Number(sem.data);
  if (per.error) {
    console.error("[empleado] periodos:", per.error.message);
    return { semana, mes: null };
  }
  const mm = String(mes).padStart(2, "0");
  const diasMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const desde = `${anio}-${mm}-01`;
  const hasta = `${anio}-${mm}-${String(diasMes).padStart(2, "0")}`;
  let total = 0;
  let hay = false;
  for (const p of per.data ?? []) {
    const ini = p.fecha_alta && p.fecha_alta > desde ? p.fecha_alta : desde;
    const fin = p.fecha_baja && p.fecha_baja < hasta ? p.fecha_baja : hasta;
    if (ini > fin) continue;
    total += ((Number(p.horas_semana) || 0) * 52 / 12) * ((diasEntre(ini, fin) + 1) / diasMes);
    hay = true;
  }
  return { semana, mes: hay ? Math.round(total * 100) / 100 : null };
}

/**
 * Fichaje móvil con geolocalización: dentro_radio se calcula en el servidor.
 * Se comprueba aquí (y lo repite la política rrhh_fichajes_propio_movil) que tengo fichaje móvil
 * activado y que el centro es uno de los míos. Si el centro no tiene coordenadas no hay radio que
 * comprobar: se registra con dentro_radio = true y una nota, y se avisa al empleado.
 */
export async function ficharMovil(input: {
  centroId: string;
  tipo: "entrada" | "salida" | "pausa_inicio" | "pausa_fin";
  lat: number;
  lng: number;
}): Promise<R<{ dentro: boolean; sinUbicacion: boolean }>> {
  const { sb, empId } = await contexto();
  if (!empId) return { ok: false, error: "Sin ficha de empleado" };
  if (!input.centroId) return { ok: false, error: "Elige el centro en el que estás" };
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) return { ok: false, error: "No he recibido tu ubicación. Inténtalo de nuevo" };

  const [yo, misCentros, centro, cfg] = await Promise.all([
    sb.from("empleados").select("fichaje_movil, fecha_baja").eq("id", empId).maybeSingle(),
    sb.rpc("rrhh_mis_centros"),
    sb.from("centros").select("lat, lng").eq("id", input.centroId).maybeSingle(),
    sb.from("rrhh_centros_config").select("radio_fichaje_m").eq("centro_id", input.centroId).maybeSingle(),
  ]);
  if (!yo.data?.fichaje_movil) return { ok: false, error: "El fichaje desde el móvil no está activado en tu ficha. Ficha en la tablet o habla con tu encargado" };
  if (yo.data.fecha_baja && yo.data.fecha_baja <= hoyIso()) return { ok: false, error: "Tu ficha está de baja: habla con tu encargado" };
  if (!(misCentros.data ?? []).includes(input.centroId)) return { ok: false, error: "Ese centro no es uno de los tuyos" };
  if (!centro.data) return { ok: false, error: "No encuentro ese centro" };

  let dentro = true;
  let sinUbicacion = false;
  if (centro.data.lat != null && centro.data.lng != null) {
    const R = 6371000;
    const r = (x: number) => (x * Math.PI) / 180;
    const dLat = r(centro.data.lat - input.lat);
    const dLng = r(centro.data.lng - input.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(input.lat)) * Math.cos(r(centro.data.lat)) * Math.sin(dLng / 2) ** 2;
    const dist = 2 * R * Math.asin(Math.sqrt(a));
    dentro = dist <= (cfg.data?.radio_fichaje_m ?? 150);
  } else {
    sinUbicacion = true;
  }
  const { error } = await sb.from("rrhh_fichajes").insert({
    empleado_id: empId,
    centro_id: input.centroId,
    tipo: input.tipo,
    metodo: "movil_geo",
    lat: input.lat,
    lng: input.lng,
    dentro_radio: dentro,
    nota: sinUbicacion ? "Centro sin ubicación configurada: radio no comprobado" : null,
  });
  return error ? { ok: false, error: msg(error) } : { ok: true, data: { dentro, sinUbicacion } };
}

/* ==================== Ausencias ==================== */

export async function misAusencias(): Promise<Ausencia[]> {
  const { sb, empId } = await contexto();
  if (!empId) return [];
  const r = await sb
    .from("rrhh_ausencias")
    .select("*, rrhh_tipos_ausencia(nombre, color)")
    .eq("empleado_id", empId)
    .order("fecha_inicio", { ascending: false })
    .limit(30);
  return lista(r, "ausencias") as Ausencia[];
}

/** Tipos que el empleado puede pedir (catálogo: activos y solicitables). */
export async function tiposAusencia(): Promise<TipoAusencia[]> {
  const { sb } = await contexto();
  const r = await sb
    .from("rrhh_tipos_ausencia")
    .select("id, nombre, color, computa_vacaciones, requiere_justificante")
    .eq("activo", true)
    .eq("solicitable_empleado", true)
    .order("orden")
    .order("nombre");
  return lista(r, "tipos de ausencia") as TipoAusencia[];
}

export async function saldoVacaciones(anio: number): Promise<SaldoVacaciones | null> {
  const { sb, empId } = await contexto();
  if (!empId) return null;
  const { data, error } = await sb.rpc("rrhh_saldo_vacaciones", { p_empleado_id: empId, p_anio: anio });
  if (error) {
    console.error("[empleado] saldo vacaciones:", error.message);
    throw new Error("No se pudo cargar");
  }
  if (!data?.length) return null;
  const s = data[0];
  return {
    derecho_anual: Number(s.derecho_anual) || 0,
    devengado_hoy: Number(s.devengado_hoy) || 0,
    disfrutados: Number(s.disfrutados) || 0,
    pendientes_aprobar: Number(s.pendientes_aprobar) || 0,
    resto: Number(s.resto) || 0,
  };
}

export async function solicitarAusencia(input: { tipoId: string; desde: string; hasta: string; medioDia: boolean; nota: string }): Promise<R> {
  const { sb, empId } = await contexto();
  if (!empId) return { ok: false, error: "Sin ficha de empleado" };
  if (!input.tipoId) return { ok: false, error: "Elige el tipo" };
  if (!input.desde || !input.hasta || input.hasta < input.desde) return { ok: false, error: "Revisa las fechas" };
  if (input.medioDia && input.desde !== input.hasta) return { ok: false, error: "Medio día solo vale para un día" };
  const {
    data: { user },
  } = await sb.auth.getUser();
  // `tipo` (enum antiguo) lo deriva el trigger trg_rrhh_ausencias_derivar_tipo a partir de tipo_id.
  const { error } = await sb.from("rrhh_ausencias").insert({
    empleado_id: empId,
    tipo_id: input.tipoId,
    tipo: "otro",
    fecha_inicio: input.desde,
    fecha_fin: input.hasta,
    medio_dia: input.medioDia,
    nota: input.nota.trim() || null,
    estado: "solicitada",
    solicitada_por: user?.id ?? null,
  });
  return error ? { ok: false, error: msg(error) } : { ok: true };
}

/** Cancelar una solicitud propia que aún está en estado solicitada (política rrhh_ausencias_propio_cancelar). */
export async function cancelarAusencia(id: string): Promise<R> {
  const { sb, empId } = await contexto();
  if (!empId) return { ok: false, error: "Sin ficha de empleado" };
  const { data, error } = await sb.from("rrhh_ausencias").delete().eq("id", id).eq("estado", "solicitada").select("id");
  if (error) return { ok: false, error: msg(error) };
  if (!data?.length) return { ok: false, error: "Ya no se puede cancelar: tu encargado la ha resuelto" };
  return { ok: true };
}

/* ==================== Horas ==================== */

/** Saldo del contador y resumen por semana del rango (RPC rrhh_saldo_horas / rrhh_resumen_semana con mi id). */
export async function misHoras(desde: string, hasta: string): Promise<{ saldo: number | null; semanas: SemanaResumen[]; origen: "rpc" | "cliente" }> {
  const { sb, empId } = await contexto();
  if (!empId) return { saldo: null, semanas: [], origen: "rpc" };
  const [saldo, resumen] = await Promise.all([
    sb.rpc("rrhh_saldo_horas", { p_empleado_id: empId, p_hasta: hoyIso() }),
    // p_centro_id va primero y sin default en la función: null = todos mis centros.
    sb.rpc("rrhh_resumen_semana", { p_centro_id: null as unknown as string, p_desde: desde, p_hasta: hasta, p_empleado_id: empId }),
  ]);
  if (saldo.error) console.error("[empleado] saldo horas:", saldo.error.message);
  const saldoN = saldo.error || saldo.data == null ? null : Number(saldo.data);
  if (!resumen.error) {
    const semanas = (resumen.data ?? [])
      .map((r) => ({
        anio: r.anio,
        semana: r.semana,
        lunes: r.lunes,
        horas_contrato: Number(r.horas_contrato) || 0,
        horas_plan: Number(r.horas_plan) || 0,
        horas_retenidas: Number(r.horas_retenidas) || 0,
        horas_ausencia_contador: Number(r.horas_ausencia_contador) || 0,
        diferencia: Number(r.diferencia) || 0,
      }))
      .sort((a, b) => (a.lunes < b.lunes ? 1 : -1));
    return { saldo: saldoN, semanas, origen: "rpc" };
  }
  console.error("[empleado] resumen semana:", resumen.error.message);
  // Si la RPC falla, cálculo de respaldo con mis turnos publicados y mi contrato vigente cada lunes.
  const turnosR = await sb
    .from("rrhh_turnos")
    .select("fecha, hora_inicio, hora_fin, pausa_min")
    .eq("empleado_id", empId)
    .eq("estado", "publicado")
    .gte("fecha", desde)
    .lte("fecha", hasta);
  const turnos = lista(turnosR, "turnos (respaldo horas)");
  const porLunes = new Map<string, number>();
  for (const t of turnos) {
    const lunes = sumaDias(t.fecha, -((dowDe(t.fecha) + 6) % 7));
    const [hi, mi] = t.hora_inicio.split(":").map(Number);
    const [hf, mf] = t.hora_fin.split(":").map(Number);
    let dur = hf * 60 + mf - (hi * 60 + mi);
    if (dur <= 0) dur += 1440;
    porLunes.set(lunes, (porLunes.get(lunes) ?? 0) + Math.max(0, dur - (t.pausa_min || 0)) / 60);
  }
  const lunes = [...porLunes.keys()].sort();
  const contratos = await Promise.all(lunes.map((l) => sb.rpc("rrhh_horas_vigentes", { emp: empId, dia: l })));
  const semanas = lunes
    .map((l, i) => {
      const plan = Math.round((porLunes.get(l) ?? 0) * 100) / 100;
      const contrato = Number(contratos[i].data) || 0;
      const jueves = sumaDias(l, 3);
      const anio = Number(jueves.slice(0, 4));
      const semana = Math.ceil((diasEntre(`${anio}-01-01`, jueves) + 1) / 7);
      return { anio, semana, lunes: l, horas_contrato: contrato, horas_plan: plan, horas_retenidas: plan, horas_ausencia_contador: 0, diferencia: Math.round((plan - contrato) * 100) / 100 };
    })
    .reverse();
  return { saldo: saldoN, semanas, origen: "cliente" };
}

/* ==================== Disponibilidades ==================== */

export async function misDisponibilidades(desde: string, hasta: string): Promise<Disponibilidad[]> {
  const { sb, empId } = await contexto();
  if (!empId) return [];
  const r = await sb.from("rrhh_disponibilidades").select("*").eq("empleado_id", empId).gte("fecha", desde).lte("fecha", hasta);
  return lista(r, "disponibilidades") as Disponibilidad[];
}

/** Marca un día (no_disponible / prefiere) o lo deja en blanco (tipo null = borrar). */
export async function marcarDisponibilidad(fecha: string, tipo: "no_disponible" | "prefiere" | null, nota?: string): Promise<R> {
  const { sb, empId } = await contexto();
  if (!empId) return { ok: false, error: "Sin ficha de empleado" };
  if (tipo === null) {
    const { error } = await sb.from("rrhh_disponibilidades").delete().eq("empleado_id", empId).eq("fecha", fecha);
    return error ? { ok: false, error: msg(error) } : { ok: true };
  }
  const { error } = await sb
    .from("rrhh_disponibilidades")
    .upsert({ empleado_id: empId, fecha, tipo, nota: nota?.trim() || null }, { onConflict: "empleado_id,fecha" });
  return error ? { ok: false, error: msg(error) } : { ok: true };
}
