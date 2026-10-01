"use client";

import { useState } from "react";
import * as api from "../acciones";
import {
  calcularDia, horaDe, horasNetas, hoyIso, type Fichaje,
} from "../tipos";
import type { SecProps } from "../lib-rrhh";
import "./informes.css";

export default function SecInformes({ ctx }: SecProps) {
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
      if (!t.empleado_id) continue;
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
