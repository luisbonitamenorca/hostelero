"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./acciones";
import { cerrarSesion } from "../acciones";
import type { Tables } from "@hostelero/db";

type Fichaje = Tables<"rrhh_fichajes">;
type Tab = "turnos" | "fichar" | "ausencias" | "horas";
const NT: Record<string, string> = { entrada: "Entrada", salida: "Salida", pausa_inicio: "Pausa ▶", pausa_fin: "Pausa ■" };

const hoyIso = () => new Date().toLocaleDateString("sv-SE");
const hora = (ts: string) => new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const fFecha = (iso: string) => new Date(iso + "T12:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" });

export default function EmpleadoApp({ empleado, centros }: {
  empleado: { id: string; nombre: string; fichajeMovil: boolean; centroPrincipal: string | null };
  centros: { id: string; nombre: string }[];
}) {
  const [tab, setTab] = useState<Tab>("turnos");
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avisar = useCallback((m: string) => {
    setToast(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const TABS: [Tab, string, string][] = [
    ["turnos", "📅", "Turnos"],
    ...(empleado.fichajeMovil ? ([["fichar", "⏱", "Fichar"]] as [Tab, string, string][]) : []),
    ["ausencias", "🌴", "Ausencias"],
    ["horas", "Σ", "Horas"],
  ];

  return (
    <div className="emp">
      <header className="cab">
        <div className="brand">Bonita Equipo</div>
        <div className="quien">{empleado.nombre}</div>
      </header>
      <main>
        {tab === "turnos" ? <TabTurnos /> : null}
        {tab === "fichar" && empleado.fichajeMovil ? <TabFichar centros={centros} centroPrincipal={empleado.centroPrincipal} avisar={avisar} /> : null}
        {tab === "ausencias" ? <TabAusencias avisar={avisar} /> : null}
        {tab === "horas" ? <TabHoras /> : null}
      </main>
      <nav className="tabbar">
        {TABS.map(([id, ico, nombre]) => (
          <button key={id} className={tab === id ? "activo" : ""} onClick={() => setTab(id)}>
            <span className="ico">{ico}</span>{nombre}
          </button>
        ))}
        <button onClick={() => cerrarSesion()}><span className="ico">↩</span>Salir</button>
      </nav>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

/* ---------- Mis turnos ---------- */
function TabTurnos() {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.misTurnos>> | null>(null);
  const hoy = hoyIso();
  const lunes = (() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toLocaleDateString("sv-SE");
  })();
  const suma = (iso: string, n: number) => {
    const d = new Date(iso + "T12:00");
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString("sv-SE");
  };

  useEffect(() => {
    api.misTurnos(lunes, suma(lunes, 13)).then(setDatos);
  }, [lunes]);

  if (!datos) return <div className="vacio">Cargando…</div>;
  const porDia: Record<string, typeof datos.turnos> = {};
  for (const t of datos.turnos) (porDia[t.fecha] = porDia[t.fecha] || []).push(t);

  const bloques: React.ReactNode[] = [];
  for (let i = 0; i < 14; i++) {
    const iso = suma(lunes, i);
    const esHoy = iso === hoy;
    if (i === 0) bloques.push(<h3 key="s1" className="dia-cab" style={{ fontSize: 15, color: "var(--tinta)" }}>Esta semana</h3>);
    if (i === 7) bloques.push(<h3 key="s2" className="dia-cab" style={{ fontSize: 15, color: "var(--tinta)", marginTop: 22 }}>Semana que viene</h3>);
    const label = new Date(iso + "T12:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" });
    bloques.push(<div key={"c" + iso} className={`dia-cab ${esHoy ? "hoy" : ""}`}>{label}{esHoy ? " · hoy" : ""}</div>);
    const aus = datos.ausencias.find((a) => a.fecha_inicio <= iso && a.fecha_fin >= iso);
    const dia = porDia[iso] || [];
    if (aus) bloques.push(<div key={"a" + iso} className="tarjeta"><span className="badge aus">{aus.tipo}</span></div>);
    else if (!dia.length) bloques.push(<div key={"l" + iso} className="libre">Libre</div>);
    else
      for (const t of dia)
        bloques.push(
          <div key={t.id} className="tarjeta">
            <div className="turno-linea">
              <div className="turno-hora">{t.hora_inicio.slice(0, 5)}–{t.hora_fin.slice(0, 5)}</div>
              <div className="turno-det">{t.centros?.nombre || ""}{t.puesto ? ` · ${t.puesto}` : ""}{t.pausa_min ? ` · ${t.pausa_min} min pausa` : ""}</div>
            </div>
          </div>,
        );
  }
  return <>{bloques}</>;
}

/* ---------- Fichar (móvil + geo) ---------- */
function TabFichar({ centros, centroPrincipal, avisar }: {
  centros: { id: string; nombre: string }[];
  centroPrincipal: string | null;
  avisar: (m: string) => void;
}) {
  const [centroId, setCentroId] = useState(centroPrincipal && centros.some((c) => c.id === centroPrincipal) ? centroPrincipal : centros[0]?.id ?? "");
  const [hoyF, setHoyF] = useState<Fichaje[] | null>(null);
  const [reloj, setReloj] = useState("");
  const [fecha, setFecha] = useState("");
  const [fichando, setFichando] = useState(false);

  const cargar = useCallback(() => {
    api.misFichajes(hoyIso() + "T00:00:00").then(setHoyF);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    const tic = () => {
      const n = new Date();
      setReloj(n.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }));
      setFecha(n.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }));
    };
    tic();
    const t = setInterval(tic, 5000);
    return () => clearInterval(t);
  }, []);

  const ult = hoyF?.at(-1);
  const estado = !ult ? (
    <>Aún no has fichado hoy</>
  ) : ult.tipo === "entrada" ? (
    <>Estás <b>dentro</b> desde las {hora(ult.ts)}</>
  ) : ult.tipo === "salida" ? (
    <>Saliste a las {hora(ult.ts)}</>
  ) : ult.tipo === "pausa_inicio" ? (
    <>En <b>pausa</b> desde las {hora(ult.ts)}</>
  ) : (
    <>Volviste de la pausa a las {hora(ult.ts)}</>
  );

  async function fichar(tipo: "entrada" | "salida" | "pausa_inicio" | "pausa_fin") {
    if (fichando) return;
    setFichando(true);
    let pos: GeolocationPosition;
    try {
      pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000 }),
      );
    } catch {
      avisar("Necesito tu ubicación para fichar. Activa el permiso e inténtalo de nuevo.");
      setFichando(false);
      return;
    }
    const r = await api.ficharMovil({ centroId, tipo, lat: pos.coords.latitude, lng: pos.coords.longitude });
    setFichando(false);
    if (!r.ok) { avisar("No se pudo fichar: " + r.error); return; }
    avisar(`${NT[tipo]} registrada` + (r.data?.dentro === false ? " (fuera del radio del centro: tu encargado lo revisará)" : ""));
    cargar();
  }

  return (
    <>
      <div className="tarjeta fichar-caja">
        <div className="reloj">{reloj}</div>
        <div className="fecha-hoy">{fecha}</div>
        <label style={{ textAlign: "left" }}>Centro</label>
        <select value={centroId} onChange={(e) => setCentroId(e.target.value)}>
          {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <div className="estado-actual" style={{ marginTop: 14 }}>{estado}</div>
        <div className="botones-fichar">
          <button className="b-entrada" disabled={fichando} onClick={() => fichar("entrada")}>Entrada</button>
          <button className="b-salida" disabled={fichando} onClick={() => fichar("salida")}>Salida</button>
          <button className="b-pausa" disabled={fichando} onClick={() => fichar("pausa_inicio")}>Empiezo pausa</button>
          <button className="b-pausa" disabled={fichando} onClick={() => fichar("pausa_fin")}>Vuelvo de pausa</button>
        </div>
        <div className="geo-nota">Al fichar se registra tu ubicación en ese momento (solo en ese momento, nunca después).</div>
      </div>
      <div className="tarjeta">
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Hoy</h3>
        <div>
          {hoyF?.length
            ? hoyF.map((f) => (
                <span key={f.id} className={`chipf ${f.metodo === "correccion" ? "correccion" : f.tipo}`}>
                  {NT[f.tipo]} {hora(f.ts)}
                </span>
              ))
            : <span className="libre">Sin fichajes.</span>}
        </div>
      </div>
    </>
  );
}

/* ---------- Ausencias ---------- */
function TabAusencias({ avisar }: { avisar: (m: string) => void }) {
  const [lista, setLista] = useState<Awaited<ReturnType<typeof api.misAusencias>> | null>(null);
  const [tipo, setTipo] = useState("vacaciones");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const hoy = hoyIso();

  const cargar = useCallback(() => { api.misAusencias().then(setLista); }, []);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <>
      <div className="tarjeta">
        <h3 style={{ fontSize: 14, marginBottom: 6 }}>Pedir ausencia</h3>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const r = await api.solicitarAusencia(tipo, desde, hasta);
          if (!r.ok) { avisar("No se pudo enviar: " + r.error); return; }
          avisar("Solicitud enviada a tu encargado");
          setDesde(""); setHasta("");
          cargar();
        }}>
          <label>Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="vacaciones">Vacaciones</option>
            <option value="permiso">Permiso</option>
            <option value="otro">Otro</option>
          </select>
          <div className="fila-2">
            <div><label>Desde</label><input type="date" required min={hoy} value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
            <div><label>Hasta</label><input type="date" required min={hoy} value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          </div>
          <button className="btn btn-primario" type="submit">Enviar solicitud</button>
        </form>
      </div>
      <div className="tarjeta">
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Mis solicitudes</h3>
        {lista === null ? (
          <div className="libre">Cargando…</div>
        ) : !lista.length ? (
          <div className="libre">Sin solicitudes.</div>
        ) : (
          lista.map((a) => (
            <div key={a.id} className="aus-linea">
              <div>
                <div className="aus-tipo">{a.tipo}</div>
                <div className="aus-fechas">{fFecha(a.fecha_inicio)} → {fFecha(a.fecha_fin)}</div>
              </div>
              <span className={`estado ${a.estado}`}>{a.estado}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

/* ---------- Mis horas ---------- */
function TabHoras() {
  const [fichs, setFichs] = useState<Fichaje[] | null>(null);
  useEffect(() => {
    const hoy = new Date();
    const desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    api.misFichajes(desde.toISOString()).then(setFichs);
  }, []);
  if (!fichs) return <div className="vacio">Cargando…</div>;

  const anulados = new Set(fichs.map((f) => f.corrige_a).filter(Boolean) as string[]);
  const efectivos = fichs.filter((f) => !anulados.has(f.id));
  const dias: Record<string, Fichaje[]> = {};
  for (const f of efectivos) {
    const d = new Date(f.ts).toLocaleDateString("sv-SE");
    (dias[d] = dias[d] || []).push(f);
  }
  let total = 0;
  const filas: React.ReactNode[] = [];
  for (const d of Object.keys(dias).sort().reverse()) {
    let neto = 0, abierto: number | null = null, pausa: number | null = null;
    for (const f of dias[d]) {
      const t = new Date(f.ts).getTime();
      if (f.tipo === "entrada") { abierto = t; pausa = null; }
      else if (f.tipo === "salida" && abierto !== null) { neto += t - abierto; abierto = null; pausa = null; }
      else if (f.tipo === "pausa_inicio" && abierto !== null) { pausa = t; }
      else if (f.tipo === "pausa_fin" && pausa !== null) { neto -= t - pausa; pausa = null; }
    }
    const horas = neto / 3600000;
    total += horas;
    const enCurso = abierto !== null && d === hoyIso();
    filas.push(
      <div key={d} className="dia-h">
        <span className="f">{new Date(d + "T12:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}</span>
        <span className="h">{horas.toFixed(2)} h</span>
        {enCurso ? <span className="badge aus" style={{ background: "var(--ok-f)", color: "var(--ok)" }}>en curso</span> : null}
      </div>,
    );
  }
  const mes = new Date().toLocaleDateString("es-ES", { month: "long" });
  return (
    <>
      <div className="tarjeta">
        <div className="total-mes">{total.toFixed(1)} h</div>
        <div className="total-sub">trabajadas en {mes} (con correcciones aplicadas)</div>
        {filas.length ? filas : <div className="libre">Sin fichajes este mes.</div>}
      </div>
      <div className="geo-nota" style={{ padding: "0 6px" }}>
        Si ves algo que no cuadra, díselo a tu encargado: puede corregirlo y quedará registrado con su motivo.
      </div>
    </>
  );
}
