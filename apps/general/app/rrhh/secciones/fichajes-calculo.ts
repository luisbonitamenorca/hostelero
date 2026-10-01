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

/* ==================== Vista Jornada (retención por fila, como Skello) ==================== */

/** "HH:MM" de minutos (absolutos: 1530 → "01:30", la salida de madrugada). null → "". */
export const hhmmDe = (m: number | null): string =>
  m == null ? "" : `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;

/** Minutos de un "HH:MM" (null si no es una hora válida). */
export function minutosDe(hhmm: string | null | undefined): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h >= 0 && h < 24 && m >= 0 && m < 60 ? h * 60 + m : null;
}

/** Descanso programado del día: suma de la pausa de los turnos (min). */
export const descansoPlanDe = (turnos: TurnoMin[]) => turnos.reduce((s, t) => s + (t.pausa_min || 0), 0);

/** Entrada y salida programadas (min absolutos de la jornada; la salida puede pasar de 1440). */
export function tramoPlanDe(turnos: TurnoMin[]): { entrada: number | null; salida: number | null } {
  if (!turnos.length) return { entrada: null, salida: null };
  return { entrada: Math.min(...turnos.map((t) => minutos(t.hora_inicio))), salida: Math.max(...turnos.map((t) => finAbsoluto(t))) };
}

/**
 * Horas de una franja retenida: salida − entrada − descanso. Una salida anterior a la entrada es del día
 * siguiente (cierre de madrugada). Devuelve null si falta entrada o salida; nunca negativo.
 */
export function horasFranja(entrada: number | null, salida: number | null, descansoMin: number, redondeoMin = 0): number | null {
  if (entrada == null || salida == null) return null;
  let dur = salida - entrada;
  if (dur < 0) dur += 1440;
  return redondearHoras(Math.max(0, dur - Math.max(0, descansoMin || 0)) / 60, redondeoMin);
}

export type Retencion = {
  /** "HH:MM" o "" si no hay nada que retener (sin fichar). */
  entrada: string;
  salida: string;
  descansoMin: number;
  /** De dónde sale la propuesta, para explicarlo en la fila. */
  origen: "fichado" | "planificado" | "sin_fichar" | "nada";
};

/**
 * Propuesta de franja retenida de un empleado y día según la regla del centro (lo que Skello pre-rellena
 * en «Turno retribuido»):
 *  - 'fichado': entrada/salida fichadas; si no fichó pausa se descuenta la pausa PROGRAMADA del turno.
 *    Sin fichajes y con turno → vacío y 0 h (fila «sin fichar»), para rellenar a mano.
 *  - 'planificado': las horas del turno; sin turno → vacío (0 h), como la regla de siempre.
 *  - 'plan_tolerancia': el turno si lo fichado se desvía ≤ tolerancia; si no, lo fichado.
 */
export function retencionJornada(args: { fecha: string; turnos: TurnoMin[]; efectivos: FichajeMin[]; cfg: ConfigCalculo; esHoy: boolean }): Retencion {
  const { fecha, turnos, efectivos, cfg, esHoy } = args;
  const nada: Retencion = { entrada: "", salida: "", descansoMin: 0, origen: "nada" };
  if (!turnos.length && !efectivos.length) return nada;
  const plan = tramoPlanDe(turnos);
  const descPlan = descansoPlanDe(turnos);
  const desdePlan = (): Retencion => ({ entrada: hhmmDe(plan.entrada), salida: hhmmDe(plan.salida), descansoMin: descPlan, origen: "planificado" });
  const fich = resumenJornada(fecha, efectivos);
  const dia = calcularDiaMin(efectivos, esHoy);
  // Sin pausa fichada se descuenta la programada (Skello retiene «Descanso 15 mn» aunque no la fichen).
  const desdeFichado = (): Retencion => ({
    entrada: hhmmDe(fich.entrada), salida: hhmmDe(fich.salida), descansoMin: fich.nPausas ? fich.pausasMin : descPlan, origen: "fichado",
  });
  const sinFichar: Retencion = { entrada: "", salida: "", descansoMin: 0, origen: "sin_fichar" };

  switch (cfg.regla_horas as ReglaHoras) {
    case "planificado":
      return turnos.length ? desdePlan() : nada;
    case "fichado":
      return efectivos.length ? desdeFichado() : sinFichar;
    case "plan_tolerancia":
    default: {
      if (!efectivos.length) return turnos.length ? sinFichar : nada;
      if (!turnos.length) return desdeFichado();
      const horasFich = redondearHoras(dia.horas, cfg.redondeo_min);
      const tol = (cfg.tolerancia_min || 0) / 60;
      return Math.abs(horasFich - horasPlanDe(turnos)) <= tol + 1e-9 && !dia.inc.length && !dia.enCurso ? desdePlan() : desdeFichado();
    }
  }
}

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

/* ==================== Franja retenida guardada ==================== */

/** Datos extra de la franja retenida. Van en columnas propias si existen (migración pendiente); si no, se guardan al final de la nota. */
export type FranjaRetenida = { entrada_ret: string | null; salida_ret: string | null; descanso_ret_min: number; ausente: boolean };

/** Marca de la franja retenida dentro de la nota mientras no existan las columnas propias: «[ret 09:02-17:10 desc 30]». */
const MARCA_FRANJA = /\s*\[ret (\d{2}:\d{2}|--)-(\d{2}:\d{2}|--) desc (\d+)( aus)?\]\s*$/;

/** Separa la nota escrita a mano de la franja retenida que se guardó con ella (en nota o en columnas). */
export function leerFranja(hd: { nota: string | null } & Partial<FranjaRetenida>): { nota: string; franja: FranjaRetenida | null } {
  // Columnas propias (tras la migración): mandan si tienen algo. Si no, se mira la marca de la nota (filas anteriores).
  if (hd.entrada_ret != null || hd.salida_ret != null || hd.ausente) {
    const nota = (hd.nota ?? "").replace(MARCA_FRANJA, "").trim();
    return { nota, franja: { entrada_ret: hd.entrada_ret ?? null, salida_ret: hd.salida_ret ?? null, descanso_ret_min: Number(hd.descanso_ret_min) || 0, ausente: !!hd.ausente } };
  }
  const nota = hd.nota ?? "";
  const m = nota.match(MARCA_FRANJA);
  if (!m) return { nota, franja: null };
  return {
    nota: nota.replace(MARCA_FRANJA, "").trim(),
    franja: { entrada_ret: m[1] === "--" ? null : m[1], salida_ret: m[2] === "--" ? null : m[2], descanso_ret_min: Number(m[3]), ausente: !!m[4] },
  };
}

export const franjaANota = (nota: string | null, f: FranjaRetenida) =>
  `${(nota ?? "").replace(MARCA_FRANJA, "").trim()} [ret ${f.entrada_ret ?? "--"}-${f.salida_ret ?? "--"} desc ${f.descanso_ret_min}${f.ausente ? " aus" : ""}]`.trim();
