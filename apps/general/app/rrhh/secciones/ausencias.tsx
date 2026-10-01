"use client";

import { useCallback, useEffect, useState } from "react";
import * as api from "../acciones";
import {
  TIPOS_AUSENCIA_ENUM, fmtDia, hoyIso, type Ausencia, type Empleado,
} from "../tipos";
import type { SecProps } from "../lib-rrhh";
import "./ausencias.css";

export default function SecAusencias({ ctx, avisar }: SecProps) {
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
