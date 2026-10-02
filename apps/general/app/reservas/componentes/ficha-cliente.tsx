"use client";

/* Ficha de cliente: drawer lateral con datos editables, historial de reservas y mensajes,
   fusión con otra ficha y anonimización (RGPD). La usa la sección Clientes y PanelReservas
   (evento «rsv:ficha-cliente»). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../acciones/clientes";
import type { Cliente, Restaurante } from "../tipos";
import { estadoDe, fmtFecha, fmtHora, pedirRecarga, useRecargaExterna } from "../lib-reservas";
import "./ficha-cliente.css";

/* ==================== Catálogos y helpers compartidos ==================== */

export const IDIOMAS: Record<string, string> = {
  es: "Español", en: "Inglés", ca: "Catalán", fr: "Francés", de: "Alemán", it: "Italiano", pt: "Portugués", nl: "Neerlandés",
};

export const PAISES: Record<string, string> = {
  ES: "España", GB: "Reino Unido", FR: "Francia", DE: "Alemania", IT: "Italia", NL: "Países Bajos", BE: "Bélgica", PT: "Portugal",
  CH: "Suiza", AT: "Austria", IE: "Irlanda", SE: "Suecia", DK: "Dinamarca", NO: "Noruega", FI: "Finlandia", PL: "Polonia",
  US: "Estados Unidos", CA: "Canadá", MX: "México", AR: "Argentina", BR: "Brasil", AU: "Australia", AD: "Andorra", LU: "Luxemburgo",
};

export type NivelRiesgo = "bajo" | "medio" | "alto";

/** Semáforo de riesgo de no-show a partir de reservas_clientes_stats.riesgo_no_show (0–1). */
export function nivelRiesgo(r: number | null | undefined): NivelRiesgo {
  const v = r ?? 0;
  return v >= 0.5 ? "alto" : v >= 0.2 ? "medio" : "bajo";
}
export const TEXTO_RIESGO: Record<NivelRiesgo, string> = { bajo: "Riesgo bajo", medio: "Riesgo medio", alto: "Riesgo alto" };

export function nombreCompleto(c: Pick<Cliente, "nombre" | "apellidos">): string {
  return [c.nombre, c.apellidos].filter((x) => x && x.trim()).join(" ").trim() || "Sin nombre";
}

export function iniciales(c: Pick<Cliente, "nombre" | "apellidos">): string {
  const n = (c.nombre ?? "").trim().charAt(0);
  const a = (c.apellidos ?? "").trim().charAt(0) || (c.nombre ?? "").trim().split(/\s+/)[1]?.charAt(0) || "";
  return (n + a).toUpperCase() || "?";
}

/** Abre el modal de reserva desde cualquier sección (lo atiende la barra). */
export function abrirReserva(reservaId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("rsv:abrir-reserva", { detail: reservaId }));
}

/** Pide una reserva nueva prellenada con este cliente (lo atiende la barra / el modal). */
export function nuevaReservaPara(clienteId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("rsv:nueva-reserva", { detail: { clienteId } }));
}

/** Chip de etiqueta con el color del catálogo (texto blanco o tinta según luminosidad). */
export function EtiquetaChip({ nombre, color, mini }: { nombre: string; color: string; mini?: boolean }) {
  const h = (color || "#888888").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const claro = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
  return (
    <span className={"fc-eti" + (mini ? " mini" : "")} style={{ background: color, color: claro ? "#1a1a1a" : "#fff" }} title={nombre}>
      {nombre}
    </span>
  );
}

const TEXTO_CANAL: Record<string, string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp" };
const TEXTO_MSG_ESTADO: Record<string, string> = {
  pendiente: "Pendiente", enviado: "Enviado", error: "Error", fallido: "Fallido", cancelado: "Cancelado", sin_proveedor: "Sin proveedor",
};

type Catalogos = Awaited<ReturnType<typeof api.catalogos>>;
type Ficha = Awaited<ReturnType<typeof api.ficha>>;

const VACIO: api.DatosCliente = {
  nombre: "", apellidos: null, telefono: null, telefono_adicional: null, email: null, idioma: "es", pais: "ES", codigo_postal: null,
  empresa: null, fecha_nacimiento: null, numero_socio: null, prescriptor_id: null, etiquetas: [], alergenos: [], alergias: null, notas: null,
  vip: false, lista_negra: false, consentimiento_marketing: false,
};

function desdeCliente(c: Cliente): api.DatosCliente {
  return {
    nombre: c.nombre ?? "", apellidos: c.apellidos, telefono: c.telefono, telefono_adicional: c.telefono_adicional, email: c.email,
    idioma: c.idioma || "es", pais: c.pais || "ES", codigo_postal: c.codigo_postal, empresa: c.empresa, fecha_nacimiento: c.fecha_nacimiento,
    numero_socio: c.numero_socio, prescriptor_id: c.prescriptor_id, etiquetas: c.etiquetas ?? [], alergenos: c.alergenos ?? [],
    alergias: c.alergias, notas: c.notas, vip: c.vip, lista_negra: c.lista_negra, consentimiento_marketing: c.consentimiento_marketing,
  };
}

const fmtFechaHora = (iso: string) => {
  const d = new Date(iso);
  return `${fmtFecha(d.toLocaleDateString("sv-SE"))} ${d.toTimeString().slice(0, 5)}`;
};

/* ==================== Componente ==================== */

export function FichaCliente(props: {
  /** null = alta de cliente nuevo. */
  clienteId: string | null;
  restaurantes: Restaurante[];
  cerrar: () => void;
  /** Se llama al guardar (edición o alta) con la ficha resultante. */
  guardado?: (c: Cliente) => void;
  /** Tras una fusión desde otro sitio, etc.: la ficha vuelve a cargar. */
  avisar?: (m: string) => void;
  /** Catálogos ya cargados por el padre (evita una ida más). */
  catalogos?: Catalogos | null;
}) {
  const { clienteId, restaurantes, cerrar, guardado, avisar } = props;
  // La ficha puede pasar a otra (alta recién creada o «Abrir su ficha» de un duplicado) sin
  // esperar a que el padre cambie la prop; si el padre la cambia, manda el padre.
  const [idActual, setIdActual] = useState<string | null>(clienteId);
  useEffect(() => { setIdActual(clienteId); }, [clienteId]);
  const nuevo = idActual === null;
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [cat, setCat] = useState<Catalogos | null>(props.catalogos ?? null);
  const [datos, setDatos] = useState<api.DatosCliente>(VACIO);
  const [tab, setTab] = useState<"ficha" | "historial" | "mensajes">("ficha");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [sucio, setSucio] = useState(false);
  const [cargando, setCargando] = useState(!nuevo);
  const [existente, setExistente] = useState<Cliente | null>(null);
  const [permisos, setPermisos] = useState<{ exportar: boolean; anonimizar: boolean } | null>(null);
  const [accion, setAccion] = useState<null | "fusionar" | "anonimizar">(null);
  const nombreRef = useRef<HTMLInputElement>(null);
  const sucioRef = useRef(false);
  sucioRef.current = sucio;
  const cargadoRef = useRef<string | null>(null);

  /* Carga (o recarga tras «rsv:recargar»). Si hay cambios sin guardar en el formulario, solo se
     refrescan estadísticas, historial y mensajes: lo que se está escribiendo no se pisa. */
  const cargar = useCallback(async () => {
    if (idActual === null) return;
    const primera = cargadoRef.current !== idActual;
    if (primera) setCargando(true);
    try {
      const f = await api.ficha(idActual);
      if (f.error) { setError(f.error); if (primera) setFicha(null); return; }
      setFicha(f);
      if (f.cliente && (primera || !sucioRef.current)) { setDatos(desdeCliente(f.cliente)); setSucio(false); }
      cargadoRef.current = idActual;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar la ficha.");
    } finally {
      setCargando(false);
    }
  }, [idActual]);

  useEffect(() => {
    setError(""); setExistente(null); setAccion(null); setTab("ficha");
    if (idActual === null) { cargadoRef.current = null; setFicha(null); setDatos(VACIO); setSucio(false); setCargando(false); }
    void cargar();
  }, [cargar, idActual]);
  // Al guardar una reserva desde el historial o «+ Nueva reserva», la ficha se refresca.
  useRecargaExterna(cargar);
  useEffect(() => {
    if (nuevo || permisos) return;
    api.permisos().then(setPermisos).catch(() => setPermisos({ exportar: false, anonimizar: false }));
  }, [nuevo, permisos]);
  useEffect(() => {
    if (!cat) api.catalogos().then(setCat).catch(() => { /* sin catálogos se puede seguir editando */ });
  }, [cat]);
  useEffect(() => { if (nuevo) setTimeout(() => nombreRef.current?.focus(), 50); }, [nuevo]);

  /* Esc cierra (si hay cambios sin guardar, pide confirmar con un segundo Esc).
     Se escucha en fase de captura para mirar ANTES que el modal de reserva (que escucha en burbuja
     y se desmonta en cuanto procesa su Esc): si hay un modal de reserva encima, el Esc es suyo. */
  const escRef = useRef(0);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".rsp-modal")) return;
      if (accion) { setAccion(null); return; }
      if (sucio && Date.now() - escRef.current > 1500) { escRef.current = Date.now(); avisar?.("Hay cambios sin guardar: pulsa Esc otra vez para cerrar."); return; }
      cerrar();
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [cerrar, sucio, avisar, accion]);

  const set = <K extends keyof api.DatosCliente>(k: K, v: api.DatosCliente[K]) => {
    setDatos((d) => ({ ...d, [k]: v }));
    setSucio(true);
  };
  const alternarId = (k: "etiquetas" | "alergenos", id: string) =>
    set(k, datos[k].includes(id) ? datos[k].filter((x) => x !== id) : [...datos[k], id]);

  async function guardar() {
    setError("");
    setExistente(null);
    if (!datos.nombre.trim()) { setError("El nombre es obligatorio."); nombreRef.current?.focus(); return; }
    setGuardando(true);
    try {
      const r = idActual === null ? await api.crear(datos) : await api.guardar(idActual, datos);
      if (!r.ok || !r.data) {
        setError(r.error ?? "No se ha podido guardar.");
        // Alta de alguien que ya existe: se ofrece abrir su ficha en vez de crear un duplicado.
        if (idActual === null && r.data) setExistente(r.data);
        return;
      }
      setSucio(false);
      avisar?.(idActual === null ? "Cliente creado." : "Ficha guardada.");
      guardado?.(r.data);
      if (idActual === null) setIdActual(r.data.id);
      else setFicha((f) => (f ? { ...f, cliente: r.data! } : f));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar.");
    } finally {
      setGuardando(false);
    }
  }

  function abrirExistente() {
    if (!existente) return;
    setSucio(false);
    setIdActual(existente.id);
  }

  async function anonimizar() {
    if (idActual === null) return;
    setGuardando(true);
    try {
      const r = await api.eliminar(idActual);
      if (!r.ok) { setError(r.error ?? "No se ha podido anonimizar."); return; }
      setAccion(null);
      setSucio(false);
      sucioRef.current = false;
      avisar?.("Datos personales borrados. Las reservas se conservan como «Anonimizado».");
      pedirRecarga();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido anonimizar.");
    } finally {
      setGuardando(false);
    }
  }

  const alEnter = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === "Enter") { e.preventDefault(); void guardar(); }
  };

  const c = ficha?.cliente ?? null;
  const st = ficha?.stats ?? null;
  const riesgo = nivelRiesgo(st?.riesgo_no_show);
  const nombreRest = useMemo(() => Object.fromEntries(restaurantes.map((r) => [r.id, r.nombre])), [restaurantes]);
  const idiomas = useMemo(() => {
    const m = { ...IDIOMAS };
    if (datos.idioma && !m[datos.idioma]) m[datos.idioma] = datos.idioma.toUpperCase();
    return m;
  }, [datos.idioma]);
  const paises = useMemo(() => {
    const m = { ...PAISES };
    if (datos.pais && !m[datos.pais]) m[datos.pais] = datos.pais;
    return m;
  }, [datos.pais]);

  const titulo = nuevo ? "Nuevo cliente" : c ? nombreCompleto(c) : "Cliente";

  return (
    <div className="fc-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <aside className="fc" role="dialog" aria-label={titulo} onMouseDown={(e) => e.stopPropagation()}>
        {/* ---- cabecera ---- */}
        <header className="fc-cab">
          <div className={"fc-avatar" + (c?.vip ? " vip" : "") + (c?.lista_negra ? " negra" : "")}>{c ? iniciales(c) : "+"}</div>
          <div className="fc-cab-txt">
            <h2>{titulo}</h2>
            {c ? (
              <div className="fc-sub">
                {c.telefono ? <span>{c.telefono}</span> : <span className="fc-mudo">sin teléfono</span>}
                {c.email ? <span>· {c.email}</span> : null}
                {c.empresa ? <span>· {c.empresa}</span> : null}
              </div>
            ) : (
              <div className="fc-sub fc-mudo">Alta manual desde el panel</div>
            )}
            {c ? (
              <div className="fc-chips">
                {c.vip ? <span className="fc-chip vip">VIP</span> : null}
                {c.lista_negra ? <span className="fc-chip negra">Lista negra</span> : null}
                {st && (st.reservas_total ?? 0) > 0 ? <span className={"fc-chip riesgo " + riesgo}><i />{TEXTO_RIESGO[riesgo]}</span> : null}
                {c.consentimiento_marketing ? <span className="fc-chip ok">Consentimiento</span> : null}
              </div>
            ) : null}
          </div>
          <button className="fc-cerrar" onClick={cerrar} aria-label="Cerrar">✕</button>
        </header>

        {/* ---- estadísticas ---- */}
        {!nuevo ? (
          <div className="fc-stats">
            <div><b>{st?.visitas ?? 0}</b><span>Visitas</span></div>
            <div><b className={(st?.no_shows ?? 0) > 0 ? "mal" : ""}>{st?.no_shows ?? 0}</b><span>No-shows</span></div>
            <div><b>{st?.canceladas ?? 0}</b><span>Canceladas</span></div>
            <div><b>{st?.ultima_visita ? fmtFecha(st.ultima_visita) : "—"}</b><span>Última visita</span></div>
            <div><b>{st?.proxima_reserva ? fmtFecha(st.proxima_reserva) : "—"}</b><span>Próxima</span></div>
            <div><b>{st?.pax_medio ?? "—"}</b><span>Pax medio</span></div>
            <div><b>{st?.valoracion_media != null ? `${st.valoracion_media} ★` : "—"}</b><span>Valoración</span></div>
          </div>
        ) : null}

        {/* ---- pestañas ---- */}
        {!nuevo ? (
          <nav className="fc-tabs">
            <button className={tab === "ficha" ? "activo" : ""} onClick={() => setTab("ficha")}>Ficha</button>
            <button className={tab === "historial" ? "activo" : ""} onClick={() => setTab("historial")}>Historial ({ficha?.historial.length ?? 0})</button>
            <button className={tab === "mensajes" ? "activo" : ""} onClick={() => setTab("mensajes")}>Mensajes ({ficha?.mensajes.length ?? 0})</button>
          </nav>
        ) : null}

        <div className="fc-cuerpo">
          {cargando ? <div className="spinner" /> : null}
          {!cargando && !nuevo && !c && !error ? <div className="vacio">Este cliente ya no existe (puede que se haya fusionado).</div> : null}

          {/* ---- ficha ---- */}
          {!cargando && (nuevo || c) && tab === "ficha" ? (
            <div className="fc-form">
              <div className="fc-grid">
                <label>Nombre *<input ref={nombreRef} value={datos.nombre} onChange={(e) => set("nombre", e.target.value)} onKeyDown={alEnter} autoComplete="off" /></label>
                <label>Apellidos<input value={datos.apellidos ?? ""} onChange={(e) => set("apellidos", e.target.value)} onKeyDown={alEnter} autoComplete="off" /></label>
                <label>Teléfono<input inputMode="tel" value={datos.telefono ?? ""} onChange={(e) => set("telefono", e.target.value)} onKeyDown={alEnter} placeholder="+34…" autoComplete="off" /></label>
                <label>Teléfono adicional<input inputMode="tel" value={datos.telefono_adicional ?? ""} onChange={(e) => set("telefono_adicional", e.target.value)} onKeyDown={alEnter} autoComplete="off" /></label>
                <label className="ancho">Email<input inputMode="email" value={datos.email ?? ""} onChange={(e) => set("email", e.target.value)} onKeyDown={alEnter} autoComplete="off" /></label>
                <label>Idioma
                  <select value={datos.idioma} onChange={(e) => set("idioma", e.target.value)} onKeyDown={alEnter}>
                    {Object.entries(idiomas).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label>País
                  <select value={datos.pais} onChange={(e) => set("pais", e.target.value)} onKeyDown={alEnter}>
                    {Object.entries(paises).sort((a, b) => a[1].localeCompare(b[1], "es")).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label>Código postal<input value={datos.codigo_postal ?? ""} onChange={(e) => set("codigo_postal", e.target.value)} onKeyDown={alEnter} autoComplete="off" /></label>
                <label>Empresa<input value={datos.empresa ?? ""} onChange={(e) => set("empresa", e.target.value)} onKeyDown={alEnter} autoComplete="off" /></label>
                <label>Cumpleaños<input type="date" value={datos.fecha_nacimiento ?? ""} onChange={(e) => set("fecha_nacimiento", e.target.value || null)} onKeyDown={alEnter} /></label>
                <label>Nº socio<input value={datos.numero_socio ?? ""} onChange={(e) => set("numero_socio", e.target.value)} onKeyDown={alEnter} autoComplete="off" /></label>
                <label className="ancho">Prescriptor
                  <select value={datos.prescriptor_id ?? ""} onChange={(e) => set("prescriptor_id", e.target.value || null)} onKeyDown={alEnter}>
                    <option value="">Ninguno</option>
                    {(cat?.prescriptores ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </label>
              </div>

              <div className="fc-bloque">
                <div className="fc-tit">Etiquetas</div>
                <div className="fc-selector">
                  {(cat?.etiquetas ?? []).length ? (cat?.etiquetas ?? []).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      className={"fc-opcion" + (datos.etiquetas.includes(e.id) ? " on" : "")}
                      style={datos.etiquetas.includes(e.id) ? { background: e.color, borderColor: e.color, color: "#fff" } : { borderColor: e.color, color: e.color }}
                      onClick={() => alternarId("etiquetas", e.id)}
                    >
                      {e.nombre}
                    </button>
                  )) : <span className="fc-mudo">Sin etiquetas en el catálogo (Ajustes › Etiquetas).</span>}
                </div>
              </div>

              <div className="fc-bloque">
                <div className="fc-tit">Alérgenos</div>
                <div className="fc-selector">
                  {(cat?.alergenos ?? []).map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      className={"fc-opcion" + (datos.alergenos.includes(e.id) ? " on alerg" : "")}
                      onClick={() => alternarId("alergenos", e.id)}
                    >
                      {e.nombre}
                    </button>
                  ))}
                </div>
                <label className="ancho">Otras alergias / intolerancias<input value={datos.alergias ?? ""} onChange={(e) => set("alergias", e.target.value)} onKeyDown={alEnter} placeholder="Texto libre: marisco, ajo…" /></label>
              </div>

              <div className="fc-bloque">
                <label className="ancho">Preferencias y notas internas
                  <textarea rows={4} value={datos.notas ?? ""} onChange={(e) => set("notas", e.target.value)} placeholder="Mesa preferida, cómo le gusta el vino, ocasiones…" />
                </label>
              </div>

              <div className="fc-switches">
                <label className="fc-switch"><input type="checkbox" checked={datos.vip} onChange={(e) => set("vip", e.target.checked)} /><span>VIP</span></label>
                <label className="fc-switch"><input type="checkbox" checked={datos.lista_negra} onChange={(e) => set("lista_negra", e.target.checked)} /><span>Lista negra</span></label>
                <label className="fc-switch">
                  <input type="checkbox" checked={datos.consentimiento_marketing} onChange={(e) => set("consentimiento_marketing", e.target.checked)} />
                  <span>Consentimiento comercial (email/SMS)</span>
                  {c?.consentimiento_en && datos.consentimiento_marketing ? <small>desde {fmtFecha(c.consentimiento_en.slice(0, 10))}</small> : null}
                </label>
              </div>

              {c ? (
                <div className="fc-pie-datos">
                  Alta {fmtFechaHora(c.creado_en)} · actualizado {fmtFechaHora(c.actualizado_en)}
                  {c.cover_id ? <> · Cover #{c.cover_id}</> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ---- historial ---- */}
          {!cargando && c && tab === "historial" ? (
            ficha?.historial.length ? (
              <div className="fc-lista">
                {ficha.historial.map((r) => {
                  const e = estadoDe(r.estado);
                  return (
                    <button key={r.id} type="button" className="fc-res" onClick={() => abrirReserva(r.id)} title="Abrir la reserva">
                      <span className="fc-res-fecha"><b>{fmtFecha(r.fecha)}</b><small>{fmtHora(r.hora)}</small></span>
                      <span className="fc-res-txt">
                        <b>{nombreRest[r.restaurante_id] ?? "—"}</b>
                        <small>{r.pax} pax{r.reservas_mesas?.nombre ? ` · mesa ${r.reservas_mesas.nombre}` : ""}{r.localizador ? ` · ${r.localizador}` : ""}</small>
                      </span>
                      {r.valoracion != null ? <span className="fc-res-val">{r.valoracion} ★</span> : null}
                      <span className="fc-res-estado" style={{ background: e.color, color: e.borde ? "#1a1a1a" : "#fff", borderColor: e.borde ?? e.color }}>{e.texto}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="vacio">Sin reservas todavía.</div>
            )
          ) : null}

          {/* ---- mensajes ---- */}
          {!cargando && c && tab === "mensajes" ? (
            ficha?.mensajes.length ? (
              <div className="fc-lista">
                {ficha.mensajes.map((m) => (
                  <div key={m.id} className="fc-msg">
                    <span className="fc-msg-canal">{TEXTO_CANAL[m.canal] ?? m.canal}</span>
                    <span className="fc-msg-txt">
                      <b>{m.asunto || m.tipo}</b>
                      <small>{fmtFechaHora(m.enviado_en ?? m.creado_en)} · {m.destinatario}{m.error ? ` · ${m.error}` : ""}</small>
                    </span>
                    <span className={"fc-msg-estado " + m.estado}>{TEXTO_MSG_ESTADO[m.estado] ?? m.estado}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="vacio">No se le ha enviado ningún mensaje.</div>
            )
          ) : null}
        </div>

        {/* ---- pie ---- */}
        <footer className="fc-pie">
          {error ? (
            <div className="fc-error">
              {error}
              {existente ? <button type="button" className="fc-btn mini" onClick={abrirExistente}>Abrir su ficha</button> : null}
            </div>
          ) : null}
          {c && accion === "fusionar" ? (
            <PanelFusion
              cliente={c}
              cerrar={() => setAccion(null)}
              hecho={(movidas, otro) => {
                setAccion(null);
                avisar?.(`${nombreCompleto(otro)} fusionado en esta ficha. ${movidas} reserva${movidas === 1 ? "" : "s"} movida${movidas === 1 ? "" : "s"}.`);
                pedirRecarga();
              }}
            />
          ) : null}
          {c && accion === "anonimizar" ? (
            <div className="fc-confirma">
              <span>Se borrarán nombre, teléfonos, email, notas, alergias y demás datos personales. Las reservas se conservan para las estadísticas. No se puede deshacer.</span>
              <div className="fc-confirma-botones">
                <button type="button" className="fc-btn sec" onClick={() => setAccion(null)} disabled={guardando}>Cancelar</button>
                <button type="button" className="fc-btn peligro" onClick={() => void anonimizar()} disabled={guardando}>{guardando ? "Anonimizando…" : "Sí, anonimizar"}</button>
              </div>
            </div>
          ) : null}
          {c && !accion ? (
            <div className="fc-acciones">
              <button type="button" className="fc-enlace" onClick={() => setAccion("fusionar")}>Fusionar con otra ficha…</button>
              {permisos?.anonimizar ? <button type="button" className="fc-enlace peligro" onClick={() => setAccion("anonimizar")}>Anonimizar (RGPD)</button> : null}
            </div>
          ) : null}
          <div className="fc-pie-botones">
            {c ? (
              <button type="button" className="fc-btn sec" onClick={() => nuevaReservaPara(c.id)}>+ Nueva reserva para este cliente</button>
            ) : <span />}
            <button type="button" className="fc-btn" disabled={guardando || (!sucio && !nuevo)} onClick={() => void guardar()}>
              {guardando ? "Guardando…" : nuevo ? "Crear cliente" : "Guardar"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

/* ==================== Fusionar con otra ficha ==================== */

/** Busca otra ficha (mismo buscador que la tabla) y la fusiona EN la actual: sirve para la
    misma persona con dos teléfonos o emails distintos, que el panel de duplicados no detecta. */
function PanelFusion({ cliente, cerrar, hecho }: {
  cliente: Cliente;
  cerrar: () => void;
  hecho: (reservasMovidas: number, otro: api.ClienteFila) => void;
}) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<api.ClienteFila[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<api.ClienteFila | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const peticion = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRes([]); return; }
    const n = ++peticion.current;
    const id = setTimeout(async () => {
      setBuscando(true);
      const r = await api.buscar({ q: t, orden: "nombre", dir: "asc" }, 0);
      if (n !== peticion.current) return;
      setBuscando(false);
      if (r.error) { setError(r.error); return; }
      setError("");
      setRes(r.filas.filter((x) => x.id !== cliente.id).slice(0, 8));
    }, 300);
    return () => clearTimeout(id);
  }, [q, cliente.id]);

  async function fusionar() {
    if (!elegido) return;
    setOcupado(true);
    setError("");
    try {
      const r = await api.fusionar(elegido.id, cliente.id);
      if (!r.ok) { setError(r.error ?? "No se ha podido fusionar."); return; }
      hecho(r.data?.reservasMovidas ?? 0, elegido);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="fc-fusion">
      <div className="fc-fusion-cab">
        <b>Fusionar con otra ficha</b>
        <button type="button" className="fc-enlace" onClick={cerrar}>Cancelar</button>
      </div>
      {elegido ? (
        <div className="fc-confirma">
          <span>
            Las reservas y mensajes de <b>{nombreCompleto(elegido)}</b>{elegido.telefono ? ` (${elegido.telefono})` : ""} pasarán a esta ficha
            y su ficha se borrará. Los datos de esta ficha no cambian. No se puede deshacer.
          </span>
          <div className="fc-confirma-botones">
            <button type="button" className="fc-btn sec" onClick={() => setElegido(null)} disabled={ocupado}>Elegir otra</button>
            <button type="button" className="fc-btn peligro" onClick={() => void fusionar()} disabled={ocupado}>{ocupado ? "Fusionando…" : "Sí, fusionar"}</button>
          </div>
        </div>
      ) : (
        <>
          <input ref={inputRef} className="fc-fusion-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar la otra ficha por nombre, teléfono o email…" autoComplete="off" />
          <div className="fc-fusion-res">
            {buscando && !res.length ? <span className="fc-mudo">Buscando…</span> : null}
            {!buscando && q.trim().length >= 2 && !res.length ? <span className="fc-mudo">Ninguna otra ficha coincide.</span> : null}
            {res.map((x) => (
              <button key={x.id} type="button" className="fc-fusion-item" onClick={() => setElegido(x)}>
                <b>{nombreCompleto(x)}</b>
                <small>{[x.telefono, x.email, `${x.stats?.reservas_total ?? 0} reservas`].filter(Boolean).join(" · ")}</small>
              </button>
            ))}
          </div>
        </>
      )}
      {error ? <div className="fc-error">{error}</div> : null}
    </div>
  );
}
