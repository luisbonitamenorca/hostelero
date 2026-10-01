"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "../acciones";
import {
  DIAS_SEMANA, dowDe, finAbsoluto, fmtCorta, hh, horasNetas, hoyIso, lunesDe, minutos, sumaDia, type Empleado, type Turno,
} from "../tipos";
import type { SecProps } from "../lib-rrhh";
import "./planificacion.css";

export default function SecPlanificacion({ ctx, avisar }: SecProps) {
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
