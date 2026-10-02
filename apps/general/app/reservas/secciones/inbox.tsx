"use client";

/* Inbox del panel de Reservas (guía §7): lista cronológica de novedades de los últimos días.
   Reservas online nuevas (pendientes primero, con Confirmar / Asignar mesa / Rechazar), solicitudes
   de grupo, tarjetas sin introducir, pagos fallidos, cancelaciones, modificaciones del cliente,
   mensajes con error (Reintentar), valoraciones (Responder), reservas «a revisar» y lista de espera.
   El «leído» es por navegador (localStorage), no en base. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../acciones/inbox";
import type { Novedad, ReservaInbox, TipoNovedad } from "../acciones/inbox";
import { estadoDe, fmtFechaCorta, fmtHora, guardarPref, irATab, leerPref, pedirRecarga, useRecargaExterna, type SecProps } from "../lib-reservas";
import { hoyISO, telWA } from "../tipos";
import "./inbox.css";

/* ==================== Leídos (localStorage) y contador ==================== */

const CLAVE_LEIDOS = "inbox-leidos";
const CADUCIDAD_MS = 30 * 86400000;

/** Mapa id de novedad → instante en que se marcó leída (ms). Se purgan las de más de 30 días. */
export function leerLeidos(): Record<string, number> {
  const v = leerPref<Record<string, number>>(CLAVE_LEIDOS, {});
  const limite = Date.now() - CADUCIDAD_MS;
  const out: Record<string, number> = {};
  for (const [k, t] of Object.entries(v || {})) if (typeof t === "number" && t > limite) out[k] = t;
  return out;
}

export function marcarLeidos(ids: string[]): Record<string, number> {
  const v = leerLeidos();
  const ahora = Date.now();
  ids.forEach((id) => (v[id] = ahora));
  guardarPref(CLAVE_LEIDOS, v);
  return v;
}

export function contarNoLeidos(novedades: Novedad[], leidos: Record<string, number>): number {
  return novedades.filter((n) => !leidos[n.id]).length;
}

/** Publica el número de no leídos: window "rsv:inbox-contador" (detail = número). La barra lo pinta. */
export function emitirContador(n: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<number>("rsv:inbox-contador", { detail: n }));
}

const DIAS_DEFECTO = 7;
const desdeISO = (dias: number) => new Date(Date.now() - dias * 86400000).toISOString();

/* Alcance del Inbox (prefs compartidas por la sección y el contador de la pestaña, para que los
   dos cuenten exactamente el mismo conjunto y el número no oscile). */
const PREF_TODOS = "inbox:todos";
const PREF_DIAS = "inbox:dias";
const leerTodos = () => leerPref<boolean>(PREF_TODOS, false) === true;
const leerDias = () => Number(leerPref<number>(PREF_DIAS, DIAS_DEFECTO)) || DIAS_DEFECTO;
/** La sección ha cambiado de alcance: el contador vuelve a contar ya (sin esperar a su ciclo). */
const EV_ALCANCE = "rsv:inbox-alcance";

/** ¿Sigue requiriendo acción? Las valoraciones bajas dejan de estarlo en cuanto se leen. */
function requiereAccion(n: Novedad, leidos: Record<string, number>): boolean {
  return n.pendiente && !(n.tipo === "valoracion" && leidos[n.id]);
}

/** Para montar en PanelReservas (fuera de la sección): consulta las novedades cada `cadaMs` y emite
    el contador de no leídos aunque el Inbox no esté abierto. restauranteId null = todos. Respeta
    el alcance que la sala eligió en el Inbox («Todos los restaurantes» y periodo). */
export function useInboxContador(restauranteId: string | null, cadaMs = 120000): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let vivo = true;
    const tick = async () => {
      const rid = leerTodos() ? null : restauranteId;
      const r = await api.novedades(rid, desdeISO(leerDias()));
      if (!vivo || !r.ok || !r.data) return;
      const c = contarNoLeidos(r.data, leerLeidos());
      setN(c);
      emitirContador(c);
    };
    tick();
    const t = setInterval(tick, cadaMs);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(EV_ALCANCE, tick);
    return () => {
      vivo = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(EV_ALCANCE, tick);
    };
  }, [restauranteId, cadaMs]);
  return n;
}

/* ==================== Catálogo de tipos ==================== */

type Filtro = "todas" | "pendientes" | TipoNovedad;

const TIPOS: { id: TipoNovedad; texto: string; icono: string; color: string }[] = [
  { id: "nueva", texto: "Online", icono: "🔔", color: "#2E9E5B" },
  { id: "grupo", texto: "Grupos", icono: "👥", color: "#FA5252" },
  { id: "tarjeta", texto: "Tarjeta", icono: "💳", color: "#E8590C" },
  { id: "pago", texto: "Pagos", icono: "€", color: "#C2255C" },
  { id: "cancelacion", texto: "Cancelaciones", icono: "✕", color: "#6b7178" },
  { id: "modificacion", texto: "Modificaciones", icono: "✎", color: "#2F80ED" },
  { id: "mensaje_error", texto: "Mensajes", icono: "⚠", color: "#E5484D" },
  { id: "valoracion", texto: "Valoraciones", icono: "★", color: "#D99A1E" },
  { id: "a_revisar", texto: "A revisar", icono: "⏰", color: "#F26B1D" },
  { id: "espera", texto: "L. espera", icono: "⏳", color: "#7C3AED" },
];
const TIPO = Object.fromEntries(TIPOS.map((t) => [t.id, t])) as Record<TipoNovedad, (typeof TIPOS)[number]>;

const PERIODOS = [
  { dias: 1, texto: "Hoy" },
  { dias: 3, texto: "3 días" },
  { dias: 7, texto: "7 días" },
  { dias: 30, texto: "30 días" },
];

/* ==================== Utilidades de texto ==================== */

const nombreDe = (r: ReservaInbox | null | undefined) =>
  [r?.reservas_clientes?.nombre, r?.reservas_clientes?.apellidos].filter(Boolean).join(" ").trim() || "Sin nombre";

const CANAL_TXT: Record<string, string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp" };
const TIPO_MSG: Record<string, string> = {
  confirmacion: "recibida", confirmada: "confirmación", recordatorio: "recordatorio", reconfirmacion: "reconfirmación",
  cancelacion: "cancelación", modificacion: "modificación", lista_espera: "lista de espera", valoracion: "valoración",
  pago: "pago", garantia: "garantía", noshow: "no show", invitacion: "invitación", manual: "manual",
};
const CANCELADA_POR: Record<string, string> = { cliente: "por el cliente", restaurante: "por el restaurante", sistema: "automática" };
const CAMPO_TXT = { fecha: "Fecha", hora: "Hora", pax: "Pax" } as const;

function fmtHoraTs(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fechaLocal(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE");
}
function etiquetaDia(fecha: string, hoy: string): string {
  if (fecha === hoy) return "Hoy";
  const ayer = new Date(hoy + "T12:00"); ayer.setDate(ayer.getDate() - 1);
  if (fecha === ayer.toLocaleDateString("sv-SE")) return "Ayer";
  return fmtFechaCorta(fecha);
}
function haceTexto(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}
const estrellas = (n: number | null) => (n ? "★".repeat(n) + "☆".repeat(5 - n) : "");

/* ==================== Sección ==================== */

export default function SecInbox({ ctx, rest, setFecha, avisar }: SecProps) {
  const [todos, setTodos] = useState(false);
  const [dias, setDias] = useState(DIAS_DEFECTO);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [novedades, setNovedades] = useState<Novedad[]>([]);
  const [leidos, setLeidos] = useState<Record<string, number>>({});
  const [cargado, setCargado] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null); // id de novedad con acción en curso
  const [rechazando, setRechazando] = useState<{ id: string; motivo: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hoy = hoyISO();
  const multiRest = ctx.restaurantes.length > 1;
  const restId = todos ? null : rest.id;

  const [truncado, setTruncado] = useState(false);

  useEffect(() => {
    setTodos(leerTodos());
    setDias(leerDias());
    setLeidos(leerLeidos());
  }, []);

  const recargar = useCallback(async () => {
    const r = await api.novedades(restId, desdeISO(dias));
    if (!r.ok || !r.data) { setError(r.error || "No se han podido cargar las novedades."); setCargado(true); return; }
    setError(null);
    setNovedades(r.data);
    setTruncado(!!r.truncado);
    setCargado(true);
    emitirContador(contarNoLeidos(r.data, leerLeidos()));
  }, [restId, dias]);

  useEffect(() => { setCargado(false); recargar(); }, [recargar]);
  useRecargaExterna(recargar);

  // Refresco periódico mientras la pestaña está abierta (la sala la deja abierta en una tablet).
  const recargarRef = useRef(recargar);
  recargarRef.current = recargar;
  useEffect(() => {
    const t = setInterval(() => recargarRef.current(), 60000);
    return () => clearInterval(t);
  }, []);

  /* ---- leídos ---- */
  const marcar = (ids: string[]) => {
    const v = marcarLeidos(ids);
    setLeidos(v);
    emitirContador(contarNoLeidos(novedades, v));
  };
  const noLeidas = useMemo(() => contarNoLeidos(novedades, leidos), [novedades, leidos]);

  /* ---- filtros ---- */
  const pend = useCallback((n: Novedad) => requiereAccion(n, leidos), [leidos]);

  const cuenta = useMemo(() => {
    const c: Record<string, number> = { todas: novedades.length, pendientes: novedades.filter(pend).length };
    TIPOS.forEach((t) => (c[t.id] = novedades.filter((n) => n.tipo === t.id).length));
    return c;
  }, [novedades, pend]);

  const visibles = useMemo(
    () => novedades.filter((n) => (filtro === "todas" ? true : filtro === "pendientes" ? pend(n) : n.tipo === filtro)),
    [novedades, filtro, pend],
  );

  /** Grupos: «Requieren acción» arriba y, debajo, el resto por día. */
  const grupos = useMemo(() => {
    const out: { clave: string; titulo: string; items: Novedad[] }[] = [];
    const arriba = visibles.filter(pend);
    if (arriba.length) out.push({ clave: "pend", titulo: `Requieren acción · ${arriba.length}`, items: arriba });
    const resto = visibles.filter((n) => !pend(n));
    const porDia = new Map<string, Novedad[]>();
    resto.forEach((n) => { const f = fechaLocal(n.ts); porDia.set(f, [...(porDia.get(f) ?? []), n]); });
    [...porDia.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).forEach(([f, items]) => out.push({ clave: f, titulo: etiquetaDia(f, hoy), items }));
    return out;
  }, [visibles, hoy, pend]);

  /* ---- acciones ---- */
  /** Ejecuta una acción. Marca como leída la novedad y las que la propia acción genera sobre la
      misma reserva (p. ej. «Cancelación por el restaurante» al rechazar), para que el contador no
      suba justo después de actuar. Una sola recarga: pedirRecarga() → useRecargaExterna. */
  async function correr(novId: string, p: Promise<{ ok: boolean; error?: string }>, okMsg: string, reservaId?: string) {
    setOcupado(novId);
    const r = await p;
    setOcupado(null);
    if (!r.ok) { avisar(r.error || "No se ha podido guardar. Revisa la conexión."); pedirRecarga(); return false; }
    avisar(okMsg);
    const ids = [novId];
    if (reservaId) ["cancel", "rev", "nueva", "grupo", "tarjeta"].forEach((t) => ids.push(`${t}:${reservaId}`));
    marcar(ids);
    pedirRecarga();
    return true;
  }

  /** WhatsApp con el enlace de la tarjeta. La ventana se abre en el mismo clic (Safari en iPad
      bloquea las que se abren después de un await) y se le pone la dirección al llegar el enlace. */
  async function whatsappTarjeta(n: Novedad, r: ReservaInbox, tel: string) {
    const w = window.open("", "_blank");
    setOcupado(n.id);
    const res = await api.enlaceTarjeta(r.id);
    setOcupado(null);
    if (!res.ok || !res.data) { w?.close(); avisar(res.error || "No se ha podido obtener el enlace."); return; }
    const texto = `Hola ${r.reservas_clientes?.nombre ?? ""}, para completar tu reserva del ${fmtFechaCorta(r.fecha)} a las ${fmtHora(r.hora)} necesitamos la tarjeta de garantía: ${res.data.enlace}`;
    const url = `https://wa.me/${telWA(tel)}?text=${encodeURIComponent(texto)}`;
    if (w) { w.opener = null; w.location.href = url; } else window.location.href = url;
    marcar([n.id]);
  }

  function irAjustesMensajes() {
    guardarPref("ajustes:tab", "mensajes");
    irATab("ajustes");
  }

  const cambiarAlcance = (t: boolean, d: number) => {
    setTodos(t); setDias(d);
    guardarPref(PREF_TODOS, t); guardarPref(PREF_DIAS, d);
    window.dispatchEvent(new CustomEvent(EV_ALCANCE));
  };

  /** Abre la reserva en el modal (evento de la barra). Si nadie lo atiende, vamos al Día de esa reserva. */
  function abrirReserva(r: ReservaInbox) {
    const atendido = !window.dispatchEvent(new CustomEvent("rsv:abrir-reserva", { detail: r.id, cancelable: true }));
    if (atendido) return;
    setFecha(r.fecha);
    irATab("dia");
  }

  function irAEspera(fecha: string) {
    setFecha(fecha);
    irATab("espera");
  }

  const nombreRest = (id: string | null) => ctx.restaurantes.find((x) => x.id === id)?.nombre ?? "";

  /* ---- render ---- */
  return (
    <div className="ib">
      <div className="ib-cab">
        {multiRest ? (
          <select
            className="ib-sel"
            value={todos ? "*" : rest.id}
            onChange={(e) => cambiarAlcance(e.target.value === "*", dias)}
            aria-label="Restaurante"
          >
            <option value={rest.id}>{rest.nombre}</option>
            <option value="*">Todos los restaurantes</option>
          </select>
        ) : null}
        <select className="ib-sel" value={dias} onChange={(e) => cambiarAlcance(todos, Number(e.target.value))} aria-label="Periodo">
          {PERIODOS.map((p) => <option key={p.dias} value={p.dias}>{p.texto}</option>)}
        </select>
        <div className="ib-chips">
          <button className={filtro === "todas" ? "activo" : ""} onClick={() => setFiltro("todas")}>Todas <b>{cuenta.todas}</b></button>
          <button className={filtro === "pendientes" ? "activo" : ""} onClick={() => setFiltro("pendientes")}>
            <i style={{ background: "#F26B1D" }} />Pendientes <b>{cuenta.pendientes}</b>
          </button>
          {TIPOS.filter((t) => cuenta[t.id] > 0 || filtro === t.id).map((t) => (
            <button key={t.id} className={filtro === t.id ? "activo" : ""} onClick={() => setFiltro(t.id)}>
              <i style={{ background: t.color }} />{t.texto} <b>{cuenta[t.id]}</b>
            </button>
          ))}
        </div>
        <div className="ib-der">
          <span className="ib-noleidas">{noLeidas ? `${noLeidas} sin leer` : "Todo leído"}</span>
          <button className="ib-btn" onClick={() => marcar(novedades.map((n) => n.id))} disabled={!noLeidas}>Marcar todo leído</button>
          <button className="ib-btn" onClick={() => recargar()} aria-label="Actualizar" title="Actualizar">↻</button>
        </div>
      </div>

      {error ? <div className="aviso err">{error}</div> : null}
      {truncado ? <div className="aviso info">Hay más novedades de las que se muestran: acota el periodo{multiRest ? " o el restaurante" : ""}. Lo que requiere acción sale siempre completo.</div> : null}
      {!cargado ? <div className="spinner" /> : null}
      {cargado && !visibles.length ? (
        <div className="vacio">Sin novedades {filtro !== "todas" ? "de este tipo " : ""}en los últimos {dias === 1 ? "24 h" : `${dias} días`}.</div>
      ) : null}

      {grupos.map((g) => (
        <section key={g.clave} className={`ib-grupo${g.clave === "pend" ? " pend" : ""}`}>
          <h4>{g.titulo}</h4>
          {g.items.map((n) => {
            const t = TIPO[n.tipo];
            const leida = !!leidos[n.id];
            const r = n.reserva;
            const cliente = r?.reservas_clientes ?? null;
            const tel = cliente?.telefono || n.espera?.telefono || null;
            const enCurso = ocupado === n.id;
            const esPend = pend(n);
            const resumenSinProv = n.tipo === "mensaje_error" && n.id.startsWith("sinprov:");
            return (
              <article
                key={n.id}
                className={`ib-fila${leida ? "" : " noleida"}${esPend ? " pendiente" : ""}`}
                style={{ borderLeftColor: t.color }}
                onClick={() => { if (!leida) marcar([n.id]); }}
              >
                <div className="ib-ico" style={{ color: t.color }} aria-hidden>{t.icono}</div>
                <div className="ib-hora" title={new Date(n.ts).toLocaleString("es-ES")}>
                  {fmtHoraTs(n.ts)}
                  <small>{haceTexto(n.ts)}</small>
                </div>
                <div className="ib-cuerpo">
                  <div className="ib-tit">
                    {!leida ? <span className="ib-punto" aria-label="Sin leer" /> : null}
                    <Titulo n={n} />
                    {todos && n.restaurante_id ? <span className="ib-rest">{nombreRest(n.restaurante_id)}</span> : null}
                  </div>
                  {r ? (
                    <div className="ib-res">
                      <button className="ib-link" onClick={(e) => { e.stopPropagation(); abrirReserva(r); }} title="Abrir la reserva">
                        {nombreDe(r)}
                      </button>
                      <span>·</span><b>{r.pax} pax</b>
                      <span>·</span><span>{fmtFechaCorta(r.fecha)} {fmtHora(r.hora)}</span>
                      {r.localizador ? <><span>·</span><code>{r.localizador}</code></> : null}
                      <span className="chip estado" style={{ background: estadoDe(r.estado).color, color: estadoDe(r.estado).color === "#FFFFFF" ? "#1a1a1a" : "#fff", border: estadoDe(r.estado).borde ? `1px solid ${estadoDe(r.estado).borde}` : undefined }}>
                        {estadoDe(r.estado).texto}
                      </span>
                      {r.mesa_id ? null : n.tipo === "nueva" || n.tipo === "grupo" ? <span className="chip sinmesa">Sin mesa</span> : null}
                      {cliente?.vip ? <span className="chip vip">VIP</span> : null}
                      {cliente?.lista_negra ? <span className="chip noshows">Lista negra</span> : null}
                    </div>
                  ) : null}
                  {n.espera ? (
                    <div className="ib-res">
                      <b>{n.espera.nombre}</b>
                      <span>·</span><b>{n.espera.pax} pax</b>
                      <span>·</span><span>{fmtFechaCorta(n.espera.fecha)}{n.espera.hora_preferida ? ` ${fmtHora(n.espera.hora_preferida)}` : ""}</span>
                      {n.espera.telefono ? <><span>·</span><span>{n.espera.telefono}</span></> : null}
                    </div>
                  ) : null}
                  <Detalle n={n} />
                </div>
                <div className="ib-acc" onClick={(e) => e.stopPropagation()}>
                  {/* Reserva online pendiente o solicitud de grupo */}
                  {r && esPend && (n.tipo === "nueva" || n.tipo === "grupo") ? (
                    rechazando?.id === n.id ? (
                      <div className="ib-rechazo">
                        <input
                          autoFocus
                          placeholder="Motivo (interno)"
                          title="Solo lo ve la sala: el cliente recibe el aviso de cancelación sin el motivo."
                          value={rechazando.motivo}
                          onChange={(e) => setRechazando({ id: n.id, motivo: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setRechazando(null);
                            if (e.key === "Enter") { correr(n.id, api.rechazarReserva(r.id, rechazando.motivo), "Reserva rechazada.", r.id); setRechazando(null); }
                          }}
                        />
                        <button className="peligro" disabled={enCurso} onClick={() => { correr(n.id, api.rechazarReserva(r.id, rechazando.motivo), "Reserva rechazada.", r.id); setRechazando(null); }}>Rechazar</button>
                        <button onClick={() => setRechazando(null)}>Atrás</button>
                      </div>
                    ) : (
                      <>
                        <button className="primaria" disabled={enCurso} onClick={() => correr(n.id, api.confirmarReserva(r.id), "Reserva confirmada.", r.id)}>Confirmar</button>
                        <button disabled={enCurso} onClick={() => abrirReserva(r)}>Asignar mesa</button>
                        {tel ? <a className="wa" href={`https://wa.me/${telWA(tel)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
                        <button className="peligro" disabled={enCurso} onClick={() => setRechazando({ id: n.id, motivo: "" })}>Rechazar</button>
                      </>
                    )
                  ) : null}
                  {/* Tarjeta sin introducir */}
                  {r && n.tipo === "tarjeta" && esPend ? (
                    <>
                      <button className="primaria" disabled={enCurso} onClick={() => correr(n.id, api.reenviarEnlaceTarjeta(r.id), "Enlace de la tarjeta reenviado.")}>Reenviar enlace</button>
                      {tel ? <button className="wa" disabled={enCurso} onClick={() => whatsappTarjeta(n, r, tel)}>WhatsApp</button> : null}
                      <button className="peligro" disabled={enCurso} onClick={() => correr(n.id, api.rechazarReserva(r.id, "Sin tarjeta de garantía"), "Reserva liberada.", r.id)}>Liberar</button>
                    </>
                  ) : null}
                  {/* A revisar: hora pasada sin llegada */}
                  {r && n.tipo === "a_revisar" && esPend ? (
                    <>
                      <button className="primaria" disabled={enCurso} onClick={() => correr(n.id, api.cambiarEstadoReserva(r.id, "llegada"), "Marcada como llegada.", r.id)}>Ha llegado</button>
                      <button disabled={enCurso} onClick={() => correr(n.id, api.cambiarEstadoReserva(r.id, "sentada"), "Sentada.", r.id)}>Sentar</button>
                      {tel ? <a className="wa" href={`https://wa.me/${telWA(tel)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a> : null}
                      <button className="peligro" disabled={enCurso} onClick={() => correr(n.id, api.cambiarEstadoReserva(r.id, "no_show"), "Marcada como no show.", r.id)}>No show</button>
                      <button disabled={enCurso} onClick={() => correr(n.id, api.cambiarEstadoReserva(r.id, "terminada"), "Mesa liberada.", r.id)}>Liberar</button>
                    </>
                  ) : null}
                  {/* Mensajes sin proveedor: resumen por canal, se arregla en Ajustes */}
                  {resumenSinProv ? <button onClick={irAjustesMensajes}>Ajustes › Mensajes</button> : null}
                  {/* Mensaje con error */}
                  {n.mensaje && n.pendiente && !resumenSinProv ? (
                    <>
                      <button className="primaria" disabled={enCurso} onClick={() => correr(n.id, api.reintentarMensaje(n.mensaje!.id), "Mensaje encolado de nuevo.")}>Reintentar</button>
                      {n.mensaje.canal !== "email" && n.mensaje.destinatario ? (
                        <a className="wa" href={`https://wa.me/${telWA(n.mensaje.destinatario)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                      ) : null}
                      <button className="peligro" disabled={enCurso} onClick={() => correr(n.id, api.descartarMensaje(n.mensaje!.id), "Mensaje descartado.")}>Descartar</button>
                    </>
                  ) : null}
                  {/* Lista de espera */}
                  {n.espera ? <button onClick={() => irAEspera(n.espera!.fecha)}>Ir a la lista</button> : null}
                  {/* Responder al cliente (valoraciones, cancelaciones, modificaciones, pagos) */}
                  {r && (n.tipo === "valoracion" || n.tipo === "cancelacion" || n.tipo === "modificacion" || n.tipo === "pago") ? (
                    <Responder r={r} alPulsar={() => { if (!leida) marcar([n.id]); }} />
                  ) : null}
                  {/* Resto: abrir la reserva */}
                  {r && !(esPend && n.tipo !== "valoracion" && n.tipo !== "pago") ? (
                    <button onClick={() => abrirReserva(r)}>Ver reserva</button>
                  ) : null}
                  {!leida ? <button className="ib-leer" title="Marcar como leída" onClick={() => marcar([n.id])}>✓</button> : null}
                </div>
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/* ==================== Piezas de texto ==================== */

function Titulo({ n }: { n: Novedad }) {
  const r = n.reserva;
  switch (n.tipo) {
    case "nueva":
      return <span>{r?.estado === "pendiente" ? "Reserva online pendiente de confirmar" : "Nueva reserva online"}{r?.canal && r.canal !== "moduloweb" ? ` · ${r.canal}` : ""}</span>;
    case "grupo":
      return <span>Solicitud de grupo{r ? ` · ${r.pax} pax` : ""}{r?.estado !== "pendiente" ? ` · ${estadoDe(r?.estado ?? "").texto.toLowerCase()}` : ""}</span>;
    case "tarjeta":
      return <span>Tarjeta sin introducir{r?.origen === "online" ? " · reserva online" : ""}</span>;
    case "pago":
      return <span>{r?.estado_pago === "fallido" ? "Pago fallido" : "Cargo de no show cobrado"}</span>;
    case "cancelacion":
      return <span>Cancelación {CANCELADA_POR[r?.cancelada_por ?? ""] ?? ""}</span>;
    case "modificacion":
      return <span>Modificación del cliente</span>;
    case "mensaje_error":
      if (n.total != null) {
        return <span>{n.total} {n.total === 1 ? "mensaje" : "mensajes"} de {CANAL_TXT[n.mensaje?.canal ?? ""] ?? "este canal"} sin proveedor configurado</span>;
      }
      return <span>{CANAL_TXT[n.mensaje?.canal ?? ""] ?? "Mensaje"} no enviado · {TIPO_MSG[n.mensaje?.tipo ?? ""] ?? n.mensaje?.tipo}</span>;
    case "valoracion":
      return <span>Valoración <b className="ib-estrellas">{estrellas(r?.valoracion ?? null)}</b></span>;
    case "a_revisar":
      return <span>Sin llegada a su hora</span>;
    case "espera":
      return <span>{n.id.endsWith(":aviso") ? "Lista de espera: cliente avisado" : "Nueva solicitud en lista de espera"}</span>;
  }
}

function Detalle({ n }: { n: Novedad }) {
  const r = n.reserva;
  const partes: React.ReactNode[] = [];
  if (n.tipo === "modificacion" && n.cambios?.length) {
    partes.push(
      <span key="c" className="ib-cambios">
        {n.cambios.map((c) => (
          <span key={c.campo}>
            {CAMPO_TXT[c.campo]} <s>{c.campo === "hora" ? fmtHora(c.antes) : c.campo === "fecha" ? fmtFechaCorta(c.antes) : c.antes}</s> → <b>{c.campo === "hora" ? fmtHora(c.despues) : c.campo === "fecha" ? fmtFechaCorta(c.despues) : c.despues}</b>
          </span>
        ))}
      </span>,
    );
  }
  if (n.tipo === "cancelacion" && r?.motivo_cancelacion) partes.push(<span key="m">Motivo: {r.motivo_cancelacion}</span>);
  if (n.tipo === "valoracion") {
    const d = (r?.valoracion_detalle ?? null) as Record<string, number> | null;
    if (d && typeof d === "object") {
      const t = [d.comida != null ? `comida ${d.comida}` : "", d.atencion != null ? `atención ${d.atencion}` : "", d.entorno != null ? `entorno ${d.entorno}` : "", d.nps != null ? `NPS ${d.nps}` : ""].filter(Boolean).join(" · ");
      if (t) partes.push(<span key="d">{t}</span>);
    }
    if (r?.valoracion_comentario) partes.push(<span key="v" className="ib-cita">“{r.valoracion_comentario}”</span>);
  }
  if (n.tipo === "mensaje_error" && n.total != null) {
    partes.push(<span key="e">Saldrán solos cuando el canal esté configurado. Si no lo vas a usar, desactívalo en Ajustes › Mensajes.</span>);
  } else if (n.tipo === "mensaje_error" && n.mensaje) {
    partes.push(<span key="e">{n.mensaje.destinatario}{n.mensaje.estado === "sin_proveedor" ? " · sin proveedor configurado para este canal" : n.mensaje.error ? ` · ${n.mensaje.error}` : ""}{n.mensaje.intentos > 1 ? ` · ${n.mensaje.intentos} intentos` : ""}</span>);
  }
  if ((n.tipo === "nueva" || n.tipo === "grupo") && r?.notas_cliente) partes.push(<span key="n" className="ib-cita">“{r.notas_cliente}”</span>);
  if ((n.tipo === "nueva" || n.tipo === "grupo") && (r?.alergias || r?.reservas_clientes?.alergias)) partes.push(<span key="a" className="ib-alerg">Alergias: {r.alergias || r.reservas_clientes?.alergias}</span>);
  if (n.tipo === "tarjeta" && r) partes.push(<span key="t">El cliente aún no ha metido la tarjeta de garantía{r.estado_pago === "pendiente_tarjeta" ? "" : ` · ${r.estado_pago}`}</span>);
  if (n.tipo === "valoracion" && n.pendiente) partes.push(<span key="p" className="ib-alerg">Valoración baja: conviene responder</span>);
  if (n.tipo === "a_revisar" && r) partes.push(<span key="r">Reserva a las {fmtHora(r.hora)}{r.reservas_clientes?.telefono ? ` · ${r.reservas_clientes.telefono}` : ""}</span>);
  if (n.tipo === "espera" && n.espera?.notas) partes.push(<span key="x" className="ib-cita">“{n.espera.notas}”</span>);
  if (n.tipo === "espera" && n.espera?.estado === "convertida") partes.push(<span key="y">Ya sentada</span>);
  if (!partes.length) return null;
  return <div className="ib-det">{partes}</div>;
}

/** «Responder» al cliente: WhatsApp con su teléfono y, si tiene email, correo. */
function Responder({ r, alPulsar }: { r: ReservaInbox; alPulsar: () => void }) {
  const c = r.reservas_clientes;
  const tel = c?.telefono ? telWA(c.telefono) : "";
  const email = c?.email?.trim() || "";
  if (!tel && !email) return null;
  return (
    <>
      {tel ? <a className="wa" href={`https://wa.me/${tel}`} target="_blank" rel="noopener noreferrer" onClick={alPulsar} title="Responder por WhatsApp">Responder</a> : null}
      {email ? (
        <a href={`mailto:${email}?subject=${encodeURIComponent(`Tu reserva del ${fmtFechaCorta(r.fecha)}`)}`} onClick={alPulsar} title={`Responder por email a ${email}`}>
          {tel ? "Email" : "Responder"}
        </a>
      ) : null}
    </>
  );
}
