"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./acciones";
import type { Ausencia, Cambio, Companero, Disponibilidad, Fichaje, Turno } from "./acciones";
import { cerrarSesion } from "../acciones";
import { calcularDia, efectivosDe, horasNetas, hoyIso, lunesDe, sumaDia } from "../rrhh/tipos";
import { colorTexto, fmtHoras, guardarPref, leerPref } from "../rrhh/lib-rrhh";

type Tab = "turnos" | "fichar" | "ausencias" | "horas" | "dias";
type Avisar = (m: string) => void;
type Centro = { id: string; nombre: string };

const NT: Record<string, string> = { entrada: "Entrada", salida: "Salida", pausa_inicio: "Pausa ▶", pausa_fin: "Pausa ■" };
const ESTADO_CAMBIO: Record<string, string> = {
  pendiente: "pendiente",
  aceptado_companero: "aceptado por tu compañero, falta el encargado",
  aprobado: "aprobado",
  rechazado: "rechazado",
  cancelado: "cancelado",
};
const DIAS_L = ["L", "M", "X", "J", "V", "S", "D"];
const MSG_CARGA = "No se pudo cargar. Revisa la conexión";

const hora = (ts: string) => new Date(ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const fechaLocal = (ts: string) => new Date(ts).toLocaleDateString("sv-SE");
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const diaLargo = (iso: string) => new Date(iso + "T12:00").toLocaleDateString("es-ES", { weekday: "long" }) + " " + ddmm(iso);
const hh = (t: { hora_inicio: string; hora_fin: string }) => `${t.hora_inicio.slice(0, 5)}–${t.hora_fin.slice(0, 5)}`;
const nombreDe = (p?: { nombre: string; apellidos: string | null } | null) => (p ? [p.nombre, p.apellidos].filter(Boolean).join(" ") : "");
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Horas del tramo abierto (desde la última entrada hasta ahora, o hasta el inicio de la pausa en curso).
 *  calcularDia ya ha restado las pausas cerradas de ese tramo, así que aquí solo va el bruto. */
function tramoAbierto(efs: Fichaje[]) {
  let ab: number | null = null;
  let pa: number | null = null;
  for (const f of efs) {
    const t = new Date(f.ts).getTime();
    if (f.tipo === "entrada") { ab = t; pa = null; }
    else if (f.tipo === "salida") { ab = null; pa = null; }
    else if (f.tipo === "pausa_inicio") { if (ab !== null && pa === null) pa = t; }
    else if (f.tipo === "pausa_fin") pa = null;
  }
  return ab === null ? 0 : ((pa ?? Date.now()) - ab) / 3600000;
}

type Jornada = { fecha: string; fichajes: Fichaje[]; cerrada: boolean };

/** Agrupa los fichajes efectivos (en orden) por jornada: cada «entrada» abre una y se atribuye al día de esa
 *  entrada, aunque la salida sea de madrugada. Lo que llega sin jornada abierta forma una jornada suelta
 *  (calcularDia la marca como «salida sin entrada», igual que el panel). */
function jornadasDe(efs: Fichaje[]): Jornada[] {
  const js: Jornada[] = [];
  for (const f of efs) {
    const ult = js[js.length - 1];
    if (f.tipo === "entrada" || !ult || ult.cerrada) js.push({ fecha: fechaLocal(f.ts), fichajes: [f], cerrada: f.tipo === "salida" });
    else { ult.fichajes.push(f); if (f.tipo === "salida") ult.cerrada = true; }
  }
  return js;
}

type DiaFichado = { horas: number; enCurso: boolean; fichajes: Fichaje[] };

/**
 * Horas fichadas por día (por jornada, no por día natural: un turno 18:00–02:00 cuenta entero el día de la
 * entrada) y resumen de «hoy». Se usa igual en Fichar y en Horas para que los totales cuadren.
 * La jornada en curso (última, sin salida, de hoy o de ayer) incluye el tramo abierto hasta ahora.
 * `desdeFecha`: las jornadas anteriores (cargadas por si una cruzaba medianoche) no entran en el mes.
 */
function resumenFichajes(fs: Fichaje[], hoy: string, desdeFecha: string) {
  const { efectivos } = efectivosDe(fs);
  const jornadas = jornadasDe(efectivos);
  const ayer = sumaDia(hoy, -1);
  const porDia = new Map<string, DiaFichado>();
  const deHoy: DiaFichado = { horas: 0, enCurso: false, fichajes: [] };
  jornadas.forEach((j, i) => {
    const puedeEnCurso = i === jornadas.length - 1 && !j.cerrada && (j.fecha === hoy || j.fecha === ayer);
    const r = calcularDia(j.fichajes, puedeEnCurso);
    const horas = r.horas + (r.enCurso ? tramoAbierto(j.fichajes) : 0);
    if (j.fecha === hoy || r.enCurso) {
      deHoy.horas += horas;
      deHoy.enCurso = deHoy.enCurso || r.enCurso;
      deHoy.fichajes.push(...j.fichajes);
    }
    if (j.fecha < desdeFecha) return;
    const d = porDia.get(j.fecha) ?? { horas: 0, enCurso: false, fichajes: [] };
    d.horas += horas;
    d.enCurso = d.enCurso || r.enCurso;
    d.fichajes.push(...j.fichajes);
    porDia.set(j.fecha, d);
  });
  let total = 0;
  for (const d of porDia.values()) total += d.horas;
  return { porDia, total, hoy: deHoy };
}

/** Rango de fichajes del mes: desde el día anterior al 1 (por si una jornada cruzaba medianoche). */
function rangoMesFichajes(hoy: string) {
  const desdeFecha = hoy.slice(0, 7) + "-01";
  return { desdeFecha, desdeTs: new Date(sumaDia(desdeFecha, -1) + "T00:00").toISOString() };
}

/* ---------- Chip de puesto (color del catálogo; si no hay, gris) ---------- */
function ChipPuesto({ t }: { t: Turno }) {
  const nombre = t.rrhh_puestos_cat?.nombre || t.puesto;
  if (!nombre) return null;
  const bg = t.color || t.rrhh_puestos_cat?.color || "#888888";
  return (
    <span className="puesto" style={{ background: bg, color: colorTexto(bg) }}>
      {nombre}
    </span>
  );
}

/* ---------- Fallo de carga con reintento ---------- */
function FalloCarga({ reintentar }: { reintentar: () => void }) {
  return (
    <div className="tarjeta fallo">
      <div>No se pudo cargar. Revisa la conexión.</div>
      <button className="btn btn-sec" onClick={reintentar}>Reintentar</button>
    </div>
  );
}

/* ---------- Modal (hoja inferior): Escape cierra y el fondo no se desplaza ---------- */
function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    document.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [onCerrar]);
  return (
    <div className="velo" onClick={onCerrar}>
      <div className="hoja" role="dialog" aria-label={titulo} onClick={(e) => e.stopPropagation()}>
        <div className="hoja-cab">
          <h3>{titulo}</h3>
          <button className="cerrar" aria-label="Cerrar" onClick={onCerrar}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Centro elegido para fichar, recordado en el móvil ('rrhh:emp.centro'; clave distinta de la del panel). */
function useCentroFichaje(centros: Centro[], centroPrincipal: string | null): [string, (id: string) => void] {
  const [centroId, setCentro] = useState<string>(() => {
    const guardado = leerPref<string>("emp.centro", "");
    if (centros.some((c) => c.id === guardado)) return guardado;
    if (centroPrincipal && centros.some((c) => c.id === centroPrincipal)) return centroPrincipal;
    return centros[0]?.id ?? "";
  });
  const setCentroId = useCallback((id: string) => {
    setCentro(id);
    guardarPref("emp.centro", id);
  }, []);
  return [centroId, setCentroId];
}

export default function EmpleadoApp({ empleado, centros }: {
  empleado: { id: string; nombre: string; fichajeMovil: boolean; centroPrincipal: string | null };
  centros: Centro[];
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
    ["dias", "✓", "Días"],
  ];

  return (
    <div className="emp">
      <header className="cab">
        <div className="brand">Bonita Equipo</div>
        <div className="quien">{empleado.nombre}</div>
        <button className="salir" onClick={() => cerrarSesion()} aria-label="Salir">↩</button>
      </header>
      <main>
        {tab === "turnos" ? <TabTurnos empleadoId={empleado.id} centros={centros} avisar={avisar} /> : null}
        {tab === "fichar" && empleado.fichajeMovil ? <TabFichar centros={centros} centroPrincipal={empleado.centroPrincipal} avisar={avisar} /> : null}
        {tab === "ausencias" ? <TabAusencias avisar={avisar} /> : null}
        {tab === "horas" ? <TabHoras avisar={avisar} /> : null}
        {tab === "dias" ? <TabDias avisar={avisar} /> : null}
      </main>
      <nav className="tabbar">
        {TABS.map(([id, ico, nombre]) => (
          <button key={id} className={tab === id ? "activo" : ""} onClick={() => setTab(id)}>
            <span className="ico">{ico}</span>{nombre}
          </button>
        ))}
      </nav>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

/* ==================== Mis turnos ==================== */
function TabTurnos({ empleadoId, centros, avisar }: { empleadoId: string; centros: Centro[]; avisar: Avisar }) {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.misTurnos>> | null>(null);
  const [huecos, setHuecos] = useState<Turno[]>([]);
  const [cambios, setCambios] = useState<Cambio[]>([]);
  const [fallo, setFallo] = useState(false);
  const [offset, setOffset] = useState(0);
  const [pedir, setPedir] = useState<Turno | null>(null);
  const [apuntar, setApuntar] = useState<Turno | null>(null);
  const [anular, setAnular] = useState<Cambio | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const hoy = hoyIso();
  const lunes = sumaDia(lunesDe(hoy), offset * 7);
  const misCentros = useMemo(() => new Set(centros.map((c) => c.id)), [centros]);

  const cargar = useCallback(() => {
    setFallo(false);
    Promise.all([api.misTurnos(lunes, sumaDia(lunes, 13)), api.huecos(), api.misCambios()])
      .then(([d, h, c]) => {
        setDatos(d);
        setHuecos(h);
        setCambios(c);
      })
      .catch(() => { setFallo(true); avisar(MSG_CARGA); });
  }, [lunes, avisar]);
  useEffect(() => { setDatos(null); cargar(); }, [cargar]);

  if (fallo) return <FalloCarga reintentar={cargar} />;
  if (!datos) return <div className="vacio">Cargando…</div>;

  // Una sola lectura de cambios: los míos (solicitante) y los que me piden (destinatario).
  const mios = cambios.filter((c) => c.solicitante_id === empleadoId && (c.estado === "pendiente" || c.estado === "aceptado_companero"));
  const recibidos = cambios.filter((c) => c.destinatario_id === empleadoId && c.solicitante_id !== empleadoId && c.estado === "pendiente");
  const porDia: Record<string, Turno[]> = {};
  for (const t of datos.turnos) (porDia[t.fecha] = porDia[t.fecha] || []).push(t);
  const festivoDe = (iso: string) => datos.festivos.find((f) => f.fecha === iso && (f.ambito !== "local" || (f.centro_id != null && misCentros.has(f.centro_id))));
  const cambioDe = (turnoId: string) => mios.find((c) => c.turno_id === turnoId);
  const ahoraHM = new Date().toTimeString().slice(0, 5);
  const esFuturo = (t: Turno) => t.fecha > hoy || (t.fecha === hoy && t.hora_inicio.slice(0, 5) > ahoraHM);

  async function responder(c: Cambio, estado: "aceptado_companero" | "rechazado" | "cancelado") {
    if (ocupado) return;
    setOcupado(true);
    const r = await api.responderCambio(c.id, estado);
    setOcupado(false);
    setAnular(null);
    if (!r.ok) { avisar("No se pudo: " + r.error); cargar(); return; }
    avisar(estado === "aceptado_companero" ? "Aceptado. Ahora lo revisa el encargado" : estado === "rechazado" ? "Petición rechazada" : "Petición anulada");
    cargar();
  }

  async function apuntarme(t: Turno) {
    if (ocupado) return;
    setOcupado(true);
    const r = await api.apuntarmeHueco(t.id);
    setOcupado(false);
    setApuntar(null);
    if (!r.ok) { avisar(r.error || "No se pudo"); cargar(); return; }
    avisar(`Turno del ${ddmm(t.fecha)} apuntado. Ya es tuyo.`);
    cargar();
  }

  const bloques: React.ReactNode[] = [];
  for (let i = 0; i < 14; i++) {
    const iso = sumaDia(lunes, i);
    const esHoy = iso === hoy;
    if (i === 0) bloques.push(<h3 key="s1" className="dia-cab titulo">{offset === 0 ? "Esta semana" : `Semana del ${ddmm(iso)}`}</h3>);
    if (i === 7) bloques.push(<h3 key="s2" className="dia-cab titulo" style={{ marginTop: 22 }}>{offset === 0 ? "Semana que viene" : `Semana del ${ddmm(iso)}`}</h3>);
    const fest = festivoDe(iso);
    bloques.push(
      <div key={"c" + iso} className={`dia-cab ${esHoy ? "hoy" : ""} ${fest ? "festivo" : ""}`}>
        {diaLargo(iso)}{esHoy ? " · hoy" : ""}
        {fest ? <span className="badge fest">festivo · {fest.nombre}</span> : null}
      </div>,
    );
    const aus = datos.ausencias.find((a) => a.fecha_inicio <= iso && a.fecha_fin >= iso);
    const dia = porDia[iso] || [];
    if (aus) {
      const nombre = aus.rrhh_tipos_ausencia?.nombre || aus.tipo;
      const bg = aus.rrhh_tipos_ausencia?.color || "#888888";
      bloques.push(
        <div key={"a" + iso} className="tarjeta">
          <span className="puesto" style={{ background: bg, color: colorTexto(bg) }}>{nombre}</span>
          {aus.medio_dia ? <span className="turno-det"> · medio día</span> : null}
        </div>,
      );
    }
    if (!aus && !dia.length) bloques.push(<div key={"l" + iso} className="libre">Libre</div>);
    for (const t of dia) {
      const cambio = cambioDe(t.id);
      bloques.push(
        <div key={t.id} className="tarjeta turno">
          <div className="turno-linea">
            <div className="turno-hora">{hh(t)}</div>
            <div className="turno-det">
              <ChipPuesto t={t} />
              <span>{t.centros?.nombre || ""}{t.pausa_min ? ` · ${t.pausa_min} min pausa` : ""} · {fmtHoras(horasNetas(t))}</span>
            </div>
          </div>
          {t.nota ? <div className="nota">{t.nota}</div> : null}
          {cambio ? (
            <div className="cambio-estado">
              <span className={`estado ${cambio.estado}`}>
                cambio {cambio.destinatario ? `a ${nombreDe(cambio.destinatario)}` : "abierto"} · {ESTADO_CAMBIO[cambio.estado] || cambio.estado}
              </span>
              <button className="enlace" disabled={ocupado} onClick={() => setAnular(cambio)}>Anular</button>
            </div>
          ) : esFuturo(t) ? (
            <div className="cambio-estado">
              <span />
              <button className="enlace" onClick={() => setPedir(t)}>Pedir cambio</button>
            </div>
          ) : null}
        </div>,
      );
    }
  }

  return (
    <>
      {recibidos.length ? (
        <div className="tarjeta aviso-cambio">
          <h3>Te piden un cambio</h3>
          {recibidos.map((c) => (
            <div key={c.id} className="peticion">
              <div>
                <b>{nombreDe(c.solicitante) || "Un compañero"}</b> te pide que cubras{" "}
                {c.rrhh_turnos ? (
                  <>su turno del <b>{diaLargo(c.rrhh_turnos.fecha)}</b>, {hh(c.rrhh_turnos)}{c.rrhh_turnos.centros?.nombre ? ` en ${c.rrhh_turnos.centros.nombre}` : ""}{c.rrhh_turnos.puesto ? ` (${c.rrhh_turnos.puesto})` : ""}</>
                ) : (
                  <>un turno suyo (el detalle te lo confirma tu encargado)</>
                )}
                {c.nota ? <div className="nota">«{c.nota}»</div> : null}
              </div>
              <div className="fila-2">
                <button className="btn btn-primario" disabled={ocupado} onClick={() => responder(c, "aceptado_companero")}>Acepto</button>
                <button className="btn btn-sec" disabled={ocupado} onClick={() => responder(c, "rechazado")}>No puedo</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {huecos.length ? (
        <div className="tarjeta huecos">
          <h3>Huecos para cubrir</h3>
          <div className="turno-det" style={{ marginBottom: 6 }}>Turnos sin asignar en tus centros. Si te apuntas, el turno pasa a ser tuyo.</div>
          {huecos.map((t) => (
            <div key={t.id} className="hueco">
              <div>
                <div className="turno-hora">{diaLargo(t.fecha)} · {hh(t)}</div>
                <div className="turno-det"><ChipPuesto t={t} /><span>{t.centros?.nombre || ""} · {fmtHoras(horasNetas(t))}</span></div>
              </div>
              <button className="btn btn-primario chico" onClick={() => setApuntar(t)}>Apuntarme</button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="turnos-nav">
        <button className="nav-btn" aria-label="Semana anterior" onClick={() => setOffset((o) => o - 1)}>‹</button>
        <span className="nav-rango">
          {ddmm(lunes)}–{ddmm(sumaDia(lunes, 13))}
          {offset !== 0 ? <button className="enlace" onClick={() => setOffset(0)}>Hoy</button> : null}
        </span>
        <button className="nav-btn" aria-label="Semana siguiente" onClick={() => setOffset((o) => o + 1)}>›</button>
      </div>

      {bloques}

      {pedir ? <ModalPedirCambio turno={pedir} centros={centros} onCerrar={() => setPedir(null)} onHecho={() => { setPedir(null); cargar(); }} avisar={avisar} /> : null}
      {apuntar ? (
        <Modal titulo="Apuntarme a este turno" onCerrar={() => setApuntar(null)}>
          <p><b>{diaLargo(apuntar.fecha)}</b>, {hh(apuntar)} en {apuntar.centros?.nombre || "tu centro"}{apuntar.puesto ? ` · ${apuntar.puesto}` : ""}.</p>
          <p className="turno-det">Al apuntarte, el turno queda asignado a tu nombre y tu encargado lo ve en el cuadrante.</p>
          <div className="fila-2">
            <button className="btn btn-sec" onClick={() => setApuntar(null)}>Atrás</button>
            <button className="btn btn-primario" disabled={ocupado} onClick={() => apuntarme(apuntar)}>Sí, me apunto</button>
          </div>
        </Modal>
      ) : null}
      {anular ? (
        <Modal titulo="Anular petición de cambio" onCerrar={() => setAnular(null)}>
          <p>
            ¿Anulas la petición de cambio{anular.rrhh_turnos ? <> del <b>{ddmm(anular.rrhh_turnos.fecha)}</b>, {hh(anular.rrhh_turnos)}</> : null}?
            {anular.estado === "aceptado_companero" ? " Tu compañero ya la había aceptado." : ""}
          </p>
          <div className="fila-2">
            <button className="btn btn-sec" onClick={() => setAnular(null)}>Atrás</button>
            <button className="btn btn-peligro" disabled={ocupado} onClick={() => responder(anular, "cancelado")}>Sí, anular</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function ModalPedirCambio({ turno, centros, onCerrar, onHecho, avisar }: { turno: Turno; centros: Centro[]; onCerrar: () => void; onHecho: () => void; avisar: Avisar }) {
  const [companeros, setCompaneros] = useState<Companero[] | null>(null);
  const [destino, setDestino] = useState<string>("");
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    // Si no se pueden cargar, se puede seguir dejando la petición abierta.
    api.companeros().then(setCompaneros).catch(() => { setCompaneros([]); avisar(MSG_CARGA); });
  }, [avisar]);

  // Agrupados por centro (en el orden de mis centros); si solo hay uno, lista plana.
  const grupos = useMemo(() => {
    if (!companeros) return [];
    const porCentro = new Map<string, Companero[]>();
    for (const c of companeros) (porCentro.get(c.centro_id) ?? porCentro.set(c.centro_id, []).get(c.centro_id)!).push(c);
    const orden = [...centros.map((c) => c.id), ...[...porCentro.keys()].filter((id) => !centros.some((c) => c.id === id))];
    return orden.filter((id) => porCentro.has(id)).map((id) => ({ id, nombre: centros.find((c) => c.id === id)?.nombre || "Otro centro", lista: porCentro.get(id)! }));
  }, [companeros, centros]);
  const opcion = (c: Companero) => <option key={`${c.centro_id}-${c.id}`} value={c.id}>{nombreDe(c)}</option>;

  async function enviar() {
    if (enviando) return;
    setEnviando(true);
    const r = await api.pedirCambio(turno.id, destino || null, nota);
    setEnviando(false);
    if (!r.ok) { avisar("No se pudo enviar: " + r.error); return; }
    avisar(destino ? "Petición enviada a tu compañero" : "Petición abierta: tu encargado la verá");
    onHecho();
  }

  return (
    <Modal titulo="Pedir cambio de turno" onCerrar={onCerrar}>
      <p><b>{diaLargo(turno.fecha)}</b>, {hh(turno)}{turno.centros?.nombre ? ` en ${turno.centros.nombre}` : ""}.</p>
      <label>¿A quién se lo pides?</label>
      {companeros === null ? (
        <div className="libre">Cargando compañeros…</div>
      ) : (
        <select value={destino} onChange={(e) => setDestino(e.target.value)}>
          <option value="">Dejarlo abierto (quien pueda)</option>
          {grupos.length > 1
            ? grupos.map((g) => <optgroup key={g.id} label={g.nombre}>{g.lista.map(opcion)}</optgroup>)
            : grupos[0]?.lista.map(opcion)}
        </select>
      )}
      {companeros !== null && !companeros.length ? (
        <div className="geo-nota">Por ahora solo puedes dejarlo abierto: tu encargado buscará quién lo cubre.</div>
      ) : null}
      <label>Nota (opcional)</label>
      <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: tengo médico esa tarde" />
      <div className="geo-nota">El cambio solo vale cuando lo aprueba tu encargado. Hasta entonces el turno sigue siendo tuyo.</div>
      <button className="btn btn-primario" disabled={enviando || companeros === null} onClick={enviar}>Enviar petición</button>
    </Modal>
  );
}

/* ==================== Fichar (móvil + geo) ==================== */
function TabFichar({ centros, centroPrincipal, avisar }: { centros: Centro[]; centroPrincipal: string | null; avisar: Avisar }) {
  const [centroId, setCentroId] = useCentroFichaje(centros, centroPrincipal);
  const [mesF, setMesF] = useState<Fichaje[] | null>(null);
  const [contrato, setContrato] = useState<{ semana: number | null; mes: number | null }>({ semana: null, mes: null });
  const [fallo, setFallo] = useState(false);
  const [reloj, setReloj] = useState("");
  const [fecha, setFecha] = useState("");
  const [fichando, setFichando] = useState(false);
  const hoy = hoyIso();
  const { desdeFecha, desdeTs } = rangoMesFichajes(hoy);

  const cargar = useCallback(() => {
    setFallo(false);
    Promise.all([api.misFichajes(desdeTs), api.miContrato(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)))])
      .then(([f, c]) => { setMesF(f); setContrato(c); })
      .catch(() => { setFallo(true); avisar(MSG_CARGA); });
  }, [desdeTs, hoy, avisar]);
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

  if (fallo) return <FalloCarga reintentar={cargar} />;

  const res = resumenFichajes(mesF ?? [], hoy, desdeFecha);
  const hoyF = res.hoy.fichajes;
  const ult = hoyF.at(-1);
  const estado = !mesF ? (
    <>Cargando…</>
  ) : !ult ? (
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
  const contratoMes = contrato.mes;
  const sinCentro = !centros.length || !centroId;

  async function fichar(tipo: "entrada" | "salida" | "pausa_inicio" | "pausa_fin") {
    if (fichando || sinCentro) return;
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
    avisar(
      `${NT[tipo]} registrada` +
        (r.data?.sinUbicacion ? " (tu centro no tiene ubicación configurada: no se comprueba el radio)" : r.data?.dentro === false ? " (fuera del radio del centro: tu encargado lo revisará)" : ""),
    );
    cargar();
  }

  return (
    <>
      <div className="tarjeta fichar-caja">
        <div className="reloj">{reloj}</div>
        <div className="fecha-hoy">{fecha}</div>
        {centros.length ? (
          <>
            <label style={{ textAlign: "left" }}>Centro</label>
            <select value={centroId} onChange={(e) => setCentroId(e.target.value)}>
              {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </>
        ) : (
          <div className="geo-nota" style={{ textAlign: "left" }}>No tienes ningún centro asignado. Habla con tu encargado para poder fichar.</div>
        )}
        <div className="estado-actual" style={{ marginTop: 14 }}>{estado}</div>
        <div className="botones-fichar">
          <button className="b-entrada" disabled={fichando || sinCentro} onClick={() => fichar("entrada")}>Entrada</button>
          <button className="b-salida" disabled={fichando || sinCentro} onClick={() => fichar("salida")}>Salida</button>
          <button className="b-pausa" disabled={fichando || sinCentro} onClick={() => fichar("pausa_inicio")}>Empiezo pausa</button>
          <button className="b-pausa" disabled={fichando || sinCentro} onClick={() => fichar("pausa_fin")}>Vuelvo de pausa</button>
        </div>
        <div className="geo-nota">Al fichar se registra tu ubicación en ese momento (solo en ese momento, nunca después).</div>
      </div>
      <div className="tarjeta resumen-h">
        <div className="kpi">
          <div className="n">{fmtHoras(r1(res.hoy.horas))}</div>
          <div className="t">hoy llevas{res.hoy.enCurso ? " (en curso)" : ""}</div>
        </div>
        <div className="kpi">
          <div className="n">{fmtHoras(r1(res.total))}</div>
          <div className="t">este mes{contratoMes != null ? ` de ${fmtHoras(contratoMes)} de contrato` : ""}</div>
        </div>
        {contrato.semana != null ? (
          <div className="geo-nota" style={{ gridColumn: "1 / -1", marginTop: 4 }}>
            Contrato: {fmtHoras(contrato.semana)} a la semana{contratoMes != null ? ` (${fmtHoras(contratoMes)} este mes, con el mismo cálculo que la nómina)` : ""}.
          </div>
        ) : null}
      </div>
      <div className="tarjeta">
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Hoy</h3>
        <div>
          {hoyF.length
            ? hoyF.map((f) => (
                <span key={f.id} className={`chipf ${f.metodo === "correccion" ? "correccion" : f.tipo}`}>
                  {NT[f.tipo]} {hora(f.ts)}{fechaLocal(f.ts) !== hoy ? ` (${ddmm(fechaLocal(f.ts))})` : ""}
                </span>
              ))
            : <span className="libre">Sin fichajes.</span>}
        </div>
      </div>
    </>
  );
}

/* ==================== Ausencias ==================== */
function TabAusencias({ avisar }: { avisar: Avisar }) {
  const [lista, setLista] = useState<Ausencia[] | null>(null);
  const [tipos, setTipos] = useState<Awaited<ReturnType<typeof api.tiposAusencia>>>([]);
  const [saldo, setSaldo] = useState<Awaited<ReturnType<typeof api.saldoVacaciones>>>(null);
  const [fallo, setFallo] = useState(false);
  const [tipoId, setTipoId] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [medioDia, setMedioDia] = useState(false);
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [cancelar, setCancelar] = useState<Ausencia | null>(null);
  const hoy = hoyIso();
  const anio = Number(hoy.slice(0, 4));
  // Se pueden comunicar ausencias ya pasadas (fuerza mayor, hospitalización…): hasta 31 días atrás.
  const minDesde = sumaDia(hoy, -31);

  const cargar = useCallback(() => {
    setFallo(false);
    Promise.all([api.misAusencias(), api.tiposAusencia(), api.saldoVacaciones(anio)])
      .then(([l, t, s]) => {
        setLista(l);
        setTipos(t);
        setSaldo(s);
        setTipoId((v) => v || t[0]?.id || "");
      })
      .catch(() => { setFallo(true); avisar(MSG_CARGA); });
  }, [anio, avisar]);
  useEffect(() => { cargar(); }, [cargar]);

  const tipoSel = tipos.find((t) => t.id === tipoId);
  const unDia = !!desde && desde === hasta;
  const fmtD = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    const r = await api.solicitarAusencia({ tipoId, desde, hasta, medioDia: medioDia && unDia, nota });
    setEnviando(false);
    if (!r.ok) { avisar("No se pudo enviar: " + r.error); return; }
    avisar("Solicitud enviada a tu encargado");
    setDesde(""); setHasta(""); setMedioDia(false); setNota("");
    cargar();
  }

  async function confirmarCancelar(a: Ausencia) {
    const r = await api.cancelarAusencia(a.id);
    setCancelar(null);
    if (!r.ok) { avisar(r.error || "No se pudo cancelar"); cargar(); return; }
    avisar("Solicitud cancelada");
    cargar();
  }

  if (fallo) return <FalloCarga reintentar={cargar} />;

  return (
    <>
      {saldo ? (
        <div className="tarjeta vac">
          <div className="kpi">
            <div className={`n ${saldo.resto < 0 ? "neg" : ""}`}>{fmtD(saldo.resto)}</div>
            <div className="t">{saldo.resto < 0 ? `días de vacaciones de más en ${anio} (has disfrutado más de los que te corresponden)` : `días de vacaciones te quedan en ${anio}`}</div>
          </div>
          <div className="vac-det">
            <span>Derecho anual <b>{fmtD(saldo.derecho_anual)}</b></span>
            <span>Devengados a hoy <b>{fmtD(saldo.devengado_hoy)}</b></span>
            <span>Disfrutados <b>{fmtD(saldo.disfrutados)}</b></span>
            <span>Pendientes de aprobar <b>{fmtD(saldo.pendientes_aprobar)}</b></span>
          </div>
        </div>
      ) : null}

      <div className="tarjeta">
        <h3 style={{ fontSize: 14, marginBottom: 6 }}>Pedir ausencia</h3>
        <form onSubmit={enviar}>
          <label>Tipo</label>
          <select value={tipoId} onChange={(e) => setTipoId(e.target.value)} required>
            {!tipos.length ? <option value="">Cargando…</option> : null}
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
          {tipoSel?.requiere_justificante ? <div className="geo-nota">Este tipo necesita justificante: entrégaselo a tu encargado.</div> : null}
          <div className="fila-2">
            <div><label>Desde</label><input type="date" required min={minDesde} value={desde} onChange={(e) => { setDesde(e.target.value); if (!hasta || hasta < e.target.value) setHasta(e.target.value); }} /></div>
            <div><label>Hasta</label><input type="date" required min={desde || minDesde} value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
          </div>
          <label className="check">
            <input type="checkbox" checked={medioDia && unDia} disabled={!unDia} onChange={(e) => setMedioDia(e.target.checked)} />
            Solo medio día{unDia ? "" : " (elige un único día)"}
          </label>
          <label>Nota (opcional)</label>
          <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Cuéntale a tu encargado lo que necesite saber" />
          <button className="btn btn-primario" type="submit" disabled={enviando || !tipoId}>Enviar solicitud</button>
        </form>
      </div>

      <div className="tarjeta">
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Mis solicitudes</h3>
        {lista === null ? (
          <div className="libre">Cargando…</div>
        ) : !lista.length ? (
          <div className="libre">Sin solicitudes.</div>
        ) : (
          lista.map((a) => {
            const bg = a.rrhh_tipos_ausencia?.color || "#888888";
            return (
              <div key={a.id} className="aus-linea">
                <div>
                  <div className="aus-tipo">
                    <span className="punto" style={{ background: bg }} />
                    {a.rrhh_tipos_ausencia?.nombre || a.tipo}
                  </div>
                  <div className="aus-fechas">
                    {a.fecha_inicio === a.fecha_fin ? ddmm(a.fecha_inicio) : `${ddmm(a.fecha_inicio)} → ${ddmm(a.fecha_fin)}`}
                    {a.medio_dia ? " · medio día" : ""}
                    {a.horas != null ? ` · ${fmtHoras(a.horas)}` : ""}
                  </div>
                  {a.estado === "rechazada" && a.motivo_rechazo ? <div className="nota">Motivo: {a.motivo_rechazo}</div> : null}
                </div>
                <div className="aus-acc">
                  <span className={`estado ${a.estado}`}>{a.estado}</span>
                  {a.estado === "solicitada" ? <button className="enlace" onClick={() => setCancelar(a)}>Cancelar</button> : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {cancelar ? (
        <Modal titulo="Cancelar solicitud" onCerrar={() => setCancelar(null)}>
          <p>¿Retiras la solicitud de <b>{cancelar.rrhh_tipos_ausencia?.nombre || cancelar.tipo}</b> del {ddmm(cancelar.fecha_inicio)}{cancelar.fecha_fin !== cancelar.fecha_inicio ? ` al ${ddmm(cancelar.fecha_fin)}` : ""}?</p>
          <div className="fila-2">
            <button className="btn btn-sec" onClick={() => setCancelar(null)}>Atrás</button>
            <button className="btn btn-peligro" onClick={() => confirmarCancelar(cancelar)}>Sí, cancelar</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/* ==================== Mis horas (contador y semanas) ==================== */
function TabHoras({ avisar }: { avisar: Avisar }) {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.misHoras>> | null>(null);
  const [fichs, setFichs] = useState<Fichaje[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const hoy = hoyIso();
  const lunesActual = lunesDe(hoy);
  const { desdeFecha, desdeTs } = rangoMesFichajes(hoy);

  const cargar = useCallback(() => {
    setFallo(false);
    Promise.all([api.misHoras(sumaDia(lunesActual, -7 * 7), sumaDia(lunesActual, 6)), api.misFichajes(desdeTs)])
      .then(([h, f]) => { setDatos(h); setFichs(f); })
      .catch(() => { setFallo(true); avisar(MSG_CARGA); });
  }, [lunesActual, desdeTs, avisar]);
  useEffect(() => { cargar(); }, [cargar]);

  if (fallo) return <FalloCarga reintentar={cargar} />;
  if (!datos || !fichs) return <div className="vacio">Cargando…</div>;

  const signo = (n: number) => (n > 0 ? "+" : "") + fmtHoras(Math.round(n * 100) / 100);

  // Fichajes del mes por jornada (mismo cálculo que en Fichar: la jornada en curso cuenta hasta ahora)
  const res = resumenFichajes(fichs, hoy, desdeFecha);
  const filas: React.ReactNode[] = [];
  for (const d of [...res.porDia.keys()].sort().reverse()) {
    const r = res.porDia.get(d)!;
    filas.push(
      <div key={d} className="dia-h">
        <span className="f">{diaLargo(d)}</span>
        <span className="h">{fmtHoras(Math.round(r.horas * 100) / 100)}</span>
        {r.enCurso ? <span className="badge aus" style={{ background: "var(--ok-f)", color: "var(--ok)" }}>en curso</span> : null}
      </div>,
    );
  }
  const mes = new Date().toLocaleDateString("es-ES", { month: "long" });

  return (
    <>
      <div className="tarjeta">
        <div className={`total-mes ${datos.saldo != null && datos.saldo < 0 ? "neg" : ""}`}>{datos.saldo == null ? "—" : signo(datos.saldo)}</div>
        <div className="total-sub">saldo de tu contador de horas a {ddmm(hoy)}</div>
        <div className="geo-nota">
          El contador suma, semana a semana, lo que has hecho (turnos publicados o validados, más ausencias que cuentan) menos tus horas de contrato.
          En positivo te deben horas; en negativo las debes tú.
        </div>
      </div>

      <div className="tarjeta">
        <h3 style={{ fontSize: 14, marginBottom: 8 }}>Últimas semanas</h3>
        {datos.origen === "cliente" ? <div className="geo-nota" style={{ marginTop: 0, marginBottom: 8 }}>Cálculo aproximado con tus turnos publicados y tu contrato (sin ausencias ni validaciones).</div> : null}
        {!datos.semanas.length ? (
          <div className="libre">Sin semanas con datos.</div>
        ) : (
          datos.semanas.map((s) => (
            <div key={s.lunes} className={`sem ${s.lunes === lunesActual ? "actual" : ""}`}>
              <div className="sem-cab">
                <b>Semana {s.semana}</b> · {ddmm(s.lunes)}–{ddmm(sumaDia(s.lunes, 6))}{s.lunes === lunesActual ? " · esta" : ""}
                <span className={`dif ${s.diferencia < 0 ? "neg" : s.diferencia > 0 ? "pos" : ""}`}>{signo(s.diferencia)}</span>
              </div>
              <div className="sem-det">
                <span>Contrato <b>{fmtHoras(s.horas_contrato)}</b></span>
                <span>Realizadas <b>{fmtHoras(s.horas_retenidas)}</b></span>
                {s.horas_ausencia_contador ? <span>Ausencias <b>{fmtHoras(s.horas_ausencia_contador)}</b></span> : null}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="tarjeta">
        <h3 style={{ fontSize: 14, marginBottom: 2 }}>Fichajes de {mes}</h3>
        <div className="total-sub">{fmtHoras(r1(res.total))} fichadas (con correcciones aplicadas{res.hoy.enCurso ? " y la jornada en curso" : ""})</div>
        {filas.length ? filas : <div className="libre">Sin fichajes este mes.</div>}
      </div>
      <div className="geo-nota" style={{ padding: "0 6px" }}>
        Si ves algo que no cuadra, díselo a tu encargado: puede corregirlo y quedará registrado con su motivo.
      </div>
    </>
  );
}

/* ==================== Disponibilidades (4 semanas) ==================== */
function TabDias({ avisar }: { avisar: Avisar }) {
  const [marcas, setMarcas] = useState<Record<string, Disponibilidad["tipo"]> | null>(null);
  const [fallo, setFallo] = useState(false);
  const [pincel, setPincel] = useState<"no_disponible" | "prefiere">("no_disponible");
  const [guardando, setGuardando] = useState<string | null>(null);
  const hoy = hoyIso();
  const lunes = lunesDe(hoy);
  const fin = sumaDia(lunes, 27);

  const cargar = useCallback(() => {
    setFallo(false);
    api.misDisponibilidades(lunes, fin)
      .then((l) => {
        const m: Record<string, Disponibilidad["tipo"]> = {};
        for (const d of l) m[d.fecha] = d.tipo;
        setMarcas(m);
      })
      .catch(() => { setFallo(true); avisar(MSG_CARGA); });
  }, [lunes, fin, avisar]);
  useEffect(() => { cargar(); }, [cargar]);

  async function tocar(iso: string) {
    if (!marcas || guardando || iso < hoy) return;
    const actual = marcas[iso];
    const nuevo = actual === pincel ? null : pincel;
    const antes = { ...marcas };
    setMarcas((m) => {
      const c = { ...(m || {}) };
      if (nuevo) c[iso] = nuevo; else delete c[iso];
      return c;
    });
    setGuardando(iso);
    const r = await api.marcarDisponibilidad(iso, nuevo);
    setGuardando(null);
    if (!r.ok) { setMarcas(antes); avisar("No se pudo guardar: " + r.error); }
  }

  if (fallo) return <FalloCarga reintentar={cargar} />;
  if (!marcas) return <div className="vacio">Cargando…</div>;

  const semanas: React.ReactNode[] = [];
  for (let s = 0; s < 4; s++) {
    const celdas: React.ReactNode[] = [];
    for (let d = 0; d < 7; d++) {
      const iso = sumaDia(lunes, s * 7 + d);
      const tipo = marcas[iso];
      const pasado = iso < hoy;
      celdas.push(
        <button
          key={iso}
          className={`celda ${tipo || ""} ${iso === hoy ? "hoy" : ""} ${pasado ? "pasado" : ""} ${guardando === iso ? "guardando" : ""}`}
          disabled={pasado}
          onClick={() => tocar(iso)}
          aria-label={`${diaLargo(iso)}${tipo === "no_disponible" ? ", no puedo" : tipo === "prefiere" ? ", prefiero" : ""}`}
        >
          <span className="num">{Number(iso.slice(8, 10))}</span>
          {d === 0 || iso.slice(8, 10) === "01" ? <span className="mes">{new Date(iso + "T12:00").toLocaleDateString("es-ES", { month: "short" })}</span> : null}
        </button>,
      );
    }
    semanas.push(<div key={s} className="semana">{celdas}</div>);
  }
  const nNo = Object.values(marcas).filter((t) => t === "no_disponible").length;
  const nPref = Object.values(marcas).filter((t) => t === "prefiere").length;

  return (
    <>
      <div className="tarjeta">
        <h3 style={{ fontSize: 14, marginBottom: 4 }}>Mis disponibilidades</h3>
        <div className="turno-det" style={{ marginBottom: 10 }}>Elige qué quieres marcar y toca los días. Tu encargado lo ve al hacer el cuadrante.</div>
        <div className="pinceles">
          <button className={`pincel no ${pincel === "no_disponible" ? "activo" : ""}`} onClick={() => setPincel("no_disponible")}>No puedo</button>
          <button className={`pincel si ${pincel === "prefiere" ? "activo" : ""}`} onClick={() => setPincel("prefiere")}>Prefiero trabajar</button>
        </div>
        <div className="calendario">
          <div className="semana cab">{DIAS_L.map((d) => <span key={d}>{d}</span>)}</div>
          {semanas}
        </div>
        <div className="leyenda">
          <span><i className="no" /> No puedo ({nNo})</span>
          <span><i className="si" /> Prefiero ({nPref})</span>
          <span>Toca otra vez para quitar la marca.</span>
        </div>
      </div>
      <div className="geo-nota" style={{ padding: "0 6px" }}>
        Es una preferencia, no una ausencia: si necesitas un día libre seguro, pide una ausencia.
      </div>
    </>
  );
}
