// Tipos y utilidades puras del panel RRHH, usables en servidor y cliente.
import type { Tables } from "@hostelero/db";

export type Empleado = Tables<"empleados"> & { _activo?: boolean; _horasSemana?: number; horas_vigentes?: number | null };
export type Periodo = Tables<"rrhh_periodos_contrato">;
export type Turno = Tables<"rrhh_turnos">;
export type Fichaje = Tables<"rrhh_fichajes">;
export type Ausencia = Tables<"rrhh_ausencias"> & { empleados?: { nombre: string; apellidos: string | null } | null };
export type Dispositivo = Tables<"rrhh_dispositivos"> & { centros?: { nombre: string } | null };
export type Convenio = Tables<"rrhh_convenios">;
export type CentroConfig = Tables<"rrhh_centros_config">;
export type TipoAusencia = Tables<"rrhh_tipos_ausencia">;
export type TipoContrato = Tables<"rrhh_tipos_contrato">;
export type Departamento = Tables<"departamentos">;

export type CentroMin = { id: string; nombre: string };

export const DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const NT: Record<string, string> = { entrada: "Entrada", salida: "Salida", pausa_inicio: "Pausa ▶", pausa_fin: "Pausa ■" };
export const MET: Record<string, string> = { tablet_pin: "tablet", movil_geo: "móvil", correccion: "corrección" };
export const TIPOS_AUSENCIA_ENUM = ["vacaciones", "baja", "permiso", "otro"] as const;

export const hoyIso = () => new Date().toLocaleDateString("sv-SE");
export const sumaDia = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
};
export const lunesDe = (iso: string) => {
  const d = new Date(iso + "T12:00");
  const dia = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dia);
  return d.toLocaleDateString("sv-SE");
};
export const horaDe = (ts: string) => new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
export const fmtDia = (iso: string) => new Date(iso + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
export const fmtCorta = (iso: string) => new Date(iso + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" });
export const iniciales = (n: string) => n.split(/\s+/).map((p) => p[0] || "").join("").slice(0, 2).toUpperCase();
export const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
export const dowDe = (iso: string) => (new Date(iso + "T12:00").getDay() + 6) % 7;

export function horasNetas(t: { hora_inicio: string; hora_fin: string; pausa_min: number | null }) {
  let dur = minutos(t.hora_fin) - minutos(t.hora_inicio);
  if (dur <= 0) dur += 1440;
  return Math.max(0, dur - (t.pausa_min || 0)) / 60;
}
export function finAbsoluto(t: { hora_inicio: string; hora_fin: string }) {
  let fin = minutos(t.hora_fin);
  if (fin <= minutos(t.hora_inicio)) fin += 1440;
  return fin;
}
export const hh = (t: { hora_inicio: string; hora_fin: string }) => t.hora_inicio.slice(0, 5) + "–" + t.hora_fin.slice(0, 5);

/** Fichajes efectivos (descartando los anulados por corrección). */
export function efectivosDe(fs: Fichaje[]) {
  const anulados = new Set(fs.map((f) => f.corrige_a).filter(Boolean) as string[]);
  return { efectivos: fs.filter((f) => !anulados.has(f.id)), anulados };
}

/** Horas netas de un día a partir de pares entrada/salida menos pausas, con incidencias. */
export function calcularDia(efs: Fichaje[], esHoy: boolean) {
  let neto = 0;
  let ab: number | null = null;
  let pa: number | null = null;
  const inc: string[] = [];
  let enCurso = false;
  for (const f of efs) {
    const t = new Date(f.ts).getTime();
    if (f.tipo === "entrada") {
      if (ab !== null) inc.push("dos entradas seguidas");
      ab = t;
      pa = null;
    } else if (f.tipo === "salida") {
      if (ab === null) { inc.push("salida sin entrada"); continue; }
      if (pa !== null) { inc.push("pausa sin cerrar"); pa = null; }
      neto += t - ab;
      ab = null;
    } else if (f.tipo === "pausa_inicio") {
      if (ab === null) inc.push("pausa fuera de jornada");
      else if (pa !== null) inc.push("dos inicios de pausa");
      else pa = t;
    } else if (f.tipo === "pausa_fin") {
      if (pa === null) inc.push("fin de pausa sin inicio");
      else { neto -= t - pa; pa = null; }
    }
  }
  if (ab !== null) {
    if (esHoy) enCurso = true;
    else inc.push("entrada sin salida");
  }
  return { horas: neto / 3600000, inc: [...new Set(inc)], enCurso };
}
