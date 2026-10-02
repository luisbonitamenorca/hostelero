import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/publico";
import { entero, esFecha, esSlug, esUuid, limitar, localPublico } from "../_comun";

export const dynamic = "force-dynamic";

type TurnoRango = { id: string; nombre: string; hora_inicio: string; hora_fin: string; intervalo_min: number; dias_semana: number[] };

/** Horas HH:MM entre inicio y fin (incluidos) cada `paso` minutos. */
function horasEntre(inicio: string, fin: string, paso: number): string[] {
  const [hi, mi] = inicio.split(":").map(Number);
  const [hf, mf] = fin.split(":").map(Number);
  let t = hi * 60 + mi;
  const tf = hf * 60 + mf;
  const out: string[] = [];
  const p = Math.max(5, paso || 15);
  while (t <= tf && out.length < 200) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
    t += p;
  }
  return out;
}

/**
 * Disponibilidad v2 del widget.
 *  - ?slug&fecha&pax[&zona][&experiencia] → RPC reservas_disponibilidad_v2 (turnos con horas, plazas,
 *    «pocas», tipo/importe) + rango horario de cada turno (para solicitudes de grupo y lista de espera).
 *  - ?slug&mes=YYYY-MM[&pax=N] → calendario del mes: por día «abierto» | «completo» | «cerrado» |
 *    «fuera» (de rango). Se calcula desde turnos, cierres y cupos (no llama al RPC día a día: sería
 *    carísimo). Con `pax`, un día es «completo» si todos sus turnos abiertos superan el aforo
 *    (online o total) con la misma regla que reservas_cupo_motivo; la disponibilidad fina por mesa
 *    la da después el RPC al elegir el día. Nunca devuelve reservas, solo el estado del día.
 */
export async function GET(req: Request) {
  const bloqueo = limitar(req, "disp", 120);
  if (bloqueo) return bloqueo;
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const p = new URL(req.url).searchParams;
  const slug = p.get("slug") || "";
  if (!esSlug(slug)) return NextResponse.json({ error: "datos" }, { status: 400 });

  const mes = p.get("mes");
  if (mes) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return NextResponse.json({ error: "datos" }, { status: 400 });
    const paxCal = p.get("pax") ? entero(p.get("pax"), 1, 200) : null;
    return calendario(sb, slug, mes, paxCal);
  }

  const fecha = p.get("fecha") || "";
  const pax = entero(p.get("pax"), 1, 200);
  const zona = p.get("zona") || null;
  const experiencia = p.get("experiencia") || null;
  if (!esFecha(fecha) || pax === null || (zona && !esUuid(zona)) || (experiencia && !esUuid(experiencia))) {
    return NextResponse.json({ error: "datos" }, { status: 400 });
  }

  // El RPC busca solo por slug: antes comprobamos que el restaurante es de la cuenta pública.
  const restId = await localPublico(sb, slug);
  if (!restId) return NextResponse.json({ error: "LOCAL_NO_DISPONIBLE" });

  const [{ data, error }, turnos] = await Promise.all([
    sb.rpc("reservas_disponibilidad_v2", {
      p_slug: slug,
      p_fecha: fecha,
      p_pax: pax,
      ...(zona ? { p_zona_id: zona } : {}),
      ...(experiencia ? { p_experiencia_id: experiencia } : {}),
    }),
    turnosDe(sb, restId),
  ]);
  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });

  const j = (data ?? {}) as Record<string, unknown>;
  if (Array.isArray(j.turnos)) {
    j.turnos = (j.turnos as Array<Record<string, unknown>>).map((t) => {
      const r = turnos.find((x) => x.id === t.turno_id);
      if (!r) return t;
      const extra: Record<string, unknown> = { hora_inicio: r.hora_inicio.slice(0, 5), hora_fin: r.hora_fin.slice(0, 5), intervalo_min: r.intervalo_min };
      // Grupo grande: el cliente elige una hora preferida dentro del turno para la solicitud.
      if (t.grupo_grande) extra.horas_solicitud = horasEntre(r.hora_inicio.slice(0, 5), r.hora_fin.slice(0, 5), Math.max(30, r.intervalo_min));
      return { ...t, ...extra };
    });
  }
  return NextResponse.json(j);
}

type SB = NonNullable<ReturnType<typeof crearClienteServicio>>;

async function turnosDe(sb: SB, restId: string): Promise<TurnoRango[]> {
  const { data } = await sb
    .from("reservas_turnos")
    .select("id, nombre, hora_inicio, hora_fin, intervalo_min, dias_semana")
    .eq("restaurante_id", restId)
    .eq("activo", true)
    .order("hora_inicio");
  return (data ?? []) as TurnoRango[];
}

// Estados que ocupan plaza (mismo catálogo que reservas_estados_activos() en la base).
const ESTADOS_ACTIVOS = ["pendiente", "confirmada", "reconfirmada", "llegada", "sentada", "postre", "cuenta", "a_revisar", "tarjeta_pendiente"];

type TurnoCal = { id: string; dias_semana: number[]; hora_inicio: string; hora_fin: string; max_pax_online: number; max_pax_total: number | null };
type CupoCal = { fecha: string; turno_id: string | null; cerrado: boolean; nota: string | null; max_pax_online: number | null; max_pax_total: number | null };
type ResCal = { fecha: string; hora: string; turno_id: string | null; pax: number; origen: string };
type Ocupacion = Map<string, { online: number; total: number }>;

/**
 * Ocupación (pax online y total) por fecha y turno de un mes, cacheada 60 s por instancia.
 * No depende de los comensales: cambiar el pax en el widget (o varios clientes mirando el mismo
 * mes) no vuelve a recorrer las reservas. Pendiente para el integrador: sustituir la paginación
 * por un RPC que agregue en SQL (sum(pax) total y online por fecha y turno, group by).
 */
const cacheOcupacion: Map<string, { hasta: number; ocupacion: Ocupacion }> = ((globalThis as unknown as { __rsvOcupacion?: Map<string, { hasta: number; ocupacion: Ocupacion }> }).__rsvOcupacion ??= new Map());

async function calendario(sb: SB, slug: string, mes: string, pax: number | null) {
  const { data: rest } = await sb
    .from("reservas_restaurantes")
    .select("id, antelacion_max_dias, online_activo, activo, max_pax_online")
    .eq("cuenta_id", CUENTA_PUBLICA)
    .eq("slug", slug)
    .maybeSingle();
  if (!rest || !rest.activo || !rest.online_activo) return NextResponse.json({ error: "LOCAL_NO_DISPONIBLE" });

  const [aa, mm] = mes.split("-").map(Number);
  const primero = `${mes}-01`;
  const ultimoDia = new Date(Date.UTC(aa, mm, 0)).getUTCDate();
  const ultimo = `${mes}-${String(ultimoDia).padStart(2, "0")}`;

  const [{ data: turnosRaw }, { data: cierres }, { data: cuposRaw }] = await Promise.all([
    sb.from("reservas_turnos").select("id, dias_semana, hora_inicio, hora_fin, max_pax_online, max_pax_total").eq("restaurante_id", rest.id).eq("activo", true),
    sb.from("reservas_cierres").select("fecha, turno_id").eq("restaurante_id", rest.id).gte("fecha", primero).lte("fecha", ultimo),
    sb.from("reservas_cupos").select("fecha, turno_id, cerrado, nota, max_pax_online, max_pax_total").eq("restaurante_id", rest.id).gte("fecha", primero).lte("fecha", ultimo),
  ]);
  const turnos = (turnosRaw ?? []) as TurnoCal[];
  const cupos = (cuposRaw ?? []) as CupoCal[];

  // Hoy y tope de antelación en hora de Madrid (la base compara con current_date del servidor).
  const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const tope = new Date(Date.parse(hoy + "T12:00:00Z") + rest.antelacion_max_dias * 86_400_000).toISOString().slice(0, 10);

  const cerradoDia = new Set<string>();
  const cerradoTurno = new Map<string, Set<string>>();
  const notas: Record<string, string> = {};
  const marcar = (fecha: string, turno: string | null) => {
    if (!turno) cerradoDia.add(fecha);
    else {
      if (!cerradoTurno.has(fecha)) cerradoTurno.set(fecha, new Set());
      cerradoTurno.get(fecha)!.add(turno);
    }
  };
  for (const c of cierres ?? []) marcar(c.fecha, c.turno_id);
  for (const q of cupos) {
    if (q.cerrado) marcar(q.fecha, q.turno_id);
    if (q.nota && !q.turno_id) notas[q.fecha] = q.nota;
  }

  // Cupo aplicable a (fecha, turno): el del turno o, si no hay, el del día (como reservas_cupo_motivo).
  const cupoDe = (fecha: string, turno: string) =>
    cupos.find((q) => q.fecha === fecha && q.turno_id === turno) ?? cupos.find((q) => q.fecha === fecha && q.turno_id === null) ?? null;

  // Ocupación por (fecha, turno), solo si hace falta: hay pax y algún límite de aforo en el mes.
  let ocupacion: Ocupacion = new Map();
  const hayLimites = pax !== null && (turnos.some((t) => t.max_pax_total !== null) || cupos.some((q) => q.max_pax_online !== null || q.max_pax_total !== null));
  const claveOcup = `${rest.id}|${mes}|${hoy}`;
  const enCache = cacheOcupacion.get(claveOcup);
  if (hayLimites && enCache && enCache.hasta > Date.now()) {
    ocupacion = enCache.ocupacion;
  } else if (hayLimites) {
    const desde = hoy > primero ? hoy : primero;
    const filas: ResCal[] = [];
    // Paginado: la API devuelve como mucho 1.000 filas por consulta.
    for (let pagina = 0; pagina < 20; pagina++) {
      const { data } = await sb
        .from("reservas_reservas")
        .select("fecha, hora, turno_id, pax, origen")
        .eq("restaurante_id", rest.id)
        .gte("fecha", desde)
        .lte("fecha", ultimo)
        .in("estado", ESTADOS_ACTIVOS)
        .order("id")
        .range(pagina * 1000, pagina * 1000 + 999);
      const lote = (data ?? []) as ResCal[];
      filas.push(...lote);
      if (lote.length < 1000) break;
    }
    for (const r of filas) {
      const hora = (r.hora || "").slice(0, 8);
      const delTurno = r.turno_id
        ? turnos.filter((t) => t.id === r.turno_id)
        : turnos.filter((t) => hora >= t.hora_inicio && hora <= t.hora_fin);
      for (const t of delTurno) {
        const k = `${r.fecha}|${t.id}`;
        const o = ocupacion.get(k) ?? { online: 0, total: 0 };
        o.total += r.pax || 0;
        if (r.origen === "online") o.online += r.pax || 0;
        ocupacion.set(k, o);
      }
    }
    cacheOcupacion.set(claveOcup, { hasta: Date.now() + 60_000, ocupacion });
    if (cacheOcupacion.size > 500) {
      const ahora = Date.now();
      for (const [k, v] of cacheOcupacion) if (v.hasta <= ahora) cacheOcupacion.delete(k);
    }
  }

  const turnoLleno = (fecha: string, t: TurnoCal): boolean => {
    if (pax === null) return false;
    const q = cupoDe(fecha, t.id);
    const o = ocupacion.get(`${fecha}|${t.id}`) ?? { online: 0, total: 0 };
    if (q?.max_pax_online !== null && q?.max_pax_online !== undefined && o.online + pax > q.max_pax_online) return true;
    const maxTotal = q?.max_pax_total ?? t.max_pax_total;
    return maxTotal !== null && maxTotal !== undefined && o.total + pax > maxTotal;
  };

  const dias: Record<string, "abierto" | "completo" | "cerrado" | "fuera"> = {};
  for (let d = 1; d <= ultimoDia; d++) {
    const f = `${mes}-${String(d).padStart(2, "0")}`;
    if (f < hoy || f > tope) {
      dias[f] = "fuera";
      continue;
    }
    const isodow = ((new Date(f + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
    const cerrados = cerradoTurno.get(f);
    const abiertos = cerradoDia.has(f) ? [] : turnos.filter((t) => (t.dias_semana ?? []).includes(isodow) && !cerrados?.has(t.id));
    if (!abiertos.length) {
      dias[f] = "cerrado";
      continue;
    }
    // Grupo por encima del máximo online: no es «completo», es solicitud de grupo (paso 2).
    const grupo = pax !== null && abiertos.every((t) => pax > Math.min(t.max_pax_online, rest.max_pax_online));
    dias[f] = !grupo && pax !== null && abiertos.every((t) => turnoLleno(f, t)) ? "completo" : "abierto";
  }
  return NextResponse.json({ mes, hoy, tope, dias, notas });
}
