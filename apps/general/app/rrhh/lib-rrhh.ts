"use client";

/* Helpers compartidos del panel RRHH (cimientos v2).
   Solo lectura para las secciones: lo que sea específico de una sección va en su fichero. */

import { useCallback, useState } from "react";

/* ==================== Tipos comunes ==================== */

export type Ctx = { esGestor: boolean; centros: { id: string; nombre: string }[]; userId: string };
export type SecProps = { ctx: Ctx; avisar: (m: string) => void };

/* ==================== Fechas ==================== */

/** Semana ISO 8601 de una fecha (lunes = primer día). */
export function semanaIso(iso: string): { anio: number; semana: number; lunes: string } {
  const d = new Date(iso + "T12:00");
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  const lunes = new Date(d);
  lunes.setDate(d.getDate() - dow);
  // El jueves de la semana fija el año ISO
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

/* ==================== Formato ==================== */

/** 7.5 → "7,5 h" */
export function fmtHoras(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  // hasta 2 decimales, sin ceros de relleno: 7 → "7 h", 7.5 → "7,5 h", 7.25 → "7,25 h"
  return String(v).replace(".", ",") + " h";
}

/** "2026-09-30" → "30/09/2026" */
export function fmtFecha(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "2026-09-30" → "mié 30/09" */
export function fmtFechaCorta(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  const dow = new Date(iso.slice(0, 10) + "T12:00").getDay();
  return `${DIAS_CORTOS[dow]} ${d}/${m}`;
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

const PREFIJO = "rrhh:";

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

/* ==================== Skello ==================== */

/** Nombre de centro en Hostelero → código de centro en Skello / Ratios (plan 1.6). */
export const CENTRO_SKELLO: Record<string, string> = {
  "Binifadet Restaurante": "BINIFADET",
  "Binifadet Bodega": "BODEGA",
  "Binifadet Tienda": "TIENDA",
  "Casa Tirant": "TIRANT",
  "Cocina Produccion": "PRODUCCION",
  "Estructura": "OFICINA",
  "Tamarindos Bar": "TAMARINDOS_BAR",
  "Tamarindos Restaurante": "TAMARINDOS",
};

/* ==================== Hooks ==================== */

/** Selector de centro que recuerda el último usado en localStorage ('rrhh:centro'). */
export function useCentroRecordado(centros: { id: string; nombre: string }[]): [string, (id: string) => void] {
  const [centroId, setCentro] = useState<string>(() => {
    const guardado = leerPref<string>("centro", "");
    return centros.some((c) => c.id === guardado) ? guardado : (centros[0]?.id ?? "");
  });
  const setCentroId = useCallback((id: string) => {
    setCentro(id);
    guardarPref("centro", id);
  }, []);
  return [centroId, setCentroId];
}
