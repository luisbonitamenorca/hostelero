"use client";

/* Helpers compartidos del panel de Reservas (cimientos v2).
   Solo lectura para las secciones: lo específico de una sección va en su fichero. */

import { useCallback, useEffect, useState } from "react";
import type { Restaurante } from "./tipos";

/* ==================== Tipos comunes ==================== */

export type Ctx = { restaurantes: Restaurante[]; userId: string; esDireccion: boolean };
export type SecProps = {
  ctx: Ctx;
  rest: Restaurante;
  fecha: string;
  setFecha: (f: string) => void;
  avisar: (m: string) => void;
};

/* ==================== Estados (catálogo tipo Cover) ==================== */

export type GrupoEstado = "previa" | "sala" | "fin" | "especial";
export type EstadoDef = { id: string; texto: string; color: string; orden: number; grupo: GrupoEstado; borde?: string };

/** Los 13 estados del plan. `color` es el fondo del chip/mesa; el texto va en blanco salvo
    `tarjeta_pendiente` (blanco con borde). */
export const ESTADOS: EstadoDef[] = [
  { id: "pendiente", texto: "Pendiente", color: "#D99A1E", orden: 10, grupo: "previa" },
  { id: "confirmada", texto: "Confirmada", color: "#2E9E5B", orden: 20, grupo: "previa" },
  { id: "reconfirmada", texto: "Reconfirmada", color: "#1D6B3E", orden: 30, grupo: "previa" },
  { id: "llegada", texto: "Llegada", color: "#D64D8A", orden: 40, grupo: "sala" },
  { id: "sentada", texto: "Sentada", color: "#16A34A", orden: 50, grupo: "sala" },
  { id: "postre", texto: "Postre", color: "#2F80ED", orden: 60, grupo: "sala" },
  { id: "cuenta", texto: "Cuenta", color: "#1F4E9E", orden: 70, grupo: "sala" },
  { id: "terminada", texto: "Liberada", color: "#8A9199", orden: 80, grupo: "fin" },
  { id: "no_show", texto: "No show", color: "#D32F2F", orden: 90, grupo: "fin" },
  { id: "cancelada", texto: "Cancelada", color: "#4B5057", orden: 100, grupo: "fin" },
  { id: "a_revisar", texto: "A revisar", color: "#F26B1D", orden: 110, grupo: "especial" },
  { id: "tarjeta_pendiente", texto: "Tarjeta pendiente", color: "#FFFFFF", borde: "#8A9199", orden: 120, grupo: "especial" },
  { id: "lista_espera", texto: "Lista de espera", color: "#7C3AED", orden: 130, grupo: "especial" },
];

export const ESTADO: Record<string, EstadoDef> = Object.fromEntries(ESTADOS.map((e) => [e.id, e]));

export function estadoDe(id: string): EstadoDef {
  return ESTADO[id] ?? { id, texto: id, color: "#8A9199", orden: 999, grupo: "especial" };
}

/** Estados que ocupan mesa (para plano y conflictos). */
export const ESTADOS_VIVOS = ["pendiente", "confirmada", "reconfirmada", "llegada", "sentada", "postre", "cuenta", "a_revisar", "tarjeta_pendiente"];
/** Estados en los que el cliente está físicamente en la sala. */
export const ESTADOS_EN_SALA = ["llegada", "sentada", "postre", "cuenta"];
/** Estados finales (no cuentan en pax ni en ocupación). */
export const ESTADOS_FINALES = ["terminada", "no_show", "cancelada"];
/** Estados que hoy ocupan mesa en el panel (los 6 del esquema actual). */
export const VIVAS = ["pendiente", "confirmada", "sentada"];

/* ==================== Tipos de reserva ==================== */

export const TIPOS_RESERVA: { id: string; texto: string; descripcion: string }[] = [
  { id: "gratis", texto: "Reserva gratis", descripcion: "Sin tarjeta ni pago." },
  { id: "politica_cancelacion", texto: "Con política de cancelación", descripcion: "Tarjeta como garantía; cargo por no-show o cancelación tardía." },
  { id: "garantia", texto: "Con garantía de retención", descripcion: "Se retiene un importe en la tarjeta." },
  { id: "prepago", texto: "Prepago", descripcion: "Se cobra por adelantado y se descuenta de la cuenta." },
  { id: "experiencia", texto: "Experiencia / menú", descripcion: "Reserva ligada a una experiencia con precio por persona." },
];

/* ==================== Fechas ==================== */

/** "2026-09-30" → "30/09/2026" */
export function fmtFecha(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** "2026-09-30" → "30/09" */
export function fmtDiaMes(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "2026-09-30" → "mié 30/09" */
export function fmtFechaCorta(iso: string): string {
  const dow = new Date(iso.slice(0, 10) + "T12:00").getDay();
  return `${DIAS_CORTOS[dow]} ${fmtDiaMes(iso)}`;
}

/** "2026-09-30" → "miércoles 30 de septiembre" */
export function fmtFechaLarga(iso: string): string {
  return new Date(iso.slice(0, 10) + "T12:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

/** "13:30:00" → "13:30" */
export function fmtHora(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : "";
}

/** Semana ISO 8601 de una fecha (lunes = primer día). */
export function semanaIso(iso: string): { anio: number; semana: number; lunes: string } {
  const d = new Date(iso + "T12:00");
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  const lunes = new Date(d);
  lunes.setDate(d.getDate() - dow);
  const jueves = new Date(lunes);
  jueves.setDate(lunes.getDate() + 3);
  const anio = jueves.getFullYear();
  const primerJueves = new Date(anio, 0, 4);
  const dowPJ = (primerJueves.getDay() + 6) % 7;
  const lunesSemana1 = new Date(primerJueves);
  lunesSemana1.setDate(primerJueves.getDate() - dowPJ);
  const semana = Math.round((lunes.getTime() - lunesSemana1.getTime()) / (7 * 86400000)) + 1;
  return { anio, semana, lunes: lunes.toLocaleDateString("sv-SE") };
}

/** Primer y último día del mes de una fecha. */
export function rangoMes(iso: string): { desde: string; hasta: string } {
  const [a, m] = iso.split("-").map(Number);
  const desde = `${a}-${String(m).padStart(2, "0")}-01`;
  const ultimo = new Date(a, m, 0).getDate();
  const hasta = `${a}-${String(m).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`;
  return { desde, hasta };
}

/** Suma días a una fecha ISO. */
export function sumarDias(iso: string, n: number): string {
  const d = new Date(iso + "T12:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
}

/** Color de texto legible sobre un fondo hex. */
export function colorTexto(hex: string): "#fff" | "#1a1a1a" {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6 && h.length !== 3) return "#1a1a1a";
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#1a1a1a" : "#fff";
}

/* ==================== Preferencias locales ==================== */

const PREFIJO = "rsv:";

export function leerPref<T = string>(clave: string, def: T): T {
  try {
    if (typeof window === "undefined") return def;
    const v = window.localStorage.getItem(PREFIJO + clave);
    if (v == null) return def;
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  } catch {
    return def;
  }
}

export function guardarPref(clave: string, valor: unknown): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
  } catch {
    /* sin localStorage: no pasa nada */
  }
}

/* ==================== Eventos entre secciones ==================== */

/** Pide a PanelReservas que cambie de pestaña: window 'rsv:tab' (detail = id). */
export function irATab(tab: string): void {
  if (typeof window === "undefined") return;
  const atendido = !window.dispatchEvent(new CustomEvent("rsv:tab", { detail: tab, cancelable: true }));
  if (atendido) return;
  guardarPref("tab", tab);
  window.location.reload();
}

/** Avisa a la sección activa de que los datos del día han cambiado (p. ej. tras «Nueva reserva»). */
export function pedirRecarga(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("rsv:recargar"));
}

/** Una sección ha guardado datos del restaurante: PanelReservas actualiza su copia (window 'rsv:restaurante'). */
export function anunciarRestaurante(r: Restaurante): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Restaurante>("rsv:restaurante", { detail: r }));
}

/* ==================== Hooks ==================== */

/** Selector de restaurante que recuerda el último usado ('rsv:restaurante'). */
export function useRestauranteRecordado(restaurantes: Restaurante[]): [string, (id: string) => void] {
  const [restId, setRest] = useState<string>(() => restaurantes[0]?.id ?? "");
  useEffect(() => {
    // Legado: 'rest_actual' sin prefijo. Se respeta la primera vez.
    let guardado = leerPref<string>("restaurante", "");
    if (!guardado) {
      try { guardado = window.localStorage.getItem("rest_actual") ?? ""; } catch { /* nada */ }
    }
    if (guardado && restaurantes.some((r) => r.id === guardado)) setRest(guardado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setRestId = useCallback((id: string) => {
    setRest(id);
    guardarPref("restaurante", id);
    try { window.localStorage.setItem("rest_actual", id); } catch { /* nada */ }
  }, []);
  return [restId, setRestId];
}

export type Tema = "oscuro" | "claro";

/** Tema del panel: oscuro por defecto (como Cover). El valor se pone como data-tema en el
    contenedor .rv; tema.css aplica las variables. */
export function useTema(): [Tema, () => void] {
  const [tema, setTema] = useState<Tema>("oscuro");
  useEffect(() => {
    const t = leerPref<Tema>("tema", "oscuro");
    setTema(t === "claro" ? "claro" : "oscuro");
  }, []);
  const alternar = useCallback(() => {
    setTema((t) => {
      const n: Tema = t === "oscuro" ? "claro" : "oscuro";
      guardarPref("tema", n);
      return n;
    });
  }, []);
  return [tema, alternar];
}

/** Escucha 'rsv:recargar' y ejecuta el callback (la sección decide qué recargar). */
export function useRecargaExterna(fn: () => void): void {
  useEffect(() => {
    const h = () => fn();
    window.addEventListener("rsv:recargar", h);
    return () => window.removeEventListener("rsv:recargar", h);
  }, [fn]);
}
