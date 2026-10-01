"use client";

import { useCallback, useEffect, useState } from "react";
import * as api from "../acciones";
import {
  MET, NT, calcularDia, efectivosDe, horaDe, hoyIso, sumaDia, type Fichaje,
} from "../tipos";
import type { SecProps } from "../lib-rrhh";
import "./fichajes.css";

export default function SecFichajes({ ctx, avisar }: SecProps) {
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
