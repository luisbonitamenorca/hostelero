"use client";

/* Contadores (plan 2.5): «Contador de horas» y «Saldo de vacaciones» de Skello. */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as api from "../acciones/contadores";
import type { Ajuste, EmpContador, FilaSemana, FilaVacaciones, SaldoEmp } from "../acciones/contadores";
import { hoyIso, lunesDe, sumaDia } from "../tipos";
import { guardarPref, leerPref, rangoMes, semanaIso, type SecProps } from "../lib-rrhh";
import "./contadores.css";

/* ==================== Formato ==================== */

const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
/** 7.5 → "7,5" */
const h = (v: number) => String(r2(v)).replace(".", ",");
/** 1234.5 → "1.235 €" (coste en la rejilla, sin céntimos para que quepa). */
const eur0 = (v: number) => Math.round(Number(v) || 0).toLocaleString("es-ES") + " €";
/** 1234.5 → "1234,50" (CSV: número con coma, sin separador de miles). */
const eur2 = (v: number) => r2(v).toFixed(2).replace(".", ",");
/** Estilo de la línea de coste en las celdas (sin tocar el CSS de la sección). */
const ST_COSTE = { fontSize: 11, color: "var(--tinta-suave)", marginTop: 1 } as const;

/** Cambio de pestaña (misma convención que Hoy): PanelRrhh atiende 'rrhh:tab'; si nadie lo atiende, se recarga con la preferencia. */
const irA = (tab: string) => {
  if (typeof window === "undefined") return;
  const atendido = !window.dispatchEvent(new CustomEvent("rrhh:tab", { detail: tab, cancelable: true }));
  if (atendido) return;
  guardarPref("tab", tab);
  window.location.reload();
};
/** 7.5 → "+7,5" · -3 → "−3" · 0 → "0" */
const signo = (v: number) => {
  const x = r2(v);
  return x > 0 ? "+" + h(x) : x < 0 ? "−" + h(-x) : "0";
};
const ddmm = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const TIPO_AJUSTE: Record<string, string> = { pago: "Pago de horas", descanso: "Descanso compensatorio", inicial: "Saldo inicial", ajuste: "Ajuste" };

function sumaMes(iso: string, n: number) {
  const [a, m] = iso.split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return d.toLocaleDateString("sv-SE");
}

function nombreDe(e: { nombre: string; apellidos: string | null }) {
  return `${e.apellidos || ""}, ${e.nombre}`.replace(/^, /, "");
}

function descargarCsv(nombre: string, filas: (string | number)[][]) {
  const csv = filas
    .map((f) => f.map((c) => { const s = String(c ?? ""); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(";"))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ==================== Sección ==================== */

type Datos = Awaited<ReturnType<typeof api.cargarContadores>>;

export default function SecContadores({ ctx, avisar }: SecProps) {
  const [sub, setSub] = useState<"horas" | "vacaciones">(() => (leerPref<string>("contadores:sub", "horas") === "vacaciones" ? "vacaciones" : "horas"));
  // El centro se comparte con el resto de pestañas ('rrhh:centro'); «Todos los centros» ("") solo se recuerda aquí.
  const [centroId, setCentro] = useState<string>(() => {
    const g = leerPref<string | null>("contadores:centro", null) ?? leerPref<string>("centro", ctx.esGestor ? "" : ctx.centros[0].id);
    if (g === "" && ctx.esGestor) return "";
    return ctx.centros.some((c) => c.id === g) ? g : ctx.centros[0].id;
  });
  const setCentroId = (id: string) => { setCentro(id); guardarPref("contadores:centro", id); if (id) guardarPref("centro", id); };
  const cambiarSub = (s: "horas" | "vacaciones") => { setSub(s); guardarPref("contadores:sub", s); };
  const centroNombre = (id: string | null) => ctx.centros.find((c) => c.id === id)?.nombre || "";

  return (
    <div className="cont-sec">
      <div className="cont-subtabs">
        <button className={sub === "horas" ? "activa" : ""} onClick={() => cambiarSub("horas")}>Contador de horas</button>
        <button className={sub === "vacaciones" ? "activa" : ""} onClick={() => cambiarSub("vacaciones")}>Saldo de vacaciones</button>
      </div>
      {sub === "horas" ? (
        <ContadorHoras ctx={ctx} avisar={avisar} centroId={centroId} setCentroId={setCentroId} centroNombre={centroNombre} />
      ) : (
        <SaldoVacaciones ctx={ctx} avisar={avisar} centroId={centroId} setCentroId={setCentroId} centroNombre={centroNombre} />
      )}
    </div>
  );
}

type PropsSub = SecProps & { centroId: string; setCentroId: (id: string) => void; centroNombre: (id: string | null) => string };

function SelectorCentro({ ctx, centroId, setCentroId }: Pick<PropsSub, "ctx" | "centroId" | "setCentroId">) {
  return (
    <select value={centroId} onChange={(e) => setCentroId(e.target.value)}>
      {ctx.esGestor ? <option value="">Todos los centros</option> : null}
      {ctx.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
    </select>
  );
}

/* ==================== Contador de horas ==================== */

function ContadorHoras({ ctx, avisar, centroId, setCentroId, centroNombre }: PropsSub) {
  const hoy = hoyIso();
  const [rango, setRango] = useState(() => rangoMes(hoy));
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [saldos, setSaldos] = useState<Record<string, SaldoEmp> | null>(null);
  const [cargandoSaldos, setCargandoSaldos] = useState(false);
  // Caché por fecha final → saldo de cada empleado (el saldo es de la persona, no del centro).
  const cacheSaldos = useRef<Map<string, Record<string, SaldoEmp>>>(new Map());
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const peticion = useRef(0);

  const { desde, hasta } = rango;
  const centroArg = centroId || null;
  // El saldo se calcula SIEMPRE a hoy como máximo: las semanas futuras sin planificar restarían el contrato entero.
  const saldoRecortado = hasta > hoy;
  const hastaSaldo = saldoRecortado ? hoy : hasta;

  // Tabla del rango.
  useEffect(() => {
    if (!desde || !hasta || desde > hasta) return;
    const id = ++peticion.current;
    // La tabla anterior se queda atenuada mientras llega la nueva (como en Skello): sin parpadeo ni pérdida del scroll.
    setCargando(true); setError("");
    api.cargarContadores(centroArg, desde, hasta)
      .then((d) => { if (id === peticion.current) setDatos(d); })
      .catch((e: Error) => { if (id === peticion.current) { setError(e.message); setDatos(null); } })
      .finally(() => { if (id === peticion.current) setCargando(false); });
  }, [centroArg, desde, hasta]);

  // Saldos y alertas del año, en segundo plano (es lo lento). Caché por fecha final y empleado:
  // al cambiar de centro solo se piden los empleados que faltan.
  useEffect(() => {
    if (!datos) return;
    const ids = datos.empleados.map((e) => e.id);
    if (!ids.length) { setSaldos({}); return; }
    const enCache = cacheSaldos.current.get(hastaSaldo) ?? {};
    const faltan = ids.filter((i) => !enCache[i]);
    if (!faltan.length) { setSaldos(enCache); return; }
    const id = peticion.current;
    // Los que ya están en caché para esta fecha se enseñan ya; los demás, «…» hasta que lleguen.
    setSaldos(Object.keys(enCache).length ? enCache : null);
    setCargandoSaldos(true);
    api.cargarSaldos(hastaSaldo, faltan)
      .then((r) => {
        const todos = { ...(cacheSaldos.current.get(hastaSaldo) ?? {}), ...r.saldos };
        cacheSaldos.current.set(hastaSaldo, todos);
        if (id === peticion.current) setSaldos(todos);
      })
      .catch((e: Error) => { if (id === peticion.current) avisar("No se han podido calcular los saldos: " + e.message); })
      .finally(() => { if (id === peticion.current) setCargandoSaldos(false); });
  }, [datos, hastaSaldo, avisar]);

  // Semanas del rango y filas por empleado.
  const semanas = useMemo(() => {
    const out: { lunes: string; semana: number; anio: number }[] = [];
    if (!desde || !hasta || desde > hasta) return out;
    const fin = lunesDe(hasta);
    for (let l = lunesDe(desde); l <= fin; l = sumaDia(l, 7)) { const w = semanaIso(l); out.push({ lunes: l, semana: w.semana, anio: w.anio }); }
    return out;
  }, [desde, hasta]);

  const porEmp = useMemo(() => {
    const m: Record<string, Record<string, FilaSemana>> = {};
    for (const f of datos?.filas ?? []) (m[f.empleado_id] = m[f.empleado_id] || {})[f.lunes] = f;
    return m;
  }, [datos]);

  const empleadosOrden = useMemo(
    () => [...(datos?.empleados ?? [])].sort((a, b) =>
      (a.departamento || "zz").localeCompare(b.departamento || "zz") || nombreDe(a).localeCompare(nombreDe(b))),
    [datos],
  );

  // Coste de personal: solo llega si el servidor lo ha calculado (dirección). A los demás no se les pinta nada.
  const mostrarCoste = !!datos?.coste;
  const lunesHoy = lunesDe(hoy);

  /** Totales de un empleado. `k` = coste sumado · `kFalta` = alguna semana pasada con horas sin coste/hora (el total queda corto). */
  const totalEmp = (id: string) => {
    let c = 0, r = 0, d = 0, k = 0, kHay = false, kFalta = false;
    for (const f of Object.values(porEmp[id] || {})) {
      c += f.horas_contrato; r += f.horas_retenidas + f.horas_ausencia_contador; d += f.diferencia;
      if (f.lunes > lunesHoy) continue;
      if (f.coste != null) { k += f.coste; kHay = true; } else if (f.horas_retenidas + f.horas_ausencia_contador > 0) kFalta = true;
    }
    return { c, r, d, k, kHay, kFalta };
  };
  const totalSemana = (lunes: string) => {
    let c = 0, r = 0, d = 0, k = 0, kHay = false, kFalta = false;
    for (const e of empleadosOrden) {
      const f = porEmp[e.id]?.[lunes];
      if (!f) continue;
      c += f.horas_contrato; r += f.horas_retenidas + f.horas_ausencia_contador; d += f.diferencia;
      if (f.coste != null) { k += f.coste; kHay = true; } else if (f.horas_retenidas + f.horas_ausencia_contador > 0) kFalta = true;
    }
    return { c, r, d, k, kHay, kFalta };
  };
  /** Línea de coste de una celda de totales. */
  const lineaCoste = ({ k, kHay, kFalta }: { k: number; kHay: boolean; kFalta: boolean }) =>
    kHay
      ? <div style={ST_COSTE} title={kFalta ? "Falta el coste/hora de alguna persona o semana: el coste real es mayor" : undefined}>{eur0(k)}{kFalta ? " *" : ""}</div>
      : <div className="cont-vacia" style={ST_COSTE} title={kFalta ? "Sin coste/hora" : undefined}>—</div>;

  const alertasDe = (e: EmpContador): { tipo: "extra" | "compl"; texto: string }[] => {
    const s = saldos?.[e.id];
    if (!s || !datos) return [];
    const reglas = datos.reglasPorEmp[e.id];
    const out: { tipo: "extra" | "compl"; texto: string }[] = [];
    if (s.extrasAnio > reglas.horas_extra_max_anual) out.push({ tipo: "extra", texto: `${h(s.extrasAnio)} h extra en ${hastaSaldo.slice(0, 4)} (máx. ${h(reglas.horas_extra_max_anual)})` });
    if (s.horasSemana > 0 && s.horasSemana < 40 && s.complementariasPct != null && s.complementariasPct > reglas.complementarias_max_pct) {
      out.push({ tipo: "compl", texto: `${h(s.complementariasPct)} % de complementarias (máx. ${h(reglas.complementarias_max_pct)} %)` });
    }
    return out;
  };

  const etiquetaRango = () => {
    const m = rangoMes(desde);
    if (m.desde === desde && m.hasta === hasta) {
      const [a, mm] = desde.split("-").map(Number);
      return `${MESES[mm - 1][0].toUpperCase()}${MESES[mm - 1].slice(1)} ${a}`;
    }
    return `${ddmm(desde)} – ${ddmm(hasta)}`;
  };

  function exportarCsv() {
    if (!datos) return;
    const cab: (string | number)[] = ["Empleado", "Departamento", "Centro", "Contrato (h/sem)"];
    for (const s of semanas) {
      cab.push(`S${s.semana} ${ddmm(s.lunes)} contrato`, `S${s.semana} realizadas`, `S${s.semana} diferencia`);
      if (mostrarCoste) cab.push(`S${s.semana} coste €`);
    }
    cab.push("Total contrato", "Total realizadas", "Diferencia del periodo", "Extras del año", "Saldo acumulado");
    if (mostrarCoste) cab.push("Coste del periodo €");
    const filas: (string | number)[][] = [cab];
    for (const e of empleadosOrden) {
      const t = totalEmp(e.id);
      const s = saldos?.[e.id];
      const fila: (string | number)[] = [nombreDe(e), e.departamento || "", centroNombre(e.centro_principal_id), h(s?.horasSemana ?? e.horas_semana ?? 0)];
      for (const w of semanas) {
        const f = porEmp[e.id]?.[w.lunes];
        fila.push(f ? h(f.horas_contrato) : "", f ? h(f.horas_retenidas + f.horas_ausencia_contador) : "", f ? h(f.diferencia) : "");
        if (mostrarCoste) fila.push(f?.coste != null && w.lunes <= lunesHoy ? eur2(f.coste) : "");
      }
      fila.push(h(t.c), h(t.r), h(t.d), s ? h(s.extrasAnio) : "", s ? h(s.saldo) : "");
      if (mostrarCoste) fila.push(t.kHay ? eur2(t.k) : "");
      filas.push(fila);
    }
    if (mostrarCoste) {
      // Fila de totales: solo el coste (las horas ya salen por persona).
      const tot: (string | number)[] = ["Total", "", "", ""];
      for (const w of semanas) { const t = totalSemana(w.lunes); tot.push("", "", "", t.kHay && w.lunes <= lunesHoy ? eur2(t.k) : ""); }
      let k = 0, kHay = false;
      for (const e of empleadosOrden) { const t = totalEmp(e.id); if (t.kHay) { k += t.k; kHay = true; } }
      tot.push("", "", "", "", "", kHay ? eur2(k) : "");
      filas.push(tot);
    }
    descargarCsv(`resumen_contadores_${desde}_${hasta}.csv`, filas);
  }

  const onAjuste = useCallback((empId: string, a: Ajuste) => {
    // El saldo cambia si el ajuste cae dentro de lo que se cuenta; la caché queda vieja.
    cacheSaldos.current.clear();
    setSaldos((prev) => {
      if (!prev?.[empId]) return prev;
      const s = prev[empId];
      if (a.fecha < s.desde || a.fecha > hastaSaldo) return prev;
      return { ...prev, [empId]: { ...s, saldo: r2(s.saldo + Number(a.horas)) } };
    });
  }, [hastaSaldo]);

  const detalle = detalleId ? datos?.empleados.find((e) => e.id === detalleId) ?? null : null;
  const sinCosteHora = datos?.coste?.sinCosteHora.length ?? 0;
  // Semanas-persona del rango con días planificados que nadie ha validado todavía (Ratios las lee según el plan).
  const sinValidar = useMemo(() => (datos?.filas ?? []).filter((f) => f.dias_validados < f.dias_plan).length, [datos]);

  return (
    <>
      <div className="barra">
        <SelectorCentro ctx={ctx} centroId={centroId} setCentroId={setCentroId} />
        <div className="sem-nav">
          <button onClick={() => setRango(rangoMes(sumaMes(desde, -1)))} title="Mes anterior">‹</button>
          <span className="sem-label cont-label-mes" title="Clic: este mes" onClick={() => setRango(rangoMes(hoy))}>{etiquetaRango()}</span>
          <button onClick={() => setRango(rangoMes(sumaMes(desde, 1)))} title="Mes siguiente">›</button>
          <button className="btn btn-fantasma cont-este-mes" style={{ height: 34 }} onClick={() => setRango(rangoMes(hoy))}>Este mes</button>
        </div>
        <div className="cont-fechas">
          <input type="date" value={desde} onChange={(e) => e.target.value && setRango({ desde: e.target.value, hasta: hasta < e.target.value ? e.target.value : hasta })} />
          <span>–</span>
          <input type="date" value={hasta} onChange={(e) => e.target.value && setRango({ desde: desde > e.target.value ? e.target.value : desde, hasta: e.target.value })} />
        </div>
        <div className="cont-barra-der">
          <button className="btn btn-fantasma" onClick={exportarCsv} disabled={!datos || !empleadosOrden.length}>Exportar CSV</button>
        </div>
      </div>

      {error ? <div className="cont-error">No se han podido cargar los contadores: {error}</div> : null}
      {!datos ? (
        cargando ? <div className="vacio">Calculando el contador de {etiquetaRango().toLowerCase()}… puede tardar unos segundos.</div> : null
      ) : !empleadosOrden.length ? (
        <div className="vacio">
          {cargando ? "Actualizando…" : ctx.esGestor ? "No hay horas de contrato ni turnos publicados en este rango." : "No tienes acceso a los contadores de este centro todavía. Habla con dirección."}
        </div>
      ) : (
        <div className="cont-scroll" style={{ opacity: cargando ? 0.5 : 1, pointerEvents: cargando ? "none" : "auto" }}>
          <table className="cont-tabla">
            <thead>
              <tr>
                <th className="cont-th-nombre">Empleado</th>
                {semanas.map((s) => (
                  <th key={s.lunes} className={s.lunes === lunesHoy ? "cont-th-hoy" : ""}>
                    <div>Semana {s.semana}</div>
                    <div className="cont-th-sub">{ddmm(s.lunes)} – {ddmm(sumaDia(s.lunes, 6))}</div>
                  </th>
                ))}
                <th className="cont-th-total"><div>Total</div><div className="cont-th-sub">{ddmm(desde)} – {ddmm(hasta)}</div></th>
                <th className="cont-th-total" title={saldoRecortado ? "El saldo se calcula a hoy: las semanas futuras no cuentan." : undefined}>
                  <div>Saldo</div><div className="cont-th-sub">{saldoRecortado ? "a hoy" : "a " + ddmm(hasta)}</div>
                </th>
              </tr>
              <tr className="cont-th-leyenda">
                <th className="cont-th-nombre">contrato · realizadas · diferencia{mostrarCoste ? " · coste" : ""}</th>
                {semanas.map((s) => <th key={s.lunes} />)}
                <th /><th />
              </tr>
            </thead>
            <tbody>
              {empleadosOrden.map((e, i) => {
                const t = totalEmp(e.id);
                const s = saldos?.[e.id];
                const alertas = alertasDe(e);
                const depto = e.departamento || "Sin departamento";
                const nuevoDepto = i === 0 || (empleadosOrden[i - 1].departamento || "Sin departamento") !== depto;
                return (
                  <FilaEmpleado key={e.id} nuevoDepto={nuevoDepto} depto={depto} colSpan={semanas.length + 3}>
                    <td className="cont-nombre" onClick={() => setDetalleId(e.id)}>
                      <div className="cont-np">{nombreDe(e)}</div>
                      <div className="cont-sub">
                        {h(s?.horasSemana ?? e.horas_semana ?? 0)} h/sem
                        {!centroId ? " · " + centroNombre(e.centro_principal_id) : e.centro_principal_id !== centroId ? " · de " + (centroNombre(e.centro_principal_id) || "otro centro") : ""}
                      </div>
                      {alertas.map((a) => <div key={a.tipo} className={`cont-alerta ${a.tipo}`}>⚠ {a.texto}</div>)}
                    </td>
                    {semanas.map((w) => {
                      const f = porEmp[e.id]?.[w.lunes];
                      const futura = w.lunes > lunesHoy;
                      return (
                        <td key={w.lunes} className={"cont-celda" + (w.lunes === lunesHoy ? " hoy" : "") + (futura ? " cont-futura" : "")} onClick={() => setDetalleId(e.id)}>
                          {f ? <Celda f={f} futura={futura} coste={mostrarCoste} /> : <span className="cont-vacia">—</span>}
                        </td>
                      );
                    })}
                    <td className="cont-celda cont-total" onClick={() => setDetalleId(e.id)}>
                      <div className="cont-c">{h(t.c)}</div>
                      <div className="cont-r">{h(t.r)}</div>
                      <div className={clase(t.d)}>{signo(t.d)}</div>
                      {mostrarCoste ? lineaCoste(t) : null}
                    </td>
                    <td className="cont-celda cont-saldo" onClick={() => setDetalleId(e.id)}>
                      {s ? <div className={clase(s.saldo) + " cont-saldo-v"}>{signo(s.saldo)} h</div> : <div className="cont-vacia">{cargandoSaldos ? "…" : "—"}</div>}
                    </td>
                  </FilaEmpleado>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="cont-nombre"><div className="cont-np">Total {centroId ? centroNombre(centroId) : "todos los centros"}</div><div className="cont-sub">{empleadosOrden.length} personas</div></td>
                {semanas.map((w) => { const t = totalSemana(w.lunes); const futura = w.lunes > lunesHoy; return (
                  <td key={w.lunes} className={"cont-celda" + (futura ? " cont-futura" : "")}>
                    <div className="cont-c">{h(t.c)}</div>
                    {futura ? <><div className="cont-vacia">—</div><div className="cont-vacia">—</div></> : <><div className="cont-r">{h(t.r)}</div><div className={clase(t.d)}>{signo(t.d)}</div></>}
                    {mostrarCoste ? (futura ? <div className="cont-vacia" style={ST_COSTE}>—</div> : lineaCoste(t)) : null}
                  </td>
                ); })}
                {(() => {
                  let c = 0, r = 0, d = 0, k = 0, kHay = false, kFalta = false;
                  for (const e of empleadosOrden) { const t = totalEmp(e.id); c += t.c; r += t.r; d += t.d; if (t.kHay) { k += t.k; kHay = true; } if (t.kFalta) kFalta = true; }
                  return (
                    <td className="cont-celda cont-total">
                      <div className="cont-c">{h(c)}</div><div className="cont-r">{h(r)}</div><div className={clase(d)}>{signo(d)}</div>
                      {mostrarCoste ? lineaCoste({ k, kHay, kFalta }) : null}
                    </td>
                  );
                })()}
                {(() => {
                  // Suma de saldos del centro (horas que debe la empresa, o que le deben): solo cuando están todos.
                  if (!saldos || empleadosOrden.some((e) => !saldos[e.id])) return <td className="cont-celda cont-saldo"><div className="cont-vacia">{cargandoSaldos ? "…" : "—"}</div></td>;
                  const sSaldo = empleadosOrden.reduce((a, e) => a + (saldos[e.id]?.saldo ?? 0), 0);
                  return <td className="cont-celda cont-saldo"><div className={clase(sSaldo) + " cont-saldo-v"}>{signo(sSaldo)} h</div></td>;
                })()}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {datos && empleadosOrden.length ? (
        <div className="cont-pie">
          {cargando ? <div className="cont-calculando">Actualizando…</div> : cargandoSaldos ? <div className="cont-calculando">Calculando saldos y alertas del año… la tabla ya se puede usar.</div> : null}
          {mostrarCoste && sinCosteHora > 0 ? (
            <div className="cont-alerta compl" style={{ marginBottom: 8 }}>
              ⚠ {sinCosteHora} {sinCosteHora === 1 ? "persona sin coste/hora" : "personas sin coste/hora"}: su coste sale como «—» y los totales marcados con * quedan cortos.{" "}
              <button className="link-btn2" onClick={() => irA("empleados")}>Ponerlo en Empleados ›</button>
            </div>
          ) : null}
          <div className="leyenda">
            <span><span className="muestra" style={{ background: "var(--amber-light)", border: "1px solid var(--amber)" }} /> más horas que el contrato</span>
            <span><span className="muestra" style={{ background: "var(--blue-light)", border: "1px solid var(--blue)" }} /> menos horas que el contrato</span>
            <span><span className="cont-r cont-r-plan">7,5</span> en gris: según turnos publicados, aún sin validar</span>
            {saldoRecortado ? <span><span className="cont-vacia">—</span> semanas futuras: no cuentan en el saldo</span> : null}
            <span>Toca un empleado para ver el detalle y los ajustes.</span>
            <span title={sinValidar > 0 ? `${sinValidar} semana${sinValidar === 1 ? "" : "s"}-persona del rango sin validar: Ratios las lee según los turnos publicados` : undefined}>
              Ratios lee estas horas en vivo (fichajes validados o, si no, turnos publicados; más ausencias que computan).
            </span>
          </div>
          <p className="nota-inf">
            Cómo se calcula: cada semana, horas realizadas (fichajes validados o, si no los hay, turnos publicados) más ausencias que computan, menos las horas de contrato.
            El saldo suma esas diferencias desde el 1 de enero (o desde el saldo inicial traído de Skello) más los ajustes manuales.
            {centroId ? " Los empleados de otros centros que han trabajado aquí aparecen con el total de sus horas (el contador es de la persona)." : ""}
            {mostrarCoste ? " Coste (solo dirección): horas realizadas × coste/hora vigente el lunes de la semana × (1 + coste de empresa del convenio del centro principal). Semanas futuras sin coste." : ""}
          </p>
        </div>
      ) : null}

      {detalle ? (
        <DetalleEmpleado
          emp={detalle}
          semanas={semanas}
          filas={porEmp[detalle.id] || {}}
          saldoAnio={saldos?.[detalle.id] ?? null}
          reglas={datos?.reglasPorEmp[detalle.id] ?? { horas_extra_max_anual: 80, complementarias_max_pct: 30 }}
          hasta={hastaSaldo}
          esGestor={ctx.esGestor}
          mostrarCoste={mostrarCoste}
          avisar={avisar}
          onAjuste={onAjuste}
          cerrar={() => setDetalleId(null)}
        />
      ) : null}
    </>
  );
}

const clase = (d: number) => (r2(d) > 0 ? "cont-mas" : r2(d) < 0 ? "cont-menos" : "cont-cero");

function Celda({ f, futura, coste }: { f: FilaSemana; futura?: boolean; coste?: boolean }) {
  const real = f.horas_retenidas + f.horas_ausencia_contador;
  // Semana futura: se enseña el contrato, pero realizadas y diferencia no cuentan todavía.
  if (futura) {
    return (
      <div title={`Contrato ${h(f.horas_contrato)} h · semana futura: no cuenta en el saldo`}>
        <div className="cont-c">{h(f.horas_contrato)}</div>
        <div className="cont-vacia">—</div>
        <div className="cont-vacia">—</div>
        {coste ? <div className="cont-vacia" style={ST_COSTE}>—</div> : null}
      </div>
    );
  }
  const titulo =
    `Contrato ${h(f.horas_contrato)} h · realizadas ${h(f.horas_retenidas)} h` +
    (f.horas_ausencia_contador > 0 ? ` + ${h(f.horas_ausencia_contador)} h de ausencias que computan` : "") +
    (f.dias_validados ? ` · ${f.dias_validados} de ${f.dias_plan} día(s) validado(s)` : f.dias_plan ? " · según turnos publicados, sin validar" : "") +
    (coste ? (f.coste != null ? ` · coste ${eur0(f.coste)}` : " · sin coste/hora") : "");
  // En gris cursiva cuando hay días planificados que nadie ha validado: Skello solo cuenta horas validadas.
  const sinValidar = f.dias_validados < f.dias_plan;
  return (
    <div title={titulo}>
      <div className="cont-c">{h(f.horas_contrato)}</div>
      <div className={"cont-r" + (sinValidar ? " cont-r-plan" : "")}>{h(real)}{f.horas_ausencia_contador > 0 ? <span className="cont-aus" title="Incluye ausencias que computan">*</span> : null}</div>
      <div className={clase(f.diferencia)}>{signo(f.diferencia)}</div>
      {coste ? (f.coste != null ? <div style={ST_COSTE}>{eur0(f.coste)}</div> : <div className="cont-vacia" style={ST_COSTE}>—</div>) : null}
    </div>
  );
}

function FilaEmpleado({ nuevoDepto, depto, colSpan, children }: { nuevoDepto: boolean; depto: string; colSpan: number; children: ReactNode }) {
  return (
    <>
      {nuevoDepto ? <tr className="cont-depto"><td colSpan={colSpan}><span className="cont-depto-txt">{depto}</span></td></tr> : null}
      <tr className="cont-fila">{children}</tr>
    </>
  );
}

/* ==================== Detalle (panel lateral) ==================== */

function DetalleEmpleado({ emp, semanas, filas, saldoAnio, reglas, hasta, esGestor, mostrarCoste, avisar, onAjuste, cerrar }: {
  emp: EmpContador;
  semanas: { lunes: string; semana: number }[];
  filas: Record<string, FilaSemana>;
  saldoAnio: SaldoEmp | null;
  reglas: { horas_extra_max_anual: number; complementarias_max_pct: number };
  hasta: string;
  esGestor: boolean;
  /** Solo dirección: columna de coste en «Semanas del rango». */
  mostrarCoste: boolean;
  avisar: (m: string) => void;
  onAjuste: (empId: string, a: Ajuste) => void;
  cerrar: () => void;
}) {
  const [det, setDet] = useState<{ saldo: number; ajustes: Ajuste[] } | null>(null);
  const [tipo, setTipo] = useState<"pago" | "descanso" | "inicial" | "ajuste">("ajuste");
  const [fecha, setFecha] = useState(hoyIso());
  const [horas, setHoras] = useState("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setDet(null);
    api.detalleContador(emp.id, hasta).then(setDet).catch((e: Error) => avisar("No se ha podido cargar el detalle: " + e.message));
  }, [emp.id, hasta, avisar]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [cerrar]);

  // Pagar horas y convertir en descanso SACAN horas del contador: se escriben en positivo («pagar 8») y se guardan en negativo.
  // Si alguien escribe el signo negativo por costumbre (Skello), se respeta. Saldo inicial y ajuste llevan su signo.
  const restaDelContador = tipo === "pago" || tipo === "descanso";
  const nHoras = (() => {
    const v = Number(horas.replace(",", "."));
    if (!Number.isFinite(v) || v === 0) return null;
    return restaDelContador ? -Math.abs(v) : v;
  })();
  const saldoDespues = det && nHoras != null && fecha <= hasta && (!saldoAnio || fecha >= saldoAnio.desde) ? r2(det.saldo + nHoras) : null;

  async function guardar() {
    if (nHoras == null) { setErr(restaDelContador ? "Indica las horas." : "Indica las horas con signo: −8 resta, +8 suma."); return; }
    if (!motivo.trim()) { setErr("El motivo es obligatorio."); return; }
    setGuardando(true); setErr("");
    const r = await api.anadirAjuste({ empleado_id: emp.id, fecha, horas: nHoras, tipo, motivo });
    setGuardando(false);
    if (!r.ok || !r.data) { setErr(r.error || "No se ha podido guardar"); return; }
    const a = r.data;
    setDet((d) => d ? { saldo: a.fecha <= hasta ? r2(d.saldo + Number(a.horas)) : d.saldo, ajustes: [a, ...d.ajustes] } : d);
    onAjuste(emp.id, a);
    setHoras(""); setMotivo("");
    avisar("Ajuste guardado");
  }

  const pista: Record<string, string> = {
    pago: "Horas que se pagan en nómina: salen del contador. Escribe la cantidad en positivo (8 = se pagan 8 h).",
    descanso: "Horas que se convierten en descanso: salen del contador. Escribe la cantidad en positivo.",
    inicial: "Saldo con el que arranca el contador (lo que traía de Skello). Mejor fijarlo una sola vez.",
    ajuste: "Corrección manual con signo: +8 suma, −8 resta. Para anular un ajuste anterior, añade otro con el signo contrario.",
  };
  const etiquetaHoras: Record<string, string> = {
    pago: "Horas que se pagan",
    descanso: "Horas que pasan a descanso",
    inicial: "Horas (con signo)",
    ajuste: "Horas (con signo)",
  };

  return (
    <div className="cont-drawer-fondo" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <aside className="cont-drawer">
        <div className="cont-drawer-cab">
          <div>
            <h2>{nombreDe(emp)}</h2>
            <div className="cont-sub">{emp.departamento || "Sin departamento"} · {h(saldoAnio?.horasSemana ?? emp.horas_semana ?? 0)} h/sem{emp.tipo_contrato ? " · " + emp.tipo_contrato : ""}</div>
          </div>
          <button className="cont-cerrar" onClick={cerrar} aria-label="Cerrar">×</button>
        </div>

        <div className="cont-kpis">
          <div className="cont-kpi">
            <div className="cont-kpi-l">Saldo a {ddmm(hasta)}</div>
            <div className={"cont-kpi-v " + (det ? clase(det.saldo) : "")}>{det ? signo(det.saldo) + " h" : "…"}</div>
          </div>
          <div className="cont-kpi">
            <div className="cont-kpi-l">Extras en {hasta.slice(0, 4)}</div>
            <div className={"cont-kpi-v " + (saldoAnio && saldoAnio.extrasAnio > reglas.horas_extra_max_anual ? "cont-mas" : "")}>
              {saldoAnio ? `${h(saldoAnio.extrasAnio)} h` : "…"}
            </div>
            <div className="cont-kpi-s">máx. {h(reglas.horas_extra_max_anual)} h</div>
          </div>
          <div className="cont-kpi">
            <div className="cont-kpi-l">Complementarias</div>
            <div className={"cont-kpi-v " + (saldoAnio && saldoAnio.horasSemana < 40 && (saldoAnio.complementariasPct ?? 0) > reglas.complementarias_max_pct ? "cont-mas" : "")}>
              {saldoAnio ? (saldoAnio.horasSemana >= 40 ? "—" : saldoAnio.complementariasPct == null ? "—" : `${h(saldoAnio.complementariasPct)} %`) : "…"}
            </div>
            <div className="cont-kpi-s">{saldoAnio && saldoAnio.horasSemana >= 40 ? "jornada completa" : `máx. ${h(reglas.complementarias_max_pct)} %`}</div>
          </div>
        </div>
        {saldoAnio ? (
          <p className="nota">Cuenta desde el {ddmm(saldoAnio.desde)}/{saldoAnio.desde.slice(0, 4)}{emp.contador_inicial_fecha ? ` con saldo inicial ${signo(emp.contador_inicial_h)} h` : ""}.</p>
        ) : null}

        <h3>Semanas del rango</h3>
        <table className="cont-mini">
          <thead><tr><th>Semana</th><th>Contrato</th><th>Realizadas</th><th>Ausencias</th><th>Diferencia</th>{mostrarCoste ? <th>Coste</th> : null}</tr></thead>
          <tbody>
            {semanas.map((w) => {
              const f = filas[w.lunes];
              const futura = w.lunes > lunesDe(hasta);
              return (
                <tr key={w.lunes}>
                  <td>S{w.semana} · {ddmm(w.lunes)}</td>
                  <td>{f ? h(f.horas_contrato) : "—"}</td>
                  <td>{f ? h(f.horas_retenidas) : "—"}{f?.dias_validados ? <span className="cont-val" title="Días validados">✓</span> : null}</td>
                  <td>{f && f.horas_ausencia_contador > 0 ? h(f.horas_ausencia_contador) : "—"}</td>
                  <td className={f ? clase(f.diferencia) : ""}>{f ? signo(f.diferencia) : "—"}</td>
                  {mostrarCoste ? <td title={f && f.coste == null && !futura ? "Sin coste/hora para esta semana" : undefined}>{f && f.coste != null && !futura ? eur0(f.coste) : "—"}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>

        <h3>Ajustes del contador</h3>
        {!det ? (
          <div className="nota">Cargando…</div>
        ) : !det.ajustes.length ? (
          <div className="nota">Sin ajustes. Los ajustes nunca se borran: se compensan con otro.</div>
        ) : (
          <table className="cont-mini">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Horas</th><th>Motivo</th></tr></thead>
            <tbody>
              {det.ajustes.map((a) => (
                <tr key={a.id}>
                  <td>{ddmm(a.fecha)}/{a.fecha.slice(2, 4)}</td>
                  <td>{TIPO_AJUSTE[a.tipo] || a.tipo}</td>
                  <td className={clase(Number(a.horas))}>{signo(Number(a.horas))}</td>
                  <td className="cont-motivo">{a.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {esGestor ? (
          <div className="cont-form">
            <h3>Añadir ajuste</h3>
            <div className="fila-2">
              <div>
                <label>Tipo</label>
                <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
                  <option value="pago">Pagar horas</option>
                  <option value="descanso">Convertir en descanso</option>
                  <option value="inicial">Saldo inicial</option>
                  <option value="ajuste">Ajuste</option>
                </select>
              </div>
              <div>
                <label>Fecha</label>
                <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
              </div>
            </div>
            <label>{etiquetaHoras[tipo]}</label>
            <input type="text" inputMode="decimal" placeholder={restaDelContador ? "8" : "−8 o +4,5"} value={horas} onChange={(e) => setHoras(e.target.value.replace("−", "-"))} />
            <div className="nota">{pista[tipo]}</div>
            {nHoras != null && det ? (
              <div className="cont-resumen-aj">
                {saldoDespues != null
                  ? <>El saldo a {ddmm(hasta)} pasará de <b>{signo(det.saldo)} h</b> a <b>{signo(saldoDespues)} h</b>.</>
                  : <>Este ajuste ({signo(nHoras)} h) tiene fecha fuera de lo que se cuenta hasta el {ddmm(hasta)}: no cambia el saldo que ves ahora.</>}
              </div>
            ) : null}
            <label>Motivo</label>
            <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Obligatorio. Ej.: pagadas en la nómina de septiembre" />
            {err ? <div className="aviso-modal">{err}</div> : null}
            <div className="fila-acciones">
              <button className="btn btn-primario" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar ajuste"}</button>
            </div>
          </div>
        ) : (
          <div className="nota">Solo dirección o administración puede añadir ajustes.</div>
        )}
      </aside>
    </div>
  );
}

/* ==================== Saldo de vacaciones ==================== */

function SaldoVacaciones({ ctx, avisar, centroId, setCentroId, centroNombre }: PropsSub) {
  const [anio, setAnio] = useState(Number(hoyIso().slice(0, 4)));
  const [filas, setFilas] = useState<FilaVacaciones[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [ajuste, setAjuste] = useState<FilaVacaciones | null>(null);
  const [dias, setDias] = useState("");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState("");
  const peticion = useRef(0);
  const centroArg = centroId || null;
  // `vacaciones_ajuste_dias` no tiene año (se suma a «disfrutados» en cualquier año que se consulte): solo se ajusta el año en curso.
  const anioActual = Number(hoyIso().slice(0, 4));
  const puedeAjustar = ctx.esGestor && anio === anioActual;
  // En pantalla el ajuste va como en Skello: + = días MÁS de saldo. En la base se guarda al revés (se suma a disfrutados).
  const ajusteSaldo = (e: EmpContador) => -e.vacaciones_ajuste_dias;

  const cargar = useCallback(() => {
    const id = ++peticion.current;
    setCargando(true); setError("");
    api.cargarVacaciones(centroArg, anio)
      .then((r) => { if (id === peticion.current) setFilas(r.filas); })
      .catch((e: Error) => { if (id === peticion.current) { setError(e.message); setFilas(null); } })
      .finally(() => { if (id === peticion.current) setCargando(false); });
  }, [centroArg, anio]);
  useEffect(() => { cargar(); }, [cargar]);

  const orden = useMemo(() => [...(filas ?? [])].sort((a, b) =>
    (a.empleado.departamento || "zz").localeCompare(b.empleado.departamento || "zz") || nombreDe(a.empleado).localeCompare(nombreDe(b.empleado))), [filas]);

  function abrirAjuste(f: FilaVacaciones) {
    const actual = ajusteSaldo(f.empleado);
    setAjuste(f); setDias(actual ? String(actual).replace(".", ",") : ""); setMotivo(""); setErr("");
  }

  async function guardarAjuste() {
    if (!ajuste) return;
    const n = Number(dias.replace(",", "."));
    if (!Number.isFinite(n)) { setErr("Indica los días (con signo)."); return; }
    if (!motivo.trim()) { setErr("El motivo es obligatorio."); return; }
    setGuardando(true); setErr("");
    const r = await api.ajustarVacaciones(ajuste.empleado.id, n, motivo, anio);
    setGuardando(false);
    if (!r.ok) { setErr(r.error || "No se ha podido guardar"); return; }
    // En la base queda -n; lo que cambia en «disfrutados» es la diferencia con el valor anterior.
    const nuevoDb = -n;
    const delta = nuevoDb - ajuste.empleado.vacaciones_ajuste_dias;
    setFilas((prev) => (prev ?? []).map((f) => f.empleado.id !== ajuste.empleado.id ? f : {
      ...f,
      empleado: { ...f.empleado, vacaciones_ajuste_dias: nuevoDb, nota: r.data?.nota ?? f.empleado.nota },
      disfrutados: r2(f.disfrutados + delta),
      resto: r2(f.resto - delta),
    }));
    setAjuste(null);
    avisar("Ajuste de vacaciones guardado");
  }

  function exportar() {
    const cab = ["Empleado", "Departamento", "Centro", "Derecho anual", "Devengado a hoy", "Disfrutados", "Pendientes de aprobar", "Resto", "Ajuste manual"];
    const out: (string | number)[][] = [cab];
    for (const f of orden) out.push([nombreDe(f.empleado), f.empleado.departamento || "", centroNombre(f.empleado.centro_principal_id), h(f.derecho_anual), h(f.devengado_hoy), h(f.disfrutados), h(f.pendientes_aprobar), h(f.resto), h(ajusteSaldo(f.empleado))]);
    descargarCsv(`saldo_vacaciones_${anio}.csv`, out);
  }

  const tot = orden.reduce((a, f) => ({ d: a.d + f.derecho_anual, v: a.v + f.devengado_hoy, u: a.u + f.disfrutados, p: a.p + f.pendientes_aprobar, r: a.r + f.resto }), { d: 0, v: 0, u: 0, p: 0, r: 0 });

  return (
    <>
      <div className="barra">
        <SelectorCentro ctx={ctx} centroId={centroId} setCentroId={setCentroId} />
        <div className="sem-nav">
          <button onClick={() => setAnio(anio - 1)}>‹</button>
          <span className="sem-label" style={{ minWidth: 80 }}>{anio}</span>
          <button onClick={() => setAnio(anio + 1)}>›</button>
        </div>
        <div className="cont-barra-der">
          <button className="btn btn-fantasma" onClick={exportar} disabled={!orden.length}>Exportar CSV</button>
        </div>
      </div>

      {error ? <div className="cont-error">No se ha podido cargar el saldo de vacaciones: {error}</div> : null}
      {cargando ? (
        <div className="vacio">Calculando el saldo de vacaciones de {anio}…</div>
      ) : !filas ? null : !orden.length ? (
        <div className="vacio">{ctx.esGestor ? "No hay empleados activos en este centro." : "No tienes acceso a los saldos de este centro todavía. Habla con dirección."}</div>
      ) : (
        <div className="cont-scroll">
          <table className="cont-tabla cont-vac">
            <thead>
              <tr>
                <th className="cont-th-nombre">Empleado</th>
                <th>Derecho anual</th>
                <th>Devengado a hoy</th>
                <th>Disfrutados</th>
                <th>Pendientes de aprobar</th>
                <th>Resto</th>
                <th>Ajuste manual</th>
              </tr>
            </thead>
            <tbody>
              {orden.map((f, i) => {
                const depto = f.empleado.departamento || "Sin departamento";
                const nuevoDepto = i === 0 || (orden[i - 1].empleado.departamento || "Sin departamento") !== depto;
                return (
                  <FilaEmpleado key={f.empleado.id} nuevoDepto={nuevoDepto} depto={depto} colSpan={7}>
                    <td className="cont-nombre">
                      <div className="cont-np">{nombreDe(f.empleado)}</div>
                      <div className="cont-sub">{centroNombre(f.empleado.centro_principal_id)}{f.empleado.fecha_baja ? ` · baja ${ddmm(f.empleado.fecha_baja)}` : ""}</div>
                    </td>
                    <td className="cont-num">{h(f.derecho_anual)}</td>
                    <td className="cont-num">{h(f.devengado_hoy)}</td>
                    <td className="cont-num">{h(f.disfrutados)}</td>
                    <td className="cont-num">{f.pendientes_aprobar ? <span className="cont-pend">{h(f.pendientes_aprobar)}</span> : "0"}</td>
                    <td className={"cont-num cont-resto " + (f.resto < 0 ? "cont-mas" : "")}>{h(f.resto)}</td>
                    <td className="cont-num">
                      {ajusteSaldo(f.empleado) ? <span className={ajusteSaldo(f.empleado) > 0 ? "cont-ajv-mas" : "cont-ajv-menos"}>{signo(ajusteSaldo(f.empleado))}</span> : <span className="cont-vacia">—</span>}
                      {puedeAjustar ? <button className="link-btn2 cont-ajustar" onClick={() => abrirAjuste(f)}>Ajustar</button> : null}
                    </td>
                  </FilaEmpleado>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="cont-nombre"><div className="cont-np">Total</div><div className="cont-sub">{orden.length} personas</div></td>
                <td className="cont-num">{h(tot.d)}</td><td className="cont-num">{h(tot.v)}</td><td className="cont-num">{h(tot.u)}</td><td className="cont-num">{h(tot.p)}</td><td className="cont-num">{h(tot.r)}</td><td />
              </tr>
            </tfoot>
          </table>
          <p className="nota-inf">
            Días naturales. Derecho anual = días del convenio × días de contrato en el año / días del año. Disfrutados = ausencias aprobadas que computan vacaciones (medio día = 0,5), menos el ajuste manual.
            Resto = derecho − disfrutados − pendientes de aprobar. Ajuste manual: + suma días al saldo, − los resta.
            {ctx.esGestor && anio !== anioActual ? ` El ajuste manual solo aplica al año en curso (${anioActual}); aquí se muestra el mismo valor.` : ""}
          </p>
        </div>
      )}

      {ajuste ? (
        <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget && !guardando) setAjuste(null); }}>
          <div className="modal">
            <h2>Ajustar vacaciones</h2>
            <div className="sub">{nombreDe(ajuste.empleado)} · {anio}</div>
            <p className="nota">Resto actual: <b>{h(ajuste.resto)} días</b>. El ajuste sustituye al actual ({signo(ajusteSaldo(ajuste.empleado))}) y solo aplica al año en curso.</p>
            <label>Días que se añaden al saldo (+ suma, − resta)</label>
            <input type="text" inputMode="decimal" placeholder="+2 o −1,5" value={dias} onChange={(e) => setDias(e.target.value.replace("−", "-"))} />
            {(() => {
              const n = Number(dias.replace(",", "."));
              if (!dias.trim() || !Number.isFinite(n)) return null;
              const resto = r2(ajuste.resto + (n - ajusteSaldo(ajuste.empleado)));
              return <div className="cont-resumen-aj">El resto pasará de <b>{h(ajuste.resto)}</b> a <b>{h(resto)} días</b>.</div>;
            })()}
            <label>Motivo</label>
            <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Obligatorio. Se guarda en la nota del empleado." />
            {ajuste.empleado.nota ? <div className="cont-nota-prev"><b>Nota actual:</b><br />{ajuste.empleado.nota}</div> : null}
            {err ? <div className="aviso-modal">{err}</div> : null}
            <div className="modal-acciones">
              <button className="btn btn-fantasma" onClick={() => setAjuste(null)} disabled={guardando}>Cancelar</button>
              <button className="btn btn-primario" onClick={guardarAjuste} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
