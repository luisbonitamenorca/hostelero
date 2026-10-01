/* Lógica pura de la sección Fichajes v2 (validación planificado vs fichado).
   Sin "use server" ni "use client": se puede usar en servidor, cliente y tests.
   Todo el tiempo se interpreta en Europe/Madrid, que es donde están los centros. */

import { calcularDia, efectivosDe, finAbsoluto, horasNetas, minutos, type Fichaje } from "../tipos";

export const TZ_MADRID = "Europe/Madrid";

/** Un fichaje de salida/pausa antes de esta hora sin entrada ese día cierra la jornada de la víspera. */
export const CORTE_JORNADA_MIN = 6 * 60;

/** Una jornada abierta la víspera se cierra con la salida del día siguiente si no han pasado más de 16 h desde la entrada. */
export const MAX_JORNADA_MS = 16 * 3600000;

/** Columnas de rrhh_fichajes que usa el cuadrante (sin lat/lng ni dispositivo: no hacen falta aquí). */
export type FichajeMin = Pick<Fichaje, "id" | "empleado_id" | "centro_id" | "tipo" | "ts" | "metodo" | "corrige_a" | "motivo_correccion">;

/* Los helpers de tipos.ts piden el tipo completo pero solo leen id, tipo, ts y corrige_a. */
export const efectivosMin = (fs: FichajeMin[]) => efectivosDe(fs as Fichaje[]);
export const calcularDiaMin = (efs: FichajeMin[], esHoy: boolean) => calcularDia(efs as Fichaje[], esHoy);

export type ReglaHoras = "planificado" | "fichado" | "plan_tolerancia";

export type ConfigCalculo = {
  regla_horas: string;
  tolerancia_min: number;
  redondeo_min: number;
};

export type TurnoMin = { fecha: string; hora_inicio: string; hora_fin: string; pausa_min: number | null };

export type EstadoCelda =
  | "ok"          // verde: dentro de tolerancia
  | "desvio"      // ámbar: retraso o salida anticipada por encima de la tolerancia
  | "incidencia"  // ámbar: fichajes incoherentes (entrada sin salida, etc.)
  | "en_curso"    // hoy, jornada abierta
  | "no_ficho"    // rojo: turno sin fichajes
  | "no_plan"     // gris: fichajes sin turno
  | "ausencia"    // ausencia aprobada
  | "pendiente"   // hoy, el turno aún no ha empezado
  | "futuro"      // día posterior a hoy
  | "vacio";      // ni turno ni fichajes

export type Propuesta = {
  horas_plan: number;
  horas_fichadas: number;
  horas_retenidas: number;
  retraso_min: number;
  salida_antic_min: number;
  incidencias: string[];
};

/* ==================== Tiempo en Europe/Madrid ==================== */

const partesMadrid = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ_MADRID,
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

/** Fecha (yyyy-mm-dd) y minutos desde medianoche de un timestamp, en hora de Madrid. */
export function fechaHoraMadrid(ts: string | Date): { fecha: string; minutos: number } {
  const p: Record<string, string> = {};
  for (const x of partesMadrid.formatToParts(typeof ts === "string" ? new Date(ts) : ts)) p[x.type] = x.value;
  const h = p.hour === "24" ? 0 : Number(p.hour);
  return { fecha: `${p.year}-${p.month}-${p.day}`, minutos: h * 60 + Number(p.minute) };
}

/** "HH:MM" en hora de Madrid. */
export function horaMadrid(ts: string): string {
  const { minutos: m } = fechaHoraMadrid(ts);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Fecha de hoy en Madrid (yyyy-mm-dd). */
export const hoyMadrid = () => fechaHoraMadrid(new Date()).fecha;

/** ISO (UTC) del instante «fecha a las hh:mm» en Madrid. Sirve para acotar consultas. */
export function isoMadrid(fecha: string, hhmm: string): string {
  const supuesto = new Date(`${fecha}T${hhmm}:00Z`);
  const local = fechaHoraMadrid(supuesto);
  const hh = String(Math.floor(local.minutos / 60)).padStart(2, "0");
  const mm = String(local.minutos % 60).padStart(2, "0");
  const comoUtc = new Date(`${local.fecha}T${hh}:${mm}:00Z`);
  const desfase = comoUtc.getTime() - supuesto.getTime();
  return new Date(supuesto.getTime() - desfase).toISOString();
}

const sumaDiaIso = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/* ==================== Jornadas ==================== */

/**
 * Agrupa fichajes (ya efectivos, sin anulados) por «jornada»: la fecha del turno al que pertenecen.
 * Una salida o pausa después de medianoche con la jornada abierta pertenece al día de la entrada.
 * Una salida/pausa antes de las 06:00 sin entrada previa ese día cierra la jornada del día anterior.
 * Devuelve un mapa fecha → fichajes ordenados por ts.
 */
export function agruparJornadas(fichajes: FichajeMin[]): Record<string, FichajeMin[]> {
  const orden = [...fichajes].sort((a, b) => a.ts.localeCompare(b.ts));
  const porDia: Record<string, FichajeMin[]> = {};
  let abierta: { fecha: string; ms: number } | null = null; // jornada con entrada sin cerrar
  for (const f of orden) {
    const { fecha, minutos: m } = fechaHoraMadrid(f.ts);
    const ms = new Date(f.ts).getTime();
    let destino = fecha;
    if (f.tipo === "entrada") {
      abierta = { fecha, ms };
    } else {
      // Con entrada abierta la víspera, la salida es de esa jornada aunque sea después de las 06:00
      // (turno nocturno 23:00–07:00) mientras no hayan pasado más de 16 h desde la entrada.
      const sigueAbierta = abierta !== null && (abierta.fecha === fecha || (sumaDiaIso(abierta.fecha, 1) === fecha && (m < CORTE_JORNADA_MIN || ms - abierta.ms <= MAX_JORNADA_MS)));
      if (sigueAbierta) destino = (abierta as { fecha: string }).fecha;
      else if (m < CORTE_JORNADA_MIN) destino = sumaDiaIso(fecha, -1);
      if (f.tipo === "salida") abierta = null;
    }
    (porDia[destino] = porDia[destino] || []).push(f);
  }
  return porDia;
}

/** Entrada, salida (en minutos absolutos respecto a la jornada; la salida puede pasar de 1440) y pausas. */
export function resumenJornada(fecha: string, efs: FichajeMin[]) {
  let entrada: number | null = null;
  let salida: number | null = null;
  let pausaIni: number | null = null;
  let pausasMin = 0;
  let nPausas = 0;
  const abs = (f: FichajeMin) => {
    const { fecha: fd, minutos: m } = fechaHoraMadrid(f.ts);
    return fd > fecha ? m + 1440 : fd < fecha ? m - 1440 : m;
  };
  for (const f of efs) {
    const m = abs(f);
    if (f.tipo === "entrada" && entrada === null) entrada = m;
    else if (f.tipo === "salida") salida = m;
    else if (f.tipo === "pausa_inicio") pausaIni = m;
    else if (f.tipo === "pausa_fin" && pausaIni !== null) { pausasMin += m - pausaIni; nPausas++; pausaIni = null; }
  }
  return { entrada, salida, pausasMin, nPausas };
}

/* ==================== Cálculo de horas ==================== */

/** Redondea horas al múltiplo más cercano de `redondeoMin` minutos (0 = sin redondeo). */
export function redondearHoras(horas: number, redondeoMin: number): number {
  if (!redondeoMin || redondeoMin <= 0) return Math.round(horas * 100) / 100;
  const min = Math.round((horas * 60) / redondeoMin) * redondeoMin;
  return Math.round((min / 60) * 100) / 100;
}

/** Horas retenidas según la regla del centro. `horasFichadas` ya viene redondeada si procede. */
export function horasRetenidas(horasPlan: number, horasFichadas: number, cfg: ConfigCalculo): number {
  const r = (n: number) => Math.round(n * 100) / 100;
  switch (cfg.regla_horas as ReglaHoras) {
    case "planificado":
      return r(horasPlan);
    case "fichado":
      return r(horasFichadas);
    case "plan_tolerancia":
    default: {
      const tol = (cfg.tolerancia_min || 0) / 60;
      return Math.abs(horasFichadas - horasPlan) <= tol + 1e-9 ? r(horasPlan) : r(horasFichadas);
    }
  }
}

/** Retraso en la entrada y salida anticipada (minutos, nunca negativos) frente a los turnos del día. */
export function desviaciones(turnos: TurnoMin[], entrada: number | null, salida: number | null) {
  if (!turnos.length) return { retraso_min: 0, salida_antic_min: 0 };
  const inicioPlan = Math.min(...turnos.map((t) => minutos(t.hora_inicio)));
  const finPlan = Math.max(...turnos.map((t) => finAbsoluto(t)));
  const retraso_min = entrada === null ? 0 : Math.max(0, entrada - inicioPlan);
  const salida_antic_min = salida === null ? 0 : Math.max(0, finPlan - salida);
  return { retraso_min, salida_antic_min };
}

export const horasPlanDe = (turnos: TurnoMin[]) => Math.round(turnos.reduce((s, t) => s + horasNetas(t), 0) * 100) / 100;

/**
 * Propuesta de horas de un empleado para un día: combina turnos publicados y fichajes efectivos
 * con la regla del centro. Devuelve null si no hay nada que proponer (ni turno ni fichajes).
 */
export function calcularPropuesta(args: {
  fecha: string;
  turnos: TurnoMin[];
  efectivos: FichajeMin[];
  cfg: ConfigCalculo;
  esHoy: boolean;
}): Propuesta | null {
  const { fecha, turnos, efectivos, cfg, esHoy } = args;
  if (!turnos.length && !efectivos.length) return null;
  const horas_plan = horasPlanDe(turnos);
  const dia = calcularDiaMin(efectivos, esHoy);
  const horas_fichadas = redondearHoras(dia.horas, cfg.redondeo_min);
  const { entrada, salida } = resumenJornada(fecha, efectivos);
  const { retraso_min, salida_antic_min } = desviaciones(turnos, entrada, salida);
  const incidencias: string[] = [...dia.inc];
  if (turnos.length && !efectivos.length) incidencias.push("no fichó");
  if (!turnos.length && efectivos.length) incidencias.push("no planificado");
  if (dia.enCurso) incidencias.push("jornada en curso");
  if (retraso_min > cfg.tolerancia_min) incidencias.push(`retraso ${retraso_min} min`);
  if (salida_antic_min > cfg.tolerancia_min) incidencias.push(`salida anticipada ${salida_antic_min} min`);
  return {
    horas_plan,
    horas_fichadas,
    horas_retenidas: horasRetenidas(horas_plan, horas_fichadas, cfg),
    retraso_min,
    salida_antic_min,
    incidencias: [...new Set(incidencias)],
  };
}

/** Ausencia aprobada del día: 'completa' (jornada entera) o 'parcial' (medio día u horas). */
export type AusenciaDia = "completa" | "parcial" | null;

/** Estado visual de una celda del cuadrante semanal. */
export function estadoCelda(args: {
  fecha: string;
  hoy: string;
  turnos: TurnoMin[];
  efectivos: FichajeMin[];
  ausencia: AusenciaDia;
  toleranciaMin: number;
  ahoraMin?: number; // minutos de hoy en Madrid, solo para 'pendiente'
}): EstadoCelda {
  const { fecha, hoy, turnos, efectivos, ausencia, toleranciaMin } = args;
  if (fecha > hoy) return "futuro";
  // Ausencia de jornada completa sin fichajes: es ausencia aunque haya turno publicado (baja o vacaciones aprobadas después de publicar).
  if (ausencia === "completa" && !efectivos.length) return "ausencia";
  if (!turnos.length && !efectivos.length) return ausencia ? "ausencia" : "vacio";
  if (!turnos.length) return "no_plan";
  if (!efectivos.length) {
    if (fecha === hoy && args.ahoraMin != null) {
      const inicioPlan = Math.min(...turnos.map((t) => minutos(t.hora_inicio)));
      if (args.ahoraMin < inicioPlan + toleranciaMin) return "pendiente";
    }
    return "no_ficho";
  }
  const dia = calcularDiaMin(efectivos, fecha === hoy);
  if (dia.enCurso) return "en_curso";
  if (dia.inc.length) return "incidencia";
  const { entrada, salida } = resumenJornada(fecha, efectivos);
  const { retraso_min, salida_antic_min } = desviaciones(turnos, entrada, salida);
  if (retraso_min > toleranciaMin || salida_antic_min > toleranciaMin) return "desvio";
  return "ok";
}

/** 7.5 → "7,5" (sin unidad; para celdas estrechas). */
export const numH = (n: number) => String(Math.round((Number(n) || 0) * 100) / 100).replace(".", ",");

/* ==================== Ejemplos numéricos ====================

   Configuración de ejemplo: regla plan_tolerancia, tolerancia 10 min, redondeo 0.

   1) Turno 09:00–17:00 con 30 min de pausa (plan = 7,5 h). Ficha entrada 09:04, salida 17:10,
      pausa 13:00–13:30. Fichadas = (17:10 − 09:04) − 0:30 = 7,6 h.
      |7,6 − 7,5| = 0,1 h = 6 min ≤ 10 min  →  retenidas = 7,5 h (plan). Retraso 4 min (≤ tol): verde.

   2) Mismo turno, ficha entrada 09:22 y salida 17:00 sin pausa. Fichadas = 7,63 h.
      |7,63 − 7,5| = 8 min ≤ 10  →  retenidas = 7,5 h; pero retraso = 22 min > 10  →  ámbar «+22 min»,
      incidencia «retraso 22 min». Con regla 'fichado' las retenidas serían 7,63 h; con 'planificado', 7,5 h.

   3) Turno de cierre 18:00–02:00 (pausa 0, plan = 8 h) el lunes 05/10. Ficha entrada lun 17:58 y salida
      mar 01:35. La salida (01:35 < 06:00, jornada abierta) se agrupa en la jornada del lunes.
      Fichadas = 7,62 h. Con redondeo 15 min: 7,62 h = 457 min → 450 min = 7,5 h.
      |7,5 − 8| = 30 min > 10  →  retenidas = 7,5 h (fichadas). Salida anticipada = 02:00 − 01:35 = 25 min
      > 10  →  ámbar «sale 25 min antes», incidencia «salida anticipada 25 min».

   4) Turno nocturno 23:00–07:00 el lunes. Ficha entrada lun 23:02 y salida mar 07:05 (después del corte
      de las 06:00): como la jornada del lunes sigue abierta y han pasado menos de 16 h, la salida se agrupa
      en el lunes. Fichadas = 8,05 h.

   5) Baja aprobada el martes con turno publicado 09:00–17:00 y sin fichajes: la celda es «ausencia» (plan
      tachado) y «Proponer horas» no genera fila ese día; nunca «no fichó».

   6) Hoy nunca se propone (aunque el turno haya acabado): se propone al día siguiente.
*/
