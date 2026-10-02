import { NextResponse } from "next/server";
import type { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/publico";

/**
 * Utilidades compartidas por los handlers públicos de Reservas (sin sesión, con service key).
 * - Límite de peticiones por IP (en memoria por instancia: suficiente para frenar scripts tontos
 *   en Vercel; el rate limit «de verdad» lo pone el WAF si hace falta).
 * - Validadores a mano (no hay zod en el proyecto y no se añade una dependencia por esto).
 * - Generador de .ics para «añadir al calendario».
 */

type Cubo = { n: number; hasta: number };
const cubos: Map<string, Cubo> = ((globalThis as unknown as { __rsvCubos?: Map<string, Cubo> }).__rsvCubos ??= new Map());

/** IP del cliente según las cabeceras del proxy (Vercel pone x-forwarded-for). */
export function ipDe(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const primera = xff.split(",")[0]?.trim();
  return primera || req.headers.get("x-real-ip") || "desconocida";
}

/**
 * Devuelve una respuesta 429 si la IP ha superado `max` peticiones a `clave` en la ventana;
 * null si puede seguir. Ventana deslizante sencilla (cubo por IP+clave).
 */
export function limitar(req: Request, clave: string, max: number, ventanaMs = 60_000): NextResponse | null {
  const ahora = Date.now();
  const k = `${clave}:${ipDe(req)}`;
  const c = cubos.get(k);
  if (!c || c.hasta <= ahora) {
    cubos.set(k, { n: 1, hasta: ahora + ventanaMs });
  } else {
    c.n += 1;
    if (c.n > max) {
      return NextResponse.json({ error: "DEMASIADAS_PETICIONES" }, { status: 429, headers: { "Retry-After": String(Math.ceil((c.hasta - ahora) / 1000)) } });
    }
  }
  // Limpieza perezosa para que el mapa no crezca sin fin.
  if (cubos.size > 5000) {
    for (const [kk, v] of cubos) if (v.hasta <= ahora) cubos.delete(kk);
  }
  return null;
}

/* ───────────── validación ───────────── */

/** Fecha ISO que existe de verdad (V8 da por buena «2026-02-31»; Postgres no, y saldría un 500). */
export const esFecha = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T12:00:00Z");
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s;
};
export const esHora = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);
export const esUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const esToken = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{32}$/.test(s);
export const esSlug = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9][a-z0-9-]{0,60}$/.test(s);
export const esEmail = (s: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(s);

/** Texto recortado y acotado; "" si no viene. */
export function texto(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\u0000/g, "").trim().slice(0, max);
}

export function entero(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/** Teléfono: dígitos y «+» inicial; mínimo 9 dígitos. Devuelve null si no vale. */
export function telefono(v: unknown): string | null {
  const s = texto(v, 32).replace(/[\s().-]/g, "");
  if (!/^\+?\d{9,15}$/.test(s)) return null;
  return s;
}

export const horaSql = (h: string) => (h.length === 5 ? h + ":00" : h);

/**
 * Idioma del cliente: los cinco del widget (es/en/ca/fr/de); lo demás, español. Se guarda tal cual
 * en la reserva; la plantilla del mensaje la elige el RPC (hoy solo hay es/en).
 */
export type IdiomaPublico = "es" | "en" | "ca" | "fr" | "de";
export function idioma(v: unknown): IdiomaPublico {
  return v === "en" || v === "ca" || v === "fr" || v === "de" ? v : "es";
}

type SB = NonNullable<ReturnType<typeof crearClienteServicio>>;

/**
 * Comprueba que el slug es de un restaurante activo de la cuenta pública. Los RPC públicos buscan
 * solo por slug; si el slug no fuera único entre cuentas, el widget podría escribir en otra.
 * Devuelve el id o null (→ LOCAL_NO_DISPONIBLE).
 */
export async function localPublico(sb: SB, slug: string): Promise<string | null> {
  const { data } = await sb.from("reservas_restaurantes").select("id").eq("cuenta_id", CUENTA_PUBLICA).eq("slug", slug).eq("activo", true).maybeSingle();
  return data?.id ?? null;
}

/** Lee el cuerpo JSON como objeto plano; null si no lo es. */
export async function cuerpo(req: Request): Promise<Record<string, unknown> | null> {
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  return b as Record<string, unknown>;
}

/* ───────────── .ics ───────────── */

function icsEscapar(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/**
 * Evento de calendario para una reserva. Hora local del restaurante con TZID (incluimos el
 * VTIMEZONE de Europe/Madrid para que Outlook/Android no lo pinten en UTC).
 */
export function generarIcs(ev: {
  uid: string;
  titulo: string;
  fechaIso: string; // YYYY-MM-DD
  hora: string; // HH:MM
  duracionMin: number;
  lugar?: string | null;
  descripcion?: string | null;
  url?: string | null;
  tz?: string;
}): string {
  const tz = ev.tz || "Europe/Madrid";
  const [aa, mm, dd] = ev.fechaIso.split("-").map(Number);
  const [hh, mi] = ev.hora.split(":").map(Number);
  const ini = new Date(Date.UTC(aa, mm - 1, dd, hh, mi, 0));
  const fin = new Date(ini.getTime() + Math.max(30, ev.duracionMin || 120) * 60_000);
  const f = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}00`;
  const ahora = new Date();
  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hostelero//Reservas//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    `TZID:${tz}`,
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${ev.uid}@hostelero`,
    `DTSTAMP:${f(ahora)}Z`,
    `DTSTART;TZID=${tz}:${f(ini)}`,
    `DTEND;TZID=${tz}:${f(fin)}`,
    `SUMMARY:${icsEscapar(ev.titulo)}`,
  ];
  if (ev.lugar) lineas.push(`LOCATION:${icsEscapar(ev.lugar)}`);
  if (ev.descripcion) lineas.push(`DESCRIPTION:${icsEscapar(ev.descripcion)}`);
  if (ev.url) lineas.push(`URL:${ev.url}`);
  lineas.push("BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", `DESCRIPTION:${icsEscapar(ev.titulo)}`, "END:VALARM", "END:VEVENT", "END:VCALENDAR");
  // Plegado a 75 octetos según RFC 5545.
  return lineas
    .map((l) => {
      const partes: string[] = [];
      let resto = l;
      while (resto.length > 73) {
        partes.push(resto.slice(0, 73));
        resto = " " + resto.slice(73);
      }
      partes.push(resto);
      return partes.join("\r\n");
    })
    .join("\r\n") + "\r\n";
}
