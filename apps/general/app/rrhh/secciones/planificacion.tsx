"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../acciones/planificacion";
import type { ArchivoTurno, AusenciaPlan, DisponibilidadPlan, EmpleadoPlan, Festivo, PlantillaTurno, PuestoCat, TareaTurno, TurnoAjeno, TurnoMes } from "../acciones/planificacion";
import {
  DIAS_SEMANA, dowDe, finAbsoluto, hh, horasNetas, hoyIso, lunesDe, minutos, sumaDia, type Turno,
} from "../tipos";
import { colorTexto, fmtHoras, rangoMes, semanaIso, useCentroRecordado, type SecProps } from "../lib-rrhh";
import "./planificacion.css";

type Datos = Awaited<ReturnType<typeof api.cargarSemanaPlan>>;
type DatosMes = Awaited<ReturnType<typeof api.cargarMesPlan>>;
type Celda = { empleadoId: string | null; fecha: string };
type Modal = Celda & { turno: Turno | null };
type Vista = "semana" | "dia" | "mes";

const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
/** "2026-10-01" → "2026-10-01" (día 1 del mes). */
const primeroDeMes = (f: string) => f.slice(0, 7) + "-01";
/** Días naturales entre dos fechas ISO (b − a). */
const diasEntre = (a: string, b: string) => Math.round((new Date(b + "T12:00").getTime() - new Date(a + "T12:00").getTime()) / 86400000);
/** 7.5 → "7,5h" (compacto, para las barras del mes). */
const fmtHorasCorto = (n: number) => `${String(Math.round(n * 10) / 10).replace(".", ",")}h`;
const LETRA_DIA = ["L", "M", "X", "J", "V", "S", "D"];
/** "Octubre 2026". */
const nombreMes = (f: string) => {
  const s = new Date(f + "T12:00").toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const MSG_CERRADO = "Día cerrado en Fichajes: reábrelo para cambiar turnos";
const GRIS = "#888";
const ENUM_AUS: Record<string, string> = { vacaciones: "Vacaciones", baja: "Baja", permiso: "Permiso", otro: "Ausencia" };
const H0 = 6 * 60; // vista día: 06:00
const H1 = 26 * 60; // … hasta 02:00
const HORAS_DIA = Array.from({ length: (H1 - H0) / 60 }, (_, i) => (6 + i) % 24);
const MAX_ARCHIVOS = 6;
const MAX_MB = 10;
/** 1234567 → "1,2 MB"; 34000 → "34 KB". */
const fmtTamano = (b: number | null) => {
  if (b == null) return "";
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(Math.round((b / 1024 / 1024) * 10) / 10).toString().replace(".", ",")} MB`;
};
/** Abre una URL que llega tras un await sin que el navegador bloquee la pestaña: se abre antes y se redirige. */
const abrirTrasEsperar = async (pedir: () => Promise<string | null>) => {
  const w = window.open("about:blank", "_blank");
  const url = await pedir();
  if (!url) { w?.close(); return false; }
  if (w) w.location.href = url; else window.location.href = url;
  return true;
};

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
  // Vista Mes: carga aparte (solo lectura) y día resaltado al saltar de Mes a Semana.
  const [mes, setMes] = useState(primeroDeMes(hoyIso()));
  const [datosMes, setDatosMes] = useState<DatosMes | null>(null);
  const [cargandoMes, setCargandoMes] = useState(false);
  const [errorMes, setErrorMes] = useState<string | null>(null);
  const peticionMes = useRef(0);
  const [diaResaltado, setDiaResaltado] = useState<string | null>(null);

  const cargarMes = useCallback(() => {
    if (!centroId || vista !== "mes") return;
    const n = ++peticionMes.current;
    const r = rangoMes(mes);
    setCargandoMes(true);
    api.cargarMesPlan(centroId, r.desde, r.hasta)
      .then((d) => { if (n === peticionMes.current) { setDatosMes(d); setErrorMes(null); } })
      .catch((e: unknown) => {
        if (n !== peticionMes.current) return;
        setErrorMes(e instanceof Error && e.message ? e.message : "No se pudo cargar el mes");
        avisar("No se pudo cargar el mes");
      })
      .finally(() => { if (n === peticionMes.current) setCargandoMes(false); });
  }, [centroId, mes, vista, avisar]);
  useEffect(() => { setDatosMes(null); }, [centroId, mes]); // otro centro-mes: se vacía antes de pedirlo
  useEffect(() => { cargarMes(); }, [cargarMes]);

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

  /* ---------- candado: días cerrados en Fichajes ----------
     Un día cuyas filas de rrhh_horas_dia del centro están todas validadas (y hay al menos una) está cerrado:
     🔒 en la cabecera y sus turnos no se mueven, editan ni borran (el servidor también lo rechaza). */
  const diasCerrados = useMemo(() => {
    const s = new Set<string>();
    if (!datos) return s;
    const porFecha: Record<string, { total: number; validadas: number }> = {};
    for (const h of datos.horasDia) {
      const p = (porFecha[h.fecha] ??= { total: 0, validadas: 0 });
      p.total++;
      if (h.estado === "validada") p.validadas++;
    }
    for (const [f, p] of Object.entries(porFecha)) if (p.total && p.validadas === p.total) s.add(f);
    return s;
  }, [datos]);

  /* ---------- cálculo: horas, totales y avisos ---------- */
  const calc = useMemo(() => {
    const horasEmp: Record<string, number> = {};
    const horasOtros: Record<string, number> = {}; // horas de la semana en otros centros (el contrato es de la persona)
    const defecto: Record<string, number> = {}; // horas que faltan para llegar al contrato (jornada contractual)
    const totalDia: Record<string, { horas: number; personas: Set<string>; huecos: number }> = {};
    const lista: string[] = [];
    const conflicto = new Set<string>();
    if (!datos) return { horasEmp, horasOtros, defecto, totalDia, lista, conflicto };

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
    // Jornada contractual (Skello): el aviso por defecto de horas solo tiene sentido si la semana ya está
    // planificada (algo publicado) o es la actual/futura; una semana pasada sin planificar no se avisa.
    const hayPublicado = datos.turnos.some((t) => t.estado === "publicado");
    const semanaVigente = lunes >= lunesDe(hoyIso());
    const diasAusencia = (empId: string) => {
      let n = 0;
      for (let d = 0; d < 7; d++) {
        const f = sumaDia(lunes, d);
        const a = datos.ausencias.find((x) => x.empleado_id === empId && x.fecha_inicio <= f && x.fecha_fin >= f);
        if (a) n += a.medio_dia ? 0.5 : 1;
      }
      return n;
    };

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
      else if (e.horas_vigentes && (hayPublicado || semanaVigente)) {
        // Por defecto: le faltan horas para su jornada contractual. Los días de ausencia aprobada se descuentan
        // a razón de contrato/7 por día (mismo prorrateo que el contrato de la semana).
        const contrato = Number(e.horas_vigentes);
        const dAus = diasAusencia(e.id);
        const faltan = Math.round((contrato - total - otros - (contrato * dAus) / 7) * 100) / 100;
        if (faltan > 0.01) {
          defecto[e.id] = faltan;
          lista.push(
            `${nombre}: ${fmtHoras(total + otros)} planificadas${otros ? ` (${fmtHoras(otros)} en otros centros)` : ""}, contrato de ${fmtHoras(contrato)} (faltan ${fmtHoras(faltan)}${dAus ? `, descontado${dAus === 1 ? "" : "s"} ${String(dAus).replace(".", ",")} día${dAus === 1 ? "" : "s"} de ausencia` : ""}).`,
          );
        }
      }

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
    return { horasEmp, horasOtros, defecto, totalDia, lista: [...new Set(lista)], conflicto };
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
    if (diasCerrados.has(t.fecha) || diasCerrados.has(destino.fecha)) { avisar(MSG_CERRADO); return; }
    // Arrastre múltiple: el chip arrastrado es uno de los seleccionados → se mueven todos con el mismo
    // desplazamiento en días. Se reasignan al empleado de destino solo si todos eran del mismo empleado
    // (si no, solo cambian de fecha); soltar en «Sin asignar» tampoco reasigna.
    if (sel.has(t.id) && sel.size > 1) {
      const grupo = datos!.turnos.filter((x) => sel.has(x.id));
      const delta = diasEntre(t.fecha, destino.fecha);
      const mismoEmp = grupo.every((x) => x.empleado_id === t.empleado_id);
      const empleadoId = destino.empleadoId && destino.empleadoId !== t.empleado_id && mismoEmp ? destino.empleadoId : null;
      if (!ev.altKey && delta === 0 && !empleadoId) return;
      if (grupo.some((x) => diasCerrados.has(x.fecha) || diasCerrados.has(sumaDia(x.fecha, delta)))) { avisar(MSG_CERRADO); return; }
      const r = await api.moverTurnos(grupo.map((x) => x.id), delta, empleadoId, ev.altKey);
      const n = r.data ?? grupo.length;
      tras(r, ev.altKey ? `${n} turnos duplicados como borrador` : `${n} turnos movidos`, ev.altKey ? "No se pudieron duplicar" : "No se pudieron mover");
      return;
    }
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
    if (diasCerrados.has(t.fecha)) { avisar(MSG_CERRADO); return; }
    setMenu({ turno: t, x: Math.min(ev.clientX, window.innerWidth - 200), y: Math.min(ev.clientY, window.innerHeight - 150) });
  };

  const clicChip = (t: Turno, ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (diasCerrados.has(t.fecha)) {
      // Día cerrado: se puede mirar el turno, no tocarlo.
      setModal({ empleadoId: t.empleado_id, fecha: t.fecha, turno: t });
      return;
    }
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
  const fichadoDe = (empId: string, fecha: string) => datos.fichados.find((f) => f.empleado_id === empId && f.fecha === fecha);
  const horasDiaDe = (empId: string, fecha: string) => datos.horasDia.find((h) => h.empleado_id === empId && h.fecha === fecha);
  const dispDe = (empId: string, fecha: string) => datos.disponibilidades.find((d) => d.empleado_id === empId && d.fecha === fecha);
  const tituloDisp = (d: { tipo: string; nota: string | null }) =>
    (d.tipo === "prefiere" ? "Prefiere trabajar este día" : "Ha marcado que NO puede este día") + (d.nota ? `: ${d.nota}` : "");

  /* ---------- piezas ---------- */
  /** `idx` = posición del turno dentro de la celda: lo fichado del día se pinta solo en el primero. */
  const chip = (t: Turno, idx = 0) => {
    const c = colorDe(t);
    const conf = calc.conflicto.has(t.id);
    const cerrado = diasCerrados.has(t.fecha);
    const pasado = t.fecha < hoy;
    // Día pasado (como Skello): arriba en pequeño lo planificado y debajo en grande lo FICHADO.
    // Si hay fila en Fichajes (rrhh_horas_dia), sus horas retenidas mandan (✓ si está validada).
    let real: React.ReactNode = null;
    let claseReal = "";
    let tituloReal = "";
    if (pasado && t.empleado_id && idx === 0) {
      const f = fichadoDe(t.empleado_id, t.fecha);
      const hd = horasDiaDe(t.empleado_id, t.fecha);
      const validada = hd?.estado === "validada";
      const horasChip = hd ? Number(hd.horas_retenidas) : f ? f.horas : null;
      const etiqueta = hd ? `${validada ? "✓ " : ""}${fmtHoras(horasChip ?? 0)}${validada ? "" : " propuestas"}` : f ? `${fmtHoras(f.horas)} fichadas` : "";
      if (f) {
        claseReal = "fichado";
        tituloReal = `Planificado ${hh(t)} · ${fmtHoras(horasNetas(t))}\nFichado ${f.entrada ?? "—"} – ${f.salida ?? (f.en_curso ? "en curso" : "—")} · ${fmtHoras(f.horas)}${f.pausas_min ? ` (pausas ${f.pausas_min} min)` : ""}${hd ? `\nRetenidas ${fmtHoras(Number(hd.horas_retenidas))}${validada ? " (validado)" : " (propuesta)"}` : ""}${f.incidencias.length ? `\n⚠ ${f.incidencias.join(", ")}` : ""}`;
        real = (
          <>
            <div className="plan-chip-plan">{hh(t)}{conf ? <span className="plan-chip-w"> ⚠</span> : null}</div>
            <div className="plan-chip-fich">{f.entrada ?? "—"} – {f.salida ?? (f.en_curso ? "…" : "—")}</div>
            <div className="plan-chip-p">{etiqueta}{f.incidencias.length ? <span className="plan-chip-w"> ⚠</span> : null}</div>
          </>
        );
      } else if (hd && Number(hd.horas_retenidas) > 0) {
        // Sin fichajes pero con horas en Fichajes (validadas a mano o importadas de Skello): las retenidas mandan.
        claseReal = "retenido";
        tituloReal = `Planificado ${hh(t)} · ${fmtHoras(horasNetas(t))}\nSin fichajes registrados\nRetenidas ${fmtHoras(Number(hd.horas_retenidas))}${validada ? " (validado)" : " (propuesta)"}`;
        real = (
          <>
            <div className="plan-chip-plan">{hh(t)}{conf ? <span className="plan-chip-w"> ⚠</span> : null}</div>
            <div className="plan-chip-fich">{etiqueta}</div>
            <div className="plan-chip-p">{validada ? "validado en Fichajes" : "propuesta en Fichajes"}</div>
          </>
        );
      } else if (!ausenciaDe(t.empleado_id, t.fecha)) {
        claseReal = "sin-fichar";
        tituloReal = `Planificado ${hh(t)} · ${fmtHoras(horasNetas(t))}\nNo fichó${hd ? `\nRetenidas ${fmtHoras(Number(hd.horas_retenidas))}${validada ? " (validado)" : " (propuesta)"}` : ""}`;
        real = (
          <>
            <div className="plan-chip-plan">{hh(t)}</div>
            <div className="plan-chip-fich">sin fichar</div>
            <div className="plan-chip-p">{hd ? etiqueta : nombrePuesto(t) || "—"}</div>
          </>
        );
      }
    }
    const enGrupo = sel.has(t.id) && sel.size > 1;
    const ayuda = cerrado ? MSG_CERRADO : enGrupo ? `Arrastra para mover los ${sel.size} seleccionados a la vez · Alt+arrastrar los duplica` : "Arrastra para mover · Alt+arrastrar duplica · Shift+clic selecciona";
    const ex = datos.extras[t.id];
    const iconos = ex && (ex.tareas || ex.archivos) ? (
      <span className="plan-chip-extras" title={`${ex.tareas ? `${ex.hechas}/${ex.tareas} tareas hechas` : ""}${ex.tareas && ex.archivos ? " · " : ""}${ex.archivos ? `${ex.archivos} archivo${ex.archivos === 1 ? "" : "s"}` : ""}`}>
        {ex.tareas ? <span className={ex.hechas === ex.tareas ? "ok" : ""}>☑ {ex.hechas}/{ex.tareas}</span> : null}
        {ex.archivos ? <span>📎</span> : null}
      </span>
    ) : null;
    return (
      <div
        key={t.id}
        className={`plan-chip ${t.estado} ${sel.has(t.id) ? "sel" : ""} ${conf ? "conflicto" : ""} ${claseReal} ${cerrado ? "cerrado" : ""}`}
        style={{ ["--c" as string]: c }}
        draggable={!cerrado}
        onDragStart={(ev) => { if (cerrado) { ev.preventDefault(); return; } dragId.current = t.id; ev.dataTransfer.setData("text/plain", t.id); ev.dataTransfer.effectAllowed = "copyMove"; }}
        onDragEnd={() => { dragId.current = null; setDropEn(null); }}
        onClick={(ev) => clicChip(t, ev)}
        onContextMenu={(ev) => abrirMenu(t, ev)}
        title={`${tituloReal || `${hh(t)} · ${fmtHoras(horasNetas(t))}`}${t.nota ? "\n" + t.nota : ""}\n${ayuda}`}
      >
        {real ?? (
          <>
            <div className="plan-chip-h">
              <span>{hh(t)}</span>
              {conf ? <span className="plan-chip-w">⚠</span> : null}
            </div>
            <div className="plan-chip-p"><span className="plan-chip-n">{fmtHoras(horasNetas(t))} · </span>{nombrePuesto(t) || "—"}{t.nota ? <span className="plan-chip-nota" title={t.nota}> ✎</span> : null}</div>
          </>
        )}
        {iconos}
        {cerrado ? null : <button type="button" className="plan-chip-menu" onClick={(ev) => abrirMenu(t, ev)} aria-label="Más opciones">⋯</button>}
      </div>
    );
  };
  /** Día pasado con fichajes pero sin turno planificado: se enseña en gris para que no pase desapercibido. */
  const chipSinPlan = (f: Datos["fichados"][number]) => {
    const hd = horasDiaDe(f.empleado_id, f.fecha);
    const validada = hd?.estado === "validada";
    return (
      <div key={"f" + f.fecha} className="plan-chip fichado sin-plan" title={`Fichó sin turno planificado\n${f.entrada ?? "—"} – ${f.salida ?? "—"} · ${fmtHoras(f.horas)}${hd ? `\nRetenidas ${fmtHoras(Number(hd.horas_retenidas))}${validada ? " (validado)" : " (propuesta)"}` : ""}`}>
        <div className="plan-chip-plan">sin turno</div>
        <div className="plan-chip-fich">{f.entrada ?? "—"} – {f.salida ?? (f.en_curso ? "…" : "—")}</div>
        <div className="plan-chip-p">{hd ? `${validada ? "✓ " : ""}${fmtHoras(Number(hd.horas_retenidas))}` : `${fmtHoras(f.horas)} fichadas`}</div>
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
    const cerrado = diasCerrados.has(fecha);
    const disp = empleadoId ? dispDe(empleadoId, fecha) : undefined;
    return (
      <td
        key={key}
        className={`celda plan-celda ${className} ${dropEn === clave ? "drop" : ""} ${fecha === hoy ? "es-hoy" : ""} ${fecha === diaResaltado ? "resaltado" : ""} ${festivoPorFecha.has(fecha) ? "es-festivo" : ""} ${cerrado ? "cerrada" : ""} ${disp ? `disp-${disp.tipo === "prefiere" ? "si" : "no"}` : ""}`}
        onClick={(ev) => {
          if ((ev.target as Element).closest(".plan-chip, button")) return;
          if (ev.shiftKey) return;
          if (cerrado) { avisar(MSG_CERRADO); return; }
          setModal({ empleadoId, fecha, turno: null });
        }}
        onDragOver={(ev) => { if (cerrado) return; ev.preventDefault(); ev.dataTransfer.dropEffect = ev.altKey ? "copy" : "move"; if (dropEn !== clave) setDropEn(clave); }}
        onDragLeave={() => { if (dropEn === clave) setDropEn(null); }}
        onDrop={(ev) => soltar({ empleadoId, fecha }, ev)}
      >
        {children}
        {disp ? <i className={`plan-disp ${disp.tipo === "prefiere" ? "si" : "no"}`} title={tituloDisp(disp)} aria-label={tituloDisp(disp)} /> : null}
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
    const faltan = calc.defecto[e.id];
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
          const turnosDia = turnosCelda(e.id, fecha);
          const fichSinPlan = fecha < hoy && !turnosDia.length ? fichadoDe(e.id, fecha) : undefined;
          return celda(
            e.id,
            fecha,
            <>
              {aus ? tagAusencia(aus) : null}
              {turnosDia.map((t, i) => chip(t, i))}
              {fichSinPlan ? chipSinPlan(fichSinPlan) : null}
              {ajenosCelda(e.id, fecha).map((t) => chipAjeno(t))}
            </>,
            aus ? "ausencia" : "",
            dd,
          );
        })}
        <td className={`plan-horas ${exceso ? "exceso" : ""} ${faltan ? "defecto" : ""}`} title={(contrato != null ? "Planificadas en este centro / contrato de la semana" : "Planificadas (sin horas de contrato)") + (otros ? ". El contrato cuenta todos los centros." : "") + (faltan ? `. Jornada contractual: faltan ${fmtHoras(faltan)}.` : "")}>
          <b>{fmtHoras(h)}</b>{contrato != null ? <span> / {fmtHoras(contrato)}</span> : null}
          {otros ? <div className="plan-sub plan-horas-otros">+{fmtHoras(otros)} en otros centros</div> : null}
          {exceso ? <div className="plan-horas-ex">+{fmtHoras(h + otros - contrato!)}</div> : null}
          {faltan ? <div className="plan-horas-ex">−{fmtHoras(faltan)}</div> : null}
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
              const cerrado = diasCerrados.has(f);
              return (
                <th key={d} className={`${f === hoy ? "hoy" : ""} ${fest ? "plan-th-festivo" : ""} ${cerrado ? "plan-th-cerrado" : ""} ${f === diaResaltado ? "resaltado" : ""}`} title={[fest ? `Festivo: ${fest.nombre}` : "", cerrado ? "Día validado en Fichajes: los turnos no se pueden cambiar. Reábrelo en Fichajes si hace falta." : ""].filter(Boolean).join("\n") || undefined}>
                  {cerrado ? <span className="plan-candado" aria-label="Día cerrado">🔒 </span> : null}{DIAS_SEMANA[d]}<br />{ddmm(f)}
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
                  {diasCerrados.has(fecha) ? null : <button type="button" className="plan-mas" onClick={() => setModal({ empleadoId: null, fecha, turno: null })} title="Crear hueco">+ hueco</button>}
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
    const cerradoDia = diasCerrados.has(dia);
    const fila = (nombre: string, sub: string | undefined, children: React.ReactNode, empleadoId: string | null, key: React.Key) => {
      const disp = empleadoId ? dispDe(empleadoId, dia) : undefined;
      return (
      <div className="plan-dia-fila" key={key}>
        <div className="plan-dia-nombre">
          <div className="np">{disp ? <i className={`plan-disp inline ${disp.tipo === "prefiere" ? "si" : "no"}`} title={tituloDisp(disp)} /> : null}{nombre}</div>
          {sub ? <div className="plan-sub">{sub}</div> : null}
        </div>
        <div
          className="plan-dia-pista"
          onDoubleClick={(ev) => {
            if ((ev.target as Element).closest(".plan-barra")) return;
            if (cerradoDia) { avisar(MSG_CERRADO); return; }
            setModal({ empleadoId, fecha: dia, turno: null });
          }}
          title={cerradoDia ? MSG_CERRADO : "Doble clic para crear un turno"}
        >
          {HORAS_DIA.map((_, i) => <i key={i} className="plan-dia-linea" style={{ left: `${(i / HORAS_DIA.length) * 100}%` }} />)}
          {children}
        </div>
      </div>
      );
    };
    return (
      <div className="plan-dia">
        <div className="plan-dia-cab">
          <button className="btn btn-fantasma btn-peque" onClick={() => { const d = sumaDia(dia, -1); if (d < lunes) setLunes(sumaDia(lunes, -7)); setDia(d); }}>‹ día</button>
          <h3>
            {cerradoDia ? <span className="plan-candado" title="Día validado en Fichajes: los turnos no se pueden cambiar.">🔒 </span> : null}
            {DIAS_SEMANA[dowDe(dia)]} {ddmm(dia)}{fest ? <span className="plan-festivo-inline">★ {fest.nombre}</span> : null}
          </h3>
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
              <button key={e.id} type="button" className="plan-libre" onClick={() => { if (cerradoDia) { avisar(MSG_CERRADO); return; } setModal({ empleadoId: e.id, fecha: dia, turno: null }); }} title={cerradoDia ? MSG_CERRADO : "Crear turno"}>
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
        {vista === "mes" ? (
          <div className="sem-nav">
            <button onClick={() => setMes(primeroDeMes(sumaDia(mes, -1)))} aria-label="Mes anterior">‹</button>
            <span className="sem-label">{nombreMes(mes)}</span>
            <button onClick={() => setMes(primeroDeMes(sumaDia(rangoMes(mes).hasta, 1)))} aria-label="Mes siguiente">›</button>
            <button className="btn btn-fantasma" style={{ height: 34 }} onClick={() => setMes(primeroDeMes(hoy))}>Hoy</button>
          </div>
        ) : (
          <div className="sem-nav">
            <button onClick={() => { setDiaResaltado(null); setLunes(sumaDia(lunes, -7)); }} aria-label="Semana anterior">‹</button>
            <span className="sem-label">Sem. {numSemana} · {ddmm(lunes)} — {ddmm(hasta)}</span>
            <button onClick={() => { setDiaResaltado(null); setLunes(sumaDia(lunes, 7)); }} aria-label="Semana siguiente">›</button>
            <button className="btn btn-fantasma" style={{ height: 34 }} onClick={() => { setDiaResaltado(null); setLunes(lunesDe(hoy)); setDia(hoy); }}>Hoy</button>
          </div>
        )}
        <div className="plan-vistas" role="tablist">
          <button className={vista === "dia" ? "activa" : ""} onClick={() => setVista("dia")}>Día</button>
          <button className={vista === "semana" ? "activa" : ""} onClick={() => setVista("semana")}>Semana</button>
          <button className={vista === "mes" ? "activa" : ""} onClick={() => { setMes(primeroDeMes(lunes)); setVista("mes"); }}>Mes</button>
        </div>
        {cargando || cargandoMes ? <span className="plan-sub">Actualizando…</span> : null}
        {borradores && vista !== "mes" ? <span className="chip-borradores">{borradores} sin publicar</span> : null}
        {vista === "mes" ? <span className="plan-sub">Solo lectura: clic en una celda abre esa semana, doble clic crea un turno.</span> : (
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
        )}
      </div>

      <div className="plan-print-cab">
        <h2>{ctx.centros.find((c) => c.id === centroId)?.nombre} · {vista === "mes" ? nombreMes(mes) : `semana ${numSemana} · ${ddmm(lunes)} — ${ddmm(hasta)}`}</h2>
      </div>

      {vista === "mes" ? (
        <VistaMes
          datos={datosMes}
          mes={mes}
          hoy={hoy}
          cargando={cargandoMes}
          error={errorMes}
          reintentar={cargarMes}
          irASemana={(fecha) => { setLunes(lunesDe(fecha)); setDia(fecha); setDiaResaltado(fecha); setVista("semana"); }}
          nuevoTurno={(empleadoId, fecha) => setModal({ empleadoId, fecha, turno: null })}
        />
      ) : !datos.empleados.length ? (
        <div className="vacio">
          {datos.sinPermisoPlantilla
            ? "No tienes permiso para ver la plantilla de este centro. Pídeselo a RRHH."
            : "Este centro no tiene empleados asignados todavía."}
        </div>
      ) : vista === "semana" ? rejillaSemana : vistaDia}

      {vista === "mes" ? null : (
      <div className="leyenda plan-leyenda">
        <span><span className="muestra" style={{ border: "1.5px dashed #888", background: "#fff" }} /> Borrador (solo lo ves tú)</span>
        <span><span className="muestra" style={{ borderLeft: "4px solid #1D9E75", background: "#E1F5EE" }} /> Publicado · color del puesto</span>
        <span><span className="muestra" style={{ background: "#eee", border: "1px dashed #bbb" }} /> En otro centro</span>
        <span><span className="muestra" style={{ background: "var(--arena)", border: "1px solid var(--linea)" }} /> Ausencia aprobada</span>
        <span>★ Festivo</span>
        <span><span className="muestra" style={{ borderLeft: "4px solid var(--red)", background: "var(--red-light)" }} /> Sin fichar (día pasado)</span>
        <span>🔒 Día validado en Fichajes: no se toca</span>
        <span><i className="plan-disp inline no" /> No puede · <i className="plan-disp inline si" /> Prefiere (lo marca el empleado)</span>
        <span style={{ color: "var(--amber)" }}>⚠ Aviso — no bloquea</span>
        <span className="plan-ayuda">Clic en celda: nuevo turno · arrastra para mover · Alt+arrastrar duplica · Shift+clic selecciona varios (arrastrar uno de ellos los mueve todos) · botón derecho: menú</span>
      </div>
      )}
      {calc.lista.length && vista !== "mes" ? (
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
          disponibilidades={datos.disponibilidades.filter((d) => d.fecha === modal.fecha)}
          soloLectura={diasCerrados.has(modal.fecha)}
          cerrar={() => setModal(null)}
          hecho={(msg) => { setModal(null); avisar(msg); cargar(); cargarMes(); }}
          avisar={avisar}
          recargar={() => { cargar(); cargarMes(); }}
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
   Vista Mes (solo lectura + saltos a Semana / nuevo turno)
   ====================================================================== */

/** «Vacaciones» → «VA», «Baja médica» → «BM». */
const inicialesTipo = (nombre: string) => {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  return (partes.length > 1 ? partes.map((p) => p[0]).join("") : nombre.slice(0, 2)).toUpperCase();
};

function VistaMes({ datos, mes, hoy, cargando, error, reintentar, irASemana, nuevoTurno }: {
  datos: DatosMes | null;
  mes: string;
  hoy: string;
  cargando: boolean;
  error: string | null;
  reintentar: () => void;
  /** Clic en una celda: salta a la vista Semana con ese día resaltado. */
  irASemana: (fecha: string) => void;
  /** Doble clic en una celda: modal de nuevo turno para ese empleado y día. */
  nuevoTurno: (empleadoId: string, fecha: string) => void;
}) {
  const { desde, hasta } = rangoMes(mes);
  const nDias = diasEntre(desde, hasta) + 1;
  const dias = useMemo(() => Array.from({ length: nDias }, (_, i) => sumaDia(desde, i)), [desde, nDias]);
  // Clic simple vs doble: el simple espera un poco por si llega el segundo.
  const clicPendiente = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clicPendiente.current) clearTimeout(clicPendiente.current); }, []);

  const puestoPorId = useMemo(() => new Map((datos?.puestos ?? []).map((p) => [p.id, p])), [datos]);
  const puestoPorNombre = useMemo(() => new Map((datos?.puestos ?? []).map((p) => [p.nombre.trim().toLowerCase(), p])), [datos]);
  const festivoPorFecha = useMemo(() => {
    const m = new Map<string, Festivo>();
    for (const f of datos?.festivos ?? []) {
      const prev = m.get(f.fecha);
      if (!prev || (f.centro_id && !prev.centro_id)) m.set(f.fecha, f);
    }
    return m;
  }, [datos]);
  const indice = useMemo(() => {
    const turnos = new Map<string, TurnoMes[]>(); // «empleado|fecha» → turnos ordenados
    const horasEmp: Record<string, number> = {};
    const totalDia: Record<string, { horas: number; personas: Set<string>; huecos: number }> = {};
    const ausencias = new Map<string, AusenciaPlan>(); // «empleado|fecha»
    for (const f of dias) totalDia[f] = { horas: 0, personas: new Set(), huecos: 0 };
    for (const t of datos?.turnos ?? []) {
      const k = `${t.empleado_id ?? "_"}|${t.fecha}`;
      (turnos.get(k) ?? turnos.set(k, []).get(k)!).push(t);
      const td = totalDia[t.fecha];
      if (!td) continue;
      const h = horasNetas(t);
      td.horas += h;
      if (t.empleado_id) { td.personas.add(t.empleado_id); horasEmp[t.empleado_id] = (horasEmp[t.empleado_id] ?? 0) + h; }
      else td.huecos++;
    }
    for (const a of datos?.ausencias ?? []) {
      const ini = a.fecha_inicio > desde ? a.fecha_inicio : desde;
      const fin = a.fecha_fin < hasta ? a.fecha_fin : hasta;
      for (let f = ini; f <= fin; f = sumaDia(f, 1)) ausencias.set(`${a.empleado_id}|${f}`, a);
    }
    return { turnos, horasEmp, totalDia, ausencias };
  }, [datos, dias, desde, hasta]);

  if (!datos) {
    if (error) {
      return (
        <div className="vacio plan-error">
          <div>No se pudo cargar el mes.</div>
          <div className="plan-sub">{error}</div>
          <button className="btn btn-fantasma" onClick={reintentar}>Reintentar</button>
        </div>
      );
    }
    return <div className="vacio">Cargando…</div>;
  }
  if (!datos.empleados.length) {
    return <div className="vacio">{datos.sinPermisoPlantilla ? "No tienes permiso para ver la plantilla de este centro. Pídeselo a RRHH." : "Este centro no tiene empleados asignados todavía."}</div>;
  }

  const colorDe = (t: TurnoMes) =>
    t.color || (t.puesto_id && puestoPorId.get(t.puesto_id)?.color) || (t.puesto && puestoPorNombre.get(t.puesto.trim().toLowerCase())?.color) || GRIS;
  const nombrePuesto = (t: TurnoMes) => (t.puesto_id && puestoPorId.get(t.puesto_id)?.nombre) || t.puesto || "";
  const claseDia = (f: string) => `${f === hoy ? "es-hoy" : ""} ${dowDe(f) >= 5 ? "finde" : ""} ${festivoPorFecha.has(f) ? "es-festivo" : ""}`;
  const clic = (fecha: string) => {
    if (clicPendiente.current) clearTimeout(clicPendiente.current);
    clicPendiente.current = setTimeout(() => { clicPendiente.current = null; irASemana(fecha); }, 220);
  };
  const dobleClic = (empleadoId: string, fecha: string) => {
    if (clicPendiente.current) { clearTimeout(clicPendiente.current); clicPendiente.current = null; }
    nuevoTurno(empleadoId, fecha);
  };

  const filas: React.ReactNode[] = [];
  let deptoActual: string | null = null;
  let totalPlan = 0;
  for (const e of datos.empleados) {
    const d = e.departamento || "Sin departamento";
    if (d !== deptoActual) {
      deptoActual = d;
      const n = datos.empleados.filter((x) => (x.departamento || "Sin departamento") === d).length;
      filas.push(<tr key={"d" + d} className="fila-depto"><td colSpan={nDias + 2}><div className="plan-depto">{d} <span>· {n}</span></div></td></tr>);
    }
    const h = indice.horasEmp[e.id] ?? 0;
    totalPlan += h;
    const contrato = e.horas_contrato_mes;
    const exceso = contrato != null && h > contrato + 0.01;
    filas.push(
      <tr key={e.id}>
        <td className="nombre">
          <div className="np">{e.nombre} {e.apellidos || ""}</div>
          {e.puesto_defecto_id && puestoPorId.get(e.puesto_defecto_id) ? (
            <div className="plan-puesto-def"><i style={{ background: puestoPorId.get(e.puesto_defecto_id)!.color }} />{puestoPorId.get(e.puesto_defecto_id)!.nombre}</div>
          ) : null}
        </td>
        {dias.map((f) => {
          const ts = indice.turnos.get(`${e.id}|${f}`) ?? [];
          const aus = indice.ausencias.get(`${e.id}|${f}`);
          const nombreAus = aus ? aus.rrhh_tipos_ausencia?.nombre || ENUM_AUS[aus.tipo] || "Ausencia" : "";
          const cAus = aus?.rrhh_tipos_ausencia?.color || GRIS;
          const fest = festivoPorFecha.get(f);
          const titulo = [
            `${DIAS_SEMANA[dowDe(f)]} ${ddmm(f)}${fest ? ` · ★ ${fest.nombre}` : ""}`,
            ...ts.map((t) => `${hh(t)} · ${fmtHoras(horasNetas(t))}${nombrePuesto(t) ? ` · ${nombrePuesto(t)}` : ""}${t.estado === "borrador" ? " (borrador)" : ""}`),
            aus ? `${nombreAus}${aus.medio_dia ? " (medio día)" : ""}` : "",
            "Clic: ver la semana · doble clic: nuevo turno",
          ].filter(Boolean).join("\n");
          return (
            <td
              key={f}
              className={`plan-mes-celda ${claseDia(f)} ${aus ? "ausencia" : ""}`}
              title={titulo}
              onClick={() => clic(f)}
              onDoubleClick={() => dobleClic(e.id, f)}
            >
              {aus ? <div className="plan-mes-aus" style={{ ["--c" as string]: cAus, color: colorTexto(cAus) }}>{inicialesTipo(nombreAus)}{aus.medio_dia ? "½" : ""}</div> : null}
              {ts.map((t) => {
                const c = colorDe(t);
                return (
                  <div key={t.id} className={`plan-mes-barra ${t.estado}`} style={{ ["--c" as string]: c, color: t.estado === "borrador" ? undefined : colorTexto(c) }}>
                    {fmtHorasCorto(horasNetas(t))}
                  </div>
                );
              })}
            </td>
          );
        })}
        <td className={`plan-horas ${exceso ? "exceso" : ""}`} title={contrato != null ? "Planificadas en este centro / contrato del mes (contrato semanal × semanas del mes)" : "Planificadas (sin horas de contrato)"}>
          <b>{fmtHoras(h)}</b>{contrato != null ? <span> / {fmtHoras(contrato)}</span> : null}
          {exceso ? <div className="plan-horas-ex">+{fmtHoras(h - contrato!)}</div> : null}
        </td>
      </tr>,
    );
  }
  const huecos = datos.turnos.filter((t) => !t.empleado_id);
  const totalMes = datos.turnos.reduce((s, t) => s + horasNetas(t), 0);

  return (
    <div className={`plan-scroll plan-scroll-v2 ${cargando ? "plan-mes-cargando" : ""}`}>
      <table className="cuadrante plan-cuadrante plan-mes">
        <thead>
          <tr>
            <th className="plan-th-equipo">Equipo</th>
            {dias.map((f) => {
              const fest = festivoPorFecha.get(f);
              return (
                <th key={f} className={`${f === hoy ? "hoy" : ""} ${dowDe(f) >= 5 ? "finde" : ""} ${fest ? "plan-th-festivo" : ""}`} title={fest ? `Festivo: ${fest.nombre}` : `${DIAS_SEMANA[dowDe(f)]} ${ddmm(f)}`}>
                  <span className="plan-mes-dia">{Number(f.slice(8, 10))}</span>
                  <span className="plan-mes-letra">{fest ? "★" : LETRA_DIA[dowDe(f)]}</span>
                </th>
              );
            })}
            <th className="plan-th-horas">Horas del mes</th>
          </tr>
        </thead>
        <tbody>
          {huecos.length ? (
            <tr className="plan-fila-huecos">
              <td className="nombre"><div className="np">Sin asignar</div><div className="plan-sub">{huecos.length} hueco{huecos.length === 1 ? "" : "s"}</div></td>
              {dias.map((f) => {
                const ts = indice.turnos.get(`_|${f}`) ?? [];
                return (
                  <td key={f} className={`plan-mes-celda ${claseDia(f)}`} title={ts.map((t) => `${hh(t)} · ${fmtHoras(horasNetas(t))}`).join("\n") || undefined} onClick={() => irASemana(f)}>
                    {ts.map((t) => <div key={t.id} className={`plan-mes-barra hueco ${t.estado}`} style={{ ["--c" as string]: colorDe(t) }}>{fmtHorasCorto(horasNetas(t))}</div>)}
                  </td>
                );
              })}
              <td className="plan-horas"><b>{fmtHoras(huecos.reduce((s, t) => s + horasNetas(t), 0))}</b></td>
            </tr>
          ) : null}
          {filas}
        </tbody>
        <tfoot>
          <tr className="plan-total">
            <td className="nombre"><div className="np">Total</div><div className="plan-sub">horas · personas</div></td>
            {dias.map((f) => {
              const td = indice.totalDia[f];
              return (
                <td key={f} className={`plan-mes-total ${f === hoy ? "es-hoy" : ""}`} title={`${fmtHoras(td.horas)} · ${td.personas.size} personas${td.huecos ? ` · ${td.huecos} hueco${td.huecos === 1 ? "" : "s"}` : ""}`}>
                  <b>{fmtHorasCorto(td.horas)}</b>
                  <div className="plan-sub">{td.personas.size}p</div>
                </td>
              );
            })}
            <td className="plan-horas" title="Horas planificadas en el mes (asignadas + huecos)"><b>{fmtHoras(totalMes)}</b>{huecos.length ? <div className="plan-sub">{fmtHoras(totalPlan)} asignadas</div> : null}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ======================================================================
   Modal de turno
   ====================================================================== */

function ModalTurno({ contexto, empleados, puestos, plantillas, puestoDe, centroId, ausencia, disponibilidades, soloLectura, cerrar, hecho, avisar, recargar }: {
  contexto: Modal;
  empleados: EmpleadoPlan[];
  puestos: PuestoCat[];
  plantillas: PlantillaTurno[];
  puestoDe: (t: { puesto_id: string | null; puesto: string | null }) => PuestoCat | null;
  centroId: string;
  ausencia: AusenciaPlan | null;
  /** Disponibilidades marcadas por los empleados ese día (para avisar al elegir empleado). */
  disponibilidades: DisponibilidadPlan[];
  /** Día cerrado en Fichajes: se puede mirar, no guardar ni borrar. */
  soloLectura: boolean;
  cerrar: () => void;
  hecho: (msg: string) => void;
  avisar: (msg: string) => void;
  /** Tareas y archivos se guardan al momento: el cuadrante se recarga para que el chip lo refleje. */
  recargar: () => void;
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
  const disp = empleadoId ? disponibilidades.find((d) => d.empleado_id === empleadoId) : undefined;
  const avisoDisp = disp
    ? disp.tipo === "prefiere"
      ? `Prefiere trabajar este día${disp.nota ? ` («${disp.nota}»)` : ""}.`
      : `Ojo: ha marcado que NO puede este día${disp.nota ? ` («${disp.nota}»)` : ""}.`
    : "";
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
          if (guardando || soloLectura) return;
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
        <h2>{soloLectura ? "Turno (día cerrado)" : t ? "Editar turno" : empleadoId ? "Nuevo turno" : "Nuevo hueco (sin asignar)"}</h2>
        <div className="sub">{DIAS_SEMANA[dowDe(contexto.fecha)]} {ddmm(contexto.fecha)}{t?.estado === "publicado" ? " · publicado" : ""}{soloLectura ? " · 🔒 validado en Fichajes" : ""}</div>

        <fieldset className="plan-modal-campos" disabled={soloLectura}>
        {plantillas.length && !soloLectura ? (
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
        </fieldset>

        {t ? (
          <TareasArchivosTurno turnoId={t.id} soloLectura={soloLectura} avisar={avisar} recargar={recargar} />
        ) : (
          <div className="plan-extras-nuevo">Tareas y archivos: se añaden una vez guardado el turno.</div>
        )}

        <div className="plan-modal-resumen">
          <span className="plan-modal-horas">{fmtHoras(horas)}</span>
          {puesto && !puesto.startsWith("txt:") ? (() => { const p = puestos.find((x) => x.id === puesto); return p ? <span className="plan-modal-puesto"><i style={{ background: p.color }} />{p.nombre}</span> : null; })() : null}
        </div>

        <div className={`aviso-modal ${!error && disp?.tipo === "no_disponible" ? "plan-aviso-rojo" : ""}`}>
          {error ||
            (soloLectura ? "Día cerrado en Fichajes: reábrelo para cambiar turnos." : "") ||
            avisoDisp ||
            (ausencia ? `Ojo: este día tiene una ausencia aprobada (${ausencia.rrhh_tipos_ausencia?.nombre || ENUM_AUS[ausencia.tipo]}).` : "") ||
            (t?.estado === "publicado" ? "Este turno ya está publicado: el cambio será visible para el empleado al guardar." : "")}
        </div>
        <div className="modal-acciones">
          {t && !soloLectura ? (
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
          <button type="button" className="btn btn-fantasma" onClick={cerrar}>{soloLectura ? "Cerrar" : "Cancelar"}</button>
          {soloLectura ? null : <button type="submit" className="btn btn-primario" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>}
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

/* ======================================================================
   Tareas y archivos del turno (modal de turno, como en Skello)
   ====================================================================== */

function TareasArchivosTurno({ turnoId, soloLectura, avisar, recargar }: { turnoId: string; soloLectura: boolean; avisar: (m: string) => void; recargar: () => void }) {
  const [tareas, setTareas] = useState<TareaTurno[] | null>(null);
  const [archivos, setArchivos] = useState<ArchivoTurno[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const [nueva, setNueva] = useState("");
  const [anadiendo, setAnadiendo] = useState(false);
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null); // nombre del fichero en curso
  const [borrarArchivo, setBorrarArchivo] = useState<ArchivoTurno | null>(null);
  const inputFichero = useRef<HTMLInputElement>(null);
  const tocado = useRef(false); // algo cambió: el cuadrante se recarga al desmontar (cerrar el modal)
  const recargarRef = useRef(recargar);
  recargarRef.current = recargar;

  useEffect(() => {
    let vivo = true;
    setFallo(false);
    api.cargarExtrasTurno(turnoId)
      .then((d) => { if (vivo) { setTareas(d.tareas); setArchivos(d.archivos); } })
      .catch(() => { if (vivo) setFallo(true); });
    return () => { vivo = false; };
  }, [turnoId]);
  useEffect(() => () => { if (tocado.current) recargarRef.current(); }, []);

  const ko = (r: { ok: boolean; error?: string }, que: string) => {
    if (r.ok) { tocado.current = true; if (r.error) avisar(r.error); return false; }
    avisar(`${que}: ${r.error ?? ""}`);
    return true;
  };

  /* ---- tareas ---- */
  const anadir = async () => {
    const texto = nueva.trim();
    if (!texto || anadiendo) return;
    setAnadiendo(true);
    const r = await api.crearTareaTurno(turnoId, texto);
    setAnadiendo(false);
    if (ko(r, "No se pudo añadir la tarea") || !r.data) return;
    setTareas((l) => [...(l ?? []), r.data!]);
    setNueva("");
  };
  const marcar = async (tarea: TareaTurno, hecha: boolean) => {
    setTareas((l) => (l ?? []).map((x) => (x.id === tarea.id ? { ...x, hecha } : x)));
    const r = await api.actualizarTareaTurno(tarea.id, { hecha });
    if (ko(r, "No se pudo guardar")) setTareas((l) => (l ?? []).map((x) => (x.id === tarea.id ? { ...x, hecha: !hecha } : x)));
  };
  const guardarTexto = async () => {
    if (!editando) return;
    const texto = editando.texto.trim();
    const actual = (tareas ?? []).find((x) => x.id === editando.id);
    setEditando(null);
    if (!actual || !texto || texto === actual.texto) return;
    const r = await api.actualizarTareaTurno(actual.id, { texto });
    if (ko(r, "No se pudo guardar")) return;
    setTareas((l) => (l ?? []).map((x) => (x.id === actual.id ? { ...x, texto } : x)));
  };
  const borrarTarea = async (tarea: TareaTurno) => {
    const antes = tareas ?? [];
    setTareas(antes.filter((x) => x.id !== tarea.id));
    const r = await api.borrarTareaTurno(tarea.id);
    if (ko(r, "No se pudo borrar")) setTareas(antes);
  };
  const mover = async (i: number, dir: -1 | 1) => {
    const l = [...(tareas ?? [])];
    const j = i + dir;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    const antes = tareas ?? [];
    setTareas(l.map((x, k) => ({ ...x, orden: k })));
    const r = await api.reordenarTareasTurno(turnoId, l.map((x) => x.id));
    if (ko(r, "No se pudo reordenar")) setTareas(antes);
  };

  /* ---- archivos ---- */
  const subir = async (lista: FileList | null) => {
    if (!lista?.length) return;
    const ficheros = Array.from(lista);
    if (inputFichero.current) inputFichero.current.value = "";
    let n = archivos?.length ?? 0; // el estado no se actualiza dentro del bucle: se cuenta aparte
    for (const f of ficheros) {
      if (n >= MAX_ARCHIVOS) { avisar(`Un turno admite como mucho ${MAX_ARCHIVOS} archivos`); break; }
      if (f.size > MAX_MB * 1024 * 1024) { avisar(`«${f.name}» supera los ${MAX_MB} MB`); continue; }
      if (!(f.type.startsWith("image/") || f.type === "application/pdf")) { avisar(`«${f.name}»: solo imágenes y PDF`); continue; }
      setSubiendo(f.name);
      try {
        const prep = await api.prepararSubidaArchivoTurno({ turnoId, nombre: f.name, tamano: f.size, tipo: f.type || null });
        if (!prep.ok || !prep.data) throw new Error(prep.error || "No se pudo preparar la subida");
        const up = await fetch(prep.data.urlSubida, { method: "PUT", headers: { "Content-Type": f.type || "application/octet-stream" }, body: f });
        if (!up.ok) throw new Error("La subida al almacenamiento ha fallado");
        const reg = await api.registrarArchivoTurno({ turnoId, nombre: f.name, ruta: prep.data.ruta, tamano: f.size, tipo: f.type || null });
        if (!reg.ok || !reg.data) throw new Error(reg.error || "No se pudo registrar el archivo");
        tocado.current = true;
        n++;
        const nuevo = reg.data;
        setArchivos((l) => [...(l ?? []), nuevo]);
      } catch (e) {
        avisar(`No se pudo subir «${f.name}»: ${e instanceof Error ? e.message : ""}`);
      } finally {
        setSubiendo(null);
      }
    }
  };
  const abrir = (a: ArchivoTurno, descargar: boolean) =>
    abrirTrasEsperar(async () => {
      const r = await api.urlArchivoTurno(a.id, descargar);
      if (!r.ok || !r.data) { avisar(`No se pudo abrir: ${r.error ?? ""}`); return null; }
      return r.data.url;
    });
  const confirmarBorrarArchivo = async () => {
    const a = borrarArchivo;
    if (!a) return;
    setBorrarArchivo(null);
    const r = await api.borrarArchivoTurno(a.id);
    if (ko(r, "No se pudo borrar")) return;
    setArchivos((l) => (l ?? []).filter((x) => x.id !== a.id));
  };

  const hechas = (tareas ?? []).filter((x) => x.hecha).length;
  const llenos = (archivos?.length ?? 0) >= MAX_ARCHIVOS;

  if (fallo) return <div className="plan-extras-nuevo">No se pudieron cargar las tareas y archivos del turno.</div>;

  return (
    <div className="plan-extras">
      <div className="plan-extras-cab">
        <label>Tareas</label>
        {tareas?.length ? <span className="plan-sub">{hechas}/{tareas.length} hechas · las ve y marca el empleado</span> : <span className="plan-sub">las ve y marca el empleado</span>}
      </div>
      {tareas === null ? (
        <div className="plan-sub">Cargando…</div>
      ) : (
        <>
          {tareas.map((x, i) => (
            <div key={x.id} className={`plan-tarea ${x.hecha ? "hecha" : ""}`}>
              <input type="checkbox" checked={x.hecha} disabled={soloLectura} onChange={(e) => marcar(x, e.target.checked)} aria-label={x.hecha ? "Marcar como pendiente" : "Marcar como hecha"} />
              {editando?.id === x.id ? (
                <input
                  className="plan-tarea-edit"
                  autoFocus
                  value={editando.texto}
                  maxLength={300}
                  onChange={(e) => setEditando({ id: x.id, texto: e.target.value })}
                  onBlur={guardarTexto}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); guardarTexto(); } if (e.key === "Escape") { e.stopPropagation(); setEditando(null); } }}
                />
              ) : (
                <span className="plan-tarea-texto" onDoubleClick={() => { if (!soloLectura) setEditando({ id: x.id, texto: x.texto }); }} title={soloLectura ? undefined : "Doble clic para editar"}>{x.texto}</span>
              )}
              {soloLectura ? null : (
                <span className="plan-tarea-acc">
                  <button type="button" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir">↑</button>
                  <button type="button" disabled={i === tareas.length - 1} onClick={() => mover(i, 1)} aria-label="Bajar">↓</button>
                  <button type="button" className="peligro" onClick={() => borrarTarea(x)} aria-label="Borrar tarea">×</button>
                </span>
              )}
            </div>
          ))}
          {soloLectura ? (tareas.length ? null : <div className="plan-sub">Sin tareas.</div>) : (
            <div className="plan-tarea-nueva">
              <input
                value={nueva}
                maxLength={300}
                placeholder="+ Añadir tarea (Ej.: montar terraza, revisar cámara…)"
                onChange={(e) => setNueva(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); anadir(); } }}
              />
              <button type="button" className="btn btn-fantasma btn-peque" disabled={!nueva.trim() || anadiendo} onClick={anadir}>Añadir</button>
            </div>
          )}
        </>
      )}

      <div className="plan-extras-cab">
        <label>Archivos</label>
        <span className="plan-sub">{archivos?.length ?? 0}/{MAX_ARCHIVOS} · imágenes o PDF, máx. {MAX_MB} MB cada uno</span>
      </div>
      {archivos === null ? (
        <div className="plan-sub">Cargando…</div>
      ) : (
        <>
          {archivos.map((a) => (
            <div key={a.id} className="plan-archivo">
              <span className="plan-archivo-ico">{a.tipo_mime?.startsWith("image/") ? "🖼" : "📄"}</span>
              <span className="plan-archivo-nombre" title={a.nombre}>{a.nombre}</span>
              <span className="plan-sub">{fmtTamano(a.tamano)}</span>
              <span className="plan-tarea-acc">
                <button type="button" onClick={() => abrir(a, false)} title="Ver">Ver</button>
                <button type="button" onClick={() => abrir(a, true)} title="Descargar">↓</button>
                {soloLectura ? null : <button type="button" className="peligro" onClick={() => setBorrarArchivo(a)} aria-label="Borrar archivo">×</button>}
              </span>
            </div>
          ))}
          {!archivos.length && soloLectura ? <div className="plan-sub">Sin archivos.</div> : null}
          {soloLectura ? null : (
            <div className="plan-archivo-subir">
              <input ref={inputFichero} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => subir(e.target.files)} />
              <button type="button" className="btn btn-fantasma btn-peque" disabled={!!subiendo || llenos} onClick={() => inputFichero.current?.click()}>
                {subiendo ? `Subiendo «${subiendo}»…` : llenos ? `Máximo ${MAX_ARCHIVOS} archivos` : "Añadir foto o documento"}
              </button>
            </div>
          )}
        </>
      )}

      {borrarArchivo ? (
        <div className="plan-extras-confirmar">
          <span>¿Borrar «{borrarArchivo.nombre}»? El empleado dejará de verlo.</span>
          <button type="button" className="btn btn-fantasma btn-peque" onClick={() => setBorrarArchivo(null)}>Cancelar</button>
          <button type="button" className="btn btn-borrar btn-peque" onClick={confirmarBorrarArchivo}>Borrar</button>
        </div>
      ) : null}
    </div>
  );
}
