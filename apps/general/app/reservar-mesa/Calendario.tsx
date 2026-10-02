"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { textos, type Lang } from "./textos";
import { locale, pedir, sumarDias, type Calendario as CalDatos, type EstadoDia } from "./lib-widget";

/**
 * Calendario mensual del widget y de «Modificar» en /reserva/<token>.
 * Estados por día (los calcula /api/publico/reservas/disponibilidad-v2?mes=, con la misma regla
 * de cupos que reservas_cupo_motivo):
 *  - abierto: se puede elegir.
 *  - completo: el aforo de todos sus turnos está lleno para esos comensales. Se puede elegir
 *    igualmente (como en Cover) para llegar a la lista de espera del paso 2.
 *  - cerrado: sin turno, cierre o cupo cerrado → gris y tachado.
 *  - fuera: pasado o más allá de la antelación máxima → desactivado.
 * El mes se cachea por restaurante + comensales (caché de módulo, 2 min), y los comensales se
 * esperan 400 ms antes de pedir: pulsar «+» de 9 a 20 es una sola petición, no once.
 */

const TTL = 2 * 60_000;
const cacheMeses = new Map<string, { hasta: number; datos: CalDatos }>();
const enVuelo = new Map<string, Promise<CalDatos | null>>();

const claveMes = (slug: string, pax: number | null | undefined, mes: string) => `${slug}:${pax ?? ""}:${mes}`;

function leerCache(clave: string): CalDatos | null {
  const c = cacheMeses.get(clave);
  return c && c.hasta > Date.now() ? c.datos : null;
}

/**
 * Datos de un mes (de la caché si están; si no, una sola petición aunque la pidan varios a la
 * vez). null si falla (red, 429…). Lo usa también el widget para sugerir días cercanos con hueco.
 */
export function mesCalendario(slug: string, pax: number | null | undefined, mes: string): Promise<CalDatos | null> {
  const clave = claveMes(slug, pax, mes);
  const c = leerCache(clave);
  if (c) return Promise.resolve(c);
  const vuelo = enVuelo.get(clave);
  if (vuelo) return vuelo;
  const q = new URLSearchParams({ slug, mes });
  if (pax) q.set("pax", String(pax));
  const p = pedir<CalDatos>(`/api/publico/reservas/disponibilidad-v2?${q}`)
    .then((j) => {
      if (j.error || !j.dias) return null;
      cacheMeses.set(clave, { hasta: Date.now() + TTL, datos: j });
      return j as CalDatos;
    })
    .finally(() => enVuelo.delete(clave));
  enVuelo.set(clave, p);
  return p;
}

/** Próximos días «abierto» a partir de `desde` (excluido), mirando este mes y el siguiente. */
export async function diasAbiertosCerca(slug: string, pax: number, desde: string, n = 4, rango = 21): Promise<string[]> {
  const hasta = sumarDias(desde, rango);
  const meses = [...new Set([desde.slice(0, 7), hasta.slice(0, 7)])];
  const datos = await Promise.all(meses.map((m) => mesCalendario(slug, pax, m)));
  const out: string[] = [];
  for (let d = sumarDias(desde, 1); d <= hasta && out.length < n; d = sumarDias(d, 1)) {
    const cal = datos.find((x) => x?.mes === d.slice(0, 7));
    if (cal?.dias[d] === "abierto") out.push(d);
  }
  return out;
}

export function Calendario({
  slug,
  valor,
  onChange,
  onEstadoValor,
  lang,
  min,
  max,
  pax,
  leyenda = true,
}: {
  slug: string;
  valor: string;
  onChange: (iso: string, estado: EstadoDia) => void;
  /** Estado del día elegido cada vez que llegan datos (p. ej. al cambiar de comensales). */
  onEstadoValor?: (estado: EstadoDia) => void;
  lang: Lang;
  min: string;
  max: string;
  pax?: number | null;
  leyenda?: boolean;
}) {
  const t = textos(lang);
  const [mes, setMes] = useState(() => (valor || min).slice(0, 7));
  const [paxDeb, setPaxDeb] = useState(pax ?? null);
  const [intento, setIntento] = useState(0);
  const clave = claveMes(slug, paxDeb, mes);
  const [datos, setDatos] = useState<CalDatos | null>(() => leerCache(clave));
  const [fallo, setFallo] = useState(false);
  const onEstadoRef = useRef(onEstadoValor);
  onEstadoRef.current = onEstadoValor;

  useEffect(() => {
    // Al cambiar de restaurante volvemos al mes del día elegido (o al primero).
    setMes((valor || min).slice(0, 7));
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Comensales con espera: el «+» repetido no dispara una petición por pulsación.
  useEffect(() => {
    const p = pax ?? null;
    if (p === paxDeb) return;
    const id = setTimeout(() => setPaxDeb(p), 400);
    return () => clearTimeout(id);
  }, [pax, paxDeb]);

  useEffect(() => {
    let vivo = true;
    const c = leerCache(clave);
    setFallo(false);
    setDatos(c);
    if (!c) {
      mesCalendario(slug, paxDeb, mes).then((j) => {
        if (!vivo) return;
        if (j) setDatos(j);
        else setFallo(true);
      });
    }
    return () => {
      vivo = false;
    };
  }, [clave, intento]); // eslint-disable-line react-hooks/exhaustive-deps

  // Avisamos al padre del estado del día elegido cuando llegan datos nuevos.
  useEffect(() => {
    if (!datos || !valor) return;
    const e = datos.dias[valor];
    if (e) onEstadoRef.current?.(e);
  }, [datos, valor]);

  const loc = locale(lang);
  const [aa, mm] = mes.split("-").map(Number);
  const celdas = useMemo(() => {
    const primero = new Date(aa, mm - 1, 1);
    const huecos = (primero.getDay() + 6) % 7; // lunes = 0
    const dias = new Date(aa, mm, 0).getDate();
    const out: (string | null)[] = Array.from({ length: huecos }, () => null);
    for (let d = 1; d <= dias; d++) out.push(`${mes}-${String(d).padStart(2, "0")}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [aa, mm, mes]);

  const semana = useMemo(() => {
    const base = new Date(2024, 0, 1); // lunes
    return Array.from({ length: 7 }, (_, i) => new Date(base.getTime() + i * 86_400_000).toLocaleDateString(loc, { weekday: "short" }).replace(".", ""));
  }, [loc]);

  // El tope real lo da el servidor (antelación máxima del restaurante); `max` es el de reserva.
  const tope = datos?.tope && datos.tope < max ? datos.tope : max;
  const mesMin = min.slice(0, 7);
  const mesMax = tope.slice(0, 7);
  const mover = (n: number) => {
    const d = new Date(aa, mm - 1 + n, 1);
    const nuevo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (nuevo < mesMin || nuevo > mesMax) return;
    setMes(nuevo);
  };

  const titulo: Record<EstadoDia, string | undefined> = {
    abierto: undefined,
    completo: t.calCompletoTitulo,
    cerrado: t.calCerrado,
    fuera: undefined,
  };

  return (
    <div className="cal" role="group" aria-label={t.calendario}>
      <div className="cal-cab">
        <button type="button" onClick={() => mover(-1)} disabled={mes <= mesMin} aria-label={t.mesAnterior}>‹</button>
        <strong>{new Date(aa, mm - 1, 1).toLocaleDateString(loc, { month: "long", year: "numeric" })}</strong>
        <button type="button" onClick={() => mover(1)} disabled={mes >= mesMax} aria-label={t.mesSiguiente}>›</button>
      </div>
      <div className="cal-sem" aria-hidden="true">
        {semana.map((s, i) => (
          <span key={i}>{s}</span>
        ))}
      </div>
      <div className="cal-dias">
        {celdas.map((iso, i) => {
          if (!iso) return <span key={`h${i}`} className="cal-hueco" />;
          const estado: EstadoDia = datos?.dias[iso] ?? (iso < min || iso > tope ? "fuera" : "abierto");
          const cargando = !datos && !fallo && estado === "abierto";
          const des = estado === "cerrado" || estado === "fuera";
          const sel = iso === valor;
          const nota = datos?.notas[iso];
          const fechaLarga = new Date(iso + "T12:00:00").toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long" });
          return (
            <button
              key={iso}
              type="button"
              className={`cal-dia ${sel ? "sel" : ""} ${estado} ${cargando ? "cargando" : ""} ${iso === (datos?.hoy ?? min) ? "hoy" : ""}`}
              disabled={des}
              title={[titulo[estado], nota].filter(Boolean).join(" · ") || undefined}
              aria-label={[fechaLarga, titulo[estado]].filter(Boolean).join(", ")}
              aria-pressed={sel}
              onClick={() => onChange(iso, estado)}
            >
              {Number(iso.slice(8))}
            </button>
          );
        })}
      </div>
      {fallo ? (
        <div className="cal-error" role="alert">
          <span>{t.calError}</span>
          <button type="button" className="enlace" onClick={() => setIntento((n) => n + 1)}>{t.reintentar}</button>
        </div>
      ) : null}
      {leyenda ? (
        <div className="cal-leyenda" aria-hidden="true">
          <span><i className="l-abierto" />{t.calDisponible}</span>
          <span><i className="l-completo" />{t.calCompleto}</span>
          <span><i className="l-cerrado" />{t.calCerrado}</span>
        </div>
      ) : null}
    </div>
  );
}
