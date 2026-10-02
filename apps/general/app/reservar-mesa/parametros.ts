import { esLang, type Lang } from "./textos";
import type { Inicial } from "./ReservarMesaApp";

/** YYYY-MM-DD que existe (descarta «2026-02-31»). */
function fechaReal(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T12:00:00Z");
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s;
}

/** Parámetros de URL que entiende el widget (servidor: se sanean antes de pasarlos al cliente). */
export type ParametrosWidget = { r?: string; lang?: string; p?: string; fecha?: string; hora?: string; pax?: string; espera?: string; exp?: string };

export function leerParametros(sp: ParametrosWidget, slugRuta?: string): { slug: string | null; lang: Lang | null; prescriptor: string | null; inicial: Inicial } {
  const slugCrudo = (slugRuta || sp.r || "").trim().toLowerCase();
  const slug = /^[a-z0-9][a-z0-9-]{0,60}$/.test(slugCrudo) ? slugCrudo : null;
  // Sin ?lang= el cliente mira el idioma del navegador (detectarIdioma); aquí solo validamos.
  const lang: Lang | null = esLang(sp.lang) ? sp.lang : null;
  const presc = (sp.p || "").trim().toLowerCase();
  const prescriptor = /^[a-z0-9][a-z0-9_-]{0,119}$/.test(presc) ? presc : null;
  const inicial: Inicial = {};
  if (sp.fecha && fechaReal(sp.fecha)) inicial.fecha = sp.fecha;
  if (sp.hora && /^\d{2}:\d{2}$/.test(sp.hora)) inicial.hora = sp.hora;
  if (sp.pax && /^\d{1,3}$/.test(sp.pax)) inicial.pax = parseInt(sp.pax, 10);
  if (sp.espera && /^[0-9a-f]{32}$/.test(sp.espera)) inicial.espera = sp.espera;
  if (sp.exp && /^[0-9a-f-]{36}$/.test(sp.exp)) inicial.exp = sp.exp;
  return { slug, lang, prescriptor, inicial };
}
