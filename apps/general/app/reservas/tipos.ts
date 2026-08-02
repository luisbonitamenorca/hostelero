// Tipos y utilidades puras del panel de Reservas, usables en servidor y cliente.
import type { Tables } from "@hostelero/db";

export type Restaurante = Tables<"reservas_restaurantes">;
export type Sala = Tables<"reservas_salas"> & { mesas: Mesa[] };
export type Mesa = Tables<"reservas_mesas"> & { sala_nombre?: string };
export type Turno = Tables<"reservas_turnos">;
export type Cierre = Tables<"reservas_cierres"> & { reservas_turnos?: { nombre: string } | null };
export type Cliente = Tables<"reservas_clientes">;
export type Espera = Tables<"reservas_lista_espera">;
export type Reserva = Tables<"reservas_reservas"> & {
  reservas_clientes: Cliente | null;
  reservas_reserva_mesas: { mesa_id: string }[];
};
export type EmailSaliente = Tables<"reservas_emails_salientes">;

export const EST: Record<string, { txt: string; color: string }> = {
  pendiente: { txt: "Pendiente", color: "var(--e-pendiente)" },
  confirmada: { txt: "Confirmada", color: "var(--e-confirmada)" },
  sentada: { txt: "En mesa", color: "var(--e-sentada)" },
  terminada: { txt: "Terminada", color: "var(--e-terminada)" },
  no_show: { txt: "No-show", color: "var(--e-noshow)" },
  cancelada: { txt: "Cancelada", color: "var(--e-cancelada)" },
};
export const ORIGEN: Record<string, string> = {
  online: "Online",
  telefono: "Teléfono",
  walkin: "Walk-in",
  panel: "Panel",
};
export const DIAS = ["L", "M", "X", "J", "V", "S", "D"];
export const NOMBRES_DIA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const fmtF = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
export const fmtFC = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};
export const h5 = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");
export const telWA = (t: string | null | undefined) => {
  let n = (t || "").replace(/\D/g, "");
  if (n.length === 9) n = "34" + n;
  return n;
};
export const minutos = (h: string) => {
  const [a, b] = h.split(":").map(Number);
  return a * 60 + b;
};
export const solapan = (h1: string, d1: number, h2: string, d2: number) => {
  const a = minutos(h5(h1));
  const b = minutos(h5(h2));
  return a < b + d2 && b < a + d1;
};
export const dowDe = (fecha: string) => ((new Date(fecha + "T12:00:00").getDay() + 6) % 7) + 1;

export function turnoDe(turnos: Turno[], fecha: string, hora: string) {
  const dow = dowDe(fecha);
  return turnos.find(
    (t) =>
      t.activo &&
      (t.dias_semana || []).includes(dow) &&
      h5(hora) >= h5(t.hora_inicio) &&
      h5(hora) <= h5(t.hora_fin),
  );
}
export const enTurno = (r: { hora: string }, t: Turno) =>
  h5(r.hora) >= h5(t.hora_inicio) && h5(r.hora) <= h5(t.hora_fin);

export function mesasDe(r: Reserva) {
  const ids = (r.reservas_reserva_mesas || []).map((x) => x.mesa_id);
  if (r.mesa_id && !ids.includes(r.mesa_id)) ids.push(r.mesa_id);
  return ids;
}
