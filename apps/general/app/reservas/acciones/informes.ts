"use server";

/* Acciones de servidor de la sección Informes del panel de Reservas.
   Las agregaciones las hace la base (RPC reservas_estadisticas / reservas_tracking y la vista
   comensales_desde_reservas, todas security invoker bajo RLS); aquí solo se valida el rango,
   se trocea y se completa con nombres. Cliente autenticado: nada de service key.

   Ojo con reservas_tracking: lleva «set search_path», así que Postgres no la integra en la consulta
   y cada llamada (cada .range) ejecuta la función entera sobre su rango de fechas, con sus
   subconsultas por fila. Por eso aquí no se pagina por desplazamiento sobre rangos largos: el
   cliente pide tramos cortos (como mucho 31 días) y cada tramo se parte en ventanas de fechas
   de menos de 1.000 filas, de modo que cada fila se calcula una sola vez. */

import { exigirModulo } from "@/lib/supabase/server";
import type { Database, Tables } from "@hostelero/db";

type R<T> = { ok: true; data: T } | { ok: false; error: string };

async function cliente() {
  const { supabase } = await exigirModulo("reservas");
  return supabase;
}

/* ================= Tipos ================= */

/** Qué fecha manda en las tablas: la de la reserva o la de anotación (creado_en). */
export type TipoFecha = "reserva" | "anotacion";

/** Salida de reservas_estadisticas (las medias pueden venir a null si no hay datos). */
export type Estadisticas = {
  error?: string;
  desde: string;
  hasta: string;
  dias: number;
  totales: {
    reservas: number;
    pax: number;
    reservas_atendidas: number;
    pax_atendidos: number;
    reservas_vivas: number;
    pax_vivos: number;
    no_shows: number;
    sin_cerrar: number;
    no_show_pct: number | null;
    canceladas: number;
    canceladas_pct: number | null;
    canceladas_cliente: number;
    canceladas_restaurante: number;
    canceladas_tardias: number;
    pax_medio: number | null;
    antelacion_media_horas: number | null;
    ocupacion_pct: number | null;
    capacidad_periodo: number;
    valoraciones: number;
    valoracion_media: number | null;
    nps: number | null;
    con_garantia: number;
    con_prepago: number;
    cobros_noshow: number;
  };
  por_dia: { fecha: string; reservas: number; pax: number; no_shows: number; canceladas: number; ocupacion_pct: number | null }[];
  por_semana: { semana: string; reservas: number; pax: number; no_shows: number; ocupacion_pct: number | null }[];
  por_turno: { restaurante: string; turno_id: string; turno: string; hora_inicio: string; reservas: number; pax: number; no_shows: number }[];
  por_hora: { hora: string; reservas: number; pax: number }[];
  por_estado: { estado: string; reservas: number; pax: number }[];
  canales: { canal: string | null; reservas: number; pax: number; no_shows: number; canceladas: number }[];
  origenes: { origen: string; reservas: number; pax: number }[];
  prescriptores: { prescriptor: string; tipo: string | null; reservas: number; pax: number }[];
  clientes: { nuevos: number; recurrentes: number; clientes: number };
  usuarios: { usuario: string; reservas: number; pax: number }[];
};

type FilaTrackingRpc = Database["public"]["Functions"]["reservas_tracking"]["Returns"][number];
/** Una fila del tracking (los tipos generados no marcan los nulos: aquí sí). */
export type FilaTracking = { [K in keyof FilaTrackingRpc]: FilaTrackingRpc[K] | null };

export type RestInfo = Pick<Tables<"reservas_restaurantes">, "id" | "nombre" | "slug" | "politica_cancelacion_horas" | "zona_horaria">;

/** Valor de una celda del tracking en formato posicional. */
export type ValorTracking = string | number | boolean | null;

/**
 * Tramo del tracking en formato posicional (lo que viaja al navegador): `columnas` dice qué campo
 * de FilaTracking es cada posición. Pesa la mitad que los objetos con 51 claves.
 */
export type TramoTracking = {
  columnas: string[];
  filas: ValorTracking[][];
  truncado: boolean;
  restaurantes: RestInfo[];
};

export type DatosTracking = {
  filas: FilaTracking[];
  /** true si se ha cortado en el tope de filas. */
  truncado: boolean;
  /** Restaurantes activos de la cuenta (nombre y política de cancelación para la tabla de tardías). */
  restaurantes: RestInfo[];
};

/** Fila de comensales_desde_reservas (lo que lee Ratios). */
export type FilaComensales = Tables<"comensales_desde_reservas">;

/** Entrada de la lista de espera, sin el token público (no sale nunca al navegador). */
export type FilaEspera = Omit<Tables<"reservas_lista_espera">, "token"> & { restaurante: string };
export type FilaBloqueo = Tables<"reservas_bloqueos"> & { restaurante: string; mesa: string | null; sala: string | null };

/* ================= Utilidades ================= */

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 400;
/** Días como mucho por llamada al tracking (el cliente pide tramos de 7). */
const MAX_DIAS_TRAMO = 31;
const PAGINA = 1000;
const TOPE_FILAS = 25000;
/** Tope de reservas de un tramo del tracking. */
const TOPE_TRAMO = 15000;
/** Llamadas simultáneas al RPC dentro de un tramo. */
const PARALELO = 4;

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
}

function validarRango(desde: string, hasta: string, max = MAX_DIAS): string | null {
  if (!ES_FECHA.test(desde) || !ES_FECHA.test(hasta)) return "Fechas no válidas.";
  if (hasta < desde) return "La fecha final es anterior a la inicial.";
  if (diasEntre(desde, hasta) + 1 > max) return `Como mucho ${max} días de una vez.`;
  return null;
}

function sumarDias(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "2026-09-01" → "2026-09-01T00:00:00+02:00" (medianoche en la zona del restaurante). */
function medianoche(fecha: string, tz: string): string {
  try {
    const partes = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date(fecha + "T12:00:00Z"));
    const nombre = partes.find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
    const m = /GMT([+-]\d+)(?::(\d+))?/.exec(nombre);
    const horas = m ? parseInt(m[1], 10) : 0;
    const minutos = m?.[2] ? parseInt(m[2], 10) : 0;
    const signo = horas < 0 ? "-" : "+";
    return `${fecha}T00:00:00${signo}${String(Math.abs(horas)).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
  } catch {
    return `${fecha}T00:00:00+01:00`;
  }
}

type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Lee todas las páginas de una consulta (PostgREST corta en 1.000 filas) hasta el tope.
 * La consulta debe tener un orden total (con el id al final) para no repetir ni saltar filas.
 */
async function todas<T>(consulta: (a: number, b: number) => Pagina<T>, tope = TOPE_FILAS): Promise<{ filas: T[]; truncado: boolean; error?: string }> {
  const filas: T[] = [];
  for (let desde = 0; desde < tope; desde += PAGINA) {
    const { data, error } = await consulta(desde, Math.min(desde + PAGINA, tope) - 1);
    if (error) return { filas, truncado: false, error: error.message };
    filas.push(...(data ?? []));
    if (!data || data.length < PAGINA) return { filas, truncado: false };
  }
  return { filas, truncado: true };
}

/** Ejecuta `fn` sobre cada elemento con como mucho `n` a la vez, conservando el orden. */
async function enParalelo<T, U>(items: T[], n: number, fn: (x: T) => Promise<U>): Promise<U[]> {
  const out = new Array<U>(items.length);
  let i = 0;
  const obrero = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, obrero));
  return out;
}

type Ventana = { d1: string; d2: string; n: number };

/**
 * Agrupa las fechas de servicio (con su número de reservas) en ventanas de como mucho 7 días y
 * menos de 1.000 filas: cada ventana es una sola ejecución del RPC. Con `contiguas` solo se juntan
 * días seguidos (en modo anotación los huecos son reservas que el RPC calcularía y luego tiraría).
 */
function ventanas(cuentas: Map<string, number>, contiguas: boolean): Ventana[] {
  const out: Ventana[] = [];
  let cur: Ventana | null = null;
  for (const f of [...cuentas.keys()].sort()) {
    const c = cuentas.get(f) ?? 0;
    const cabe = cur && diasEntre(cur.d1, f) < 7 && (!contiguas || diasEntre(cur.d2, f) <= 1) && cur.n + c <= PAGINA;
    if (cur && cabe) {
      cur.d2 = f;
      cur.n += c;
    } else {
      if (cur) out.push(cur);
      cur = { d1: f, d2: f, n: c };
    }
  }
  if (cur) out.push(cur);
  return out;
}

/* ================= Lecturas ================= */

/** Cuadro de mando del rango (RPC reservas_estadisticas); restId null = todos los restaurantes. */
export async function estadisticas(restId: string | null, desde: string, hasta: string): Promise<R<Estadisticas>> {
  const err = validarRango(desde, hasta);
  if (err) return { ok: false, error: err };
  const sb = await cliente();
  // El RPC admite null (= toda la cuenta); los tipos generados lo declaran como string.
  const { data, error } = await sb.rpc("reservas_estadisticas", {
    p_restaurante: (restId || null) as unknown as string,
    p_desde: desde,
    p_hasta: hasta,
  });
  if (error) return { ok: false, error: error.message };
  const e = data as unknown as Estadisticas | null;
  if (!e || e.error) return { ok: false, error: e?.error === "RANGO_INVALIDO" ? "El rango de fechas no es válido." : "No se han podido calcular las estadísticas." };
  return { ok: true, data: e };
}

/**
 * Lee un tramo corto del tracking (≤ 31 días). Primero mira qué fechas de servicio tienen
 * reservas (consulta ligera a reservas_reservas) y luego llama al RPC por ventanas de fechas,
 * con los filtros aplicados en la base sobre el resultado del RPC.
 * Con tipoFecha "anotacion" el tramo es de fecha de creación (creado_en, medianoche en la zona del
 * restaurante; Europe/Madrid con «todos», que es la de todos los locales actuales).
 */
async function leerTramo(restId: string | null, desde: string, hasta: string, tipoFecha: TipoFecha): Promise<R<DatosTracking>> {
  const err = validarRango(desde, hasta, MAX_DIAS_TRAMO);
  if (err) return { ok: false, error: err.startsWith("Como mucho") ? `El tracking se pide por tramos de ${MAX_DIAS_TRAMO} días como mucho.` : err };
  const sb = await cliente();

  const { data: rests, error: eRest } = await sb
    .from("reservas_restaurantes")
    .select("id, nombre, slug, politica_cancelacion_horas, zona_horaria")
    .eq("activo", true)
    .order("nombre");
  if (eRest) return { ok: false, error: eRest.message };
  const restaurantes: RestInfo[] = rests ?? [];

  let creado: { ini: string; fin: string } | null = null;
  if (tipoFecha === "anotacion") {
    const tz = restaurantes.find((r) => r.id === restId)?.zona_horaria || "Europe/Madrid";
    creado = { ini: medianoche(desde, tz), fin: medianoche(sumarDias(hasta, 1), tz) };
  }

  // 1) Reservas por fecha de servicio del tramo (solo fecha e id: filas mínimas).
  const fechas = await todas<{ fecha: string; id: string }>((a, b) => {
    let q = sb.from("reservas_reservas").select("fecha, id");
    q = creado ? q.gte("creado_en", creado.ini).lt("creado_en", creado.fin) : q.gte("fecha", desde).lte("fecha", hasta);
    if (restId) q = q.eq("restaurante_id", restId);
    return q.order("fecha").order("id").range(a, b);
  }, TOPE_TRAMO);
  if (fechas.error) return { ok: false, error: fechas.error };
  if (!fechas.filas.length) return { ok: true, data: { filas: [], truncado: false, restaurantes } };
  const cuentas = new Map<string, number>();
  for (const f of fechas.filas) cuentas.set(f.fecha, (cuentas.get(f.fecha) ?? 0) + 1);
  // Si el tramo se ha cortado, la última fecha puede estar incompleta: se descarta entera.
  if (fechas.truncado) cuentas.delete(fechas.filas[fechas.filas.length - 1].fecha);

  // 2) Una ejecución del RPC por ventana (normalmente una sola página cada una).
  const partes = await enParalelo(ventanas(cuentas, !!creado), PARALELO, (v) =>
    todas<FilaTracking>((a, b) => {
      let q = sb.rpc("reservas_tracking", { p_restaurante: (restId || null) as unknown as string, p_desde: v.d1, p_hasta: v.d2 });
      if (creado) q = q.gte("creado_en", creado.ini).lt("creado_en", creado.fin);
      return q.order("fecha").order("hora").order("reserva_id").range(a, b) as unknown as Pagina<FilaTracking>;
    }, TOPE_TRAMO),
  );
  const fallo = partes.find((p) => p.error);
  if (fallo) return { ok: false, error: fallo.error ?? "Error" };
  return { ok: true, data: { filas: partes.flatMap((p) => p.filas), truncado: fechas.truncado || partes.some((p) => p.truncado), restaurantes } };
}

/**
 * Tracking de un tramo corto (≤ 31 días) en objetos. Se mantiene por compatibilidad; la pantalla
 * usa trackingTramo, que pesa la mitad.
 */
export async function tracking(restId: string | null, desde: string, hasta: string, tipoFecha: TipoFecha = "reserva"): Promise<R<DatosTracking>> {
  return leerTramo(restId, desde, hasta, tipoFecha);
}

/** Tracking de un tramo corto (≤ 31 días) en formato posicional: lo que pide la pantalla, tramo a tramo. */
export async function trackingTramo(restId: string | null, desde: string, hasta: string, tipoFecha: TipoFecha = "reserva"): Promise<R<TramoTracking>> {
  const r = await leerTramo(restId, desde, hasta, tipoFecha);
  if (!r.ok) return r;
  const { filas, truncado, restaurantes } = r.data;
  const columnas = filas.length ? Object.keys(filas[0]) : [];
  return {
    ok: true,
    data: {
      columnas,
      filas: filas.map((f) => columnas.map((c) => (f as Record<string, ValorTracking>)[c] ?? null)),
      truncado,
      restaurantes,
    },
  };
}

/** Código de centro (formato Ratios) de un restaurante, como lo calcula la vista. */
async function centroDe(sb: Awaited<ReturnType<typeof cliente>>, restId: string): Promise<string | null> {
  const { data: r } = await sb.from("reservas_restaurantes").select("slug, centro_id").eq("id", restId).maybeSingle();
  if (!r) return null;
  const fijos: Record<string, string> = { binifadet: "BINIFADET", tamarindos: "TAMARINDOS", "bar-tamarindos": "TAMARINDOS BAR", "casa-tirant": "TIRANT" };
  if (fijos[r.slug]) return fijos[r.slug];
  if (r.centro_id) {
    const { data: c } = await sb.from("centros").select("nombre").eq("id", r.centro_id).maybeSingle();
    if (c?.nombre) {
      const { data: cod } = await sb.rpc("rrhh_codigo_centro_ratios", { p_nombre: c.nombre });
      if (cod) return String(cod).replace(/_/g, " ");
    }
  }
  return r.slug.toUpperCase();
}

/** Personas por turno y día (vista comensales_desde_reservas: lo que lee Ratios). */
export async function comensales(restId: string | null, desde: string, hasta: string): Promise<R<{ filas: FilaComensales[]; truncado: boolean }>> {
  const err = validarRango(desde, hasta);
  if (err) return { ok: false, error: err };
  const sb = await cliente();
  const centro = restId ? await centroDe(sb, restId) : null;
  if (restId && !centro) return { ok: false, error: "Restaurante no encontrado." };
  const r = await todas<FilaComensales>((a, b) => {
    let q = sb.from("comensales_desde_reservas").select("*").gte("fecha", desde).lte("fecha", hasta);
    if (centro) q = q.eq("centro", centro);
    return q.order("fecha").order("centro").order("servicio").range(a, b);
  });
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, data: { filas: r.filas, truncado: r.truncado } };
}

const COLS_ESPERA = "id, cuenta_id, restaurante_id, fecha, creado_en, nombre, pax, telefono, email, hora_preferida, estado, avisado_en, reserva_id, notas, turno_id, zona_id, idioma, cliente_id";

/** Lista de espera y mesas bloqueadas del rango, con nombres de restaurante, sala y mesa. */
export async function esperaYBloqueos(restId: string | null, desde: string, hasta: string): Promise<R<{ espera: FilaEspera[]; bloqueos: FilaBloqueo[] }>> {
  const err = validarRango(desde, hasta);
  if (err) return { ok: false, error: err };
  const sb = await cliente();

  const consultaEspera = (a: number, b: number) => {
    // Columnas explícitas: el token público de la lista de espera no sale al navegador.
    let q = sb.from("reservas_lista_espera").select(COLS_ESPERA).gte("fecha", desde).lte("fecha", hasta);
    if (restId) q = q.eq("restaurante_id", restId);
    return q.order("fecha").order("creado_en").order("id").range(a, b);
  };
  const consultaBloqueos = (a: number, b: number) => {
    let q = sb.from("reservas_bloqueos").select("*").gte("fecha", desde).lte("fecha", hasta);
    if (restId) q = q.eq("restaurante_id", restId);
    return q.order("fecha").order("hora_inicio").order("id").range(a, b);
  };
  const [esp, blo, { data: rests }] = await Promise.all([
    todas<Omit<Tables<"reservas_lista_espera">, "token">>(consultaEspera, 5000),
    todas<Tables<"reservas_bloqueos">>(consultaBloqueos, 5000),
    sb.from("reservas_restaurantes").select("id, nombre"),
  ]);
  if (esp.error) return { ok: false, error: esp.error };
  if (blo.error) return { ok: false, error: blo.error };

  const nombreRest: Record<string, string> = {};
  (rests ?? []).forEach((r) => { nombreRest[r.id] = r.nombre; });

  const mesaIds = [...new Set(blo.filas.map((b) => b.mesa_id).filter((x): x is string => !!x))];
  const salaIds = new Set(blo.filas.map((b) => b.sala_id).filter((x): x is string => !!x));
  const mesas: Record<string, { nombre: string; sala_id: string }> = {};
  if (mesaIds.length) {
    const { data } = await sb.from("reservas_mesas").select("id, nombre, sala_id").in("id", mesaIds);
    (data ?? []).forEach((m) => { mesas[m.id] = { nombre: m.nombre, sala_id: m.sala_id }; salaIds.add(m.sala_id); });
  }
  const salas: Record<string, string> = {};
  if (salaIds.size) {
    const { data } = await sb.from("reservas_salas").select("id, nombre").in("id", [...salaIds]);
    (data ?? []).forEach((s) => { salas[s.id] = s.nombre; });
  }

  return {
    ok: true,
    data: {
      espera: esp.filas.map((e) => ({ ...e, restaurante: nombreRest[e.restaurante_id] ?? "—" })),
      bloqueos: blo.filas.map((b) => {
        const m = b.mesa_id ? mesas[b.mesa_id] : null;
        const salaId = b.sala_id ?? m?.sala_id ?? null;
        return { ...b, restaurante: nombreRest[b.restaurante_id] ?? "—", mesa: m?.nombre ?? null, sala: salaId ? (salas[salaId] ?? null) : null };
      }),
    },
  };
}
