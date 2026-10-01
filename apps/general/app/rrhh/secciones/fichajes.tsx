"use client";

/* Sección Fichajes v2: «Semana» (validación planificado vs fichado) y «Día» (chips y corrección). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../acciones";
import * as apiF from "../acciones/fichajes";
import {
  MET, NT, calcularDia, efectivosDe, hh, horaDe, hoyIso, lunesDe, sumaDia, type Fichaje, type Turno,
} from "../tipos";
import { fmtFecha, fmtHoras, guardarPref, leerPref, semanaIso, useCentroRecordado, type SecProps } from "../lib-rrhh";
import {
  agruparJornadas, calcularDiaMin, desviaciones, efectivosMin, estadoCelda, fechaHoraMadrid, horaMadrid, horasPlanDe, hoyMadrid, numH,
  resumenJornada, type AusenciaDia, type EstadoCelda, type FichajeMin,
} from "./fichajes-calculo";
import "./fichajes.css";

type Vista = "semana" | "dia";
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const ddmm = (f: string) => fmtFecha(f).slice(0, 5);
const mensajeError = (e: unknown) => (e instanceof Error ? e.message : String(e ?? "error desconocido"));

export default function SecFichajes({ ctx, avisar }: SecProps) {
  const [centroId, setCentroId] = useCentroRecordado(ctx.centros);
  const [vista, setVista] = useState<Vista>(() => (leerPref<string>("fichajes:vista", "semana") === "dia" ? "dia" : "semana"));
  // La semana y el día viven aquí: al cambiar de centro o de vista no se pierde dónde estabas (como en Skello).
  const [lunes, setLunes] = useState(() => lunesDe(hoyMadrid()));
  const [fecha, setFecha] = useState(() => hoyMadrid());

  const cambiarVista = (v: Vista) => {
    if (v === vista) return;
    if (v === "dia") {
      // Al pasar a Día: hoy si está dentro de la semana que mirabas; si no, el lunes de esa semana.
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
      <button role="tab" aria-selected={vista === "dia"} className={vista === "dia" ? "activa" : ""} onClick={() => cambiarVista("dia")}>Día</button>
    </div>
  );

  return vista === "semana"
    ? <VistaSemana ctx={ctx} avisar={avisar} centroId={centroId} selector={selector} toggle={toggle} lunes={lunes} setLunes={setLunes} />
    : <VistaDia avisar={avisar} centroId={centroId} selector={selector} toggle={toggle} fecha={fecha} setFecha={setFecha} />;
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

/* ==================== Día (la sección anterior, con chips y corrección) ==================== */

function VistaDia({ avisar, centroId, selector, toggle, fecha, setFecha }: PropsVista & { fecha: string; setFecha: (f: string) => void }) {
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.fichajesDia>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [corr, setCorr] = useState<{ empId: string; orig: Fichaje | null } | null>(null);
  const [cHora, setCHora] = useState("");
  const [cTipo, setCTipo] = useState("salida");
  const [cMotivo, setCMotivo] = useState("");
  const [cError, setCError] = useState("");

  const avisarRef = useRef(avisar);
  avisarRef.current = avisar;

  const cargar = useCallback(() => {
    setError(null);
    api.fichajesDia(centroId, fecha)
      .then(setDatos)
      .catch((e) => { setDatos(null); setError(mensajeError(e)); avisarRef.current("No se pudo cargar: " + mensajeError(e)); });
  }, [centroId, fecha]);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <>
      <div className="barra">
        {selector}
        <div className="sem-nav">
          <button onClick={() => setFecha(sumaDia(fecha, -1))} aria-label="Día anterior">‹</button>
          <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} aria-label="Día" />
          <button onClick={() => setFecha(sumaDia(fecha, 1))} aria-label="Día siguiente">›</button>
          <button className="btn btn-fantasma" style={{ height: 34 }} onClick={() => setFecha(hoyMadrid())}>Hoy</button>
        </div>
        {toggle}
      </div>
      <div className="leyenda-f">Verde entrada · rojo salida · gris pausa · morado corrección. Toca un fichaje para corregirlo.</div>
      {error ? (
        <div className="vacio">
          <div>No se pudo cargar el día: {error}</div>
          <button className="btn btn-fantasma" style={{ marginTop: 12 }} onClick={cargar}>Reintentar</button>
        </div>
      ) : !datos ? (
        <div className="vacio">Cargando…</div>
      ) : !datos.empleados.length ? (
        <div className="vacio">{datos.fichajes.length ? "No tienes permiso para ver la plantilla de este centro." : "Este centro no tiene empleados asignados."}</div>
      ) : (
        datos.empleados.map((e) => {
          const todos = datos.fichajes.filter((f) => f.empleado_id === e.id);
          const { efectivos, anulados } = efectivosDe(todos);
          const { horas, inc, enCurso } = calcularDia(efectivos, fecha === hoyIso());
          return (
            <div key={e.id} className="tarjeta-f">
              <div className="fila-cab">
                <h3>{e.nombre} {e.apellidos || ""}</h3>
                {todos.length ? <span className="horas-dia">{fmtHoras(horas)}</span> : null}
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
                          setCHora(horaMadrid(f.ts));
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
              let r: { ok: boolean; error?: string };
              try {
                r = await api.corregirFichaje({
                  empleado_id: corr.empId,
                  centro_id: centroId,
                  tipo: cTipo,
                  ts: new Date(`${fecha}T${cHora}`).toISOString(),
                  corrige_a: corr.orig?.id ?? null,
                  motivo_correccion: cMotivo.trim(),
                });
              } catch (err) {
                r = { ok: false, error: mensajeError(err) };
              }
              if (!r.ok) { setCError("No se pudo guardar: " + r.error); return; }
              setCorr(null); avisar("Corrección registrada"); cargar();
            }}
          >
            <h2>{corr.orig ? "Corregir fichaje" : "Añadir fichaje"}</h2>
            <div className="sub">
              {datos?.empleados.find((x) => x.id === corr.empId)?.nombre ?? ""} · {fmtFecha(fecha)}
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
