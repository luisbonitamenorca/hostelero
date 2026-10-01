"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../acciones/planificacion";
import type { AusenciaPlan, EmpleadoPlan, Festivo, PlantillaTurno, PuestoCat, TurnoAjeno } from "../acciones/planificacion";
import {
  DIAS_SEMANA, dowDe, finAbsoluto, hh, horasNetas, hoyIso, lunesDe, minutos, sumaDia, type Turno,
} from "../tipos";
import { colorTexto, fmtHoras, semanaIso, useCentroRecordado, type SecProps } from "../lib-rrhh";
import "./planificacion.css";

type Datos = Awaited<ReturnType<typeof api.cargarSemanaPlan>>;
type Celda = { empleadoId: string | null; fecha: string };
type Modal = Celda & { turno: Turno | null };
type Vista = "semana" | "dia";

const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const GRIS = "#888";
const ENUM_AUS: Record<string, string> = { vacaciones: "Vacaciones", baja: "Baja", permiso: "Permiso", otro: "Ausencia" };
const H0 = 6 * 60; // vista día: 06:00
const H1 = 26 * 60; // … hasta 02:00
const HORAS_DIA = Array.from({ length: (H1 - H0) / 60 }, (_, i) => (6 + i) % 24);

/* ======================================================================
   Sección
   ====================================================================== */

export default function SecPlanificacion({ ctx, avisar }: SecProps) {
  const [centroId, setCentroId] = useCentroRecordado(ctx.centros);
  const [lunes, setLunes] = useState(lunesDe(hoyIso()));
  const [vista, setVista] = useState<Vista>("semana");
  const [dia, setDia] = useState(hoyIso());
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const peticion = useRef(0); // solo la última petición lanzada puede pintar datos
  const [modal, setModal] = useState<Modal | null>(null);
  const [menu, setMenu] = useState<{ turno: Turno; x: number; y: number } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = useState<{ titulo: string; texto: string; boton: string; peligro?: boolean; accion: () => Promise<void> | void } | null>(null);
  const [modalPublicar, setModalPublicar] = useState(false);
  const [modalModelos, setModalModelos] = useState(false);
  const [dropEn, setDropEn] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const hasta = sumaDia(lunes, 6);
  const hoy = hoyIso();

  const cargar = useCallback(() => {
    if (!centroId) { setDatos(null); setErrorCarga(null); setCargando(false); return; }
    const n = ++peticion.current;
    setCargando(true);
    api.cargarSemanaPlan(centroId, lunes, sumaDia(lunes, 6))
      .then((d) => { if (n === peticion.current) { setDatos(d); setErrorCarga(null); } })
      .catch((e: unknown) => {
        if (n !== peticion.current) return;
        setErrorCarga(e instanceof Error && e.message ? e.message : "No se pudo cargar la semana");
        avisar("No se pudo cargar la semana");
      })
      .finally(() => { if (n === peticion.current) setCargando(false); });
  }, [centroId, lunes, avisar]);
  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setSel(new Set()); setMenu(null); }, [centroId, lunes]);
  useEffect(() => {
    // Al cambiar de semana, el día de la vista Día se queda dentro de ella.
    if (dia < lunes || dia > hasta) setDia(hoy >= lunes && hoy <= hasta ? hoy : lunes);
  }, [lunes, hasta, dia, hoy]);
  useEffect(() => {
    // Esc cierra lo que esté más arriba: confirmación › modales › menú y selección.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmar) setConfirmar(null);
      else if (modal) setModal(null);
      else if (modalPublicar) setModalPublicar(false);
      else if (modalModelos) setModalModelos(false);
      else { setMenu(null); setSel(new Set()); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmar, modal, modalPublicar, modalModelos]);

  /* ---------- catálogos ---------- */
  const puestoPorId = useMemo(() => {
    const m = new Map<string, PuestoCat>();
    for (const p of datos?.puestos ?? []) m.set(p.id, p);
    return m;
  }, [datos]);
  const puestoPorNombre = useMemo(() => {
    const m = new Map<string, PuestoCat>();
    for (const p of datos?.puestos ?? []) m.set(p.nombre.trim().toLowerCase(), p);
    return m;
  }, [datos]);
  const puestoDe = useCallback(
    (t: { puesto_id: string | null; puesto: string | null }): PuestoCat | null => {
      if (t.puesto_id && puestoPorId.has(t.puesto_id)) return puestoPorId.get(t.puesto_id)!;
      if (t.puesto) return puestoPorNombre.get(t.puesto.trim().toLowerCase()) ?? null;
      return null;
    },
    [puestoPorId, puestoPorNombre],
  );
  const colorDe = useCallback((t: Turno) => t.color || puestoDe(t)?.color || GRIS, [puestoDe]);
  const nombrePuesto = useCallback((t: { puesto_id: string | null; puesto: string | null }) => puestoDe(t)?.nombre || t.puesto || "", [puestoDe]);

  const festivoPorFecha = useMemo(() => {
    const m = new Map<string, Festivo>();
    for (const f of datos?.festivos ?? []) {
      // El local del centro manda sobre el general si coinciden en fecha.
      const prev = m.get(f.fecha);
      if (!prev || (f.centro_id && !prev.centro_id)) m.set(f.fecha, f);
    }
    return m;
  }, [datos]);

  /* ---------- cálculo: horas, totales y avisos ---------- */
  const calc = useMemo(() => {
    const horasEmp: Record<string, number> = {};
    const horasOtros: Record<string, number> = {}; // horas de la semana en otros centros (el contrato es de la persona)
    const totalDia: Record<string, { horas: number; personas: Set<string>; huecos: number }> = {};
    const lista: string[] = [];
    const conflicto = new Set<string>();
    if (!datos) return { horasEmp, horasOtros, totalDia, lista, conflicto };

    for (let d = 0; d < 7; d++) totalDia[sumaDia(lunes, d)] = { horas: 0, personas: new Set(), huecos: 0 };
    for (const t of datos.turnos) {
      const td = totalDia[t.fecha];
      if (!td) continue;
      td.horas += horasNetas(t);
      if (t.empleado_id) { td.personas.add(t.empleado_id); horasEmp[t.empleado_id] = (horasEmp[t.empleado_id] ?? 0) + horasNetas(t); }
      else td.huecos += 1;
    }
    for (const t of datos.ajenos) {
      if (t.fecha >= lunes && t.empleado_id) horasOtros[t.empleado_id] = (horasOtros[t.empleado_id] ?? 0) + horasNetas(t);
    }

    const r = datos.reglas;
    const minDescanso = datos.pacto10h ? 10 : r?.descanso_diario_h != null ? Number(r.descanso_diario_h) : 12;
    const maxDiaria = r?.jornada_max_diaria_h != null ? Number(r.jornada_max_diaria_h) : 9;
    const maxSeguidos = r?.max_dias_consecutivos != null ? Number(r.max_dias_consecutivos) : 6;
    const descansoSemanalH = (r?.descanso_semanal_dias != null ? Number(r.descanso_semanal_dias) : 1.5) * 24;
    const nocIni = minutos((r?.nocturno_inicio ?? "22:00").slice(0, 5));
    const nocFin = minutos((r?.nocturno_fin ?? "06:00").slice(0, 5));
    const diaDe = (f: string) => DIAS_SEMANA[dowDe(f)].toLowerCase();
    const esNocturno = (t: { hora_inicio: string; hora_fin: string }) => {
      const a = minutos(t.hora_inicio), b = finAbsoluto(t);
      const ventanas = [[nocIni - 1440, nocFin], [nocIni, nocFin + 1440]];
      return ventanas.some(([vi, vf]) => a < vf && b > vi);
    };
    const lunesPrev = sumaDia(lunes, -7);
    const diasDesdeLunesPrev = (f: string) => Math.round((new Date(f + "T12:00").getTime() - new Date(lunesPrev + "T12:00").getTime()) / 86400000);
    // Festivos: una sola línea por día (en hostelería se trabaja todos; lo que importa es cuántos).
    const enFestivo: Record<string, Set<string>> = {};

    for (const e of datos.empleados) {
      const nombre = `${e.nombre}${e.apellidos ? " " + e.apellidos.split(" ")[0] : ""}`;
      // Todos sus turnos: este centro + otros centros, semana anterior incluida (descanso y días seguidos reales).
      const todos: { id: string; fecha: string; hora_inicio: string; hora_fin: string; pausa_min: number | null; ajeno: boolean }[] = [
        ...datos.turnos.filter((t) => t.empleado_id === e.id).map((t) => ({ ...t, ajeno: false })),
        ...datos.turnosPrevios.filter((t) => t.empleado_id === e.id).map((t) => ({ ...t, ajeno: false })),
        ...datos.ajenos.filter((t) => t.empleado_id === e.id).map((t) => ({ ...t, ajeno: true })),
      ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora_inicio.localeCompare(b.hora_inicio));

      const total = horasEmp[e.id] ?? 0;
      const otros = horasOtros[e.id] ?? 0;
      if (e.horas_vigentes && total + otros > Number(e.horas_vigentes) + 0.01)
        lista.push(
          `${nombre}: ${fmtHoras(total + otros)} planificadas${otros ? ` (${fmtHoras(otros)} en otros centros)` : ""}, contrato de ${fmtHoras(Number(e.horas_vigentes))}.`,
        );

      for (let i = 1; i < todos.length; i++) {
        const a = todos[i - 1], b = todos[i];
        if (b.fecha < lunes) continue;
        const diasEntre = Math.round((new Date(b.fecha + "T12:00").getTime() - new Date(a.fecha + "T12:00").getTime()) / 86400000);
        const finA = finAbsoluto(a) - diasEntre * 1440;
        const descanso = (minutos(b.hora_inicio) - finA) / 60;
        if (diasEntre === 0) {
          // Mismo día: solo se avisa del solape. Un turno partido (10–14 / 18–23) es normal y no es
          // «descanso entre jornadas».
          if (minutos(b.hora_inicio) < finAbsoluto(a)) {
            lista.push(`${nombre}: turnos solapados el ${diaDe(b.fecha)}.`);
            if (!a.ajeno) conflicto.add(a.id);
            if (!b.ajeno) conflicto.add(b.id);
          }
        } else if (descanso < minDescanso) {
          lista.push(`${nombre}: solo ${fmtHoras(Math.max(0, descanso))} de descanso antes del turno del ${diaDe(b.fecha)} (mínimo ${fmtHoras(minDescanso)}).`);
          if (!b.ajeno) conflicto.add(b.id);
        }
      }
      for (const t of todos) {
        if (t.ajeno || t.fecha < lunes) continue;
        if (horasNetas(t) > maxDiaria) lista.push(`${nombre}: turno de ${fmtHoras(horasNetas(t))} el ${diaDe(t.fecha)} (máximo ${fmtHoras(maxDiaria)}).`);
        if (festivoPorFecha.has(t.fecha)) (enFestivo[t.fecha] ??= new Set()).add(e.id);
        if (e.menor_en_semana && esNocturno(t)) {
          lista.push(`${nombre}: es menor de edad y tiene turno nocturno el ${diaDe(t.fecha)}.`);
          conflicto.add(t.id);
        }
      }
      // Días seguidos contando la semana anterior (todos los centros).
      const fechas = [...new Set(todos.map((t) => t.fecha))].sort();
      let racha = 1, avisado = false;
      for (let i = 1; i < fechas.length && !avisado; i++) {
        racha = sumaDia(fechas[i - 1], 1) === fechas[i] ? racha + 1 : 1;
        if (racha > maxSeguidos && fechas[i] >= lunes) {
          lista.push(`${nombre}: ${racha} días seguidos de trabajo hasta el ${diaDe(fechas[i])} ${ddmm(fechas[i])} (máximo ${maxSeguidos}).`);
          avisado = true;
        }
      }
      // Descanso semanal: en la ventana [lunes anterior 00:00, domingo 24:00] (todos los centros)
      // tiene que haber un hueco libre de descanso_semanal_dias × 24 h (36 h por defecto).
      // Solo se mira si esta semana tiene algún turno suyo en este centro.
      if (todos.some((t) => !t.ajeno && t.fecha >= lunes)) {
        const finVentana = 14 * 1440;
        let mayorHueco = 0, finAnterior = 0;
        for (const t of todos) {
          const base = diasDesdeLunesPrev(t.fecha) * 1440;
          mayorHueco = Math.max(mayorHueco, base + minutos(t.hora_inicio) - finAnterior);
          finAnterior = Math.max(finAnterior, base + finAbsoluto(t));
        }
        mayorHueco = Math.max(mayorHueco, finVentana - finAnterior);
        if (mayorHueco / 60 < descansoSemanalH - 0.01)
          lista.push(`${nombre}: no tiene ${fmtHoras(descansoSemanalH)} seguidas de descanso en la semana (el hueco mayor es de ${fmtHoras(Math.round(mayorHueco / 6) / 10)}).`);
      }
    }
    for (const [fecha, quienes] of Object.entries(enFestivo).sort(([a], [b]) => a.localeCompare(b))) {
      const fest = festivoPorFecha.get(fecha)!;
      lista.push(`${DIAS_SEMANA[dowDe(fecha)]} ${ddmm(fecha)} es festivo (${fest.nombre}): ${quienes.size} persona${quienes.size === 1 ? "" : "s"} con turno.`);
    }
    return { horasEmp, horasOtros, totalDia, lista: [...new Set(lista)], conflicto };
  }, [datos, lunes, festivoPorFecha]);

  /* ---------- acciones ---------- */
  const tras = (r: { ok: boolean; error?: string }, msgOk: string, msgKo: string) => {
    if (!r.ok) { avisar(`${msgKo}: ${r.error ?? ""}`); return false; }
    avisar(msgOk);
    cargar();
    return true;
  };

  const soltar = async (destino: Celda, ev: React.DragEvent) => {
    ev.preventDefault();
    setDropEn(null);
    const id = ev.dataTransfer.getData("text/plain") || dragId.current;
    dragId.current = null;
    const t = datos?.turnos.find((x) => x.id === id);
    if (!t) return;
    const d = { empleado_id: destino.empleadoId, fecha: destino.fecha };
    if (ev.altKey) {
      tras(await api.duplicarTurno(t.id, d), "Turno duplicado", "No se pudo duplicar");
      return;
    }
    if (t.empleado_id === destino.empleadoId && t.fecha === destino.fecha) return;
    tras(
      await api.moverTurno(t.id, d),
      t.estado === "publicado" ? "Turno movido (estaba publicado: el empleado lo verá cambiado)" : "Turno movido",
      "No se pudo mover",
    );
  };

  const borrarSeleccion = () => {
    const ids = [...sel];
    setConfirmar({
      titulo: `Borrar ${ids.length} turno${ids.length === 1 ? "" : "s"}`,
      texto: "Se eliminan del cuadrante. Si estaban publicados, el empleado dejará de verlos.",
      boton: "Borrar",
      peligro: true,
      accion: async () => {
        if (tras(await api.borrarTurnos(ids), `${ids.length} turnos borrados`, "No se pudo borrar")) setSel(new Set());
      },
    });
  };

  const abrirMenu = (t: Turno, ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    setMenu({ turno: t, x: Math.min(ev.clientX, window.innerWidth - 200), y: Math.min(ev.clientY, window.innerHeight - 150) });
  };

  const clicChip = (t: Turno, ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (ev.shiftKey) {
      setSel((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; });
      return;
    }
    setModal({ empleadoId: t.empleado_id, fecha: t.fecha, turno: t });
  };

  if (!centroId) return <div className="vacio">No tienes ningún centro asignado. Pídeselo a RRHH.</div>;
  if (!datos) {
    if (errorCarga) {
      return (
        <div className="vacio plan-error">
          <div>No se pudo cargar la semana.</div>
          <div className="plan-sub">{errorCarga}</div>
          <button className="btn btn-fantasma" onClick={cargar}>Reintentar</button>
        </div>
      );
    }
    return <div className="vacio">Cargando…</div>;
  }

  const borradores = datos.turnos.filter((t) => t.estado === "borrador").length;
  const { semana: numSemana } = semanaIso(lunes);
  const ausenciaDe = (empId: string, fecha: string) =>
    datos.ausencias.find((a) => a.empleado_id === empId && a.fecha_inicio <= fecha && a.fecha_fin >= fecha);
  const turnosCelda = (empId: string | null, fecha: string) =>
    datos.turnos.filter((t) => t.empleado_id === empId && t.fecha === fecha).sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
  const ajenosCelda = (empId: string, fecha: string) =>
    datos.ajenos.filter((t) => t.empleado_id === empId && t.fecha === fecha).sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));

  /* ---------- piezas ---------- */
  const chip = (t: Turno) => {
    const c = colorDe(t);
    const conf = calc.conflicto.has(t.id);
    return (
      <div
        key={t.id}
        className={`plan-chip ${t.estado} ${sel.has(t.id) ? "sel" : ""} ${conf ? "conflicto" : ""}`}
        style={{ ["--c" as string]: c }}
        draggable
        onDragStart={(ev) => { dragId.current = t.id; ev.dataTransfer.setData("text/plain", t.id); ev.dataTransfer.effectAllowed = "copyMove"; }}
        onDragEnd={() => { dragId.current = null; setDropEn(null); }}
        onClick={(ev) => clicChip(t, ev)}
        onContextMenu={(ev) => abrirMenu(t, ev)}
        title={`${hh(t)} · ${fmtHoras(horasNetas(t))}${t.nota ? "\n" + t.nota : ""}\nArrastra para mover · Alt+arrastrar duplica · Shift+clic selecciona`}
      >
        <div className="plan-chip-h">
          <span>{hh(t)}</span>
          {conf ? <span className="plan-chip-w">⚠</span> : null}
        </div>
        <div className="plan-chip-p"><span className="plan-chip-n">{fmtHoras(horasNetas(t))} · </span>{nombrePuesto(t) || "—"}{t.nota ? <span className="plan-chip-nota" title={t.nota}> ✎</span> : null}</div>
        <button type="button" className="plan-chip-menu" onClick={(ev) => abrirMenu(t, ev)} aria-label="Más opciones">⋯</button>
      </div>
    );
  };
  const chipAjeno = (t: TurnoAjeno) => (
    <div key={"a" + t.id} className="plan-chip ajeno" title={`Turno en ${t.centro_nombre} (${t.estado})`}>
      <div className="plan-chip-h"><span>{hh(t)}</span></div>
      <div className="plan-chip-p"><span className="plan-chip-n">{fmtHoras(horasNetas(t))} · </span>en {t.centro_nombre}</div>
    </div>
  );
  const tagAusencia = (a: AusenciaPlan) => {
    const nombre = a.rrhh_tipos_ausencia?.nombre || ENUM_AUS[a.tipo] || "Ausencia";
    const c = a.rrhh_tipos_ausencia?.color || GRIS;
    return (
      <div className="plan-aus" style={{ ["--c" as string]: c, color: colorTexto(c) }} title={`${nombre}${a.medio_dia ? " (medio día)" : ""}${a.nota ? "\n" + a.nota : ""}`}>
        {nombre}{a.medio_dia ? " ½" : ""}
      </div>
    );
  };
  const celda = (empleadoId: string | null, fecha: string, children: React.ReactNode, className = "", key?: React.Key) => {
    const clave = `${empleadoId ?? "_"}|${fecha}`;
    return (
      <td
        key={key}
        className={`celda plan-celda ${className} ${dropEn === clave ? "drop" : ""} ${fecha === hoy ? "es-hoy" : ""} ${festivoPorFecha.has(fecha) ? "es-festivo" : ""}`}
        onClick={(ev) => {
          if ((ev.target as Element).closest(".plan-chip, button")) return;
          if (ev.shiftKey) return;
          setModal({ empleadoId, fecha, turno: null });
        }}
        onDragOver={(ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = ev.altKey ? "copy" : "move"; if (dropEn !== clave) setDropEn(clave); }}
        onDragLeave={() => { if (dropEn === clave) setDropEn(null); }}
        onDrop={(ev) => soltar({ empleadoId, fecha }, ev)}
      >
        {children}
      </td>
    );
  };

  /* ---------- rejilla semana ---------- */
  const filas: React.ReactNode[] = [];
  let deptoActual: string | null = null;
  for (const e of datos.empleados) {
    const d = e.departamento || "Sin departamento";
    if (d !== deptoActual) {
      deptoActual = d;
      const n = datos.empleados.filter((x) => (x.departamento || "Sin departamento") === d).length;
      filas.push(<tr key={"d" + d} className="fila-depto"><td colSpan={9}><div className="plan-depto">{d} <span>· {n}</span></div></td></tr>);
    }
    const h = calc.horasEmp[e.id] ?? 0;
    const otros = calc.horasOtros[e.id] ?? 0;
    const contrato = e.horas_vigentes != null ? Number(e.horas_vigentes) : null;
    const exceso = contrato != null && h + otros > contrato + 0.01;
    filas.push(
      <tr key={e.id}>
        <td className="nombre">
          <div className="np">{e.nombre} {e.apellidos || ""}</div>
          {e.puesto_defecto_id && puestoPorId.get(e.puesto_defecto_id) ? (
            <div className="plan-puesto-def"><i style={{ background: puestoPorId.get(e.puesto_defecto_id)!.color }} />{puestoPorId.get(e.puesto_defecto_id)!.nombre}</div>
          ) : null}
        </td>
        {Array.from({ length: 7 }, (_, dd) => {
          const fecha = sumaDia(lunes, dd);
          const aus = ausenciaDe(e.id, fecha);
          return celda(
            e.id,
            fecha,
            <>
              {aus ? tagAusencia(aus) : null}
              {turnosCelda(e.id, fecha).map((t) => chip(t))}
              {ajenosCelda(e.id, fecha).map((t) => chipAjeno(t))}
            </>,
            aus ? "ausencia" : "",
            dd,
          );
        })}
        <td className={`plan-horas ${exceso ? "exceso" : ""}`} title={(contrato != null ? "Planificadas en este centro / contrato de la semana" : "Planificadas (sin horas de contrato)") + (otros ? ". El contrato cuenta todos los centros." : "")}>
          <b>{fmtHoras(h)}</b>{contrato != null ? <span> / {fmtHoras(contrato)}</span> : null}
          {otros ? <div className="plan-sub plan-horas-otros">+{fmtHoras(otros)} en otros centros</div> : null}
          {exceso ? <div className="plan-horas-ex">+{fmtHoras(h + otros - contrato!)}</div> : null}
        </td>
      </tr>,
    );
  }

  const huecosSemana = datos.turnos.filter((t) => !t.empleado_id).length;
  const totalSemana = datos.turnos.reduce((s, t) => s + horasNetas(t), 0);

  const rejillaSemana = (
    <div className="plan-scroll plan-scroll-v2">
      <table className="cuadrante plan-cuadrante">
        <thead>
          <tr>
            <th className="plan-th-equipo">Equipo</th>
            {Array.from({ length: 7 }, (_, d) => {
              const f = sumaDia(lunes, d);
              const fest = festivoPorFecha.get(f);
              return (
                <th key={d} className={`${f === hoy ? "hoy" : ""} ${fest ? "plan-th-festivo" : ""}`} title={fest ? `Festivo: ${fest.nombre}` : undefined}>
                  {DIAS_SEMANA[d]}<br />{ddmm(f)}
                  {fest ? <div className="plan-festivo">★ {fest.nombre}</div> : null}
                </th>
              );
            })}
            <th className="plan-th-horas">Horas</th>
          </tr>
        </thead>
        <tbody>
          <tr className="plan-fila-huecos">
            <td className="nombre">
              <div className="np">Sin asignar</div>
              <div className="plan-sub">{huecosSemana ? `${huecosSemana} hueco${huecosSemana === 1 ? "" : "s"}` : "huecos a cubrir"}</div>
            </td>
            {Array.from({ length: 7 }, (_, dd) => {
              const fecha = sumaDia(lunes, dd);
              const hs = turnosCelda(null, fecha);
              return celda(
                null,
                fecha,
                <>
                  {hs.map((t) => chip(t))}
                  <button type="button" className="plan-mas" onClick={() => setModal({ empleadoId: null, fecha, turno: null })} title="Crear hueco">+ hueco</button>
                </>,
                "",
                dd,
              );
            })}
            <td className="plan-horas"><b>{fmtHoras(datos.turnos.filter((t) => !t.empleado_id).reduce((s, t) => s + horasNetas(t), 0))}</b></td>
          </tr>
          {filas}
        </tbody>
        <tfoot>
          <tr className="plan-total">
            <td className="nombre"><div className="np">Total</div><div className="plan-sub">horas · personas</div></td>
            {Array.from({ length: 7 }, (_, dd) => {
              const f = sumaDia(lunes, dd);
              const td = calc.totalDia[f];
              return (
                <td key={dd} className={f === hoy ? "es-hoy" : ""}>
                  <b>{fmtHoras(td?.horas ?? 0)}</b>
                  <div className="plan-sub">{td?.personas.size ?? 0} pers.{td?.huecos ? ` · ${td.huecos} hueco${td.huecos === 1 ? "" : "s"}` : ""}</div>
                </td>
              );
            })}
            <td className="plan-horas"><b>{fmtHoras(totalSemana)}</b></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  /* ---------- vista día ---------- */
  const vistaDia = (() => {
    const fest = festivoPorFecha.get(dia);
    const conTurno = datos.empleados.filter((e) => turnosCelda(e.id, dia).length || ajenosCelda(e.id, dia).length || ausenciaDe(e.id, dia));
    const sinTurno = datos.empleados.filter((e) => !conTurno.includes(e));
    const huecos = turnosCelda(null, dia);
    const pos = (t: { hora_inicio: string; hora_fin: string }) => {
      const a = Math.max(H0, Math.min(H1, minutos(t.hora_inicio)));
      const b = Math.max(a + 15, Math.min(H1, finAbsoluto(t)));
      return { left: `${((a - H0) / (H1 - H0)) * 100}%`, width: `${((b - a) / (H1 - H0)) * 100}%` };
    };
    // Personas por hora: solo turnos asignados; los huecos se cuentan aparte (no son personas).
    const cobertura = HORAS_DIA.map((_, i) => {
      const m = H0 + i * 60 + 30;
      const enHora = datos.turnos.filter((t) => t.fecha === dia && minutos(t.hora_inicio) <= m && finAbsoluto(t) > m);
      return { n: enHora.filter((t) => t.empleado_id).length, huecos: enHora.filter((t) => !t.empleado_id).length };
    });
    const barra = (t: Turno | TurnoAjeno, ajeno?: boolean) => {
      const c = ajeno ? "#bbb" : colorDe(t as Turno);
      return (
        <div
          key={t.id}
          className={`plan-barra ${ajeno ? "ajeno" : (t as Turno).estado} ${!ajeno && calc.conflicto.has(t.id) ? "conflicto" : ""} ${!ajeno && sel.has(t.id) ? "sel" : ""}`}
          style={{ ...pos(t), ["--c" as string]: c, color: colorTexto(c) }}
          onClick={(ev) => { if (!ajeno) clicChip(t as Turno, ev); }}
          onContextMenu={(ev) => { if (!ajeno) abrirMenu(t as Turno, ev); }}
          title={ajeno ? `En ${(t as TurnoAjeno).centro_nombre}` : `${hh(t)} · ${nombrePuesto(t as Turno)}`}
        >
          <span>{hh(t)}</span> <small>{ajeno ? `en ${(t as TurnoAjeno).centro_nombre}` : nombrePuesto(t as Turno)}</small>
        </div>
      );
    };
    const fila = (nombre: string, sub: string | undefined, children: React.ReactNode, empleadoId: string | null, key: React.Key) => (
      <div className="plan-dia-fila" key={key}>
        <div className="plan-dia-nombre"><div className="np">{nombre}</div>{sub ? <div className="plan-sub">{sub}</div> : null}</div>
        <div
          className="plan-dia-pista"
          onDoubleClick={(ev) => { if (!(ev.target as Element).closest(".plan-barra")) setModal({ empleadoId, fecha: dia, turno: null }); }}
          title="Doble clic para crear un turno"
        >
          {HORAS_DIA.map((_, i) => <i key={i} className="plan-dia-linea" style={{ left: `${(i / HORAS_DIA.length) * 100}%` }} />)}
          {children}
        </div>
      </div>
    );
    return (
      <div className="plan-dia">
        <div className="plan-dia-cab">
          <button className="btn btn-fantasma btn-peque" onClick={() => { const d = sumaDia(dia, -1); if (d < lunes) setLunes(sumaDia(lunes, -7)); setDia(d); }}>‹ día</button>
          <h3>{DIAS_SEMANA[dowDe(dia)]} {ddmm(dia)}{fest ? <span className="plan-festivo-inline">★ {fest.nombre}</span> : null}</h3>
          <button className="btn btn-fantasma btn-peque" onClick={() => { const d = sumaDia(dia, 1); if (d > hasta) setLunes(sumaDia(lunes, 7)); setDia(d); }}>día ›</button>
          <span className="plan-sub">{fmtHoras(calc.totalDia[dia]?.horas ?? 0)} · {calc.totalDia[dia]?.personas.size ?? 0} personas</span>
        </div>
        <div className="plan-dia-fila plan-dia-horas">
          <div className="plan-dia-nombre" />
          <div className="plan-dia-pista">{HORAS_DIA.map((h, i) => <span key={i} style={{ left: `${(i / HORAS_DIA.length) * 100}%` }}>{String(h).padStart(2, "0")}</span>)}</div>
        </div>
        <div className="plan-dia-fila plan-dia-cob">
          <div className="plan-dia-nombre"><div className="plan-sub">Personas por hora</div></div>
          <div className="plan-dia-pista">
            {cobertura.map((c, i) => (
              <span key={i} className={c.n === 0 ? "cero" : ""} style={{ left: `${(i / HORAS_DIA.length) * 100}%` }} title={c.huecos ? `${c.n} personas + ${c.huecos} hueco${c.huecos === 1 ? "" : "s"} sin asignar` : undefined}>
                {c.n}{c.huecos ? <small className="plan-cob-hueco">+{c.huecos}</small> : null}
              </span>
            ))}
          </div>
        </div>
        {huecos.length ? (
          fila("Sin asignar", `${huecos.length} hueco${huecos.length === 1 ? "" : "s"}`, huecos.map((t) => barra(t)), null, "huecos")
        ) : null}
        {conTurno.map((e) => {
          const aus = ausenciaDe(e.id, dia);
          return fila(
            `${e.nombre} ${e.apellidos || ""}`,
            e.departamento || undefined,
            <>
              {aus ? <div className="plan-dia-aus" style={{ ["--c" as string]: aus.rrhh_tipos_ausencia?.color || GRIS }}>{aus.rrhh_tipos_ausencia?.nombre || ENUM_AUS[aus.tipo]}</div> : null}
              {turnosCelda(e.id, dia).map((t) => barra(t))}
              {ajenosCelda(e.id, dia).map((t) => barra(t, true))}
            </>,
            e.id,
            e.id,
          );
        })}
        {sinTurno.length ? (
          <div className="plan-dia-libres">
            <b>Sin turno este día ({sinTurno.length}):</b>{" "}
            {sinTurno.map((e) => (
              <button key={e.id} type="button" className="plan-libre" onClick={() => setModal({ empleadoId: e.id, fecha: dia, turno: null })} title="Crear turno">
                {e.nombre} {e.apellidos ? e.apellidos.split(" ")[0] : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  })();

  /* ---------- render ---------- */
  return (
    <>
      <div className="barra plan-barra-top">
        <select value={centroId} onChange={(e) => setCentroId(e.target.value)}>
          {ctx.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <div className="sem-nav">
          <button onClick={() => setLunes(sumaDia(lunes, -7))} aria-label="Semana anterior">‹</button>
          <span className="sem-label">Sem. {numSemana} · {ddmm(lunes)} — {ddmm(hasta)}</span>
          <button onClick={() => setLunes(sumaDia(lunes, 7))} aria-label="Semana siguiente">›</button>
          <button className="btn btn-fantasma" style={{ height: 34 }} onClick={() => { setLunes(lunesDe(hoy)); setDia(hoy); }}>Hoy</button>
        </div>
        <div className="plan-vistas" role="tablist">
          <button className={vista === "semana" ? "activa" : ""} onClick={() => setVista("semana")}>Semana</button>
          <button className={vista === "dia" ? "activa" : ""} onClick={() => setVista("dia")}>Día</button>
        </div>
        {cargando ? <span className="plan-sub">Actualizando…</span> : null}
        {borradores ? <span className="chip-borradores">{borradores} sin publicar</span> : null}
        <div className="plan-acciones">
          <button
            className="btn btn-fantasma"
            onClick={() => {
              const copiar = async () => {
                tras(await api.copiarSemanaAnteriorPlan(centroId, lunes, datos.empleados.map((e) => e.id)), "Semana anterior copiada como borrador", "No se pudo copiar");
              };
              if (datos.turnos.length) {
                setConfirmar({
                  titulo: "Copiar la semana anterior",
                  texto: `Esta semana ya tiene ${datos.turnos.length} turnos. Los copiados se añaden como borrador, no sustituyen nada.`,
                  boton: "Copiar",
                  accion: copiar,
                });
              } else void copiar();
            }}
          >
            Copiar semana anterior
          </button>
          <button className="btn btn-fantasma" onClick={() => setModalModelos(true)}>Modelos</button>
          <button className="btn btn-fantasma" onClick={() => window.print()} title="Imprimir el cuadrante">Imprimir</button>
          <button className="btn btn-publicar" disabled={!borradores} onClick={() => setModalPublicar(true)}>Publicar semana</button>
        </div>
      </div>

      <div className="plan-print-cab">
        <h2>{ctx.centros.find((c) => c.id === centroId)?.nombre} · semana {numSemana} · {ddmm(lunes)} — {ddmm(hasta)}</h2>
      </div>

      {!datos.empleados.length ? (
        <div className="vacio">
          {datos.sinPermisoPlantilla
            ? "No tienes permiso para ver la plantilla de este centro. Pídeselo a RRHH."
            : "Este centro no tiene empleados asignados todavía."}
        </div>
      ) : vista === "semana" ? rejillaSemana : vistaDia}

      <div className="leyenda plan-leyenda">
        <span><span className="muestra" style={{ border: "1.5px dashed #888", background: "#fff" }} /> Borrador (solo lo ves tú)</span>
        <span><span className="muestra" style={{ borderLeft: "4px solid #1D9E75", background: "#E1F5EE" }} /> Publicado · color del puesto</span>
        <span><span className="muestra" style={{ background: "#eee", border: "1px dashed #bbb" }} /> En otro centro</span>
        <span><span className="muestra" style={{ background: "var(--arena)", border: "1px solid var(--linea)" }} /> Ausencia aprobada</span>
        <span>★ Festivo</span>
        <span style={{ color: "var(--amber)" }}>⚠ Aviso — no bloquea</span>
        <span className="plan-ayuda">Clic en celda: nuevo turno · arrastra para mover · Alt+arrastrar duplica · Shift+clic selecciona varios · botón derecho: menú</span>
      </div>
      {calc.lista.length ? (
        <div className="avisos-panel">
          <h3>⚠ Avisos de la semana (no bloquean)</h3>
          {calc.lista.map((a, i) => <div key={i}>{a}</div>)}
        </div>
      ) : null}

      {sel.size ? (
        <div className="plan-flotante">
          <b>{sel.size} turno{sel.size === 1 ? "" : "s"} seleccionado{sel.size === 1 ? "" : "s"}</b>
          <button className="btn btn-borrar btn-peque" onClick={borrarSeleccion}>Borrar</button>
          <button className="btn btn-fantasma btn-peque" onClick={() => setSel(new Set())}>Quitar selección</button>
        </div>
      ) : null}

      {menu ? (
        <div className="plan-menu-fondo" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="plan-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
            <div className="plan-menu-cab">{hh(menu.turno)} · {nombrePuesto(menu.turno) || "sin puesto"}</div>
            <button onClick={() => { setMenu(null); setModal({ empleadoId: menu.turno.empleado_id, fecha: menu.turno.fecha, turno: menu.turno }); }}>Editar</button>
            <button onClick={async () => { const t = menu.turno; setMenu(null); tras(await api.duplicarTurno(t.id, { empleado_id: t.empleado_id, fecha: t.fecha }), "Turno duplicado", "No se pudo duplicar"); }}>Duplicar</button>
            {menu.turno.empleado_id ? (
              <button onClick={async () => {
                const t = menu.turno; setMenu(null);
                const quitar = async () => { tras(await api.moverTurno(t.id, { empleado_id: null, fecha: t.fecha }), "Turno sin asignar", "No se pudo cambiar"); };
                if (t.estado === "publicado") {
                  setConfirmar({ titulo: "Dejar sin asignar", texto: `${hh(t)} del ${DIAS_SEMANA[dowDe(t.fecha)].toLowerCase()} ${ddmm(t.fecha)} está publicado: el empleado dejará de verlo y el hueco quedará abierto.`, boton: "Dejar sin asignar", accion: quitar });
                } else await quitar();
              }}>Dejar sin asignar</button>
            ) : null}
            <button onClick={() => { setMenu(null); setSel((s) => new Set(s).add(menu.turno.id)); }}>Seleccionar</button>
            <button className="peligro" onClick={() => {
              const t = menu.turno; setMenu(null);
              setConfirmar({ titulo: "Borrar turno", texto: `${hh(t)} del ${DIAS_SEMANA[dowDe(t.fecha)].toLowerCase()} ${ddmm(t.fecha)}.`, boton: "Borrar", peligro: true, accion: async () => { tras(await api.borrarTurnos([t.id]), "Turno borrado", "No se pudo borrar"); } });
            }}>Borrar</button>
          </div>
        </div>
      ) : null}

      {modal ? (
        <ModalTurno
          contexto={modal}
          empleados={datos.empleados}
          puestos={datos.puestos}
          plantillas={datos.plantillas}
          puestoDe={puestoDe}
          centroId={centroId}
          ausencia={modal.empleadoId ? ausenciaDe(modal.empleadoId, modal.fecha) ?? null : null}
          cerrar={() => setModal(null)}
          hecho={(msg) => { setModal(null); avisar(msg); cargar(); }}
        />
      ) : null}

      {modalPublicar ? (
        <ModalPublicar
          borradores={borradores}
          totalTurnos={datos.turnos.length}
          totalHoras={totalSemana}
          personas={new Set(datos.turnos.map((t) => t.empleado_id).filter(Boolean)).size}
          huecos={huecosSemana}
          avisos={calc.lista}
          rango={`${ddmm(lunes)} — ${ddmm(hasta)}`}
          cerrar={() => setModalPublicar(false)}
          publicar={async () => {
            const r = await api.publicarSemanaPlan(centroId, lunes, hasta);
            setModalPublicar(false);
            const n = r.data?.publicados ?? 0, c = r.data?.correos ?? 0;
            tras(r, `Semana publicada: ${n} turno${n === 1 ? "" : "s"} · ${c ? `${c} correo${c === 1 ? "" : "s"} enviado${c === 1 ? "" : "s"}` : "sin correos (envío no configurado o nadie tiene email)"}`, "Error al publicar");
          }}
        />
      ) : null}

      {modalModelos ? (
        <ModalModelos
          modelos={datos.modelos}
          turnosSemana={datos.turnos.length}
          cerrar={() => setModalModelos(false)}
          guardar={async (nombre) => {
            const r = await api.guardarModeloSemana(centroId, nombre, lunes);
            if (tras(r, `Modelo «${nombre}» guardado con ${r.data ?? 0} turnos`, "No se pudo guardar el modelo")) setModalModelos(false);
          }}
          aplicar={(m) => {
            setModalModelos(false);
            setConfirmar({
              titulo: `Aplicar «${m.nombre}»`,
              texto: `Se crean como borrador los turnos del modelo (${Array.isArray(m.turnos) ? m.turnos.length : 0}) para los empleados que siguen activos.${datos.turnos.length ? ` Esta semana ya tiene ${datos.turnos.length} turnos: se añaden, no se sustituyen.` : ""}`,
              boton: "Aplicar",
              accion: async () => { tras(await api.aplicarModeloSemana(m.id, centroId, lunes, datos.empleados.map((e) => e.id)), "Modelo aplicado como borrador", "No se pudo aplicar"); },
            });
          }}
          borrar={(m) => {
            setConfirmar({ titulo: `Borrar el modelo «${m.nombre}»`, texto: "No afecta a ninguna semana ya planificada.", boton: "Borrar", peligro: true, accion: async () => { tras(await api.borrarModeloSemana(m.id), "Modelo borrado", "No se pudo borrar"); } });
          }}
        />
      ) : null}

      {confirmar ? (
        <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) setConfirmar(null); }}>
          <div className="modal plan-confirmar">
            <h2>{confirmar.titulo}</h2>
            <p>{confirmar.texto}</p>
            <div className="modal-acciones">
              <button className="btn btn-fantasma" onClick={() => setConfirmar(null)}>Cancelar</button>
              <button className={`btn ${confirmar.peligro ? "btn-borrar" : "btn-primario"}`} onClick={async () => { const a = confirmar.accion; setConfirmar(null); await a(); }}>{confirmar.boton}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ======================================================================
   Modal de turno
   ====================================================================== */

function ModalTurno({ contexto, empleados, puestos, plantillas, puestoDe, centroId, ausencia, cerrar, hecho }: {
  contexto: Modal;
  empleados: EmpleadoPlan[];
  puestos: PuestoCat[];
  plantillas: PlantillaTurno[];
  puestoDe: (t: { puesto_id: string | null; puesto: string | null }) => PuestoCat | null;
  centroId: string;
  ausencia: AusenciaPlan | null;
  cerrar: () => void;
  hecho: (msg: string) => void;
}) {
  const t = contexto.turno;
  const empleadoIni = empleados.find((e) => e.id === contexto.empleadoId) ?? null;
  const puestoIni = t ? puestoDe(t) : empleadoIni?.puesto_defecto_id ? puestos.find((p) => p.id === empleadoIni.puesto_defecto_id) ?? null : null;
  const [empleadoId, setEmpleadoId] = useState(contexto.empleadoId ?? "");
  const [inicio, setInicio] = useState(t ? t.hora_inicio.slice(0, 5) : "12:00");
  const [fin, setFin] = useState(t ? t.hora_fin.slice(0, 5) : "18:00");
  const [pausa, setPausa] = useState(String(t?.pausa_min ?? 0));
  // "" = sin puesto · id del catálogo · "txt:<nombre>" = texto antiguo sin casar
  const [puesto, setPuesto] = useState(puestoIni ? puestoIni.id : t?.puesto ? "txt:" + t.puesto : "");
  const [nota, setNota] = useState(t?.nota ?? "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [pideBorrar, setPideBorrar] = useState(false);

  const horas = horasNetas({ hora_inicio: inicio || "00:00", hora_fin: fin || "00:00", pausa_min: Number(pausa) || 0 });
  const puestosVisibles = puestos.filter((p) => p.activo || p.id === puesto);
  const alCambiarEmpleado = (id: string) => {
    setEmpleadoId(id);
    if (!t && !puesto) {
      const e = empleados.find((x) => x.id === id);
      if (e?.puesto_defecto_id) setPuesto(e.puesto_defecto_id);
    }
  };
  const aplicarPlantilla = (p: PlantillaTurno) => {
    setInicio(p.hora_inicio.slice(0, 5));
    setFin(p.hora_fin.slice(0, 5));
    setPausa(String(p.pausa_min));
    if (p.puesto_id) setPuesto(p.puesto_id);
  };

  return (
    <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <form
        className="modal plan-modal"
        onSubmit={async (e) => {
          e.preventDefault();
          if (guardando) return;
          const cat = puesto && !puesto.startsWith("txt:") ? puestos.find((p) => p.id === puesto) ?? null : null;
          setGuardando(true);
          const r = await api.guardarTurnoPlan(t?.id ?? null, {
            empleado_id: empleadoId || null,
            centro_id: centroId,
            fecha: contexto.fecha,
            hora_inicio: inicio,
            hora_fin: fin,
            pausa_min: Number(pausa) || 0,
            puesto_id: cat?.id ?? null,
            puesto: cat ? cat.nombre : puesto.startsWith("txt:") ? puesto.slice(4) : null,
            nota: nota.trim() || null,
          });
          setGuardando(false);
          if (!r.ok) { setError("No se pudo guardar: " + (r.error ?? "")); return; }
          hecho(t ? "Turno guardado" : empleadoId ? "Turno creado" : "Hueco creado");
        }}
      >
        <h2>{t ? "Editar turno" : empleadoId ? "Nuevo turno" : "Nuevo hueco (sin asignar)"}</h2>
        <div className="sub">{DIAS_SEMANA[dowDe(contexto.fecha)]} {ddmm(contexto.fecha)}{t?.estado === "publicado" ? " · publicado" : ""}</div>

        {plantillas.length ? (
          <div className="plan-plantillas">
            {plantillas.slice(0, 8).map((p) => (
              <button key={p.id} type="button" className="plan-plantilla" onClick={() => aplicarPlantilla(p)} title={p.puesto_id ? puestos.find((x) => x.id === p.puesto_id)?.nombre : undefined}>
                {p.nombre}
              </button>
            ))}
          </div>
        ) : null}

        <label>Empleado</label>
        <select value={empleadoId} onChange={(e) => alCambiarEmpleado(e.target.value)}>
          <option value="">— Sin asignar (hueco) —</option>
          {empleados.map((e) => <option key={e.id} value={e.id}>{e.nombre} {e.apellidos || ""}</option>)}
        </select>

        <div className="fila-2">
          <div><label>Entrada</label><input type="time" required value={inicio} onChange={(e) => setInicio(e.target.value)} /></div>
          <div><label>Salida</label><input type="time" required value={fin} onChange={(e) => setFin(e.target.value)} /></div>
        </div>
        <div className="fila-2">
          <div><label>Pausa (min)</label><input type="number" min={0} step={5} value={pausa} onChange={(e) => setPausa(e.target.value)} /></div>
          <div>
            <label>Puesto</label>
            <select value={puesto} onChange={(e) => setPuesto(e.target.value)}>
              <option value="">— Sin puesto —</option>
              {puesto.startsWith("txt:") ? <option value={puesto}>{puesto.slice(4)} (texto)</option> : null}
              {puestosVisibles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
        </div>
        <label>Nota <small className="plan-sub">(la ve el empleado)</small></label>
        <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: llega 15 min antes, evento en terraza…" maxLength={200} />

        <div className="plan-modal-resumen">
          <span className="plan-modal-horas">{fmtHoras(horas)}</span>
          {puesto && !puesto.startsWith("txt:") ? (() => { const p = puestos.find((x) => x.id === puesto); return p ? <span className="plan-modal-puesto"><i style={{ background: p.color }} />{p.nombre}</span> : null; })() : null}
        </div>

        <div className="aviso-modal">
          {error ||
            (ausencia ? `Ojo: este día tiene una ausencia aprobada (${ausencia.rrhh_tipos_ausencia?.nombre || ENUM_AUS[ausencia.tipo]}).` : "") ||
            (t?.estado === "publicado" ? "Este turno ya está publicado: el cambio será visible para el empleado al guardar." : "")}
        </div>
        <div className="modal-acciones">
          {t ? (
            pideBorrar ? (
              <button type="button" className="btn btn-borrar" onClick={async () => {
                const r = await api.borrarTurnos([t.id]);
                if (!r.ok) { setError("No se pudo eliminar: " + (r.error ?? "")); return; }
                hecho("Turno eliminado");
              }}>Sí, eliminar</button>
            ) : (
              <button type="button" className="btn btn-borrar" onClick={() => setPideBorrar(true)}>Eliminar</button>
            )
          ) : null}
          <button type="button" className="btn btn-fantasma" onClick={cerrar}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </div>
  );
}

/* ======================================================================
   Modal publicar (resumen)
   ====================================================================== */

function ModalPublicar({ borradores, totalTurnos, totalHoras, personas, huecos, avisos, rango, cerrar, publicar }: {
  borradores: number; totalTurnos: number; totalHoras: number; personas: number; huecos: number; avisos: string[]; rango: string;
  cerrar: () => void; publicar: () => Promise<void>;
}) {
  const [enviando, setEnviando] = useState(false);
  return (
    <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <div className="modal plan-modal">
        <h2>Publicar la semana</h2>
        <div className="sub">{rango}</div>
        <div className="plan-resumen">
          <div><b>{borradores}</b><span>turno{borradores === 1 ? "" : "s"} por publicar</span></div>
          <div><b>{totalTurnos}</b><span>turnos en total</span></div>
          <div><b>{fmtHoras(totalHoras)}</b><span>horas planificadas</span></div>
          <div><b>{personas}</b><span>personas</span></div>
        </div>
        {huecos ? <div className="plan-aviso-linea">Hay {huecos} hueco{huecos === 1 ? "" : "s"} sin asignar: se publican y los empleados podrán apuntarse.</div> : null}
        {avisos.length ? (
          <div className="plan-avisos-modal">
            <b>⚠ {avisos.length} aviso{avisos.length === 1 ? "" : "s"} (no bloquean)</b>
            {avisos.slice(0, 8).map((a, i) => <div key={i}>{a}</div>)}
            {avisos.length > 8 ? <div>… y {avisos.length - 8} más.</div> : null}
          </div>
        ) : <div className="plan-ok-linea">Sin avisos. Todo cuadra.</div>}
        <p className="plan-sub" style={{ marginTop: 12 }}>Al publicar, los turnos pasan a ser visibles en la app del empleado. Si el envío de correo está configurado, avisamos a quien tiene email.</p>
        <div className="modal-acciones">
          <button className="btn btn-fantasma" onClick={cerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={enviando} onClick={async () => { setEnviando(true); await publicar(); setEnviando(false); }}>{enviando ? "Publicando…" : "Publicar"}</button>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   Modal modelos de semana
   ====================================================================== */

function ModalModelos({ modelos, turnosSemana, cerrar, guardar, aplicar, borrar }: {
  modelos: Datos["modelos"]; turnosSemana: number;
  cerrar: () => void; guardar: (nombre: string) => Promise<void>; aplicar: (m: Datos["modelos"][number]) => void; borrar: (m: Datos["modelos"][number]) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  return (
    <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <div className="modal plan-modal">
        <h2>Modelos de semana</h2>
        <div className="sub">Guarda una semana tipo y aplícala en otras con un clic.</div>
        <label>Guardar esta semana como modelo</label>
        <div className="plan-modelo-nuevo">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Semana de verano, Temporada baja…" maxLength={60} />
          <button className="btn btn-primario" disabled={!nombre.trim() || !turnosSemana || guardando} onClick={async () => { setGuardando(true); await guardar(nombre.trim()); setGuardando(false); }}>Guardar</button>
        </div>
        {!turnosSemana ? <div className="plan-sub">Esta semana no tiene turnos: planifícala primero.</div> : <div className="plan-sub">{turnosSemana} turnos se guardarán en el modelo.</div>}
        <label>Modelos guardados</label>
        {modelos.length ? (
          <div className="plan-modelos">
            {modelos.map((m) => (
              <div key={m.id} className="plan-modelo">
                <div><b>{m.nombre}</b><div className="plan-sub">{Array.isArray(m.turnos) ? m.turnos.length : 0} turnos · {ddmm(m.creado_en.slice(0, 10))}/{m.creado_en.slice(0, 4)}</div></div>
                <button className="btn btn-primario btn-peque" onClick={() => aplicar(m)}>Aplicar</button>
                <button className="btn btn-fantasma btn-peque" onClick={() => borrar(m)} aria-label="Borrar modelo">×</button>
              </div>
            ))}
          </div>
        ) : <div className="plan-sub">Todavía no hay modelos en este centro.</div>}
        <div className="modal-acciones">
          <button className="btn btn-fantasma" onClick={cerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
