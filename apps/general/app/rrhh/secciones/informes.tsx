"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import * as api from "../acciones";
import * as inf from "../acciones/informes";
import { calcularDia, horaDe, horasNetas, hoyIso, sumaDia, type Fichaje } from "../tipos";
import { CENTRO_SKELLO, fmtFecha, fmtHoras, guardarPref, leerPref, rangoMes, useCentroRecordado, type SecProps } from "../lib-rrhh";
import "./informes.css";

/* ==================== Utilidades ==================== */

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const CONCEPTOS = ["Prima", "Anticipo", "Plus transporte", "Dietas", "Otros"];
/** Tope de filas de PostgREST: por encima corta en silencio. */
const TOPE_FILAS = 10000;

/** 7.5 → "7,50" (dos decimales y coma; para importes y ficheros). */
const n2 = (v: number) => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace(".", ",");
const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const eur = (v: number) => n2(v) + " €";
/** Horas en pantalla: «7,5 h», o «—» si es cero (para no llenar la tabla de ceros). */
const hCelda = (v: number) => (Math.abs(Number(v) || 0) < 0.005 ? <span className="inf-falta">—</span> : fmtHoras(v));
const nombreDe = (e: { nombre: string; apellidos: string | null }) => `${e.apellidos || ""} ${e.nombre}`.trim();
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
const diasEntre = (a: string, b: string) => Math.round((new Date(b + "T12:00").getTime() - new Date(a + "T12:00").getTime()) / 86400000) + 1;
/** "2026-09-30" → "30/09" si es del año en curso, "30/09/26" si no (etiquetas cortas de estado). */
function fechaCorta(iso: string) {
  const f = fmtFecha(iso);
  return iso.slice(0, 4) === String(new Date().getFullYear()) ? f.slice(0, 5) : f.slice(0, 6) + f.slice(8);
}
/** Centro inicial de una subsección: su propia preferencia o, si nunca se eligió, el centro del resto del panel ('rrhh:centro'). «Todos» ("") se respeta si se eligió a propósito. */
function centroInicial(clave: string, centros: { id: string }[]) {
  const propio = leerPref<string | null>(clave, null);
  const id = propio == null ? leerPref<string>("centro", "") : propio;
  return centros.some((c) => c.id === id) ? id : "";
}
/** Parte un rango en tramos de mes natural (para no pasar del tope de filas por petición). */
function tramosMes(desde: string, hasta: string) {
  const out: { desde: string; hasta: string }[] = [];
  let ini = desde;
  while (ini <= hasta) {
    const fin = rangoMes(ini).hasta;
    out.push({ desde: ini, hasta: fin < hasta ? fin : hasta });
    ini = sumaDia(fin, 1);
  }
  return out;
}

type Celda = string | number | null;

function descargarCsv(nombre: string, filas: Celda[][]) {
  const csv = filas
    .map((f) => f.map((c) => {
      const s = typeof c === "number" ? (Number.isInteger(c) ? String(c) : n2(c)) : String(c ?? "");
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(";"))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Libro Excel con varias hojas (nombre → filas; la primera fila son las cabeceras). Los números van como números. */
function descargarExcel(nombre: string, hojas: { nombre: string; filas: Celda[][] }[]) {
  const libro = XLSX.utils.book_new();
  for (const h of hojas) {
    const ws = XLSX.utils.aoa_to_sheet(h.filas.map((f) => f.map((c) => (typeof c === "number" ? r2(c) : c ?? ""))));
    const anchos = (h.filas[0] ?? []).map((_, i) => ({ wch: Math.min(40, Math.max(8, ...h.filas.map((f) => String(f[i] ?? "").length + 2))) }));
    ws["!cols"] = anchos;
    XLSX.utils.book_append_sheet(libro, ws, h.nombre.slice(0, 31));
  }
  XLSX.writeFile(libro, nombre);
}

/* ==================== Sección ==================== */

type Sub = "nomina" | "horas" | "plantilla";
const SUBS: { id: Sub; nombre: string }[] = [
  { id: "nomina", nombre: "Informe de nómina" },
  { id: "horas", nombre: "Horas y registro" },
  { id: "plantilla", nombre: "Plantilla" },
];

export default function SecInformes({ ctx, avisar }: SecProps) {
  const [sub, setSub] = useState<Sub>(() => {
    const s = leerPref<string>("informes:sub", "nomina");
    return SUBS.some((x) => x.id === s) ? (s as Sub) : "nomina";
  });
  const cambiar = (s: Sub) => { setSub(s); guardarPref("informes:sub", s); };
  return (
    <>
      <div className="inf-subtabs">
        {SUBS.map((s) => (
          <button key={s.id} className={sub === s.id ? "activa" : ""} onClick={() => cambiar(s.id)}>{s.nombre}</button>
        ))}
      </div>
      {sub === "nomina" ? <SubNomina ctx={ctx} avisar={avisar} /> : sub === "horas" ? <SubHoras ctx={ctx} avisar={avisar} /> : <SubPlantilla ctx={ctx} avisar={avisar} />}
    </>
  );
}

/* ==================== 1. Informe de nómina ==================== */

type DatosNomina = Extract<Awaited<ReturnType<typeof inf.informeNomina>>, { ok: true }>;

function SubNomina({ ctx, avisar }: SecProps) {
  const hoy = hoyIso();
  const anioHoy = Number(hoy.slice(0, 4));
  const ANIOS = [anioHoy - 2, anioHoy - 1, anioHoy, anioHoy + 1];
  // Por defecto el mes anterior: es el que se manda a la gestoría.
  const [anioDef, mesDef] = (() => { const [a, m] = hoy.split("-").map(Number); return m === 1 ? [a - 1, 12] : [a, m - 1]; })();
  const [anio, setAnio] = useState(anioDef);
  const [mes, setMes] = useState(mesDef);
  const [centroId, setCentroId] = useState<string>(() => centroInicial("informes:centro-nomina", ctx.centros));
  const [datos, setDatos] = useState<DatosNomina | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [edicion, setEdicion] = useState<string | null>(null); // empleado_id abierto en el modal
  const [busca, setBusca] = useState("");
  const ultima = useRef(0); // nº de la última petición: las respuestas antiguas se descartan

  const cargar = useCallback(async () => {
    const id = ++ultima.current;
    setCargando(true);
    try {
      const d = await inf.informeNomina(anio, mes, centroId || null);
      if (id !== ultima.current) return; // ya hay otro filtro en marcha
      if (!d.ok) { setDatos(null); setError(d.error); return; }
      setDatos(d);
      setError(null);
    } catch {
      if (id !== ultima.current) return;
      setDatos(null);
      setError("sin respuesta del servidor");
    } finally {
      if (id === ultima.current) setCargando(false);
    }
  }, [anio, mes, centroId]);
  useEffect(() => { cargar(); }, [cargar]);

  /** Mueve el mes n posiciones (ajusta el año); no sale del rango de años del selector. */
  function irMes(n: number) {
    const t = anio * 12 + (mes - 1) + n;
    const a = Math.floor(t / 12);
    if (!ANIOS.includes(a)) return;
    setAnio(a);
    setMes((t % 12) + 1);
  }

  const centroNombre = (id: string | null) => ctx.centros.find((c) => c.id === id)?.nombre ?? "";
  const tipoPorCodigo = useMemo(() => Object.fromEntries((datos?.tipos ?? []).map((t) => [t.codigo ?? t.nombre, t])), [datos]);
  const codigosAus = useMemo(() => {
    const set = new Set<string>();
    for (const f of datos?.filas ?? []) for (const k of Object.keys(f.ausencias)) set.add(k);
    const orden = (datos?.tipos ?? []).map((t) => t.codigo ?? t.nombre);
    return [...set].sort((a, b) => (orden.indexOf(a) === -1 ? 99 : orden.indexOf(a)) - (orden.indexOf(b) === -1 ? 99 : orden.indexOf(b)));
  }, [datos]);
  const conceptos = useMemo(() => {
    const set = new Set<string>();
    for (const f of datos?.filas ?? []) for (const k of Object.keys(f.variables)) set.add(k);
    return [...set].sort();
  }, [datos]);

  const filasVisibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const todas = datos?.filas ?? [];
    return q ? todas.filter((f) => nombreDe(f).toLowerCase().includes(q) || (f.codigo_nomina || "").toLowerCase().includes(q)) : todas;
  }, [datos, busca]);

  const etiquetaMes = `${MESES[mes - 1]} ${anio}`;
  const claveMes = `${anio}-${String(mes).padStart(2, "0")}`;
  const centroFichero = centroId ? (CENTRO_SKELLO[centroNombre(centroId)] ?? slug(centroNombre(centroId))) : "todos";

  /** Hoja Resumen (y CSV): una fila por empleado. */
  function filasResumen(): Celda[][] {
    if (!datos) return [];
    const cab: Celda[] = [
      "Código nómina", "Apellidos", "Nombre", "Centro", "Departamento", "Tipo contrato", "H/semana", "H contrato mes", "Días contrato", "Días trabajados",
      "H retenidas", "H ausencia (contador)", "H extra", "H nocturnas", "H domingo", "H festivo",
      ...codigosAus.flatMap((c) => [`${c} días`, `${c} horas`]),
      "Variables total", ...conceptos, "Comentario",
    ];
    const out: Celda[][] = [cab];
    for (const f of datos.filas) {
      out.push([
        f.codigo_nomina || "", f.apellidos || "", f.nombre, centroNombre(f.centro_principal_id), f.departamento_id ? datos.departamentos[f.departamento_id] ?? "" : "", f.tipo_contrato || "",
        f.horas_semana, f.horas_contrato_mes, f.dias_contrato, f.dias_trabajados,
        f.horas_retenidas, f.horas_ausencia_contador, f.horas_extra, f.horas_nocturnas, f.horas_domingo, f.horas_festivo,
        ...codigosAus.flatMap((c) => [f.ausencias[c]?.dias ?? 0, f.ausencias[c]?.horas ?? 0]),
        Object.values(f.variables).reduce((s, v) => s + v, 0), ...conceptos.map((c) => f.variables[c] ?? 0), f.comentario,
      ]);
    }
    return out;
  }

  function exportarExcel() {
    if (!datos) return;
    const nombres = Object.fromEntries(datos.filas.map((f) => [f.empleado_id, nombreDe(f)]));
    const hsem = Object.fromEntries(datos.filas.map((f) => [f.empleado_id, f.horas_semana]));
    const semanas: Celda[][] = [["Empleado", "Código nómina", "Año ISO", "Semana", "Lunes", "H contrato", "H planificadas", "H realizadas", "H ausencia (contador)", "Diferencia"]];
    const codigos = Object.fromEntries(datos.filas.map((f) => [f.empleado_id, f.codigo_nomina || ""]));
    for (const s of [...datos.semanas].sort((a, b) => nombres[a.empleado_id].localeCompare(nombres[b.empleado_id]) || a.lunes.localeCompare(b.lunes))) {
      semanas.push([nombres[s.empleado_id], codigos[s.empleado_id], s.anio, s.semana, fmtFecha(s.lunes), s.horas_contrato, s.horas_plan, s.horas_retenidas, s.horas_ausencia_contador, s.diferencia]);
    }
    const { desde, hasta } = { desde: `${claveMes}-01`, hasta: `${claveMes}-${String(new Date(anio, mes, 0).getDate()).padStart(2, "0")}` };
    const ausencias: Celda[][] = [["Empleado", "Código nómina", "Tipo", "Código", "Desde", "Hasta", "Días en el mes", "Horas", "Nota"]];
    for (const a of datos.ausencias) {
      // Misma regla que rrhh_informe_nomina (aus_dia): por día natural del tramo dentro del mes,
      // medio día = 0,5 d por día; horas = `horas` por día si viene informada, si no días × h/semana / 7.
      const ini = a.fecha_inicio < desde ? desde : a.fecha_inicio;
      const fin = a.fecha_fin > hasta ? hasta : a.fecha_fin;
      const nDias = diasEntre(ini, fin);
      const dias = nDias * (a.medio_dia ? 0.5 : 1);
      const horas = a.horas != null ? a.horas * nDias : (dias * (hsem[a.empleado_id] ?? 0)) / 7;
      ausencias.push([nombres[a.empleado_id], codigos[a.empleado_id], a.tipo_nombre, a.tipo_codigo, fmtFecha(a.fecha_inicio), fmtFecha(a.fecha_fin), dias, horas, a.nota || ""]);
    }
    const variables: Celda[][] = [["Empleado", "Código nómina", "Concepto", "Importe", "Descripción"]];
    for (const v of [...datos.variables].sort((a, b) => (nombres[a.empleado_id] || "").localeCompare(nombres[b.empleado_id] || ""))) {
      variables.push([nombres[v.empleado_id], codigos[v.empleado_id], v.concepto, Number(v.importe), v.descripcion || ""]);
    }
    descargarExcel(`nomina_${centroFichero}_${claveMes}.xlsx`, [
      { nombre: "Resumen", filas: filasResumen() },
      { nombre: "Horas por semana", filas: semanas },
      { nombre: "Ausencias", filas: ausencias },
      { nombre: "Variables", filas: variables },
    ]);
    avisar("Excel generado");
  }

  const filaEdicion = datos?.filas.find((f) => f.empleado_id === edicion) ?? null;

  return (
    <>
      <div className="barra">
        <div className="sem-nav">
          <button onClick={() => irMes(-1)} aria-label="Mes anterior">‹</button>
          <select className="inf-nav-sel" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select className="inf-nav-sel" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {ANIOS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button onClick={() => irMes(1)} aria-label="Mes siguiente">›</button>
          <button className="btn btn-fantasma inf-nav-btn" onClick={() => { setAnio(anioDef); setMes(mesDef); }}>Mes anterior</button>
        </div>
        <select value={centroId} onChange={(e) => { setCentroId(e.target.value); guardarPref("informes:centro-nomina", e.target.value); }}>
          <option value="">Todos los centros</option>
          {ctx.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <input className="inf-busca" placeholder="Buscar empleado…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className="inf-sep" />
        <button className="btn btn-fantasma" disabled={!datos || cargando} onClick={() => { descargarCsv(`nomina_${centroFichero}_${claveMes}.csv`, filasResumen()); avisar("CSV generado"); }}>⬇ CSV</button>
        <button className="btn btn-primario" disabled={!datos || cargando} onClick={exportarExcel}>⬇ Excel</button>
      </div>

      {error ? (
        <div className="vacio">
          No se pudo calcular {etiquetaMes}: {error}
          <div className="inf-reintentar"><button className="btn btn-fantasma btn-peque" disabled={cargando} onClick={cargar}>{cargando ? "Calculando…" : "Reintentar"}</button></div>
        </div>
      ) : !datos ? (
        <div className="vacio">Calculando {etiquetaMes}…</div>
      ) : !datos.filas.length ? (
        <div className="vacio">Nadie con contrato ni turnos publicados en {etiquetaMes}{centroId ? ` en ${centroNombre(centroId)}` : ""}.</div>
      ) : (
        <>
          <div className="inf-resumen">
            <span><b>{datos.filas.length}</b> empleados</span>
            <span><b>{n2(datos.filas.reduce((s, f) => s + f.horas_retenidas, 0))}</b> h retenidas</span>
            <span><b>{n2(datos.filas.reduce((s, f) => s + f.horas_extra, 0))}</b> h extra</span>
            <span><b>{eur(datos.variables.reduce((s, v) => s + Number(v.importe), 0))}</b> en variables</span>
            {cargando ? <span className="inf-cargando">Actualizando…</span> : null}
          </div>
          <div className="inf-scroll">
            <table className="inf inf-nomina">
              <thead>
                <tr>
                  <th>Empleado</th><th>Código</th><th>Contrato</th><th>h/sem</th><th>h contrato mes</th><th>Días trab.</th>
                  <th>h retenidas</th><th>h extra</th><th>Nocturnas</th><th>Domingos</th><th>Festivos</th>
                  <th className="izq">Ausencias</th><th>Variables</th><th className="izq">Comentario</th>
                </tr>
              </thead>
              <tbody>
                {filasVisibles.map((f) => {
                  const totalVar = Object.values(f.variables).reduce((s, v) => s + v, 0);
                  const nVar = datos.variables.filter((v) => v.empleado_id === f.empleado_id).length;
                  return (
                    <tr key={f.empleado_id} className={ctx.esGestor ? "inf-fila" : ""} onClick={ctx.esGestor ? () => setEdicion(f.empleado_id) : undefined} title={ctx.esGestor ? "Variables y comentario" : undefined}>
                      <td className="np">
                        {nombreDe(f)}
                        <div className="inf-sub">{centroNombre(f.centro_principal_id)}{f.departamento_id && datos.departamentos[f.departamento_id] ? ` · ${datos.departamentos[f.departamento_id]}` : ""}</div>
                      </td>
                      <td className="inf-cod">{f.codigo_nomina || <span className="inf-falta">sin código</span>}</td>
                      <td className="izq inf-contrato">{f.tipo_contrato || "—"}</td>
                      <td>{fmtHoras(f.horas_semana)}</td>
                      <td>{fmtHoras(f.horas_contrato_mes)}</td>
                      <td>{f.dias_trabajados}</td>
                      <td>{fmtHoras(f.horas_retenidas)}</td>
                      <td className={f.horas_extra > 0 ? "desv-mas" : ""}>{hCelda(f.horas_extra)}</td>
                      <td>{hCelda(f.horas_nocturnas)}</td>
                      <td>{hCelda(f.horas_domingo)}</td>
                      <td>{hCelda(f.horas_festivo)}</td>
                      <td className="izq">
                        {Object.entries(f.ausencias).map(([c, v]) => {
                          const t = tipoPorCodigo[c];
                          return (
                            <span key={c} className="inf-aus" style={t?.color ? { borderColor: t.color } : undefined} title={t?.nombre ?? c}>
                              <b>{c}</b> {String(v.dias).replace(".", ",")} d · {fmtHoras(v.horas)}
                            </span>
                          );
                        })}
                      </td>
                      <td>{nVar ? <>{eur(totalVar)}<div className="inf-sub">{nVar} {nVar === 1 ? "concepto" : "conceptos"}</div></> : <span className="inf-falta">—</span>}</td>
                      <td className="izq inf-coment">{f.comentario || <span className="inf-falta">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="nota-inf">
            h retenidas = horas validadas en Fichajes o, si no hay, las planificadas. h extra = retenidas + ausencias que computan − contrato del mes.
            Ausencias en días naturales, a horas semanales / 7 por día (como Skello).{ctx.esGestor ? " Clic en un empleado para añadir primas, anticipos o un comentario para la gestoría." : ""}
          </div>
        </>
      )}

      {filaEdicion && datos ? (
        <ModalVariables
          fila={filaEdicion}
          anio={anio}
          mes={mes}
          etiquetaMes={etiquetaMes}
          variables={datos.variables.filter((v) => v.empleado_id === filaEdicion.empleado_id)}
          avisar={avisar}
          cerrar={() => setEdicion(null)}
          cambiado={cargar}
        />
      ) : null}
    </>
  );
}

function ModalVariables({ fila, anio, mes, etiquetaMes, variables, avisar, cerrar, cambiado }: {
  fila: inf.FilaNomina;
  anio: number;
  mes: number;
  etiquetaMes: string;
  variables: inf.VariableNomina[];
  avisar: (m: string) => void;
  cerrar: () => void;
  cambiado: () => void;
}) {
  const [lista, setLista] = useState(variables);
  const [editId, setEditId] = useState<string | null>(null);
  const [concepto, setConcepto] = useState("Prima");
  const [importe, setImporte] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [comentario, setComentario] = useState(fila.comentario);
  const [guardando, setGuardando] = useState(false);
  const [tocado, setTocado] = useState(false); // ya se ha guardado alguna variable: al cerrar hay que refrescar la tabla

  function editar(v: inf.VariableNomina) {
    setEditId(v.id); setConcepto(v.concepto); setImporte(String(v.importe).replace(".", ",")); setDescripcion(v.descripcion || "");
  }
  function limpiar() { setEditId(null); setConcepto("Prima"); setImporte(""); setDescripcion(""); }

  async function guardarVar() {
    if (guardando) return;
    const imp = Number(importe.replace(",", "."));
    if (!concepto.trim()) { avisar("Indica el concepto"); return; }
    if (!importe.trim() || !Number.isFinite(imp)) { avisar("Indica un importe válido"); return; }
    setGuardando(true);
    try {
      const r = await inf.guardarVariable(editId, { empleado_id: fila.empleado_id, anio, mes, concepto, importe: imp, descripcion });
      if (!r.ok || !r.data) { avisar("No se pudo guardar: " + (r.error || "")); return; }
      const nueva = r.data;
      setLista((l) => (editId ? l.map((x) => (x.id === editId ? nueva : x)) : [...l, nueva]));
      setTocado(true);
      avisar(editId ? "Variable actualizada" : "Variable añadida");
      limpiar();
    } catch {
      avisar("No se pudo guardar la variable");
    } finally {
      setGuardando(false);
    }
  }

  async function borrarVar(id: string) {
    if (guardando) return;
    const r = await inf.borrarVariable(id);
    if (!r.ok) { avisar("No se pudo borrar: " + (r.error || "")); return; }
    setLista((l) => l.filter((x) => x.id !== id));
    setTocado(true);
    if (editId === id) limpiar();
    avisar("Variable borrada");
  }

  async function guardarComent() {
    if (comentario.trim() === fila.comentario.trim()) return true;
    const r = await inf.guardarComentario(fila.empleado_id, anio, mes, comentario);
    if (!r.ok) { avisar("No se pudo guardar el comentario: " + (r.error || "")); return false; }
    setTocado(true);
    return true;
  }

  /** «Guardar y cerrar»: guarda el comentario y refresca si ha cambiado algo. */
  async function cerrarGuardando() {
    if (guardando) return;
    setGuardando(true);
    let ok = false;
    try { ok = await guardarComent(); } catch { avisar("No se pudo guardar el comentario"); } finally { setGuardando(false); }
    if (!ok) return;
    if (tocado || comentario.trim() !== fila.comentario.trim()) cambiado();
    cerrar();
  }

  /** «Cancelar», Escape o clic fuera: cierra sin guardar el comentario (las variables ya guardadas se quedan, y se refresca la tabla). */
  const cancelar = useCallback(() => {
    if (guardando) return;
    if (tocado) cambiado();
    cerrar();
  }, [guardando, tocado, cambiado, cerrar]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") cancelar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [cancelar]);

  const total = lista.reduce((s, v) => s + Number(v.importe), 0);

  return (
    <div className="rh-modal" onClick={cancelar}>
      <div className="modal inf-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{nombreDe(fila)}</h2>
        <div className="sub">{etiquetaMes}{fila.codigo_nomina ? ` · código ${fila.codigo_nomina}` : ""}</div>

        <h3 className="inf-h3">Variables del mes</h3>
        {lista.length ? (
          <table className="inf-vars">
            <tbody>
              {lista.map((v) => (
                <tr key={v.id} className={v.id === editId ? "edit" : ""}>
                  <td><b>{v.concepto}</b>{v.descripcion ? <div className="inf-sub">{v.descripcion}</div> : null}</td>
                  <td className="num">{eur(Number(v.importe))}</td>
                  <td className="acc">
                    <button className="link-btn2" onClick={() => editar(v)}>Editar</button>
                    <button className="link-btn2 rojo" onClick={() => borrarVar(v.id)}>Borrar</button>
                  </td>
                </tr>
              ))}
              <tr className="total"><td>Total</td><td className="num">{eur(total)}</td><td /></tr>
            </tbody>
          </table>
        ) : <div className="inf-sub">Sin variables este mes.</div>}

        {/* Enter en cualquiera de los tres campos añade la variable */}
        <div className="inf-form-var" onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); guardarVar(); } }}>
          <div>
            <label>Concepto</label>
            <input list="inf-conceptos" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Prima, Anticipo…" />
            <datalist id="inf-conceptos">{CONCEPTOS.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label>Importe (€)</label>
            <input inputMode="decimal" value={importe} onChange={(e) => setImporte(e.target.value)} placeholder="0,00" />
          </div>
          <div className="ancho">
            <label>Descripción (opcional)</label>
            <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej.: anticipo pedido el 12/09" />
          </div>
          <div className="botones">
            <button className="btn btn-primario btn-peque" disabled={guardando} onClick={guardarVar}>{editId ? "Guardar cambios" : "+ Añadir"}</button>
            {editId ? <button className="btn btn-fantasma btn-peque" onClick={limpiar}>Cancelar</button> : null}
          </div>
        </div>

        <h3 className="inf-h3">Comentario para la gestoría</h3>
        <textarea rows={3} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Lo que la gestoría tiene que saber de esta persona este mes" />

        <div className="modal-acciones">
          <button className="btn btn-fantasma" disabled={guardando} onClick={cancelar}>Cancelar</button>
          <button className="btn btn-primario" disabled={guardando} onClick={cerrarGuardando}>{guardando ? "Guardando…" : "Guardar y cerrar"}</button>
        </div>
      </div>
    </div>
  );
}

/* ==================== 2. Horas y registro ==================== */

function SubHoras({ ctx, avisar }: SecProps) {
  const [centroId, setCentroId] = useCentroRecordado(ctx.centros);
  const hoy = hoyIso();
  const [desde, setDesde] = useState(hoy.slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoy);
  const [datos, setDatos] = useState<{
    filas: Record<string, { plan: number; real: number; inc: number }>;
    nombres: Record<string, string>;
    porEmpDia: Record<string, Record<string, Fichaje[]>>;
    fichajesTodos: Fichaje[];
    centroNombre: string;
    desde: string;
    hasta: string;
  } | null>(null);
  const [calculando, setCalculando] = useState(false);

  async function calcular() {
    if (!desde || !hasta || desde > hasta) { avisar("Revisa el rango de fechas."); return; }
    if (diasEntre(desde, hasta) > 366) { avisar("Elige un rango de hasta un año."); return; }
    setCalculando(true);
    try {
      // Se pide por meses: PostgREST corta a 10.000 filas en silencio y el registro de Inspección no puede salir incompleto.
      const partes = await Promise.all(tramosMes(desde, hasta).map((t) => api.datosInforme(centroId, t.desde, t.hasta)));
      if (partes.some((p) => p.fichajes.length >= TOPE_FILAS)) {
        avisar("Hay demasiados fichajes en un mes y el registro puede estar incompleto. Acorta el rango.");
      }
      const d = { empleados: partes[0]?.empleados ?? [], turnos: partes.flatMap((p) => p.turnos), fichajes: partes.flatMap((p) => p.fichajes) };
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
      setDatos({ filas, nombres, porEmpDia, fichajesTodos: d.fichajes, centroNombre: ctx.centros.find((c) => c.id === centroId)?.nombre || "", desde, hasta });
    } catch {
      avisar("No se pudo calcular");
    } finally {
      setCalculando(false);
    }
  }

  /** Las tres tablas (resumen, detalle diario, registro completo) como filas; sirven para CSV y Excel. */
  function tablas() {
    if (!datos) return null;
    const periodo = `${fmtFecha(datos.desde)} a ${fmtFecha(datos.hasta)}`;
    const resumen: Celda[][] = [["Centro", "Periodo", "Empleado", "Horas planificadas", "Horas fichadas", "Desviación", "Incidencias"]];
    for (const [id, r] of Object.entries(datos.filas)) resumen.push([datos.centroNombre, periodo, datos.nombres[id] || "", r.plan, r.real, r.real - r.plan, r.inc]);
    const detalle: Celda[][] = [["Centro", "Empleado", "Fecha", "Fichajes del día", "Horas netas", "Incidencias"]];
    for (const [id, dias] of Object.entries(datos.porEmpDia)) for (const dkey of Object.keys(dias).sort()) {
      const efs = dias[dkey];
      const { horas, inc } = calcularDia(efs, false);
      detalle.push([datos.centroNombre, datos.nombres[id] || "", fmtFecha(dkey), efs.map((f) => `${f.tipo} ${horaDe(f.ts)}`).join(" | "), horas, inc.length]);
    }
    const an = new Set(datos.fichajesTodos.map((f) => f.corrige_a).filter(Boolean) as string[]);
    const registro: Celda[][] = [["Centro", "Empleado", "Fecha y hora", "Tipo", "Método", "Estado", "Corrige a", "Motivo corrección", "Registrado el"]];
    for (const f of datos.fichajesTodos) {
      registro.push([datos.centroNombre, datos.nombres[f.empleado_id] || "", new Date(f.ts).toLocaleString("es-ES"), f.tipo, f.metodo, an.has(f.id) ? "ANULADO por corrección" : "vigente", f.corrige_a || "", f.motivo_correccion || "", new Date(f.creado_en).toLocaleString("es-ES")]);
    }
    return { resumen, detalle, registro, sufijo: `${slug(datos.centroNombre)}_${datos.desde}_${datos.hasta}` };
  }

  const ids = datos ? Object.keys(datos.filas).sort((a, b) => (datos.nombres[a] || "").localeCompare(datos.nombres[b] || "")) : [];
  let tp = 0, tr = 0;

  return (
    <>
      <div className="barra inf-barra-filtros">
        <select value={centroId} onChange={(e) => setCentroId(e.target.value)}>
          {ctx.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <span className="inf-a">a</span>
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <button className="btn btn-primario" disabled={calculando} onClick={calcular}>{calculando ? "Calculando…" : "Calcular"}</button>
      </div>
      <div className="barra inf-barra-descargas">
        <span className="inf-sep" />
        <button className="btn btn-fantasma" disabled={!datos} onClick={() => { const t = tablas(); if (!t) return; descargarCsv(`resumen_${t.sufijo}.csv`, t.resumen); }}>⬇ CSV resumen</button>
        <button className="btn btn-fantasma" disabled={!datos} onClick={() => { const t = tablas(); if (!t) return; descargarCsv(`detalle_diario_${t.sufijo}.csv`, t.detalle); }}>⬇ CSV detalle diario</button>
        <button className="btn btn-fantasma" disabled={!datos} onClick={() => { const t = tablas(); if (!t) return; descargarCsv(`registro_horario_${t.sufijo}.csv`, t.registro); }}>⬇ CSV registro (Inspección)</button>
        <button className="btn btn-primario" disabled={!datos} onClick={() => {
          const t = tablas(); if (!t) return;
          descargarExcel(`horas_${t.sufijo}.xlsx`, [
            { nombre: "Resumen", filas: t.resumen },
            { nombre: "Detalle diario", filas: t.detalle },
            { nombre: "Registro completo", filas: t.registro },
          ]);
          avisar("Excel generado");
        }}>⬇ Excel</button>
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
                  <td>{fmtHoras(r.plan)}</td>
                  <td>{fmtHoras(r.real)}</td>
                  <td className={cl}>{d >= 0 ? "+" : ""}{fmtHoras(d)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Total {datos.centroNombre}</td>
              <td>{fmtHoras(tp)}</td>
              <td>{fmtHoras(tr)}</td>
              <td className={tr - tp > 0 ? "desv-mas" : tr - tp < 0 ? "desv-menos" : ""}>{tr - tp >= 0 ? "+" : ""}{fmtHoras(tr - tp)}</td>
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

/* ==================== 3. Plantilla (fijos discontinuos) ==================== */

type EstadoPlantilla = "activo" | "proximo" | "inactivo" | "baja";
type FilaPlantilla = {
  e: inf.EmpleadoPlantilla;
  estado: EstadoPlantilla;
  etiqueta: string;
  desde: string | null; // inicio del periodo actual (o del próximo)
  hasta: string | null; // fin del periodo actual, si lo tiene
  diasParaFin: number | null;
  horas: number | null;
};
type PeriodoEfectivo = { fecha_alta: string; fin: string | null; horas_semana: number | null };

const ES_FIJO_DISC = (t: string | null) => /discontinu/i.test(t || "");

/** Misma regla que rrhh_periodos_efectivos en la base: ordenados por alta, cada periodo se cierra
 *  en la víspera del siguiente (hay fijos discontinuos con varios periodos «abiertos» a la vez por
 *  llamamientos sucesivos). Sin periodos, se usa la alta/baja del empleado. */
function periodosEfectivos(e: inf.EmpleadoPlantilla, periodos: inf.PeriodoMin[]): PeriodoEfectivo[] {
  const ps = periodos.length
    ? [...periodos].sort((a, b) => a.fecha_alta.localeCompare(b.fecha_alta))
    : e.fecha_alta ? [{ fecha_alta: e.fecha_alta, fecha_baja: e.fecha_baja, horas_semana: e.horas_semana }] : [];
  return ps.map((p, i) => {
    const sig = ps[i + 1]?.fecha_alta;
    const vispera = sig ? sumaDia(sig, -1) : null;
    const fin = vispera ? (p.fecha_baja && p.fecha_baja < vispera ? p.fecha_baja : vispera) : p.fecha_baja;
    return { fecha_alta: p.fecha_alta, fin, horas_semana: p.horas_semana ?? e.horas_semana };
  });
}

function clasificar(e: inf.EmpleadoPlantilla, periodos: inf.PeriodoMin[], hoy: string): FilaPlantilla {
  const ps = periodosEfectivos(e, periodos);
  // El vigente es el último (alta más reciente) que esté abierto hoy: es el que usan nómina y contadores.
  const actual = [...ps].reverse().find((p) => p.fecha_alta <= hoy && (!p.fin || p.fin >= hoy));
  if (actual) {
    const diasParaFin = actual.fin ? diasEntre(hoy, actual.fin) - 1 : null;
    return { e, estado: "activo", etiqueta: "Activo", desde: actual.fecha_alta, hasta: actual.fin, diasParaFin, horas: actual.horas_semana };
  }
  const proximo = ps.find((p) => p.fecha_alta > hoy);
  if (proximo) {
    return { e, estado: "proximo", etiqueta: `Alta el ${fechaCorta(proximo.fecha_alta)}`, desde: proximo.fecha_alta, hasta: proximo.fin, diasParaFin: null, horas: proximo.horas_semana };
  }
  const ultimo = ps.filter((p) => p.fin).sort((a, b) => (b.fin || "").localeCompare(a.fin || ""))[0];
  const finIso = ultimo?.fin ?? e.fecha_baja ?? null;
  const horas = ultimo?.horas_semana ?? e.horas_semana;
  if (ES_FIJO_DISC(e.tipo_contrato)) {
    const desdeIso = finIso ? sumaDia(finIso, 1) : null;
    return { e, estado: "inactivo", etiqueta: desdeIso ? `Inactivo desde ${fechaCorta(desdeIso)}` : "Inactivo", desde: null, hasta: null, diasParaFin: null, horas };
  }
  return { e, estado: "baja", etiqueta: finIso ? `Baja ${fechaCorta(finIso)}` : "Sin periodo", desde: null, hasta: null, diasParaFin: null, horas };
}

const ORDEN_ESTADO: Record<EstadoPlantilla, number> = { activo: 0, proximo: 1, inactivo: 2, baja: 3 };

function SubPlantilla({ ctx, avisar }: SecProps) {
  const hoy = hoyIso();
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof inf.datosPlantilla>> | null>(null);
  const [centro, setCentro] = useState<string>(() => centroInicial("informes:centro-plantilla", ctx.centros));
  const [depto, setDepto] = useState("");
  const [estado, setEstado] = useState<"" | EstadoPlantilla | "fin30">("");
  const [busca, setBusca] = useState("");
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    setFallo(false);
    inf.datosPlantilla().then(setDatos).catch(() => { setFallo(true); avisar("No se pudo cargar la plantilla"); });
  }, [avisar]);

  const filas = useMemo(() => {
    if (!datos) return [];
    const porEmp: Record<string, inf.PeriodoMin[]> = {};
    for (const p of datos.periodos) (porEmp[p.empleado_id] = porEmp[p.empleado_id] || []).push(p);
    return datos.empleados
      .map((e) => clasificar(e, porEmp[e.id] ?? [], hoy))
      .sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || nombreDe(a.e).localeCompare(nombreDe(b.e)));
  }, [datos, hoy]);

  const departamentos = useMemo(() => [...new Set(filas.map((f) => f.e.departamento).filter(Boolean) as string[])].sort(), [filas]);
  const centroNombre = (id: string | null) => ctx.centros.find((c) => c.id === id)?.nombre ?? "";

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return filas.filter((f) =>
      (!centro || f.e.centro_principal_id === centro) &&
      (!depto || f.e.departamento === depto) &&
      (!estado || (estado === "fin30" ? f.diasParaFin != null && f.diasParaFin <= 30 : f.estado === estado)) &&
      (!q || nombreDe(f.e).toLowerCase().includes(q) || (f.e.codigo_nomina || "").toLowerCase().includes(q)),
    );
  }, [filas, centro, depto, estado, busca]);

  const cuenta = (est: EstadoPlantilla) => visibles.filter((f) => f.estado === est).length;
  const nFin30 = visibles.filter((f) => f.diasParaFin != null && f.diasParaFin <= 30).length;

  function exportarCsv() {
    const out: Celda[][] = [["Código nómina", "Apellidos", "Nombre", "Centro", "Departamento", "Tipo contrato", "Horas/semana", "Estado", "Periodo desde", "Periodo hasta", "Días para el fin"]];
    for (const f of visibles) {
      out.push([f.e.codigo_nomina || "", f.e.apellidos || "", f.e.nombre, centroNombre(f.e.centro_principal_id), f.e.departamento || "", f.e.tipo_contrato || "", f.horas ?? "", f.etiqueta, f.desde ? fmtFecha(f.desde) : "", f.hasta ? fmtFecha(f.hasta) : "", f.diasParaFin ?? ""]);
    }
    descargarCsv(`plantilla_${hoy}.csv`, out);
    avisar("CSV generado");
  }

  return (
    <>
      <div className="barra">
        <select value={centro} onChange={(e) => { setCentro(e.target.value); guardarPref("informes:centro-plantilla", e.target.value); }}>
          <option value="">Todos los centros</option>
          {ctx.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select value={depto} onChange={(e) => setDepto(e.target.value)}>
          <option value="">Todos los departamentos</option>
          {departamentos.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}>
          <option value="">Todos los estados</option>
          <option value="activo">Activos</option>
          <option value="fin30">Fin de periodo en 30 días</option>
          <option value="proximo">Alta próxima</option>
          <option value="inactivo">Inactivos (fijo-disc.)</option>
          <option value="baja">Baja definitiva</option>
        </select>
        <input className="inf-busca" placeholder="Buscar…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className="inf-sep" />
        <button className="btn btn-fantasma" disabled={!datos} onClick={exportarCsv}>⬇ CSV</button>
      </div>
      {fallo ? (
        <div className="vacio">No se pudo cargar la plantilla. Recarga la página para volver a intentarlo.</div>
      ) : !datos ? (
        <div className="vacio">Cargando…</div>
      ) : (
        <>
          <div className="inf-resumen">
            <span><b>{cuenta("activo")}</b> activos</span>
            <span className={nFin30 ? "inf-alerta" : ""}><b>{nFin30}</b> acaban en 30 días</span>
            <span><b>{cuenta("proximo")}</b> con alta próxima</span>
            <span><b>{cuenta("inactivo")}</b> inactivos</span>
            <span><b>{cuenta("baja")}</b> de baja</span>
          </div>
          {!visibles.length ? (
            <div className="vacio">Nadie con estos filtros.</div>
          ) : (
            <div className="inf-scroll">
              <table className="inf inf-plantilla">
                <thead>
                  <tr><th>Empleado</th><th className="izq">Centro</th><th className="izq">Departamento</th><th className="izq">Contrato</th><th>h/sem</th><th className="izq">Estado</th><th className="izq">Periodo actual</th><th className="izq">Fin de periodo</th></tr>
                </thead>
                <tbody>
                  {visibles.map((f) => (
                    <tr key={f.e.id}>
                      <td className="np">{nombreDe(f.e)}{f.e.codigo_nomina ? <div className="inf-sub">código {f.e.codigo_nomina}</div> : null}</td>
                      <td className="izq">{centroNombre(f.e.centro_principal_id) || "—"}</td>
                      <td className="izq">{f.e.departamento || "—"}</td>
                      <td className="izq inf-contrato">{f.e.tipo_contrato || "—"}</td>
                      <td>{f.horas != null ? fmtHoras(f.horas) : "—"}</td>
                      <td className="izq"><span className={`inf-estado ${f.estado}`}>{f.etiqueta}</span></td>
                      <td className="izq">{f.desde ? `${fmtFecha(f.desde)} → ${f.hasta ? fmtFecha(f.hasta) : "abierto"}` : "—"}</td>
                      <td className="izq">
                        {f.diasParaFin == null ? "—" : f.diasParaFin <= 30
                          ? <span className="inf-fin">{f.diasParaFin === 0 ? "Hoy" : f.diasParaFin === 1 ? "Mañana" : `En ${f.diasParaFin} días`}</span>
                          : `En ${f.diasParaFin} días`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="nota-inf">
            Activo = tiene un periodo de contrato abierto hoy (si hay varios, el de alta más reciente; cada periodo acaba la víspera del siguiente). Inactivo = fijo discontinuo entre periodos (desde el día siguiente al último fin). Baja = contrato no discontinuo con periodo cerrado. Los periodos se gestionan en la ficha del empleado.
          </div>
        </>
      )}
    </>
  );
}
