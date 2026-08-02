"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./acciones";
import {
  DIAS_SEMANA, MET, NT, TIPOS_AUSENCIA_ENUM,
  calcularDia, dowDe, efectivosDe, finAbsoluto, fmtCorta, fmtDia, hh, horaDe, horasNetas, hoyIso, iniciales, lunesDe, minutos, sumaDia,
  type Ausencia, type CentroMin, type Convenio, type Dispositivo, type Empleado, type Fichaje, type Periodo, type Turno,
} from "./tipos";

type Tab = "planificacion" | "fichajes" | "informes" | "empleados" | "ausencias" | "dispositivos" | "ajustes";
type Ctx = Awaited<ReturnType<typeof api.contexto>>;

export default function PanelRrhh() {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [tab, setTab] = useState<Tab>("planificacion");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const avisar = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    api.contexto().then(setCtx);
  }, []);

  if (!ctx) return <div className="rh"><div className="vacio">Cargando…</div></div>;
  if (!ctx.centros.length) {
    return <div className="rh"><div className="vacio">No tienes ningún centro asignado. Habla con dirección.</div></div>;
  }

  const TABS: [Tab, string, boolean][] = [
    ["planificacion", "Planificación", true],
    ["fichajes", "Fichajes", true],
    ["informes", "Informes", true],
    ["empleados", "Empleados", true],
    ["ausencias", "Ausencias", true],
    ["dispositivos", "Dispositivos", ctx.esGestor],
    ["ajustes", "Ajustes", ctx.esGestor],
  ];

  return (
    <div className="rh">
      <div className="tabsbar">
        {TABS.filter(([, , ver]) => ver).map(([id, nombre]) => (
          <button key={id} className={tab === id ? "activa" : ""} onClick={() => setTab(id)}>{nombre}</button>
        ))}
      </div>
      <main>
        {tab === "planificacion" ? <SecPlanificacion ctx={ctx} avisar={avisar} /> : null}
        {tab === "fichajes" ? <SecFichajes ctx={ctx} avisar={avisar} /> : null}
        {tab === "informes" ? <SecInformes ctx={ctx} /> : null}
        {tab === "empleados" ? <SecEmpleados ctx={ctx} avisar={avisar} /> : null}
        {tab === "ausencias" ? <SecAusencias ctx={ctx} avisar={avisar} /> : null}
        {tab === "dispositivos" && ctx.esGestor ? <SecDispositivos ctx={ctx} avisar={avisar} /> : null}
        {tab === "ajustes" && ctx.esGestor ? <SecAjustes avisar={avisar} /> : null}
      </main>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

/* ==================== PLANIFICACIÓN ==================== */

function SecPlanificacion({ ctx, avisar }: { ctx: Ctx; avisar: (m: string) => void }) {
  const [centroId, setCentroId] = useState(ctx.centros[0].id);
  const [lunes, setLunes] = useState(lunesDe(hoyIso()));
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.cargarSemana>> | null>(null);
  const [modal, setModal] = useState<{ empleadoId: string; fecha: string; turno: Turno | null } | null>(null);
  const hasta = sumaDia(lunes, 6);

  const cargar = useCallback(() => {
    api.cargarSemana(centroId, lunes, sumaDia(lunes, 6)).then(setDatos);
  }, [centroId, lunes]);
  useEffect(() => { cargar(); }, [cargar]);

  const avisos = useMemo(() => {
    if (!datos) return { lista: [] as string[], conflicto: new Set<string>() };
    const r = datos.reglas;
    const minDescanso = datos.pacto10h ? 10 : r?.descanso_diario_h != null ? Number(r.descanso_diario_h) : 12;
    const maxDiaria = r?.jornada_max_diaria_h != null ? Number(r.jornada_max_diaria_h) : 9;
    const lista: string[] = [];
    const conflicto = new Set<string>();
    for (const e of datos.empleados) {
      const suyos = datos.turnos
        .filter((t) => t.empleado_id === e.id)
        .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora_inicio.localeCompare(b.hora_inicio));
      const total = suyos.reduce((s, t) => s + horasNetas(t), 0);
      (e as Empleado)._horasSemana = total;
      if (e.horas_vigentes && total > Number(e.horas_vigentes) + 0.01)
        lista.push(`${e.nombre}: ${total.toFixed(1)} h planificadas, contrato de ${e.horas_vigentes} h.`);
      for (let i = 1; i < suyos.length; i++) {
        const a = suyos[i - 1], b = suyos[i];
        const diasEntre = (new Date(b.fecha).getTime() - new Date(a.fecha).getTime()) / 86400000;
        const finA = diasEntre * 24 * 60 * -1 + finAbsoluto(a);
        const descanso = (minutos(b.hora_inicio) - finA) / 60;
        if (a.fecha === b.fecha && minutos(b.hora_inicio) < finAbsoluto(a)) {
          lista.push(`${e.nombre}: turnos solapados el ${DIAS_SEMANA[dowDe(b.fecha)].toLowerCase()}.`);
          conflicto.add(a.id); conflicto.add(b.id);
        } else if (diasEntre <= 1 && descanso < minDescanso) {
          lista.push(`${e.nombre}: solo ${descanso.toFixed(1)} h de descanso antes del turno del ${DIAS_SEMANA[dowDe(b.fecha)].toLowerCase()} (mínimo ${minDescanso} h).`);
          conflicto.add(b.id);
        }
      }
      for (const t of suyos) if (horasNetas(t) > maxDiaria)
        lista.push(`${e.nombre}: turno de ${horasNetas(t).toFixed(1)} h el ${DIAS_SEMANA[dowDe(t.fecha)].toLowerCase()} (máximo ${maxDiaria} h).`);
    }
    return { lista, conflicto };
  }, [datos]);

  if (!datos) return <div className="vacio">Cargando…</div>;

  const ausenciaDe = (empId: string, fecha: string) =>
    datos.ausencias.find((a) => a.empleado_id === empId && a.fecha_inicio <= fecha && a.fecha_fin >= fecha);
  const borradores = datos.turnos.filter((t) => t.estado === "borrador").length;
  const hoy = hoyIso();

  let deptoActual: string | null = null;
  const filas: React.ReactNode[] = [];
  for (const e of datos.empleados) {
    const d = e.departamento || "Sin departamento";
    if (d !== deptoActual) {
      deptoActual = d;
      const tot = datos.empleados.filter((x) => (x.departamento || "Sin departamento") === d).length;
      filas.push(<tr key={"d" + d} className="fila-depto"><td colSpan={8}>{d} <span>· {tot}</span></td></tr>);
    }
    const exceso = e.horas_vigentes && (e._horasSemana ?? 0) > Number(e.horas_vigentes) + 0.01;
    filas.push(
      <tr key={e.id}>
        <td className="nombre">
          <div className="np">{e.nombre} {e.apellidos || ""}</div>
          <div className={`horas ${exceso ? "exceso" : ""}`}>
            {(e._horasSemana ?? 0).toFixed(1)} h{e.horas_vigentes ? ` / ${e.horas_vigentes} h` : ""}
          </div>
        </td>
        {Array.from({ length: 7 }, (_, dd) => {
          const fecha = sumaDia(lunes, dd);
          const aus = ausenciaDe(e.id, fecha);
          const celdaTurnos = datos.turnos
            .filter((t) => t.empleado_id === e.id && t.fecha === fecha)
            .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
          return (
            <td
              key={dd}
              className={`celda ${aus ? "ausencia" : ""}`}
              onClick={(ev) => {
                if ((ev.target as Element).closest(".turno")) return;
                if (aus && !confirm(`Este día tiene una ausencia aprobada (${aus.tipo}). ¿Crear turno igualmente?`)) return;
                setModal({ empleadoId: e.id, fecha, turno: null });
              }}
            >
              {aus ? <div className="tag-ausencia">{aus.tipo}</div> : null}
              {celdaTurnos.map((t) => (
                <div
                  key={t.id}
                  className={`turno ${t.estado} ${avisos.conflicto.has(t.id) ? "conflicto" : ""}`}
                  onClick={() => setModal({ empleadoId: e.id, fecha, turno: t })}
                >
                  <div className="hhx">{hh(t)}{avisos.conflicto.has(t.id) ? <span className="warn"> ⚠</span> : null}</div>
                  {t.puesto ? <div className="pu">{t.puesto}</div> : null}
                </div>
              ))}
            </td>
          );
        })}
      </tr>,
    );
  }

  return (
    <>
      <div className="barra">
        <select value={centroId} onChange={(e) => setCentroId(e.target.value)}>
          {ctx.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <div className="sem-nav">
          <button onClick={() => setLunes(sumaDia(lunes, -7))}>‹</button>
          <span className="sem-label">{fmtCorta(lunes)} — {fmtCorta(hasta)}</span>
          <button onClick={() => setLunes(sumaDia(lunes, 7))}>›</button>
          <button className="btn btn-fantasma" style={{ height: 34 }} onClick={() => setLunes(lunesDe(hoyIso()))}>Hoy</button>
        </div>
        {borradores ? <span className="chip-borradores">{borradores} sin publicar</span> : null}
        <button
          className="btn btn-fantasma"
          onClick={async () => {
            if (datos.turnos.length && !confirm(`Esta semana ya tiene ${datos.turnos.length} turnos. ¿Añadir los copiados de la anterior?`)) return;
            const r = await api.copiarSemanaAnterior(centroId, lunes, datos.empleados.map((e) => e.id));
            if (!r.ok) { avisar(r.error || "No se pudo copiar"); return; }
            avisar(`${r.data} turnos copiados como borrador`);
            cargar();
          }}
        >
          Copiar semana anterior
        </button>
        <button
          className="btn btn-publicar"
          disabled={!borradores}
          onClick={async () => {
            if (!confirm(`¿Publicar ${borradores} turno${borradores === 1 ? "" : "s"} de esta semana? Serán visibles para el equipo.`)) return;
            const r = await api.publicarSemana(centroId, lunes, hasta);
            if (!r.ok) { avisar("Error al publicar: " + r.error); return; }
            avisar("Semana publicada");
            cargar();
          }}
        >
          Publicar semana
        </button>
      </div>

      {!datos.empleados.length ? (
        <div className="vacio">Este centro no tiene empleados asignados todavía.</div>
      ) : (
        <div className="plan-scroll">
          <table className="cuadrante">
            <thead>
              <tr>
                <th style={{ minWidth: 150 }}>Equipo</th>
                {Array.from({ length: 7 }, (_, d) => {
                  const f = sumaDia(lunes, d);
                  return <th key={d} className={f === hoy ? "hoy" : ""}>{DIAS_SEMANA[d]}<br />{fmtCorta(f)}</th>;
                })}
              </tr>
            </thead>
            <tbody>{filas}</tbody>
          </table>
        </div>
      )}

      <div className="leyenda">
        <span><span className="muestra" style={{ border: "1.5px dashed var(--green)", background: "#fff" }} /> Borrador (solo lo ves tú)</span>
        <span><span className="muestra" style={{ border: "1.5px solid var(--green)", background: "var(--green-light)" }} /> Publicado (visible para el empleado)</span>
        <span><span className="muestra" style={{ background: "var(--arena)", border: "1px solid var(--linea)" }} /> Ausencia aprobada</span>
        <span style={{ color: "var(--amber)" }}>⚠ Aviso de descanso u horas — no bloquea</span>
      </div>
      {avisos.lista.length ? (
        <div className="avisos-panel">
          <h3>⚠ Avisos de la semana (no bloquean)</h3>
          {avisos.lista.map((a, i) => <div key={i}>{a}</div>)}
        </div>
      ) : null}

      {modal ? (
        <ModalTurno
          contexto={modal}
          empleado={datos.empleados.find((e) => e.id === modal.empleadoId) ?? null}
          centroId={centroId}
          cerrar={() => setModal(null)}
          hecho={(msg) => { setModal(null); avisar(msg); cargar(); }}
        />
      ) : null}
    </>
  );
}

function ModalTurno({ contexto, empleado, centroId, cerrar, hecho }: {
  contexto: { empleadoId: string; fecha: string; turno: Turno | null };
  empleado: Empleado | null;
  centroId: string;
  cerrar: () => void;
  hecho: (msg: string) => void;
}) {
  const t = contexto.turno;
  const [inicio, setInicio] = useState(t ? t.hora_inicio.slice(0, 5) : "12:00");
  const [fin, setFin] = useState(t ? t.hora_fin.slice(0, 5) : "18:00");
  const [pausa, setPausa] = useState(String(t?.pausa_min ?? 0));
  const [puesto, setPuesto] = useState(t?.puesto ?? "");
  const [error, setError] = useState("");
  return (
    <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <form
        className="modal"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await api.guardarTurno(t?.id ?? null, {
            empleado_id: contexto.empleadoId,
            centro_id: centroId,
            fecha: contexto.fecha,
            hora_inicio: inicio,
            hora_fin: fin,
            pausa_min: Number(pausa) || 0,
            puesto: puesto.trim() || null,
          });
          if (!r.ok) { setError("No se pudo guardar: " + r.error); return; }
          hecho("Turno guardado");
        }}
      >
        <h2>{t ? "Editar turno" : "Nuevo turno"}</h2>
        <div className="sub">{empleado?.nombre ?? ""} · {DIAS_SEMANA[dowDe(contexto.fecha)]} {fmtCorta(contexto.fecha)}</div>
        <div className="fila-2">
          <div><label>Entrada</label><input type="time" required step={300} value={inicio} onChange={(e) => setInicio(e.target.value)} /></div>
          <div><label>Salida</label><input type="time" required step={300} value={fin} onChange={(e) => setFin(e.target.value)} /></div>
        </div>
        <div className="fila-2">
          <div><label>Pausa (min)</label><input type="number" min={0} step={5} value={pausa} onChange={(e) => setPausa(e.target.value)} /></div>
          <div><label>Puesto</label><input value={puesto} onChange={(e) => setPuesto(e.target.value)} placeholder="Sala, cocina, barra…" list="rh-puestos" />
            <datalist id="rh-puestos"><option>Sala</option><option>Cocina</option><option>Barra</option><option>Office</option><option>Tienda</option></datalist>
          </div>
        </div>
        <div className="aviso-modal">{error || (t?.estado === "publicado" ? "Este turno ya está publicado: el cambio será visible para el empleado al guardar." : "")}</div>
        <div className="modal-acciones">
          {t ? (
            <button type="button" className="btn btn-borrar" onClick={async () => {
              if (!confirm("¿Eliminar este turno?")) return;
              const r = await api.borrarTurno(t.id);
              if (!r.ok) { setError("No se pudo eliminar: " + r.error); return; }
              hecho("Turno eliminado");
            }}>Eliminar</button>
          ) : null}
          <button type="button" className="btn btn-fantasma" onClick={cerrar}>Cancelar</button>
          <button type="submit" className="btn btn-primario">Guardar</button>
        </div>
      </form>
    </div>
  );
}

/* ==================== FICHAJES ==================== */

function SecFichajes({ ctx, avisar }: { ctx: Ctx; avisar: (m: string) => void }) {
  const [centroId, setCentroId] = useState(ctx.centros[0].id);
  const [fecha, setFecha] = useState(hoyIso());
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.fichajesDia>> | null>(null);
  const [corr, setCorr] = useState<{ empId: string; orig: Fichaje | null } | null>(null);
  const [cHora, setCHora] = useState("");
  const [cTipo, setCTipo] = useState("salida");
  const [cMotivo, setCMotivo] = useState("");
  const [cError, setCError] = useState("");

  const cargar = useCallback(() => {
    api.fichajesDia(centroId, fecha).then(setDatos);
  }, [centroId, fecha]);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <>
      <div className="barra">
        <select value={centroId} onChange={(e) => setCentroId(e.target.value)}>
          {ctx.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <div className="sem-nav">
          <button onClick={() => setFecha(sumaDia(fecha, -1))}>‹</button>
          <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
          <button onClick={() => setFecha(sumaDia(fecha, 1))}>›</button>
          <button className="btn btn-fantasma" style={{ height: 34 }} onClick={() => setFecha(hoyIso())}>Hoy</button>
        </div>
      </div>
      <div className="leyenda-f">Verde entrada · rojo salida · gris pausa · morado corrección. Toca un fichaje para corregirlo.</div>
      {!datos ? (
        <div className="vacio">Cargando…</div>
      ) : !datos.empleados.length ? (
        <div className="vacio">Este centro no tiene empleados asignados.</div>
      ) : (
        datos.empleados.map((e) => {
          const todos = datos.fichajes.filter((f) => f.empleado_id === e.id);
          const { efectivos, anulados } = efectivosDe(todos);
          const { horas, inc, enCurso } = calcularDia(efectivos, fecha === hoyIso());
          return (
            <div key={e.id} className="tarjeta-f">
              <div className="fila-cab">
                <h3>{e.nombre} {e.apellidos || ""}</h3>
                {todos.length ? <span className="horas-dia">{horas.toFixed(2)} h</span> : null}
                {enCurso ? <span className="badge encurso">En curso</span> : null}
                {inc.map((i) => <span key={i} className="badge incidencia">⚠ {i}</span>)}
              </div>
              {!todos.length ? (
                <div className="sin-fichajes">Sin fichajes este día.</div>
              ) : (
                <div className="chips">
                  {todos.map((f) => {
                    const anu = anulados.has(f.id);
                    const cl = anu ? f.tipo + " anulado" : f.metodo === "correccion" ? "correccion" : f.tipo;
                    return (
                      <div key={f.id} className={`chip ${cl}`}
                        title={f.metodo === "correccion" ? "Corrección: " + (f.motivo_correccion || "") : MET[f.metodo] || ""}
                        onClick={() => {
                          if (anu) return;
                          setCorr({ empId: e.id, orig: f });
                          setCTipo(f.tipo);
                          setCHora(new Date(f.ts).toTimeString().slice(0, 5));
                          setCMotivo(""); setCError("");
                        }}
                      >
                        <span className="t">{NT[f.tipo]}</span> {horaDe(f.ts)}{" "}
                        <span style={{ color: "var(--tinta-suave)", fontSize: 11 }}>{f.metodo === "correccion" ? "✎" : ""}{anu ? " anulado" : ""}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <button className="link-btn" onClick={() => { setCorr({ empId: e.id, orig: null }); setCTipo("salida"); setCHora(""); setCMotivo(""); setCError(""); }}>
                + Añadir fichaje que falta
              </button>
            </div>
          );
        })
      )}

      {corr ? (
        <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) setCorr(null); }}>
          <form
            className="modal"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await api.corregirFichaje({
                empleado_id: corr.empId,
                centro_id: centroId,
                tipo: cTipo,
                ts: new Date(`${fecha}T${cHora}`).toISOString(),
                corrige_a: corr.orig?.id ?? null,
                motivo_correccion: cMotivo.trim(),
              });
              if (!r.ok) { setCError("No se pudo guardar: " + r.error); return; }
              setCorr(null); avisar("Corrección registrada"); cargar();
            }}
          >
            <h2>{corr.orig ? "Corregir fichaje" : "Añadir fichaje"}</h2>
            <div className="sub">
              {datos?.empleados.find((x) => x.id === corr.empId)?.nombre ?? ""} · {fecha}
              {corr.orig ? ` · sustituye a ${NT[corr.orig.tipo]} ${horaDe(corr.orig.ts)}` : ""}
            </div>
            <div className="fila-2">
              <div><label>Tipo</label>
                <select value={cTipo} onChange={(e) => setCTipo(e.target.value)}>
                  <option value="entrada">Entrada</option><option value="salida">Salida</option>
                  <option value="pausa_inicio">Inicio de pausa</option><option value="pausa_fin">Fin de pausa</option>
                </select>
              </div>
              <div><label>Hora</label><input type="time" required value={cHora} onChange={(e) => setCHora(e.target.value)} /></div>
            </div>
            <label>Motivo (obligatorio, queda en el registro)</label>
            <textarea rows={2} required value={cMotivo} onChange={(e) => setCMotivo(e.target.value)} placeholder="Ej.: olvidó fichar la salida al cerrar" style={{ width: "100%" }} />
            <div className="aviso-modal">{cError}</div>
            <div className="modal-acciones">
              <button type="button" className="btn btn-fantasma" onClick={() => setCorr(null)}>Cancelar</button>
              <button type="submit" className="btn btn-primario">Guardar corrección</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

/* ==================== INFORMES ==================== */

function SecInformes({ ctx }: { ctx: Ctx }) {
  const [centroId, setCentroId] = useState(ctx.centros[0].id);
  const hoy = hoyIso();
  const [desde, setDesde] = useState(hoy.slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoy);
  const [datos, setDatos] = useState<{
    filas: Record<string, { plan: number; real: number; inc: number }>;
    nombres: Record<string, string>;
    porEmpDia: Record<string, Record<string, Fichaje[]>>;
    fichajesTodos: Fichaje[];
    centroNombre: string;
  } | null>(null);
  const [calculando, setCalculando] = useState(false);

  async function calcular() {
    if (!desde || !hasta || desde > hasta) { alert("Revisa el rango de fechas."); return; }
    setCalculando(true);
    const d = await api.datosInforme(centroId, desde, hasta);
    const nombres: Record<string, string> = {};
    for (const e of d.empleados) nombres[e.id] = `${e.nombre} ${e.apellidos || ""}`.trim();
    const anulados = new Set(d.fichajes.map((f) => f.corrige_a).filter(Boolean) as string[]);
    const efectivos = d.fichajes.filter((f) => !anulados.has(f.id));
    const porEmpDia: Record<string, Record<string, Fichaje[]>> = {};
    for (const f of efectivos) {
      const dia = new Date(f.ts).toLocaleDateString("sv-SE");
      ((porEmpDia[f.empleado_id] = porEmpDia[f.empleado_id] || {})[dia] = porEmpDia[f.empleado_id][dia] || []).push(f);
    }
    const filas: Record<string, { plan: number; real: number; inc: number }> = {};
    for (const t of d.turnos) {
      const r = (filas[t.empleado_id] = filas[t.empleado_id] || { plan: 0, real: 0, inc: 0 });
      r.plan += horasNetas(t);
    }
    for (const [id, dias] of Object.entries(porEmpDia)) {
      const r = (filas[id] = filas[id] || { plan: 0, real: 0, inc: 0 });
      for (const efs of Object.values(dias)) {
        const { horas, inc } = calcularDia(efs, false);
        r.real += horas;
        r.inc += inc.length;
      }
    }
    setDatos({ filas, nombres, porEmpDia, fichajesTodos: d.fichajes, centroNombre: ctx.centros.find((c) => c.id === centroId)?.nombre || "" });
    setCalculando(false);
  }

  function descargar(nombre: string, filas: (string | number)[][]) {
    const csv = filas.map((f) => f.map((c) => { const s = String(c ?? ""); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const ids = datos ? Object.keys(datos.filas).sort((a, b) => (datos.nombres[a] || "").localeCompare(datos.nombres[b] || "")) : [];
  let tp = 0, tr = 0;

  return (
    <>
      <div className="barra" />
      <div className="filtros-inf">
        <div><label style={{ marginTop: 0 }}>Centro</label>
          <select value={centroId} onChange={(e) => setCentroId(e.target.value)}>
            {ctx.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div><label style={{ marginTop: 0 }}>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div><label style={{ marginTop: 0 }}>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        <button className="btn btn-primario" disabled={calculando} onClick={calcular}>{calculando ? "Calculando…" : "Calcular"}</button>
      </div>
      <div className="exportes">
        <button className="btn btn-fantasma" onClick={() => {
          if (!datos) { alert("Primero pulsa Calcular."); return; }
          const out: (string | number)[][] = [["Centro", "Periodo", "Empleado", "Horas planificadas", "Horas fichadas", "Desviacion", "Incidencias"]];
          for (const [id, r] of Object.entries(datos.filas)) out.push([datos.centroNombre, `${desde} a ${hasta}`, datos.nombres[id] || "", r.plan.toFixed(2), r.real.toFixed(2), (r.real - r.plan).toFixed(2), r.inc]);
          descargar(`resumen_${datos.centroNombre}_${desde}_${hasta}.csv`, out);
        }}>⬇ CSV resumen (gestoría)</button>
        <button className="btn btn-fantasma" onClick={() => {
          if (!datos) { alert("Primero pulsa Calcular."); return; }
          const out: (string | number)[][] = [["Centro", "Empleado", "Fecha", "Fichajes del dia", "Horas netas", "Incidencias"]];
          for (const [id, dias] of Object.entries(datos.porEmpDia)) for (const dkey of Object.keys(dias).sort()) {
            const efs = dias[dkey];
            const { horas, inc } = calcularDia(efs, false);
            out.push([datos.centroNombre, datos.nombres[id] || "", dkey, efs.map((f) => `${f.tipo} ${horaDe(f.ts)}`).join(" | "), horas.toFixed(2), inc.length]);
          }
          descargar(`detalle_diario_${datos.centroNombre}_${desde}_${hasta}.csv`, out);
        }}>⬇ CSV detalle diario</button>
        <button className="btn btn-fantasma" onClick={() => {
          if (!datos) { alert("Primero pulsa Calcular."); return; }
          const an = new Set(datos.fichajesTodos.map((f) => f.corrige_a).filter(Boolean) as string[]);
          const out: (string | number)[][] = [["Centro", "Empleado", "Fecha y hora", "Tipo", "Metodo", "Estado", "Corrige a", "Motivo correccion", "Registrado el"]];
          for (const f of datos.fichajesTodos) out.push([datos.centroNombre, datos.nombres[f.empleado_id] || "", new Date(f.ts).toLocaleString("es-ES"), f.tipo, f.metodo, an.has(f.id) ? "ANULADO por correccion" : "vigente", f.corrige_a || "", f.motivo_correccion || "", new Date(f.creado_en).toLocaleString("es-ES")]);
          descargar(`registro_horario_${datos.centroNombre}_${desde}_${hasta}.csv`, out);
        }}>⬇ CSV registro completo (Inspección)</button>
      </div>
      {!datos ? (
        <div className="vacio">Elige centro y periodo, y pulsa Calcular.</div>
      ) : !ids.length ? (
        <div className="vacio">Sin turnos ni fichajes en este periodo.</div>
      ) : (
        <table className="inf">
          <thead><tr><th>Empleado</th><th>Planificado</th><th>Fichado</th><th>Desviación</th></tr></thead>
          <tbody>
            {ids.map((id) => {
              const r = datos.filas[id];
              const d = r.real - r.plan;
              tp += r.plan; tr += r.real;
              const cl = Math.abs(d) < 0.02 ? "" : d > 0 ? "desv-mas" : "desv-menos";
              return (
                <tr key={id}>
                  <td className="np">{datos.nombres[id] || "—"}{r.inc ? <span className="aviso-inc">⚠ {r.inc}</span> : null}</td>
                  <td>{r.plan.toFixed(2)} h</td>
                  <td>{r.real.toFixed(2)} h</td>
                  <td className={cl}>{d >= 0 ? "+" : ""}{d.toFixed(2)} h</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total {datos.centroNombre}</td>
              <td>{tp.toFixed(2)} h</td>
              <td>{tr.toFixed(2)} h</td>
              <td className={tr - tp > 0 ? "desv-mas" : tr - tp < 0 ? "desv-menos" : ""}>{tr - tp >= 0 ? "+" : ""}{(tr - tp).toFixed(2)} h</td>
            </tr>
          </tfoot>
        </table>
      )}
      <div className="nota-inf">
        Horas fichadas = entradas↔salidas menos pausas, con las correcciones ya aplicadas. Planificado = solo turnos publicados. El registro completo para Inspección incluye método, correcciones y motivos, tal como exige la normativa.
      </div>
    </>
  );
}

/* ==================== EMPLEADOS ==================== */

function SecEmpleados({ ctx, avisar }: { ctx: Ctx; avisar: (m: string) => void }) {
  const [maestros, setMaestros] = useState<Awaited<ReturnType<typeof api.cargarMaestros>> | null>(null);
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.cargarEmpleados>> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [fCentro, setFCentro] = useState("");
  const [fDepto, setFDepto] = useState("");
  const [soloActivos, setSoloActivos] = useState(false);

  const cargar = useCallback(() => { api.cargarEmpleados().then(setDatos); }, []);
  useEffect(() => {
    api.cargarMaestros().then(setMaestros);
    cargar();
  }, [cargar]);

  if (!maestros || !datos) return <div className="vacio">Cargando…</div>;
  const nombreCentro = (id: string | null) => maestros.centros.find((c) => c.id === id)?.nombre || "—";

  const f = filtro.toLowerCase();
  const lista = datos.empleados.filter(
    (e) =>
      `${e.nombre} ${e.apellidos || ""}`.toLowerCase().includes(f) &&
      (!fDepto || e.departamento === fDepto) &&
      (!fCentro || e.centro_principal_id === fCentro) &&
      (!soloActivos || e._activo),
  );
  const centrosUsados = [...new Set(datos.empleados.map((e) => e.centro_principal_id).filter(Boolean))];
  const base = fCentro ? datos.empleados.filter((e) => e.centro_principal_id === fCentro) : datos.empleados;
  const depUsados = [...new Set(base.map((e) => e.departamento).filter(Boolean))].sort() as string[];
  const nActivos = datos.empleados.filter((e) => e._activo).length;
  const empleadoSel = sel ? datos.empleados.find((e) => e.id === sel) ?? null : null;

  return (
    <>
      <div className="barra">
        {ctx.esGestor ? (
          <button className="btn btn-primario" onClick={async () => {
            const nombre = prompt("Nombre del empleado:");
            if (!nombre?.trim()) return;
            const apellidos = prompt("Apellidos:") ?? "";
            const idx = Number(prompt(`Centro principal (número):\n${maestros.centros.map((c, i) => `${i + 1}. ${c.nombre}`).join("\n")}`));
            const centro = maestros.centros[idx - 1];
            if (!centro) { avisar("Centro no válido"); return; }
            const horas = Number(prompt("Horas/semana del contrato:", "40")) || null;
            const r = await api.altaEmpleado({ nombre: nombre.trim(), apellidos: apellidos.trim(), centroId: centro.id, horasSemana: horas });
            if (!r.ok) { avisar("No se pudo crear: " + r.error); return; }
            avisar(`${nombre} añadido a ${centro.nombre}`);
            cargar();
            setSel(r.data ?? null);
          }}>+ Añadir empleado</button>
        ) : null}
      </div>
      <div className="layout-emp">
        <aside className="aside-emp">
          <input placeholder="Buscar por nombre…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          <select value={fCentro} onChange={(e) => { setFCentro(e.target.value); setFDepto(""); }}>
            <option value="">Todos los centros</option>
            {maestros.centros.filter((c) => centrosUsados.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <select value={fDepto} onChange={(e) => setFDepto(e.target.value)}>
            <option value="">Todos los departamentos</option>
            {depUsados.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <div className="contador-emp">
            {lista.length} de {datos.empleados.length} ·{" "}
            <label style={{ display: "inline", fontWeight: 400, margin: 0, cursor: "pointer" }}>
              <input type="checkbox" checked={soloActivos} onChange={(e) => setSoloActivos(e.target.checked)} style={{ width: "auto", verticalAlign: "middle" }} /> solo activos ({nActivos})
            </label>
          </div>
          <div className="lista-emp">
            {lista.map((e) => (
              <div key={e.id} className={`item-emp ${sel === e.id ? "activo" : ""}`} style={e._activo ? undefined : { opacity: 0.5 }} onClick={() => setSel(e.id)}>
                <div className="avatar">{iniciales(e.nombre + " " + (e.apellidos || ""))}</div>
                <div>
                  <div className="np">{e.nombre} {e.apellidos || ""}{e._activo ? "" : <span style={{ fontSize: 10, color: "var(--tinta-suave)", fontWeight: 400 }}> · inactivo</span>}</div>
                  <div className="sub">{nombreCentro(e.centro_principal_id)}{e.departamento ? ` · ${e.departamento}` : ""}</div>
                </div>
              </div>
            ))}
            {!lista.length ? <div className="vacio">Sin resultados.</div> : null}
          </div>
        </aside>
        <section>
          {!empleadoSel ? (
            <div className="vacio">Elige a alguien de la lista.</div>
          ) : (
            <FichaEmpleado
              key={empleadoSel.id}
              empleado={empleadoSel}
              maestros={maestros}
              asignados={datos.asignaciones[empleadoSel.id] ?? []}
              esGestor={ctx.esGestor}
              avisar={avisar}
              recargar={cargar}
            />
          )}
        </section>
      </div>
    </>
  );
}

function FichaEmpleado({ empleado: e, maestros, asignados, esGestor, avisar, recargar }: {
  empleado: Empleado;
  maestros: Awaited<ReturnType<typeof api.cargarMaestros>>;
  asignados: string[];
  esGestor: boolean;
  avisar: (m: string) => void;
  recargar: () => void;
}) {
  const [nombre, setNombre] = useState(e.nombre);
  const [apellidos, setApellidos] = useState(e.apellidos ?? "");
  const [email, setEmail] = useState(e.email ?? "");
  const [telefono, setTelefono] = useState(e.telefono ?? "");
  const [centroId, setCentroId] = useState(e.centro_principal_id ?? maestros.centros[0]?.id ?? "");
  const [depto, setDepto] = useState(e.departamento ?? "");
  const [contrato, setContrato] = useState(e.tipo_contrato ?? "");
  const [movil, setMovil] = useState(!!e.fichaje_movil);
  const [periodos, setPeriodos] = useState<Periodo[] | null>(null);
  const [historial, setHistorial] = useState<Fichaje[] | null>(null);
  const [pinNuevo, setPinNuevo] = useState("");
  const [nAlta, setNAlta] = useState(hoyIso());
  const [nBaja, setNBaja] = useState("");
  const [nHoras, setNHoras] = useState("");

  const cargarPeriodos = useCallback(() => { api.periodosDe(e.id).then(setPeriodos); }, [e.id]);
  useEffect(() => {
    cargarPeriodos();
    api.historicoFichajes(e.id).then(setHistorial);
  }, [e.id, cargarPeriodos]);

  const dis = !esGestor;
  const deptosCentro = maestros.deptosPorCentro[centroId]?.length ? maestros.deptosPorCentro[centroId] : maestros.departamentos;
  const hoy = hoyIso();
  const estadoPeriodo = (p: Periodo) =>
    p.fecha_alta > hoy
      ? { txt: "Próximo", color: "var(--blue)", bg: "var(--blue-light)" }
      : p.fecha_baja && p.fecha_baja < hoy
        ? { txt: "Finalizado", color: "var(--tinta-suave)", bg: "var(--arena)" }
        : { txt: "Activo", color: "var(--green)", bg: "var(--green-light)" };

  // Histórico agrupado por día
  const dias: Record<string, Fichaje[]> = {};
  for (const fch of historial ?? []) {
    const d = new Date(fch.ts).toLocaleDateString("sv-SE");
    (dias[d] = dias[d] || []).push(fch);
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="cab-ficha">
        <div className="avatar grande">{iniciales(e.nombre + " " + (e.apellidos || ""))}</div>
        <h2>{e.nombre} {e.apellidos || ""}</h2>
        {e.departamento ? <span className="badge" style={{ background: "var(--arena)" }}>{e.departamento}</span> : null}
        {e.fichaje_movil ? <span className="badge encurso">Fichaje móvil</span> : null}
      </div>
      <div className="subcab">Asignado a: {asignados.length ? asignados.map((id) => maestros.centros.find((c) => c.id === id)?.nombre || "—").join(" · ") : "Sin asignaciones"}</div>

      <div className="panel">
        <h3>Datos</h3>
        <form onSubmit={async (ev) => {
          ev.preventDefault();
          const r = await api.guardarEmpleado(e.id, {
            nombre: nombre.trim(),
            apellidos: apellidos.trim() || null,
            email: email.trim() || null,
            telefono: telefono.trim() || null,
            centro_principal_id: centroId,
            tipo_contrato: contrato.trim() || null,
            departamento: depto.replace(/ \(otro centro\)$/, "").trim() || null,
            fichaje_movil: movil,
          }, asignados);
          if (!r.ok) { avisar("No se pudo guardar: " + r.error); return; }
          avisar("Ficha guardada");
          recargar();
        }}>
          <div className="grid-2">
            <div><label>Nombre</label><input value={nombre} onChange={(ev) => setNombre(ev.target.value)} disabled={dis} style={{ width: "100%" }} /></div>
            <div><label>Apellidos</label><input value={apellidos} onChange={(ev) => setApellidos(ev.target.value)} disabled={dis} style={{ width: "100%" }} /></div>
            <div><label>Email</label><input value={email} onChange={(ev) => setEmail(ev.target.value)} disabled={dis} style={{ width: "100%" }} /></div>
            <div><label>Teléfono</label><input value={telefono} onChange={(ev) => setTelefono(ev.target.value)} disabled={dis} style={{ width: "100%" }} /></div>
          </div>
          <div className="grid-2">
            <div><label>Centro principal</label>
              <select value={centroId} onChange={(ev) => setCentroId(ev.target.value)} disabled={dis} style={{ width: "100%" }}>
                {maestros.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div><label>Departamento</label>
              <select value={depto} onChange={(ev) => setDepto(ev.target.value)} disabled={dis} style={{ width: "100%" }}>
                <option value="">— sin asignar —</option>
                {deptosCentro.map((d) => <option key={d} value={d}>{d}</option>)}
                {depto && !deptosCentro.includes(depto) ? <option value={depto}>{depto} (otro centro)</option> : null}
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div><label>Tipo de contrato</label>
              <select value={contrato} onChange={(ev) => setContrato(ev.target.value)} disabled={dis} style={{ width: "100%" }}>
                <option value="">— sin asignar —</option>
                {maestros.contratos.map((c) => <option key={c} value={c}>{c}</option>)}
                {contrato && !maestros.contratos.includes(contrato) ? <option value={contrato}>{contrato}</option> : null}
              </select>
            </div>
            <div />
          </div>
          <div className="check">
            <input type="checkbox" id="rh-ef-movil" checked={movil} onChange={(ev) => setMovil(ev.target.checked)} disabled={dis} />
            <label htmlFor="rh-ef-movil" style={{ margin: 0 }}>Puede fichar desde el móvil (con geolocalización)</label>
          </div>
          {esGestor ? <div className="fila-acciones"><button className="btn btn-primario" type="submit">Guardar cambios</button></div> : null}
        </form>
      </div>

      <div className="panel">
        <h3>Periodos de contrato</h3>
        <div className="nota" style={{ marginBottom: 10 }}>
          Para fijos-discontinuos, cada temporada es un periodo (alta–baja). La fecha de baja es el último día que trabaja. Fuera de sus periodos, el empleado no aparece en el cuadrante.
        </div>
        {periodos === null ? (
          <div className="nota">Cargando…</div>
        ) : !periodos.length ? (
          <div className="nota">Sin periodos registrados.</div>
        ) : (
          <table className="aj" style={{ marginBottom: esGestor ? 14 : 0 }}>
            <thead><tr><th>Alta</th><th>Baja</th><th>Horas/sem.</th><th>Estado</th>{esGestor ? <th /> : null}</tr></thead>
            <tbody>
              {periodos.map((p) => {
                const s = estadoPeriodo(p);
                return (
                  <tr key={p.id}>
                    <td>{fmtDia(p.fecha_alta)}</td>
                    <td>{p.fecha_baja ? fmtDia(p.fecha_baja) : <span style={{ color: "var(--tinta-suave)" }}>abierto</span>}</td>
                    <td>{p.horas_semana != null ? `${p.horas_semana} h` : "—"}</td>
                    <td><span className="badge" style={{ background: s.bg, color: s.color, fontWeight: 600 }}>{s.txt}</span></td>
                    {esGestor ? (
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {!p.fecha_baja ? (
                          <>
                            <button className="link-btn2" onClick={async () => {
                              const fb = prompt("Último día que trabaja (AAAA-MM-DD):", hoy);
                              if (!fb) return;
                              if (!/^\d{4}-\d{2}-\d{2}$/.test(fb)) { avisar("Formato de fecha no válido"); return; }
                              const r = await api.guardarPeriodo(p.id, e.id, { fecha_alta: p.fecha_alta, fecha_baja: fb, horas_semana: p.horas_semana });
                              if (!r.ok) { avisar("No se pudo cerrar: " + r.error); return; }
                              avisar("Periodo cerrado"); cargarPeriodos(); recargar();
                            }}>Cerrar</button>{" · "}
                          </>
                        ) : null}
                        <button className="link-btn2" onClick={async () => {
                          const alta = prompt("Fecha de alta (AAAA-MM-DD):", p.fecha_alta);
                          if (!alta) return;
                          const baja = prompt("Fecha de baja (AAAA-MM-DD, vacío = abierto):", p.fecha_baja || "");
                          const horas = prompt("Horas/semana (vacío = sin definir):", p.horas_semana != null ? String(p.horas_semana) : "");
                          const r = await api.guardarPeriodo(p.id, e.id, { fecha_alta: alta, fecha_baja: baja || null, horas_semana: horas === "" || horas == null ? null : Number(horas) });
                          if (!r.ok) { avisar("No se pudo guardar: " + r.error); return; }
                          avisar("Periodo actualizado"); cargarPeriodos(); recargar();
                        }}>Editar</button>{" · "}
                        <button className="link-btn2" style={{ color: "var(--red)" }} onClick={async () => {
                          if (!confirm("¿Borrar este periodo? Se usa para saber cuándo el empleado está activo.")) return;
                          const r = await api.borrarPeriodo(p.id, e.id);
                          if (!r.ok) { avisar("No se pudo borrar: " + r.error); return; }
                          avisar("Periodo borrado"); cargarPeriodos(); recargar();
                        }}>Borrar</button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {esGestor ? (
          <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <div><label style={{ marginTop: 0 }}>Alta</label><input type="date" value={nAlta} onChange={(ev) => setNAlta(ev.target.value)} /></div>
            <div><label style={{ marginTop: 0 }}>Baja (opcional)</label><input type="date" value={nBaja} onChange={(ev) => setNBaja(ev.target.value)} /></div>
            <div><label style={{ marginTop: 0 }}>Horas/sem.</label><input type="number" step={0.5} min={0} value={nHoras} onChange={(ev) => setNHoras(ev.target.value)} style={{ width: 90 }} placeholder="40" /></div>
            <button className="btn btn-primario btn-peque" onClick={async () => {
              if (!nAlta) { avisar("Indica la fecha de alta"); return; }
              const r = await api.guardarPeriodo(null, e.id, { fecha_alta: nAlta, fecha_baja: nBaja || null, horas_semana: nHoras === "" ? null : Number(nHoras) });
              if (!r.ok) { avisar("No se pudo añadir: " + r.error); return; }
              avisar("Periodo añadido"); setNBaja(""); setNHoras(""); cargarPeriodos(); recargar();
            }}>Añadir periodo</button>
          </div>
        ) : null}
      </div>

      <div className="panel">
        <h3>PIN de fichaje</h3>
        <div className="pin-caja">
          <span className="nota">El PIN no se puede consultar (solo se guarda cifrado).</span>
          <button className="btn btn-fantasma" onClick={async () => {
            if (!confirm(`Generar un PIN nuevo para ${e.nombre}? El anterior dejará de funcionar al instante.`)) return;
            const r = await fetch("/api/rrhh/fichar", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ accion: "nuevo_pin", empleado_id: e.id }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.ok) { avisar(d.error || "No se pudo generar el PIN"); return; }
            setPinNuevo(d.pin);
          }}>Generar nuevo PIN</button>
          <span className="pin-valor">{pinNuevo}</span>
        </div>
        {pinNuevo ? <div className="nota" style={{ marginTop: 6 }}>Apúntalo y dáselo ahora: no se volverá a mostrar.</div> : null}
      </div>

      <div className="panel">
        <h3>Fichajes · últimos 14 días</h3>
        {historial === null ? (
          <div className="nota">Cargando…</div>
        ) : !historial.length ? (
          <div className="nota">Sin fichajes en las dos últimas semanas.</div>
        ) : (
          Object.keys(dias).sort().reverse().map((d) => {
            const { efectivos, anulados } = efectivosDe(dias[d]);
            const { horas, inc, enCurso } = calcularDia(efectivos, d === hoy);
            const sinSalida = inc.includes("entrada sin salida");
            return (
              <div key={d} className="dia-h">
                <span className="f">{new Date(d + "T12:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}</span>
                <span className="h">{horas.toFixed(2)} h</span>
                {dias[d].map((fch) => {
                  const anu = anulados.has(fch.id);
                  const cl = anu ? fch.tipo + " anulado" : fch.metodo === "correccion" ? "correccion" : fch.tipo;
                  return (
                    <span key={fch.id} className={`chip ${cl}`} style={{ cursor: "default" }} title={fch.metodo === "correccion" ? fch.motivo_correccion || "" : fch.metodo}>
                      {NT[fch.tipo]} {horaDe(fch.ts)}
                    </span>
                  );
                })}
                {enCurso && d === hoy ? <span className="badge-inc" style={{ background: "var(--green-light)", color: "var(--green)" }}>En curso</span> : null}
                {sinSalida ? <span className="badge-inc">⚠ sin salida</span> : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ==================== AUSENCIAS ==================== */

function SecAusencias({ ctx, avisar }: { ctx: Ctx; avisar: (m: string) => void }) {
  const [lista, setLista] = useState<Ausencia[] | null>(null);
  const [filtro, setFiltro] = useState("");
  const [alta, setAlta] = useState(false);
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [aEmp, setAEmp] = useState("");
  const [aTipo, setATipo] = useState("vacaciones");
  const [aDesde, setADesde] = useState(hoyIso());
  const [aHasta, setAHasta] = useState(hoyIso());
  const [aEstado, setAEstado] = useState<"solicitada" | "aprobada">("solicitada");

  const cargar = useCallback(() => { api.listarAusencias().then(setLista); }, []);
  useEffect(() => {
    cargar();
    api.cargarEmpleados().then((d) => setEmpleados(d.empleados.filter((e) => e._activo)));
  }, [cargar]);

  const visibles = (lista ?? []).filter((a) => !filtro || a.estado === filtro);
  const PILL: Record<string, [string, string]> = {
    solicitada: ["var(--amber-light)", "var(--amber)"],
    aprobada: ["var(--green-light)", "var(--green)"],
    rechazada: ["var(--red-light)", "var(--red)"],
  };

  return (
    <>
      <div className="barra">
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="">Todas</option>
          <option value="solicitada">Solicitadas</option>
          <option value="aprobada">Aprobadas</option>
          <option value="rechazada">Rechazadas</option>
        </select>
        <button className="btn btn-primario" onClick={() => { setAEmp(empleados[0]?.id ?? ""); setAlta(true); }}>+ Nueva ausencia</button>
      </div>
      {lista === null ? (
        <div className="vacio">Cargando…</div>
      ) : !visibles.length ? (
        <div className="vacio">Sin ausencias{filtro ? ` en estado «${filtro}»` : ""}. Las solicitudes de los empleados aparecerán aquí.</div>
      ) : (
        <div style={{ maxWidth: 860 }}>
          {visibles.map((a) => {
            const [bg, color] = PILL[a.estado] ?? ["var(--arena)", "var(--tinta)"];
            return (
              <div key={a.id} className="tarjeta-f">
                <div className="fila-cab">
                  <h3>{a.empleados?.nombre} {a.empleados?.apellidos || ""}</h3>
                  <span className="badge" style={{ background: "var(--arena)" }}>{a.tipo}</span>
                  <span>{fmtDia(a.fecha_inicio)} → {fmtDia(a.fecha_fin)}</span>
                  <span className="badge" style={{ background: bg, color }}>{a.estado}</span>
                  {a.estado === "solicitada" ? (
                    <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                      <button className="btn btn-primario btn-peque" onClick={async () => {
                        const r = await api.resolverAusencia(a.id, "aprobada");
                        if (!r.ok) { avisar(r.error || "No se pudo"); return; }
                        avisar("Ausencia aprobada"); cargar();
                      }}>Aprobar</button>
                      <button className="btn btn-borrar btn-peque" onClick={async () => {
                        const r = await api.resolverAusencia(a.id, "rechazada");
                        if (!r.ok) { avisar(r.error || "No se pudo"); return; }
                        avisar("Ausencia rechazada"); cargar();
                      }}>Rechazar</button>
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {alta ? (
        <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) setAlta(false); }}>
          <form className="modal" onSubmit={async (e) => {
            e.preventDefault();
            if (!aEmp) return;
            const r = await api.crearAusencia({ empleadoId: aEmp, tipo: aTipo, desde: aDesde, hasta: aHasta, estado: aEstado });
            if (!r.ok) { avisar(r.error || "No se pudo crear"); return; }
            setAlta(false); avisar(aEstado === "aprobada" ? "Ausencia registrada y aprobada" : "Ausencia registrada como solicitada"); cargar();
          }}>
            <h2>Nueva ausencia</h2>
            <label>Empleado</label>
            <select value={aEmp} onChange={(e) => setAEmp(e.target.value)}>
              {empleados.map((emp) => <option key={emp.id} value={emp.id}>{emp.nombre} {emp.apellidos || ""}</option>)}
            </select>
            <div className="fila-2">
              <div><label>Tipo</label>
                <select value={aTipo} onChange={(e) => setATipo(e.target.value)}>
                  {TIPOS_AUSENCIA_ENUM.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><label>Estado</label>
                <select value={aEstado} onChange={(e) => setAEstado(e.target.value as "solicitada" | "aprobada")}>
                  <option value="solicitada">Solicitada (pendiente de aprobar)</option>
                  <option value="aprobada">Aprobada directamente</option>
                </select>
              </div>
            </div>
            <div className="fila-2">
              <div><label>Desde</label><input type="date" required value={aDesde} onChange={(e) => setADesde(e.target.value)} /></div>
              <div><label>Hasta</label><input type="date" required value={aHasta} onChange={(e) => setAHasta(e.target.value)} /></div>
            </div>
            <div className="modal-acciones">
              <button type="button" className="btn btn-fantasma" onClick={() => setAlta(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primario">Guardar</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

/* ==================== DISPOSITIVOS ==================== */

function SecDispositivos({ ctx, avisar }: { ctx: Ctx; avisar: (m: string) => void }) {
  const [lista, setLista] = useState<Dispositivo[] | null>(null);
  const [tokenNuevo, setTokenNuevo] = useState<{ nombre: string; token: string } | null>(null);
  const [alta, setAlta] = useState(false);
  const [nNombre, setNNombre] = useState("");
  const [nCentro, setNCentro] = useState(ctx.centros[0]?.id ?? "");

  const cargar = useCallback(() => { api.listarDispositivos().then(setLista); }, []);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <>
      <div className="barra">
        <button className="btn btn-primario" onClick={() => setAlta(true)}>+ Nueva tablet</button>
      </div>
      {tokenNuevo ? (
        <div className="aviso-caja" style={{ maxWidth: 860 }}>
          Código de <b>{tokenNuevo.nombre}</b> (cópialo ahora, no se volverá a mostrar):{" "}
          <code style={{ fontSize: 14, fontWeight: 700, userSelect: "all" }}>{tokenNuevo.token}</code>
          {" "}· pégalo en el kiosco de la tablet (/kiosco).
        </div>
      ) : null}
      {lista === null ? (
        <div className="vacio">Cargando…</div>
      ) : (
        <div className="panel" style={{ maxWidth: 860 }}>
          <table className="aj">
            <thead><tr><th>Tablet</th><th>Centro</th><th className="c">Activa</th><th /></tr></thead>
            <tbody>
              {lista.map((d) => (
                <tr key={d.id}>
                  <td>{d.nombre}</td>
                  <td>{d.centros?.nombre || "—"}</td>
                  <td className="c">
                    <label className="switch">
                      <input type="checkbox" checked={d.activo} onChange={async (e) => {
                        const r = await api.toggleDispositivo(d.id, e.target.checked);
                        avisar(r.ok ? (e.target.checked ? "Tablet activada" : "Tablet desactivada") : r.error || "No se pudo");
                        cargar();
                      }} />
                      <span className="slider" />
                    </label>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="link-btn2" onClick={async () => {
                      if (!confirm(`¿Regenerar el código de «${d.nombre}»? El actual dejará de funcionar y habrá que pegarlo de nuevo en esa tablet.`)) return;
                      const r = await api.regenerarToken(d.id);
                      if (!r.ok || !r.data) { avisar(r.error || "No se pudo"); return; }
                      setTokenNuevo({ nombre: d.nombre ?? "tablet", token: r.data });
                    }}>Regenerar código</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="nota" style={{ marginTop: 10 }}>
            El código solo se guarda cifrado: al crear o regenerar se muestra una única vez. Las tablets lo recuerdan en su pantalla de configuración (5 toques en la cabecera del kiosco).
          </div>
        </div>
      )}

      {alta ? (
        <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) setAlta(false); }}>
          <form className="modal" onSubmit={async (e) => {
            e.preventDefault();
            if (!nNombre.trim()) return;
            const r = await api.crearDispositivo(nCentro, nNombre.trim());
            if (!r.ok || !r.data) { avisar(r.error || "No se pudo crear"); return; }
            setAlta(false);
            setTokenNuevo({ nombre: nNombre.trim(), token: r.data });
            setNNombre("");
            cargar();
          }}>
            <h2>Nueva tablet</h2>
            <label>Nombre</label>
            <input value={nNombre} onChange={(e) => setNNombre(e.target.value)} placeholder="Tablet Casa Tirant barra" />
            <label>Centro</label>
            <select value={nCentro} onChange={(e) => setNCentro(e.target.value)}>
              {ctx.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <div className="modal-acciones">
              <button type="button" className="btn btn-fantasma" onClick={() => setAlta(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primario">Crear y ver código</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

/* ==================== AJUSTES ==================== */

function SecAjustes({ avisar }: { avisar: (m: string) => void }) {
  const [sub, setSub] = useState<"convenios" | "centros" | "ausencias" | "catalogos" | "matriz">("convenios");
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.cargarAjustes>> | null>(null);
  const [convSel, setConvSel] = useState<string | null>(null);
  const [reglas, setReglas] = useState<Record<string, string>>({});

  const REGLAS: [keyof Convenio & string, string, string, string][] = [
    ["descanso_diario_h", "Descanso diario mínimo", "horas libres entre jornadas", "h"],
    ["descanso_semanal_dias", "Descanso semanal", "días libres consecutivos por semana", "días"],
    ["max_dias_consecutivos", "Máximo días seguidos", "días de trabajo sin descanso", "días"],
    ["jornada_max_diaria_h", "Jornada máxima diaria", "horas máximas en un día", "h"],
    ["jornada_min_diaria_h", "Jornada mínima por turno", "salvo petición del trabajador", "h"],
    ["jornada_max_semanal_h", "Jornada máxima semanal", "media semanal anual", "h"],
    ["pausa_tras_h", "Pausa obligatoria tras", "horas seguidas trabajadas", "h"],
    ["pausa_min_minutos", "Duración mínima de la pausa", "", "min"],
  ];

  const cargar = useCallback(() => {
    api.cargarAjustes().then((d) => {
      setDatos(d);
      setConvSel((prev) => prev ?? (d.convenios.find((c) => c.es_por_defecto) || d.convenios[0])?.id ?? null);
    });
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    if (!datos || !convSel) return;
    const c = datos.convenios.find((x) => x.id === convSel);
    if (!c) return;
    const r: Record<string, string> = {};
    for (const [k] of REGLAS) r[k] = c[k] != null ? String(c[k]) : "";
    setReglas(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos, convSel]);

  if (!datos) return <div className="vacio">Cargando…</div>;
  const conv = datos.convenios.find((x) => x.id === convSel);
  const configDe = (centroId: string) => datos.config.find((c) => c.centro_id === centroId);
  const matrizSet = new Set(datos.matriz.map((r) => `${r.centro_id}|${r.departamento_id}`));

  const SUBS: [typeof sub, string, string][] = [
    ["convenios", "Convenios y reglas", "Descansos, jornadas, avisos"],
    ["centros", "Centros y fichaje", "Ubicación, radio y convenio"],
    ["ausencias", "Tipos de ausencia", "Catálogo y vacaciones"],
    ["catalogos", "Departamentos y contratos", "Listas de la ficha"],
    ["matriz", "Departamentos por centro", "Qué hay en cada centro"],
  ];

  return (
    <>
      <div className="barra" />
      <div className="layout-aj">
        <aside className="aside-aj">
          {SUBS.map(([id, titulo, det]) => (
            <button key={id} className={`nav-sec ${sub === id ? "activa" : ""}`} onClick={() => setSub(id)}>
              {titulo}<small>{det}</small>
            </button>
          ))}
        </aside>
        <section className="aj-cuerpo">
          {sub === "convenios" && conv ? (
            <>
              <h2>Convenios y reglas</h2>
              <div className="nota" style={{ margin: "4px 0 14px" }}>Las reglas alimentan los avisos del cuadrante. No bloquean: avisan al encargado.</div>
              <div className="chip-conv">
                {datos.convenios.map((x) => (
                  <button key={x.id} className={x.id === convSel ? "activa" : ""} onClick={() => setConvSel(x.id)}>
                    {x.nombre}{x.es_por_defecto ? <span className="badge-def">por defecto</span> : null}
                  </button>
                ))}
              </div>
              <div className="panel">
                <h3>Reglas de «{conv.nombre}»</h3>
                <div className="nota" style={{ marginBottom: 12 }}>Deja un campo vacío para desactivar ese aviso.</div>
                {REGLAS.map(([k, t, d, u]) => (
                  <div key={k} className="grid-regla">
                    <div className="txt">{t}<small>{d}</small></div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="number" step={0.5} min={0} value={reglas[k] ?? ""} onChange={(e) => setReglas({ ...reglas, [k]: e.target.value })} />
                      <span style={{ fontSize: 12, color: "var(--tinta-suave)", minWidth: 26 }}>{u}</span>
                    </div>
                  </div>
                ))}
                <div className="fila-guardar">
                  <button className="btn btn-primario" onClick={async () => {
                    const campos: Record<string, number | null> = {};
                    for (const [k] of REGLAS) campos[k] = reglas[k] === "" ? null : Number(reglas[k]);
                    const r = await api.guardarConvenio(conv.id, campos);
                    avisar(r.ok ? "Reglas guardadas" : "No se pudo guardar: " + r.error);
                    if (r.ok) cargar();
                  }}>Guardar reglas</button>
                </div>
              </div>
            </>
          ) : null}

          {sub === "centros" ? (
            <>
              <h2>Centros y fichaje</h2>
              <div className="nota" style={{ margin: "4px 0 14px" }}>Coordenadas y radio para el fichaje móvil, convenio y pacto de descanso por centro.</div>
              <div className="aviso-caja">Para obtener lat/lng: abre Google Maps, clic derecho sobre el local y copia los dos números.</div>
              {datos.centros.map((c) => {
                const cfg = configDe(c.id);
                if (!cfg) return null;
                return <PanelCentroConfig key={c.id} centro={c} cfg={cfg} convenios={datos.convenios} avisar={avisar} recargar={cargar} />;
              })}
            </>
          ) : null}

          {sub === "ausencias" ? (
            <>
              <h2>Tipos de ausencia</h2>
              <div className="nota" style={{ margin: "4px 0 14px" }}>Qué ausencias existen, cuáles restan de vacaciones y cuáles puede pedir el empleado.</div>
              <div className="panel">
                <table className="aj">
                  <thead><tr><th>Tipo</th><th className="c">Activo</th><th className="c">Resta vacaciones</th><th className="c">La pide el empleado</th></tr></thead>
                  <tbody>
                    {datos.tiposAusencia.map((t) => (
                      <tr key={t.id}>
                        <td>{t.nombre}</td>
                        {(["activo", "computa_vacaciones", "solicitable_empleado"] as const).map((campo) => (
                          <td key={campo} className="c">
                            <label className="switch">
                              <input type="checkbox" checked={!!t[campo]} onChange={async (e) => {
                                const r = await api.guardarCatalogo("rrhh_tipos_ausencia", t.id, { [campo]: e.target.checked });
                                avisar(r.ok ? "Guardado" : "No se pudo guardar");
                                cargar();
                              }} />
                              <span className="slider" />
                            </label>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <AnadirCatalogo tabla="rrhh_tipos_ausencia" titulo="Añadir tipo" placeholder="Ej.: Permiso por mudanza" avisar={avisar} recargar={cargar} />
            </>
          ) : null}

          {sub === "catalogos" ? (
            <>
              <h2>Departamentos y contratos</h2>
              <div className="nota" style={{ margin: "4px 0 14px" }}>Las listas de la ficha del empleado. Desactivar un valor lo oculta de los desplegables, pero no cambia a quien ya lo tenga.</div>
              {([["Departamentos", "departamentos", datos.departamentos], ["Tipos de contrato", "rrhh_tipos_contrato", datos.tiposContrato]] as const).map(([titulo, tabla, filas]) => (
                <div key={tabla} className="panel">
                  <h3>{titulo}</h3>
                  <table className="aj">
                    <thead><tr><th>Nombre</th><th className="c">Activo</th><th className="c" /></tr></thead>
                    <tbody>
                      {filas.map((fila) => (
                        <tr key={fila.id}>
                          <td>{fila.nombre}</td>
                          <td className="c">
                            <label className="switch">
                              <input type="checkbox" checked={!!fila.activo} onChange={async (e) => {
                                const r = await api.guardarCatalogo(tabla, fila.id, { activo: e.target.checked });
                                avisar(r.ok ? "Guardado" : "No se pudo guardar");
                                cargar();
                              }} />
                              <span className="slider" />
                            </label>
                          </td>
                          <td className="c">
                            <button className="btn btn-fantasma btn-peque" onClick={async () => {
                              if (!confirm("¿Quitar este valor de la lista? Quien ya lo tenga asignado lo conserva.")) return;
                              const r = await api.borrarCatalogo(tabla, fila.id);
                              avisar(r.ok ? "Quitado" : r.error || "No se pudo quitar");
                              cargar();
                            }}>Quitar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <AnadirCatalogo tabla={tabla} titulo={`Añadir a ${titulo.toLowerCase()}`} placeholder="Nombre nuevo" avisar={avisar} recargar={cargar} />
                </div>
              ))}
            </>
          ) : null}

          {sub === "matriz" ? (
            <>
              <h2>Departamentos por centro</h2>
              <div className="nota" style={{ margin: "4px 0 14px" }}>Marca qué departamentos existen en cada centro. En la ficha del empleado, el desplegable mostrará solo los de su centro.</div>
              <div className="panel" style={{ overflowX: "auto" }}>
                <table className="aj" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", left: 0, background: "#fff" }}>Centro</th>
                      {datos.departamentos.filter((d) => d.activo).map((d) => (
                        <th key={d.id} className="c" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 90, whiteSpace: "nowrap" }}>{d.nombre}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {datos.centros.map((c) => (
                      <tr key={c.id}>
                        <td style={{ position: "sticky", left: 0, background: "#fff", fontWeight: 600 }}>{c.nombre}</td>
                        {datos.departamentos.filter((d) => d.activo).map((d) => (
                          <td key={d.id} className="c">
                            <label className="switch">
                              <input type="checkbox" checked={matrizSet.has(`${c.id}|${d.id}`)} onChange={async (e) => {
                                const r = await api.toggleMatriz(c.id, d.id, e.target.checked);
                                avisar(r.ok ? "Guardado" : "No se pudo guardar");
                                cargar();
                              }} />
                              <span className="slider" />
                            </label>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}

function PanelCentroConfig({ centro, cfg, convenios, avisar, recargar }: {
  centro: { id: string; nombre: string; lat: number | null; lng: number | null };
  cfg: { radio_fichaje_m: number | null; convenio_id: string | null; pacto_descanso_10h: boolean | null };
  convenios: Convenio[];
  avisar: (m: string) => void;
  recargar: () => void;
}) {
  const [lat, setLat] = useState(centro.lat != null ? String(centro.lat) : "");
  const [lng, setLng] = useState(centro.lng != null ? String(centro.lng) : "");
  const [radio, setRadio] = useState(String(cfg.radio_fichaje_m ?? 150));
  const [convenioId, setConvenioId] = useState(cfg.convenio_id ?? "");
  const [pacto, setPacto] = useState(!!cfg.pacto_descanso_10h);
  return (
    <div className="panel">
      <h3>{centro.nombre}</h3>
      <div className="grid-2">
        <div><label>Latitud</label><input type="number" step={0.000001} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="39.8xxxxx" style={{ width: "100%" }} /></div>
        <div><label>Longitud</label><input type="number" step={0.000001} value={lng} onChange={(e) => setLng(e.target.value)} placeholder="4.2xxxxx" style={{ width: "100%" }} /></div>
      </div>
      <div className="grid-2">
        <div><label>Radio de fichaje (metros)</label><input type="number" min={20} step={10} value={radio} onChange={(e) => setRadio(e.target.value)} style={{ width: "100%" }} /></div>
        <div><label>Convenio</label>
          <select value={convenioId} onChange={(e) => setConvenioId(e.target.value)} style={{ width: "100%" }}>
            {convenios.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select>
        </div>
      </div>
      <div className="check">
        <input type="checkbox" id={`rh-pacto-${centro.id}`} checked={pacto} onChange={(e) => setPacto(e.target.checked)} />
        <label htmlFor={`rh-pacto-${centro.id}`} style={{ margin: 0 }}>Pacto de descanso reducido a 10 h entre jornadas</label>
      </div>
      <div className="fila-guardar">
        <button className="btn btn-primario btn-peque" onClick={async () => {
          const r = await api.guardarCentroConfig(
            centro.id,
            { radio_fichaje_m: radio === "" ? 150 : Number(radio), convenio_id: convenioId || undefined, pacto_descanso_10h: pacto },
            { lat: lat === "" ? null : Number(lat), lng: lng === "" ? null : Number(lng) },
          );
          avisar(r.ok ? "Centro actualizado" : "No se pudo guardar: " + r.error);
          if (r.ok) recargar();
        }}>Guardar</button>
      </div>
    </div>
  );
}

function AnadirCatalogo({ tabla, titulo, placeholder, avisar, recargar }: {
  tabla: "rrhh_tipos_ausencia" | "rrhh_tipos_contrato" | "departamentos";
  titulo: string;
  placeholder: string;
  avisar: (m: string) => void;
  recargar: () => void;
}) {
  const [nombre, setNombre] = useState("");
  return (
    <div className="panel">
      <h3>{titulo}</h3>
      <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label style={{ marginTop: 0 }}>Nombre</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={placeholder} style={{ width: "100%" }} />
        </div>
        <button className="btn btn-primario btn-peque" onClick={async () => {
          if (!nombre.trim()) { avisar("Escribe un nombre"); return; }
          const r = await api.anadirCatalogo(tabla, nombre.trim());
          avisar(r.ok ? "Añadido" : "No se pudo añadir: " + r.error);
          if (r.ok) { setNombre(""); recargar(); }
        }}>Añadir</button>
      </div>
    </div>
  );
}
