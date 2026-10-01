"use client";

/* Sección Ausencias v2 (plan 2.4): lista de solicitudes con filtros + calendario mensual por centro.
   Nombres y disposición como en Skello para que Sílvia y los jefes de centro lo reconozcan. */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import * as api from "../acciones/ausencias";
import { hoyIso, sumaDia } from "../tipos";
import { colorTexto, fmtFecha, fmtHoras, guardarPref, leerPref, rangoMes, useCentroRecordado, type SecProps } from "../lib-rrhh";
import "./ausencias.css";

type Vista = "solicitudes" | "calendario";
type Base = Awaited<ReturnType<typeof api.cargarBaseAusencias>>;
type Mes = Awaited<ReturnType<typeof api.cargarMesAusencias>>;
type Aus = api.AusenciaFila;
type Tipo = api.TipoAusenciaCat;

const CATEGORIA: Record<string, string> = {
  retribuida_empresa: "Retribuida por la empresa",
  retribuida_terceros: "Retribuida por terceros (SS, mutua)",
  no_retribuida: "No retribuida",
  neutra: "Neutra (no afecta a la nómina)",
};
const ESTADO_TXT: Record<string, string> = { solicitada: "Pendiente", aprobada: "Aprobada", rechazada: "Rechazada" };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_L = ["D", "L", "M", "X", "J", "V", "S"];

/** Días naturales de una ausencia (medio día = 0,5). */
function diasDe(a: { fecha_inicio: string; fecha_fin: string; medio_dia: boolean }): number {
  if (a.medio_dia) return 0.5;
  const d1 = new Date(a.fecha_inicio + "T12:00").getTime();
  const d2 = new Date(a.fecha_fin + "T12:00").getTime();
  return Math.round((d2 - d1) / 86400000) + 1;
}

/** Días naturales de una ausencia recortados a un año (misma regla que rrhh_saldo_vacaciones). 0 si no toca ese año. */
function diasEnAnio(a: { fecha_inicio: string; fecha_fin: string; medio_dia: boolean }, anio: number): number {
  const ini = `${anio}-01-01`, fin = `${anio}-12-31`;
  if (a.fecha_fin < ini || a.fecha_inicio > fin) return 0;
  return diasDe({ fecha_inicio: a.fecha_inicio < ini ? ini : a.fecha_inicio, fecha_fin: a.fecha_fin > fin ? fin : a.fecha_fin, medio_dia: a.medio_dia });
}

/** Horas de una ausencia: si lleva horas, horas × días; si no, días × jornada diaria (horas_semana / 7, como el informe de nómina). */
function horasDe(a: { fecha_inicio: string; fecha_fin: string; medio_dia: boolean; horas: number | null }, horasSemana: number | null): number {
  const dias = diasDe(a);
  if (a.horas != null) return Math.round(a.horas * (a.medio_dia ? 1 : dias) * 100) / 100;
  if (!horasSemana) return 0;
  return Math.round((dias * horasSemana) / 7 * 100) / 100;
}

const fmtNum = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const nombreCompleto = (e: { nombre: string; apellidos: string | null } | undefined) => (e ? `${e.nombre} ${e.apellidos || ""}`.trim() : "—");
const mesLabel = (iso: string) => {
  const [a, m] = iso.split("-").map(Number);
  return `${MESES[m - 1]} ${a}`;
};
const sumaMes = (iso: string, n: number) => {
  const [a, m] = iso.split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return d.toLocaleDateString("sv-SE");
};
const rangoTxt = (a: { fecha_inicio: string; fecha_fin: string }) => `${fmtFecha(a.fecha_inicio)}${a.fecha_fin !== a.fecha_inicio ? ` → ${fmtFecha(a.fecha_fin)}` : ""}`;

export default function SecAusencias({ ctx, avisar }: SecProps) {
  const esGestor = ctx.esGestor;
  const [vista, setVista] = useState<Vista>(() => (leerPref<string>("aus:vista", "solicitudes") === "calendario" ? "calendario" : "solicitudes"));
  const [centroId, setCentroId] = useCentroRecordado(ctx.centros);
  const [mes, setMes] = useState(() => hoyIso().slice(0, 7) + "-01");
  const [base, setBase] = useState<Base | null>(null);
  const [datos, setDatos] = useState<Mes | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [fEstado, setFEstado] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fCentro, setFCentro] = useState(""); // '' = todos los centros (solo en Solicitudes; no se guarda en la pref)
  const [modal, setModal] = useState<{ id: string | null; inicial: Partial<api.AusenciaInput> } | null>(null);
  const [rechazo, setRechazo] = useState<Aus | null>(null);
  const [borrar, setBorrar] = useState<Aus | null>(null);
  const [confirmar, setConfirmar] = useState<{ ausencia: Aus; resto: number } | null>(null);
  const [aprobando, setAprobando] = useState<string | null>(null);
  const ultimaRef = useRef(0);

  const { desde, hasta } = rangoMes(mes);

  const cargar = useCallback(() => {
    const n = ++ultimaRef.current;
    api
      .cargarMesAusencias(desde, hasta)
      .then((d) => { if (n === ultimaRef.current) { setDatos(d); setErrorCarga(null); } })
      .catch(() => {
        if (n !== ultimaRef.current) return;
        setDatos({ ausencias: [], festivos: [] });
        setErrorCarga("No se pudieron cargar las ausencias");
        avisar("No se pudieron cargar las ausencias");
      });
  }, [desde, hasta, avisar]);
  const cargarBase = useCallback(() => {
    api
      .cargarBaseAusencias()
      .then((b) => { setBase(b); setErrorCarga(null); })
      .catch(() => {
        setBase({ tipos: [], empleados: [], asignaciones: [], miEmpleadoId: null });
        setErrorCarga("No se pudieron cargar los empleados y tipos de ausencia");
        avisar("No se pudieron cargar los empleados y tipos de ausencia");
      });
  }, [avisar]);
  useEffect(() => { cargarBase(); }, [cargarBase]);
  useEffect(() => { cargar(); }, [cargar]);
  const reintentar = () => { setBase(null); setDatos(null); setErrorCarga(null); cargarBase(); cargar(); };

  const cambiarVista = (v: Vista) => { setVista(v); guardarPref("aus:vista", v); };
  const miEmpleadoId = base?.miEmpleadoId ?? null;
  /** El empleado puede cancelar su propia solicitud mientras esté pendiente (política rrhh_ausencias_propio_cancelar). */
  const puedeBorrar = (a: Aus) => esGestor || (a.estado === "solicitada" && !!miEmpleadoId && a.empleado_id === miEmpleadoId);

  const tipos = useMemo(() => new Map((base?.tipos ?? []).map((t) => [t.id, t])), [base]);
  const emps = useMemo(() => new Map((base?.empleados ?? []).map((e) => [e.id, e])), [base]);
  const centros = useMemo(() => new Map(ctx.centros.map((c) => [c.id, c.nombre])), [ctx.centros]);

  /** Tipo del catálogo de una ausencia; si no tiene tipo_id, uno sintético por el enum. */
  const tipoDe = (a: Aus): Pick<Tipo, "nombre" | "color" | "codigo" | "computa_vacaciones"> =>
    (a.tipo_id && tipos.get(a.tipo_id)) || { nombre: a.tipo, color: "#888888", codigo: a.tipo.slice(0, 3).toUpperCase(), computa_vacaciones: a.tipo === "vacaciones" };
  const centroDe = (a: Aus) => a.centro_id || emps.get(a.empleado_id)?.centro_principal_id || null;

  /* ---------- Lista filtrada ---------- */
  const lista = useMemo(() => {
    if (!datos) return [];
    const orden = (a: Aus) => (a.estado === "solicitada" ? 0 : 1);
    return datos.ausencias
      .filter((a) => !fEstado || a.estado === fEstado)
      .filter((a) => !fTipo || a.tipo_id === fTipo)
      .filter((a) => !fCentro || centroDe(a) === fCentro)
      .sort((a, b) => orden(a) - orden(b) || b.fecha_inicio.localeCompare(a.fecha_inicio) || nombreCompleto(emps.get(a.empleado_id)).localeCompare(nombreCompleto(emps.get(b.empleado_id))));
  }, [datos, fEstado, fTipo, fCentro, emps, tipos]);
  // Pendientes de cualquier mes, sin filtros: es lo que marca el badge y el aviso de arriba
  const pendientes = (datos?.ausencias ?? []).filter((a) => a.estado === "solicitada").length;

  /* ---------- Calendario ---------- */
  const dias = useMemo(() => {
    const out: { iso: string; dia: number; dow: number }[] = [];
    for (let d = desde; d <= hasta; d = sumaDia(d, 1)) out.push({ iso: d, dia: Number(d.slice(8, 10)), dow: new Date(d + "T12:00").getDay() });
    return out;
  }, [desde, hasta]);

  const festivos = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of datos?.festivos ?? []) {
      if (f.centro_id && f.centro_id !== centroId) continue;
      if (!m.has(f.fecha)) m.set(f.fecha, f.nombre);
    }
    return m;
  }, [datos, centroId]);

  const filasCalendario = useMemo(() => {
    if (!base) return [];
    const ids = new Set(
      base.asignaciones
        .filter((s) => s.centro_id === centroId && (!s.fecha_inicio || s.fecha_inicio <= hasta) && (!s.fecha_fin || s.fecha_fin >= desde))
        .map((s) => s.empleado_id),
    );
    // Quien no tiene ninguna asignación cuenta por su centro principal (igual que en la lista)
    const conAsig = new Set(base.asignaciones.map((s) => s.empleado_id));
    const sinAsig = new Set(base.empleados.filter((e) => !conAsig.has(e.id) && e.centro_principal_id === centroId).map((e) => e.id));
    return base.empleados
      .filter((e) => (ids.has(e.id) || sinAsig.has(e.id)) && (!e.fecha_baja || e.fecha_baja >= desde) && (!e.fecha_alta || e.fecha_alta <= hasta))
      .sort((a, b) => (a.departamento || "zz").localeCompare(b.departamento || "zz") || nombreCompleto(a).localeCompare(nombreCompleto(b)));
  }, [base, centroId, desde, hasta]);

  /** empleado → día → ausencia (solo las que tocan el centro: sin centro o del centro). */
  const porEmpDia = useMemo(() => {
    const m = new Map<string, Map<string, Aus>>();
    for (const a of datos?.ausencias ?? []) {
      if (a.estado === "rechazada") continue;
      if (a.centro_id && a.centro_id !== centroId) continue;
      if (a.fecha_fin < desde || a.fecha_inicio > hasta) continue;
      let fila = m.get(a.empleado_id);
      if (!fila) m.set(a.empleado_id, (fila = new Map()));
      const ini = a.fecha_inicio < desde ? desde : a.fecha_inicio;
      const fin = a.fecha_fin > hasta ? hasta : a.fecha_fin;
      for (let d = ini; d <= fin; d = sumaDia(d, 1)) {
        const prev = fila.get(d);
        if (!prev || (prev.estado === "solicitada" && a.estado === "aprobada")) fila.set(d, a);
      }
    }
    return m;
  }, [datos, centroId, desde, hasta]);

  /* ---------- Acciones ---------- */
  const aprobarYa = async (a: Aus) => {
    setAprobando(a.id);
    const r = await api.resolverAusenciaV2(a.id, "aprobada");
    setAprobando(null);
    if (!r.ok) { avisar(r.error || "No se pudo aprobar"); return; }
    avisar("Ausencia aprobada"); cargar();
  };
  /** Aprobar desde la lista: si son vacaciones y el saldo quedaría en negativo, pide confirmación (1 llamada solo en ese clic). */
  const aprobar = async (a: Aus) => {
    if (aprobando) return;
    if (tipoDe(a).computa_vacaciones) {
      setAprobando(a.id);
      // El resto de la RPC ya descuenta las pendientes, así que esta solicitud ya está dentro
      const s = await api.saldoVacaciones(a.empleado_id, Number(a.fecha_inicio.slice(0, 4)));
      setAprobando(null);
      if (s && s.resto < 0) { setConfirmar({ ausencia: a, resto: s.resto }); return; }
    }
    await aprobarYa(a);
  };

  const abrirNueva = (inicial: Partial<api.AusenciaInput> = {}) => {
    setModal({
      id: null,
      inicial: {
        fecha_inicio: hoyIso(), fecha_fin: hoyIso(), centro_id: vista === "calendario" ? centroId : null,
        ...(esGestor ? {} : { empleado_id: miEmpleadoId ?? "", estado: "solicitada" }),
        ...inicial,
      },
    });
  };
  const abrirEditar = (a: Aus) => {
    if (!esGestor) { if (puedeBorrar(a)) setBorrar(a); return; } // el empleado solo puede cancelar la suya pendiente
    setModal({
      id: a.id,
      inicial: {
        empleado_id: a.empleado_id, tipo_id: a.tipo_id ?? "", fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin,
        medio_dia: a.medio_dia, horas: a.horas, nota: a.nota, centro_id: a.centro_id, estado: a.estado === "aprobada" ? "aprobada" : "solicitada",
      },
    });
  };

  const exportarCsv = () => {
    const filas: (string | number)[][] = [["Apellidos", "Nombre", "Código nómina", "Tipo", "Inicio", "Fin", "Nº horas", "Nº días naturales", "Estado", "Centro", "Nota"]];
    for (const a of lista) {
      const e = emps.get(a.empleado_id);
      const c = centroDe(a);
      filas.push([
        e?.apellidos || "", e?.nombre || "", e?.codigo_nomina || "", tipoDe(a).nombre, fmtFecha(a.fecha_inicio), fmtFecha(a.fecha_fin),
        fmtNum(horasDe(a, e?.horas_semana ?? null)), fmtNum(diasDe(a)), ESTADO_TXT[a.estado] || a.estado, c ? centros.get(c) || "" : "", a.nota || "",
      ]);
    }
    const csv = filas.map((f) => f.map((c) => { const s = String(c ?? ""); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ausencias_${mes.slice(0, 7)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const cargando = !base || !datos;

  return (
    <>
      <div className="barra">
        {/* Mismo orden que Planificación: centro · mes · vista … botón principal a la derecha */}
        <select
          value={vista === "calendario" ? centroId : fCentro}
          onChange={(e) => { const v = e.target.value; if (vista === "calendario") setCentroId(v); else { setFCentro(v); if (v) setCentroId(v); } }}
        >
          {vista === "solicitudes" ? <option value="">Todos los centros</option> : null}
          {ctx.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <div className="sem-nav">
          <button onClick={() => setMes(sumaMes(mes, -1))} aria-label="Mes anterior">‹</button>
          <span className="sem-label aus-mes">{mesLabel(mes)}</span>
          <button onClick={() => setMes(sumaMes(mes, 1))} aria-label="Mes siguiente">›</button>
          <button className="btn btn-fantasma" style={{ height: 34 }} onClick={() => setMes(hoyIso().slice(0, 7) + "-01")}>Hoy</button>
        </div>
        <div className="aus-vistas" role="tablist">
          <button className={vista === "solicitudes" ? "activa" : ""} onClick={() => cambiarVista("solicitudes")}>Solicitudes{pendientes ? <span className="aus-n">{pendientes}</span> : null}</button>
          <button className={vista === "calendario" ? "activa" : ""} onClick={() => cambiarVista("calendario")}>Calendario</button>
        </div>
        <button className="btn btn-primario aus-nueva" onClick={() => abrirNueva()} disabled={!base}>{esGestor ? "+ Nueva ausencia" : "+ Pedir ausencia"}</button>
      </div>
      {vista === "solicitudes" ? (
        <div className="aus-filtros">
          <select value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="solicitada">Pendientes</option>
            <option value="aprobada">Aprobadas</option>
            <option value="rechazada">Rechazadas</option>
          </select>
          <select value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
            <option value="">Todos los tipos</option>
            {(base?.tipos ?? []).map((t) => <option key={t.id} value={t.id}>{t.nombre}{t.activo ? "" : " (inactivo)"}</option>)}
          </select>
          <button className="btn btn-fantasma" onClick={exportarCsv} disabled={!lista.length}>Exportar CSV</button>
        </div>
      ) : null}

      {errorCarga ? (
        <div className="vacio aus-error">
          <div>{errorCarga}.</div>
          <button className="btn btn-fantasma" onClick={reintentar}>Reintentar</button>
        </div>
      ) : cargando ? (
        <div className="vacio">Cargando…</div>
      ) : vista === "solicitudes" ? (
        <ListaSolicitudes
          lista={lista} emps={emps} centros={centros} tipoDe={tipoDe} centroDe={centroDe} esGestor={esGestor} puedeBorrar={puedeBorrar}
          pendientes={pendientes} aprobando={aprobando}
          onAprobar={aprobar} onRechazar={setRechazo} onEditar={abrirEditar} onBorrar={setBorrar}
        />
      ) : (
        <Calendario
          filas={filasCalendario} dias={dias} festivos={festivos} porEmpDia={porEmpDia} tipos={base.tipos} tipoDe={tipoDe}
          onCeldaVacia={(empId, iso) => { if (esGestor || empId === miEmpleadoId) abrirNueva({ empleado_id: empId, fecha_inicio: iso, fecha_fin: iso, centro_id: centroId }); }}
          onAusencia={abrirEditar}
        />
      )}

      {modal && base ? (
        <ModalAusencia
          id={modal.id} inicial={modal.inicial} base={base} centros={ctx.centros} esGestor={esGestor}
          onCerrar={() => setModal(null)}
          onGuardado={(msg) => { setModal(null); avisar(msg); cargar(); }}
          onBorrar={(a) => { setModal(null); setBorrar(a); }}
          ausencia={modal.id ? datos?.ausencias.find((x) => x.id === modal.id) ?? null : null}
        />
      ) : null}

      {rechazo ? (
        <ModalRechazo
          ausencia={rechazo} nombre={nombreCompleto(emps.get(rechazo.empleado_id))}
          onCerrar={() => setRechazo(null)}
          onHecho={() => { setRechazo(null); avisar("Solicitud rechazada"); cargar(); }}
          avisar={avisar}
        />
      ) : null}

      {confirmar ? (
        <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) setConfirmar(null); }}>
          <div className="modal">
            <h2>Aprobar vacaciones</h2>
            <div className="sub">{nombreCompleto(emps.get(confirmar.ausencia.empleado_id))} · {rangoTxt(confirmar.ausencia)} · {fmtNum(diasDe(confirmar.ausencia))} {diasDe(confirmar.ausencia) === 1 ? "día" : "días"}</div>
            <p className="aus-texto">
              Se pasa del saldo de vacaciones de {confirmar.ausencia.fecha_inicio.slice(0, 4)}: quedaría en <b>{fmtNum(confirmar.resto)}</b> días. ¿Apruebas igualmente?
            </p>
            <div className="modal-acciones">
              <button type="button" className="btn btn-fantasma" onClick={() => setConfirmar(null)}>Cancelar</button>
              <button type="button" className="btn btn-primario" disabled={!!aprobando} onClick={async () => { const a = confirmar.ausencia; setConfirmar(null); await aprobarYa(a); }}>Aprobar igualmente</button>
            </div>
          </div>
        </div>
      ) : null}

      {borrar ? (
        <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) setBorrar(null); }}>
          <div className="modal">
            <h2>{borrar.estado === "solicitada" && !esGestor ? "Cancelar solicitud" : "Borrar ausencia"}</h2>
            <div className="sub">
              {nombreCompleto(emps.get(borrar.empleado_id))} · {tipoDe(borrar).nombre} · {rangoTxt(borrar)}
            </div>
            <p className="aus-texto">
              {borrar.estado === "aprobada"
                ? "Esta ausencia está aprobada. Si la borras desaparece del calendario, del contador y del saldo de vacaciones. No se puede deshacer."
                : "Se borra del todo. No se puede deshacer."}
            </p>
            <div className="modal-acciones">
              <button type="button" className="btn btn-fantasma" onClick={() => setBorrar(null)}>Cancelar</button>
              <button type="button" className="btn btn-borrar" onClick={async () => {
                const r = await api.borrarAusencia(borrar.id);
                if (!r.ok) { avisar(r.error || "No se pudo borrar"); return; }
                setBorrar(null); avisar(borrar.estado === "solicitada" && !esGestor ? "Solicitud cancelada" : "Ausencia borrada"); cargar();
              }}>{borrar.estado === "solicitada" && !esGestor ? "Cancelar solicitud" : "Borrar"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ==================== Lista de solicitudes ==================== */

function ListaSolicitudes({ lista, emps, centros, tipoDe, centroDe, esGestor, puedeBorrar, pendientes, aprobando, onAprobar, onRechazar, onEditar, onBorrar }: {
  lista: Aus[];
  emps: Map<string, api.EmpleadoAus>;
  centros: Map<string, string>;
  tipoDe: (a: Aus) => Pick<Tipo, "nombre" | "color" | "codigo" | "computa_vacaciones">;
  centroDe: (a: Aus) => string | null;
  esGestor: boolean;
  puedeBorrar: (a: Aus) => boolean;
  pendientes: number;
  aprobando: string | null;
  onAprobar: (a: Aus) => void;
  onRechazar: (a: Aus) => void;
  onEditar: (a: Aus) => void;
  onBorrar: (a: Aus) => void;
}) {
  if (!lista.length) return <div className="vacio">Sin ausencias este mes con esos filtros. Las solicitudes de los empleados aparecen aquí.</div>;
  return (
    <div className="aus-lista">
      {pendientes && esGestor ? <div className="aus-cab-pend">{pendientes} {pendientes === 1 ? "solicitud pendiente" : "solicitudes pendientes"} de aprobar (de cualquier mes)</div> : null}
      <table className="aus-tabla">
        <thead>
          <tr>
            <th>Empleado</th><th>Tipo</th><th>Desde</th><th>Hasta</th><th className="r" title="Días naturales; medio día = 0,5">Días nat.</th><th>Centro</th><th>Estado</th><th>Nota</th><th></th>
          </tr>
        </thead>
        <tbody>
          {lista.map((a) => {
            const e = emps.get(a.empleado_id);
            const t = tipoDe(a);
            const c = centroDe(a);
            const dur = a.horas != null ? fmtHoras(a.horas * (a.medio_dia ? 1 : diasDe(a))) : a.medio_dia ? "Medio día" : `${diasDe(a)} ${diasDe(a) === 1 ? "día" : "días"}`;
            const borrable = puedeBorrar(a);
            return (
              <tr key={a.id} className={`aus-fila ${a.estado} ${esGestor || borrable ? "" : "quieta"}`} onClick={() => onEditar(a)}>
                <td className="np">{nombreCompleto(e)}{e?.fecha_baja ? <span className="aus-baja"> baja</span> : null}</td>
                <td><span className="aus-punto" style={{ background: t.color || "#888" }} />{t.nombre}</td>
                <td>{fmtFecha(a.fecha_inicio)}</td>
                <td>{fmtFecha(a.fecha_fin)}</td>
                <td className="r" title="Días naturales; medio día = 0,5">{dur}</td>
                <td>{c ? centros.get(c) || "—" : "Todos"}{a.centro_id ? "" : <span className="aus-sub"> (principal)</span>}</td>
                <td>
                  <span className={`badge aus-estado ${a.estado}`}>{ESTADO_TXT[a.estado] || a.estado}</span>
                  {a.estado === "rechazada" && a.motivo_rechazo ? <div className="aus-sub" title={a.motivo_rechazo}>{a.motivo_rechazo}</div> : null}
                </td>
                <td className="aus-nota" title={a.nota || ""}>{a.nota || ""}</td>
                <td className="aus-acc" onClick={(ev) => ev.stopPropagation()}>
                  {esGestor && a.estado === "solicitada" ? (
                    <>
                      <button className="btn btn-primario btn-peque" disabled={!!aprobando} onClick={() => onAprobar(a)}>{aprobando === a.id ? "…" : "Aprobar"}</button>
                      <button className="btn btn-borrar btn-peque" disabled={!!aprobando} onClick={() => onRechazar(a)}>Rechazar</button>
                    </>
                  ) : (
                    <>
                      {esGestor ? <button className="link-btn2" onClick={() => onEditar(a)}>Editar</button> : null}
                      {borrable ? <button className="link-btn2 rojo" onClick={() => onBorrar(a)}>{esGestor ? "Borrar" : "Cancelar"}</button> : null}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ==================== Calendario mensual ==================== */

function Calendario({ filas, dias, festivos, porEmpDia, tipos, tipoDe, onCeldaVacia, onAusencia }: {
  filas: api.EmpleadoAus[];
  dias: { iso: string; dia: number; dow: number }[];
  festivos: Map<string, string>;
  porEmpDia: Map<string, Map<string, Aus>>;
  tipos: Tipo[];
  tipoDe: (a: Aus) => Pick<Tipo, "nombre" | "color" | "codigo" | "computa_vacaciones">;
  onCeldaVacia: (empId: string, iso: string) => void;
  onAusencia: (a: Aus) => void;
}) {
  const hoy = hoyIso();
  if (!filas.length) return <div className="vacio">Este centro no tiene empleados asignados este mes.</div>;
  const usados = new Set<string>();
  for (const fila of porEmpDia.values()) for (const a of fila.values()) if (a.tipo_id) usados.add(a.tipo_id);
  const leyenda = tipos.filter((t) => t.activo || usados.has(t.id));
  let deptoAnterior: string | null | undefined;

  return (
    <>
      <div className="plan-scroll">
        <table className="aus-cal">
          <thead>
            <tr>
              <th className="aus-cal-nombre">Empleado</th>
              {dias.map((d) => {
                const fest = festivos.get(d.iso);
                const finde = d.dow === 0 || d.dow === 6;
                return (
                  <th key={d.iso} className={`${finde ? "finde" : ""} ${fest ? "festivo" : ""} ${d.iso === hoy ? "hoy" : ""}`} title={fest || ""}>
                    <span className="dl">{DIAS_L[d.dow]}</span>{d.dia}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filas.map((e) => {
              const cab = e.departamento !== deptoAnterior;
              deptoAnterior = e.departamento;
              const fila = porEmpDia.get(e.id);
              return (
                <RowFragment key={e.id} cab={cab ? e.departamento || "Sin departamento" : null} cols={dias.length + 1}>
                  <td className="aus-cal-nombre"><span className="np">{e.apellidos || ""}{e.apellidos ? ", " : ""}{e.nombre}</span></td>
                  {dias.map((d) => {
                    const a = fila?.get(d.iso);
                    const fest = festivos.has(d.iso);
                    const finde = d.dow === 0 || d.dow === 6;
                    const esHoy = d.iso === hoy;
                    const fuera = (e.fecha_alta && d.iso < e.fecha_alta) || (e.fecha_baja && d.iso > e.fecha_baja);
                    if (a) {
                      const t = tipoDe(a);
                      const bg = t.color || "#888";
                      return (
                        <td key={d.iso} className={`aus-celda con ${a.estado === "solicitada" ? "pendiente" : ""} ${esHoy ? "hoy" : ""}`}
                          style={{ background: bg, color: colorTexto(bg) }}
                          title={`${t.nombre} · ${rangoTxt(a)}${a.medio_dia ? " · medio día (0,5 días naturales)" : a.horas != null ? " · " + fmtHoras(a.horas) : ` · ${diasDe(a)} ${diasDe(a) === 1 ? "día natural" : "días naturales"}`}${a.estado === "solicitada" ? " · pendiente de aprobar" : ""}${a.nota ? "\n" + a.nota : ""}`}
                          onClick={() => onAusencia(a)}>
                          {a.medio_dia ? "½" : t.codigo || t.nombre.slice(0, 3).toUpperCase()}
                        </td>
                      );
                    }
                    return (
                      <td key={d.iso} className={`aus-celda ${finde ? "finde" : ""} ${fest ? "festivo" : ""} ${fuera ? "fuera" : ""} ${esHoy ? "hoy" : ""}`}
                        title={fuera ? "Fuera de contrato" : fest ? festivos.get(d.iso) : "Añadir ausencia"}
                        onClick={() => { if (!fuera) onCeldaVacia(e.id, d.iso); }} />
                    );
                  })}
                </RowFragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="leyenda aus-leyenda">
        {leyenda.map((t) => <span key={t.id}><i className="muestra" style={{ background: t.color || "#888" }} />{t.nombre}</span>)}
        <span><i className="muestra aus-m-pend" />Pendiente de aprobar</span>
        <span><i className="muestra aus-m-fest" />Festivo</span>
        <span><i className="muestra aus-m-finde" />Fin de semana</span>
      </div>
    </>
  );
}

/** Fila de empleado con, si toca, su fila de departamento delante (sin envolver en un elemento extra). */
function RowFragment({ cab, cols, children }: { cab: string | null; cols: number; children: ReactNode }) {
  return (
    <>
      {cab ? <tr className="fila-depto"><td colSpan={cols}>{cab}</td></tr> : null}
      <tr>{children}</tr>
    </>
  );
}

/* ==================== Modal nueva / editar ==================== */

function ModalAusencia({ id, inicial, base, centros, esGestor, ausencia, onCerrar, onGuardado, onBorrar }: {
  id: string | null;
  inicial: Partial<api.AusenciaInput>;
  base: Base;
  centros: { id: string; nombre: string }[];
  esGestor: boolean;
  ausencia: Aus | null;
  onCerrar: () => void;
  onGuardado: (msg: string) => void;
  onBorrar: (a: Aus) => void;
}) {
  const hoy = hoyIso();
  // Quien no es gestor solo puede pedir los tipos solicitables (el trigger de la base rechaza el resto)
  const tiposActivos = base.tipos.filter((t) => (t.activo && (esGestor || t.solicitable_empleado)) || t.id === inicial.tipo_id);
  // Quien no es gestor solo puede pedir para sí mismo y como pendiente (política rrhh_ausencias_propio_solicitud)
  const empFijo = !esGestor ? base.miEmpleadoId : null;
  const [empId, setEmpId] = useState(empFijo ?? inicial.empleado_id ?? "");
  const [busca, setBusca] = useState(() => nombreCompleto(base.empleados.find((e) => e.id === inicial.empleado_id)) || "");
  const [abierto, setAbierto] = useState(false);
  const [tipoId, setTipoId] = useState(inicial.tipo_id || tiposActivos[0]?.id || "");
  const [desde, setDesde] = useState(inicial.fecha_inicio ?? hoy);
  const [hasta, setHasta] = useState(inicial.fecha_fin ?? hoy);
  const [medioDia, setMedioDia] = useState(!!inicial.medio_dia);
  const [horas, setHoras] = useState(inicial.horas != null ? String(inicial.horas).replace(".", ",") : "");
  const [nota, setNota] = useState(inicial.nota ?? "");
  const [centroId, setCentroId] = useState(inicial.centro_id ?? "");
  const [estado, setEstado] = useState<"solicitada" | "aprobada">(esGestor ? (inicial.estado ?? "aprobada") : "solicitada");
  const [saldo, setSaldo] = useState<api.SaldoVacaciones | null | "cargando">(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const buscaRef = useRef<HTMLInputElement>(null);

  const tipo = base.tipos.find((t) => t.id === tipoId);
  const emp = base.empleados.find((e) => e.id === empId);
  const anio = Number(desde.slice(0, 4)) || Number(hoy.slice(0, 4));

  const candidatos = useMemo(() => {
    const q = busca.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return base.empleados
      .filter((e) => !e.fecha_baja || e.fecha_baja >= hoy || e.id === empId)
      .filter((e) => !q || `${e.nombre} ${e.apellidos || ""} ${e.codigo_nomina || ""}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q))
      .slice(0, 8);
  }, [base.empleados, busca, hoy, empId]);

  // Saldo de vacaciones cuando el tipo computa vacaciones
  useEffect(() => {
    if (!empId || !tipo?.computa_vacaciones) { setSaldo(null); return; }
    let vivo = true;
    setSaldo("cargando");
    api.saldoVacaciones(empId, anio).then((s) => { if (vivo) setSaldo(s); }).catch(() => { if (vivo) setSaldo(null); });
    return () => { vivo = false; };
  }, [empId, tipo?.computa_vacaciones, anio]);

  const horasNum = horas.trim() ? Number(horas.replace(",", ".")) : null;
  const diasEsta = hasta >= desde ? diasDe({ fecha_inicio: desde, fecha_fin: hasta, medio_dia: medioDia }) : 0;
  // Parte de esta ausencia que cae en el año del saldo (la RPC recorta por año)
  const diasEstaAnio = hasta >= desde ? diasEnAnio({ fecha_inicio: desde, fecha_fin: hasta, medio_dia: medioDia }, anio) : 0;
  // Si se edita una ausencia de vacaciones ya contada, sus días de ese año ya están dentro de disfrutados / pendientes
  const diasYaContados = ausencia && ausencia.estado !== "rechazada" && tipoDeComputaVac(ausencia, base) ? diasEnAnio(ausencia, anio) : 0;
  const restoTras = saldo && saldo !== "cargando" ? saldo.resto + diasYaContados - diasEstaAnio : null;

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    setError("");
    if (!empId) { setError(empFijo === null && !esGestor ? "No tienes ficha de empleado. Pídeselo a RRHH." : "Elige un empleado de la lista"); buscaRef.current?.focus(); return; }
    if (horasNum != null && Number.isNaN(horasNum)) { setError("Las horas no son un número"); return; }
    setGuardando(true);
    const r = await api.guardarAusencia(id, {
      empleado_id: empId, tipo_id: tipoId, fecha_inicio: desde, fecha_fin: hasta, medio_dia: medioDia,
      horas: horasNum, nota: nota || null, centro_id: centroId || null, estado,
    });
    setGuardando(false);
    if (!r.ok) { setError(r.error || "No se pudo guardar"); return; }
    onGuardado(id ? "Ausencia guardada" : estado === "aprobada" ? "Ausencia registrada y aprobada" : "Ausencia registrada como pendiente");
  };

  return (
    <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <form className="modal aus-modal" onSubmit={guardar}>
        <h2>{id ? "Editar ausencia" : esGestor ? "Nueva ausencia" : "Pedir ausencia"}</h2>
        {ausencia?.estado === "rechazada" ? <div className="sub">Rechazada{ausencia.motivo_rechazo ? `: ${ausencia.motivo_rechazo}` : ""}. Si la guardas como pendiente o aprobada, vuelve a contar.</div> : null}

        <label>Empleado</label>
        {id || !esGestor ? (
          <div className="aus-emp-fijo">{empId ? nombreCompleto(emp) : "Sin ficha de empleado"}</div>
        ) : (
          <div className="aus-busca">
            <input
              ref={buscaRef} type="text" placeholder="Escribe el nombre…" value={busca} autoFocus
              onChange={(e) => { setBusca(e.target.value); setEmpId(""); setAbierto(true); }}
              onFocus={() => setAbierto(true)}
              onBlur={() => setTimeout(() => setAbierto(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !empId && candidatos.length) { e.preventDefault(); setEmpId(candidatos[0].id); setBusca(nombreCompleto(candidatos[0])); setAbierto(false); }
              }}
            />
            {abierto && !empId ? (
              <div className="aus-sugerencias">
                {candidatos.length ? candidatos.map((e) => (
                  <button type="button" key={e.id} onMouseDown={(ev) => ev.preventDefault()} onClick={() => { setEmpId(e.id); setBusca(nombreCompleto(e)); setAbierto(false); }}>
                    <span className="np">{nombreCompleto(e)}</span>
                    <span className="aus-sub">{[e.departamento, e.codigo_nomina].filter(Boolean).join(" · ")}</span>
                  </button>
                )) : <div className="aus-sub" style={{ padding: 8 }}>Nadie coincide</div>}
              </div>
            ) : null}
          </div>
        )}

        <label>Tipo</label>
        <select value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
          {tiposActivos.map((t) => <option key={t.id} value={t.id}>{t.nombre}{t.activo ? "" : " (inactivo)"}</option>)}
        </select>
        {tipo ? (
          <div className="aus-ayuda">
            <i className="aus-punto" style={{ background: tipo.color || "#888" }} />
            {CATEGORIA[tipo.categoria] || tipo.categoria}
            {tipo.computa_vacaciones ? " · descuenta vacaciones" : ""}
            {tipo.computa_contador ? " · cuenta en el contador de horas" : " · no cuenta en el contador"}
            {tipo.requiere_justificante ? " · requiere justificante" : ""}
          </div>
        ) : null}

        <div className="fila-2">
          <div><label>Desde</label><input type="date" required value={desde} onChange={(e) => { const v = e.target.value; if (!v) return; setDesde(v); if (hasta < v) setHasta(v); }} /></div>
          <div><label>Hasta</label><input type="date" required value={hasta} min={desde} onChange={(e) => { const v = e.target.value; if (!v) return; setHasta(v); if (v !== desde) setMedioDia(false); }} /></div>
        </div>

        <div className="fila-2 aus-duracion">
          <div>
            <label>Medio día</label>
            <label className="aus-check">
              <input type="checkbox" checked={medioDia} disabled={desde !== hasta || horasNum != null} onChange={(e) => setMedioDia(e.target.checked)} />
              <span>Solo media jornada{desde !== hasta ? " (un único día)" : ""}</span>
            </label>
          </div>
          <div>
            <label>Horas (ausencia parcial)</label>
            <input type="text" inputMode="decimal" placeholder="p. ej. 2,5" value={horas} disabled={medioDia} onChange={(e) => setHoras(e.target.value)} />
          </div>
        </div>
        <div className="aus-ayuda">
          {medioDia ? "Cuenta 0,5 días." : horasNum ? `${fmtHoras(horasNum)} por día${diasEsta > 1 ? ` × ${diasEsta} días` : ""}.` : diasEsta ? `${diasEsta} ${diasEsta === 1 ? "día natural" : "días naturales"}.` : ""}
        </div>

        <div className="fila-2">
          <div>
            <label>Centro</label>
            <select value={centroId} onChange={(e) => setCentroId(e.target.value)}>
              <option value="">Todos los centros</option>
              {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label>Estado</label>
            {esGestor ? (
              <select value={estado} onChange={(e) => setEstado(e.target.value as "solicitada" | "aprobada")}>
                <option value="solicitada">Pendiente de aprobar</option>
                <option value="aprobada">Aprobada</option>
              </select>
            ) : (
              <div className="aus-emp-fijo">Se guarda como pendiente de aprobar</div>
            )}
          </div>
        </div>

        <label>Nota</label>
        <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Opcional: lo que haga falta saber" />

        {tipo?.computa_vacaciones && empId ? (
          <div className={`aus-saldo ${restoTras != null && restoTras < 0 ? "neg" : ""}`}>
            <h3>Saldo de vacaciones {anio}</h3>
            {saldo === "cargando" ? (
              <div className="aus-sub">Calculando…</div>
            ) : !saldo ? (
              <div className="aus-sub">No se pudo calcular el saldo (¿sin periodo de contrato en {anio}?).</div>
            ) : (
              <>
                <div className="aus-saldo-grid">
                  <span>Derecho anual</span><b>{fmtNum(saldo.derecho_anual)}</b>
                  <span>Devengado a hoy</span><b>{fmtNum(saldo.devengado_hoy)}</b>
                  <span>Disfrutados</span><b>{fmtNum(saldo.disfrutados)}</b>
                  <span>Pendientes de aprobar</span><b>{fmtNum(saldo.pendientes_aprobar)}</b>
                  <span>Resto</span><b>{fmtNum(saldo.resto)}</b>
                </div>
                {restoTras != null ? (
                  <div className="aus-saldo-tras">
                    {diasEsta ? <>Con esta ausencia ({fmtNum(diasEstaAnio)} {diasEstaAnio === 1 ? "día" : "días"} en {anio}) le quedarían <b>{fmtNum(restoTras)}</b> días.</> : null}
                    {diasEsta && diasEstaAnio !== diasEsta ? <div className="aus-sub">El resto de días cae en {anio + 1} y cuenta en el saldo de ese año.</div> : null}
                    {restoTras < 0 ? <div className="aus-aviso">Se pasa del saldo: quedaría en negativo.</div> : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {error ? <div className="aviso-modal">{error}</div> : null}
        <div className="modal-acciones">
          <button type="button" className="btn btn-fantasma" onClick={onCerrar}>Cancelar</button>
          {id && ausencia && esGestor ? (
            <button type="button" className="btn btn-borrar" onClick={() => onBorrar(ausencia)}>Borrar</button>
          ) : null}
          <button type="submit" className="btn btn-primario" disabled={guardando || !tipoId}>{guardando ? "Guardando…" : esGestor ? "Guardar" : "Enviar solicitud"}</button>
        </div>
      </form>
    </div>
  );
}

function tipoDeComputaVac(a: Aus, base: Base): boolean {
  const t = a.tipo_id ? base.tipos.find((x) => x.id === a.tipo_id) : null;
  return t ? t.computa_vacaciones : a.tipo === "vacaciones";
}

/* ==================== Modal rechazo ==================== */

function ModalRechazo({ ausencia, nombre, onCerrar, onHecho, avisar }: {
  ausencia: Aus; nombre: string; onCerrar: () => void; onHecho: () => void; avisar: (m: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  return (
    <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <form className="modal" onSubmit={async (e) => {
        e.preventDefault();
        if (!motivo.trim() || enviando) return;
        setEnviando(true);
        const r = await api.resolverAusenciaV2(ausencia.id, "rechazada", motivo);
        setEnviando(false);
        if (!r.ok) { avisar(r.error || "No se pudo rechazar"); return; }
        onHecho();
      }}>
        <h2>Rechazar solicitud</h2>
        <div className="sub">{nombre} · {rangoTxt(ausencia)}</div>
        <label>Motivo (el empleado lo verá)</label>
        <textarea rows={3} required autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: esa semana ya hay dos personas de vacaciones" />
        <div className="modal-acciones">
          <button type="button" className="btn btn-fantasma" onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn btn-borrar" disabled={!motivo.trim() || enviando}>Rechazar</button>
        </div>
      </form>
    </div>
  );
}
