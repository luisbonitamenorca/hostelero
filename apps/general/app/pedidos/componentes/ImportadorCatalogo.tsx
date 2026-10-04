"use client";

/* Importador de catálogo CSV/XLSX de un proveedor (constructor C).
   1. El navegador lee el archivo (xlsx por import dinámico: no va en el paquete inicial).
   2. Detecta la fila de títulos y qué columna es cada campo; el usuario lo confirma o lo cambia
      viendo 10 filas de muestra.
   3. Abre la importación y manda las filas en trozos de TAM_TROZO_IMPORT, EN SERIE (límite de
      cuerpo de las server actions y contadores acumulados en el servidor).
   4. Cierra la importación y enseña el resumen (nuevos, actualizados, sin cambios, errores).
   Estilos en ../secciones/ajustes.css (prefijo peda-). */

import { useEffect, useMemo, useRef, useState } from "react";
import { cerrarImportacion, importarTrozoCatalogo, iniciarImportacion } from "../acciones/ajustes";
import {
  detectarColumnas,
  detectarFilaCabecera,
  filasCatalogo,
  formatoEuros,
  formatoNumero,
  mapeoVacio,
  trozos,
} from "../lib-pedidos";
import { CAMPOS_CATALOGO, CAMPO_CATALOGO_TXT, TAM_TROZO_IMPORT } from "../tipos";
import type {
  CampoCatalogo,
  ErrorFilaCatalogo,
  FilaCatalogo,
  ImportacionCatalogo,
  MapeoColumnas,
  PropsImportadorCatalogo,
} from "../tipos";
import "../secciones/ajustes.css";

type Hoja = { nombre: string; tabla: unknown[][] };
type Paso = "elegir" | "mapeo" | "importando" | "fin";
type Acumulado = { creados: number; actualizados: number; sin_cambios: number; errores: ErrorFilaCatalogo[] };

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILAS = 100_000;
const MAX_COLUMNAS = 100;
const ACUMULADO_CERO: Acumulado = { creados: 0, actualizados: 0, sin_cambios: 0, errores: [] };

/** Letra de columna de Excel: 0 → A, 25 → Z, 26 → AA. */
function letra(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const celda = (v: unknown): string => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

export default function ImportadorCatalogo({ proveedor, avisar, onTerminado, onCancelar }: PropsImportadorCatalogo) {
  const [paso, setPaso] = useState<Paso>("elegir");
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archivo, setArchivo] = useState("");
  const [hojas, setHojas] = useState<Hoja[]>([]);
  const [hojaIdx, setHojaIdx] = useState(0);
  const [filaCab, setFilaCab] = useState(0);
  const [mapeo, setMapeo] = useState<MapeoColumnas>(mapeoVacio());

  const [importacionId, setImportacionId] = useState<string | null>(null);
  const [hechas, setHechas] = useState(0);
  const [acumulado, setAcumulado] = useState<Acumulado>(ACUMULADO_CERO);
  const [errorTrozo, setErrorTrozo] = useState<string | null>(null);
  const [siguiente, setSiguiente] = useState(0);
  const [trabajando, setTrabajando] = useState(false);
  const [final, setFinal] = useState<ImportacionCatalogo | null>(null);
  const parar = useRef(false);
  const acumuladoRef = useRef<Acumulado>(ACUMULADO_CERO);

  const hoja = hojas[hojaIdx] ?? null;

  // Mientras se importa, avisar antes de cerrar la página.
  useEffect(() => {
    if (!trabajando) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [trabajando]);

  /* ─── lectura del archivo ─── */

  const prepararHoja = (h: Hoja | undefined) => {
    if (!h) return;
    const fc = detectarFilaCabecera(h.tabla);
    setFilaCab(fc);
    setMapeo(detectarColumnas((h.tabla[fc] ?? []).slice(0, MAX_COLUMNAS)));
  };

  const leer = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("El archivo pesa demasiado (máximo 20 MB).");
      return;
    }
    setLeyendo(true);
    try {
      const XLSX = await import("xlsx");
      const esTexto = /\.(csv|txt|tsv)$/i.test(file.name) || file.type === "text/csv" || file.type === "text/plain";
      const buf = await file.arrayBuffer();
      let wb: ReturnType<typeof XLSX.read>;
      if (esTexto) {
        // CSV: se lee como texto sin interpretar valores (raw) para que «0123» o «12,50» lleguen
        // tal cual y los convierta parsearNumero. Excel en Windows guarda en cp1252.
        let texto = new TextDecoder("utf-8").decode(buf);
        if (texto.includes("�")) texto = new TextDecoder("windows-1252").decode(buf);
        texto = texto.replace(/^﻿/, "");
        const unaColumna = (w: ReturnType<typeof XLSX.read>) => {
          const ws = w.Sheets[w.SheetNames[0]];
          if (!ws || !ws["!ref"]) return true;
          return XLSX.utils.decode_range(ws["!ref"]).e.c === 0;
        };
        wb = XLSX.read(texto, { type: "string", raw: true });
        if (unaColumna(wb)) {
          for (const FS of [";", "\t", "|"]) {
            const w2 = XLSX.read(texto, { type: "string", raw: true, FS });
            if (!unaColumna(w2)) {
              wb = w2;
              break;
            }
          }
        }
      } else {
        wb = XLSX.read(buf, { type: "array" });
      }

      const leidas: Hoja[] = [];
      for (const nombre of wb.SheetNames) {
        const ws = wb.Sheets[nombre];
        if (!ws || !ws["!ref"]) continue;
        // Rango desde A1 para que el índice de la fila sea la fila real de Excel (errores «fila N»).
        const r = XLSX.utils.decode_range(ws["!ref"]);
        r.s.r = 0;
        r.s.c = 0;
        const tabla = XLSX.utils.sheet_to_json<unknown[]>(ws, {
          header: 1,
          defval: null,
          blankrows: true,
          raw: true,
          range: XLSX.utils.encode_range(r),
        });
        if (tabla.some((f) => Array.isArray(f) && f.some((c) => c != null && celda(c) !== ""))) leidas.push({ nombre, tabla });
      }
      if (!leidas.length) {
        setError("El archivo está vacío o no se puede leer.");
        return;
      }
      if (leidas[0].tabla.length > MAX_FILAS + 50) {
        setError("El archivo tiene demasiadas filas (máximo 100.000).");
        return;
      }
      setArchivo(file.name);
      setHojas(leidas);
      setHojaIdx(0);
      prepararHoja(leidas[0]);
      setPaso("mapeo");
    } catch {
      setError("No se ha podido leer el archivo. Guárdalo como Excel (.xlsx) o CSV y prueba otra vez.");
    } finally {
      setLeyendo(false);
    }
  };

  /* ─── mapeo y muestra ─── */

  const nColumnas = useMemo(() => {
    if (!hoja) return 0;
    let n = 0;
    const hasta = Math.min(hoja.tabla.length, filaCab + 200);
    for (let i = filaCab; i < hasta; i++) n = Math.max(n, hoja.tabla[i]?.length ?? 0);
    return Math.min(n, MAX_COLUMNAS);
  }, [hoja, filaCab]);

  const cabeceras = useMemo(() => {
    if (!hoja) return [] as string[];
    const f = hoja.tabla[filaCab] ?? [];
    return Array.from({ length: nColumnas }, (_, i) => celda(f[i]).slice(0, 120));
  }, [hoja, filaCab, nColumnas]);

  const filas: FilaCatalogo[] = useMemo(
    () => (hoja ? filasCatalogo(hoja.tabla, filaCab, mapeo).slice(0, MAX_FILAS) : []),
    [hoja, filaCab, mapeo],
  );

  const cambiarHoja = (i: number) => {
    setHojaIdx(i);
    prepararHoja(hojas[i]);
  };

  const cambiarFilaCab = (n: number) => {
    if (!hoja) return;
    const fc = Math.max(0, Math.min(n, hoja.tabla.length - 1));
    setFilaCab(fc);
    setMapeo(detectarColumnas((hoja.tabla[fc] ?? []).slice(0, MAX_COLUMNAS)));
  };

  const asignar = (campo: CampoCatalogo, v: string) => setMapeo((m) => ({ ...m, [campo]: v === "" ? null : Number(v) }));

  const sinClave = mapeo.ref === null && mapeo.nombre === null;
  const muestra = filas.slice(0, 10);

  /* ─── importación ─── */

  const partes = useMemo(() => trozos(filas, TAM_TROZO_IMPORT), [filas]);

  const cerrar = async (id: string) => {
    setTrabajando(true);
    try {
      const r = await cerrarImportacion(id);
      if (!r.ok) {
        setErrorTrozo(r.error);
        return;
      }
      setFinal(r.importacion);
      setPaso("fin");
    } catch {
      setErrorTrozo("Se ha perdido la conexión al cerrar la importación.");
    } finally {
      setTrabajando(false);
    }
  };

  const procesar = async (id: string, desde: number) => {
    setTrabajando(true);
    setErrorTrozo(null);
    parar.current = false;
    let fallo = false;
    for (let i = desde; i < partes.length; i++) {
      if (parar.current) {
        setErrorTrozo("Importación parada. Puedes seguir o terminar aquí.");
        setSiguiente(i);
        fallo = true;
        break;
      }
      let r: Awaited<ReturnType<typeof importarTrozoCatalogo>>;
      try {
        r = await importarTrozoCatalogo(id, partes[i]);
      } catch {
        r = { ok: false, error: "Se ha perdido la conexión." };
      }
      if (!r.ok) {
        setErrorTrozo(`${r.error} (desde la fila ${partes[i][0]?.fila ?? "?"})`);
        setSiguiente(i);
        fallo = true;
        break;
      }
      const a = acumuladoRef.current;
      const nuevo: Acumulado = {
        creados: a.creados + r.creados,
        actualizados: a.actualizados + r.actualizados,
        sin_cambios: a.sin_cambios + r.sin_cambios,
        errores: [...a.errores, ...r.errores],
      };
      acumuladoRef.current = nuevo;
      setAcumulado(nuevo);
      setHechas(i + 1);
      setSiguiente(i + 1);
    }
    setTrabajando(false);
    if (!fallo) await cerrar(id);
  };

  const empezar = async () => {
    if (sinClave || !filas.length) return;
    setError(null);
    setTrabajando(true);
    acumuladoRef.current = ACUMULADO_CERO;
    setAcumulado(ACUMULADO_CERO);
    setHechas(0);
    setSiguiente(0);
    try {
      const ini = await iniciarImportacion({
        proveedor_id: proveedor.id,
        archivo,
        cabeceras,
        mapeo,
        filas_archivo: filas.length,
      });
      if (!ini.ok) {
        setError(ini.error);
        setTrabajando(false);
        return;
      }
      setImportacionId(ini.importacion_id);
      setPaso("importando");
      await procesar(ini.importacion_id, 0);
    } catch {
      setError("Se ha perdido la conexión. Prueba otra vez.");
      setTrabajando(false);
    }
  };

  const terminar = () => {
    if (!final) return;
    avisar(
      `Catálogo importado: ${final.creados} nuevos, ${final.actualizados} actualizados${final.errores ? `, ${final.errores} con error` : ""}`,
      final.errores ? "error" : "ok",
    );
    onTerminado(final);
  };

  /* ─── pintar ─── */

  return (
    <div className="peda-imp">
      <div className="peda-imp-cabeza">
        <h4 className="peda-h4">Importar catálogo de {proveedor.nombre}</h4>
        {paso === "elegir" || paso === "mapeo" ? (
          <button type="button" className="peda-enlace" onClick={onCancelar}>
            Cancelar
          </button>
        ) : null}
      </div>

      {error ? <div className="aviso-error peda-error">{error}</div> : null}

      {paso === "elegir" ? (
        <div className="peda-imp-elegir">
          <p className="peda-ayuda">
            Sube el Excel o CSV que te mande el proveedor. Hace falta al menos la columna del código o la del nombre; mejor si
            trae también formato, unidad y precio.
          </p>
          <label className={`peda-archivo${leyendo ? " peda-archivo--leyendo" : ""}`}>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.txt,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={leyendo}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void leer(f);
              }}
            />
            <span>{leyendo ? "Leyendo el archivo…" : "Elegir archivo (Excel o CSV)"}</span>
          </label>
        </div>
      ) : null}

      {paso === "mapeo" && hoja ? (
        <div className="peda-imp-mapeo">
          <p className="peda-ayuda">
            <b>{archivo}</b> · {formatoNumero(filas.length)} productos. Revisa qué es cada columna: lo hemos adivinado por los
            títulos.
          </p>

          <div className="peda-imp-opciones">
            {hojas.length > 1 ? (
              <label className="peda-campo">
                <span>Hoja</span>
                <select value={hojaIdx} onChange={(e) => cambiarHoja(Number(e.target.value))}>
                  {hojas.map((h, i) => (
                    <option key={h.nombre + i} value={i}>
                      {h.nombre}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="peda-campo">
              <span>Fila de los títulos</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={Math.max(1, hoja.tabla.length)}
                value={filaCab + 1}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1) cambiarFilaCab(n - 1);
                }}
              />
            </label>
          </div>

          <div className="peda-mapeo">
            {CAMPOS_CATALOGO.map((campo) => (
              <label key={campo} className="peda-campo">
                <span>
                  {CAMPO_CATALOGO_TXT[campo]}
                  {campo === "ref" || campo === "nombre" ? " *" : ""}
                </span>
                <select value={mapeo[campo] ?? ""} onChange={(e) => asignar(campo, e.target.value)}>
                  <option value="">— No está —</option>
                  {cabeceras.map((c, i) => (
                    <option key={i} value={i}>
                      {letra(i)} · {c || "(sin título)"}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {sinClave ? <div className="peda-aviso">Indica qué columna es el código o el nombre del producto.</div> : null}
          {!sinClave && mapeo.ref === null ? (
            <div className="peda-aviso">
              Sin columna de código: los productos se casarán por nombre y los nuevos se crearán sin el código del proveedor.
            </div>
          ) : null}
          {!sinClave && mapeo.precio === null ? <div className="peda-aviso">Sin columna de precio: no se actualizarán precios.</div> : null}

          {muestra.length ? (
            <div className="peda-tabla-caja">
              <table className="peda-tabla">
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Código</th>
                    <th>Nombre</th>
                    <th>Formato</th>
                    <th>Unidad</th>
                    <th>Uds.</th>
                    <th>Precio</th>
                    <th>Cód. barras</th>
                    <th>Categoría</th>
                  </tr>
                </thead>
                <tbody>
                  {muestra.map((f) => (
                    <tr key={f.fila}>
                      <td className="peda-num">{f.fila}</td>
                      <td className="peda-mono">{f.ref ?? ""}</td>
                      <td>{f.nombre ?? ""}</td>
                      <td>{f.formato ?? ""}</td>
                      <td>{f.unidad ?? ""}</td>
                      <td className="peda-num">{f.unidades_formato != null ? formatoNumero(f.unidades_formato) : ""}</td>
                      <td className="peda-num">{f.precio != null ? formatoEuros(f.precio) : ""}</td>
                      <td className="peda-mono">{f.codigo_barras ?? ""}</td>
                      <td>{f.categoria ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="peda-ayuda">No hay filas con código o nombre debajo de la fila de títulos.</p>
          )}

          <div className="peda-botones">
            <button
              type="button"
              className="peda-accion"
              disabled={sinClave || !filas.length || trabajando}
              onClick={() => void empezar()}
            >
              {trabajando ? "Empezando…" : `Importar ${formatoNumero(filas.length)} productos`}
            </button>
            <button
              type="button"
              className="boton-secundario peda-btn-sec"
              disabled={trabajando}
              onClick={() => {
                setPaso("elegir");
                setHojas([]);
                setError(null);
              }}
            >
              Otro archivo
            </button>
          </div>
          <p className="peda-nota">
            Los productos que ya existen no cambian de nombre (si el catálogo trae otro, se guarda como alias). Si uno ya existía
            sin código del proveedor y el nombre coincide, se le pone el código del catálogo en vez de duplicarlo. Los que no
            vengan en el archivo no se tocan.
          </p>
        </div>
      ) : null}

      {paso === "importando" ? (
        <div className="peda-imp-progreso">
          <div className="peda-barra" role="progressbar" aria-valuemin={0} aria-valuemax={partes.length} aria-valuenow={hechas}>
            <span style={{ width: `${partes.length ? Math.round((hechas / partes.length) * 100) : 0}%` }} />
          </div>
          <p className="peda-ayuda">
            {formatoNumero(Math.min(hechas * TAM_TROZO_IMPORT, filas.length))} de {formatoNumero(filas.length)} filas ·{" "}
            {acumulado.creados} nuevos · {acumulado.actualizados} actualizados · {acumulado.sin_cambios} sin cambios
            {acumulado.errores.length ? ` · ${acumulado.errores.length} con error` : ""}
          </p>
          {errorTrozo ? <div className="aviso-error peda-error">{errorTrozo}</div> : null}
          <div className="peda-botones">
            {trabajando ? (
              <button type="button" className="boton-secundario peda-btn-sec" onClick={() => (parar.current = true)}>
                Parar
              </button>
            ) : importacionId ? (
              <>
                {siguiente < partes.length ? (
                  <button type="button" className="peda-accion" onClick={() => void procesar(importacionId, siguiente)}>
                    Seguir
                  </button>
                ) : null}
                <button type="button" className="boton-secundario peda-btn-sec" onClick={() => void cerrar(importacionId)}>
                  Terminar aquí
                </button>
              </>
            ) : null}
          </div>
          {trabajando ? <p className="peda-nota">No cierres esta página hasta que termine.</p> : null}
        </div>
      ) : null}

      {paso === "fin" && final ? (
        <div className="peda-imp-fin">
          <div className="peda-cifras">
            <div>
              <b>{final.creados}</b>
              <span>nuevos</span>
            </div>
            <div>
              <b>{final.actualizados}</b>
              <span>actualizados</span>
            </div>
            <div>
              <b>{final.detalle?.sin_cambios ?? acumulado.sin_cambios}</b>
              <span>sin cambios</span>
            </div>
            <div className={final.errores ? "peda-cifra-mal" : undefined}>
              <b>{final.errores}</b>
              <span>con error</span>
            </div>
          </div>
          {final.detalle?.avisos.length ? (
            <ul className="peda-avisos">
              {final.detalle.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : null}
          {acumulado.errores.length ? (
            <details className="peda-errores">
              <summary>Ver filas con error ({acumulado.errores.length})</summary>
              <ul>
                {acumulado.errores.slice(0, 200).map((e, i) => (
                  <li key={`${e.fila}-${i}`}>
                    <span className="peda-mono">Fila {e.fila}</span>
                    {e.ref ? <span className="peda-mono"> · {e.ref}</span> : null} — {e.error}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <button type="button" className="peda-accion" onClick={terminar}>
            Hecho
          </button>
        </div>
      ) : null}
    </div>
  );
}
