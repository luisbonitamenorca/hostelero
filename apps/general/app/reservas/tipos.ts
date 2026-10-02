// Tipos y utilidades puras del panel de Reservas, usables en servidor y cliente.
// Las filas salen de los tipos generados (packages/db/types.ts): no se inventan columnas.
import type { Tables } from "@hostelero/db";

/* ==================== Filas base ==================== */

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

/* ==================== Filas v2 ==================== */

/** Decoración del plano (plantas, paredes, barra, textos…). */
export type PlanoObjeto = Tables<"reservas_plano_objetos">;
/** Mesa o sala bloqueada en una franja. */
export type Bloqueo = Tables<"reservas_bloqueos">;
/** Cupo de un día y turno (cerrado, aforo online, aforo total, nota). turno_id null = día completo. */
export type Cupo = Tables<"reservas_cupos">;
/** Nota libre del día (la ve toda la sala). */
export type NotaDia = Tables<"reservas_notas_dia">;
/** Etiqueta de reserva, de cliente o alérgeno (campo `ambito`). */
export type Etiqueta = Tables<"reservas_etiquetas">;
/** Hotel, agencia, empresa o canal que recomienda. */
export type Prescriptor = Tables<"reservas_prescriptores">;
/** Menú o experiencia reservable con precio por persona. */
export type Experiencia = Tables<"reservas_experiencias">;
/** Mensaje enviado o programado (email, SMS, WhatsApp). */
export type Mensaje = Tables<"reservas_mensajes">;
/** Plantilla de mensaje por canal, tipo e idioma. */
export type Plantilla = Tables<"reservas_plantillas">;
/** Garantía, prepago, cargo por no-show o devolución (Redsys). */
export type Pago = Tables<"reservas_pagos">;
/** Quién cambió qué en una reserva. */
export type Historial = Tables<"reservas_reservas_historial">;
export type Camarero = Tables<"reservas_camareros">;
export type MesaCombinacion = Tables<"reservas_mesas_combinaciones">;
export type Pregunta = Tables<"reservas_preguntas">;
export type CodigoPromo = Tables<"reservas_codigos">;
export type Autotag = Tables<"reservas_autotags">;
export type PermisoPerfil = Tables<"reservas_permisos_perfil">;
/** Vista con visitas, no-shows, última visita y riesgo de no-show por cliente. */
export type ClienteStats = Tables<"reservas_clientes_stats">;

/* ==================== Catálogos de texto ==================== */

/** Los 13 estados del catálogo. `color` es la variable CSS (definida en reservas.css y tema.css);
    `txt` es lo que lee la sala. El orden es el del ciclo de vida. */
export const EST: Record<string, { txt: string; color: string }> = {
  pendiente: { txt: "Pendiente", color: "var(--e-pendiente)" },
  confirmada: { txt: "Confirmada", color: "var(--e-confirmada)" },
  reconfirmada: { txt: "Reconfirmada", color: "var(--e-reconfirmada)" },
  llegada: { txt: "Llegada", color: "var(--e-llegada)" },
  sentada: { txt: "Sentada", color: "var(--e-sentada)" },
  postre: { txt: "Postre", color: "var(--e-postre)" },
  cuenta: { txt: "Cuenta", color: "var(--e-cuenta)" },
  terminada: { txt: "Liberada", color: "var(--e-terminada)" },
  no_show: { txt: "No show", color: "var(--e-no_show)" },
  cancelada: { txt: "Cancelada", color: "var(--e-cancelada)" },
  a_revisar: { txt: "A revisar", color: "var(--e-a_revisar)" },
  tarjeta_pendiente: { txt: "Tarjeta pendiente", color: "var(--e-tarjeta_pendiente)" },
  lista_espera: { txt: "Lista de espera", color: "var(--e-lista_espera)" },
};
export const ESTADOS_IDS = Object.keys(EST);

/** Orígenes de la reserva (check constraint de reservas_reservas.origen). */
export const ORIGEN: Record<string, string> = {
  online: "Online",
  telefono: "Teléfono",
  walkin: "Sin reserva",
  panel: "Panel",
  importado: "Importada",
  api: "API",
};

/** Canal de captación (reservas_reservas.canal, texto libre: «google», «INSTAGRAM», «web»…).
    Nombres conocidos con su grafía; el resto, con mayúscula inicial. */
const CANALES: Record<string, string> = {
  google: "Google",
  instagram: "Instagram",
  facebook: "Facebook",
  web: "Web",
  widget: "Web",
  telefono: "Teléfono",
  whatsapp: "WhatsApp",
  email: "Email",
  thefork: "TheFork",
  tripadvisor: "Tripadvisor",
  cover: "Cover",
};
export function textoCanal(canal: string | null | undefined): string {
  const c = (canal || "").trim();
  if (!c) return "";
  return CANALES[c.toLowerCase()] ?? c.charAt(0).toUpperCase() + c.slice(1).toLowerCase();
}

/** Tipo de reserva (reservas_reservas.tipo). */
export const TIPO_RESERVA: Record<string, string> = {
  gratis: "Gratis",
  politica_cancelacion: "Política de cancelación",
  garantia: "Garantía",
  prepago: "Prepago",
  experiencia: "Experiencia",
};

/** Estado del pago (reservas_reservas.estado_pago). */
export const ESTADO_PAGO: Record<string, string> = {
  no_requerido: "Sin pago",
  pendiente_tarjeta: "Tarjeta pendiente",
  garantizada: "Garantizada",
  pagada: "Pagada",
  cobrado_noshow: "Cobrado no-show",
  devuelto: "Devuelto",
  fallido: "Fallido",
};

export const DIAS = ["L", "M", "X", "J", "V", "S", "D"];
export const NOMBRES_DIA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/* ==================== Utilidades puras ==================== */

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
/** Día de la semana 1 (lunes) … 7 (domingo), como reservas_turnos.dias_semana. */
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

/** Nombre y apellidos de un cliente en una sola línea («—» si no hay nada). */
export function nombreCliente(c: Pick<Cliente, "nombre" | "apellidos"> | null | undefined): string {
  if (!c) return "—";
  return [c.nombre, c.apellidos].filter((x) => x && x.trim()).join(" ").trim() || "—";
}
