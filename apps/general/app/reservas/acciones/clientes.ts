"use server";

/* Acciones de servidor de la sección Clientes (CRM de sala).
   Todo pasa por el cliente autenticado bajo RLS: sin service key en el panel.
   La RLS de reservas_clientes es «cuenta_actual() OR es_operador()», así que un operador vería
   todas las cuentas: por eso TODAS las consultas filtran además por la cuenta del perfil.
   Las estadísticas (visitas, no-shows, riesgo…) salen de la vista reservas_clientes_stats,
   que no tiene FK con reservas_clientes, así que las dos fuentes se combinan aquí. */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables } from "@hostelero/db";
import type { Cliente } from "../tipos";

async function cliente() {
  const { supabase, perfil, cuenta } = await exigirModulo("reservas");
  return { sb: supabase, perfil, cuentaId: cuenta.id as string };
}

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

export type Stats = Tables<"reservas_clientes_stats">;
export type Etiqueta = Tables<"reservas_etiquetas">;
export type Prescriptor = Pick<Tables<"reservas_prescriptores">, "id" | "nombre" | "tipo">;
export type Mensaje = Pick<
  Tables<"reservas_mensajes">,
  "id" | "canal" | "tipo" | "estado" | "destinatario" | "asunto" | "creado_en" | "enviado_en" | "error" | "reserva_id"
>;
export type ReservaHist = Pick<
  Tables<"reservas_reservas">,
  "id" | "fecha" | "hora" | "pax" | "estado" | "restaurante_id" | "mesa_id" | "valoracion" | "origen" | "localizador" | "notas_internas"
> & { reservas_mesas: { nombre: string } | null };

export type ClienteFila = Cliente & { stats: Stats | null };

const POR_PAGINA = 50;
/** Tope de ids de clientes que se cruzan en memoria cuando hay filtros de las dos fuentes. */
const TOPE_CRUCE = 5000;
/** PostgREST corta en 1000 filas por defecto: las lecturas largas se pagan a trozos. */
const TROZO = 1000;
/** Ids por petición en los .in(): 200 uuid caben de sobra en la URL. */
const TROZO_IN = 200;
/** Peticiones .in() en paralelo (más satura el pool sin ganar tiempo). */
const PARALELO = 5;

export type OrdenClientes = "nombre" | "creado" | "visitas" | "no_shows" | "ultima_visita" | "riesgo";

export type FiltrosClientes = {
  q?: string;
  etiqueta?: string | null;
  /** Id de etiqueta de ámbito «alergeno» (p. ej. la lista de celíacos). */
  alergeno?: string | null;
  vip?: boolean;
  listaNegra?: boolean;
  consentimiento?: boolean;
  idioma?: string | null;
  pais?: string | null;
  /** Fichas creadas desde esta fecha (AAAA-MM-DD). */
  altaDesde?: string | null;
  visitasMin?: number | null;
  /** Última visita anterior a esta fecha (clientes con alguna visita que no han vuelto). */
  sinVisitasDesde?: string | null;
  noShowsMin?: number | null;
  canceladasMin?: number | null;
  riesgo?: "alto" | "medio" | null;
  orden?: OrdenClientes;
  dir?: "asc" | "desc";
};

export type ResultadoBusqueda = {
  filas: ClienteFila[];
  total: number;
  pagina: number;
  porPagina: number;
  /** true si el cruce en memoria se quedó en el tope: el total es una cota inferior. */
  truncado: boolean;
  /** Mensaje legible si la búsqueda ha fallado (Next oculta los errores lanzados en producción). */
  error?: string;
};

/* ================= Utilidades ================= */

/** Semáforo de riesgo de no-show (0–1 en la vista); la misma regla que nivelRiesgo() en la ficha. */
function nivelRiesgoSync(r: number | null | undefined): "bajo" | "medio" | "alto" {
  const v = r ?? 0;
  return v >= 0.5 ? "alto" : v >= 0.2 ? "medio" : "bajo";
}
const UMBRAL = { medio: 0.2, alto: 0.5 };

/** Quita lo que rompería la sintaxis del filtro `.or()` de PostgREST. */
const limpiar = (s: string) => s.replace(/[,()"\\%]/g, " ").trim();

const ORDEN_VALIDOS: OrdenClientes[] = ["nombre", "creado", "visitas", "no_shows", "ultima_visita", "riesgo"];
const ORDEN_STATS: OrdenClientes[] = ["visitas", "no_shows", "ultima_visita", "riesgo"];
const COL_STATS: Record<string, keyof Stats> = { visitas: "visitas", no_shows: "no_shows", ultima_visita: "ultima_visita", riesgo: "riesgo_no_show" };

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (s: unknown): s is string => typeof s === "string" && RE_UUID.test(s);
const entero = (v: unknown, min = 1) => (typeof v === "number" && Number.isInteger(v) && v >= min ? Math.min(v, 100000) : null);
const texto = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

/** Las server actions son endpoints: se sanea lo que llega del navegador antes de usarlo. */
function sanear(x: FiltrosClientes | null | undefined): FiltrosClientes {
  const f = (x && typeof x === "object" ? x : {}) as FiltrosClientes;
  return {
    q: texto(f.q, 120),
    etiqueta: esUuid(f.etiqueta) ? f.etiqueta : null,
    alergeno: esUuid(f.alergeno) ? f.alergeno : null,
    vip: f.vip === true,
    listaNegra: f.listaNegra === true,
    consentimiento: f.consentimiento === true,
    idioma: typeof f.idioma === "string" && /^[a-z-]{2,5}$/i.test(f.idioma) ? f.idioma : null,
    pais: typeof f.pais === "string" && /^[a-z]{2}$/i.test(f.pais) ? f.pais.toUpperCase() : null,
    altaDesde: typeof f.altaDesde === "string" && RE_FECHA.test(f.altaDesde) ? f.altaDesde : null,
    visitasMin: entero(f.visitasMin),
    sinVisitasDesde: typeof f.sinVisitasDesde === "string" && RE_FECHA.test(f.sinVisitasDesde) ? f.sinVisitasDesde : null,
    noShowsMin: entero(f.noShowsMin),
    canceladasMin: entero(f.canceladasMin),
    riesgo: f.riesgo === "alto" || f.riesgo === "medio" ? f.riesgo : null,
    orden: ORDEN_VALIDOS.includes(f.orden as OrdenClientes) ? f.orden : "nombre",
    dir: f.dir === "desc" ? "desc" : "asc",
  };
}

type SB = Awaited<ReturnType<typeof cliente>>["sb"];
type Perfil = Awaited<ReturnType<typeof cliente>>["perfil"];

function hayFiltrosCliente(f: FiltrosClientes) {
  return !!(f.q?.trim() || f.etiqueta || f.alergeno || f.vip || f.listaNegra || f.consentimiento || f.idioma || f.pais || f.altaDesde);
}
function hayFiltrosStats(f: FiltrosClientes) {
  return !!(f.visitasMin || f.sinVisitasDesde || f.riesgo || f.noShowsMin || f.canceladasMin);
}
const ordenPorStats = (f: FiltrosClientes) => ORDEN_STATS.includes(f.orden ?? "nombre");

/** Si el texto es un teléfono (6+ dígitos, sin letras, con espacios, +, -, paréntesis o puntos
    de por medio), devuelve los dígitos sin prefijo 34/0034 para buscarlo como un solo término. */
function telefonoBuscado(q: string): string | null {
  const t = q.trim();
  if (!t || /[a-zà-ÿ@]/i.test(t)) return null;
  const compacto = t.replace(/[\s+\-().\/]/g, "");
  if (!/^\d{6,}$/.test(compacto)) return null;
  // Sin el prefijo español: así coincide tanto si telefono_norm lo guarda como si no.
  return compacto.replace(/^(00)?34(?=\d{9}$)/, "");
}

/** Consulta base sobre reservas_clientes (de la cuenta) con los filtros propios de la tabla. */
function consultaClientes(sb: SB, cuentaId: string, f: FiltrosClientes, columnas: string, conteo: boolean) {
  let q = sb.from("reservas_clientes").select(columnas, conteo ? { count: "exact" as const } : undefined).eq("cuenta_id", cuentaId);
  const tel = telefonoBuscado(f.q ?? "");
  if (tel) {
    q = q.or(`telefono_norm.ilike.%${tel}%,telefono.ilike.%${tel}%,telefono_adicional.ilike.%${tel}%`);
  } else {
    // Cada palabra debe aparecer en alguna columna (varios .or() se combinan en AND): así
    // «stuart kean» encuentra nombre «Stuart» + apellidos «Kean».
    const palabras = limpiar(f.q ?? "").split(/\s+/).filter(Boolean).slice(0, 4);
    for (const w of palabras) {
      const digitos = w.replace(/\D/g, "");
      const partes = [`nombre.ilike.%${w}%`, `apellidos.ilike.%${w}%`, `email_norm.ilike.%${w.toLowerCase()}%`, `empresa.ilike.%${w}%`];
      if (digitos.length >= 3) partes.push(`telefono_norm.ilike.%${digitos}%`, `telefono_adicional.ilike.%${digitos}%`);
      q = q.or(partes.join(","));
    }
  }
  if (f.etiqueta) q = q.contains("etiquetas", [f.etiqueta]);
  if (f.alergeno) q = q.contains("alergenos", [f.alergeno]);
  if (f.vip) q = q.eq("vip", true);
  if (f.listaNegra) q = q.eq("lista_negra", true);
  if (f.consentimiento) q = q.eq("consentimiento_marketing", true);
  if (f.idioma) q = q.eq("idioma", f.idioma);
  if (f.pais) q = q.eq("pais", f.pais);
  if (f.altaDesde) q = q.gte("creado_en", f.altaDesde);
  return q;
}

/** Consulta base sobre la vista de estadísticas (de la cuenta) con sus filtros. */
function consultaStats(sb: SB, cuentaId: string, f: FiltrosClientes, columnas: string, conteo: boolean) {
  let q = sb.from("reservas_clientes_stats").select(columnas, conteo ? { count: "exact" as const } : undefined).eq("cuenta_id", cuentaId);
  if (f.visitasMin) q = q.gte("visitas", f.visitasMin);
  if (f.sinVisitasDesde) q = q.lt("ultima_visita", f.sinVisitasDesde);
  if (f.noShowsMin) q = q.gte("no_shows", f.noShowsMin);
  if (f.canceladasMin) q = q.gte("canceladas", f.canceladasMin);
  if (f.riesgo === "alto") q = q.gte("riesgo_no_show", UMBRAL.alto);
  if (f.riesgo === "medio") q = q.gte("riesgo_no_show", UMBRAL.medio).lt("riesgo_no_show", UMBRAL.alto);
  return q;
}

type QClientes = ReturnType<typeof consultaClientes>;
type QStats = ReturnType<typeof consultaStats>;

/** Orden de la tabla con desempate por id: sin él, range() puede repetir o saltarse fichas entre páginas. */
function ordenarClientes(q: QClientes, f: FiltrosClientes): QClientes {
  const asc = f.dir !== "desc";
  if (f.orden === "creado") return q.order("creado_en", { ascending: asc }).order("id", { ascending: true });
  return q.order("nombre", { ascending: asc }).order("apellidos", { ascending: asc }).order("id", { ascending: true });
}
function ordenarStats(q: QStats, f: FiltrosClientes): QStats {
  const asc = f.dir === "asc";
  const col = COL_STATS[f.orden ?? "visitas"] ?? "visitas";
  return q.order(col, { ascending: asc, nullsFirst: false }).order("cliente_id", { ascending: true });
}

/** Lee una consulta larga a trozos de 1000 hasta `max` filas. */
async function aTrozos<T>(hacer: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, max: number) {
  const todo: T[] = [];
  for (let desde = 0; desde < max; desde += TROZO) {
    const { data, error } = await hacer(desde, Math.min(desde + TROZO, max) - 1);
    if (error) throw new Error(error.message);
    const filas = data ?? [];
    todo.push(...filas);
    if (filas.length < TROZO) break;
  }
  return { filas: todo, lleno: todo.length >= max };
}

/** Recorre `ids` a trozos de 200 con unas pocas peticiones en paralelo. */
async function porTrozos(ids: string[], fn: (trozo: string[]) => Promise<void>) {
  const trozos: string[][] = [];
  for (let i = 0; i < ids.length; i += TROZO_IN) trozos.push(ids.slice(i, i + TROZO_IN));
  for (let i = 0; i < trozos.length; i += PARALELO) await Promise.all(trozos.slice(i, i + PARALELO).map(fn));
}

/** Estadísticas de una lista de clientes. Con `f`, solo las de quienes cumplen los filtros de estadísticas. */
async function statsDe(sb: SB, cuentaId: string, ids: string[], f?: FiltrosClientes): Promise<Record<string, Stats>> {
  const out: Record<string, Stats> = {};
  await porTrozos(ids, async (trozo) => {
    const base = f ? consultaStats(sb, cuentaId, f, "*", false) : sb.from("reservas_clientes_stats").select("*").eq("cuenta_id", cuentaId);
    const { data, error } = await base.in("cliente_id", trozo);
    if (error) throw new Error(error.message);
    ((data ?? []) as unknown as Stats[]).forEach((s) => { if (s.cliente_id) out[s.cliente_id] = s; });
  });
  return out;
}

async function clientesDe(sb: SB, cuentaId: string, ids: string[]): Promise<Record<string, Cliente>> {
  const out: Record<string, Cliente> = {};
  await porTrozos(ids, async (trozo) => {
    const { data, error } = await sb.from("reservas_clientes").select("*").eq("cuenta_id", cuentaId).in("id", trozo);
    if (error) throw new Error(error.message);
    (data ?? []).forEach((c) => { out[c.id] = c; });
  });
  return out;
}

/** Monta las filas en el orden de `ids` (los que ya no existan se omiten). */
function combinar(ids: string[], cs: Record<string, Cliente>, st: Record<string, Stats>): ClienteFila[] {
  const out: ClienteFila[] = [];
  for (const id of ids) {
    const c = cs[id] as Cliente | undefined;
    if (c) out.push({ ...c, stats: (st[id] as Stats | undefined) ?? null });
  }
  return out;
}

/** Ordena ids en memoria por una columna de estadísticas (nulos al final, desempate por id). */
function ordenarPorStats(ids: string[], st: Record<string, Stats>, f: FiltrosClientes): string[] {
  const col = COL_STATS[f.orden ?? "visitas"] ?? "visitas";
  const signo = f.dir === "asc" ? 1 : -1;
  return [...ids].sort((a, b) => {
    const va = st[a]?.[col] as number | string | null | undefined;
    const vb = st[b]?.[col] as number | string | null | undefined;
    const na = va == null, nb = vb == null;
    if (na !== nb) return na ? 1 : -1;
    if (!na && !nb && va !== vb) return (va! < vb! ? -1 : 1) * signo;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** Camino mixto (filtros de tabla + estadísticas, o filtros de tabla + orden por estadísticas):
    se empieza SIEMPRE por el lado de clientes (con texto en el buscador son pocos), después se
    piden las estadísticas solo de esos ids (con sus filtros, si los hay) y se ordena en memoria. */
async function cruce(sb: SB, cuentaId: string, f: FiltrosClientes, tope: number) {
  const lCli = await aTrozos<{ id: string }>((a, b) => ordenarClientes(consultaClientes(sb, cuentaId, f, "id", false), f).range(a, b) as never, tope);
  const idsCli = lCli.filas.map((x) => x.id);
  const st = await statsDe(sb, cuentaId, idsCli, hayFiltrosStats(f) ? f : undefined);
  let ids = hayFiltrosStats(f) ? idsCli.filter((id) => !!st[id]) : idsCli;
  if (ordenPorStats(f)) ids = ordenarPorStats(ids, st, f);
  return { ids, stats: st, truncado: lCli.lleno };
}

/* ================= Búsqueda paginada ================= */

/** Tres caminos según de dónde salen filtros y orden: solo tabla (paginación exacta en servidor),
    solo estadísticas (paginación exacta sobre la vista) o mixto (cruce en memoria, ver cruce()). */
export async function buscar(filtros: FiltrosClientes, pagina = 0): Promise<ResultadoBusqueda> {
  const pag = Number.isFinite(pagina) ? Math.max(0, Math.floor(pagina)) : 0;
  const vacio: ResultadoBusqueda = { filas: [], total: 0, pagina: pag, porPagina: POR_PAGINA, truncado: false };
  try {
    const { sb, cuentaId } = await cliente();
    const f = sanear(filtros);
    const desde = pag * POR_PAGINA;
    const conStats = hayFiltrosStats(f) || ordenPorStats(f);

    // Camino A: todo en reservas_clientes.
    if (!conStats) {
      const { data, count, error } = await ordenarClientes(consultaClientes(sb, cuentaId, f, "*", true), f).range(desde, desde + POR_PAGINA - 1);
      if (error) throw new Error(error.message);
      const filas = (data ?? []) as unknown as Cliente[];
      const stats = await statsDe(sb, cuentaId, filas.map((c) => c.id));
      return { ...vacio, filas: filas.map((c) => ({ ...c, stats: stats[c.id] ?? null })), total: count ?? filas.length };
    }

    // Camino B: todo en la vista de estadísticas.
    if (!hayFiltrosCliente(f)) {
      const { data, count, error } = await ordenarStats(consultaStats(sb, cuentaId, f, "*", true), f).range(desde, desde + POR_PAGINA - 1);
      if (error) throw new Error(error.message);
      const stats = (data ?? []) as unknown as Stats[];
      const ids = stats.map((s) => s.cliente_id).filter((x): x is string => !!x);
      const cs = await clientesDe(sb, cuentaId, ids);
      const st: Record<string, Stats> = {};
      stats.forEach((s) => { if (s.cliente_id) st[s.cliente_id] = s; });
      const filas = combinar(ids, cs, st);
      return { ...vacio, filas, total: count ?? filas.length };
    }

    // Camino C: mixto.
    const { ids, stats, truncado } = await cruce(sb, cuentaId, f, TOPE_CRUCE);
    const pagIds = ids.slice(desde, desde + POR_PAGINA);
    const cs = await clientesDe(sb, cuentaId, pagIds);
    // Con filtros de estadísticas, `stats` ya trae las de estos ids; sin ellos también (statsDe sin filtro).
    return { ...vacio, filas: combinar(pagIds, cs, stats), total: ids.length, truncado };
  } catch (e) {
    return { ...vacio, error: (e as Error).message || "No se ha podido cargar la lista." };
  }
}

/* ================= Catálogos ================= */

/* Idiomas y países habituales (los mismos que IDIOMAS/PAISES de la ficha; aquí solo las claves,
   porque un fichero "use server" no puede importar constantes de un módulo de cliente). */
const IDIOMAS_BASE = ["es", "en", "ca", "fr", "de", "it", "pt", "nl"];
const PAISES_BASE = ["ES", "GB", "FR", "DE", "IT", "NL", "BE", "PT", "CH", "AT", "IE", "SE", "DK", "NO", "FI", "PL", "US", "CA", "MX", "AR", "BR", "AU", "AD", "LU"];

export async function catalogos() {
  const { sb, cuentaId } = await cliente();
  const [{ data: etiquetas }, { data: prescriptores }, { data: idiomas }, { data: paises }] = await Promise.all([
    sb.from("reservas_etiquetas").select("*").eq("cuenta_id", cuentaId).in("ambito", ["cliente", "alergeno"]).eq("activa", true).order("orden").order("nombre"),
    sb.from("reservas_prescriptores").select("id, nombre, tipo").eq("cuenta_id", cuentaId).eq("activo", true).order("nombre"),
    // Casi toda la cartera es es/ES: se leen solo los distintos del valor por defecto, para que
    // los idiomas y países menos habituales que haya en la cartera también salgan en el filtro.
    sb.from("reservas_clientes").select("idioma").eq("cuenta_id", cuentaId).neq("idioma", "es").limit(TROZO),
    sb.from("reservas_clientes").select("pais").eq("cuenta_id", cuentaId).neq("pais", "ES").limit(TROZO),
  ]);
  const todas = (etiquetas ?? []) as Etiqueta[];
  return {
    etiquetas: todas.filter((e) => e.ambito === "cliente"),
    alergenos: todas.filter((e) => e.ambito === "alergeno"),
    prescriptores: (prescriptores ?? []) as Prescriptor[],
    idiomas: Array.from(new Set([...IDIOMAS_BASE, ...(idiomas ?? []).map((x) => x.idioma).filter(Boolean)])).sort(),
    paises: Array.from(new Set([...PAISES_BASE, ...(paises ?? []).map((x) => x.pais).filter(Boolean)])).sort(),
  };
}

/** Permisos de la sección para pintar u ocultar botones (la acción vuelve a comprobarlo). */
export async function permisos(): Promise<{ exportar: boolean; anonimizar: boolean }> {
  const { sb, perfil } = await cliente();
  const p = await puedeGestionar(sb, perfil);
  return { exportar: p, anonimizar: p };
}

/** Exportar en bloque y anonimizar: dirección o quien tenga el permiso de ajustes de Reservas. */
async function puedeGestionar(sb: SB, perfil: Perfil): Promise<boolean> {
  if (perfil.rol === "direccion") return true;
  const { data } = await sb.from("reservas_permisos_perfil").select("puede_ajustes").eq("perfil_id", perfil.id).maybeSingle();
  return !!data?.puede_ajustes;
}

/* ================= Ficha ================= */

export async function ficha(id: string): Promise<{ cliente: Cliente | null; stats: Stats | null; historial: ReservaHist[]; mensajes: Mensaje[]; error?: string }> {
  const vacio = { cliente: null, stats: null, historial: [] as ReservaHist[], mensajes: [] as Mensaje[] };
  if (!esUuid(id)) return { ...vacio, error: "Identificador de cliente no válido." };
  try {
    const { sb, cuentaId } = await cliente();
    const [rc, rs, rh, rm] = await Promise.all([
      sb.from("reservas_clientes").select("*").eq("cuenta_id", cuentaId).eq("id", id).maybeSingle(),
      sb.from("reservas_clientes_stats").select("*").eq("cuenta_id", cuentaId).eq("cliente_id", id).maybeSingle(),
      sb
        .from("reservas_reservas")
        .select("id, fecha, hora, pax, estado, restaurante_id, mesa_id, valoracion, origen, localizador, notas_internas, reservas_mesas(nombre)")
        .eq("cuenta_id", cuentaId)
        .eq("cliente_id", id)
        .order("fecha", { ascending: false })
        .order("hora", { ascending: false })
        .limit(200),
      sb
        .from("reservas_mensajes")
        .select("id, canal, tipo, estado, destinatario, asunto, creado_en, enviado_en, error, reserva_id")
        .eq("cuenta_id", cuentaId)
        .eq("cliente_id", id)
        .order("creado_en", { ascending: false })
        .limit(100),
    ]);
    const err = rc.error ?? rs.error ?? rh.error ?? rm.error;
    if (err) return { ...vacio, error: err.message };
    const historial = (rh.data ?? []) as unknown as ReservaHist[];
    // Mensajes ligados a sus reservas aunque no lleven cliente_id (p. ej. enviados antes de fusionar).
    const idsRes = historial.map((r) => r.id).slice(0, 200);
    let mensajes = (rm.data ?? []) as Mensaje[];
    if (idsRes.length) {
      const { data: msgsRes } = await sb
        .from("reservas_mensajes")
        .select("id, canal, tipo, estado, destinatario, asunto, creado_en, enviado_en, error, reserva_id")
        .eq("cuenta_id", cuentaId)
        .in("reserva_id", idsRes)
        .order("creado_en", { ascending: false })
        .limit(100);
      const vistos = new Set(mensajes.map((m) => m.id));
      (msgsRes ?? []).forEach((m) => { if (!vistos.has(m.id)) mensajes.push(m as Mensaje); });
      mensajes = mensajes.sort((a, b) => (a.creado_en < b.creado_en ? 1 : -1));
    }
    return { cliente: (rc.data ?? null) as Cliente | null, stats: (rs.data ?? null) as Stats | null, historial, mensajes };
  } catch (e) {
    return { ...vacio, error: (e as Error).message || "No se ha podido cargar la ficha." };
  }
}

/* ================= Guardar ================= */

export type DatosCliente = {
  nombre: string;
  apellidos: string | null;
  telefono: string | null;
  telefono_adicional: string | null;
  email: string | null;
  idioma: string;
  pais: string;
  codigo_postal: string | null;
  empresa: string | null;
  fecha_nacimiento: string | null;
  numero_socio: string | null;
  prescriptor_id: string | null;
  etiquetas: string[];
  alergenos: string[];
  alergias: string | null;
  notas: string | null;
  vip: boolean;
  lista_negra: boolean;
  consentimiento_marketing: boolean;
};

const vacioANulo = (s: unknown, max = 200) => {
  const t = (typeof s === "string" ? s : "").trim().slice(0, max);
  return t ? t : null;
};
const soloTel = (s: unknown) => (typeof s === "string" ? s : "").replace(/[^\d+]/g, "").slice(0, 20) || null;

function normalizar(d: DatosCliente) {
  const x = (d && typeof d === "object" ? d : {}) as Partial<DatosCliente>;
  const fecha = vacioANulo(x.fecha_nacimiento, 10);
  const consiente = x.consentimiento_marketing === true;
  return {
    nombre: String(x.nombre ?? "").trim().slice(0, 200),
    apellidos: vacioANulo(x.apellidos),
    telefono: soloTel(x.telefono),
    telefono_adicional: soloTel(x.telefono_adicional),
    email: vacioANulo(x.email)?.toLowerCase() ?? null,
    idioma: (typeof x.idioma === "string" && x.idioma ? x.idioma : "es").trim().toLowerCase().slice(0, 5),
    pais: (typeof x.pais === "string" && x.pais ? x.pais : "ES").trim().toUpperCase().slice(0, 2),
    codigo_postal: vacioANulo(x.codigo_postal, 20),
    empresa: vacioANulo(x.empresa),
    fecha_nacimiento: fecha && RE_FECHA.test(fecha) ? fecha : null,
    numero_socio: vacioANulo(x.numero_socio, 50),
    prescriptor_id: esUuid(x.prescriptor_id) ? x.prescriptor_id : null,
    etiquetas: Array.from(new Set(Array.isArray(x.etiquetas) ? x.etiquetas.filter(esUuid) : [])),
    alergenos: Array.from(new Set(Array.isArray(x.alergenos) ? x.alergenos.filter(esUuid) : [])),
    alergias: vacioANulo(x.alergias, 500),
    notas: vacioANulo(x.notas, 2000),
    vip: x.vip === true,
    lista_negra: x.lista_negra === true,
    consentimiento_marketing: consiente,
    // Al retirar el consentimiento se borra el sello: el trigger pondrá now() si se vuelve a dar,
    // y la fecha que se muestra es la del consentimiento vigente.
    ...(consiente ? {} : { consentimiento_en: null }),
  };
}

type Fila = ReturnType<typeof normalizar>;

/** Deja etiquetas, alérgenos y prescriptor solo si son del catálogo de la cuenta
    (las FK no pasan por RLS: sin esto se podría enlazar algo de otra cuenta). */
async function validarCatalogos(sb: SB, cuentaId: string, fila: Fila): Promise<Fila> {
  const ids = [...fila.etiquetas, ...fila.alergenos];
  const [{ data: etis }, pres] = await Promise.all([
    ids.length
      ? sb.from("reservas_etiquetas").select("id, ambito").eq("cuenta_id", cuentaId).in("id", ids)
      : Promise.resolve({ data: [] as { id: string; ambito: string }[] }),
    fila.prescriptor_id
      ? sb.from("reservas_prescriptores").select("id").eq("cuenta_id", cuentaId).eq("id", fila.prescriptor_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const ambito = new Map((etis ?? []).map((e) => [e.id, e.ambito]));
  return {
    ...fila,
    etiquetas: fila.etiquetas.filter((id) => ambito.get(id) === "cliente"),
    alergenos: fila.alergenos.filter((id) => ambito.get(id) === "alergeno"),
    prescriptor_id: pres.data ? fila.prescriptor_id : null,
  };
}

const errorLegible = (e: { code?: string; message: string }) =>
  e.code === "23505" ? "Ya hay otro cliente con ese teléfono o email. Búscalo y fusiónalos si es la misma persona." : e.message;

function validar(fila: Fila): string | null {
  if (!fila.nombre) return "El nombre es obligatorio.";
  if (fila.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fila.email)) return "El email no parece válido.";
  return null;
}

/** Actualiza la ficha. Si el email es nuevo y no hay consentimiento, se deja el email igualmente:
    el consentimiento solo condiciona la exportación y los envíos comerciales. */
export async function guardar(id: string, datos: DatosCliente): Promise<R<Cliente>> {
  if (!esUuid(id)) return { ok: false, error: "Identificador de cliente no válido." };
  try {
    const { sb, cuentaId } = await cliente();
    const base = normalizar(datos);
    const fallo = validar(base);
    if (fallo) return { ok: false, error: fallo };
    const fila = await validarCatalogos(sb, cuentaId, base);
    const { data, error } = await sb.from("reservas_clientes").update(fila).eq("id", id).eq("cuenta_id", cuentaId).select("*").maybeSingle();
    if (error) return { ok: false, error: errorLegible(error) };
    if (!data) return { ok: false, error: "Este cliente ya no existe (puede que se haya fusionado)." };
    return { ok: true, data: data as Cliente };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "No se ha podido guardar." };
  }
}

/** Alta manual desde Clientes (Cover lo permite desde el listado). No hay índice único por
    teléfono ni email, así que antes de insertar se busca si ya existe: si existe, se devuelve
    en `data` con ok=false para que la ficha ofrezca abrirla en lugar de crear un duplicado. */
export async function crear(datos: DatosCliente): Promise<R<Cliente>> {
  try {
    const { sb, cuentaId } = await cliente();
    const base = normalizar(datos);
    const fallo = validar(base);
    if (fallo) return { ok: false, error: fallo };

    // Mismo criterio que el trigger (reservas_norm_tel / email en minúsculas y sin espacios).
    let telNorm: string | null = null;
    if (base.telefono) {
      const { data } = await sb.rpc("reservas_norm_tel", { t: base.telefono });
      telNorm = (data as string | null) || base.telefono.replace(/\D/g, "") || null;
    }
    const emailNorm = base.email ? base.email.trim().toLowerCase() : null;
    const [porTel, porEmail] = await Promise.all([
      telNorm
        ? sb.from("reservas_clientes").select("*").eq("cuenta_id", cuentaId).eq("telefono_norm", telNorm).limit(1).maybeSingle()
        : Promise.resolve({ data: null }),
      emailNorm
        ? sb.from("reservas_clientes").select("*").eq("cuenta_id", cuentaId).eq("email_norm", emailNorm).limit(1).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const existente = (porTel.data ?? porEmail.data) as Cliente | null;
    if (existente) {
      const quien = [existente.nombre, existente.apellidos].filter(Boolean).join(" ") || "otro cliente";
      return { ok: false, error: `Ya existe ${quien} con ese ${porTel.data ? "teléfono" : "email"}.`, data: existente };
    }

    const fila = await validarCatalogos(sb, cuentaId, base);
    const { data, error } = await sb.from("reservas_clientes").insert(fila).select("*").single();
    return error ? { ok: false, error: errorLegible(error) } : { ok: true, data: data as Cliente };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "No se ha podido crear el cliente." };
  }
}

/** Derecho de supresión (RGPD): vacía los datos personales de la ficha y la deja como
    «Anonimizado». La ficha y sus reservas se conservan (Ratios y estadísticas siguen cuadrando).
    Pendiente para el integrador: los destinatarios de reservas_mensajes y las notas de cliente
    de las reservas también pueden llevar datos personales (haría falta un RPC con permisos). */
export async function eliminar(id: string): Promise<R> {
  if (!esUuid(id)) return { ok: false, error: "Identificador de cliente no válido." };
  try {
    const { sb, perfil, cuentaId } = await cliente();
    if (!(await puedeGestionar(sb, perfil))) return { ok: false, error: "Solo dirección (o quien tenga el permiso de ajustes) puede anonimizar clientes." };
    const { data, error } = await sb
      .from("reservas_clientes")
      .update({
        nombre: "Anonimizado", apellidos: null, telefono: null, telefono_adicional: null, email: null, empresa: null,
        codigo_postal: null, fecha_nacimiento: null, numero_socio: null, notas: null, alergias: null, alergenos: [], etiquetas: [],
        prescriptor_id: null, vip: false, consentimiento_marketing: false, consentimiento_en: null, cover_meta: null, cliente_id: null,
      })
      .eq("id", id)
      .eq("cuenta_id", cuentaId)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Este cliente ya no existe." };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "No se ha podido anonimizar." };
  }
}

/* ================= Duplicados y fusión ================= */

export type GrupoDuplicados = {
  clave: string;
  tipo: "telefono" | "email";
  clientes: (Pick<Cliente, "id" | "nombre" | "apellidos" | "telefono" | "email" | "vip" | "lista_negra" | "creado_en" | "etiquetas"> & { visitas: number; reservas: number })[];
};

const ERRORES_FUSION: Record<string, string> = {
  CLIENTES_INVALIDOS: "Elige dos clientes distintos.",
  SIN_PERMISO: "Solo dirección o administración pueden fusionar clientes.",
  ORIGEN_NO_ENCONTRADO: "El cliente a fusionar ya no existe.",
  DESTINO_NO_ENCONTRADO: "El cliente destino ya no existe.",
  CUENTAS_DISTINTAS: "Los clientes no son de la misma cuenta.",
};

/** Reapunta reservas, mensajes y lista de espera del origen al destino y borra el origen (RPC). */
export async function fusionar(origen: string, destino: string): Promise<R<{ reservasMovidas: number }>> {
  if (!esUuid(origen) || !esUuid(destino)) return { ok: false, error: ERRORES_FUSION.CLIENTES_INVALIDOS };
  try {
    const { sb } = await cliente();
    const { data, error } = await sb.rpc("reservas_fusionar_clientes", { p_origen: origen, p_destino: destino });
    if (error) return { ok: false, error: error.message };
    const j = (data ?? {}) as { ok?: boolean; error?: string; reservas_movidas?: number };
    if (j.error) return { ok: false, error: ERRORES_FUSION[j.error] ?? j.error };
    return { ok: true, data: { reservasMovidas: j.reservas_movidas ?? 0 } };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "No se ha podido fusionar." };
  }
}

/** Clientes de la cuenta que comparten teléfono o email normalizado. Recorre la cartera entera
    (ids y claves, nada más) y agrupa en memoria; se llama a demanda, no al abrir la pestaña. */
export async function duplicados(): Promise<{ grupos: GrupoDuplicados[]; truncado: boolean }> {
  const { sb, cuentaId } = await cliente();
  type Mini = Pick<Cliente, "id" | "nombre" | "apellidos" | "telefono" | "email" | "vip" | "lista_negra" | "creado_en" | "etiquetas" | "telefono_norm" | "email_norm">;
  const { filas, lleno } = await aTrozos<Mini>(
    (a, b) =>
      sb
        .from("reservas_clientes")
        .select("id, nombre, apellidos, telefono, email, vip, lista_negra, creado_en, etiquetas, telefono_norm, email_norm")
        .eq("cuenta_id", cuentaId)
        .or("telefono_norm.not.is.null,email_norm.not.is.null")
        .order("creado_en", { ascending: true })
        .order("id", { ascending: true })
        .range(a, b) as never,
    40000,
  );
  const porTel = new Map<string, Mini[]>();
  const porEmail = new Map<string, Mini[]>();
  for (const c of filas) {
    if (c.telefono_norm && c.telefono_norm.length >= 6) porTel.set(c.telefono_norm, [...(porTel.get(c.telefono_norm) ?? []), c]);
    if (c.email_norm) porEmail.set(c.email_norm, [...(porEmail.get(c.email_norm) ?? []), c]);
  }
  const grupos: { clave: string; tipo: "telefono" | "email"; clientes: Mini[] }[] = [];
  const yaAgrupados = new Set<string>();
  for (const [clave, cs] of porTel) {
    if (cs.length > 1) { grupos.push({ clave, tipo: "telefono", clientes: cs }); cs.forEach((c) => yaAgrupados.add(c.id)); }
  }
  for (const [clave, cs] of porEmail) {
    // Un grupo por email solo si no está ya cubierto entero por un grupo de teléfono.
    if (cs.length > 1 && cs.some((c) => !yaAgrupados.has(c.id))) grupos.push({ clave, tipo: "email", clientes: cs });
  }
  const limitados = grupos.slice(0, 300);
  const ids = Array.from(new Set(limitados.flatMap((g) => g.clientes.map((c) => c.id))));
  const st = await statsDe(sb, cuentaId, ids);
  const salida: GrupoDuplicados[] = limitados.map((g) => ({
    clave: g.clave,
    tipo: g.tipo,
    clientes: g.clientes
      .map((c) => ({
        id: c.id, nombre: c.nombre, apellidos: c.apellidos, telefono: c.telefono, email: c.email, vip: c.vip, lista_negra: c.lista_negra,
        creado_en: c.creado_en, etiquetas: c.etiquetas,
        visitas: st[c.id]?.visitas ?? 0,
        reservas: st[c.id]?.reservas_total ?? 0,
      }))
      .sort((a, b) => b.reservas - a.reservas || (a.creado_en < b.creado_en ? -1 : 1)),
  }));
  // Los grupos con más reservas en juego, primero.
  salida.sort((a, b) => b.clientes.reduce((s, c) => s + c.reservas, 0) - a.clientes.reduce((s, c) => s + c.reservas, 0));
  return { grupos: salida, truncado: lleno || grupos.length > 300 };
}

/* ================= Exportar CSV ================= */

const TOPE_EXPORT = 5000;

/** Celda CSV: neutraliza fórmulas (=, +, -, @ al principio se ejecutarían en Excel; de paso el
    «+34…» queda como texto) y entrecomilla si hace falta. */
const csvCelda = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV (separador «;», UTF-8 con BOM, para Excel en español) de los clientes que cumplen los filtros,
    o solo de los `ids` marcados. Regla de consentimiento: email, teléfono y cumpleaños solo salen
    si el cliente ha dado consentimiento comercial. Solo dirección o quien tenga permiso de ajustes.
    La lista de ids se calcula UNA vez (sin paginar de 50 en 50) y luego se cargan fichas y estadísticas. */
export async function exportarCsv(filtros: FiltrosClientes, ids?: string[]): Promise<{ csv: string; filas: number; truncado: boolean; error?: string }> {
  try {
    const { sb, perfil, cuentaId } = await cliente();
    if (!(await puedeGestionar(sb, perfil))) {
      return { csv: "", filas: 0, truncado: false, error: "Solo dirección (o quien tenga el permiso de ajustes) puede exportar clientes." };
    }
    let lista: string[] = [];
    let st: Record<string, Stats> | null = null;
    let truncado = false;
    let precargados: Cliente[] | null = null;

    const marcados = Array.isArray(ids) ? ids.filter(esUuid) : [];
    if (marcados.length) {
      lista = marcados.slice(0, TOPE_EXPORT);
      truncado = marcados.length > TOPE_EXPORT;
    } else {
      const f = sanear(filtros);
      const conStats = hayFiltrosStats(f) || ordenPorStats(f);
      if (!conStats) {
        // Solo tabla: la consulta ya trae las fichas completas.
        const r = await aTrozos<Cliente>((a, b) => ordenarClientes(consultaClientes(sb, cuentaId, f, "*", false), f).range(a, b) as never, TOPE_EXPORT);
        precargados = r.filas;
        truncado = r.lleno;
      } else if (!hayFiltrosCliente(f)) {
        // Solo estadísticas: la vista ordenada a trozos de 1000.
        const r = await aTrozos<Stats>((a, b) => ordenarStats(consultaStats(sb, cuentaId, f, "*", false), f).range(a, b) as never, TOPE_EXPORT);
        st = {};
        for (const s of r.filas) if (s.cliente_id) { st[s.cliente_id] = s; lista.push(s.cliente_id); }
        truncado = r.lleno;
      } else {
        const r = await cruce(sb, cuentaId, f, TOPE_EXPORT);
        lista = r.ids;
        st = r.stats;
        truncado = r.truncado;
      }
    }

    let clientes: Cliente[];
    if (precargados) clientes = precargados;
    else {
      const cs = await clientesDe(sb, cuentaId, lista);
      clientes = lista.map((id) => cs[id]).filter((c): c is Cliente => !!c);
    }
    const [stats, { data: etis }] = await Promise.all([
      st ?? statsDe(sb, cuentaId, clientes.map((c) => c.id)),
      sb.from("reservas_etiquetas").select("id, nombre").eq("cuenta_id", cuentaId).in("ambito", ["cliente", "alergeno"]),
    ]);
    const nombreEti: Record<string, string> = {};
    (etis ?? []).forEach((e) => { nombreEti[e.id] = e.nombre; });

    const cab = [
      "Nombre", "Apellidos", "Teléfono", "Email", "Idioma", "País", "Código postal", "Empresa", "Nº socio", "Cumpleaños",
      "Visitas", "No-shows", "Canceladas", "Última visita", "Próxima reserva", "Pax medio", "Valoración media", "Riesgo no-show",
      "Etiquetas", "Alérgenos", "Alergias", "VIP", "Lista negra", "Consentimiento comercial", "Alta",
    ];
    const lineas = [cab.join(";")];
    for (const c of clientes) {
      const s = stats[c.id];
      const ok = c.consentimiento_marketing;
      lineas.push(
        [
          c.nombre, c.apellidos, ok ? c.telefono : "", ok ? c.email : "", c.idioma, c.pais, c.codigo_postal, c.empresa, c.numero_socio, ok ? c.fecha_nacimiento : "",
          s?.visitas ?? 0, s?.no_shows ?? 0, s?.canceladas ?? 0, s?.ultima_visita ?? "", s?.proxima_reserva ?? "", s?.pax_medio ?? "", s?.valoracion_media ?? "",
          nivelRiesgoSync(s?.riesgo_no_show),
          (c.etiquetas ?? []).map((id) => nombreEti[id] ?? "").filter(Boolean).join(", "),
          (c.alergenos ?? []).map((id) => nombreEti[id] ?? "").filter(Boolean).join(", "),
          c.alergias, c.vip ? "Sí" : "No", c.lista_negra ? "Sí" : "No", ok ? "Sí" : "No", c.creado_en.slice(0, 10),
        ]
          .map(csvCelda)
          .join(";"),
      );
    }
    return { csv: "\uFEFF" + lineas.join("\r\n"), filas: clientes.length, truncado };
  } catch (e) {
    return { csv: "", filas: 0, truncado: false, error: (e as Error).message || "No se ha podido exportar." };
  }
}

/* «Enviar a CRM» (plan §Clientes): PENDIENTE para el integrador, no se da por cerrado.
   La tabla maestra es `clientes` (+ clientes_origenes, + consentimientos solo por eventos insert,
   + reservas_clientes.cliente_id como vínculo) y vive en el módulo «crm» con sus propias reglas;
   su esquema (checks de origen/finalidad, unicidad por email_norm/telefono_norm) no está en las
   migraciones de este repo. El contrato a cerrar: enviarACrm(filtros, ids?) que, solo para fichas
   con consentimiento_marketing, busque o cree el cliente maestro, inserte clientes_origenes
   (origen «reservas», id_externo = reservas_clientes.id), registre el evento de consentimiento
   y rellene reservas_clientes.cliente_id. */
