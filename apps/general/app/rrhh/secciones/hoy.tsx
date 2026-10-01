"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as hoyApi from "../acciones/hoy";
import type { CambioTurno, DatosHoy, SolicitudAusencia, TrabajaHoy } from "../acciones/hoy";
import { horaDe } from "../tipos";
import { colorTexto, fmtFechaCorta, fmtHoras, guardarPref, useCentroRecordado, type SecProps } from "../lib-rrhh";
import "./hoy.css";

/* Cambio de pestaña. Se emite 'rrhh:tab' (detail = id de pestaña, cancelable) para que PanelRrhh lo
   atienda con e.preventDefault(). Si nadie lo atiende, se guarda la pestaña en la preferencia que
   PanelRrhh lee al montar y se recarga la página: los botones funcionan igual, con un refresco. */
const irA = (tab: string) => {
  if (typeof window === "undefined") return;
  const atendido = !window.dispatchEvent(new CustomEvent("rrhh:tab", { detail: tab, cancelable: true }));
  if (atendido) return;
  guardarPref("tab", tab);
  window.location.reload();
};

const ESTADO: Record<TrabajaHoy["estado"], { txt: string; cls: string }> = {
  sin_fichar: { txt: "No ha fichado", cls: "rojo" },
  pendiente: { txt: "Aún no empieza", cls: "gris" },
  dentro: { txt: "Dentro", cls: "verde" },
  en_pausa: { txt: "En pausa", cls: "ambar" },
  salio: { txt: "Salió", cls: "gris" },
  sin_cubrir: { txt: "Sin cubrir", cls: "hueco" },
};

const fechaLarga = (iso: string) => {
  const s = new Date(iso + "T12:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function rangoAusencia(a: { desde: string; hasta: string; medioDia: boolean; horas: number | null }) {
  const r = a.desde === a.hasta ? fmtFechaCorta(a.desde) : `${fmtFechaCorta(a.desde)} → ${fmtFechaCorta(a.hasta)}`;
  if (a.horas) return `${r} · ${fmtHoras(a.horas)}`;
  if (a.medioDia) return `${r} · medio día`;
  return r;
}

type Modal =
  | { tipo: "rechazar-ausencia"; s: SolicitudAusencia }
  | { tipo: "rechazar-cambio"; c: CambioTurno }
  | { tipo: "confirmar-cambio"; c: CambioTurno }
  | null;

const MSG_CAMBIO_OK = "Cambio aprobado: el turno ya es del compañero";

export default function SecHoy({ ctx, avisar }: SecProps) {
  const [centroId, setCentroId] = useCentroRecordado(ctx.centros);
  const [datos, setDatos] = useState<DatosHoy | null>(null);
  const [cargando, setCargando] = useState(true);
  const [actualizadoEn, setActualizadoEn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verOtros, setVerOtros] = useState(false);
  const reqRef = useRef(0);
  const modalRef = useRef<Modal>(null);
  modalRef.current = modal;
  const pendientesRef = useRef<HTMLElement | null>(null);

  const cargar = useCallback(() => {
    const req = ++reqRef.current;
    setCargando(true);
    hoyApi
      .cargarHoy(centroId)
      .then((r) => {
        if (req !== reqRef.current) return; // llegó tarde: ya hay otra petición (otro centro)
        setDatos(r);
        setError(null);
        setActualizadoEn(new Date().toISOString());
      })
      .catch((e: unknown) => {
        if (req !== reqRef.current) return;
        setError(e instanceof Error ? e.message : "No se pudo cargar");
      })
      .finally(() => {
        if (req === reqRef.current) setCargando(false);
      });
  }, [centroId]);
  useEffect(() => { cargar(); }, [cargar]);
  // Refresco cada 2 minutos: el estado de fichaje cambia solo. No mientras la pestaña esté oculta ni con un modal abierto.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden || modalRef.current) return;
      cargar();
    }, 120000);
    return () => clearInterval(t);
  }, [cargar]);
  // Esc cierra el modal
  useEffect(() => {
    if (!modal) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setModal(null); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [modal]);

  const centroNombre = ctx.centros.find((c) => c.id === centroId)?.nombre ?? "";
  const nombreCentro = (id: string) => ctx.centros.find((c) => c.id === id)?.nombre ?? "otro centro";

  async function ejecutar(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setOcupado(id);
    const r = await fn();
    setOcupado(null);
    if (!r.ok) { avisar(r.error || "No se pudo"); return false; }
    avisar(okMsg);
    setModal(null);
    setMotivo("");
    cargar();
    return true;
  }

  async function aprobarCambio(c: CambioTurno, forzar = false) {
    setOcupado(c.id);
    const r = await hoyApi.aprobarCambioTurno(c.id, forzar);
    setOcupado(null);
    if (!r.ok && r.data?.confirmar) { setModal({ tipo: "confirmar-cambio", c }); return; }
    if (!r.ok) { avisar(r.error || "No se pudo"); return; }
    avisar(MSG_CAMBIO_OK);
    setModal(null);
    cargar();
  }

  /* ---------- Derivados ---------- */
  const d = datos;
  const trabajan = d?.trabajan ?? [];
  const nTurnos = trabajan.filter((t) => !t.turnoId.startsWith("sin-turno-")).length;
  const nDentro = new Set(trabajan.filter((t) => (t.estado === "dentro" || t.estado === "en_pausa") && t.empleadoId).map((t) => t.empleadoId)).size;
  const nSinFichar = trabajan.filter((t) => t.estado === "sin_fichar" && t.empleadoId).length;
  const nRetrasos = trabajan.filter((t) => t.retrasoMin > 0).length;
  const solicitudesCentro = (d?.solicitudes ?? []).filter((s) => s.esteCentro);
  const solicitudesOtros = (d?.solicitudes ?? []).filter((s) => !s.esteCentro);
  const cambiosCentro = (d?.cambios ?? []).filter((c) => c.esteCentro);
  const cambiosOtros = (d?.cambios ?? []).filter((c) => !c.esteCentro);
  const nPendientes = solicitudesCentro.length + cambiosCentro.length;
  const nOtros = solicitudesOtros.length + cambiosOtros.length;

  const avisos: { clave: string; nivel: "rojo" | "ambar" | "gris"; texto: string; tab: string; accion: string }[] = [];
  if (d) {
    const a = d.avisos;
    if (a.semanaProx.total === 0) {
      avisos.push({ clave: "prox0", nivel: "rojo", texto: `La semana que viene (desde el ${fmtFechaCorta(a.semanaProx.lunes)}) no tiene turnos.`, tab: "planificacion", accion: "Planificar" });
    } else if (a.semanaProx.borrador > 0) {
      avisos.push({ clave: "proxb", nivel: "ambar", texto: `La semana que viene tiene ${a.semanaProx.borrador} turno${a.semanaProx.borrador === 1 ? "" : "s"} en borrador sin publicar.`, tab: "planificacion", accion: "Publicar" });
    }
    if (a.semanaActual.borrador > 0) {
      avisos.push({ clave: "actb", nivel: "ambar", texto: `Esta semana tiene ${a.semanaActual.borrador} turno${a.semanaActual.borrador === 1 ? "" : "s"} en borrador: la gente no los ve.`, tab: "planificacion", accion: "Publicar" });
    }
    if (a.semanaActual.sinAsignar > 0) {
      avisos.push({ clave: "huecos", nivel: "ambar", texto: `${a.semanaActual.sinAsignar} turno${a.semanaActual.sinAsignar === 1 ? "" : "s"} sin asignar esta semana.`, tab: "planificacion", accion: "Cubrir" });
    }
    if (a.diasSinValidar.length) {
      const dias = a.diasSinValidar.map(fmtFechaCorta).join(", ");
      avisos.push({ clave: "val", nivel: "ambar", texto: `Fichajes sin validar en ${a.diasSinValidar.length} día${a.diasSinValidar.length === 1 ? "" : "s"} de los últimos 7: ${dias}.`, tab: "fichajes", accion: "Validar" });
    }
    for (const f of a.finContrato) {
      avisos.push({ clave: "fin" + f.empleadoId + f.fechaBaja, nivel: "ambar", texto: `El contrato de ${f.nombre} termina el ${fmtFechaCorta(f.fechaBaja)}.`, tab: "empleados", accion: "Ver ficha" });
    }
    if (a.sinHoras.length) {
      avisos.push({ clave: "sinh", nivel: "gris", texto: `${a.sinHoras.length} contrato${a.sinHoras.length === 1 ? "" : "s"} sin horas semanales: ${a.sinHoras.slice(0, 4).map((x) => x.nombre).join(", ")}${a.sinHoras.length > 4 ? "…" : ""}.`, tab: "empleados", accion: "Completar" });
    }
    if (a.sinPin.length) {
      avisos.push({ clave: "pin", nivel: "gris", texto: `${a.sinPin.length} empleado${a.sinPin.length === 1 ? "" : "s"} sin PIN para fichar en la tablet.`, tab: "empleados", accion: "Dar PIN" });
    }
  }

  const irAPendientes = () => {
    if (nOtros && !nPendientes) setVerOtros(true);
    pendientesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <div className="barra">
        <select value={centroId} onChange={(e) => setCentroId(e.target.value)}>
          {ctx.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <div className="hoy-fecha">{d ? fechaLarga(d.hoy) : " "}</div>
        <span className="hoy-actualizado">
          {cargando ? "Actualizando…" : actualizadoEn ? `Actualizado ${horaDe(actualizadoEn)}` : ""}
        </span>
        <button className="btn btn-fantasma btn-peque hoy-refrescar" onClick={cargar} disabled={cargando}>Actualizar</button>
      </div>

      {error ? <div className="aviso-caja">{error}{d ? " · Se muestran los últimos datos cargados." : ""}</div> : null}

      {/* Números grandes */}
      <div className={"hoy-kpis" + (cargando && d ? " hoy-atenuado" : "")}>
        <button className="hoy-kpi" onClick={() => irA("planificacion")}>
          <div className="n">{d ? nTurnos : "–"}</div>
          <div className="t">Turnos hoy</div>
        </button>
        <div className="hoy-kpi verde">
          <div className="n">{d ? nDentro : "–"}</div>
          <div className="t">Dentro ahora</div>
        </div>
        <div className={"hoy-kpi" + (nSinFichar ? " rojo" : "")}>
          <div className="n">{d ? nSinFichar : "–"}</div>
          <div className="t">Sin fichar</div>
        </div>
        <div className={"hoy-kpi" + (nRetrasos ? " ambar" : "")}>
          <div className="n">{d ? nRetrasos : "–"}</div>
          <div className="t">Retrasos</div>
        </div>
        <button className="hoy-kpi" onClick={() => irA("ausencias")}>
          <div className="n">{d ? d.ausentes.length : "–"}</div>
          <div className="t">Ausentes</div>
        </button>
        <button className={"hoy-kpi" + (nPendientes || (ctx.esGestor && nOtros) ? " ambar" : "")} onClick={irAPendientes}>
          <div className="n">{d ? nPendientes : "–"}</div>
          <div className="t">Pendiente de ti{nOtros ? ` · +${nOtros} en otros centros` : ""}</div>
        </button>
      </div>

      {!d ? (
        !error ? <div className="vacio">Cargando…</div> : null
      ) : (
        <div className={"hoy-rejilla" + (cargando ? " hoy-atenuado" : "")}>
          {/* (a) Quién trabaja hoy */}
          <section className="hoy-tarjeta hoy-trabajan">
            <header>
              <h3>Quién trabaja hoy <span className="hoy-centro">{centroNombre}</span></h3>
              <button className="link-btn2" onClick={() => irA("fichajes")}>Ver fichajes ›</button>
            </header>
            {!trabajan.length ? (
              <div className="hoy-vacio">
                Nadie tiene turno publicado hoy en este centro.
                <button className="link-btn2" onClick={() => irA("planificacion")}>Ir a Planificación</button>
              </div>
            ) : (
              <ul className="hoy-lista">
                {trabajan.map((t) => {
                  const est = ESTADO[t.estado];
                  const col = t.puestoColor || "#888";
                  return (
                    <li key={t.turnoId} className={"hoy-fila " + est.cls}>
                      <span className="hoy-hora">
                        {t.horaInicio ? `${t.horaInicio}–${t.horaFin}` : "—"}
                        {t.deAyer ? <span className="hoy-ayer">ayer</span> : null}
                      </span>
                      <span className="hoy-np">
                        {t.nombre}
                        {t.puesto ? <span className="hoy-puesto" style={{ background: col, color: colorTexto(col) }}>{t.puesto}</span> : null}
                      </span>
                      <span className={"hoy-estado " + est.cls}>
                        {est.txt}
                        {t.estado === "dentro" && t.entradaTs ? ` desde ${horaDe(t.entradaTs)}` : ""}
                        {t.estado === "en_pausa" && t.ultimoTs ? ` desde ${horaDe(t.ultimoTs)}` : ""}
                        {t.estado === "salio" && t.ultimoTs ? ` ${horaDe(t.ultimoTs)}` : ""}
                      </span>
                      {t.retrasoMin > 0 ? <span className="hoy-pill ambar">Retraso {t.retrasoMin} min</span> : null}
                      {t.fichoEnCentroId ? <span className="hoy-pill gris">Fichó en {nombreCentro(t.fichoEnCentroId)}</span> : null}
                      {t.nota ? <span className="hoy-pill gris">{t.nota}</span> : null}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="nota" style={{ marginTop: 8 }}>
              Retraso = entrada más de {d.avisoRetrasoMin} min después del turno (regla del centro, en Ajustes).
              Los cierres de ayer que cruzan medianoche se ven aquí hasta que acaban.
            </div>
          </section>

          {/* (b) Ausentes hoy */}
          <section className="hoy-tarjeta">
            <header>
              <h3>Ausentes hoy</h3>
              <button className="link-btn2" onClick={() => irA("ausencias")}>Ausencias ›</button>
            </header>
            {!d.ausentes.length ? (
              <div className="hoy-vacio">Nadie ausente hoy.</div>
            ) : (
              <ul className="hoy-lista">
                {d.ausentes.map((a) => {
                  const col = a.color || "#888";
                  return (
                    <li key={a.id} className="hoy-fila">
                      <span className="hoy-np">{a.nombre}</span>
                      <span className="hoy-tipo" style={{ background: col, color: colorTexto(col) }}>{a.tipo}</span>
                      <span className="hoy-sub">{rangoAusencia(a)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {!ctx.esGestor ? <div className="nota" style={{ marginTop: 8 }}>Las ausencias solo las ve dirección por ahora.</div> : null}
          </section>

          {/* (c) Pendiente de ti */}
          <section className="hoy-tarjeta" ref={pendientesRef}>
            <header>
              <h3>Pendiente de ti {nPendientes ? <span className="hoy-cont">{nPendientes}</span> : null}</h3>
            </header>
            {!nPendientes && !nOtros ? (
              <div className="hoy-vacio">Nada pendiente. Las solicitudes de ausencia y los cambios de turno aparecerán aquí.</div>
            ) : null}
            {solicitudesCentro.length ? (
              <>
                <div className="hoy-subtitulo">Ausencias solicitadas</div>
                <ul className="hoy-lista">
                  {solicitudesCentro.map((s) => <FilaSolicitud key={s.id} s={s} ocupado={ocupado} onAprobar={() => ejecutar(s.id, () => hoyApi.resolverSolicitud(s.id, "aprobada"), "Ausencia aprobada")} onRechazar={() => { setMotivo(""); setModal({ tipo: "rechazar-ausencia", s }); }} />)}
                </ul>
              </>
            ) : null}
            {cambiosCentro.length ? (
              <>
                <div className="hoy-subtitulo">Cambios de turno</div>
                <ul className="hoy-lista">
                  {cambiosCentro.map((c) => <FilaCambio key={c.id} c={c} ocupado={ocupado} onAprobar={() => aprobarCambio(c)} onRechazar={() => { setMotivo(""); setModal({ tipo: "rechazar-cambio", c }); }} />)}
                </ul>
              </>
            ) : null}
            {nOtros ? (
              <div className="hoy-otros">
                <button className="link-btn2" onClick={() => setVerOtros((v) => !v)}>
                  {verOtros ? "Ocultar" : "Ver"} {nOtros} pendiente{nOtros === 1 ? "" : "s"} de otros centros
                </button>
                {verOtros ? (
                  <ul className="hoy-lista">
                    {solicitudesOtros.map((s) => <FilaSolicitud key={s.id} s={s} ocupado={ocupado} onAprobar={() => ejecutar(s.id, () => hoyApi.resolverSolicitud(s.id, "aprobada"), "Ausencia aprobada")} onRechazar={() => { setMotivo(""); setModal({ tipo: "rechazar-ausencia", s }); }} />)}
                    {cambiosOtros.map((c) => <FilaCambio key={c.id} c={c} ocupado={ocupado} onAprobar={() => aprobarCambio(c)} onRechazar={() => { setMotivo(""); setModal({ tipo: "rechazar-cambio", c }); }} />)}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {!ctx.esGestor ? <div className="nota" style={{ marginTop: 8 }}>Las solicitudes de ausencia solo las ve dirección por ahora; aquí verás los cambios de turno de tus centros.</div> : null}
          </section>

          {/* (d) Avisos */}
          <section className="hoy-tarjeta">
            <header>
              <h3>Avisos {avisos.length ? <span className="hoy-cont">{avisos.length}</span> : null}</h3>
            </header>
            {!avisos.length ? (
              <div className="hoy-vacio ok">Todo en orden: semana que viene publicada, fichajes validados y contratos al día.</div>
            ) : (
              <ul className="hoy-lista">
                {avisos.map((a) => (
                  <li key={a.clave} className={"hoy-aviso " + a.nivel}>
                    <span className="hoy-punto" />
                    <span className="hoy-txt">{a.texto}</span>
                    <button className="btn btn-fantasma btn-peque" onClick={() => irA(a.tab)}>{a.accion}</button>
                  </li>
                ))}
              </ul>
            )}
            {!ctx.esGestor ? <div className="nota" style={{ marginTop: 8 }}>Los avisos de contratos y PIN solo los ve dirección.</div> : null}
          </section>
        </div>
      )}

      {/* Modales: rechazo con motivo / confirmar cambio sin aceptación del compañero */}
      {modal ? (
        <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}>
          {modal.tipo === "confirmar-cambio" ? (
            <div className="modal">
              <h2>Aprobar cambio de turno</h2>
              <div className="sub">
                {modal.c.solicitante} → {modal.c.destinatario ?? "abierto"} · {fmtFechaCorta(modal.c.fecha)} {modal.c.horaInicio}–{modal.c.horaFin}
              </div>
              <p>El compañero aún no ha aceptado. ¿Aprobar igualmente? El turno pasará a su nombre.</p>
              <div className="modal-acciones">
                <button type="button" className="btn btn-fantasma" onClick={() => setModal(null)}>Cancelar</button>
                <button type="button" className="btn btn-primario" disabled={ocupado !== null} onClick={() => aprobarCambio(modal.c, true)}>Aprobar igualmente</button>
              </div>
            </div>
          ) : (
            <form
              className="modal"
              onSubmit={(e) => {
                e.preventDefault();
                if (modal.tipo === "rechazar-ausencia") {
                  if (!motivo.trim()) { avisar("Di el motivo del rechazo"); return; }
                  ejecutar(modal.s.id, () => hoyApi.resolverSolicitud(modal.s.id, "rechazada", motivo), "Ausencia rechazada");
                } else {
                  ejecutar(modal.c.id, () => hoyApi.rechazarCambioTurno(modal.c.id, motivo), "Cambio rechazado");
                }
              }}
            >
              <h2>{modal.tipo === "rechazar-ausencia" ? "Rechazar ausencia" : "Rechazar cambio de turno"}</h2>
              <div className="sub">
                {modal.tipo === "rechazar-ausencia"
                  ? `${modal.s.nombre} · ${modal.s.tipo} · ${rangoAusencia(modal.s)}`
                  : `${modal.c.solicitante} → ${modal.c.destinatario ?? "abierto"} · ${fmtFechaCorta(modal.c.fecha)} ${modal.c.horaInicio}–${modal.c.horaFin}`}
              </div>
              <label>Motivo {modal.tipo === "rechazar-ausencia" ? "(lo verá el empleado)" : "(opcional)"}</label>
              <textarea
                rows={3}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej.: esos días ya hay dos personas de vacaciones"
                autoFocus
              />
              <div className="modal-acciones">
                <button type="button" className="btn btn-fantasma" onClick={() => setModal(null)}>Cancelar</button>
                <button type="submit" className="btn btn-borrar" disabled={ocupado !== null}>Rechazar</button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </>
  );
}

/* ---------- Filas de «Pendiente de ti» ---------- */

function FilaSolicitud({ s, ocupado, onAprobar, onRechazar }: { s: SolicitudAusencia; ocupado: string | null; onAprobar: () => void; onRechazar: () => void }) {
  const col = s.color || "#888";
  return (
    <li className="hoy-fila hoy-pend">
      <span className="hoy-np">{s.nombre}</span>
      <span className="hoy-tipo" style={{ background: col, color: colorTexto(col) }}>{s.tipo}</span>
      <span className="hoy-sub">{rangoAusencia(s)}{s.nota ? ` · «${s.nota}»` : ""}</span>
      <span className="hoy-acciones">
        <button className="btn btn-primario btn-peque" disabled={ocupado === s.id} onClick={onAprobar}>Aprobar</button>
        <button className="btn btn-borrar btn-peque" disabled={ocupado === s.id} onClick={onRechazar}>Rechazar</button>
      </span>
    </li>
  );
}

function FilaCambio({ c, ocupado, onAprobar, onRechazar }: { c: CambioTurno; ocupado: string | null; onAprobar: () => void; onRechazar: () => void }) {
  return (
    <li className="hoy-fila hoy-pend">
      <span className="hoy-np">
        {c.solicitante} <span className="hoy-flecha">→</span> {c.destinatario ?? <em>quien quiera</em>}
      </span>
      <span className="hoy-sub">
        {fmtFechaCorta(c.fecha)} {c.horaInicio}–{c.horaFin}{c.puesto ? ` · ${c.puesto}` : ""}
        {c.estado === "aceptado_companero" ? " · el compañero ya aceptó" : c.destinatarioId ? " · el compañero aún no ha aceptado" : ""}
        {c.nota ? ` · «${c.nota}»` : ""}
      </span>
      <span className="hoy-acciones">
        {c.destinatarioId ? (
          <button className="btn btn-primario btn-peque" disabled={ocupado === c.id} onClick={onAprobar}>Aprobar</button>
        ) : (
          <button className="btn btn-fantasma btn-peque" onClick={() => irA("planificacion")}>Asignar</button>
        )}
        <button className="btn btn-borrar btn-peque" disabled={ocupado === c.id} onClick={onRechazar}>Rechazar</button>
      </span>
    </li>
  );
}
