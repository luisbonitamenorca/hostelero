"use client";

/* Informes del panel de Reservas (guía §10): rango con atajos, restaurante o «todos», KPIs
   arriba, gráficas en SVG (componentes/grafica.tsx) y las tablas de Cover: tracking completo
   (exportable a CSV para Excel y «Copiar»), personas por turno y día (lo que lee Ratios),
   cancelaciones tardías, no-shows, valoraciones, reservas por usuario, lista de espera y mesas
   bloqueadas. Las agregaciones las hace la base; aquí solo se pinta.
   El tracking se pide por tramos de 7 días (acción trackingTramo) y se va pintando según llega,
   con progreso y botón «Parar»; con rangos de más de 31 días solo se carga al pedirlo. */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as api from "../acciones/informes";
import type { DatosTracking, Estadisticas, FilaBloqueo, FilaComensales, FilaEspera, FilaTracking, RestInfo, TipoFecha } from "../acciones/informes";
import { TIPOS_RESERVA, estadoDe, fmtDiaMes, fmtFecha, fmtHora, guardarPref, leerPref, rangoMes, semanaIso, sumarDias, useRecargaExterna, type SecProps } from "../lib-reservas";
import { ESTADO_PAGO, NOMBRES_DIA, ORIGEN, dowDe, hoyISO } from "../tipos";
import { GraficaBarras, GraficaLineas, type PuntoBarra } from "../componentes/grafica";
import "./informes.css";

/* ==================== Tipos y constantes ==================== */

type Atajo = "hoy" | "semana" | "mes" | "temporada" | "anio" | "personalizado";
type TabInf = "tracking" | "comensales" | "cancelaciones" | "noshows" | "valoraciones" | "usuarios" | "espera" | "bloqueos";
type Carga<T> = { clave: string; estado: "cargando" | "ok" | "error"; data?: T; error?: string };
/** Carga del tracking por tramos: progreso y si se ha parado a medias. */
type CargaTrk = Carga<DatosTracking> & { tramo?: number; tramos?: number; hastaFecha?: string; parada?: boolean };
type Prefs = { atajo?: Atajo; tipoFecha?: TipoFecha; tab?: TabInf; desde?: string; hasta?: string };

const ATAJOS: { id: Atajo; texto: string }[] = [
  { id: "hoy", texto: "Hoy" },
  { id: "semana", texto: "Semana" },
  { id: "mes", texto: "Mes" },
  { id: "temporada", texto: "Temporada" },
  { id: "anio", texto: "Año" },
];

const TABS: { id: TabInf; texto: string }[] = [
  { id: "tracking", texto: "Tracking de reservas" },
  { id: "comensales", texto: "Personas por turno y día" },
  { id: "cancelaciones", texto: "Cancelaciones tardías" },
  { id: "noshows", texto: "No-shows" },
  { id: "valoraciones", texto: "Valoraciones" },
  { id: "usuarios", texto: "Reservas por usuario" },
  { id: "espera", texto: "Lista de espera" },
  { id: "bloqueos", texto: "Mesas bloqueadas" },
];

/** Pestañas que salen del tracking (comparten la misma carga). */
const TABS_TRK: TabInf[] = ["tracking", "cancelaciones", "noshows", "valoraciones"];
/** Días por llamada al tracking y rango máximo que se carga solo al abrir la pestaña. */
const TRAMO_DIAS = 7;
const MAX_DIAS_AUTO = 31;
const TOPE_TRK = 25000;
const ERROR_RED = "No se ha podido cargar. Revisa la conexión y pulsa ↻.";

const TIPO_TEXTO: Record<string, string> = Object.fromEntries(TIPOS_RESERVA.map((t) => [t.id, t.texto]));
/** Estado del pago con el catálogo común (reservas_reservas.estado_pago). */
const pagoTexto = (v: string | null | undefined) => (v ? ESTADO_PAGO[v] ?? v : "");
const ESPERA_TEXTO: Record<string, string> = { esperando: "Esperando", avisado: "Avisado", sentado: "Sentado", convertida: "Convertida", descartado: "Descartado", caducado: "Caducado" };

/** Temporada = de abril a octubre (si estamos antes de abril, la del año anterior). */
function rangoAtajo(a: Atajo, hoy: string): { desde: string; hasta: string } {
  const anio = Number(hoy.slice(0, 4));
  const mes = Number(hoy.slice(5, 7));
  switch (a) {
    case "hoy": return { desde: hoy, hasta: hoy };
    case "semana": { const l = semanaIso(hoy).lunes; return { desde: l, hasta: sumarDias(l, 6) }; }
    case "mes": return rangoMes(hoy);
    case "temporada": { const y = mes < 4 ? anio - 1 : anio; return { desde: `${y}-04-01`, hasta: `${y}-10-31` }; }
    case "anio": return { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
    default: return rangoMes(hoy);
  }
}

/* ==================== Formato ==================== */

const n = (v: number | null | undefined, dec = 0) => (v == null ? "—" : v.toLocaleString("es-ES", { maximumFractionDigits: dec }));
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`);
const fmtTs = (ts: string | null | undefined) => {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return `${fmtFecha(d.toLocaleDateString("sv-SE"))} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const siNo = (v: boolean | null | undefined) => (v == null ? "" : v ? "Sí" : "No");
const antelacion = (h: number | null | undefined) => (h == null ? "—" : h >= 48 ? `${n(h / 24, 1)} días` : `${n(h, 1)} h`);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);

/** Parte [desde, hasta] en tramos de `n` días. */
function trozos(desde: string, hasta: string, n: number): { desde: string; hasta: string }[] {
  const out: { desde: string; hasta: string }[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, n)) {
    const h = sumarDias(d, n - 1);
    out.push({ desde: d, hasta: h < hasta ? h : hasta });
  }
  return out;
}

/* Instante de una reserva en la zona del restaurante (no en la del navegador), como hace el RPC.
   Hoy todos los locales están en Europe/Madrid, pero se respeta zona_horaria por si cambia. */
const fmtZona = new Map<string, Intl.DateTimeFormat>();
function desfase(fecha: string, hora: string, tz: string): string {
  try {
    let f = fmtZona.get(tz);
    if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }); fmtZona.set(tz, f); }
    const nombre = f.formatToParts(new Date(`${fecha}T${hora}:00Z`)).find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
    const m = /GMT([+-]\d+)(?::(\d+))?/.exec(nombre);
    const h = m ? parseInt(m[1], 10) : 0;
    return `${h < 0 ? "-" : "+"}${String(Math.abs(h)).padStart(2, "0")}:${m?.[2] ?? "00"}`;
  } catch {
    return "+01:00";
  }
}
const instanteReserva = (fecha: string, hora: string | null, tz: string) => {
  const h = fmtHora(hora) || "00:00";
  return Date.parse(`${fecha}T${h}:00${desfase(fecha, h, tz)}`);
};

/* ==================== CSV / portapapeles ==================== */

type Col<T> = {
  id: string;
  titulo: string;
  /** Valor crudo: número (se formatea) o texto. Es lo que va al CSV. */
  valor: (f: T) => string | number | null | undefined;
  num?: boolean;
  /** Texto largo (comentarios): la celda parte líneas en vez de cortarse. */
  largo?: boolean;
  /** Cómo pintarlo en la tabla si no basta con el valor. */
  render?: (f: T) => ReactNode;
};

/* Inyección de fórmulas: nombre, notas, empresa o comentarios llegan del widget público. Un texto
   que empiece por = + - @ tabulador o retorno se ejecutaría como fórmula al abrir el CSV o pegar en
   Excel/Sheets: se le antepone un apóstrofo, que además deja los teléfonos «+34…» como texto.
   Lo mismo con los códigos numéricos con ceros a la izquierda o muy largos (localizadores). */
const seguro = (s: string) => (/^[=+\-@\t\r]/.test(s) || /^0\d+$/.test(s) || /^\d{16,}$/.test(s) ? "'" + s : s);
const csvCelda = (v: string | number | null | undefined) => {
  if (v == null) return "";
  if (typeof v === "number") return String(v).replace(".", ",");
  const t = seguro(v);
  return /[;"\n\r']/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const tsvCelda = (v: string | number | null | undefined) => (v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : seguro(v.replace(/[\t\r\n]+/g, " ")));

function aCsv<T>(cols: Col<T>[], filas: T[]): string {
  const lineas = [cols.map((c) => csvCelda(c.titulo)).join(";")];
  for (const f of filas) lineas.push(cols.map((c) => csvCelda(c.valor(f))).join(";"));
  return "﻿" + lineas.join("\r\n");
}
function aTsv<T>(cols: Col<T>[], filas: T[]): string {
  const lineas = [cols.map((c) => tsvCelda(c.titulo)).join("\t")];
  for (const f of filas) lineas.push(cols.map((c) => tsvCelda(c.valor(f))).join("\t"));
  return lineas.join("\r\n");
}
function descargar(nombre: string, contenido: string) {
  const blob = new Blob([contenido], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ==================== Tabla genérica ==================== */

const LOTE = 200;

function TablaInforme<T>(props: {
  cols: Col<T>[];
  filas: T[];
  /** Nombre base del fichero exportado (sin extensión). */
  nombre: string;
  idDe: (f: T, i: number) => string;
  avisar: (m: string) => void;
  vacio?: string;
  pie?: ReactNode;
  /** Controles propios de la tabla, a la izquierda de los botones. */
  herramientas?: ReactNode;
  nota?: ReactNode;
  /** Nombre de la hoja del Excel. */
  hoja?: string;
}) {
  const { cols, filas, nombre, idDe, avisar, vacio, pie, herramientas, nota, hoja } = props;
  const [generando, setGenerando] = useState(false);
  const [visibles, setVisibles] = useState(LOTE);
  useEffect(() => { setVisibles(LOTE); }, [filas]);

  const exportar = () => {
    descargar(`${nombre}.csv`, aCsv(cols, filas));
    avisar(`CSV con ${n(filas.length)} filas. Ábrelo con Excel (separador «;»).`);
  };
  /* Excel de verdad: la librería se carga solo al pulsar (no va en el paquete inicial). Los
     números van como número y el texto como texto (sin fórmulas), fechas ya en dd/mm/aaaa. */
  const exportarExcel = async () => {
    setGenerando(true);
    try {
      const XLSX = await import("xlsx");
      const aoa = [cols.map((c) => c.titulo), ...filas.map((f) => cols.map((c) => c.valor(f) ?? ""))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = cols.map((c) => ({ wch: c.largo ? 50 : Math.min(32, Math.max(9, c.titulo.length + 2)) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, (hoja || "Datos").replace(/[:\\/?*[\]]/g, " ").slice(0, 31));
      XLSX.writeFile(wb, `${nombre}.xlsx`);
      avisar(`Excel con ${n(filas.length)} filas.`);
    } catch {
      avisar("No se ha podido generar el Excel.");
    } finally {
      setGenerando(false);
    }
  };
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(aTsv(cols, filas));
      avisar(`Copiadas ${n(filas.length)} filas. Pégalas en Excel o en Sheets.`);
    } catch {
      avisar("No se ha podido copiar al portapapeles.");
    }
  };

  return (
    <div className="inf-tabla-bloque">
      <div className="inf-tabla-herr">
        <span className="inf-cuenta">{n(filas.length)} {filas.length === 1 ? "fila" : "filas"}{cols.length > 12 ? ` · ${cols.length} columnas` : ""}</span>
        {herramientas}
        <span className="inf-espacio" />
        <button className="inf-btn" onClick={copiar} disabled={!filas.length}>Copiar</button>
        <button className="inf-btn" onClick={exportar} disabled={!filas.length}>Exportar CSV</button>
        <button className="inf-btn primario" onClick={exportarExcel} disabled={!filas.length || generando}>{generando ? "Generando…" : "Exportar Excel"}</button>
      </div>
      {nota ? <div className="inf-nota">{nota}</div> : null}
      {!filas.length ? (
        <div className="vacio">{vacio ?? "Sin datos en el periodo."}</div>
      ) : (
        <div className="inf-tabla-env">
          <table className="inf-tabla">
            <thead>
              <tr>{cols.map((c) => <th key={c.id} className={c.num ? "num" : ""}>{c.titulo}</th>)}</tr>
            </thead>
            <tbody>
              {filas.slice(0, visibles).map((f, i) => (
                <tr key={idDe(f, i)}>
                  {cols.map((c) => {
                    const v = c.valor(f);
                    return <td key={c.id} className={c.num ? "num" : c.largo ? "largo" : ""}>{c.render ? c.render(f) : typeof v === "number" ? n(v, 2) : (v ?? "")}</td>;
                  })}
                </tr>
              ))}
            </tbody>
            {pie ? <tfoot>{pie}</tfoot> : null}
          </table>
        </div>
      )}
      {filas.length > visibles ? (
        <button className="inf-btn inf-mas" onClick={() => setVisibles((v) => v + LOTE)}>
          Mostrar {n(Math.min(LOTE, filas.length - visibles))} más ({n(filas.length - visibles)} restantes)
        </button>
      ) : null}
    </div>
  );
}

/* ==================== Columnas del tracking (52) ==================== */

const ChipEstado = ({ estado }: { estado: string | null }) => {
  if (!estado) return null;
  const e = estadoDe(estado);
  return <span className="inf-chip" style={{ background: e.color, color: e.id === "tarjeta_pendiente" ? "#1a1a1a" : "#fff", border: e.borde ? `1px solid ${e.borde}` : undefined }}>{e.texto}</span>;
};

const COLS_TRACKING: Col<FilaTracking>[] = [
  { id: "localizador", titulo: "Localizador", valor: (f) => f.localizador },
  { id: "restaurante", titulo: "Restaurante", valor: (f) => f.restaurante },
  { id: "fecha", titulo: "Fecha", valor: (f) => (f.fecha ? fmtFecha(f.fecha) : "") },
  { id: "dia", titulo: "Día", valor: (f) => (f.fecha ? NOMBRES_DIA[dowDe(f.fecha) - 1] : "") },
  { id: "hora", titulo: "Hora", valor: (f) => fmtHora(f.hora) },
  { id: "duracion", titulo: "Duración (min)", valor: (f) => f.duracion_min, num: true },
  { id: "pax", titulo: "Pax", valor: (f) => f.pax, num: true },
  { id: "pax_llegados", titulo: "Pax llegados", valor: (f) => f.pax_llegados, num: true },
  { id: "estado", titulo: "Estado", valor: (f) => (f.estado ? estadoDe(f.estado).texto : ""), render: (f) => <ChipEstado estado={f.estado} /> },
  { id: "tipo", titulo: "Tipo", valor: (f) => (f.tipo ? TIPO_TEXTO[f.tipo] ?? f.tipo : "") },
  { id: "estado_pago", titulo: "Estado del pago", valor: (f) => pagoTexto(f.estado_pago) },
  { id: "garantia", titulo: "Importe garantía", valor: (f) => f.importe_garantia, num: true },
  { id: "prepago", titulo: "Importe prepago", valor: (f) => f.importe_prepago, num: true },
  { id: "origen", titulo: "Origen", valor: (f) => (f.origen ? ORIGEN[f.origen] ?? f.origen : "") },
  { id: "canal", titulo: "Canal", valor: (f) => f.canal },
  { id: "nombre", titulo: "Nombre", valor: (f) => f.cliente_nombre },
  { id: "apellidos", titulo: "Apellidos", valor: (f) => f.cliente_apellidos },
  { id: "telefono", titulo: "Teléfono", valor: (f) => f.telefono },
  { id: "email", titulo: "Email", valor: (f) => f.email },
  { id: "idioma", titulo: "Idioma", valor: (f) => f.idioma },
  { id: "pais", titulo: "País", valor: (f) => f.pais },
  { id: "zona", titulo: "Zona", valor: (f) => f.zona },
  { id: "mesas", titulo: "Mesas", valor: (f) => f.mesas },
  { id: "camarero", titulo: "Camarero", valor: (f) => f.camarero },
  { id: "prescriptor", titulo: "Prescriptor", valor: (f) => f.prescriptor },
  { id: "empresa", titulo: "Empresa", valor: (f) => f.empresa },
  { id: "referencia", titulo: "Referencia", valor: (f) => f.referencia },
  { id: "etiquetas", titulo: "Etiquetas", valor: (f) => f.etiquetas },
  { id: "alergias", titulo: "Alergias", valor: (f) => f.alergias },
  { id: "notas_cliente", titulo: "Notas del cliente", valor: (f) => f.notas_cliente },
  { id: "notas_internas", titulo: "Notas internas", valor: (f) => f.notas_internas },
  { id: "anotado_por", titulo: "Anotado por", valor: (f) => f.anotado_por },
  { id: "experiencia", titulo: "Experiencia", valor: (f) => f.experiencia },
  { id: "codigo_promo", titulo: "Código promo", valor: (f) => f.codigo_promo },
  { id: "consentimiento", titulo: "Consentimiento comercial", valor: (f) => siNo(f.consentimiento_marketing) },
  { id: "creado_en", titulo: "Anotada el", valor: (f) => fmtTs(f.creado_en) },
  { id: "actualizado_en", titulo: "Última modificación", valor: (f) => fmtTs(f.actualizado_en) },
  { id: "llegada_en", titulo: "Llegada", valor: (f) => fmtTs(f.llegada_en) },
  { id: "sentada_en", titulo: "Sentada", valor: (f) => fmtTs(f.sentada_en) },
  { id: "salida_en", titulo: "Salida", valor: (f) => fmtTs(f.salida_en) },
  { id: "reconfirmada_en", titulo: "Reconfirmada", valor: (f) => fmtTs(f.reconfirmada_en) },
  { id: "cancelada_en", titulo: "Cancelada el", valor: (f) => fmtTs(f.cancelada_en) },
  { id: "cancelada_por", titulo: "Cancelada por", valor: (f) => (f.cancelada_por === "cliente" ? "Cliente" : f.cancelada_por === "restaurante" ? "Restaurante" : f.cancelada_por) },
  { id: "motivo", titulo: "Motivo de cancelación", valor: (f) => f.motivo_cancelacion },
  { id: "valoracion", titulo: "Valoración", valor: (f) => f.valoracion, num: true },
  { id: "valoracion_comentario", titulo: "Comentario de la valoración", valor: (f) => f.valoracion_comentario },
  { id: "recordatorio", titulo: "Recordatorio enviado", valor: (f) => fmtTs(f.recordatorio_enviado_en) },
  { id: "mensajes", titulo: "Mensajes enviados", valor: (f) => f.mensajes_enviados, num: true },
  { id: "riesgo", titulo: "Riesgo no-show", valor: (f) => (f.riesgo_no_show == null ? null : Math.round(f.riesgo_no_show * 100) / 100), num: true },
  { id: "cliente_id", titulo: "ID cliente", valor: (f) => f.cliente_id },
  { id: "cover_id", titulo: "ID Cover", valor: (f) => f.cover_id },
  { id: "reserva_id", titulo: "ID reserva", valor: (f) => f.reserva_id },
];

/* ==================== Sección ==================== */

export default function SecInformes({ ctx, rest, avisar }: SecProps) {
  const hoy = hoyISO();
  const [listo, setListo] = useState(false);
  const [restSel, setRestSel] = useState<string>(rest.id); // "" = todos
  const [atajo, setAtajo] = useState<Atajo>("mes");
  const [rango, setRango] = useState(() => rangoAtajo("mes", hoy));
  const [tipoFecha, setTipoFecha] = useState<TipoFecha>("reserva");
  const [tab, setTab] = useState<TabInf>("tracking");
  const [canalOrigen, setCanalOrigen] = useState<"canal" | "origen">("canal");
  const [filtroTracking, setFiltroTracking] = useState("");
  /** Umbral de cancelación tardía escrito a mano (solo cuenta si horasTocadas). */
  const [horasX, setHorasX] = useState<number>(24);
  const [horasTocadas, setHorasTocadas] = useState(false);
  const [recargaN, setRecargaN] = useState(0);
  /** Clave del tracking que el usuario ha pedido cargar a mano (rangos de más de 31 días). */
  const [trkPedido, setTrkPedido] = useState<string | null>(null);

  const [est, setEst] = useState<Carga<Estadisticas> | null>(null);
  const [trk, setTrk] = useState<CargaTrk | null>(null);
  const [com, setCom] = useState<Carga<{ filas: FilaComensales[]; truncado: boolean }> | null>(null);
  const [ext, setExt] = useState<Carga<{ espera: FilaEspera[]; bloqueos: FilaBloqueo[] }> | null>(null);

  /* Clave de la carga en curso de cada tabla. La respuesta solo se aplica si sigue siendo la pedida:
     cambiar de pestaña NO la descarta (antes se quedaba el spinner girando para siempre). */
  const pedidoTrk = useRef<string | null>(null);
  const pedidoCom = useRef<string | null>(null);
  const pedidoExt = useRef<string | null>(null);
  useEffect(() => () => { pedidoTrk.current = null; pedidoCom.current = null; pedidoExt.current = null; }, []);

  /* Preferencias (rango, tipo de fecha, pestaña) se leen tras montar: sin saltos de hidratación. */
  useEffect(() => {
    const p = leerPref<Prefs>("informes", {});
    if (p.atajo && (ATAJOS.some((a) => a.id === p.atajo) || p.atajo === "personalizado")) {
      setAtajo(p.atajo);
      if (p.atajo === "personalizado" && p.desde && p.hasta) setRango({ desde: p.desde, hasta: p.hasta });
      else if (p.atajo !== "personalizado") setRango(rangoAtajo(p.atajo, hoy));
    }
    if (p.tipoFecha === "anotacion" || p.tipoFecha === "reserva") setTipoFecha(p.tipoFecha);
    if (p.tab && TABS.some((t) => t.id === p.tab)) setTab(p.tab);
    setListo(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!listo) return;
    guardarPref("informes", { atajo, tipoFecha, tab, desde: rango.desde, hasta: rango.hasta } satisfies Prefs);
  }, [listo, atajo, tipoFecha, tab, rango]);

  const recargar = useCallback(() => setRecargaN((x) => x + 1), []);
  useRecargaExterna(recargar);

  const rangoInvalido = rango.hasta < rango.desde ? "La fecha final es anterior a la inicial." : null;
  const clave = `${restSel}|${rango.desde}|${rango.hasta}|${recargaN}`;
  const claveTrk = `${clave}|${tipoFecha}`;
  const restActual = restSel ? ctx.restaurantes.find((r) => r.id === restSel) : null;
  const nombreRest = restActual?.nombre ?? "Todos los restaurantes";
  const diasRango = rangoInvalido ? 0 : diasEntre(rango.desde, rango.hasta) + 1;
  const trkAuto = diasRango <= MAX_DIAS_AUTO || trkPedido === claveTrk;

  /* ---- cargas: estadísticas siempre; el resto cuando se abre su pestaña (con caché por clave) ---- */
  useEffect(() => {
    if (!listo || rangoInvalido) return;
    let vivo = true;
    // Se conservan los datos anteriores (atenuados) mientras llegan los nuevos.
    setEst((prev) => ({ clave, estado: "cargando", data: prev?.data }));
    api.estadisticas(restSel || null, rango.desde, rango.hasta).then(
      (r) => { if (vivo) setEst(r.ok ? { clave, estado: "ok", data: r.data } : { clave, estado: "error", error: r.error }); },
      () => { if (vivo) setEst({ clave, estado: "error", error: ERROR_RED }); },
    );
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, clave, rangoInvalido]);

  /** Carga el tracking tramo a tramo, añadiendo filas según llegan. */
  const cargarTracking = (k: string) => {
    pedidoTrk.current = k;
    const tramos = trozos(rango.desde, rango.hasta, TRAMO_DIAS);
    const restId = restSel || null;
    const tf = tipoFecha;
    setTrk({ clave: k, estado: "cargando", data: { filas: [], truncado: false, restaurantes: [] }, tramo: 0, tramos: tramos.length });
    void (async () => {
      let filas: FilaTracking[] = [];
      let restaurantes: RestInfo[] = [];
      for (let i = 0; i < tramos.length; i++) {
        let r: Awaited<ReturnType<typeof api.trackingTramo>>;
        try {
          r = await api.trackingTramo(restId, tramos[i].desde, tramos[i].hasta, tf);
        } catch {
          r = { ok: false, error: ERROR_RED };
        }
        if (pedidoTrk.current !== k) return; // parada, otro rango o pantalla cerrada
        if (!r.ok) {
          pedidoTrk.current = null;
          setTrk({ clave: k, estado: "error", error: r.error });
          return;
        }
        const { columnas } = r.data;
        const nuevas = r.data.filas.map((v) => {
          const o: Record<string, unknown> = {};
          columnas.forEach((c, j) => { o[c] = v[j]; });
          return o as FilaTracking;
        });
        filas = filas.concat(nuevas);
        if (!restaurantes.length) restaurantes = r.data.restaurantes;
        let truncado = r.data.truncado;
        if (filas.length >= TOPE_TRK) { filas = filas.slice(0, TOPE_TRK); truncado = true; }
        const fin = truncado || i === tramos.length - 1;
        const data: DatosTracking = { filas, truncado, restaurantes };
        if (fin) pedidoTrk.current = null;
        setTrk(fin
          ? { clave: k, estado: "ok", data }
          : { clave: k, estado: "cargando", data, tramo: i + 1, tramos: tramos.length, hastaFecha: tramos[i].hasta });
        if (fin) return;
      }
    })();
  };
  const pararTracking = () => {
    pedidoTrk.current = null;
    setTrk((t) => (t && t.estado === "cargando" ? { ...t, estado: "ok", parada: true } : t));
  };

  useEffect(() => {
    if (!listo || rangoInvalido || !TABS_TRK.includes(tab) || !trkAuto) return;
    if (trk?.clave === claveTrk && (trk.estado === "ok" || (trk.estado === "cargando" && pedidoTrk.current === claveTrk))) return;
    cargarTracking(claveTrk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, tab, claveTrk, rangoInvalido, trkAuto]);

  useEffect(() => {
    if (!listo || rangoInvalido || tab !== "comensales") return;
    if (com?.clave === clave && (com.estado === "ok" || (com.estado === "cargando" && pedidoCom.current === clave))) return;
    const k = clave;
    pedidoCom.current = k;
    setCom({ clave: k, estado: "cargando" });
    api.comensales(restSel || null, rango.desde, rango.hasta).then(
      (r) => { if (pedidoCom.current === k) setCom(r.ok ? { clave: k, estado: "ok", data: r.data } : { clave: k, estado: "error", error: r.error }); },
      () => { if (pedidoCom.current === k) setCom({ clave: k, estado: "error", error: ERROR_RED }); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, tab, clave, rangoInvalido]);

  useEffect(() => {
    if (!listo || rangoInvalido || (tab !== "espera" && tab !== "bloqueos")) return;
    if (ext?.clave === clave && (ext.estado === "ok" || (ext.estado === "cargando" && pedidoExt.current === clave))) return;
    const k = clave;
    pedidoExt.current = k;
    setExt({ clave: k, estado: "cargando" });
    api.esperaYBloqueos(restSel || null, rango.desde, rango.hasta).then(
      (r) => { if (pedidoExt.current === k) setExt(r.ok ? { clave: k, estado: "ok", data: r.data } : { clave: k, estado: "error", error: r.error }); },
      () => { if (pedidoExt.current === k) setExt({ clave: k, estado: "error", error: ERROR_RED }); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, tab, clave, rangoInvalido]);

  /* Umbral de cancelación tardía: el escrito a mano; si no, la política del restaurante elegido;
     con «todos», null = la política de cada local fila a fila (como el KPI del RPC). */
  const horasFijas: number | null = horasTocadas ? horasX : restActual ? restActual.politica_cancelacion_horas ?? 24 : null;

  /* ---- controles ---- */
  const elegirAtajo = (a: Atajo) => {
    setAtajo(a);
    if (a !== "personalizado") setRango(rangoAtajo(a, hoy));
  };
  const cambiarFecha = (campo: "desde" | "hasta", v: string) => {
    if (!v) return;
    setAtajo("personalizado");
    setRango((r) => ({ ...r, [campo]: v }));
  };

  const datos = est?.data ?? null;

  /* ---- derivados para gráficas (sobre lo que ya viene agregado de la base) ---- */
  const porDow = useMemo<PuntoBarra[]>(() => {
    const acc = Array.from({ length: 7 }, () => ({ pax: 0, reservas: 0, dias: 0 }));
    for (const d of datos?.por_dia ?? []) {
      const i = dowDe(d.fecha) - 1;
      acc[i].pax += d.pax;
      acc[i].reservas += d.reservas;
      acc[i].dias++;
    }
    return acc.map((a, i) => ({ etiqueta: NOMBRES_DIA[i].slice(0, 3), valor: a.pax, detalle: `${n(a.reservas)} reservas · ${a.dias ? n(a.pax / a.dias, 1) : "0"} pax/día` }));
  }, [datos]);

  /* Por día: el RPC solo trae días con reservas. Se rellena el rango entero para que un día sin
     reservas o un cierre no desaparezca del eje: 0 hasta hoy, hueco (null) en días futuros. */
  const serieDia = useMemo(() => {
    const etiquetas: string[] = [];
    const pax: (number | null)[] = [];
    const reservas: (number | null)[] = [];
    if (!datos || !datos.desde || !datos.hasta) return { etiquetas, pax, reservas };
    const m = new Map(datos.por_dia.map((d) => [d.fecha, d]));
    for (let f = datos.desde, i = 0; f <= datos.hasta && i < 400; f = sumarDias(f, 1), i++) {
      const d = m.get(f);
      const sinDato = f <= hoy ? 0 : null;
      etiquetas.push(fmtDiaMes(f));
      pax.push(d ? d.pax : sinDato);
      reservas.push(d ? d.reservas : sinDato);
    }
    return { etiquetas, pax, reservas };
  }, [datos, hoy]);

  const porHora = useMemo<PuntoBarra[]>(
    () => [...(datos?.por_hora ?? [])].sort((a, b) => a.hora.localeCompare(b.hora)).map((h) => ({ etiqueta: h.hora, valor: h.reservas, detalle: `${n(h.pax)} pax` })),
    [datos],
  );

  const porCanal = useMemo<PuntoBarra[]>(() => {
    if (!datos) return [];
    const tot = datos.totales.reservas || 1;
    if (canalOrigen === "origen") {
      return datos.origenes.map((o) => ({ etiqueta: ORIGEN[o.origen] ?? o.origen, valor: o.reservas, detalle: `${n(o.pax)} pax · ${n((100 * o.reservas) / tot)} %` }));
    }
    return datos.canales.map((c) => ({
      etiqueta: c.canal ? ORIGEN[c.canal] ?? c.canal : "Sin canal",
      valor: c.reservas,
      detalle: `${n(c.pax)} pax · ${n((100 * c.reservas) / tot)} %${c.no_shows ? ` · ${n(c.no_shows)} no-show` : ""}`,
    }));
  }, [datos, canalOrigen]);

  const porPrescriptor = useMemo<PuntoBarra[]>(
    () => (datos?.prescriptores ?? []).map((p) => ({ etiqueta: p.prescriptor + (p.tipo ? ` (${p.tipo})` : ""), valor: p.reservas, detalle: `${n(p.pax)} pax` })),
    [datos],
  );

  const porEstado = useMemo<PuntoBarra[]>(() => {
    const orden = (id: string) => estadoDe(id).orden;
    return [...(datos?.por_estado ?? [])]
      .sort((a, b) => orden(a.estado) - orden(b.estado))
      .map((e) => {
        const def = estadoDe(e.estado);
        return { etiqueta: def.texto, valor: e.reservas, color: def.id === "tarjeta_pendiente" ? "#c9ced4" : def.color, detalle: `${n(e.pax)} pax` };
      });
  }, [datos]);

  const porSemana = useMemo<PuntoBarra[]>(
    () => (datos?.por_semana ?? []).map((s) => ({ etiqueta: `S${semanaIso(s.semana).semana}`, valor: s.ocupacion_pct ?? 0, detalle: `${n(s.reservas)} reservas · ${n(s.pax)} pax` })),
    [datos],
  );

  /* ---- tablas derivadas del tracking ---- */
  const trkActual = trk?.clave === claveTrk ? trk : null;
  const filasTrk = trkActual?.data?.filas;
  const filasTracking = useMemo(() => {
    const todas = filasTrk ?? [];
    const q = filtroTracking.trim().toLowerCase();
    if (!q) return todas;
    const dig = q.replace(/\D/g, "");
    return todas.filter((f) =>
      [f.cliente_nombre, f.cliente_apellidos, f.localizador, f.email, f.empresa, f.prescriptor, f.mesas, f.canal]
        .some((v) => v && v.toLowerCase().includes(q)) || (dig && f.telefono && f.telefono.replace(/\D/g, "").includes(dig)),
    );
  }, [filasTrk, filtroTracking]);

  /** Restaurantes por nombre (la fila del tracking trae el nombre, no el id). */
  const infoRest = useMemo(() => {
    const m = new Map<string, RestInfo>();
    for (const r of trkActual?.data?.restaurantes ?? []) m.set(r.nombre, r);
    return m;
  }, [trkActual?.data?.restaurantes]);

  type FilaCancel = FilaTracking & { horas_antes: number; umbral: number };
  const cancelaciones = useMemo<FilaCancel[]>(() => {
    const out: FilaCancel[] = [];
    for (const f of filasTrk ?? []) {
      if (f.estado !== "cancelada" || !f.cancelada_en || !f.fecha) continue;
      const info = f.restaurante ? infoRest.get(f.restaurante) : undefined;
      const umbral = horasFijas ?? info?.politica_cancelacion_horas ?? 24;
      const horas = (instanteReserva(f.fecha, f.hora, info?.zona_horaria || "Europe/Madrid") - new Date(f.cancelada_en).getTime()) / 3600000;
      if (horas < umbral) out.push({ ...f, horas_antes: Math.round(horas * 10) / 10, umbral });
    }
    return out.sort((a, b) => a.horas_antes - b.horas_antes);
  }, [filasTrk, horasFijas, infoRest]);

  const colsCancel = useMemo<Col<FilaCancel>[]>(() => [
    { id: "fecha", titulo: "Fecha", valor: (f) => (f.fecha ? fmtFecha(f.fecha) : "") },
    { id: "hora", titulo: "Hora", valor: (f) => fmtHora(f.hora) },
    { id: "restaurante", titulo: "Restaurante", valor: (f) => f.restaurante },
    { id: "cliente", titulo: "Cliente", valor: (f) => [f.cliente_nombre, f.cliente_apellidos].filter(Boolean).join(" ") },
    { id: "pax", titulo: "Pax", valor: (f) => f.pax, num: true },
    { id: "telefono", titulo: "Teléfono", valor: (f) => f.telefono },
    { id: "cancelada_en", titulo: "Cancelada el", valor: (f) => fmtTs(f.cancelada_en) },
    { id: "horas", titulo: "Horas antes", valor: (f) => f.horas_antes, num: true, render: (f) => <span className={f.horas_antes < 0 ? "inf-mal" : ""}>{f.horas_antes < 0 ? `${n(-f.horas_antes, 1)} h después` : `${n(f.horas_antes, 1)} h`}</span> },
    { id: "por", titulo: "Cancelada por", valor: (f) => (f.cancelada_por === "cliente" ? "Cliente" : f.cancelada_por === "restaurante" ? "Restaurante" : f.cancelada_por) },
    { id: "motivo", titulo: "Motivo", valor: (f) => f.motivo_cancelacion },
    { id: "tipo", titulo: "Tipo", valor: (f) => (f.tipo ? TIPO_TEXTO[f.tipo] ?? f.tipo : "") },
    { id: "politica", titulo: "Política (h)", valor: (f) => f.umbral, num: true },
    { id: "pago", titulo: "Estado del pago", valor: (f) => pagoTexto(f.estado_pago) },
    { id: "garantia", titulo: "Importe garantía", valor: (f) => f.importe_garantia, num: true },
    { id: "canal", titulo: "Canal", valor: (f) => f.canal ?? (f.origen ? ORIGEN[f.origen] ?? f.origen : "") },
  ], []);

  /* ---- no-shows: quién, cuándo y si se cobró la garantía ---- */
  type FilaNoShow = FilaTracking & { ns_cliente: number | null };
  const noShows = useMemo<FilaNoShow[]>(() => {
    const filas = (filasTrk ?? []).filter((f) => f.estado === "no_show");
    const porCliente = new Map<string, number>();
    for (const f of filas) if (f.cliente_id) porCliente.set(f.cliente_id, (porCliente.get(f.cliente_id) ?? 0) + 1);
    return filas.map((f) => ({ ...f, ns_cliente: f.cliente_id ? porCliente.get(f.cliente_id) ?? null : null }));
  }, [filasTrk]);
  const resumenNoShows = useMemo(() => {
    const cobradas = noShows.filter((f) => f.estado_pago === "cobrado_noshow");
    return {
      pax: noShows.reduce((a, f) => a + (f.pax ?? 0), 0),
      cobradas: cobradas.length,
      importe: cobradas.reduce((a, f) => a + (f.importe_garantia ?? 0), 0),
    };
  }, [noShows]);
  const colsNoShows = useMemo<Col<FilaNoShow>[]>(() => [
    { id: "fecha", titulo: "Fecha", valor: (f) => (f.fecha ? fmtFecha(f.fecha) : "") },
    { id: "dia", titulo: "Día", valor: (f) => (f.fecha ? NOMBRES_DIA[dowDe(f.fecha) - 1] : "") },
    { id: "hora", titulo: "Hora", valor: (f) => fmtHora(f.hora) },
    { id: "restaurante", titulo: "Restaurante", valor: (f) => f.restaurante },
    { id: "cliente", titulo: "Cliente", valor: (f) => [f.cliente_nombre, f.cliente_apellidos].filter(Boolean).join(" ") },
    { id: "telefono", titulo: "Teléfono", valor: (f) => f.telefono },
    { id: "pax", titulo: "Pax", valor: (f) => f.pax, num: true },
    { id: "tipo", titulo: "Tipo", valor: (f) => (f.tipo ? TIPO_TEXTO[f.tipo] ?? f.tipo : "") },
    { id: "pago", titulo: "Estado del pago", valor: (f) => pagoTexto(f.estado_pago) },
    { id: "garantia", titulo: "Importe garantía", valor: (f) => f.importe_garantia, num: true },
    { id: "cobrada", titulo: "Garantía cobrada", valor: (f) => siNo(f.estado_pago === "cobrado_noshow"),
      render: (f) => (f.estado_pago === "cobrado_noshow" ? <b>Sí</b> : <span className="mudo">No</span>) },
    { id: "ns_cliente", titulo: "No-shows del cliente (periodo)", valor: (f) => f.ns_cliente, num: true,
      render: (f) => (f.ns_cliente == null ? "" : <span className={f.ns_cliente > 1 ? "inf-mal" : ""}>{n(f.ns_cliente)}</span>) },
    { id: "riesgo", titulo: "Riesgo no-show", valor: (f) => (f.riesgo_no_show == null ? null : Math.round(f.riesgo_no_show * 100) / 100), num: true },
    { id: "canal", titulo: "Canal", valor: (f) => f.canal ?? (f.origen ? ORIGEN[f.origen] ?? f.origen : "") },
    { id: "localizador", titulo: "Localizador", valor: (f) => f.localizador },
  ], []);

  /* ---- valoraciones: nota y comentario ---- */
  const valoraciones = useMemo(() => (filasTrk ?? []).filter((f) => f.valoracion != null), [filasTrk]);
  const mediaValoracion = useMemo(
    () => (valoraciones.length ? valoraciones.reduce((a, f) => a + (f.valoracion ?? 0), 0) / valoraciones.length : null),
    [valoraciones],
  );
  const colsValoraciones = useMemo<Col<FilaTracking>[]>(() => [
    { id: "fecha", titulo: "Fecha", valor: (f) => (f.fecha ? fmtFecha(f.fecha) : "") },
    { id: "hora", titulo: "Hora", valor: (f) => fmtHora(f.hora) },
    { id: "restaurante", titulo: "Restaurante", valor: (f) => f.restaurante },
    { id: "cliente", titulo: "Cliente", valor: (f) => [f.cliente_nombre, f.cliente_apellidos].filter(Boolean).join(" ") },
    { id: "pax", titulo: "Pax", valor: (f) => f.pax, num: true },
    { id: "nota", titulo: "Nota (1-5)", valor: (f) => f.valoracion, num: true,
      render: (f) => <span className={"inf-estrellas" + ((f.valoracion ?? 0) <= 2 ? " inf-mal" : "")}>{"★".repeat(f.valoracion ?? 0)}<i>{"★".repeat(Math.max(0, 5 - (f.valoracion ?? 0)))}</i></span> },
    { id: "comentario", titulo: "Comentario", valor: (f) => f.valoracion_comentario, largo: true },
    { id: "email", titulo: "Email", valor: (f) => f.email },
    { id: "localizador", titulo: "Localizador", valor: (f) => f.localizador },
  ], []);

  /* ---- usuarios ---- */
  type FilaUsuario = Estadisticas["usuarios"][number] & { pct: number };
  const usuarios = useMemo<FilaUsuario[]>(() => {
    const lista = datos?.usuarios ?? [];
    const tot = lista.reduce((a, u) => a + u.reservas, 0) || 1;
    return lista.map((u) => ({ ...u, pct: Math.round((1000 * u.reservas) / tot) / 10 }));
  }, [datos]);
  const colsUsuarios = useMemo<Col<FilaUsuario>[]>(() => [
    { id: "usuario", titulo: "Usuario", valor: (f) => f.usuario },
    { id: "reservas", titulo: "Reservas", valor: (f) => f.reservas, num: true },
    { id: "pax", titulo: "Pax", valor: (f) => f.pax, num: true },
    { id: "pct", titulo: "% reservas", valor: (f) => f.pct, num: true, render: (f) => pct(f.pct) },
    { id: "media", titulo: "Pax medio", valor: (f) => (f.reservas ? Math.round((10 * f.pax) / f.reservas) / 10 : 0), num: true },
  ], []);

  /* ---- comensales ---- */
  const colsComensales = useMemo<Col<FilaComensales>[]>(() => [
    { id: "fecha", titulo: "Fecha", valor: (f) => (f.fecha ? fmtFecha(f.fecha) : "") },
    { id: "dia", titulo: "Día", valor: (f) => (f.dia_semana ? NOMBRES_DIA[f.dia_semana - 1] : "") },
    { id: "semana", titulo: "Semana", valor: (f) => f.semana, num: true, render: (f) => (f.semana == null ? "" : `S${f.semana}`) },
    { id: "centro", titulo: "Centro", valor: (f) => f.centro },
    { id: "servicio", titulo: "Servicio", valor: (f) => f.servicio },
    { id: "comensales", titulo: "Comensales", valor: (f) => f.comensales, num: true },
    { id: "capacidad", titulo: "Capacidad", valor: (f) => f.capacidad, num: true },
    { id: "ocup", titulo: "Ocupación", valor: (f) => (f.capacidad ? Math.round((1000 * (f.comensales ?? 0)) / f.capacidad) / 10 : null), num: true,
      render: (f) => (f.capacidad ? <Ocupacion v={(100 * (f.comensales ?? 0)) / f.capacidad} /> : <span className="mudo">cerrado</span>) },
  ], []);
  const totComensales = useMemo(() => {
    const filas = com?.data?.filas ?? [];
    const c = filas.reduce((a, f) => a + (f.comensales ?? 0), 0);
    const cap = filas.reduce((a, f) => a + (f.capacidad ?? 0), 0);
    return { c, cap };
  }, [com]);

  /* ---- espera y bloqueos ---- */
  const colsEspera = useMemo<Col<FilaEspera>[]>(() => [
    { id: "fecha", titulo: "Fecha", valor: (f) => fmtFecha(f.fecha) },
    { id: "alta", titulo: "Alta", valor: (f) => fmtTs(f.creado_en) },
    { id: "restaurante", titulo: "Restaurante", valor: (f) => f.restaurante },
    { id: "nombre", titulo: "Nombre", valor: (f) => f.nombre },
    { id: "pax", titulo: "Pax", valor: (f) => f.pax, num: true },
    { id: "telefono", titulo: "Teléfono", valor: (f) => f.telefono },
    { id: "hora", titulo: "Hora preferida", valor: (f) => fmtHora(f.hora_preferida) },
    { id: "estado", titulo: "Estado", valor: (f) => ESPERA_TEXTO[f.estado] ?? f.estado },
    { id: "avisado", titulo: "Avisado el", valor: (f) => fmtTs(f.avisado_en) },
    { id: "reserva", titulo: "Convertida en reserva", valor: (f) => siNo(!!f.reserva_id) },
    { id: "notas", titulo: "Notas", valor: (f) => f.notas },
  ], []);
  const colsBloqueos = useMemo<Col<FilaBloqueo>[]>(() => [
    { id: "fecha", titulo: "Fecha", valor: (f) => fmtFecha(f.fecha) },
    { id: "dia", titulo: "Día", valor: (f) => NOMBRES_DIA[dowDe(f.fecha) - 1] },
    { id: "desde", titulo: "Desde", valor: (f) => fmtHora(f.hora_inicio) },
    { id: "hasta", titulo: "Hasta", valor: (f) => fmtHora(f.hora_fin) },
    { id: "restaurante", titulo: "Restaurante", valor: (f) => f.restaurante },
    { id: "ambito", titulo: "Qué se bloquea", valor: (f) => (f.mesa ? `Mesa ${f.mesa}${f.sala ? ` (${f.sala})` : ""}` : f.sala ? `Sala ${f.sala}` : "Todo el restaurante") },
    { id: "motivo", titulo: "Motivo", valor: (f) => f.motivo },
    { id: "creado", titulo: "Creado el", valor: (f) => fmtTs(f.creado_en) },
  ], []);

  const sufijo = `${slug(nombreRest)}_${rango.desde}_${rango.hasta}`;
  const t = datos?.totales;
  const cl = datos?.clientes;

  return (
    <div className="inf">
      {/* ---- controles ---- */}
      <div className="inf-barra">
        <select className="inf-rest" value={restSel} onChange={(e) => { setRestSel(e.target.value); setHorasTocadas(false); }} aria-label="Restaurante">
          <option value="">Todos los restaurantes</option>
          {ctx.restaurantes.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
        <div className="inf-seg" role="group" aria-label="Periodo">
          {ATAJOS.map((a) => (
            <button key={a.id} className={atajo === a.id ? "on" : ""} onClick={() => elegirAtajo(a.id)}>{a.texto}</button>
          ))}
        </div>
        <div className="inf-fechas">
          <input type="date" value={rango.desde} max={rango.hasta} onChange={(e) => cambiarFecha("desde", e.target.value)} aria-label="Desde" />
          <span>–</span>
          <input type="date" value={rango.hasta} min={rango.desde} onChange={(e) => cambiarFecha("hasta", e.target.value)} aria-label="Hasta" />
        </div>
        <div className="inf-seg inf-tipo" role="group" aria-label="Tipo de fecha">
          <span className="inf-seg-eti">Fecha de</span>
          <button className={tipoFecha === "reserva" ? "on" : ""} onClick={() => setTipoFecha("reserva")}>reserva</button>
          <button className={tipoFecha === "anotacion" ? "on" : ""} onClick={() => setTipoFecha("anotacion")}>anotación</button>
        </div>
        <button className="inf-btn inf-recargar" onClick={recargar} title="Actualizar" aria-label="Actualizar">↻</button>
      </div>
      <div className="inf-resumen">
        <b>{nombreRest}</b> · del {fmtFecha(rango.desde)} al {fmtFecha(rango.hasta)}
        {datos ? ` · ${n(datos.dias)} ${datos.dias === 1 ? "día" : "días"}` : ""}
        {tipoFecha === "anotacion" ? <span className="inf-aviso-tipo">KPIs, gráficas y personas por turno van por fecha de reserva; el tracking, las cancelaciones, los no-shows y las valoraciones, por fecha de anotación.</span> : null}
      </div>

      {rangoInvalido ? <div className="aviso err">{rangoInvalido}</div> : null}

      {/* ---- KPIs ---- */}
      {!rangoInvalido && est?.estado === "error" ? <AvisoError texto={est.error} reintentar={recargar} /> : null}
      {!rangoInvalido && (!est || est.estado === "cargando") && !datos ? <div className="spinner" /> : null}
      {t && cl ? (
        <>
          <div className={"inf-kpis" + (est?.estado === "cargando" ? " cargando" : "")}>
            <Kpi etiqueta="Reservas" valor={n(t.reservas)} sub={`${n(t.reservas_atendidas)} atendidas · ${n(t.reservas_vivas)} vivas`} />
            <Kpi etiqueta="Pax atendidos" valor={n(t.pax_atendidos)} sub={t.pax_vivos ? `+ ${n(t.pax_vivos)} por venir` : `${n(t.pax)} reservados en total`} />
            <Kpi etiqueta="Ocupación media" valor={pct(t.ocupacion_pct)} sub={t.capacidad_periodo ? `sobre ${n(t.capacidad_periodo)} plazas` : "sin aforo configurado"} tono={tono(t.ocupacion_pct, [40, 70], true)} />
            <Kpi etiqueta="No-show" valor={pct(t.no_show_pct)} sub={`${n(t.no_shows)} ${t.no_shows === 1 ? "reserva" : "reservas"}${t.cobros_noshow ? ` · ${n(t.cobros_noshow)} cobradas` : ""}`} tono={tono(t.no_show_pct, [5, 10])} />
            <Kpi etiqueta="Cancelación" valor={pct(t.canceladas_pct)} sub={`${n(t.canceladas)} canceladas · ${n(t.canceladas_tardias)} tardías`} tono={tono(t.canceladas_pct, [10, 20])} />
            <Kpi etiqueta="Nuevos / recurrentes" valor={`${n(cl.nuevos)} / ${n(cl.recurrentes)}`} sub={cl.clientes ? `${n((100 * cl.recurrentes) / cl.clientes)} % repiten · ${n(cl.clientes)} clientes` : "sin clientes identificados"} />
            <Kpi etiqueta="Pax medio" valor={n(t.pax_medio, 1)} sub="por reserva atendida" />
            <Kpi etiqueta="Antelación media" valor={antelacion(t.antelacion_media_horas)} sub="reservas online" />
            <Kpi etiqueta="Valoración media" valor={t.valoracion_media == null ? "—" : `${n(t.valoracion_media, 1)} ★`} sub={`${n(t.valoraciones)} ${t.valoraciones === 1 ? "valoración" : "valoraciones"}${t.nps != null ? ` · NPS ${n(t.nps)}` : ""}`} />
          </div>
          {t.sin_cerrar ? (
            <div className="aviso info inf-sin-cerrar">
              {n(t.sin_cerrar)} {t.sin_cerrar === 1 ? "reserva pasada sigue" : "reservas pasadas siguen"} sin cerrar (pendiente, confirmada o a revisar): se cuentan como asistidas, no como no-show. Ciérralas desde Día para afinar el dato.
            </div>
          ) : null}

          {/* ---- gráficas ---- */}
          <div className="inf-graficas">
            <Tarjeta titulo="Por día" extra={`${n(datos?.por_dia.length)} días con reservas`}>
              <GraficaLineas
                etiquetas={serieDia.etiquetas}
                series={[
                  { nombre: "Pax", valores: serieDia.pax },
                  { nombre: "Reservas", valores: serieDia.reservas },
                ]}
              />
            </Tarjeta>
            <Tarjeta titulo="Por hora" extra="reservas sin cancelar">
              <GraficaBarras datos={porHora} nombre="Reservas" />
            </Tarjeta>
            <Tarjeta titulo="Por día de la semana" extra="pax">
              <GraficaBarras datos={porDow} nombre="Pax" />
            </Tarjeta>
            <Tarjeta
              titulo={canalOrigen === "canal" ? "Por canal" : "Por origen"}
              acciones={
                <div className="inf-seg mini">
                  <button className={canalOrigen === "canal" ? "on" : ""} onClick={() => setCanalOrigen("canal")}>Canal</button>
                  <button className={canalOrigen === "origen" ? "on" : ""} onClick={() => setCanalOrigen("origen")}>Origen</button>
                </div>
              }
            >
              <GraficaBarras datos={porCanal} nombre="Reservas" horizontal />
            </Tarjeta>
            <Tarjeta titulo="Por prescriptor" extra="top 15, sin canceladas">
              <GraficaBarras datos={porPrescriptor} nombre="Reservas" horizontal vacio="Sin reservas con prescriptor en el periodo." />
            </Tarjeta>
            <Tarjeta titulo="Por estado" extra="reservas">
              <GraficaBarras datos={porEstado} nombre="Reservas" horizontal />
            </Tarjeta>
            {porSemana.length > 1 ? (
              <Tarjeta titulo="Ocupación por semana" extra="% sobre aforo">
                <GraficaBarras datos={porSemana} nombre="Ocupación %" formato={(v) => `${n(v)} %`} />
              </Tarjeta>
            ) : null}
            {datos?.por_turno.length ? (
              <Tarjeta titulo="Por turno">
                <table className="inf-mini">
                  <thead><tr><th>Restaurante</th><th>Turno</th><th className="num">Reservas</th><th className="num">Pax</th><th className="num">No-shows</th></tr></thead>
                  <tbody>
                    {datos.por_turno.map((x) => (
                      <tr key={x.turno_id}>
                        <td>{x.restaurante}</td>
                        <td>{x.turno} <span className="mudo">{fmtHora(x.hora_inicio)}</span></td>
                        <td className="num">{n(x.reservas)}</td>
                        <td className="num">{n(x.pax)}</td>
                        <td className={"num" + (x.no_shows ? " inf-mal" : "")}>{n(x.no_shows)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Tarjeta>
            ) : null}
          </div>
        </>
      ) : null}

      {/* ---- tablas ---- */}
      {!rangoInvalido ? (
        <div className="inf-tablas">
          <div className="inf-tabs" role="tablist">
            {TABS.map((x) => (
              <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)}>{x.texto}</button>
            ))}
          </div>

          {TABS_TRK.includes(tab) ? (
            !trkActual ? (
              !trkAuto ? (
                <div className="inf-pedir">
                  <p>El rango es de <b>{n(diasRango)} días</b>. El tracking se carga por tramos de {TRAMO_DIAS} días y puede tardar un rato.</p>
                  <button className="inf-btn primario" onClick={() => setTrkPedido(claveTrk)}>Cargar tracking</button>
                </div>
              ) : <div className="spinner" />
            )
            : trkActual.estado === "error" ? <AvisoError texto={trkActual.error} reintentar={recargar} />
            : (
              <>
                {trkActual.estado === "cargando" ? (
                  <ProgresoTracking
                    filas={trkActual.data?.filas.length ?? 0}
                    estimadas={tipoFecha === "reserva" && est?.clave === clave ? est.data?.totales.reservas ?? null : null}
                    tramo={trkActual.tramo ?? 0}
                    tramos={trkActual.tramos ?? 1}
                    parar={pararTracking}
                  />
                ) : null}
                {trkActual.parada ? (
                  <div className="aviso info inf-parada">
                    Carga parada{trkActual.hastaFecha ? `: llega hasta el ${fmtFecha(trkActual.hastaFecha)}` : ""}. Pulsa ↻ para cargar el periodo entero.
                  </div>
                ) : null}
                {trkActual.estado === "cargando" && !(trkActual.data?.filas.length) ? null : (
                  <>
                    {tab === "tracking" ? (
                      <TablaInforme
                        cols={COLS_TRACKING}
                        filas={filasTracking}
                        nombre={`tracking-reservas_${sufijo}`}
                        hoja="Tracking"
                        idDe={(f, i) => f.reserva_id ?? String(i)}
                        avisar={avisar}
                        vacio={filtroTracking ? "Ninguna reserva coincide con la búsqueda." : "Sin reservas en el periodo."}
                        herramientas={
                          <input className="inf-filtro" value={filtroTracking} onChange={(e) => setFiltroTracking(e.target.value)} placeholder="Filtrar por nombre, localizador, teléfono…" aria-label="Filtrar tracking" />
                        }
                        nota={trkActual.data?.truncado ? `Se ha cortado en el tope de ${n(TOPE_TRK)} reservas: acorta el rango para verlo entero.` : null}
                      />
                    ) : null}

                    {tab === "cancelaciones" ? (
                      <TablaInforme
                        cols={colsCancel}
                        filas={cancelaciones}
                        nombre={`cancelaciones-tardias_${sufijo}`}
                        hoja="Cancelaciones tardías"
                        idDe={(f, i) => f.reserva_id ?? String(i)}
                        avisar={avisar}
                        vacio={horasFijas == null ? "Ninguna cancelación dentro de la política de cada local." : `Ninguna cancelación a menos de ${n(horasFijas)} h de la reserva.`}
                        herramientas={
                          <label className="inf-horas">
                            Dentro de
                            <input
                              type="number"
                              min={0}
                              max={720}
                              step={1}
                              value={horasFijas ?? ""}
                              placeholder="política de cada local"
                              onChange={(e) => {
                                if (e.target.value === "") { setHorasTocadas(false); return; }
                                setHorasTocadas(true);
                                setHorasX(Math.max(0, parseInt(e.target.value) || 0));
                              }}
                            />
                            horas antes de la reserva
                          </label>
                        }
                        nota={restActual
                          ? `Por defecto, las horas de la política de cancelación de ${restActual.nombre}. Vacía el campo para volver a ellas.`
                          : horasFijas == null
                            ? "Con «todos los restaurantes», cada reserva se mide con la política de su local (columna «Política»), igual que el KPI. Escribe unas horas para usar el mismo umbral en todos."
                            : "Mismo umbral para todos los locales. Vacía el campo para volver a la política de cada uno."}
                      />
                    ) : null}

                    {tab === "noshows" ? (
                      <TablaInforme
                        cols={colsNoShows}
                        filas={noShows}
                        nombre={`no-shows_${sufijo}`}
                        hoja="No-shows"
                        idDe={(f, i) => f.reserva_id ?? String(i)}
                        avisar={avisar}
                        vacio="Ningún no-show en el periodo."
                        nota={noShows.length
                          ? `${n(noShows.length)} no-shows · ${n(resumenNoShows.pax)} pax · ${n(resumenNoShows.cobradas)} con la garantía cobrada${resumenNoShows.importe ? ` (${n(resumenNoShows.importe, 2)} €)` : ""}. «No-shows del cliente» cuenta los del periodo cargado.`
                          : null}
                      />
                    ) : null}

                    {tab === "valoraciones" ? (
                      <TablaInforme
                        cols={colsValoraciones}
                        filas={valoraciones}
                        nombre={`valoraciones_${sufijo}`}
                        hoja="Valoraciones"
                        idDe={(f, i) => f.reserva_id ?? String(i)}
                        avisar={avisar}
                        vacio="Ninguna valoración en el periodo."
                        nota={mediaValoracion != null ? `${n(valoraciones.length)} ${valoraciones.length === 1 ? "valoración" : "valoraciones"} · media ${n(mediaValoracion, 1)} ★` : null}
                      />
                    ) : null}
                  </>
                )}
              </>
            )
          ) : null}

          {tab === "comensales" ? (
            com?.estado === "error" ? <AvisoError texto={com.error} reintentar={recargar} />
            : !com || com.estado === "cargando" ? <div className="spinner" />
            : (
              <TablaInforme
                cols={colsComensales}
                filas={com.data?.filas ?? []}
                nombre={`personas-por-turno-y-dia_${sufijo}`}
                hoja="Personas por turno y día"
                idDe={(f, i) => String(f.id ?? i)}
                avisar={avisar}
                nota="Es la misma tabla que lee Ratios en vivo. Llega hasta hoy (hoy cuenta las reservas vivas); capacidad 0 = cerrado."
                pie={
                  <tr>
                    <td colSpan={5}>Total</td>
                    <td className="num">{n(totComensales.c)}</td>
                    <td className="num">{n(totComensales.cap)}</td>
                    <td className="num">{totComensales.cap ? <Ocupacion v={(100 * totComensales.c) / totComensales.cap} /> : "—"}</td>
                  </tr>
                }
              />
            )
          ) : null}

          {tab === "usuarios" ? (
            !datos ? <div className="spinner" /> : (
              <>
                <div className="inf-usuarios-graf">
                  <GraficaBarras datos={usuarios.map((u) => ({ etiqueta: u.usuario, valor: u.reservas, detalle: `${n(u.pax)} pax` }))} nombre="Reservas" horizontal vacio="Sin reservas anotadas a mano en el periodo." />
                </div>
                <TablaInforme
                  cols={colsUsuarios}
                  filas={usuarios}
                  nombre={`reservas-por-usuario_${sufijo}`}
                  hoja="Reservas por usuario"
                  idDe={(f) => f.usuario}
                  avisar={avisar}
                  vacio="Sin reservas anotadas a mano en el periodo."
                  nota="Reservas anotadas desde el panel (anotado por / creado por). Las online no cuentan."
                />
              </>
            )
          ) : null}

          {tab === "espera" ? (
            ext?.estado === "error" ? <AvisoError texto={ext.error} reintentar={recargar} />
            : !ext || ext.estado === "cargando" ? <div className="spinner" />
            : <TablaInforme cols={colsEspera} filas={ext.data?.espera ?? []} nombre={`lista-de-espera_${sufijo}`} hoja="Lista de espera" idDe={(f) => f.id} avisar={avisar} vacio="Sin entradas en lista de espera en el periodo." />
          ) : null}

          {tab === "bloqueos" ? (
            ext?.estado === "error" ? <AvisoError texto={ext.error} reintentar={recargar} />
            : !ext || ext.estado === "cargando" ? <div className="spinner" />
            : <TablaInforme cols={colsBloqueos} filas={ext.data?.bloqueos ?? []} nombre={`mesas-bloqueadas_${sufijo}`} hoja="Mesas bloqueadas" idDe={(f) => f.id} avisar={avisar} vacio="Sin bloqueos en el periodo." />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ==================== Piezas ==================== */

type Tono = "bien" | "regular" | "mal" | undefined;

/** Semáforo de un KPI: umbrales [ámbar, rojo]; con `alReves` lo bueno es estar por encima. */
function tono(v: number | null | undefined, umbral: [number, number], alReves = false): Tono {
  if (v == null) return undefined;
  if (alReves) return v >= umbral[1] ? "bien" : v >= umbral[0] ? "regular" : "mal";
  return v <= umbral[0] ? "bien" : v <= umbral[1] ? "regular" : "mal";
}

function Kpi({ etiqueta, valor, sub, tono }: { etiqueta: string; valor: string; sub?: string; tono?: Tono }) {
  return (
    <div className={"inf-kpi" + (tono ? ` ${tono}` : "")}>
      <span className="inf-kpi-eti">{etiqueta}</span>
      <b>{valor}</b>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

function Tarjeta({ titulo, extra, acciones, children }: { titulo: string; extra?: string; acciones?: ReactNode; children: ReactNode }) {
  return (
    <div className="inf-tarjeta">
      <div className="inf-tarjeta-cab">
        <h4>{titulo}</h4>
        {extra ? <span className="mudo">{extra}</span> : null}
        {acciones ? <div className="inf-tarjeta-acc">{acciones}</div> : null}
      </div>
      {children}
    </div>
  );
}

function AvisoError({ texto, reintentar }: { texto?: string; reintentar: () => void }) {
  return (
    <div className="aviso err inf-error">
      <span>{texto || ERROR_RED}</span>
      <button className="inf-btn" onClick={reintentar}>Reintentar</button>
    </div>
  );
}

function ProgresoTracking({ filas, estimadas, tramo, tramos, parar }: { filas: number; estimadas: number | null; tramo: number; tramos: number; parar: () => void }) {
  const pctHecho = tramos ? Math.round((100 * tramo) / tramos) : 0;
  return (
    <div className="inf-progreso" role="status" aria-live="polite">
      <div className="inf-progreso-txt">
        <span>
          Cargando {n(filas)}{estimadas ? ` de ~${n(Math.max(estimadas, filas))}` : ""} reservas…
          <span className="mudo"> · tramo {n(Math.min(tramo + 1, tramos))} de {n(tramos)}</span>
        </span>
        <button className="inf-btn" onClick={parar}>Parar</button>
      </div>
      <div className="inf-progreso-barra"><i style={{ width: `${pctHecho}%` }} /></div>
    </div>
  );
}

function Ocupacion({ v }: { v: number }) {
  const clase = v >= 100 ? "rojo" : v >= 80 ? "ambar" : "";
  return (
    <span className={"inf-ocup " + clase}>
      <i style={{ width: `${Math.min(100, v)}%` }} />
      <span>{n(v)} %</span>
    </span>
  );
}
