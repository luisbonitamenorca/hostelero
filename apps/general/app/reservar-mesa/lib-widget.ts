/**
 * Tipos y utilidades compartidas por el widget (/reservar-mesa), la gestión por token
 * (/reserva/[token]) y la valoración (/valorar/[token]). Solo cliente, sin dependencias.
 */
import type { CSSProperties } from "react";
import { esLang, type Lang } from "./textos";

/* ───────────── tipos de las respuestas públicas ───────────── */

export type Local = {
  slug: string;
  nombre: string;
  ubicacion: string | null;
  direccion: string | null;
  descripcion: string | null;
  telefono: string | null;
  telefono_whatsapp: string | null;
  antelacion_max_dias: number;
  antelacion_min_horas: number;
  online_activo: boolean;
  idiomas: string[];
  color_marca: string | null;
  logo_url: string | null;
  url_condiciones: string | null;
  mensaje_widget: string | null;
  max_pax_online: number;
  grupos_telefono: string | null;
  politica_cancelacion_horas: number;
  tarjeta_desde_pax: number | null;
};

export type HoraV2 = { hora: string; plazas: number; pocas: boolean };
export type TurnoV2 = {
  turno_id: string;
  turno: string;
  horas: HoraV2[];
  cerrado?: boolean;
  nota?: string | null;
  completo?: boolean;
  grupo_grande?: boolean;
  max_pax_online?: number;
  duracion_min?: number;
  tipo?: "garantia" | "prepago" | null;
  importe?: number | null;
  hora_inicio?: string;
  hora_fin?: string;
  intervalo_min?: number;
  horas_solicitud?: string[];
};
export type DispV2 = {
  error?: string;
  cerrado?: boolean;
  turnos?: TurnoV2[];
  zonas?: { id: string; nombre: string }[];
  tipo?: "garantia" | "prepago" | null;
  importe?: number | null;
  mensaje?: string | null;
  grupos_telefono?: string | null;
  max_pax_online?: number;
  politica_cancelacion_horas?: number;
};
export type EstadoDia = "abierto" | "completo" | "cerrado" | "fuera";
export type Calendario = { error?: string; mes: string; hoy: string; tope: string; dias: Record<string, EstadoDia>; notas: Record<string, string> };
export type Experiencia = {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio_pax: number | null;
  requiere_prepago: boolean;
  pax_min: number;
  pax_max: number | null;
  imagen_url: string | null;
  turnos: string[] | null;
};
export type Pregunta = { id: string; texto: string; texto_en: string | null; tipo: "si_no" | "texto" | "desplegable" | "multiple"; opciones: string[] | null; obligatoria: boolean };
export type Ticket = {
  ok?: boolean;
  error?: string;
  localizador: string;
  token: string;
  estado: string;
  tipo: string;
  solicitud: boolean;
  requiere_pago: "garantia" | "prepago" | null;
  importe: number | null;
  restaurante: string;
  fecha: string; // DD/MM/YYYY
  hora: string;
  pax: number;
  duracion_min: number;
  mensaje: string | null;
  direccion: string | null;
  telefono: string | null;
  politica_cancelacion_horas: number;
  ics: string | null;
};
export type Gestion = {
  ok?: boolean;
  error?: string;
  localizador: string;
  token: string;
  estado: string;
  tipo: string;
  estado_pago: string;
  importe: number | null;
  fecha: string;
  fecha_iso: string;
  hora: string;
  duracion_min: number;
  pax: number;
  idioma: string;
  notas_cliente: string | null;
  alergias: string | null;
  zona: string | null;
  experiencia: string | null;
  valoracion: number | null;
  reconfirmada_en: string | null;
  cancelada_en: string | null;
  // Los datos del cliente no viajan a la página pública (ver gestion/route.ts).
  cliente?: null;
  restaurante: {
    slug: string;
    nombre: string;
    direccion: string | null;
    telefono: string | null;
    email: string | null;
    url_condiciones: string | null;
    color_marca: string | null;
    logo_url: string | null;
    mensaje: string | null;
    politica_cancelacion_horas: number;
    url_resena_google: string | null;
  };
  puede_confirmar: boolean;
  puede_cancelar: boolean;
  puede_modificar: boolean;
  puede_pagar: boolean;
  puede_valorar: boolean;
  dentro_politica: boolean;
  cargo_si_cancela: boolean;
  mesas: string | null;
  ics: string | null;
};

/* ───────────── prefijos telefónicos ───────────── */

export const PREFIJOS: { codigo: string; pais: string; nombre: string }[] = [
  { codigo: "34", pais: "ES", nombre: "España" },
  { codigo: "44", pais: "GB", nombre: "United Kingdom" },
  { codigo: "33", pais: "FR", nombre: "France" },
  { codigo: "49", pais: "DE", nombre: "Deutschland" },
  { codigo: "39", pais: "IT", nombre: "Italia" },
  { codigo: "31", pais: "NL", nombre: "Nederland" },
  { codigo: "351", pais: "PT", nombre: "Portugal" },
  { codigo: "32", pais: "BE", nombre: "Belgique" },
  { codigo: "41", pais: "CH", nombre: "Schweiz" },
  { codigo: "43", pais: "AT", nombre: "Österreich" },
  { codigo: "353", pais: "IE", nombre: "Ireland" },
  { codigo: "45", pais: "DK", nombre: "Danmark" },
  { codigo: "46", pais: "SE", nombre: "Sverige" },
  { codigo: "47", pais: "NO", nombre: "Norge" },
  { codigo: "358", pais: "FI", nombre: "Suomi" },
  { codigo: "48", pais: "PL", nombre: "Polska" },
  { codigo: "420", pais: "CZ", nombre: "Česko" },
  { codigo: "30", pais: "GR", nombre: "Ελλάδα" },
  { codigo: "352", pais: "LU", nombre: "Luxembourg" },
  { codigo: "376", pais: "AD", nombre: "Andorra" },
  { codigo: "1", pais: "US", nombre: "USA / Canada" },
  { codigo: "52", pais: "MX", nombre: "México" },
  { codigo: "54", pais: "AR", nombre: "Argentina" },
  { codigo: "55", pais: "BR", nombre: "Brasil" },
  { codigo: "56", pais: "CL", nombre: "Chile" },
  { codigo: "57", pais: "CO", nombre: "Colombia" },
  { codigo: "212", pais: "MA", nombre: "Maroc" },
  { codigo: "971", pais: "AE", nombre: "UAE" },
  { codigo: "972", pais: "IL", nombre: "Israel" },
  { codigo: "61", pais: "AU", nombre: "Australia" },
];

/** Prefijo por defecto: país del navegador si lo hay; si no, el del idioma (en → GB, fr → FR, de → DE; resto ES). */
export function prefijoInicial(lang: Lang): string {
  const porIdioma: Record<Lang, string> = { es: "34", ca: "34", en: "44", fr: "33", de: "49" };
  if (typeof navigator === "undefined") return porIdioma[lang] ?? "34";
  const nav = (navigator.language || "").toLowerCase();
  const pais = nav.split("-")[1]?.toUpperCase();
  const porPais = PREFIJOS.find((p) => p.pais === pais);
  if (porPais) return porPais.codigo;
  return porIdioma[lang] ?? "34";
}

/** Teléfono internacional: «+34600000000» (lo que espera el RPC). */
export function telefonoCompleto(prefijo: string, numero: string): string {
  let n = numero.replace(/\D/g, "");
  // Si el número ya viene en formato internacional («+44 …» o «0044 …»), manda él y no el
  // selector: un turista con el navegador en español no acaba con «+34 44…».
  if (/^\s*(\+|00)/.test(numero)) {
    if (n.startsWith("00")) n = n.slice(2);
    return "+" + n;
  }
  if (n.startsWith(prefijo) && n.length > prefijo.length + 8) return "+" + n;
  return "+" + prefijo + n.replace(/^0+/, "");
}

export function telefonoValido(prefijo: string, numero: string): boolean {
  const digitos = telefonoCompleto(prefijo, numero).replace(/\D/g, "");
  return digitos.length >= 9 && digitos.length <= 15;
}

export const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

/* ───────────── fechas ───────────── */

/** Hoy en hora del restaurante (Menorca): un cliente en otro huso no ve «ayer» ni «mañana». */
export const hoyISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });

/** Suma n días a una fecha ISO (a mediodía para no tropezar con el cambio de hora). */
export function sumarDias(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
}

/** Locale de Intl para cada idioma del widget. */
export function locale(lang: Lang): string {
  return ({ es: "es-ES", en: "en-GB", ca: "ca-ES", fr: "fr-FR", de: "de-DE" } as Record<Lang, string>)[lang] ?? "es-ES";
}

export function fmtFechaLarga(iso: string, lang: Lang): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(iso + "T12:00:00").toLocaleDateString(locale(lang), { weekday: "long", day: "numeric", month: "long" });
}

/** Horas HH:MM entre inicio y fin (incluidos) cada `paso` minutos (mismo cálculo que el handler). */
export function horasEntre(inicio: string, fin: string, paso = 15): string[] {
  if (!/^\d{2}:\d{2}/.test(inicio) || !/^\d{2}:\d{2}/.test(fin)) return [];
  const [hi, mi] = inicio.split(":").map(Number);
  const [hf, mf] = fin.split(":").map(Number);
  const p = Math.max(5, paso || 15);
  const out: string[] = [];
  for (let t = hi * 60 + mi; t <= hf * 60 + mf && out.length < 200; t += p) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return out;
}

/** Hora actual HH:MM en Menorca. */
export const ahoraHHMM = () => new Date().toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false });

/** DD/MM/YYYY → YYYY-MM-DD (lo que devuelve crear-v2 va en formato humano). */
export function isoDesdeDdmm(ddmm: string): string {
  const m = ddmm.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ddmm;
}

export function fmtImporte(n: number | null | undefined, lang: Lang): string {
  if (n === null || n === undefined) return "";
  return new Intl.NumberFormat(locale(lang), { style: "currency", currency: "EUR" }).format(n);
}

/* ───────────── idioma ───────────── */

/** Idioma: el de ?lang= si es uno de los nuestros; si no, el primero del navegador que tengamos. */
export function detectarIdioma(param?: string | null): Lang {
  if (esLang(param)) return param;
  if (typeof navigator !== "undefined") {
    const lista = navigator.languages?.length ? navigator.languages : [navigator.language || ""];
    for (const l of lista) {
      const pre = (l || "").toLowerCase().slice(0, 2);
      if (esLang(pre)) return pre;
    }
  }
  return "es";
}

/* ───────────── enlaces ───────────── */

export function urlWhatsApp(texto: string, telefono?: string | null): string {
  const base = telefono ? `https://wa.me/${telefono.replace(/\D/g, "")}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(texto)}`;
}

export function urlMapa(direccion: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`;
}

/**
 * Mensaje para el cliente a partir del código de error de un handler/RPC. Nunca enseña el
 * código en bruto: lo desconocido cae en el genérico «no hemos podido completar…».
 */
export function mensajeError(errores: Record<string, string>, codigo: string | undefined | null): string {
  if (!codigo) return "";
  return errores[codigo] || errores.consulta || codigo;
}

/** Lectura de JSON con el error de red convertido a {error: "RED"}. */
export async function pedir<T>(url: string, init?: RequestInit): Promise<T & { error?: string }> {
  try {
    const r = await fetch(url, init);
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok && !j.error) return { ...j, error: r.status === 429 ? "DEMASIADAS_PETICIONES" : "consulta" };
    return j;
  } catch {
    return { error: "RED" } as T & { error?: string };
  }
}

export function post<T>(url: string, body: unknown) {
  return pedir<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** Estilo del acento: color de marca del restaurante si lo tiene. */
export function estiloMarca(color?: string | null): CSSProperties | undefined {
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return undefined;
  return { "--acento": color, "--acento-osc": color } as CSSProperties;
}
