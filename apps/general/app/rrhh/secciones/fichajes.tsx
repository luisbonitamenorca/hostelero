"use client";

/* Sección Fichajes v2: «Semana» (validación planificado vs fichado) y «Jornada» (por día, como el
   «Control horario» de Skello: franja retenida por empleado y «Confirmar jornada»). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../acciones";
import * as apiF from "../acciones/fichajes";
import { MET, NT, hh, lunesDe, sumaDia, type Fichaje, type Turno } from "../tipos";
import { fmtFecha, fmtHoras, guardarPref, leerPref, semanaIso, useCentroRecordado, type SecProps } from "../lib-rrhh";
import {
  agruparJornadas, calcularDiaMin, descansoPlanDe, desviaciones, efectivosMin, estadoCelda, fechaHoraMadrid, hhmmDe, horaMadrid, horasFranja,
  horasPlanDe, hoyMadrid, isoMadrid, leerFranja, minutosDe, numH, redondearHoras, resumenJornada, retencionJornada, tramoPlanDe,
  type AusenciaDia, type EstadoCelda, type FichajeMin,
} from "./fichajes-calculo";
import "./fichajes.css";

type Vista = "semana" | "jornada";
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const ddmm = (f: string) => fmtFecha(f).slice(0, 5);
const mensajeError = (e: unknown) => (e instanceof Error ? e.message : String(e ?? "error desconocido"));

export default function SecFichajes({ ctx, avisar }: SecProps) {
  const [centroId, setCentroId] = useCentroRecordado(ctx.centros);
  const [vista, setVista] = useState<Vista>(() => {
    const v = leerPref<string>("fichajes:vista", "semana");
    return v === "jornada" || v === "dia" ? "jornada" : "semana";
  });
  // La semana y el día viven aquí: al cambiar de centro o de vista no se pierde dónde estabas (como en Skello).
  const [lunes, setLunes] = useState(() => lunesDe(hoyMadrid()));
  const [fecha, setFecha] = useState(() => hoyMadrid());

  const cambiarVista = (v: Vista) => {
    if (v === vista) return;
    if (v === "jornada") {
      // Al pasar a Jornada: hoy si está dentro de la semana que mirabas; si no, el lunes de esa semana.
      const hoy = hoyMadrid();
      setFecha(hoy >= lunes && hoy <= sumaDia(lunes, 6) ? hoy : lunes);
    } else {
      setLunes(lunesDe(fecha));
    }
    setVista(v);
    guardarPref("fichajes:vista", v);
  };

  const selector = (
    <select value={centroId} onChange={(e) => setCentroId(e.target.value)} aria-label="Centro">
      {ctx.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
    </select>
  );
  const toggle = (
    <div className="fichajes-vistas" role="tablist">
      <button role="tab" aria-selected={vista === "semana"} className={vista === "semana" ? "activa" : ""} onClick={() => cambiarVista("semana")}>Semana</button>
      <button role="tab" aria-selected={vista === "jornada"} className={vista === "jornada" ? "activa" : ""} onClick={() => cambiarVista("jornada")}>Jornada</button>
    </div>
  );

  return vista === "semana"
    ? <VistaSemana ctx={ctx} avisar={avisar} centroId={centroId} selector={selector} toggle={toggle} lunes={lunes} setLunes={setLunes} />
    : <VistaJornada ctx={ctx} avisar={avisar} centroId={centroId} selector={selector} toggle={toggle} fecha={fecha} setFecha={setFecha} />;
}

/* ==================== Semana ==================== */

type PropsVista = { avisar: (m: string) => void; centroId: string; selector: React.ReactNode; toggle: React.ReactNode };

type Celda = {
  fecha: string;
  turnos: Turno[];
  efs: FichajeMin[];
  ausencia: apiF.AusenciaSemana | null;
  hd: apiF.HorasDia | null;
  estado: EstadoCelda;
  horasFich: number;
  horasPlan: number;
  entrada: number | null;
  salida: number | null;
  pausasMin: number;
  retraso: number;
  salidaAntic: number;
  inc: string[];
  /** Debería tener fila en rrhh_horas_dia (día pasado con turno o fichajes y que no es ausencia). */
  esperaFila: boolean;
};

const TXT_ESTADO: Record<EstadoCelda, string> = {
  ok: "ok", desvio: "", incidencia: "", en_curso: "en curso", no_ficho: "no fichó",
  no_plan: "no planificado", ausencia: "", pendiente: "aún no ha empezado", futuro: "", vacio: "",
};

const fmtMin = (m: number | null) => (m == null ? "" : `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`);

const tipoAusenciaDia = (a: apiF.AusenciaSemana | null): AusenciaDia => (!a ? null : a.medio_dia || a.horas != null ? "parcial" : "completa");

function VistaSemana({ ctx, avisar, centroId, selector, toggle, lunes, setLunes }: PropsVista & { ctx: SecProps["ctx"]; lunes: string; setLunes: (l: string) => void }) {
  const [datos, setDatos] = useState<apiF.SemanaFichajes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState<"proponer" | "validar" | "reabrir" | null>(null);
  const [edicion, setEdicion] = useState<{ hd: apiF.HorasDia; nombre: string; celda: Celda } | null>(null);
  const domingo = sumaDia(lunes, 6);
  const hoy = hoyMadrid();

  // avisar puede cambiar de identidad en cada render: se usa por ref para no recargar en bucle.
  const avisarRef = useRef(avisar);
  avisarRef.current = avisar;

  const cargar = useCallback(() => {
    setError(null);
    const fallo = (msg: string) => { setDatos(null); setError(msg); avisarRef.current("No se pudo cargar: " + msg); };
    apiF.cargarSemanaFichajes(centroId, lunes)
      .then((r) => { if (r.ok && r.data) setDatos(r.data); else fallo(r.error ?? "No se pudo cargar la semana"); })
      .catch((e) => fallo(mensajeError(e)));
  }, [centroId, lunes]);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = useMemo(() => {
    if (!datos) return [];
    const { efectivos } = efectivosMin(datos.fichajes);
    const porEmp: Record<string, FichajeMin[]> = {};
    for (const f of efectivos) (porEmp[f.empleado_id] = porEmp[f.empleado_id] || []).push(f);
    const hdPor: Record<string, apiF.HorasDia> = {};
    for (const h of datos.horasDia) hdPor[`${h.empleado_id}|${h.fecha}`] = h;
    const ahoraMin = fechaHoraMadrid(new Date()).minutos;
    const tol = datos.config.tolerancia_min;
    return datos.empleados.map((e) => {
      const jornadas = agruparJornadas(porEmp[e.id] ?? []);
      const celdas: Celda[] = [];
      for (let i = 0; i < 7; i++) {
        const fecha = sumaDia(lunes, i);
        const turnos = datos.turnos.filter((t) => t.empleado_id === e.id && t.fecha === fecha);
        const efs = jornadas[fecha] ?? [];
        const ausencia = datos.ausencias.find((a) => a.empleado_id === e.id && a.fecha_inicio <= fecha && a.fecha_fin >= fecha) ?? null;
        const esHoy = fecha === hoy;
        const estado = estadoCelda({ fecha, hoy, turnos, efectivos: efs, ausencia: tipoAusenciaDia(ausencia), toleranciaMin: tol, ahoraMin });
        const dia = efs.length ? calcularDiaMin(efs, esHoy) : { horas: 0, inc: [] as string[], enCurso: false };
        const { entrada, salida, pausasMin } = resumenJornada(fecha, efs);
        const desv = desviaciones(turnos, entrada, salida);
        celdas.push({
          fecha, turnos, efs, ausencia, hd: hdPor[`${e.id}|${fecha}`] ?? null, estado,
          horasFich: dia.horas, horasPlan: horasPlanDe(turnos), entrada, salida, pausasMin,
          retraso: desv.retraso_min,
          salidaAntic: desv.salida_antic_min,
          inc: dia.inc,
          esperaFila: fecha < hoy && (turnos.length > 0 || efs.length > 0) && estado !== "ausencia",
        });
      }
      const plan = celdas.reduce((s, c) => s + c.horasPlan, 0);
      const fich = celdas.reduce((s, c) => s + c.horasFich, 0);
      const ret = celdas.reduce((s, c) => s + (c.hd ? Number(c.hd.horas_retenidas) : 0), 0);
      const nRet = celdas.filter((c) => c.hd).length;
      return { e, celdas, plan, fich, ret, nRet };
    });
  }, [datos, lunes, hoy]);

  const resumen = useMemo(() => {
    const hd = datos?.horasDia ?? [];
    const validadas = hd.filter((h) => h.estado === "validada").length;
    const propuestas = hd.length - validadas;
    // Días-persona que deberían tener fila y aún no la tienen (p. ej. se validó hasta el miércoles y ya es viernes).
    const faltan = filas.reduce((s, f) => s + f.celdas.filter((c) => c.esperaFila && !c.hd).length, 0);
    const estado: "sin" | "propuesta" | "validada" | "parcial" =
      !hd.length ? "sin" : propuestas === 0 ? "validada" : validadas === 0 ? "propuesta" : "parcial";
    return { validadas, propuestas, faltan, estado };
  }, [datos, filas]);

  const ejecutar = async (tipo: "proponer" | "validar" | "reabrir") => {
    setConfirmar(null);
    setOcupado(true);
    let r: { ok: boolean; error?: string; data?: number };
    try {
      r = tipo === "proponer"
        ? await apiF.proponerHoras(centroId, lunes)
        : tipo === "validar" ? await apiF.validarSemana(centroId, lunes) : await apiF.reabrirSemana(centroId, lunes);
    } catch (e) {
      r = { ok: false, error: mensajeError(e) };
    }
    setOcupado(false);
    if (!r.ok) { avisar("No se pudo: " + r.error); return; }
    const n = r.data ?? 0;
    const incluyeHoy = hoy >= lunes && hoy <= domingo;
    avisar(
      tipo === "proponer"
        ? `${n} día${n === 1 ? "" : "s"} propuesto${n === 1 ? "" : "s"}${incluyeHoy ? " · hoy se propone mañana" : ""}`
        : tipo === "validar" ? `Semana validada (${n} días)` : `Semana reabierta (${n} días)`,
    );
    cargar();
  };

  const totalDia = (i: number, k: "horasPlan" | "horasFich") => filas.reduce((s, f) => s + f.celdas[i][k], 0);
  const sem = semanaIso(lunes);
  const lunesFuturo = lunes > hoy;
  const sinPermiso = !!datos?.plantillaOculta;
  const textoChip =
    resumen.estado === "sin" ? "Sin proponer"
      : resumen.estado === "validada" ? (resumen.faltan ? `Validada · faltan ${resumen.faltan} día${resumen.faltan === 1 ? "" : "s"}` : "Validada")
        : resumen.estado === "propuesta" ? "Propuesta"
          : `Propuesta · ${resumen.validadas} validados`;

  // Filas agrupadas por departamento (y «Sin asignación en este centro» al final para los prestados).
  const cuerpo: React.ReactNode[] = [];
  let depAnterior: string | null = null;
  for (const { e, celdas, plan, fich, ret, nRet } of filas) {
    const dep = e.prestado ? "Sin asignación en este centro" : e.departamento || "Sin departamento";
    if (dep !== depAnterior) {
      const n = filas.filter((f) => (f.e.prestado ? "Sin asignación en este centro" : f.e.departamento || "Sin departamento") === dep).length;
      cuerpo.push(<tr key={"d" + dep} className="fila-depto"><td colSpan={9}>{dep} <span>· {n}</span></td></tr>);
      depAnterior = dep;
    }
    cuerpo.push(
      <tr key={e.id}>
        <td className="nombre">
          <div className="np">{e.nombre} {e.apellidos || ""}</div>
          <div className="horas">
            {e.prestado ? <span className="fichajes-prestado">sin asignación en este centro</span> : e.horas_vigentes ? `contrato ${numH(Number(e.horas_vigentes))} h` : ""}
          </div>
        </td>
        {celdas.map((c) => (
          <td key={c.fecha} className={`celda fichajes-celda est-${c.estado}`} style={{ cursor: "default" }}>
            {c.turnos.length ? (
              <div className={`fichajes-plan${c.estado === "ausencia" ? " tachado" : ""}`}>{c.turnos.map((t) => hh(t)).join(" · ")}</div>
            ) : c.ausencia ? null : (
              <div className="fichajes-plan vacio-plan">—</div>
            )}
            {c.ausencia ? (
              <div className="fichajes-aus" style={c.ausencia.rrhh_tipos_ausencia?.color ? { color: c.ausencia.rrhh_tipos_ausencia.color } : undefined}>
                {c.ausencia.rrhh_tipos_ausencia?.nombre ?? c.ausencia.tipo}{c.ausencia.medio_dia ? " (½ día)" : c.ausencia.horas != null ? ` (${numH(Number(c.ausencia.horas))} h)` : ""}
              </div>
            ) : null}
            {c.efs.length ? (
              <div className="fichajes-fich">
                {fmtMin(c.entrada) || "¿?"}–{c.salida != null ? fmtMin(c.salida) : c.estado === "en_curso" ? "…" : "¿?"}
                {c.pausasMin ? <span className="pausa"> · pausa {c.pausasMin}′</span> : null}
                <b> {c.inc.length ? "— h" : `${numH(c.horasFich)} h`}</b>
              </div>
            ) : null}
            <div className="fichajes-estado">
              {c.estado === "desvio" ? (
                <>
                  {c.retraso > datos!.config.tolerancia_min ? <span>retraso {c.retraso} min</span> : null}
                  {c.salidaAntic > datos!.config.tolerancia_min ? <span>sale {c.salidaAntic} min antes</span> : null}
                </>
              ) : c.estado === "incidencia" ? (
                <span>{c.inc.join(" · ")}</span>
              ) : (
                TXT_ESTADO[c.estado] ? <span>{TXT_ESTADO[c.estado]}</span> : null
              )}
            </div>
            {c.hd ? (
              <button
                className={`fichajes-ret ${c.hd.estado}`}
                title={c.hd.estado === "validada" ? "Validado" : "Editar horas retenidas"}
                onClick={() => c.hd && c.hd.estado === "propuesta" && setEdicion({ hd: c.hd, nombre: `${e.nombre} ${e.apellidos || ""}`.trim(), celda: c })}
              >
                {c.hd.estado === "validada" ? "✓" : "✎"} {numH(Number(c.hd.horas_retenidas))} h{c.hd.nota ? " ·" : ""}
              </button>
            ) : null}
          </td>
        ))}
        <td className="fichajes-total fichajes-fijo-der">
          <div><span>plan</span> {numH(plan)} h</div>
          <div><span>fichadas</span> {numH(fich)} h</div>
          <div className={nRet ? "ret" : "ret sin"}><span>retenidas</span> {nRet ? `${numH(ret)} h` : "—"}</div>
        </td>
      </tr>,
    );
  }

  return (
    <>
      <div className="barra">
        {selector}
        <div className="sem-nav">
          <button onClick={() => setLunes(sumaDia(lunes, -7))} aria-label="Semana anterior">‹</button>
          <span className="sem-label">Sem. {sem.semana} · {ddmm(lunes)} — {ddmm(domingo)}</span>
          <button onClick={() => setLunes(sumaDia(lunes, 7))} aria-label="Semana siguiente">›</button>
          <button className="btn btn-fantasma" style={{ height: 34 }} onClick={() => setLunes(lunesDe(hoyMadrid()))}>Hoy</button>
        </div>
        {toggle}
        <span className={`fichajes-chip est-${resumen.estado}`}>{textoChip}</span>
        <div className="fichajes-acciones">
          {ctx.esGestor && resumen.validadas > 0 ? (
            <button className="btn btn-fantasma" disabled={ocupado} onClick={() => setConfirmar("reabrir")}>Reabrir</button>
          ) : null}
          <button
            className="btn btn-fantasma"
            disabled={ocupado || lunesFuturo || !datos || sinPermiso}
            title={lunes === lunesDe(hoy) ? "Hoy se propone mañana" : undefined}
            onClick={() => (resumen.propuestas ? setConfirmar("proponer") : ejecutar("proponer"))}
          >
            Proponer horas
          </button>
          <button className="btn btn-primario" disabled={ocupado || !resumen.propuestas || sinPermiso} onClick={() => setConfirmar("validar")}>
            Validar semana
          </button>
        </div>
      </div>

      {error ? (
        <div className="vacio">
          <div>No se pudo cargar la semana: {error}</div>
          <button className="btn btn-fantasma" style={{ marginTop: 12 }} onClick={cargar}>Reintentar</button>
        </div>
      ) : !datos ? (
        <div className="vacio">Cargando…</div>
      ) : sinPermiso ? (
        <div className="vacio">
          No tienes permiso para ver la plantilla de este centro. Hay {datos.turnos.length} turno{datos.turnos.length === 1 ? "" : "s"} y {datos.fichajes.length} fichaje{datos.fichajes.length === 1 ? "" : "s"} esta semana, pero no se pueden proponer ni validar horas sin ver a quién pertenecen. Pídeselo a dirección.
        </div>
      ) : !datos.empleados.length ? (
        <div className="vacio">Este centro no tiene empleados asignados esta semana.</div>
      ) : (
        <div className="plan-scroll">
          <table className="cuadrante fichajes-tabla">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Empleado</th>
                {DIAS.map((d, i) => {
                  const f = sumaDia(lunes, i);
                  return <th key={d} className={f === hoy ? "hoy" : ""}>{d} {ddmm(f)}</th>;
                })}
                <th className="fichajes-fijo-der">Total semana</th>
              </tr>
            </thead>
            <tbody>{cuerpo}</tbody>
            <tfoot>
              <tr>
                <td className="nombre"><div className="np">Total del día</div></td>
                {DIAS.map((_, i) => (
                  <td key={i} className="fichajes-pie">
                    <div>plan {numH(totalDia(i, "horasPlan"))} h</div>
                    <div>fich. {numH(totalDia(i, "horasFich"))} h</div>
                  </td>
                ))}
                <td className="fichajes-pie fichajes-fijo-der">
                  <div>plan {numH(filas.reduce((s, f) => s + f.plan, 0))} h</div>
                  <div>fich. {numH(filas.reduce((s, f) => s + f.fich, 0))} h</div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {datos && !sinPermiso ? (
        <div className="leyenda fichajes-leyenda">
          <span><i className="muestra est-ok" /> dentro de tolerancia ({datos.config.tolerancia_min} min)</span>
          <span><i className="muestra est-desvio" /> retraso o salida anticipada</span>
          <span><i className="muestra est-incidencia" /> fichajes incoherentes</span>
          <span><i className="muestra est-no_ficho" /> no fichó</span>
          <span><i className="muestra est-no_plan" /> no planificado</span>
          <span><i className="muestra est-en_curso" /> en curso</span>
          <span><i className="muestra est-ausencia" /> ausencia aprobada</span>
          <span>Regla del centro: {datos.config.regla_horas === "planificado" ? "horas planificadas" : datos.config.regla_horas === "fichado" ? "horas fichadas" : "plan con tolerancia"}{datos.config.redondeo_min ? ` · redondeo ${datos.config.redondeo_min} min` : ""}</span>
        </div>
      ) : null}

      {confirmar ? (
        <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) setConfirmar(null); }}>
          <div className="modal">
            <h2>{confirmar === "proponer" ? "Volver a proponer horas" : confirmar === "validar" ? "Validar la semana" : "Reabrir la semana"}</h2>
            <div className="sub">Sem. {sem.semana} · {fmtFecha(lunes)} — {fmtFecha(domingo)}</div>
            <p className="fichajes-texto">
              {confirmar === "proponer"
                ? `Se recalculan las ${resumen.propuestas} propuestas con la regla del centro. Se pierden las horas que hayas editado a mano en esta semana. Los días validados no se tocan.`
                : confirmar === "validar"
                  ? `Se validan ${resumen.propuestas} días. Después no se podrán editar sin reabrir la semana.${resumen.faltan ? ` Quedan ${resumen.faltan} días sin proponer; se pueden proponer y validar más tarde.` : ""}`
                  : `Los ${resumen.validadas} días validados vuelven a propuesta y se pueden editar otra vez.`}
            </p>
            <div className="modal-acciones">
              <button className="btn btn-fantasma" onClick={() => setConfirmar(null)}>Cancelar</button>
              <button className={`btn ${confirmar === "reabrir" ? "btn-borrar" : "btn-primario"}`} onClick={() => ejecutar(confirmar)}>
                {confirmar === "proponer" ? "Recalcular" : confirmar === "validar" ? "Validar" : "Reabrir"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {edicion ? (
        <ModalHoras
          edicion={edicion}
          onCerrar={() => setEdicion(null)}
          onGuardado={() => { setEdicion(null); avisar("Horas actualizadas"); cargar(); }}
        />
      ) : null}
    </>
  );
}

function ModalHoras({ edicion, onCerrar, onGuardado }: {
  edicion: { hd: apiF.HorasDia; nombre: string; celda: Celda };
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const { hd, nombre, celda } = edicion;
  const [horas, setHoras] = useState(String(Number(hd.horas_retenidas)).replace(".", ","));
  const [nota, setNota] = useState(hd.nota ?? "");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const incidencias = Array.isArray(hd.incidencias) ? (hd.incidencias as string[]) : [];

  return (
    <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <form
        className="modal"
        onSubmit={async (e) => {
          e.preventDefault();
          const v = Number(horas.replace(",", "."));
          if (!(v >= 0 && v <= 24)) { setError("Pon un número de horas entre 0 y 24."); return; }
          setOcupado(true);
          let r: { ok: boolean; error?: string };
          try { r = await apiF.editarHorasDia(hd.id, Math.round(v * 100) / 100, nota); } catch (err) { r = { ok: false, error: mensajeError(err) }; }
          setOcupado(false);
          if (!r.ok) { setError("No se pudo guardar: " + r.error); return; }
          onGuardado();
        }}
      >
        <h2>Horas retenidas</h2>
        <div className="sub">{nombre} · {fmtFecha(hd.fecha)}</div>
        <div className="fichajes-resumen-modal">
          <div><span>Planificado</span>{celda.turnos.length ? celda.turnos.map((t) => hh(t)).join(" · ") : "—"} · {fmtHoras(Number(hd.horas_plan ?? 0))}</div>
          <div><span>Fichado</span>{celda.efs.length ? `${fmtMin(celda.entrada)}–${fmtMin(celda.salida)}` : "—"} · {fmtHoras(Number(hd.horas_fichadas ?? 0))}</div>
          {incidencias.length ? <div><span>Incidencias</span>{incidencias.join(" · ")}</div> : null}
        </div>
        <label>Horas retenidas</label>
        <input type="text" inputMode="decimal" value={horas} onChange={(e) => setHoras(e.target.value)} placeholder="7,5" />
        <label>Nota (opcional)</label>
        <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: se quedó a cerrar, no fichó la salida" />
        <div className="aviso-modal">{error}</div>
        <div className="modal-acciones">
          <button type="button" className="btn btn-fantasma" onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={ocupado}>Guardar</button>
        </div>
      </form>
    </div>
  );
}

/* ==================== Jornada (por día, como el «Control horario» de Skello) ==================== */

type Filtro = "programados" | "ausencias";

/** Lo que se edita en una fila antes de confirmar. */
type EdicionFila = { entrada: string; salida: string; descanso: string; ausente: boolean; nota: string };

type FilaJ = {
  e: apiF.EmpleadoSemana;
  turnos: Turno[];
  /** Fichajes efectivos de la jornada (sin anulados), en orden. */
  efs: apiF.FichajeDia[];
  /** Todos los fichajes del empleado en el día, anulados incluidos (para la modal). */
  todos: apiF.FichajeDia[];
  ausencia: apiF.AusenciaSemana | null;
  hd: apiF.HorasDia | null;
  estado: EstadoCelda;
  horasFich: number;
  horasPlan: number;
  entradaF: number | null;
  salidaF: number | null;
  pausasMin: number;
  nPausas: number;
  retraso: number;
  salidaAntic: number;
  inc: string[];
  /** Fichó por móvil: dentro del radio del centro o fuera / sin posición. Vacío si fichó en tablet o no fichó. */
  posicion: "dentro" | "fuera" | null;
  /** Valores iniciales de la franja retenida: lo guardado si el día tiene fila; si no, la regla del centro. */
  inicial: EdicionFila;
  origen: "fichado" | "planificado" | "sin_fichar" | "nada" | "guardado";
  esAusenciaCompleta: boolean;
};

const IconoPin = ({ tachado }: { tachado?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22s7-7.1 7-12a7 7 0 1 0-14 0c0 4.9 7 12 7 12z" />
    <circle cx="12" cy="10" r="2.5" />
    {tachado ? <path d="M3 3l18 18" /> : null}
  </svg>
);

const IconoCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 13l4 4L19 7" />
  </svg>
);

const TXT_FICHADO: Partial<Record<EstadoCelda, string>> = {
  no_ficho: "sin fichar", en_curso: "en curso", pendiente: "aún no ha empezado", no_plan: "sin turno",
};

function VistaJornada({ ctx, avisar, centroId, selector, toggle, fecha, setFecha }: PropsVista & { ctx: SecProps["ctx"]; fecha: string; setFecha: (f: string) => void }) {
  const [datos, setDatos] = useState<apiF.Jornada | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("programados");
  const [edits, setEdits] = useState<Record<string, Partial<EdicionFila>>>({});
  const [menu, setMenu] = useState<string | null>(null);
  const [modal, setModal] = useState<{ empId: string; modo: "ver" | "corregir" } | null>(null);
  const [confirmar, setConfirmar] = useState<"confirmar" | "reabrir" | null>(null);
  const hoy = hoyMadrid();
  const lunes = lunesDe(fecha);

  const avisarRef = useRef(avisar);
  avisarRef.current = avisar;

  const cargar = useCallback(() => {
    setError(null);
    const fallo = (msg: string) => { setDatos(null); setError(msg); avisarRef.current("No se pudo cargar: " + msg); };
    apiF.cargarJornada(centroId, fecha)
      .then((r) => { if (r.ok && r.data) { setDatos(r.data); setEdits({}); } else fallo(r.error ?? "No se pudo cargar la jornada"); })
      .catch((e) => fallo(mensajeError(e)));
  }, [centroId, fecha]);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = useMemo<FilaJ[]>(() => {
    if (!datos) return [];
    const { efectivos, anulados } = efectivosMin(datos.fichajes);
    const porEmp: Record<string, FichajeMin[]> = {};
    for (const f of efectivos) (porEmp[f.empleado_id] = porEmp[f.empleado_id] || []).push(f);
    const todosPor: Record<string, apiF.FichajeDia[]> = {};
    for (const f of datos.fichajes) (todosPor[f.empleado_id] = todosPor[f.empleado_id] || []).push(f);
    const hdPor: Record<string, apiF.HorasDia> = {};
    for (const h of datos.horasDia) hdPor[h.empleado_id] = h;
    const ahoraMin = fechaHoraMadrid(new Date()).minutos;
    const tol = datos.config.tolerancia_min;
    const esHoy = fecha === hoy;
    const porId: Record<string, apiF.FichajeDia> = {};
    for (const f of datos.fichajes) porId[f.id] = f;

    return datos.empleados.map((e) => {
      const turnos = datos.turnos.filter((t) => t.empleado_id === e.id);
      const efsMin = agruparJornadas(porEmp[e.id] ?? [])[fecha] ?? [];
      const efs = efsMin.map((f) => porId[f.id]).filter(Boolean);
      const idsJornada = new Set(efs.map((f) => f.id));
      // En la modal se enseñan los de la jornada más los anulados que corregían a uno de ellos.
      const todos = (todosPor[e.id] ?? []).filter((f) => idsJornada.has(f.id) || (anulados.has(f.id) && efs.some((x) => x.corrige_a === f.id)));
      const ausencia = datos.ausencias.find((a) => a.empleado_id === e.id) ?? null;
      const hd = hdPor[e.id] ?? null;
      const estado = estadoCelda({ fecha, hoy, turnos, efectivos: efs, ausencia: tipoAusenciaDia(ausencia), toleranciaMin: tol, ahoraMin });
      const dia = efs.length ? calcularDiaMin(efs, esHoy) : { horas: 0, inc: [] as string[], enCurso: false };
      const { entrada, salida, pausasMin, nPausas } = resumenJornada(fecha, efs);
      const desv = desviaciones(turnos, entrada, salida);
      const moviles = efs.filter((f) => f.metodo === "movil_geo");
      const posicion: FilaJ["posicion"] = !moviles.length ? null : moviles.every((f) => f.dentro_radio === true) ? "dentro" : "fuera";
      const inc = [...dia.inc];
      if (turnos.length && !efs.length && estado === "no_ficho") inc.push("no fichó");
      if (!turnos.length && efs.length) inc.push("no planificado");
      if (desv.retraso_min > tol) inc.push(`retraso ${desv.retraso_min} min`);
      if (desv.salida_antic_min > tol) inc.push(`salida anticipada ${desv.salida_antic_min} min`);

      const guardada = hd ? leerFranja(hd) : null;
      let inicial: EdicionFila;
      let origen: FilaJ["origen"];
      if (guardada?.franja) {
        const f = guardada.franja;
        inicial = { entrada: f.entrada_ret ?? "", salida: f.salida_ret ?? "", descanso: String(f.descanso_ret_min), ausente: f.ausente, nota: guardada.nota };
        origen = "guardado";
      } else {
        const r = retencionJornada({ fecha, turnos, efectivos: efs, cfg: datos.config, esHoy });
        inicial = { entrada: r.entrada, salida: r.salida, descanso: String(r.descansoMin), ausente: false, nota: guardada?.nota ?? "" };
        origen = r.origen;
      }
      return {
        e, turnos, efs, todos, ausencia, hd, estado,
        horasFich: redondearHoras(dia.horas, datos.config.redondeo_min), horasPlan: horasPlanDe(turnos),
        entradaF: entrada, salidaF: salida, pausasMin, nPausas,
        retraso: desv.retraso_min, salidaAntic: desv.salida_antic_min, inc: [...new Set(inc)],
        posicion, inicial, origen,
        esAusenciaCompleta: tipoAusenciaDia(ausencia) === "completa" && !efs.length,
      };
    });
  }, [datos, fecha, hoy]);

  const programados = useMemo(() => filas.filter((f) => !f.esAusenciaCompleta && (f.turnos.length || f.efs.length || f.hd)), [filas]);
  const ausencias = useMemo(() => filas.filter((f) => f.ausencia), [filas]);
  const visibles = filtro === "programados" ? programados : ausencias;

  const confirmada = !!datos && datos.confirmados.includes(fecha);
  const futuro = fecha > hoy;
  const sinPermiso = !!datos?.plantillaOculta;
  const sem = semanaIso(lunes);

  const valorDe = (f: FilaJ): EdicionFila => ({ ...f.inicial, ...(edits[f.e.id] ?? {}) });
  const editar = (id: string, cambio: Partial<EdicionFila>) => setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...cambio } }));
  const hayCambios = Object.keys(edits).length > 0;

  /** Duración retenida de una fila con lo que hay en los inputs (o lo guardado si está confirmada). */
  const horasDe = (f: FilaJ, v: EdicionFila): number | null => {
    if (confirmada && f.hd) return Number(f.hd.horas_retenidas);
    if (v.ausente) return 0;
    const h = horasFranja(minutosDe(v.entrada), minutosDe(v.salida), Number(v.descanso) || 0, datos?.config.redondeo_min ?? 0);
    return h == null ? (v.entrada || v.salida ? null : 0) : h;
  };

  const ejecutar = async (tipo: "confirmar" | "reabrir") => {
    setConfirmar(null);
    if (!datos) return;
    setOcupado(true);
    let r: { ok: boolean; error?: string; data?: number };
    try {
      if (tipo === "confirmar") {
        const filasEnv: apiF.FilaJornada[] = programados.map((f) => {
          const v = valorDe(f);
          return {
            empleado_id: f.e.id,
            entrada_ret: v.ausente ? null : v.entrada || null,
            salida_ret: v.ausente ? null : v.salida || null,
            descanso_ret_min: v.ausente ? 0 : Number(v.descanso) || 0,
            ausente: v.ausente,
            nota: v.nota.trim() || null,
            horas_plan: f.horasPlan,
            horas_fichadas: f.horasFich,
            retraso_min: f.retraso,
            salida_antic_min: f.salidaAntic,
            incidencias: f.inc,
          };
        });
        const incompleta = programados.find((f) => { const v = valorDe(f); return !v.ausente && (!!v.entrada !== !!v.salida); });
        if (incompleta) {
          setOcupado(false);
          avisar(`${incompleta.e.nombre}: pon entrada y salida retenidas, o márcalo como ausente.`);
          return;
        }
        r = await apiF.confirmarJornada(centroId, fecha, filasEnv);
      } else {
        r = await apiF.reabrirJornada(centroId, fecha);
      }
    } catch (e) {
      r = { ok: false, error: mensajeError(e) };
    }
    setOcupado(false);
    if (!r.ok) { avisar("No se pudo: " + r.error); return; }
    const n = r.data ?? 0;
    avisar(tipo === "confirmar" ? `Jornada confirmada (${n} empleado${n === 1 ? "" : "s"})` : `Jornada reabierta (${n} fila${n === 1 ? "" : "s"})`);
    cargar();
  };

  const totalRet = programados.reduce((s, f) => s + (horasDe(f, valorDe(f)) ?? 0), 0);
  const sinFichar = programados.filter((f) => f.estado === "no_ficho").length;
  const empModal = modal ? filas.find((f) => f.e.id === modal.empId) ?? null : null;

  return (
    <>
      <div className="barra">
        {selector}
        <div className="sem-nav">
          <button onClick={() => setFecha(sumaDia(fecha, -7))} aria-label="Semana anterior">‹</button>
          <span className="sem-label">Sem. {sem.semana} · {ddmm(lunes)} — {ddmm(sumaDia(lunes, 6))}</span>
          <button onClick={() => setFecha(sumaDia(fecha, 7))} aria-label="Semana siguiente">›</button>
          <button className="btn btn-fantasma" style={{ height: 34 }} onClick={() => setFecha(hoyMadrid())}>Hoy</button>
        </div>
        {toggle}
        <div className="fichajes-acciones">
          {ctx.esGestor && confirmada ? (
            <button className="btn btn-fantasma" disabled={ocupado} onClick={() => setConfirmar("reabrir")}>Reabrir jornada</button>
          ) : null}
          <button
            className="btn btn-primario"
            disabled={ocupado || futuro || confirmada || !datos || sinPermiso || !programados.length}
            title={futuro ? "Los días futuros no se confirman" : confirmada ? "Esta jornada ya está confirmada" : undefined}
            onClick={() => setConfirmar("confirmar")}
          >
            Confirmar jornada
          </button>
        </div>
      </div>

      <div className="jornada">
        <aside className="jornada-dias" aria-label="Días de la semana">
          {DIAS.map((d, i) => {
            const f = sumaDia(lunes, i);
            const ok = !!datos?.confirmados.includes(f);
            return (
              <button key={f} className={`jornada-dia${f === fecha ? " activa" : ""}${f === hoy ? " hoy" : ""}${f > hoy ? " futuro" : ""}`} onClick={() => setFecha(f)}>
                <span className={`jornada-check${ok ? " ok" : ""}`} title={ok ? "Jornada confirmada" : "Sin confirmar"}>{ok ? <IconoCheck /> : null}</span>
                <span className="jornada-dia-nombre">{d}</span>
                <span className="jornada-dia-fecha">{ddmm(f)}</span>
              </button>
            );
          })}
        </aside>

        <div className="jornada-cuerpo">
          <div className="jornada-cab">
            <div className="jornada-titulo">{DIAS[(new Date(fecha + "T12:00").getDay() + 6) % 7]} {fmtFecha(fecha)}{fecha === hoy ? <span className="jornada-hoy">hoy</span> : null}</div>
            <div className="jornada-filtros" role="tablist">
              <button role="tab" aria-selected={filtro === "programados"} className={filtro === "programados" ? "activa" : ""} onClick={() => setFiltro("programados")}>
                Programados ({programados.length})
              </button>
              <button role="tab" aria-selected={filtro === "ausencias"} className={filtro === "ausencias" ? "activa" : ""} onClick={() => setFiltro("ausencias")}>
                Ausencias programadas ({ausencias.length})
              </button>
            </div>
            {datos && !sinPermiso && filtro === "programados" ? (
              <div className="jornada-totales">
                <span>retenidas <b>{numH(totalRet)} h</b></span>
                {sinFichar ? <span className="aviso">{sinFichar} sin fichar</span> : null}
                {hayCambios && !confirmada ? <span className="aviso">cambios sin confirmar</span> : null}
              </div>
            ) : null}
          </div>

          {confirmada ? (
            <div className="jornada-banner ok"><IconoCheck /> Jornada confirmada{datos?.horasDia.find((h) => h.validado_en)?.validado_en ? ` el ${fmtFecha(datos.horasDia.find((h) => h.validado_en)!.validado_en!.slice(0, 10))}` : ""}. Las horas retenidas ya cuentan en los contadores. {ctx.esGestor ? "Para corregirla, reábrela." : "Si hay que corregirla, pídeselo a dirección."}</div>
          ) : futuro ? (
            <div className="jornada-banner">Día futuro: se podrá confirmar cuando llegue.</div>
          ) : fecha === hoy ? (
            <div className="jornada-banner">Hoy: confirma la jornada al cierre, cuando todos hayan fichado la salida.</div>
          ) : null}

          {error ? (
            <div className="vacio">
              <div>No se pudo cargar la jornada: {error}</div>
              <button className="btn btn-fantasma" style={{ marginTop: 12 }} onClick={cargar}>Reintentar</button>
            </div>
          ) : !datos ? (
            <div className="vacio">Cargando…</div>
          ) : sinPermiso ? (
            <div className="vacio">No tienes permiso para ver la plantilla de este centro. Hay {datos.turnos.length} turno{datos.turnos.length === 1 ? "" : "s"} y {datos.fichajes.length} fichaje{datos.fichajes.length === 1 ? "" : "s"} este día, pero no se pueden confirmar sin ver a quién pertenecen. Pídeselo a dirección.</div>
          ) : !visibles.length ? (
            <div className="vacio">{filtro === "programados" ? "Nadie tiene turno ni fichajes este día en este centro." : "No hay ausencias aprobadas este día."}</div>
          ) : filtro === "ausencias" ? (
            <div className="plan-scroll">
              <table className="cuadrante jornada-tabla">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Empleado</th>
                    <th>Ausencia</th>
                    <th>Turno programado</th>
                    <th>Turnos fichados</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f) => (
                    <tr key={f.e.id}>
                      <td className="nombre"><div className="np">{f.e.nombre} {f.e.apellidos || ""}</div></td>
                      <td>
                        <span className="fichajes-aus" style={f.ausencia?.rrhh_tipos_ausencia?.color ? { color: f.ausencia.rrhh_tipos_ausencia.color } : undefined}>
                          {f.ausencia?.rrhh_tipos_ausencia?.nombre ?? f.ausencia?.tipo}
                        </span>
                        {f.ausencia?.medio_dia ? " · medio día" : f.ausencia?.horas != null ? ` · ${numH(Number(f.ausencia.horas))} h` : " · día completo"}
                        {f.ausencia && (f.ausencia.fecha_inicio !== fecha || f.ausencia.fecha_fin !== fecha) ? <div className="jornada-sub">{ddmm(f.ausencia.fecha_inicio)} — {ddmm(f.ausencia.fecha_fin)}</div> : null}
                      </td>
                      <td className="centro">{f.turnos.length ? <span className={f.esAusenciaCompleta ? "fichajes-plan tachado" : "fichajes-plan"}>{f.turnos.map((t) => hh(t)).join(" · ")}</span> : "—"}</td>
                      <td className="centro">{f.efs.length ? `${hhmmDe(f.entradaF) || "¿?"} – ${f.salidaF != null ? hhmmDe(f.salidaF) : "…"}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="plan-scroll">
              <table className="cuadrante jornada-tabla">
                <thead>
                  <tr>
                    <th title="Confirmado" aria-label="Confirmado" className="estrecha" />
                    <th style={{ textAlign: "left" }}>Empleado</th>
                    <th>Turno programado</th>
                    <th>Descanso prog.</th>
                    <th title="Posición al fichar por móvil" className="estrecha">Pos.</th>
                    <th>Turnos fichados</th>
                    <th>Descanso fichado</th>
                    <th colSpan={2}>Turno retribuido</th>
                    <th>Descanso retenido</th>
                    <th title="Ausente" className="estrecha">Aus.</th>
                    <th>Duración</th>
                    <th style={{ textAlign: "left" }}>Notas</th>
                    <th className="estrecha" aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f) => {
                    const v = valorDe(f);
                    const horas = horasDe(f, v);
                    const bloqueada = confirmada || ocupado;
                    const claseFila = confirmada ? "confirmada" : v.ausente ? "ausente" : f.estado === "no_ficho" ? "sin-fichar" : f.estado;
                    const plan = tramoPlanDe(f.turnos);
                    return (
                      <tr key={f.e.id} className={`jornada-fila est-${claseFila}${edits[f.e.id] ? " editada" : ""}`}>
                        <td className="centro">
                          <span className={`jornada-check${f.hd?.estado === "validada" ? " ok" : ""}`} title={f.hd?.estado === "validada" ? "Confirmado" : "Sin confirmar"}>{f.hd?.estado === "validada" ? <IconoCheck /> : null}</span>
                        </td>
                        <td className="nombre">
                          <div className="np">{f.e.nombre} {f.e.apellidos || ""}</div>
                          <div className="jornada-sub">
                            {f.e.prestado ? <span className="fichajes-prestado">sin asignación en este centro</span> : f.e.departamento || ""}
                            {f.ausencia ? <span className="fichajes-aus peq"> · {f.ausencia.rrhh_tipos_ausencia?.nombre ?? f.ausencia.tipo}{f.ausencia.medio_dia ? " (½ día)" : f.ausencia.horas != null ? ` (${numH(Number(f.ausencia.horas))} h)` : ""}</span> : null}
                          </div>
                        </td>
                        <td className="centro">
                          {f.turnos.length ? <span className="fichajes-plan">{hhmmDe(plan.entrada)} – {hhmmDe(plan.salida)}</span> : <span className="jornada-vacio">—</span>}
                          {f.turnos.length > 1 ? <div className="jornada-sub">{f.turnos.map((t) => hh(t)).join(" · ")}</div> : null}
                        </td>
                        <td className="centro">{f.turnos.length ? `${descansoPlanDe(f.turnos)} min` : <span className="jornada-vacio">—</span>}</td>
                        <td className="centro">
                          {f.posicion === "dentro" ? <span className="jornada-pos ok" title="Fichó por móvil dentro del radio del centro"><IconoPin /></span>
                            : f.posicion === "fuera" ? <span className="jornada-pos mal" title="Fichó por móvil fuera del radio o sin posición"><IconoPin tachado /></span>
                              : null}
                        </td>
                        <td className="centro">
                          {f.efs.length ? (
                            <span className={`jornada-fichado est-${f.estado}`}>
                              {hhmmDe(f.entradaF) || "¿?"} – {f.salidaF != null ? hhmmDe(f.salidaF) : f.estado === "en_curso" ? "…" : "¿?"}
                            </span>
                          ) : (
                            <span className={`jornada-fichado est-${f.estado}`}>{TXT_FICHADO[f.estado] ?? "—"}</span>
                          )}
                          {f.inc.length ? <div className="jornada-inc">{f.inc.join(" · ")}</div> : null}
                        </td>
                        <td className="centro">{f.efs.length ? (f.nPausas ? `${f.pausasMin} min` : <span className="jornada-vacio" title="No fichó la pausa">—</span>) : <span className="jornada-vacio">—</span>}</td>
                        <td className="input">
                          <input type="time" value={v.entrada} disabled={bloqueada || v.ausente} aria-label="Entrada retenida" onChange={(e) => editar(f.e.id, { entrada: e.target.value })} />
                        </td>
                        <td className="input">
                          <input type="time" value={v.salida} disabled={bloqueada || v.ausente} aria-label="Salida retenida" onChange={(e) => editar(f.e.id, { salida: e.target.value })} />
                        </td>
                        <td className="input">
                          <input type="number" min={0} max={600} step={5} value={v.descanso} disabled={bloqueada || v.ausente} aria-label="Descanso retenido (min)" className="min" onChange={(e) => editar(f.e.id, { descanso: e.target.value })} />
                        </td>
                        <td className="centro">
                          <input type="checkbox" checked={v.ausente} disabled={bloqueada} aria-label="Ausente" onChange={(e) => editar(f.e.id, { ausente: e.target.checked })} />
                        </td>
                        <td className="centro">
                          <b className={`jornada-dur${horas === 0 ? " cero" : ""}`}>{horas == null ? "—" : `${numH(horas)} h`}</b>
                          {!confirmada && f.origen !== "guardado" ? (
                            <div className="jornada-sub">{f.origen === "sin_fichar" ? "sin fichar" : f.origen === "planificado" ? "del turno" : f.origen === "fichado" && !f.nPausas && Number(v.descanso) > 0 ? "pausa del turno" : ""}</div>
                          ) : null}
                        </td>
                        <td className="input nota">
                          <input type="text" value={v.nota} disabled={bloqueada} placeholder={bloqueada ? "" : "Nota"} maxLength={200} aria-label="Nota" onChange={(e) => editar(f.e.id, { nota: e.target.value })} />
                        </td>
                        <td className="centro acciones">
                          <button className="jornada-mas" aria-label="Acciones" aria-haspopup="menu" onClick={() => setMenu(menu === f.e.id ? null : f.e.id)}>⋯</button>
                          {menu === f.e.id ? (
                            <>
                              <div className="jornada-menu-fondo" onClick={() => setMenu(null)} />
                              <div className="jornada-menu" role="menu">
                                <button role="menuitem" onClick={() => { setMenu(null); setModal({ empId: f.e.id, modo: "ver" }); }}>Ver fichajes del día</button>
                                <button role="menuitem" onClick={() => { setMenu(null); setModal({ empId: f.e.id, modo: "corregir" }); }}>Corregir o añadir fichaje</button>
                              </div>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {datos && !sinPermiso ? (
            <div className="leyenda fichajes-leyenda">
              <span><i className="muestra est-ok" /> fichado dentro de tolerancia</span>
              <span><i className="muestra est-desvio" /> retraso o salida anticipada</span>
              <span><i className="muestra est-no_ficho" /> sin fichar (retenido vacío: rellénalo a mano)</span>
              <span><i className="muestra est-en_curso" /> en curso</span>
              <span>Regla del centro: {datos.config.regla_horas === "planificado" ? "horas planificadas" : datos.config.regla_horas === "fichado" ? "horas fichadas (sin pausa fichada se descuenta la del turno)" : `plan con tolerancia ${datos.config.tolerancia_min} min`}{datos.config.redondeo_min ? ` · redondeo ${datos.config.redondeo_min} min` : ""}</span>
            </div>
          ) : null}
        </div>
      </div>

      {confirmar ? (
        <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) setConfirmar(null); }}>
          <div className="modal">
            <h2>{confirmar === "confirmar" ? "Confirmar la jornada" : "Reabrir la jornada"}</h2>
            <div className="sub">{fmtFecha(fecha)} · {ctx.centros.find((c) => c.id === centroId)?.nombre ?? ""}</div>
            <p className="fichajes-texto">
              {confirmar === "confirmar"
                ? `Se guardan ${programados.length} fila${programados.length === 1 ? "" : "s"} con ${numH(totalRet)} h retenidas en total${sinFichar ? ` (${sinFichar} sin fichar, con 0 h salvo que les hayas puesto horas)` : ""}. Después no se podrá editar sin reabrir la jornada.`
                : "Las filas de este día vuelven a propuesta y se pueden editar otra vez."}
            </p>
            <div className="modal-acciones">
              <button className="btn btn-fantasma" onClick={() => setConfirmar(null)}>Cancelar</button>
              <button className={`btn ${confirmar === "reabrir" ? "btn-borrar" : "btn-primario"}`} onClick={() => ejecutar(confirmar)}>
                {confirmar === "confirmar" ? "Confirmar" : "Reabrir"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modal && empModal ? (
        <ModalFichajes
          fila={empModal}
          fecha={fecha}
          centroId={centroId}
          modoInicial={modal.modo}
          onCerrar={() => setModal(null)}
          onCambio={() => { avisar("Corrección registrada"); cargar(); }}
        />
      ) : null}
    </>
  );
}

/** Fichajes del día de un empleado (chips) y corrección / alta de fichaje: lo que antes era la subvista Día. */
function ModalFichajes({ fila, fecha, centroId, modoInicial, onCerrar, onCambio }: {
  fila: FilaJ;
  fecha: string;
  centroId: string;
  modoInicial: "ver" | "corregir";
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const [corr, setCorr] = useState<{ orig: Fichaje | null } | null>(modoInicial === "corregir" ? { orig: null } : null);
  const [cHora, setCHora] = useState("");
  const [cTipo, setCTipo] = useState("salida");
  const [cMotivo, setCMotivo] = useState("");
  const [cError, setCError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const anulados = new Set(fila.todos.map((f) => f.corrige_a).filter(Boolean) as string[]);
  const nombre = `${fila.e.nombre} ${fila.e.apellidos || ""}`.trim();

  const abrirCorreccion = (orig: Fichaje | null) => {
    setCorr({ orig });
    setCTipo(orig?.tipo ?? "salida");
    setCHora(orig ? horaMadrid(orig.ts) : "");
    setCMotivo(""); setCError("");
  };

  return (
    <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      {corr ? (
        <form
          className="modal"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!cHora) { setCError("Pon la hora del fichaje."); return; }
            setOcupado(true);
            let r: { ok: boolean; error?: string };
            try {
              r = await api.corregirFichaje({
                empleado_id: fila.e.id,
                centro_id: centroId,
                tipo: cTipo,
                ts: isoMadridCliente(fecha, cHora, cTipo !== "entrada"),
                corrige_a: corr.orig?.id ?? null,
                motivo_correccion: cMotivo.trim(),
              });
            } catch (err) {
              r = { ok: false, error: mensajeError(err) };
            }
            setOcupado(false);
            if (!r.ok) { setCError("No se pudo guardar: " + r.error); return; }
            onCambio();
            onCerrar();
          }}
        >
          <h2>{corr.orig ? "Corregir fichaje" : "Añadir fichaje"}</h2>
          <div className="sub">{nombre} · {fmtFecha(fecha)}{corr.orig ? ` · sustituye a ${NT[corr.orig.tipo]} ${horaMadrid(corr.orig.ts)}` : ""}</div>
          <div className="fila-2">
            <div><label>Tipo</label>
              <select value={cTipo} onChange={(e) => setCTipo(e.target.value)}>
                <option value="entrada">Entrada</option><option value="salida">Salida</option>
                <option value="pausa_inicio">Inicio de pausa</option><option value="pausa_fin">Fin de pausa</option>
              </select>
            </div>
            <div><label>Hora</label><input type="time" required value={cHora} onChange={(e) => setCHora(e.target.value)} /></div>
          </div>
          {cTipo !== "entrada" ? <p className="fichajes-texto" style={{ fontSize: 12, color: "#888" }}>Una salida o pausa antes de las 06:00 se entiende de la madrugada siguiente (cierre).</p> : null}
          <label>Motivo (obligatorio, queda en el registro)</label>
          <textarea rows={2} required value={cMotivo} onChange={(e) => setCMotivo(e.target.value)} placeholder="Ej.: olvidó fichar la salida al cerrar" style={{ width: "100%" }} />
          <div className="aviso-modal">{cError}</div>
          <div className="modal-acciones">
            <button type="button" className="btn btn-fantasma" onClick={() => (modoInicial === "corregir" ? onCerrar() : setCorr(null))}>Cancelar</button>
            <button type="submit" className="btn btn-primario" disabled={ocupado}>Guardar corrección</button>
          </div>
        </form>
      ) : (
        <div className="modal" style={{ maxWidth: 520 }}>
          <h2>Fichajes del día</h2>
          <div className="sub">{nombre} · {fmtFecha(fecha)}{fila.turnos.length ? ` · turno ${fila.turnos.map((t) => hh(t)).join(" · ")}` : ""}</div>
          <div className="leyenda-f" style={{ margin: "4px 0 10px" }}>Verde entrada · rojo salida · gris pausa · morado corrección. Toca un fichaje para corregirlo.</div>
          {!fila.todos.length ? (
            <div className="sin-fichajes">Sin fichajes este día.</div>
          ) : (
            <div className="chips" style={{ marginTop: 0 }}>
              {fila.todos.map((f) => {
                const anu = anulados.has(f.id);
                const cl = anu ? f.tipo + " anulado" : f.metodo === "correccion" ? "correccion" : f.tipo;
                return (
                  <div key={f.id} className={`chip ${cl}`}
                    title={f.metodo === "correccion" ? "Corrección: " + (f.motivo_correccion || "") : `${MET[f.metodo] || ""}${f.metodo === "movil_geo" ? (f.dentro_radio ? " · dentro del radio" : " · fuera del radio o sin posición") : ""}`}
                    onClick={() => { if (!anu) abrirCorreccion(f); }}
                  >
                    <span className="t">{NT[f.tipo]}</span> {horaMadrid(f.ts)}{" "}
                    <span style={{ color: "var(--tinta-suave)", fontSize: 11 }}>{f.metodo === "correccion" ? "✎" : f.metodo === "movil_geo" ? "móvil" : ""}{anu ? " anulado" : ""}</span>
                  </div>
                );
              })}
            </div>
          )}
          {fila.inc.length ? <div className="jornada-inc" style={{ marginTop: 10 }}>{fila.inc.join(" · ")}</div> : null}
          <div className="modal-acciones">
            <button type="button" className="btn btn-fantasma" onClick={onCerrar}>Cerrar</button>
            <button type="button" className="btn btn-primario" onClick={() => abrirCorreccion(null)}>+ Añadir fichaje que falta</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** ISO del instante «fecha hh:mm» en Madrid, sin depender de la zona del navegador. Una salida o pausa antes de las 06:00 es de la madrugada siguiente. */
function isoMadridCliente(fecha: string, hhmm: string, madrugada: boolean): string {
  const m = minutosDe(hhmm) ?? 0;
  return isoMadrid(madrugada && m < 6 * 60 ? sumaDia(fecha, 1) : fecha, hhmmDe(m));
}
