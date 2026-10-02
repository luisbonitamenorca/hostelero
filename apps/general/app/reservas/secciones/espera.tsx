"use client";

/* Lista de espera del panel de Reservas (guía §9): una fila por entrada con hora de alta, nombre,
   pax, teléfono, hora preferida, zona y espera estimada; acciones «Avisar», «Sentar en mesa…»
   (o «Convertir en reserva…» si el día no es hoy), «Editar» y «Descartar»; alta rápida arriba y
   «vista puerta» con letras grandes para la tablet de la entrada. Sentar desde una mesa libre del
   plano lo ofrece el Día (menú de mesa → «Sentar desde lista de espera…»). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../acciones/espera";
import type { DatosEspera, EntradaEspera, MesaEspera, OcupacionEspera, BloqueoEspera } from "../acciones/espera";
import { fmtFechaCorta, fmtFechaLarga, fmtHora, guardarPref, leerPref, pedirRecarga, useRecargaExterna, type SecProps } from "../lib-reservas";
import { hoyISO, minutos, telWA, type Turno } from "../tipos";
import "./espera.css";

/* ==================== Utilidades de tiempo y mesas ==================== */

const horaAhora = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const horaDeMin = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
/** Redondea a la siguiente franja de 15 min. */
const redondear15 = (h: string) => horaDeMin(Math.ceil(minutos(h) / 15) * 15);

/** Duración según pax leyendo duracion_por_pax del restaurante ({"1-2":90,"3-4":120,"9+":180}). */
function duracionPorPax(cfg: unknown, pax: number, defecto: number): number {
  if (!cfg || typeof cfg !== "object") return defecto;
  for (const [k, v] of Object.entries(cfg as Record<string, unknown>)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) continue;
    let min: number, max: number;
    if (k.endsWith("+")) { min = Number(k.slice(0, -1)); max = 999; }
    else if (k.includes("-")) { const [a, b] = k.split("-").map(Number); min = a; max = b; }
    else { min = Number(k); max = min; }
    if (Number.isFinite(min) && Number.isFinite(max) && pax >= min && pax <= max) return n;
  }
  return defecto;
}

function turnoDeHora(turnos: Turno[], fecha: string, hora: string): Turno | undefined {
  const dow = ((new Date(fecha + "T12:00:00").getDay() + 6) % 7) + 1;
  return turnos.find((t) => t.activo && (t.dias_semana || []).includes(dow) && hora >= fmtHora(t.hora_inicio) && hora <= fmtHora(t.hora_fin));
}

type EstadoMesa = { libre: boolean; libreA: string | null; bloqueada: boolean };

/** ¿Está la mesa libre entre hora y hora+dur? Si no, cuándo se libera. */
function estadoMesa(mesa: MesaEspera, hora: string, dur: number, ocupacion: OcupacionEspera[], bloqueos: BloqueoEspera[]): EstadoMesa {
  const ini = minutos(hora), fin = ini + dur;
  let libreA: number | null = null;
  for (const o of ocupacion) {
    if (!o.mesas.includes(mesa.id)) continue;
    const a = minutos(fmtHora(o.hora)), b = a + o.duracion_min;
    if (a < fin && b > ini) libreA = Math.max(libreA ?? 0, b);
  }
  let bloqueada = false;
  for (const b of bloqueos) {
    const aplica = b.mesa_id === mesa.id || (!b.mesa_id && (b.sala_id === mesa.sala_id || !b.sala_id));
    if (!aplica) continue;
    const a = minutos(fmtHora(b.hora_inicio)), z = minutos(fmtHora(b.hora_fin));
    if (a < fin && z > ini) { bloqueada = true; libreA = Math.max(libreA ?? 0, z); }
  }
  return { libre: libreA == null, libreA: libreA == null ? null : horaDeMin(libreA), bloqueada };
}

/* ==================== Sección ==================== */

type Ficha = { id: string; modo: "sentar" | "avisar" | "editar" } | null;
/** Margen a partir del cual una mesa «para dentro de un rato» se reserva en vez de sentarse ya. */
const MARGEN_SENTAR_MIN = 10;

export default function SecEspera({ rest, fecha, setFecha, avisar }: SecProps) {
  const restId = rest.id;
  const [datos, setDatos] = useState<DatosEspera | null>(null);
  const [cargado, setCargado] = useState(false);
  const [puerta, setPuerta] = useState(false);
  const [verCerradas, setVerCerradas] = useState(false);
  const [ficha, setFicha] = useState<Ficha>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [ahora, setAhora] = useState(horaAhora());
  /** Aviso sin canal automático: enlace de WhatsApp ya compuesto para que la sala lo pulse. */
  const [waManual, setWaManual] = useState<{ id: string; url: string } | null>(null);
  /** Cada incremento enfoca el nombre del alta rápida (botón «Crear lista de espera» del Día). */
  const [foco, setFoco] = useState(0);
  const esHoy = fecha === hoyISO();

  useEffect(() => { setPuerta(leerPref<boolean>("espera:puerta", false) === true); }, []);

  // «Crear lista de espera» desde el Día: deja la pref y emite "rsv:espera-nueva" ({ fecha }).
  useEffect(() => {
    if (leerPref<boolean>("espera:abrir", false) === true) { guardarPref("espera:abrir", false); setFoco((f) => f + 1); }
    const h = (ev: Event) => {
      guardarPref("espera:abrir", false);
      const f = (ev as CustomEvent<{ fecha?: string } | null>).detail?.fecha;
      if (f && f !== fecha) setFecha(f);
      setFoco((x) => x + 1);
    };
    window.addEventListener("rsv:espera-nueva", h);
    return () => window.removeEventListener("rsv:espera-nueva", h);
  }, [fecha, setFecha]);

  const recargar = useCallback(async () => {
    const r = await api.lista(restId, fecha);
    if (!r.ok || !r.data) { avisar(r.error || "No se ha podido cargar la lista de espera."); setCargado(true); return; }
    setDatos(r.data);
    setCargado(true);
  }, [restId, fecha, avisar]);

  useEffect(() => { setCargado(false); setFicha(null); setWaManual(null); recargar(); }, [recargar]);
  useRecargaExterna(recargar);

  // Reloj y refresco: la lista vive en una tablet en la puerta, sin que nadie pulse nada.
  const recargarRef = useRef(recargar);
  recargarRef.current = recargar;
  useEffect(() => {
    const t = setInterval(() => { setAhora(horaAhora()); recargarRef.current(); }, 45000);
    return () => clearInterval(t);
  }, []);

  const mesas: MesaEspera[] = useMemo(() => (datos?.salas ?? []).flatMap((s) => s.mesas), [datos]);
  const salaDe = (id: string | null) => (datos?.salas ?? []).find((s) => s.id === id)?.nombre ?? "";
  const mesaDe = (id: string | null) => mesas.find((m) => m.id === id);

  const entradas = datos?.entradas ?? [];
  const abiertas = entradas.filter((e) => e.estado === "esperando" || e.estado === "avisado");
  const cerradas = entradas.filter((e) => e.estado === "convertida" || e.estado === "descartada");

  /** Duración por pax (config del restaurante; si no, la del turno; si no, 120). */
  const duracionPara = (pax: number, hora: string) =>
    duracionPorPax(rest.duracion_por_pax, pax, turnoDeHora(datos?.turnos ?? [], fecha, hora)?.duracion_min ?? 120);

  /** Espera estimada (cálculo simple, sin columna en base): mesas que caben para su pax y, si pidió
      zona, de esa zona. Si hay más libres ahora que gente por delante → «ahora»; si no, cuándo se
      libera la k-ésima (k = los que van por delante − libres) + 10 min para recoger. */
  const esperaEstimada = (e: EntradaEspera): { texto: string; min: number | null } => {
    if (!esHoy) return { texto: "—", min: null };
    const dur = duracionPara(e.pax, ahora);
    const aptas = mesas.filter((m) => m.cap_min <= e.pax && m.cap_max >= e.pax && (!e.zona_id || m.sala_id === e.zona_id));
    if (!aptas.length) return { texto: "sin mesa apta", min: null };
    const estados = aptas.map((m) => estadoMesa(m, ahora, dur, datos?.ocupacion ?? [], datos?.bloqueos ?? []));
    const libres = estados.filter((s) => s.libre).length;
    const porDelante = abiertas.filter((x) => x.creado_en < e.creado_en && x.pax <= e.pax).length;
    if (libres > porDelante) return { texto: "ahora", min: 0 };
    const liberan = estados.filter((s) => !s.libre && s.libreA && !s.bloqueada).map((s) => minutos(s.libreA!)).sort((a, b) => a - b);
    const k = porDelante - libres;
    if (!liberan.length || k >= liberan.length) return { texto: "> 1 h", min: null };
    const min = Math.max(0, liberan[k] - minutos(ahora) + 10);
    return { texto: min < 5 ? "≈ 5 min" : min >= 90 ? `≈ ${Math.round(min / 30) / 2} h` : `≈ ${Math.round(min / 5) * 5} min`, min };
  };

  async function correr(id: string, p: Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    setOcupado(id);
    const r = await p;
    setOcupado(null);
    if (!r.ok) { avisar(r.error || "No se ha podido guardar. Revisa la conexión."); return false; }
    if (okMsg) avisar(okMsg);
    await recargar();
    return true;
  }

  async function hacerAvisar(e: EntradaEspera, hora: string) {
    setOcupado(e.id);
    const r = await api.avisar(e.id, hora);
    setOcupado(null);
    if (!r.ok || !r.data) { avisar(r.error || "No se ha podido avisar."); return; }
    setFicha(null);
    await recargar();
    if (r.data.encolados > 0) { avisar(`Aviso en camino a ${e.nombre} (${r.data.encolados} ${r.data.encolados === 1 ? "mensaje" : "mensajes"}).`); return; }
    // Sin canal automático (ni plantilla ni proveedor): queda un botón de WhatsApp con el mensaje
    // compuesto. No se abre solo: Safari en iPad bloquea las ventanas abiertas tras un await.
    const texto = `Hola ${e.nombre}, tenemos mesa para ${e.pax} en ${rest.nombre} a las ${hora}. Reserva aquí: ${r.data.enlace}`;
    setWaManual({ id: e.id, url: `https://wa.me/${telWA(e.telefono)}?text=${encodeURIComponent(texto)}` });
    avisar("Sin envío automático configurado: mándale el aviso por WhatsApp.");
  }

  async function hacerSentar(e: EntradaEspera, mesaId: string, hora: string, estado: "sentada" | "confirmada") {
    const dur = duracionPara(e.pax, hora);
    const turno = turnoDeHora(datos?.turnos ?? [], fecha, hora);
    const mesa = mesaDe(mesaId)?.nombre ?? "";
    const okMsg = estado === "sentada"
      ? `${e.nombre} sentado en la mesa ${mesa}.`
      : `Reserva creada: ${e.nombre}, mesa ${mesa}, ${esHoy ? "hoy" : fmtFechaCorta(fecha)} a las ${hora}.`;
    const ok = await correr(e.id, api.sentar({ id: e.id, mesaId, hora, duracionMin: dur, turnoId: turno?.id ?? null, estado }), okMsg);
    if (ok) { setFicha(null); pedirRecarga(); }
  }

  if (!cargado) return <div className="spinner" />;

  return (
    <div className={`le${puerta ? " puerta" : ""}`}>
      <div className="le-cab">
        <div className="le-tit">
          <h3>Lista de espera</h3>
          <span>{fmtFechaLarga(fecha)}{esHoy ? ` · ${ahora}` : ""}</span>
        </div>
        <div className="le-res">
          <span><b>{abiertas.filter((e) => e.estado === "esperando").length}</b> esperando</span>
          <span><b>{abiertas.filter((e) => e.estado === "avisado").length}</b> avisados</span>
          <span><b>{cerradas.filter((e) => e.estado === "convertida").length}</b> sentados</span>
          <span><b>{abiertas.reduce((a, e) => a + e.pax, 0)}</b> pax en cola</span>
        </div>
        <button className={`le-toggle${puerta ? " activo" : ""}`} onClick={() => { const v = !puerta; setPuerta(v); guardarPref("espera:puerta", v); }}>
          {puerta ? "Vista normal" : "Vista puerta"}
        </button>
      </div>

      <Alta
        salas={datos?.salas ?? []}
        ocupado={ocupado === "alta"}
        foco={foco}
        enfocado={() => setFoco(0)}
        avisar={avisar}
        crear={async (d) => {
          const ok = await correr("alta", api.crear({ restauranteId: restId, fecha, ...d }), `${d.nombre} apuntado a la lista.`);
          return ok;
        }}
      />

      {!abiertas.length ? (
        <div className="vacio">Nadie en lista de espera{esHoy ? "" : " para este día"}.</div>
      ) : (
        <div className="le-tabla" role="table">
          {!puerta ? (
            <div className="le-fila cab" role="row">
              <span>Alta</span><span>Nombre</span><span>Pax</span><span>Prefiere</span><span>Zona</span><span>Espera</span><span>Estado</span><span />
            </div>
          ) : null}
          {abiertas.map((e, i) => {
            const est = esperaEstimada(e);
            const enCurso = ocupado === e.id;
            const abierta = ficha?.id === e.id ? ficha.modo : null;
            return (
              <div key={e.id} className={`le-item${e.estado === "avisado" ? " avisado" : ""}`}>
                <div className="le-fila" role="row">
                  <span className="le-alta"><b>{i + 1}</b>{fmtHora(new Date(e.creado_en).toTimeString())}</span>
                  <span className="le-nombre">
                    <b>{e.nombre}</b>
                    <small>
                      <a href={`tel:${e.telefono}`}>{e.telefono}</a>
                      {e.notas ? <> · <i>{e.notas}</i></> : null}
                    </small>
                  </span>
                  <button type="button" className="le-pax le-pax-btn" title="Cambiar pax, hora, zona o notas" onClick={() => setFicha(abierta === "editar" ? null : { id: e.id, modo: "editar" })}>{e.pax}</button>
                  <span className="le-pref">{e.hora_preferida ? fmtHora(e.hora_preferida) : "—"}</span>
                  <span className="le-zona">{e.zona_id ? salaDe(e.zona_id) : "—"}</span>
                  <span className={`le-est${est.min === 0 ? " ya" : ""}`}>{est.texto}</span>
                  <span className="le-estado">
                    {e.estado === "avisado" ? (
                      <span className="chip" style={{ background: "#7C3AED", color: "#fff" }} title={e.avisado_en ? new Date(e.avisado_en).toLocaleString("es-ES") : ""}>
                        Avisado {e.avisado_en ? fmtHora(new Date(e.avisado_en).toTimeString()) : ""}
                      </span>
                    ) : (
                      <span className="chip nota">Esperando</span>
                    )}
                  </span>
                  <span className="le-acc">
                    <button className={abierta === "avisar" ? "activo" : ""} disabled={enCurso} onClick={() => setFicha(abierta === "avisar" ? null : { id: e.id, modo: "avisar" })}>
                      {e.estado === "avisado" ? "Avisar otra vez" : "Avisar"}
                    </button>
                    <button className={`primaria${abierta === "sentar" ? " activo" : ""}`} disabled={enCurso} onClick={() => setFicha(abierta === "sentar" ? null : { id: e.id, modo: "sentar" })}>
                      {esHoy ? "Sentar en mesa…" : "Convertir en reserva…"}
                    </button>
                    <button className={abierta === "editar" ? "activo" : ""} disabled={enCurso} onClick={() => setFicha(abierta === "editar" ? null : { id: e.id, modo: "editar" })}>
                      Editar
                    </button>
                    <button className="peligro" disabled={enCurso} onClick={() => correr(e.id, api.descartar(e.id), `${e.nombre} descartado.`)}>Descartar</button>
                  </span>
                </div>
                {waManual?.id === e.id ? (
                  <div className="le-panel">
                    <div className="le-panel-fila">
                      <span className="le-panel-tit le-sin-margen">Sin envío automático configurado.</span>
                      <a className="wa" href={waManual.url} target="_blank" rel="noopener noreferrer" onClick={() => setWaManual(null)}>Enviar por WhatsApp</a>
                      <button onClick={() => setWaManual(null)}>Cerrar</button>
                    </div>
                  </div>
                ) : null}
                {abierta === "editar" ? (
                  <PanelEditar
                    e={e}
                    salas={datos?.salas ?? []}
                    ocupado={enCurso}
                    guardar={async (c) => { const ok = await correr(e.id, api.editar(e.id, c), "Cambios guardados."); if (ok) setFicha(null); }}
                    cerrar={() => setFicha(null)}
                  />
                ) : null}
                {abierta === "avisar" ? (
                  <PanelAvisar e={e} ahora={ahora} esHoy={esHoy} rest={rest.nombre} ocupado={enCurso} avisar={(h) => hacerAvisar(e, h)} cerrar={() => setFicha(null)} />
                ) : null}
                {abierta === "sentar" ? (
                  <PanelSentar
                    e={e}
                    ahora={ahora}
                    esHoy={esHoy}
                    datos={datos!}
                    duracionPara={duracionPara}
                    ocupado={enCurso}
                    fechaTxt={fmtFechaCorta(fecha)}
                    sentar={(mesaId, hora, estado) => hacerSentar(e, mesaId, hora, estado)}
                    cerrar={() => setFicha(null)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {cerradas.length ? (
        <div className="le-cerradas">
          <button className="le-ver" onClick={() => setVerCerradas((v) => !v)}>
            {verCerradas ? "▾" : "▸"} Sentados y descartados · {cerradas.length}
          </button>
          {verCerradas ? (
            <div className="le-tabla">
              {cerradas.map((e) => (
                <div key={e.id} className="le-item cerrada">
                  <div className="le-fila">
                    <span className="le-alta">{fmtHora(new Date(e.creado_en).toTimeString())}</span>
                    <span className="le-nombre"><b>{e.nombre}</b><small>{e.telefono}</small></span>
                    <span className="le-pax">{e.pax}</span>
                    <span className="le-pref">{e.hora_preferida ? fmtHora(e.hora_preferida) : "—"}</span>
                    <span className="le-zona">{e.zona_id ? salaDe(e.zona_id) : "—"}</span>
                    <span className="le-est">—</span>
                    <span className="le-estado">
                      {e.estado === "convertida" ? <span className="chip" style={{ background: "#16A34A", color: "#fff" }}>Sentado</span> : <span className="chip nota">Descartado</span>}
                    </span>
                    <span className="le-acc">
                      {e.estado === "descartada" ? <button disabled={ocupado === e.id} onClick={() => correr(e.id, api.reactivar(e.id), `${e.nombre} vuelve a la lista.`)}>Recuperar</button> : null}
                      {e.estado === "convertida" && e.reserva_id ? (
                        <button onClick={() => window.dispatchEvent(new CustomEvent("rsv:abrir-reserva", { detail: e.reserva_id, cancelable: true }))}>Ver reserva</button>
                      ) : null}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ==================== Alta rápida ==================== */

function Alta({ salas, ocupado, foco, enfocado, avisar, crear }: {
  salas: DatosEspera["salas"];
  ocupado: boolean;
  foco: number;
  enfocado: () => void;
  avisar: (m: string) => void;
  crear: (d: { nombre: string; telefono: string; pax: number; horaPreferida: string | null; zonaId: string | null; notas: string | null }) => Promise<boolean>;
}) {
  const [nombre, setNombre] = useState("");
  const [tel, setTel] = useState("");
  const [pax, setPax] = useState("2");
  const [hora, setHora] = useState("");
  const [zona, setZona] = useState("");
  const [notas, setNotas] = useState("");
  const [telMal, setTelMal] = useState(false);
  const nombreRef = useRef<HTMLInputElement>(null);
  const telRef = useRef<HTMLInputElement>(null);

  // Petición de foco (al llegar desde «Crear lista de espera» del Día).
  useEffect(() => {
    if (!foco) return;
    nombreRef.current?.focus();
    enfocado(); // una sola vez: si el alta se vuelve a montar (cambio de día) no roba el foco
  }, [foco, enfocado]);

  async function enviar() {
    if (!nombre.trim()) { nombreRef.current?.focus(); avisar("Falta el nombre."); return; }
    if (tel.replace(/\D/g, "").length < 9) {
      setTelMal(true);
      telRef.current?.focus();
      avisar("Falta un teléfono válido (9 dígitos o con prefijo).");
      return;
    }
    const ok = await crear({ nombre: nombre.trim(), telefono: tel, pax: parseInt(pax) || 1, horaPreferida: hora || null, zonaId: zona || null, notas: notas.trim() || null });
    if (ok) { setNombre(""); setTel(""); setPax("2"); setHora(""); setZona(""); setNotas(""); nombreRef.current?.focus(); }
  }

  return (
    <form className="le-alta-form" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
      <input ref={nombreRef} placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} aria-label="Nombre" autoComplete="off" />
      <input
        ref={telRef}
        type="tel"
        placeholder="Teléfono"
        value={tel}
        onChange={(e) => { setTel(e.target.value); if (telMal) setTelMal(false); }}
        aria-label="Teléfono"
        aria-invalid={telMal || undefined}
        title={telMal ? "Falta un teléfono válido (9 dígitos o con prefijo)" : undefined}
        autoComplete="off"
        inputMode="tel"
      />
      <input type="number" min={1} max={99} value={pax} onChange={(e) => setPax(e.target.value)} aria-label="Pax" className="le-in-pax" />
      <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} aria-label="Hora preferida" className="le-in-hora" />
      <select value={zona} onChange={(e) => setZona(e.target.value)} aria-label="Zona">
        <option value="">Cualquier zona</option>
        {salas.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
      </select>
      <input placeholder="Notas (trona, terraza, alergias…)" value={notas} onChange={(e) => setNotas(e.target.value)} aria-label="Notas" className="le-in-notas" />
      <button type="submit" className="le-add" disabled={ocupado}>+ Añadir</button>
    </form>
  );
}

/* ==================== Avisar ==================== */

function PanelAvisar({ e, ahora, esHoy, rest, ocupado, avisar, cerrar }: {
  e: EntradaEspera; ahora: string; esHoy: boolean; rest: string; ocupado: boolean; avisar: (hora: string) => void; cerrar: () => void;
}) {
  const [hora, setHora] = useState(e.hora_preferida ? fmtHora(e.hora_preferida) : esHoy ? redondear15(ahora) : "13:30");
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") cerrar(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cerrar]);
  return (
    <div className="le-panel">
      <div className="le-panel-tit">Avisar a <b>{e.nombre}</b> de que hay mesa para {e.pax} en {rest}</div>
      <div className="le-panel-fila">
        <label>Hora de la mesa <input type="time" value={hora} onChange={(ev) => setHora(ev.target.value)} /></label>
        <button className="primaria" disabled={ocupado || !hora} onClick={() => avisar(hora)}>Enviar aviso (WhatsApp / SMS / email)</button>
        <a className="wa" href={`https://wa.me/${telWA(e.telefono)}?text=${encodeURIComponent(`Hola ${e.nombre}, tenemos mesa para ${e.pax} en ${rest} a las ${hora}. ¿La queréis?`)}`} target="_blank" rel="noopener noreferrer">Escribir yo por WhatsApp</a>
        <button onClick={cerrar}>Cerrar</button>
      </div>
      <div className="le-panel-nota">El aviso lleva un enlace que reserva esa hora directamente. Se envía por los canales activos del restaurante; si no hay ninguno, se abre WhatsApp con el mensaje.</div>
    </div>
  );
}

/* ==================== Editar entrada ==================== */

function PanelEditar({ e, salas, ocupado, guardar, cerrar }: {
  e: EntradaEspera;
  salas: DatosEspera["salas"];
  ocupado: boolean;
  guardar: (c: { pax: number; horaPreferida: string | null; zonaId: string | null; notas: string | null }) => void;
  cerrar: () => void;
}) {
  const [pax, setPax] = useState(String(e.pax));
  const [hora, setHora] = useState(e.hora_preferida ? fmtHora(e.hora_preferida) : "");
  const [zona, setZona] = useState(e.zona_id ?? "");
  const [notas, setNotas] = useState(e.notas ?? "");
  const paxRef = useRef<HTMLInputElement>(null);
  useEffect(() => { paxRef.current?.focus(); paxRef.current?.select(); }, []);
  const enviar = () => guardar({ pax: Math.max(1, parseInt(pax) || e.pax), horaPreferida: hora || null, zonaId: zona || null, notas: notas.trim() || null });
  return (
    <form
      className="le-panel"
      onSubmit={(ev) => { ev.preventDefault(); enviar(); }}
      onKeyDown={(ev) => { if (ev.key === "Escape") { ev.stopPropagation(); cerrar(); } }}
    >
      <div className="le-panel-tit">Editar a <b>{e.nombre}</b> (mantiene su sitio en la cola)</div>
      <div className="le-panel-fila">
        <label>Pax <input ref={paxRef} type="number" min={1} max={99} value={pax} onChange={(ev) => setPax(ev.target.value)} className="le-in-pax" /></label>
        <label>Prefiere <input type="time" value={hora} onChange={(ev) => setHora(ev.target.value)} /></label>
        <label>Zona
          <select value={zona} onChange={(ev) => setZona(ev.target.value)}>
            <option value="">Cualquier zona</option>
            {salas.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <label className="le-edit-notas">Notas <input value={notas} onChange={(ev) => setNotas(ev.target.value)} placeholder="Trona, terraza, alergias…" /></label>
        <button type="submit" className="primaria" disabled={ocupado}>Guardar</button>
        <button type="button" onClick={cerrar}>Cerrar</button>
      </div>
    </form>
  );
}

/* ==================== Sentar en mesa / convertir en reserva ==================== */

/** Hoy: sienta ya (o reserva la mesa si la hora elegida es de aquí a un rato, p. ej. cuando se
    libera una ocupada). Otro día: siempre convierte en reserva confirmada; nunca crea «sentadas». */
function PanelSentar({ e, ahora, esHoy, datos, duracionPara, ocupado, fechaTxt, sentar, cerrar }: {
  e: EntradaEspera; ahora: string; esHoy: boolean; datos: DatosEspera;
  duracionPara: (pax: number, hora: string) => number;
  ocupado: boolean; fechaTxt: string;
  sentar: (mesaId: string, hora: string, estado: "sentada" | "confirmada") => void; cerrar: () => void;
}) {
  const [hora, setHora] = useState(esHoy ? ahora : e.hora_preferida ? fmtHora(e.hora_preferida) : "13:30");
  const [todas, setTodas] = useState(false);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  /** Hora puesta al elegir una mesa ocupada (la hora a la que se libera). */
  const [horaLiberada, setHoraLiberada] = useState<string | null>(null);
  const dur = duracionPara(e.pax, hora);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") cerrar(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cerrar]);

  const salas = datos.salas.map((s) => ({
    ...s,
    mesas: s.mesas
      .map((m) => ({ m, st: estadoMesa(m, hora, dur, datos.ocupacion, datos.bloqueos), cabe: m.cap_min <= e.pax && m.cap_max >= e.pax }))
      .filter((x) => todas || x.cabe)
      .sort((a, b) => Number(b.st.libre) - Number(a.st.libre) || a.m.cap_max - b.m.cap_max || a.m.nombre.localeCompare(b.m.nombre, "es", { numeric: true })),
  })).filter((s) => s.mesas.length);
  const hayLibre = salas.some((s) => s.mesas.some((x) => x.st.libre));
  const elegida = confirmar ? salas.flatMap((s) => s.mesas).find((x) => x.m.id === confirmar) ?? null : null;

  // Hoy y dentro de un rato → se reserva la mesa (confirmada); ahora mismo → se sienta.
  const estado: "sentada" | "confirmada" = esHoy && minutos(hora) <= minutos(ahora) + MARGEN_SENTAR_MIN ? "sentada" : "confirmada";
  const verbo = estado === "sentada" ? "Sentar" : "Reservar";

  function elegir(m: MesaEspera, st: EstadoMesa) {
    if (confirmar === m.id) { setConfirmar(null); return; }
    if (!st.libre && st.libreA) { setHora(st.libreA); setHoraLiberada(st.libreA); }
    setConfirmar(m.id);
  }

  return (
    <div className="le-panel">
      <div className="le-panel-tit">
        {esHoy ? "Sentar a " : "Convertir en reserva a "}<b>{e.nombre}</b> · {e.pax} pax{!esHoy ? ` · ${fechaTxt}` : ""}
        {e.zona_id ? ` · prefiere ${datos.salas.find((s) => s.id === e.zona_id)?.nombre ?? "zona"}` : ""}
      </div>
      <div className="le-panel-fila">
        <label>Hora <input type="time" value={hora} onChange={(ev) => { setHora(ev.target.value); setHoraLiberada(null); }} /></label>
        <span className="le-panel-dur">{dur} min de mesa</span>
        <label className="le-check"><input type="checkbox" checked={todas} onChange={(ev) => setTodas(ev.target.checked)} /> Ver todas las mesas</label>
        <button onClick={cerrar}>Cerrar</button>
      </div>
      {!esHoy ? <div className="aviso info">Este día no es hoy: se crea una reserva confirmada a esa hora (no se sienta a nadie).</div> : null}
      {!hayLibre ? <div className="aviso info">No hay mesa libre para {e.pax} a las {hora}. Elige una ocupada para reservarla a la hora en que se libera, o cambia la hora.</div> : null}
      <div className="le-mesas">
        {salas.map((s) => (
          <div key={s.id} className="le-sala">
            <div className="le-sala-nombre">{s.nombre}</div>
            <div className="le-sala-mesas">
              {s.mesas.map(({ m, st, cabe }) => (
                <button
                  key={m.id}
                  className={`le-mesa${st.libre ? " libre" : " ocupada"}${!cabe ? " nocabe" : ""}${confirmar === m.id ? " elegida" : ""}`}
                  disabled={ocupado || st.bloqueada}
                  title={st.bloqueada ? "Bloqueada" : st.libre ? "Libre" : `Ocupada hasta las ${st.libreA}: al elegirla se reserva a esa hora`}
                  onClick={() => elegir(m, st)}
                >
                  <b>{m.nombre}</b>
                  <small>{m.cap_min === m.cap_max ? `${m.cap_max}` : `${m.cap_min}-${m.cap_max}`} pax</small>
                  <small className="le-mesa-st">{st.bloqueada ? "bloqueada" : st.libre ? "libre" : `hasta ${st.libreA}`}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {elegida ? (
        <div className="le-panel-fila le-confirmar">
          {elegida.st.libre ? (
            <span>
              {verbo} a <b>{e.nombre}</b> en la mesa <b>{elegida.m.nombre}</b>{!esHoy ? ` el ${fechaTxt}` : ""} a las <b>{hora}</b>
              {horaLiberada === hora ? " (cuando se libera)" : ""}
            </span>
          ) : (
            <span>La mesa <b>{elegida.m.nombre}</b> sigue ocupada a las {hora}{elegida.st.libreA ? ` (hasta las ${elegida.st.libreA})` : ""}: elige otra o cambia la hora.</span>
          )}
          <button className="primaria" disabled={ocupado || !elegida.st.libre} onClick={() => sentar(elegida.m.id, hora, estado)}>Confirmar</button>
          <button onClick={() => setConfirmar(null)}>Cancelar</button>
        </div>
      ) : null}
    </div>
  );
}
