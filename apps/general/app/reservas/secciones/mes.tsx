"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../acciones";
import { cuposMasivo, ocupacionMes, type CambiosCupo, type DatosMes, type OcupacionTurno } from "../acciones/mes";
import { DIAS, dowDe, hoyISO, type Turno } from "../tipos";
import { fmtDiaMes, irATab, rangoMes, sumarDias, useRecargaExterna, type SecProps } from "../lib-reservas";
import "./mes.css";

/* ==================== Tipos internos ==================== */

type Accion =
  | { tipo: "cerrar" }
  | { tipo: "abrir" }
  | { tipo: "aforo"; valor: number | null }
  | { tipo: "nota"; valor: string | null };

type Confirmacion = { texto: string; aviso?: string; hacer: () => Promise<void> };

/* ==================== Utilidades ==================== */

const NOMBRES_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function tituloMes(ancla: string): string {
  const [a, m] = ancla.split("-").map(Number);
  return `${NOMBRES_MES[m - 1]} ${a}`;
}

function nivelDe(pct: number): "verde" | "ambar" | "rojo" {
  return pct >= 100 ? "rojo" : pct >= 80 ? "ambar" : "verde";
}

/** Lista legible de fechas: «6/10, 7/10 y 8/10» (o «del 6/10 al 20/10 (15 días)» si son muchas). */
function listaFechas(fechas: string[]): string {
  const fs = [...fechas].sort();
  if (fs.length <= 5) {
    const t = fs.map(fmtDiaMes);
    return t.length === 1 ? t[0] : `${t.slice(0, -1).join(", ")} y ${t[t.length - 1]}`;
  }
  return `del ${fmtDiaMes(fs[0])} al ${fmtDiaMes(fs[fs.length - 1])} (${fs.length} días)`;
}

/* ==================== Sección ==================== */

export default function SecMes({ rest, fecha, setFecha, avisar }: SecProps) {
  const restId = rest.id;
  const [ancla, setAncla] = useState(fecha.slice(0, 7));
  const [turnos, setTurnos] = useState<Turno[] | null>(null);
  const [datos, setDatos] = useState<DatosMes | null>(null);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [modoSel, setModoSel] = useState(false);
  const [turnoAccion, setTurnoAccion] = useState<string>(""); // "" = día completo
  const [aforoTxt, setAforoTxt] = useState("");
  const [notaTxt, setNotaTxt] = useState("");
  const [confirmar, setConfirmar] = useState<Confirmacion | null>(null);
  const [guardando, setGuardando] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  // toque = gesto con el dedo sin modo selección: solo navega si el dedo no se mueve (si se mueve, es desplazamiento)
  const arrastre = useRef<{ ancla: string; ultima: string; pointerId: number; movido: boolean; aditivo: boolean; toque: boolean; x0: number; y0: number } | null>(null);

  const hoy = hoyISO();
  const { desde, hasta } = rangoMes(`${ancla}-01`);

  // Si la barra cambia de fecha a otro mes, el calendario la sigue
  useEffect(() => { setAncla(fecha.slice(0, 7)); }, [fecha]);

  /* ---- carga ---- */
  useEffect(() => {
    api.cargarLocal(restId).then(({ turnos: t }) => setTurnos(t as Turno[]));
  }, [restId]);

  const cargar = useCallback(async () => {
    const d = await ocupacionMes(restId, desde, hasta);
    setDatos(d);
    if (!d.ok) avisar(d.error || "No se ha podido cargar la ocupación del mes.");
  }, [restId, desde, hasta, avisar]);

  useEffect(() => { setDatos(null); setSeleccion([]); cargar(); }, [cargar]);
  useRecargaExterna(cargar);

  // Esc: cierra confirmación o limpia selección
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (confirmar) setConfirmar(null);
      else setSeleccion([]);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [confirmar]);

  /* ---- navegación ---- */
  function nav(d: number) {
    let [a, m] = ancla.split("-").map(Number);
    m += d;
    if (m < 1) { m = 12; a--; }
    if (m > 12) { m = 1; a++; }
    setAncla(`${a}-${String(m).padStart(2, "0")}`);
  }
  const irADia = (f: string) => { setFecha(f); irATab("dia"); };

  /* ---- datos por día ---- */
  const porFecha = useMemo(() => {
    const out: Record<string, OcupacionTurno[]> = {};
    (datos?.filas ?? []).forEach((f) => { (out[f.fecha] = out[f.fecha] || []).push(f); });
    return out;
  }, [datos]);
  const turnoPorId = useMemo(() => new Map((turnos ?? []).map((t) => [t.id, t])), [turnos]);
  const aforoDe = (f: OcupacionTurno) => turnoPorId.get(f.turno_id)?.max_pax_total || f.aforo || 0;

  const totales = useMemo(() => {
    const porTurno: Record<string, { nombre: string; pax: number; reservas: number }> = {};
    let pax = 0, reservas = 0;
    (datos?.filas ?? []).forEach((f) => {
      pax += f.pax; reservas += f.reservas;
      const d = (porTurno[f.turno_id] = porTurno[f.turno_id] || { nombre: f.turno, pax: 0, reservas: 0 });
      d.pax += f.pax; d.reservas += f.reservas;
    });
    return { pax, reservas, porTurno: Object.values(porTurno) };
  }, [datos]);

  /* ---- selección de días (clic, mayúsculas+clic, arrastre) ---- */
  const fechaEn = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-fecha]");
    return el?.dataset.fecha ?? null;
  };
  const rango = (a: string, b: string) => {
    const [ini, fin] = a < b ? [a, b] : [b, a];
    const out: string[] = [];
    for (let f = ini; f <= fin; f = sumarDias(f, 1)) out.push(f);
    return out;
  };

  const onDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    const f = fechaEn(ev.clientX, ev.clientY);
    if (!f) return;
    if (ev.pointerType === "touch" && !modoSel) {
      // Con el dedo y sin modo selección: se apunta el toque sin capturar el puntero, para que
      // el navegador pueda desplazar la página; si el dedo no se mueve, al soltar se abre el día.
      arrastre.current = { ancla: f, ultima: f, pointerId: ev.pointerId, movido: false, aditivo: false, toque: true, x0: ev.clientX, y0: ev.clientY };
      return;
    }
    const aditivo = ev.shiftKey || ev.metaKey || ev.ctrlKey || modoSel;
    arrastre.current = { ancla: f, ultima: f, pointerId: ev.pointerId, movido: false, aditivo, toque: false, x0: ev.clientX, y0: ev.clientY };
    gridRef.current?.setPointerCapture?.(ev.pointerId);
  };
  const onMove = (ev: React.PointerEvent) => {
    const a = arrastre.current;
    if (!a || ev.pointerId !== a.pointerId) return;
    if (a.toque) {
      // Más de 8 px: es un desplazamiento, no un toque
      if (Math.abs(ev.clientX - a.x0) > 8 || Math.abs(ev.clientY - a.y0) > 8) arrastre.current = null;
      return;
    }
    const f = fechaEn(ev.clientX, ev.clientY);
    if (!f || f === a.ultima) return;
    a.ultima = f;
    a.movido = true;
    setSeleccion(rango(a.ancla, f));
  };
  const onUp = (ev: React.PointerEvent) => {
    const a = arrastre.current;
    if (!a || ev.pointerId !== a.pointerId) return;
    arrastre.current = null;
    if (a.toque) {
      if (seleccion.length) setSeleccion([]);
      else irADia(a.ancla);
      return;
    }
    if (a.movido) return; // el arrastre ya dejó la selección hecha
    if (ev.shiftKey && seleccion.length) { setSeleccion(rango(seleccion[0], a.ancla)); return; }
    if (a.aditivo) {
      setSeleccion((xs) => (xs.includes(a.ancla) ? xs.filter((x) => x !== a.ancla) : [...xs, a.ancla].sort()));
      return;
    }
    if (seleccion.length) { setSeleccion([]); return; } // un clic normal con selección: la limpia
    irADia(a.ancla);
  };

  /* ---- acción masiva sobre la selección ---- */
  // «el turno de Cena» / «el día completo» (para las frases de confirmación)
  const objeto = turnoAccion ? `el turno de ${turnoPorId.get(turnoAccion)?.nombre ?? "turno"}` : "el día completo";

  function pedir(accion: Accion) {
    if (!seleccion.length) return;
    const fs = listaFechas(seleccion);
    const cambios: CambiosCupo = {};
    let verbo = "";
    let aviso: string | undefined;
    if (accion.tipo === "cerrar") {
      cambios.cerrado = true;
      verbo = `Cerrar ${objeto}`;
      // Cerrar no cancela nada: se avisa de lo que ya hay reservado
      let n = 0, pax = 0;
      seleccion.forEach((f) => (porFecha[f] ?? []).forEach((x) => {
        if (turnoAccion && x.turno_id !== turnoAccion) return;
        n += x.reservas; pax += x.pax;
      }));
      if (n) aviso = `Hay ${n} ${n === 1 ? "reserva" : "reservas"} (${pax} pax) que no se cancelan: avisa a los clientes si hace falta.`;
    }
    if (accion.tipo === "abrir") { cambios.cerrado = false; verbo = `Abrir ${objeto}`; }
    if (accion.tipo === "aforo") {
      cambios.max_pax_online = accion.valor;
      const donde = turnoAccion ? objeto : "cada turno (día completo)";
      verbo = accion.valor === null ? `Quitar el límite de aforo online por turno de ${donde}` : `Fijar el aforo online por turno de ${donde} en ${accion.valor} pax`;
    }
    if (accion.tipo === "nota") { cambios.nota = accion.valor; verbo = accion.valor ? `Poner la nota de cupo «${accion.valor}» en ${objeto}` : `Quitar la nota de cupo de ${objeto}`; }
    setConfirmar({
      texto: `${verbo}: ${fs}.`,
      aviso,
      hacer: async () => {
        setGuardando(true);
        const r = await cuposMasivo(restId, seleccion, turnoAccion || null, cambios);
        setGuardando(false);
        if (!r.ok) { avisar(r.error || "No se ha podido guardar."); return; }
        const n = r.data?.afectadas ?? seleccion.length;
        avisar(`Hecho en ${n} ${n === 1 ? "día" : "días"}.`);
        setSeleccion([]);
        setAforoTxt("");
        setNotaTxt("");
        cargar();
      },
    });
  }

  /* ---- celdas ---- */
  if (!turnos) return <div className="spinner" />;

  const [a, m] = ancla.split("-").map(Number);
  const nDias = new Date(a, m, 0).getDate();
  const blancos = dowDe(`${ancla}-01`) - 1;
  const selSet = new Set(seleccion);
  const turnosMes = turnos.filter((t) => t.activo);

  const celdas: React.ReactNode[] = DIAS.map((d) => <div key={"h" + d} className="dsem">{d}</div>);
  for (let i = 0; i < blancos; i++) celdas.push(<div key={"b" + i} className="mes-celda vacia" />);
  for (let dia = 1; dia <= nDias; dia++) {
    const f = `${ancla}-${String(dia).padStart(2, "0")}`;
    const dow = dowDe(f);
    const filas = porFecha[f] ?? [];
    const cupoDia = datos?.cuposDia[f];
    // Notas de cupo (día completo y turnos; se quitan desde aquí) y notas del día (se editan en Día)
    const notasCupo = [...new Set([cupoDia?.nota, ...filas.map((x) => x.nota)].filter((n): n is string => !!n))];
    const notasDia = datos?.notas[f] ?? [];
    const todasNotas = [...notasCupo, ...notasDia];
    const espera = datos?.espera[f] ?? 0;
    const diaCerrado = !!cupoDia?.cerrado || (filas.length > 0 && filas.every((x) => x.cerrado));
    const clases = ["mes-celda", "ms-celda"];
    if (f === hoy) clases.push("eshoy");
    if (f < hoy) clases.push("pasado");
    if (dow >= 6) clases.push("finde");
    if (selSet.has(f)) clases.push("sel");
    if (diaCerrado) clases.push("cerrado");
    celdas.push(
      <div key={f} className={clases.join(" ")} data-fecha={f} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") irADia(f); }}
        title={todasNotas.length ? todasNotas.join("\n") : undefined}
      >
        <div className="num">
          {dia}
          <span className="ms-iconos">
            {notasCupo.length ? <i title={`Nota de cupo:\n${notasCupo.join("\n")}`}>📝</i> : null}
            {notasDia.length ? <i title={`Nota del día (se edita en Día):\n${notasDia.join("\n")}`}>📌</i> : null}
            {espera ? <i className="ms-espera" title={`${espera} en lista de espera`}>⏳{espera}</i> : null}
            {cupoDia?.max_pax_online != null ? <i title={`Aforo online por turno: ${cupoDia.max_pax_online}`}>🌐{cupoDia.max_pax_online}</i> : null}
          </span>
        </div>
        {!filas.length ? (
          <div className="ms-sinturno">{diaCerrado ? "🔒 Cerrado" : "Sin servicio"}</div>
        ) : diaCerrado && !filas.some((x) => x.reservas) ? (
          <div className="ms-turno cerrado"><span className="ms-tn">🔒 Cerrado</span></div>
        ) : (
          filas.map((x) => {
            const aforo = aforoDe(x);
            const pct = aforo ? Math.round((x.pax / aforo) * 100) : 0;
            return (
              <div key={x.turno_id} className={`ms-turno ${x.cerrado ? "cerrado" : ""}`} title={`${x.turno}: ${x.reservas} reservas · ${x.pax}/${aforo} pax · ${x.mesas_ocupadas}/${x.mesas_total} mesas${x.cerrado ? " · cerrado" : ""}${x.max_pax_online != null ? ` · online máx. ${x.max_pax_online}` : ""}`}>
                <div className="ms-linea">
                  <span className="ms-tn">{x.cerrado ? "🔒 " : ""}{x.turno}</span>
                  <span className="ms-tp">{x.pax}<small>/{aforo}</small></span>
                </div>
                <div className={`ms-barra ${nivelDe(pct)}`}><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
                <div className="ms-mesas">{x.mesas_ocupadas}/{x.mesas_total} mesas</div>
              </div>
            );
          })
        )}
        {todasNotas.length ? <div className="ms-nota">{todasNotas[0]}</div> : null}
      </div>,
    );
  }

  return (
    <div className="ms">
      <div className="mes-cab">
        <button className="nav mes-nav" onClick={() => nav(-1)} aria-label="Mes anterior">‹</button>
        <div className="titulo">{tituloMes(ancla)}</div>
        <button className="nav mes-nav" onClick={() => nav(1)} aria-label="Mes siguiente">›</button>
        <button className="ms-hoy" onClick={() => { setAncla(hoy.slice(0, 7)); }}>Hoy</button>
        <button className={`ms-hoy ${modoSel ? "activo" : ""}`} onClick={() => { setModoSel((v) => !v); if (modoSel) setSeleccion([]); }} title="Para seleccionar varios días con el dedo">
          {modoSel ? "✓ Seleccionando" : "Seleccionar días"}
        </button>
        <div className="tot">
          <b>{totales.pax}</b> pax · <b>{totales.reservas}</b> reservas
          {totales.porTurno.length > 1 ? <span className="ms-tot-turnos"> · {totales.porTurno.map((t) => `${t.nombre} ${t.pax}`).join(" · ")}</span> : null}
        </div>
      </div>

      {/* barra de acción masiva */}
      {seleccion.length ? (
        <div className="ms-accion">
          <div className="ms-accion-txt">
            <b>{seleccion.length} {seleccion.length === 1 ? "día" : "días"}</b> · {listaFechas(seleccion)}
          </div>
          <select value={turnoAccion} onChange={(e) => setTurnoAccion(e.target.value)} aria-label="Turno">
            <option value="">Día completo</option>
            {turnosMes.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
          <button className="ms-btn peligro" onClick={() => pedir({ tipo: "cerrar" })} disabled={guardando}>🔒 Cerrar</button>
          <button className="ms-btn" onClick={() => pedir({ tipo: "abrir" })} disabled={guardando}>Abrir</button>
          <span className="ms-sep" />
          <input type="number" min={0} inputMode="numeric" placeholder="Online / turno" value={aforoTxt} onChange={(e) => setAforoTxt(e.target.value)} aria-label="Aforo online por turno" title="Aforo online por turno (pax)" />
          <button className="ms-btn" onClick={() => pedir({ tipo: "aforo", valor: aforoTxt.trim() === "" ? null : Math.max(0, parseInt(aforoTxt) || 0) })} disabled={guardando}>
            {aforoTxt.trim() === "" ? "Quitar límite" : "Fijar aforo"}
          </button>
          <span className="ms-sep" />
          <input type="text" placeholder="Nota de cupo" value={notaTxt} onChange={(e) => setNotaTxt(e.target.value)} maxLength={140} aria-label="Nota" />
          <button className="ms-btn" onClick={() => pedir({ tipo: "nota", valor: notaTxt.trim() || null })} disabled={guardando}>
            {notaTxt.trim() ? "Guardar nota" : "Quitar nota de cupo"}
          </button>
          <button className="ms-btn sec" onClick={() => setSeleccion([])}>Cancelar</button>
        </div>
      ) : (
        <div className="ms-ayuda">
          Clic (o toque) en un día para abrirlo · arrastra sobre varios días (o mayúsculas + clic) para cerrar, abrir o fijar aforo en bloque.
        </div>
      )}

      {!datos ? <div className="spinner" /> : null}
      <div
        ref={gridRef}
        className={`mes-grid ms-grid ${modoSel ? "modo-sel" : ""} ${datos ? "" : "cargando"}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { arrastre.current = null; }}
      >
        {celdas}
      </div>

      <div className="leyenda" style={{ marginTop: 10 }}>
        <span><i style={{ background: "#2E9E5B" }} />menos del 80 %</span>
        <span><i style={{ background: "#D99A1E" }} />80–99 %</span>
        <span><i style={{ background: "#E5484D" }} />completo</span>
        <span>🔒 cupo cerrado · 📝 nota de cupo · 📌 nota del día (se edita en Día) · ⏳ lista de espera · 🌐 aforo online por turno</span>
        <span>pax / aforo del turno (aforo = máximo del turno o suma de plazas)</span>
      </div>

      {confirmar ? (
        <div className="rsp-modal" onClick={(e) => { if (e.target === e.currentTarget && !guardando) setConfirmar(null); }}>
          <div className="modal ms-modal">
            <h2>¿Confirmar?</h2>
            <p className="ms-confirm-txt">{confirmar.texto}</p>
            {confirmar.aviso ? <p className="ms-confirm-aviso">{confirmar.aviso}</p> : null}
            <div className="acciones">
              <button className="primaria" disabled={guardando} onClick={async () => { const h = confirmar.hacer; await h(); setConfirmar(null); }}>
                {guardando ? "Guardando…" : "Sí, aplicar"}
              </button>
              <button disabled={guardando} onClick={() => setConfirmar(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
