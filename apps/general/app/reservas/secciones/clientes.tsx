"use client";

/* Clientes (CRM de sala, guía §8): tabla paginada en servidor con buscador y filtros, ficha lateral,
   exportación CSV (solo dirección / permiso de ajustes) y fusión de duplicados.
   «Enviar a CRM» queda pendiente para el integrador: ver el comentario al final de acciones/clientes.ts. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../acciones/clientes";
import type { Cliente } from "../tipos";
import { fmtFecha, guardarPref, leerPref, useRecargaExterna, type SecProps } from "../lib-reservas";
import { EtiquetaChip, FichaCliente, IDIOMAS, PAISES, TEXTO_RIESGO, nivelRiesgo, nombreCompleto } from "../componentes/ficha-cliente";
import "./clientes.css";

type Filtros = api.FiltrosClientes;
type Catalogos = Awaited<ReturnType<typeof api.catalogos>>;
type Resultado = api.ResultadoBusqueda;

const FILTROS_VACIOS: Filtros = {
  q: "", etiqueta: null, alergeno: null, vip: false, listaNegra: false, consentimiento: false, idioma: null, pais: null, altaDesde: null,
  visitasMin: null, sinVisitasDesde: null, noShowsMin: null, canceladasMin: null, riesgo: null, orden: "nombre", dir: "asc",
};

const COLUMNAS: { id: api.OrdenClientes | null; texto: string; clase?: string }[] = [
  { id: "nombre", texto: "Cliente" },
  { id: null, texto: "Teléfono" },
  { id: null, texto: "Email" },
  { id: "visitas", texto: "Visitas", clase: "num" },
  { id: "no_shows", texto: "No-shows", clase: "num" },
  { id: null, texto: "Canc.", clase: "num" },
  { id: "ultima_visita", texto: "Última visita" },
  { id: null, texto: "Etiquetas" },
  { id: "riesgo", texto: "Riesgo" },
];

const fmtMiles = (n: number) => n.toLocaleString("es-ES");
/** Valor de un campo numérico de filtro: entero ≥ 1 o null. */
const numFiltro = (v: string) => (v ? Math.max(1, parseInt(v) || 0) : null);

export default function SecClientes({ ctx, avisar }: SecProps) {
  const [filtros, setFiltros] = useState<Filtros>(() => ({
    ...FILTROS_VACIOS,
    orden: leerPref<api.OrdenClientes>("clientes:orden", "nombre"),
    dir: leerPref<"asc" | "desc">("clientes:dir", "asc"),
  }));
  const [qDeb, setQDeb] = useState("");
  const [pagina, setPagina] = useState(0);
  const [res, setRes] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [ficha, setFicha] = useState<string | null | "nuevo">(null);
  const [dupes, setDupes] = useState<Awaited<ReturnType<typeof api.duplicados>> | null | "cargando">(null);
  const [masFiltros, setMasFiltros] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [permisos, setPermisos] = useState<{ exportar: boolean; anonimizar: boolean } | null>(null);
  const buscadorRef = useRef<HTMLInputElement>(null);
  const peticion = useRef(0);

  /* Buscador con retardo: la tabla no se recarga a cada tecla. */
  useEffect(() => {
    const t = setTimeout(() => setQDeb(filtros.q ?? ""), 300);
    return () => clearTimeout(t);
  }, [filtros.q]);

  const filtrosEfectivos = useMemo(() => ({ ...filtros, q: qDeb }), [filtros, qDeb]);
  const claveFiltros = JSON.stringify(filtrosEfectivos);

  const cargar = useCallback(async () => {
    const n = ++peticion.current;
    setCargando(true);
    setError("");
    try {
      const r = await api.buscar(filtrosEfectivos, pagina);
      if (n !== peticion.current) return; // llegó una búsqueda más nueva
      if (r.error) { setError(r.error); return; }
      setRes(r);
      // Si la página se ha quedado vacía (p. ej. tras fusionar), volvemos a la anterior.
      if (!r.filas.length && pagina > 0) setPagina((p) => Math.max(0, p - 1));
    } catch (e) {
      if (n === peticion.current) setError(e instanceof Error ? e.message : "No se ha podido cargar la lista.");
    } finally {
      if (n === peticion.current) setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveFiltros, pagina]);

  useEffect(() => { void cargar(); }, [cargar]);
  useEffect(() => { api.catalogos().then(setCat).catch(() => setCat(null)); }, []);
  useEffect(() => { api.permisos().then(setPermisos).catch(() => setPermisos(null)); }, []);
  useRecargaExterna(cargar);

  /* Al cambiar filtros se vuelve a la primera página y se vacía la selección. */
  const cambiar = (parche: Partial<Filtros>) => {
    setFiltros((f) => ({ ...f, ...parche }));
    setPagina(0);
    setSeleccion(new Set());
  };
  const ordenar = (col: api.OrdenClientes) => {
    const dir: "asc" | "desc" = filtros.orden === col ? (filtros.dir === "asc" ? "desc" : "asc") : col === "nombre" ? "asc" : "desc";
    guardarPref("clientes:orden", col);
    guardarPref("clientes:dir", dir);
    cambiar({ orden: col, dir });
  };
  const limpiar = () => cambiar({ ...FILTROS_VACIOS, orden: filtros.orden, dir: filtros.dir });

  const hayFiltros = !!(
    filtros.q || filtros.etiqueta || filtros.alergeno || filtros.vip || filtros.listaNegra || filtros.consentimiento || filtros.idioma || filtros.pais ||
    filtros.altaDesde || filtros.visitasMin || filtros.sinVisitasDesde || filtros.noShowsMin || filtros.canceladasMin || filtros.riesgo
  );

  /* Atajos: «/» enfoca el buscador; Esc lo vacía. */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (ficha !== null || dupes) return;
      const enCampo = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName);
      if (e.key === "/" && !enCampo) { e.preventDefault(); buscadorRef.current?.focus(); }
      if (e.key === "Escape" && document.activeElement === buscadorRef.current && filtros.q) cambiar({ q: "" });
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ficha, dupes, filtros.q]);

  /* Selección (para exportar solo unos cuantos). */
  const filas = res?.filas ?? [];
  const todasMarcadas = filas.length > 0 && filas.every((c) => seleccion.has(c.id));
  const alternarTodas = () => {
    setSeleccion((s) => {
      const n = new Set(s);
      if (todasMarcadas) filas.forEach((c) => n.delete(c.id));
      else filas.forEach((c) => n.add(c.id));
      return n;
    });
  };
  const alternar = (id: string) =>
    setSeleccion((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function exportar() {
    setExportando(true);
    try {
      const ids = seleccion.size ? Array.from(seleccion) : undefined;
      const r = await api.exportarCsv(filtrosEfectivos, ids);
      if (r.error) { avisar(r.error); return; }
      const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clientes-${new Date().toLocaleDateString("sv-SE")}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      avisar(`CSV con ${fmtMiles(r.filas)} clientes${r.truncado ? " (recortado al tope de 5.000)" : ""}. Teléfono, email y cumpleaños solo de quien tiene consentimiento comercial.`);
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se ha podido exportar.");
    } finally {
      setExportando(false);
    }
  }

  async function abrirDuplicados() {
    setDupes("cargando");
    try {
      setDupes(await api.duplicados());
    } catch (e) {
      setDupes(null);
      avisar(e instanceof Error ? e.message : "No se han podido buscar duplicados.");
    }
  }

  /* La ficha guardada se refleja en la tabla sin recargar. */
  const fichaGuardada = (c: Cliente) => {
    setRes((r) => {
      if (!r) return r;
      const existe = r.filas.some((x) => x.id === c.id);
      return existe ? { ...r, filas: r.filas.map((x) => (x.id === c.id ? { ...x, ...c } : x)) } : r;
    });
    if (ficha === "nuevo") { setFicha(c.id); void cargar(); }
  };

  const cerrarFicha = useCallback(() => setFicha(null), []);

  const nombreEti = useMemo(() => {
    const m: Record<string, { nombre: string; color: string }> = {};
    (cat?.etiquetas ?? []).forEach((e) => { m[e.id] = { nombre: e.nombre, color: e.color }; });
    return m;
  }, [cat]);

  const total = res?.total ?? 0;
  const desde = total ? pagina * (res?.porPagina ?? 50) + 1 : 0;
  const hasta = Math.min(total, pagina * (res?.porPagina ?? 50) + filas.length);
  const ultimaPagina = total ? Math.ceil(total / (res?.porPagina ?? 50)) - 1 : 0;

  return (
    <div className="cl">
      {/* ---- buscador y acciones ---- */}
      <div className="cl-barra">
        <div className="cl-buscador">
          <span className="cl-lupa" aria-hidden>⌕</span>
          <input
            ref={buscadorRef}
            value={filtros.q ?? ""}
            onChange={(e) => cambiar({ q: e.target.value })}
            placeholder="Buscar por nombre, apellidos, teléfono, email o empresa…  (/)"
            aria-label="Buscar clientes"
            autoComplete="off"
          />
          {filtros.q ? <button className="cl-limpiar" onClick={() => cambiar({ q: "" })} aria-label="Vaciar búsqueda">✕</button> : null}
        </div>
        <button className={"cl-btn" + (masFiltros || hayFiltros ? " on" : "")} onClick={() => setMasFiltros((v) => !v)}>
          Filtros{hayFiltros ? " ●" : ""}
        </button>
        <button className="cl-btn" onClick={abrirDuplicados} disabled={dupes === "cargando"}>{dupes === "cargando" ? "Buscando…" : "Duplicados"}</button>
        {permisos?.exportar ? (
          <button className="cl-btn" onClick={exportar} disabled={exportando || !total}>
            {exportando ? "Exportando…" : seleccion.size ? `Exportar CSV (${seleccion.size})` : "Exportar CSV"}
          </button>
        ) : null}
        <button className="cl-btn primario" onClick={() => setFicha("nuevo")}>+ Nuevo cliente</button>
      </div>

      {/* ---- filtros ---- */}
      {masFiltros || hayFiltros ? (
        <div className="cl-filtros">
          <label>Etiqueta
            <select value={filtros.etiqueta ?? ""} onChange={(e) => cambiar({ etiqueta: e.target.value || null })}>
              <option value="">Todas</option>
              {(cat?.etiquetas ?? []).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </label>
          <label>Alérgeno
            <select value={filtros.alergeno ?? ""} onChange={(e) => cambiar({ alergeno: e.target.value || null })}>
              <option value="">Cualquiera</option>
              {(cat?.alergenos ?? []).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </label>
          <label>Visitas ≥
            <input type="number" min={1} inputMode="numeric" value={filtros.visitasMin ?? ""} onChange={(e) => cambiar({ visitasMin: numFiltro(e.target.value) })} placeholder="n" />
          </label>
          <label>No-shows ≥
            <input type="number" min={1} inputMode="numeric" value={filtros.noShowsMin ?? ""} onChange={(e) => cambiar({ noShowsMin: numFiltro(e.target.value) })} placeholder="n" />
          </label>
          <label>Canceladas ≥
            <input type="number" min={1} inputMode="numeric" value={filtros.canceladasMin ?? ""} onChange={(e) => cambiar({ canceladasMin: numFiltro(e.target.value) })} placeholder="n" />
          </label>
          <label>Alta desde
            <input type="date" value={filtros.altaDesde ?? ""} onChange={(e) => cambiar({ altaDesde: e.target.value || null })} />
          </label>
          <label>Sin visitas desde
            <input type="date" value={filtros.sinVisitasDesde ?? ""} onChange={(e) => cambiar({ sinVisitasDesde: e.target.value || null })} />
          </label>
          <label>Riesgo no-show
            <select value={filtros.riesgo ?? ""} onChange={(e) => cambiar({ riesgo: (e.target.value || null) as Filtros["riesgo"] })}>
              <option value="">Cualquiera</option>
              <option value="alto">Alto</option>
              <option value="medio">Medio</option>
            </select>
          </label>
          <label>Idioma
            <select value={filtros.idioma ?? ""} onChange={(e) => cambiar({ idioma: e.target.value || null })}>
              <option value="">Todos</option>
              {(cat?.idiomas ?? []).map((i) => <option key={i} value={i}>{IDIOMAS[i] ?? i.toUpperCase()}</option>)}
            </select>
          </label>
          <label>País
            <select value={filtros.pais ?? ""} onChange={(e) => cambiar({ pais: e.target.value || null })}>
              <option value="">Todos</option>
              {(cat?.paises ?? []).map((p) => <option key={p} value={p}>{PAISES[p] ?? p}</option>)}
            </select>
          </label>
          <div className="cl-toggles">
            <button className={"cl-toggle" + (filtros.vip ? " on" : "")} onClick={() => cambiar({ vip: !filtros.vip })}>★ VIP</button>
            <button className={"cl-toggle" + (filtros.listaNegra ? " on negra" : "")} onClick={() => cambiar({ listaNegra: !filtros.listaNegra })}>Lista negra</button>
            <button className={"cl-toggle" + (filtros.consentimiento ? " on" : "")} onClick={() => cambiar({ consentimiento: !filtros.consentimiento })}>Con consentimiento</button>
            {hayFiltros ? <button className="cl-toggle quitar" onClick={limpiar}>Quitar filtros</button> : null}
          </div>
        </div>
      ) : null}

      {/* ---- tabla ---- */}
      {error ? <div className="aviso err">{error}</div> : null}
      <div className={"cl-tabla-env" + (cargando ? " cargando" : "")}>
        <table className="cl-tabla">
          <thead>
            <tr>
              <th className="chk"><input type="checkbox" checked={todasMarcadas} onChange={alternarTodas} aria-label="Marcar todos los de la página" /></th>
              {COLUMNAS.map((col) => (
                <th key={col.texto} className={(col.clase ?? "") + (col.id ? " ord" : "") + (col.id && filtros.orden === col.id ? " activo" : "")} onClick={col.id ? () => ordenar(col.id!) : undefined}>
                  {col.texto}
                  {col.id && filtros.orden === col.id ? <span className="flecha">{filtros.dir === "asc" ? "▲" : "▼"}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!cargando && !filas.length ? (
              <tr><td colSpan={COLUMNAS.length + 1}><div className="vacio">{hayFiltros ? "Ningún cliente cumple los filtros." : "Todavía no hay clientes."}</div></td></tr>
            ) : null}
            {filas.map((c) => {
              const st = c.stats;
              const r = nivelRiesgo(st?.riesgo_no_show);
              const etis = (c.etiquetas ?? []).map((id) => nombreEti[id]).filter(Boolean);
              return (
                <tr key={c.id} className={(seleccion.has(c.id) ? "sel" : "") + (c.lista_negra ? " negra" : "")} onClick={() => setFicha(c.id)}>
                  <td className="chk" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={seleccion.has(c.id)} onChange={() => alternar(c.id)} aria-label="Marcar" />
                  </td>
                  <td className="nombre">
                    <div className="cl-nombre">
                      {c.vip ? <span className="cl-vip" title="VIP">★</span> : null}
                      {c.lista_negra ? <span className="cl-negra" title="Lista negra">⛔</span> : null}
                      <b>{nombreCompleto(c)}</b>
                    </div>
                    {(c.empresa || c.idioma !== "es" || c.pais !== "ES") ? (
                      <div className="cl-sub">
                        {c.empresa ? <span>{c.empresa}</span> : null}
                        {c.idioma !== "es" ? <span>{IDIOMAS[c.idioma] ?? c.idioma.toUpperCase()}</span> : null}
                        {c.pais !== "ES" ? <span>{PAISES[c.pais] ?? c.pais}</span> : null}
                      </div>
                    ) : null}
                  </td>
                  <td className="tel">{c.telefono ?? <span className="mudo">—</span>}</td>
                  <td className="email">
                    {c.email ? <span title={c.consentimiento_marketing ? "Con consentimiento comercial" : "Sin consentimiento comercial"}>{c.email}{c.consentimiento_marketing ? <i className="cl-ok"> ✓</i> : null}</span> : <span className="mudo">—</span>}
                  </td>
                  <td className="num">{st?.visitas ?? 0}</td>
                  <td className={"num" + ((st?.no_shows ?? 0) > 0 ? " mal" : "")}>{st?.no_shows ?? 0}</td>
                  <td className="num">{st?.canceladas ?? 0}</td>
                  <td className="fecha">{st?.ultima_visita ? fmtFecha(st.ultima_visita) : <span className="mudo">—</span>}</td>
                  <td className="etis">
                    {etis.slice(0, 3).map((e, i) => <EtiquetaChip key={i} nombre={e.nombre} color={e.color} mini />)}
                    {etis.length > 3 ? <span className="cl-mas">+{etis.length - 3}</span> : null}
                  </td>
                  <td className="riesgo">
                    {(st?.reservas_total ?? 0) > 0 ? <span className={"cl-semaforo " + r} title={`${TEXTO_RIESGO[r]} (${Math.round((st?.riesgo_no_show ?? 0) * 100)} %)`}><i />{TEXTO_RIESGO[r].replace("Riesgo ", "")}</span> : <span className="mudo">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {cargando && !filas.length ? <div className="spinner" /> : null}
      </div>

      {/* ---- paginación ---- */}
      <div className="cl-pie">
        <span className="cl-total">
          {total ? `${fmtMiles(desde)}–${fmtMiles(hasta)} de ${fmtMiles(total)}${res?.truncado ? "+" : ""} clientes` : cargando ? "Cargando…" : "0 clientes"}
          {seleccion.size ? ` · ${seleccion.size} marcados` : ""}
        </span>
        <div className="cl-pag">
          <button onClick={() => setPagina(0)} disabled={pagina === 0} aria-label="Primera página">«</button>
          <button onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0} aria-label="Página anterior">‹</button>
          <span>Página {pagina + 1} de {Math.max(1, ultimaPagina + 1)}</span>
          <button onClick={() => setPagina((p) => Math.min(ultimaPagina, p + 1))} disabled={pagina >= ultimaPagina} aria-label="Página siguiente">›</button>
          <button onClick={() => setPagina(ultimaPagina)} disabled={pagina >= ultimaPagina} aria-label="Última página">»</button>
        </div>
      </div>

      {/* ---- duplicados ---- */}
      {dupes && dupes !== "cargando" ? (
        <PanelDuplicados
          datos={dupes}
          avisar={avisar}
          cerrar={() => setDupes(null)}
          fusionado={() => void cargar()}
          volverABuscar={abrirDuplicados}
          abrirFicha={(id) => setFicha(id)}
          bloqueado={ficha !== null}
        />
      ) : null}

      {/* ---- ficha lateral (después de Duplicados: «Ver» la abre encima del panel) ---- */}
      {ficha !== null ? (
        <FichaCliente
          clienteId={ficha === "nuevo" ? null : ficha}
          restaurantes={ctx.restaurantes}
          catalogos={cat}
          cerrar={cerrarFicha}
          guardado={fichaGuardada}
          avisar={avisar}
        />
      ) : null}
    </div>
  );
}

/* ==================== Duplicados ==================== */

function PanelDuplicados({ datos, avisar, cerrar, fusionado, volverABuscar, abrirFicha, bloqueado }: {
  datos: { grupos: api.GrupoDuplicados[]; truncado: boolean };
  avisar: (m: string) => void;
  cerrar: () => void;
  /** Tras cada fusión: solo se recarga la tabla (el panel se actualiza en memoria). */
  fusionado: () => void;
  volverABuscar: () => void;
  abrirFicha: (id: string) => void;
  /** Hay una ficha abierta encima: el Esc es suyo. */
  bloqueado: boolean;
}) {
  const [destino, setDestino] = useState<Record<string, string>>({});
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [hechos, setHechos] = useState<Set<string>>(new Set());
  // Fichas ya borradas por una fusión: se quitan de todos los grupos (una ficha puede estar
  // en un grupo por teléfono y en otro por email).
  const [borrados, setBorrados] = useState<Set<string>>(new Set());

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !bloqueado && !document.querySelector(".rsp-modal")) cerrar(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [cerrar, bloqueado]);

  async function fusionar(g: api.GrupoDuplicados, clientes: api.GrupoDuplicados["clientes"]) {
    const dest = destino[g.clave] && clientes.some((c) => c.id === destino[g.clave]) ? destino[g.clave] : clientes[0]?.id;
    if (!dest) return;
    setOcupado(g.clave);
    let movidas = 0;
    let fallo = "";
    const hechasAhora: string[] = [];
    for (const c of clientes) {
      if (c.id === dest) continue;
      const r = await api.fusionar(c.id, dest);
      if (!r.ok) { fallo = r.error ?? "No se ha podido fusionar."; break; }
      hechasAhora.push(c.id);
      movidas += r.data?.reservasMovidas ?? 0;
    }
    setOcupado(null);
    setConfirmando(null);
    // Las que sí se fusionaron antes de un fallo también se marcan: ya no existen.
    if (hechasAhora.length) setBorrados((s) => { const n = new Set(s); hechasAhora.forEach((id) => n.add(id)); return n; });
    if (fallo) {
      avisar(hechasAhora.length ? `Fusión a medias (${hechasAhora.length} hecha${hechasAhora.length === 1 ? "" : "s"}): ${fallo}` : fallo);
      if (hechasAhora.length) fusionado();
      return;
    }
    setHechos((s) => new Set(s).add(g.clave));
    avisar(`Fusionados. ${movidas} reserva${movidas === 1 ? "" : "s"} movida${movidas === 1 ? "" : "s"}.`);
    fusionado();
  }

  const grupos = datos.grupos
    .filter((g) => !hechos.has(g.clave))
    .map((g) => ({ g, clientes: g.clientes.filter((c) => !borrados.has(c.id)) }))
    .filter((x) => x.clientes.length > 1);

  return (
    <div className="cl-modal-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <div className="cl-modal" role="dialog" aria-label="Posibles duplicados">
        <header>
          <h2>Posibles duplicados</h2>
          <span className="cl-modal-sub">
            {grupos.length ? `${grupos.length} grupo${grupos.length === 1 ? "" : "s"} con el mismo teléfono o email${datos.truncado ? " (se muestran los primeros)" : ""}` : "No hay clientes repetidos. Bien."}
          </span>
          <button className="cl-btn" onClick={volverABuscar} title="Vuelve a recorrer la cartera">Volver a buscar</button>
          <button className="cl-cerrar" onClick={cerrar} aria-label="Cerrar">✕</button>
        </header>
        <div className="cl-modal-cuerpo">
          {grupos.map(({ g, clientes }) => {
            const dest = destino[g.clave] && clientes.some((c) => c.id === destino[g.clave]) ? destino[g.clave] : clientes[0]?.id;
            const otros = clientes.filter((c) => c.id !== dest);
            return (
              <div key={g.clave} className="cl-grupo">
                <div className="cl-grupo-cab">
                  <b>{g.tipo === "telefono" ? "Teléfono" : "Email"} {g.clave}</b>
                  <span>{clientes.length} fichas · elige la que se conserva</span>
                </div>
                {clientes.map((c) => (
                  <label key={c.id} className={"cl-dup" + (dest === c.id ? " dest" : "")}>
                    <input type="radio" name={"dest-" + g.clave} checked={dest === c.id} onChange={() => setDestino((d) => ({ ...d, [g.clave]: c.id }))} />
                    <span className="cl-dup-txt">
                      <b>{c.vip ? "★ " : ""}{c.lista_negra ? "⛔ " : ""}{nombreCompleto(c)}</b>
                      <small>{[c.telefono, c.email, `alta ${fmtFecha(c.creado_en.slice(0, 10))}`].filter(Boolean).join(" · ")}</small>
                    </span>
                    <span className="cl-dup-num"><b>{c.reservas}</b> reservas<br /><small>{c.visitas} visitas</small></span>
                    <button type="button" className="cl-mini" onClick={(e) => { e.preventDefault(); abrirFicha(c.id); }}>Ver</button>
                  </label>
                ))}
                <div className="cl-grupo-pie">
                  {confirmando === g.clave ? (
                    <>
                      <span className="cl-aviso">Se moverán las reservas de {otros.length} ficha{otros.length === 1 ? "" : "s"} a la elegida y se borrarán las demás. No se puede deshacer.</span>
                      <button className="cl-btn" onClick={() => setConfirmando(null)} disabled={ocupado === g.clave}>Cancelar</button>
                      <button className="cl-btn peligro" onClick={() => fusionar(g, clientes)} disabled={ocupado === g.clave}>{ocupado === g.clave ? "Fusionando…" : "Sí, fusionar"}</button>
                    </>
                  ) : (
                    <button className="cl-btn primario" onClick={() => setConfirmando(g.clave)} disabled={!!ocupado}>Fusionar {otros.length} en esta</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
