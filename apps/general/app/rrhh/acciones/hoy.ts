"use server";

/* Acciones de la sección «Hoy» (plan 2.1). Cliente autenticado: la RLS decide.
   Todo lo de hoy se calcula con la fecha de Europe/Madrid (el servidor puede estar en UTC).

   Reglas de «quién trabaja hoy»:
   - Cuentan los turnos publicados de hoy y los de ayer que cruzan medianoche (hora_fin <= hora_inicio)
     mientras no hayan terminado hace más de 2 h (o siga alguien «dentro» sin fichar la salida).
   - Cada fichaje se asigna al turno más cercano del empleado (ventana de ±2 h alrededor del turno),
     así un turno partido o un cierre de ayer no se mezclan.
   - Si el empleado ficha en otro centro (tablet de la Bodega estando en el Restaurante), su estado
     se calcula igual y se avisa «Fichó en …». */

import { exigirModulo } from "@/lib/supabase/server";
import { efectivosDe, finAbsoluto, minutos, type Fichaje } from "../tipos";

async function cliente() {
  const { supabase, perfil } = await exigirModulo("rrhh");
  return { sb: supabase, perfil };
}

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

/* ==================== Fechas en Europe/Madrid ==================== */

const TZ = "Europe/Madrid";
const MIN = 60000;
const HORA = 60 * MIN;
/** Margen alrededor del turno para asignarle fichajes y para seguir mostrándolo tras el fin. */
const MARGEN_MS = 2 * HORA;

/** Minutos de desfase de Madrid respecto a UTC en ese instante (+60 / +120). */
function desfaseMadridMin(d: Date): number {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d);
  const g = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? 0);
  const comoUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return Math.round((comoUtc - d.getTime()) / MIN);
}

/** Instante (UTC) de una «hora de pared» (minutos desde las 00:00) de ese día en Madrid.
    Dos pasadas para que el día del cambio de hora no desplace las horas posteriores a las 02:00/03:00. */
function instanteMadridMin(iso: string, minutosDia: number): Date {
  const pared = new Date(iso + "T00:00:00Z").getTime() + minutosDia * MIN;
  const aprox = new Date(pared - desfaseMadridMin(new Date(pared)) * MIN);
  return new Date(pared - desfaseMadridMin(aprox) * MIN);
}

/** Instante (UTC) en que empieza ese día en Madrid. */
const inicioDiaMadrid = (iso: string) => instanteMadridMin(iso, 0);

/** Instante (UTC) de una hora «hh:mm» de ese día en Madrid. */
const instanteMadrid = (iso: string, hhmm: string) => instanteMadridMin(iso, minutos(hhmm.slice(0, 5)));

const hoyMadrid = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
const fechaMadrid = (ts: string) => new Date(ts).toLocaleDateString("sv-SE", { timeZone: TZ });
const sumaDias = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lunesDe = (iso: string) => sumaDias(iso, -((new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7));

/* ==================== Tipos de la vista ==================== */

type Nombre = { nombre: string; apellidos: string | null } | null;
const nombreDe = (e: Nombre) => (e ? `${e.nombre} ${e.apellidos || ""}`.trim() : "—");

export type EstadoFichaje = "sin_fichar" | "dentro" | "en_pausa" | "salio" | "pendiente" | "sin_cubrir";

export type TrabajaHoy = {
  turnoId: string;
  empleadoId: string | null;
  nombre: string;
  horaInicio: string;
  horaFin: string;
  /** El turno empezó ayer (cierre que cruza medianoche). */
  deAyer: boolean;
  pausaMin: number;
  puesto: string | null;
  puestoColor: string | null;
  estado: EstadoFichaje;
  /** ts del último fichaje efectivo del turno (entrada / pausa / salida). */
  ultimoTs: string | null;
  /** ts de la primera entrada del turno. */
  entradaTs: string | null;
  /** Minutos de retraso respecto al turno (0 = a tiempo o dentro del margen). */
  retrasoMin: number;
  /** Centro donde fichó si no es este (el cliente pone el nombre). */
  fichoEnCentroId: string | null;
  /** «No ha fichado la salida», «Sin turno planificado hoy»… */
  nota: string | null;
};

export type AusenteHoy = {
  id: string;
  empleadoId: string;
  nombre: string;
  tipo: string;
  color: string | null;
  desde: string;
  hasta: string;
  medioDia: boolean;
  horas: number | null;
};

export type SolicitudAusencia = {
  id: string;
  empleadoId: string;
  nombre: string;
  tipo: string;
  color: string | null;
  desde: string;
  hasta: string;
  medioDia: boolean;
  horas: number | null;
  nota: string | null;
  creadoEn: string;
  esteCentro: boolean;
};

export type CambioTurno = {
  id: string;
  estado: string;
  nota: string | null;
  creadoEn: string;
  turnoId: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  puesto: string | null;
  solicitante: string;
  destinatarioId: string | null;
  destinatario: string | null;
  esteCentro: boolean;
};

export type Avisos = {
  semanaProx: { lunes: string; total: number; borrador: number; sinAsignar: number };
  semanaActual: { lunes: string; total: number; borrador: number; sinAsignar: number };
  /** Días (iso) de los últimos 7 con fichajes sin validar en este centro. */
  diasSinValidar: string[];
  finContrato: { empleadoId: string; nombre: string; fechaBaja: string }[];
  sinHoras: { empleadoId: string; nombre: string }[];
  sinPin: { empleadoId: string; nombre: string }[];
};

export type DatosHoy = {
  hoy: string;
  avisoRetrasoMin: number;
  trabajan: TrabajaHoy[];
  ausentes: AusenteHoy[];
  solicitudes: SolicitudAusencia[];
  cambios: CambioTurno[];
  avisos: Avisos;
};

/* ==================== Carga ==================== */

const SELECT_TURNO = "id, empleado_id, fecha, hora_inicio, hora_fin, pausa_min, puesto, color, empleados(nombre, apellidos), rrhh_puestos_cat(nombre, color)";

type TurnoDia = {
  id: string;
  empleado_id: string | null;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  pausa_min: number;
  puesto: string | null;
  color: string | null;
  empleados: Nombre;
  rrhh_puestos_cat: { nombre: string; color: string } | null;
  /** Instantes absolutos del turno. */
  inicioMs: number;
  finMs: number;
  deAyer: boolean;
};

const estadoDe = (ultimo: Fichaje): EstadoFichaje =>
  ultimo.tipo === "salida" ? "salio" : ultimo.tipo === "pausa_inicio" ? "en_pausa" : "dentro";

export async function cargarHoy(centroId: string): Promise<DatosHoy> {
  const { sb } = await cliente();
  const hoy = hoyMadrid();
  const ayer = sumaDias(hoy, -1);
  const manana = sumaDias(hoy, 1);
  const hace7 = sumaDias(hoy, -7);
  const lunesActual = lunesDe(hoy);
  const lunesProx = sumaDias(lunesActual, 7);
  const domingoProx = sumaDias(lunesProx, 6);
  const en15 = sumaDias(hoy, 15);
  const iniHoyMs = inicioDiaMadrid(hoy).getTime();
  const iniManana = inicioDiaMadrid(manana).toISOString();
  const iniHace7Ms = inicioDiaMadrid(hace7).getTime();
  const iniHace7 = new Date(iniHace7Ms).toISOString();

  const [config, turnosHoy, turnosAyer, fichajes7d, asigs, empleados, ausHoy, solicitadas, cambios, turnosSemanas, horasDia, periodos] =
    await Promise.all([
      sb.from("rrhh_centros_config").select("aviso_retraso_min").eq("centro_id", centroId).maybeSingle(),
      sb.from("rrhh_turnos").select(SELECT_TURNO).eq("centro_id", centroId).eq("fecha", hoy).eq("estado", "publicado").order("hora_inicio"),
      // Turnos de ayer: los que cruzan medianoche (hora_fin <= hora_inicio) siguen siendo «de hoy» hasta que acaban.
      // PostgREST no compara dos columnas entre sí: se filtra abajo (son pocas filas por centro y día).
      sb.from("rrhh_turnos").select(SELECT_TURNO).eq("centro_id", centroId).eq("fecha", ayer).eq("estado", "publicado").order("hora_inicio"),
      // Fichajes de los últimos 7 días + hoy en este centro (estado de hoy y aviso de sin validar)
      sb.from("rrhh_fichajes").select("*").eq("centro_id", centroId).gte("ts", iniHace7).lt("ts", iniManana).order("ts"),
      // Quién es «del centro» hoy: asignaciones vigentes…
      sb
        .from("rrhh_asignaciones")
        .select("empleado_id")
        .eq("centro_id", centroId)
        .or(`fecha_inicio.is.null,fecha_inicio.lte.${hoy}`)
        .or(`fecha_fin.is.null,fecha_fin.gte.${hoy}`),
      // …o centro principal. Activos de la cuenta (≈200 filas; a un encargado le llega vacío por RLS)
      sb.from("empleados").select("id, nombre, apellidos, centro_principal_id, pin_hash").is("fecha_baja", null),
      sb
        .from("rrhh_ausencias")
        .select("id, empleado_id, centro_id, tipo, fecha_inicio, fecha_fin, medio_dia, horas, empleados(nombre, apellidos), rrhh_tipos_ausencia(nombre, color)")
        .eq("estado", "aprobada")
        .lte("fecha_inicio", hoy)
        .gte("fecha_fin", hoy),
      sb
        .from("rrhh_ausencias")
        .select("id, empleado_id, centro_id, tipo, fecha_inicio, fecha_fin, medio_dia, horas, nota, creado_en, empleados(nombre, apellidos), rrhh_tipos_ausencia(nombre, color)")
        .eq("estado", "solicitada")
        .order("creado_en")
        .limit(200),
      sb
        .from("rrhh_cambios_turno")
        .select(
          "id, estado, nota, creado_en, turno_id, destinatario_id, rrhh_turnos!inner(fecha, hora_inicio, hora_fin, centro_id, puesto), solicitante:empleados!rrhh_cambios_turno_solicitante_id_fkey(nombre, apellidos), destinatario:empleados!rrhh_cambios_turno_destinatario_id_fkey(nombre, apellidos)",
        )
        .in("estado", ["pendiente", "aceptado_companero"])
        .gte("rrhh_turnos.fecha", hoy)
        .order("creado_en")
        .limit(200),
      // Esta semana y la que viene, para los avisos de publicación y huecos
      sb.from("rrhh_turnos").select("fecha, estado, empleado_id").eq("centro_id", centroId).gte("fecha", lunesActual).lte("fecha", domingoProx),
      sb.from("rrhh_horas_dia").select("empleado_id, fecha, estado").eq("centro_id", centroId).gte("fecha", hace7).lt("fecha", hoy),
      // Periodos vigentes o futuros (solo gestores los ven; a un encargado le llega vacío)
      sb
        .from("rrhh_periodos_contrato")
        .select("empleado_id, fecha_alta, fecha_baja, horas_semana, empleados(nombre, apellidos)")
        .or(`fecha_baja.is.null,fecha_baja.gte.${hoy}`),
    ]);

  const avisoRetrasoMin = config.data?.aviso_retraso_min ?? 10;
  const ahora = Date.now();

  /* ---- Quién es del centro ---- */
  const delCentro = new Set((asigs.data ?? []).map((a) => a.empleado_id));
  const empPorId: Record<string, { nombre: string; pin: boolean }> = {};
  for (const e of empleados.data ?? []) {
    empPorId[e.id] = { nombre: nombreDe(e), pin: !!e.pin_hash };
    if (e.centro_principal_id === centroId) delCentro.add(e.id);
  }

  /* ---- Turnos que cuentan hoy ---- */
  const turnos: TurnoDia[] = [];
  for (const t of turnosHoy.data ?? []) {
    turnos.push({
      ...t,
      empleados: t.empleados as Nombre,
      rrhh_puestos_cat: t.rrhh_puestos_cat as TurnoDia["rrhh_puestos_cat"],
      inicioMs: instanteMadrid(hoy, t.hora_inicio).getTime(),
      finMs: instanteMadridMin(hoy, finAbsoluto(t)).getTime(),
      deAyer: false,
    });
  }
  for (const t of turnosAyer.data ?? []) {
    if (minutos(t.hora_fin.slice(0, 5)) > minutos(t.hora_inicio.slice(0, 5))) continue;
    turnos.push({
      ...t,
      empleados: t.empleados as Nombre,
      rrhh_puestos_cat: t.rrhh_puestos_cat as TurnoDia["rrhh_puestos_cat"],
      inicioMs: instanteMadrid(ayer, t.hora_inicio).getTime(),
      finMs: instanteMadridMin(ayer, finAbsoluto(t)).getTime(),
      deAyer: true,
    });
  }

  /* ---- Fichajes de esa gente en cualquier centro (desde el inicio de ayer) ---- */
  const idsTurnos = [...new Set(turnos.map((t) => t.empleado_id).filter((x): x is string => !!x))];
  const iniAyer = inicioDiaMadrid(ayer).toISOString();
  const fichajesEmp = idsTurnos.length
    ? await sb.from("rrhh_fichajes").select("*").in("empleado_id", idsTurnos).gte("ts", iniAyer).lt("ts", iniManana).order("ts")
    : { data: [] as Fichaje[] };

  const vistos = new Set<string>();
  const todosFichajes: Fichaje[] = [];
  for (const f of [...((fichajes7d.data ?? []) as Fichaje[]), ...((fichajesEmp.data ?? []) as Fichaje[])]) {
    if (vistos.has(f.id)) continue;
    vistos.add(f.id);
    todosFichajes.push(f);
  }
  todosFichajes.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const { efectivos } = efectivosDe(todosFichajes);

  /* ---- Cada fichaje al turno más cercano de su empleado (ventana ±2 h) ---- */
  const turnosPorEmp: Record<string, TurnoDia[]> = {};
  for (const t of turnos) if (t.empleado_id) (turnosPorEmp[t.empleado_id] = turnosPorEmp[t.empleado_id] || []).push(t);
  const fichajesTurno: Record<string, Fichaje[]> = {};
  /** Fichajes de hoy en este centro que no son de ningún turno (gente sin turno o fuera de hora). */
  const sueltosHoy: Record<string, Fichaje[]> = {};
  for (const f of efectivos) {
    const x = new Date(f.ts).getTime();
    let mejor: TurnoDia | null = null;
    let mejorDist = Infinity;
    for (const t of turnosPorEmp[f.empleado_id] ?? []) {
      const dist = x < t.inicioMs ? t.inicioMs - x : x > t.finMs ? x - t.finMs : 0;
      if (dist <= MARGEN_MS && dist < mejorDist) { mejor = t; mejorDist = dist; }
    }
    if (mejor) (fichajesTurno[mejor.id] = fichajesTurno[mejor.id] || []).push(f);
    else if (f.centro_id === centroId && x >= iniHoyMs) (sueltosHoy[f.empleado_id] = sueltosHoy[f.empleado_id] || []).push(f);
  }

  const trabajan: TrabajaHoy[] = [];
  for (const t of turnos) {
    const fs = fichajesTurno[t.id] ?? [];
    const ultimo = fs[fs.length - 1] ?? null;
    const entrada = fs.find((f) => f.tipo === "entrada") ?? null;
    let estado: EstadoFichaje;
    if (!t.empleado_id) estado = "sin_cubrir";
    else if (ultimo) estado = estadoDe(ultimo);
    else estado = ahora < t.inicioMs + avisoRetrasoMin * MIN ? "pendiente" : "sin_fichar";
    // Un cierre de ayer que acabó hace rato y está cerrado (o nadie fichó) ya no es «de hoy»
    if (t.deAyer && ahora > t.finMs + MARGEN_MS && estado !== "dentro" && estado !== "en_pausa") continue;
    let retrasoMin = 0;
    if (entrada) {
      const dif = Math.round((new Date(entrada.ts).getTime() - t.inicioMs) / MIN);
      if (dif > avisoRetrasoMin) retrasoMin = dif;
    }
    let nota: string | null = null;
    if ((estado === "dentro" || estado === "en_pausa") && ahora > t.finMs + HORA) nota = "No ha fichado la salida";
    const otroCentro = fs.length && fs.every((f) => f.centro_id !== centroId) ? fs[fs.length - 1].centro_id : null;
    trabajan.push({
      turnoId: t.id,
      empleadoId: t.empleado_id,
      nombre: t.empleado_id ? (t.empleados ? nombreDe(t.empleados) : empPorId[t.empleado_id]?.nombre ?? "—") : "Sin asignar",
      horaInicio: t.hora_inicio.slice(0, 5),
      horaFin: t.hora_fin.slice(0, 5),
      deAyer: t.deAyer,
      pausaMin: t.pausa_min,
      puesto: t.rrhh_puestos_cat?.nombre ?? t.puesto,
      puestoColor: t.color ?? t.rrhh_puestos_cat?.color ?? null,
      estado,
      ultimoTs: ultimo?.ts ?? null,
      entradaTs: entrada?.ts ?? null,
      retrasoMin,
      fichoEnCentroId: otroCentro,
      nota,
    });
  }
  // Los de ayer primero (ya están en marcha), luego por hora de inicio
  trabajan.sort((a, b) => (a.deAyer === b.deAyer ? a.horaInicio.localeCompare(b.horaInicio) : a.deAyer ? -1 : 1));

  // Fichajes de hoy en este centro que no casan con ningún turno: también cuentan («no planificado»)
  const sinTurno = Object.keys(sueltosHoy);
  if (sinTurno.length) {
    const faltan = sinTurno.filter((id) => !empPorId[id]);
    if (faltan.length) {
      const { data: emps } = await sb.from("empleados").select("id, nombre, apellidos").in("id", faltan);
      for (const e of emps ?? []) empPorId[e.id] = { nombre: nombreDe(e), pin: true };
    }
    for (const id of sinTurno) {
      const fs = sueltosHoy[id];
      const ultimo = fs[fs.length - 1];
      trabajan.push({
        turnoId: "sin-turno-" + id,
        empleadoId: id,
        nombre: empPorId[id]?.nombre ?? "Empleado",
        horaInicio: "",
        horaFin: "",
        deAyer: false,
        pausaMin: 0,
        puesto: null,
        puestoColor: null,
        estado: estadoDe(ultimo),
        ultimoTs: ultimo.ts,
        entradaTs: fs.find((f) => f.tipo === "entrada")?.ts ?? null,
        retrasoMin: 0,
        fichoEnCentroId: null,
        nota: turnosPorEmp[id]?.length ? "Fichaje fuera de su turno" : "Sin turno planificado hoy",
      });
    }
  }

  /* ---- Ausentes hoy ---- */
  const esDelCentro = (a: { centro_id: string | null; empleado_id: string }) =>
    a.centro_id === centroId || (a.centro_id === null && delCentro.has(a.empleado_id));
  const ausentes: AusenteHoy[] = (ausHoy.data ?? [])
    .filter(esDelCentro)
    .map((a) => {
      const ta = a.rrhh_tipos_ausencia as { nombre: string; color: string | null } | null;
      return {
        id: a.id,
        empleadoId: a.empleado_id,
        nombre: nombreDe(a.empleados as Nombre),
        tipo: ta?.nombre ?? a.tipo,
        color: ta?.color ?? null,
        desde: a.fecha_inicio,
        hasta: a.fecha_fin,
        medioDia: a.medio_dia,
        horas: a.horas,
      };
    })
    .sort((x, y) => x.nombre.localeCompare(y.nombre));

  /* ---- Pendiente de ti ---- */
  const solicitudes: SolicitudAusencia[] = (solicitadas.data ?? []).map((a) => {
    const ta = a.rrhh_tipos_ausencia as { nombre: string; color: string | null } | null;
    return {
      id: a.id,
      empleadoId: a.empleado_id,
      nombre: nombreDe(a.empleados as Nombre),
      tipo: ta?.nombre ?? a.tipo,
      color: ta?.color ?? null,
      desde: a.fecha_inicio,
      hasta: a.fecha_fin,
      medioDia: a.medio_dia,
      horas: a.horas,
      nota: a.nota,
      creadoEn: a.creado_en,
      esteCentro: esDelCentro(a),
    };
  });
  const cambiosTurno: CambioTurno[] = (cambios.data ?? []).map((c) => {
    const t = c.rrhh_turnos as { fecha: string; hora_inicio: string; hora_fin: string; centro_id: string; puesto: string | null };
    return {
      id: c.id,
      estado: c.estado,
      nota: c.nota,
      creadoEn: c.creado_en,
      turnoId: c.turno_id,
      fecha: t.fecha,
      horaInicio: t.hora_inicio.slice(0, 5),
      horaFin: t.hora_fin.slice(0, 5),
      puesto: t.puesto,
      solicitante: nombreDe(c.solicitante as Nombre),
      destinatarioId: c.destinatario_id,
      destinatario: c.destinatario_id ? nombreDe(c.destinatario as Nombre) : null,
      esteCentro: t.centro_id === centroId,
    };
  });

  /* ---- Avisos ---- */
  const resumenSemana = (lunes: string) => {
    const fin = sumaDias(lunes, 6);
    const ts = (turnosSemanas.data ?? []).filter((t) => t.fecha >= lunes && t.fecha <= fin);
    return {
      lunes,
      total: ts.length,
      borrador: ts.filter((t) => t.estado === "borrador").length,
      sinAsignar: ts.filter((t) => !t.empleado_id).length,
    };
  };
  // Días con fichajes en este centro (últimos 7, sin hoy) sin horas_dia validada para ese empleado
  const validados = new Set((horasDia.data ?? []).filter((h) => h.estado === "validada").map((h) => h.empleado_id + "|" + h.fecha));
  const diasSinValidar = new Set<string>();
  for (const f of efectivos) {
    const x = new Date(f.ts).getTime();
    if (f.centro_id !== centroId || x >= iniHoyMs || x < iniHace7Ms) continue;
    const dia = fechaMadrid(f.ts);
    if (!validados.has(f.empleado_id + "|" + dia)) diasSinValidar.add(dia);
  }

  // Contratos: una entrada por empleado. Un periodo que acaba pero ya tiene el siguiente creado es una renovación, no un aviso.
  const periodosEmp: Record<string, { fecha_alta: string; fecha_baja: string | null; horas_semana: number | null; nombre: string }[]> = {};
  for (const p of periodos.data ?? []) {
    if (!delCentro.has(p.empleado_id)) continue;
    (periodosEmp[p.empleado_id] = periodosEmp[p.empleado_id] || []).push({
      fecha_alta: p.fecha_alta, fecha_baja: p.fecha_baja, horas_semana: p.horas_semana,
      nombre: nombreDe(p.empleados as Nombre),
    });
  }
  const finContrato: Avisos["finContrato"] = [];
  const sinHoras: Avisos["sinHoras"] = [];
  for (const [empleadoId, ps] of Object.entries(periodosEmp)) {
    const vigentes = ps.filter((p) => p.fecha_alta <= hoy);
    if (!vigentes.length) continue;
    const nombre = vigentes[0].nombre;
    const acaba = vigentes
      .filter((p) => p.fecha_baja && p.fecha_baja <= en15 && !ps.some((q) => q.fecha_alta > p.fecha_baja!))
      .sort((a, b) => a.fecha_baja!.localeCompare(b.fecha_baja!))[0];
    if (acaba) finContrato.push({ empleadoId, nombre, fechaBaja: acaba.fecha_baja! });
    if (vigentes.some((p) => p.horas_semana == null)) sinHoras.push({ empleadoId, nombre });
  }
  // Sin PIN: empleados activos del centro (no solo los que tienen periodo vigente)
  const sinPin: Avisos["sinPin"] = [];
  for (const id of delCentro) {
    const e = empPorId[id];
    if (e && !e.pin) sinPin.push({ empleadoId: id, nombre: e.nombre });
  }
  finContrato.sort((a, b) => a.fechaBaja.localeCompare(b.fechaBaja) || a.nombre.localeCompare(b.nombre));
  sinHoras.sort((a, b) => a.nombre.localeCompare(b.nombre));
  sinPin.sort((a, b) => a.nombre.localeCompare(b.nombre));

  return {
    hoy,
    avisoRetrasoMin,
    trabajan,
    ausentes,
    solicitudes,
    cambios: cambiosTurno,
    avisos: {
      semanaProx: resumenSemana(lunesProx),
      semanaActual: resumenSemana(lunesActual),
      diasSinValidar: [...diasSinValidar].sort(),
      finContrato,
      sinHoras,
      sinPin,
    },
  };
}

/* ==================== Novedades (feed «Noticias» de Skello) ==================== */

export type Novedad = {
  ts: string;
  /** turno_creado · turno_publicado · turno_modificado · turno_eliminado · ausencia_solicitada · ausencia_aprobada ·
      ausencia_rechazada · jornada_confirmada · cambio_pedido · cambio_aprobado · cambio_rechazado … */
  tipo: string;
  texto: string;
  autor: string;
  centro: string | null;
};

export type Novedades = {
  items: Novedad[];
  /** La RPC rrhh_novedades aún no está en la base (migración 20261001090000_rrhh_novedades sin aplicar). */
  pendiente: boolean;
  error?: string;
};

/** Filas de una RPC de novedades (rrhh_novedades / rrhh_novedades_empleado, mismo formato) → Novedad[]. */
function aNovedades(data: unknown): Novedad[] {
  const filas = Array.isArray(data) ? (data as Partial<Novedad>[]) : [];
  return filas
    .filter((f) => typeof f.ts === "string" && typeof f.texto === "string")
    .map((f) => ({ ts: f.ts!, tipo: f.tipo ?? "", texto: f.texto!, autor: f.autor ?? "Sistema", centro: f.centro ?? null }));
}

/** Últimas entradas de la cuenta (centroId = null) o de un centro: lo que hace la gestión (rrhh_novedades)
    más lo que hace el empleado desde su app (rrhh_novedades_empleado: «X ha confirmado su jornada del…»),
    unidas por fecha. Nunca lanza: si la RPC principal no existe devuelve pendiente = true y la tarjeta lo explica;
    si falla la del empleado, el feed sale sin esas entradas. */
export async function cargarNovedades(centroId: string | null, limite = 30): Promise<Novedades> {
  const { sb } = await cliente();
  const lim = Math.max(1, Math.min(limite, 200));
  // p_centro_id tiene default null en las funciones: si no hay centro se omite (PostgREST no admite null explícito en el tipo).
  const args = centroId ? { p_centro_id: centroId, p_limite: lim } : { p_limite: lim };
  const [gestion, empleado] = await Promise.all([sb.rpc("rrhh_novedades", args), sb.rpc("rrhh_novedades_empleado", args)]);
  if (gestion.error) {
    const e = gestion.error;
    const falta = e.code === "PGRST202" || e.code === "42883" || /rrhh_novedades/.test(e.message);
    return { items: [], pendiente: falta, error: falta ? undefined : e.message };
  }
  if (empleado.error) console.error("[rrhh] novedades empleado:", empleado.error.code, empleado.error.message);
  const items = [...aNovedades(gestion.data), ...(empleado.error ? [] : aNovedades(empleado.data))]
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, lim);
  return { items, pendiente: false };
}

/* ==================== Acciones rápidas ==================== */

const SIN_FILA = "Esta solicitud ya estaba resuelta o no tienes permiso";

/** Aprobar o rechazar (con motivo) una solicitud de ausencia desde la portada. */
export async function resolverSolicitud(id: string, estado: "aprobada" | "rechazada", motivo?: string): Promise<R> {
  const { sb, perfil } = await cliente();
  if (estado === "rechazada" && !motivo?.trim()) return { ok: false, error: "Di el motivo del rechazo" };
  const { data, error } = await sb
    .from("rrhh_ausencias")
    .update({
      estado,
      resuelta_por: perfil.id,
      resuelta_en: new Date().toISOString(),
      motivo_rechazo: estado === "rechazada" ? motivo!.trim() : null,
    })
    .eq("id", id)
    .eq("estado", "solicitada")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: SIN_FILA };
  return { ok: true };
}

/** Aprobar un cambio de turno: el turno pasa al destinatario y la petición queda aprobada.
    Si el compañero aún no ha aceptado (estado «pendiente») devuelve data.confirmar = true y no hace nada
    hasta que se llame con forzar = true. Pendiente del orquestador: RPC rrhh_aprobar_cambio_turno que haga
    los dos updates en una transacción; mientras tanto, si falla el segundo se deshace el primero. */
export async function aprobarCambioTurno(id: string, forzar = false): Promise<R<{ confirmar: true }>> {
  const { sb, perfil } = await cliente();
  const hoy = hoyMadrid();
  const { data: c, error: e0 } = await sb
    .from("rrhh_cambios_turno")
    .select("turno_id, solicitante_id, destinatario_id, estado, rrhh_turnos!inner(empleado_id, fecha, estado)")
    .eq("id", id)
    .maybeSingle();
  if (e0 || !c) return { ok: false, error: e0?.message || "No encuentro la petición" };
  if (!["pendiente", "aceptado_companero"].includes(c.estado)) return { ok: false, error: "Esta petición ya está resuelta" };
  if (!c.destinatario_id) return { ok: false, error: "Es una petición abierta, sin compañero: asígnala desde Planificación" };
  const t = c.rrhh_turnos as { empleado_id: string | null; fecha: string; estado: string };
  if (t.empleado_id !== c.solicitante_id) return { ok: false, error: "El turno ya no es de quien lo pidió cambiar" };
  if (t.estado !== "publicado") return { ok: false, error: "El turno ya no está publicado" };
  if (t.fecha < hoy) return { ok: false, error: "El turno ya ha pasado" };
  if (c.estado === "pendiente" && !forzar) return { ok: false, error: "El compañero aún no ha aceptado", data: { confirmar: true } };

  const { data: d1, error: e1 } = await sb
    .from("rrhh_turnos")
    .update({ empleado_id: c.destinatario_id })
    .eq("id", c.turno_id)
    .eq("empleado_id", c.solicitante_id)
    .select("id");
  if (e1) return { ok: false, error: e1.message };
  if (!d1?.length) return { ok: false, error: "El turno ha cambiado mientras tanto; vuelve a cargar" };

  const { data: d2, error: e2 } = await sb
    .from("rrhh_cambios_turno")
    .update({ estado: "aprobado", resuelto_por: perfil.id, resuelto_en: new Date().toISOString() })
    .eq("id", id)
    .in("estado", ["pendiente", "aceptado_companero"])
    .select("id");
  if (e2 || !d2?.length) {
    // Deshacer el primer paso para no dejar el turno movido con la petición abierta
    await sb.from("rrhh_turnos").update({ empleado_id: c.solicitante_id }).eq("id", c.turno_id).eq("empleado_id", c.destinatario_id);
    return { ok: false, error: e2?.message || SIN_FILA };
  }
  return { ok: true };
}

export async function rechazarCambioTurno(id: string, motivo?: string): Promise<R> {
  const { sb, perfil } = await cliente();
  const { data: c } = await sb.from("rrhh_cambios_turno").select("nota, estado").eq("id", id).maybeSingle();
  if (!c) return { ok: false, error: "No encuentro la petición" };
  if (!["pendiente", "aceptado_companero"].includes(c.estado)) return { ok: false, error: "Esta petición ya está resuelta" };
  const nota = motivo?.trim() ? `${c.nota ? c.nota + " · " : ""}Rechazado: ${motivo.trim()}` : c.nota;
  const { data, error } = await sb
    .from("rrhh_cambios_turno")
    .update({ estado: "rechazado", nota, resuelto_por: perfil.id, resuelto_en: new Date().toISOString() })
    .eq("id", id)
    .in("estado", ["pendiente", "aceptado_companero"])
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: SIN_FILA };
  return { ok: true };
}
