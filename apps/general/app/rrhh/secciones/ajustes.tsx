"use client";

/* Sección Ajustes (plan 2.8). Un aside con subsecciones; cada una guarda al momento o con un botón claro.
   Nada de prompt()/confirm(): modales propios y toasts (avisar). */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as api from "../acciones";
import * as aj from "../acciones/ajustes";
import type { Convenio, Dispositivo } from "../tipos";
import { fmtFecha, fmtFechaCorta, guardarPref, leerPref, type SecProps } from "../lib-rrhh";
import "./ajustes.css";

type Datos = Awaited<ReturnType<typeof aj.cargarAjustes>>;
type Avisar = (m: string) => void;
type SubProps = { datos: Datos; recargar: () => void; avisar: Avisar };

const SUBS = [
  ["convenios", "Convenios y reglas", "Descansos, jornadas, vacaciones"],
  ["centros", "Centros y fichaje", "Validación, ubicación y convenio"],
  ["puestos", "Puestos", "Catálogo con color"],
  ["ausencias", "Tipos de ausencia", "Categorías y contadores"],
  ["festivos", "Festivos", "Nacionales, autonómicos y locales"],
  ["plantillas", "Plantillas de turno", "Turnos rápidos por centro"],
  ["encargados", "Encargados por centro", "Quién gestiona cada centro"],
  ["catalogos", "Departamentos y contratos", "Listas de la ficha"],
  ["matriz", "Departamentos por centro", "Qué hay en cada centro"],
  ["tablets", "Tablets", "Kioscos de fichaje"],
] as const;
type Sub = (typeof SUBS)[number][0];
const esSub = (v: string): v is Sub => SUBS.some((s) => s[0] === v);

/** Color por departamento (plan 1.1) para proponer al crear un puesto. */
const COLOR_DEPTO: Record<string, string> = {
  cocina: "#E8590C", sala: "#1D9E75", recepcion: "#185FA5", visitas: "#534AB7", tienda: "#BA7517",
  bodega: "#7B1FA2", campo: "#2E7D32", mantenimiento: "#607D8B", administracion: "#455A64", direccion: "#1a1a1a",
};
const sinAcentos = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const colorDeDepto = (nombre: string | null | undefined) => (nombre ? COLOR_DEPTO[sinAcentos(nombre)] : undefined) ?? "#888888";
const hhmm = (t: string | null | undefined) => (t ?? "").slice(0, 5);
const num = (v: string, def: number) => (v.trim() === "" || Number.isNaN(Number(v)) ? def : Number(v));

export default function SecAjustes({ ctx, avisar }: SecProps) {
  const [sub, setSubEstado] = useState<Sub>(() => {
    const g = leerPref<string>("ajustes:sub", "convenios");
    return esSub(g) ? g : "convenios";
  });
  const setSub = (s: Sub) => { setSubEstado(s); guardarPref("ajustes:sub", s); };
  const [datos, setDatos] = useState<Datos | null>(null);

  const recargar = useCallback(() => { aj.cargarAjustes().then(setDatos).catch(() => avisar("No se pudieron cargar los ajustes")); }, [avisar]);
  useEffect(() => { recargar(); }, [recargar]);

  if (!datos) return <div className="vacio">Cargando…</div>;
  const props: SubProps = { datos, recargar, avisar };

  return (
    <>
      <div className="layout-aj">
        <aside className="aside-aj">
          {SUBS.map(([id, titulo, det]) => (
            <button key={id} className={`nav-sec ${sub === id ? "activa" : ""}`} onClick={() => setSub(id)}>
              {titulo}<small>{det}</small>
            </button>
          ))}
        </aside>
        <section className="aj-cuerpo">
          {sub === "convenios" ? <SubConvenios {...props} /> : null}
          {sub === "centros" ? <SubCentros {...props} /> : null}
          {sub === "puestos" ? <SubPuestos {...props} /> : null}
          {sub === "ausencias" ? <SubTiposAusencia {...props} /> : null}
          {sub === "festivos" ? <SubFestivos {...props} /> : null}
          {sub === "plantillas" ? <SubPlantillas {...props} /> : null}
          {sub === "encargados" ? <SubEncargados {...props} /> : null}
          {sub === "catalogos" ? <SubCatalogos {...props} /> : null}
          {sub === "matriz" ? <SubMatriz {...props} /> : null}
          {sub === "tablets" ? <SubTablets ctx={ctx} avisar={avisar} /> : null}
        </section>
      </div>
    </>
  );
}

/* ==================== Piezas comunes ==================== */

function Modal({ titulo, sub, onCerrar, children, ancho }: { titulo: string; sub?: string; onCerrar: () => void; children: ReactNode; ancho?: number }) {
  // Esc cierra, como en Skello. onCerrar suele ser una arrow nueva en cada render: re-suscribir es barato.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onCerrar]);
  return (
    <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} style={ancho ? { maxWidth: ancho } : undefined}>
        <h2>{titulo}</h2>
        {sub ? <div className="sub">{sub}</div> : null}
        {children}
      </div>
    </div>
  );
}

function Confirmar({ titulo, texto, textoOk, peligro, onOk, onCancelar }: {
  titulo: string; texto: ReactNode; textoOk?: string; peligro?: boolean; onOk: () => void | Promise<void>; onCancelar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal titulo={titulo} onCerrar={onCancelar}>
      <div className="aj-texto">{texto}</div>
      <div className="modal-acciones">
        <button type="button" className="btn btn-fantasma" onClick={onCancelar}>Cancelar</button>
        <button type="button" className={`btn ${peligro ? "btn-borrar" : "btn-primario"}`} disabled={ocupado} onClick={async () => {
          setOcupado(true);
          // Si la acción de servidor revienta (red caída), el botón no puede quedarse bloqueado para siempre.
          try { await onOk(); } catch { onCancelar(); } finally { setOcupado(false); }
        }}>
          {textoOk ?? "Confirmar"}
        </button>
      </div>
    </Modal>
  );
}

function Switch({ checked, onChange, title, label }: { checked: boolean; onChange: (v: boolean) => void; title?: string; label?: string }) {
  return (
    <label className="switch" title={title}>
      <input type="checkbox" checked={checked} aria-label={label ?? title} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" />
    </label>
  );
}

/** Resultado de un guardado en línea: `false` = no se guardó (el campo vuelve al valor anterior). */
type Guardado = void | boolean | Promise<void | boolean>;

/** Texto editable en la propia tabla: guarda al salir del campo si ha cambiado.
    Si el guardado falla, recargar() trae el mismo valor y el efecto no se dispara: por eso se restaura a mano. */
function TextoInline({ valor, onGuardar, placeholder, ancho, mayus, label }: { valor: string; onGuardar: (v: string) => Guardado; placeholder?: string; ancho?: number; mayus?: boolean; label?: string }) {
  const [v, setV] = useState(valor);
  useEffect(() => { setV(valor); }, [valor]);
  return (
    <input
      className={`aj-inline ${mayus ? "aj-mayus" : ""}`}
      value={v}
      placeholder={placeholder}
      aria-label={label}
      style={ancho ? { width: ancho } : undefined}
      onChange={(e) => setV(e.target.value)}
      onBlur={async () => {
        const t = v.trim();
        if (t === valor) return;
        const ok = await onGuardar(t);
        if (ok === false) setV(valor);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setV(valor); }}
    />
  );
}

/** Selector de color: guarda al cerrar el selector (evento nativo `change`, que el navegador dispara al cerrar
    el picker aunque el input no pierda el foco) y, por si acaso, también al salir del campo. */
function ColorInline({ valor, onGuardar, label }: { valor: string; onGuardar: (v: string) => Guardado; label?: string }) {
  const [v, setV] = useState(valor);
  const ref = useRef<HTMLInputElement>(null);
  const ultimo = useRef(valor);
  useEffect(() => { setV(valor); ultimo.current = valor; }, [valor]);
  const guardar = useCallback(async (nuevo: string) => {
    if (nuevo === ultimo.current) return;
    ultimo.current = nuevo;
    const ok = await onGuardar(nuevo);
    if (ok === false) { ultimo.current = valor; setV(valor); }
  }, [onGuardar, valor]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = () => { void guardar(el.value); };
    el.addEventListener("change", h);
    return () => el.removeEventListener("change", h);
  }, [guardar]);
  return <input ref={ref} type="color" className="aj-color" value={v} aria-label={label} onChange={(e) => setV(e.target.value)} onBlur={() => { void guardar(v); }} />;
}

/* ==================== Convenios y reglas ==================== */

type ReglaNum = [keyof Convenio & string, string, string, string];
const REGLAS_AVISO: ReglaNum[] = [
  ["descanso_diario_h", "Descanso diario mínimo", "horas libres entre jornadas", "h"],
  ["descanso_semanal_dias", "Descanso semanal", "días libres consecutivos por semana", "días"],
  ["max_dias_consecutivos", "Máximo días seguidos", "días de trabajo sin descanso", "días"],
  ["jornada_max_diaria_h", "Jornada máxima diaria", "horas máximas en un día", "h"],
  ["jornada_min_diaria_h", "Jornada mínima por turno", "salvo petición del trabajador", "h"],
  ["jornada_max_semanal_h", "Jornada máxima semanal", "media semanal anual", "h"],
  ["pausa_tras_h", "Pausa obligatoria tras", "horas seguidas trabajadas", "h"],
  ["pausa_min_minutos", "Duración mínima de la pausa", "", "min"],
];
const REGLAS_CONTADOR: ReglaNum[] = [
  ["dias_vacaciones_anuales", "Vacaciones al año", "días naturales por año completo de contrato", "días"],
  ["dias_laborables_semana", "Días laborables por semana", "para valorar una ausencia de jornada completa", "días"],
  ["jornada_anual_h", "Jornada anual", "si lo rellenas, el contador anual compara contra esta cifra", "h"],
  ["horas_extra_max_anual", "Tope de horas extra al año", "al pasarlo, Contadores avisa", "h"],
  ["complementarias_max_pct", "Tope de complementarias", "% sobre la jornada, a tiempo parcial", "%"],
  ["coste_empresa_pct", "Coste de empresa sobre el bruto", "Seguridad Social a cargo de la empresa: coste = horas × €/hora × (1 + este %). Skello usa 32,15", "%"],
];
const OBLIGATORIAS = new Set(["dias_vacaciones_anuales", "dias_laborables_semana", "horas_extra_max_anual", "complementarias_max_pct", "coste_empresa_pct"]);
const PASO: Partial<Record<string, number>> = { complementarias_max_pct: 1, coste_empresa_pct: 0.01 };

function SubConvenios({ datos, recargar, avisar }: SubProps) {
  const [convSel, setConvSel] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<null | { modo: "nuevo" | "duplicar" }>(null);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [copiaDe, setCopiaDe] = useState("");

  const conv = datos.convenios.find((x) => x.id === convSel) ?? datos.convenios.find((c) => c.es_por_defecto) ?? datos.convenios[0];

  useEffect(() => {
    if (!conv) return;
    const r: Record<string, string> = { nombre: conv.nombre, nocturno_inicio: hhmm(conv.nocturno_inicio), nocturno_fin: hhmm(conv.nocturno_fin) };
    for (const [k] of [...REGLAS_AVISO, ...REGLAS_CONTADOR]) r[k] = conv[k] != null ? String(conv[k]) : "";
    setForm(r);
  }, [conv]);

  if (!conv) {
    return (
      <>
        <h2>Convenios y reglas</h2>
        <div className="vacio">No hay ningún convenio. <button className="link-btn2" onClick={() => { setNuevoNombre(""); setCopiaDe(""); setModal({ modo: "nuevo" }); }}>Crear el primero</button></div>
        {modal ? modalNuevo() : null}
      </>
    );
  }

  const campo = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function guardar() {
    const campos: aj.CamposConvenio = { nombre: form.nombre?.trim() };
    if (!campos.nombre) { avisar("El convenio necesita nombre"); return; }
    for (const [k] of [...REGLAS_AVISO, ...REGLAS_CONTADOR]) {
      const v = (form[k] ?? "").trim();
      if (v === "") {
        if (OBLIGATORIAS.has(k)) { avisar(`Rellena «${[...REGLAS_CONTADOR].find((r) => r[0] === k)?.[1]}»`); return; }
        (campos as Record<string, unknown>)[k] = null;
      } else {
        if (Number.isNaN(Number(v)) || Number(v) < 0) { avisar("Hay un valor que no es un número válido"); return; }
        (campos as Record<string, unknown>)[k] = Number(v);
      }
    }
    if (!/^\d{2}:\d{2}$/.test(form.nocturno_inicio) || !/^\d{2}:\d{2}$/.test(form.nocturno_fin)) { avisar("Revisa el tramo nocturno"); return; }
    campos.nocturno_inicio = form.nocturno_inicio;
    campos.nocturno_fin = form.nocturno_fin;
    const r = await aj.guardarConvenio(conv.id, campos);
    avisar(r.ok ? "Convenio guardado" : "No se pudo guardar: " + r.error);
    if (r.ok) recargar();
  }

  function modalNuevo() {
    const duplicar = modal?.modo === "duplicar";
    return (
      <Modal titulo={duplicar ? "Duplicar convenio" : "Nuevo convenio"} sub={duplicar ? `Copia todas las reglas de «${conv?.nombre}».` : "Puedes partir de uno existente o empezar con los valores por defecto."} onCerrar={() => setModal(null)}>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const r = await aj.crearConvenio(nuevoNombre, duplicar ? conv!.id : copiaDe || null);
          avisar(r.ok ? "Convenio creado" : "No se pudo crear: " + r.error);
          if (r.ok && r.data) { setModal(null); setConvSel(r.data); recargar(); }
        }}>
          <label>Nombre</label>
          <input autoFocus value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Ej.: Hostelería Baleares 2027" />
          {!duplicar ? (
            <>
              <label>Copiar reglas de</label>
              <select value={copiaDe} onChange={(e) => setCopiaDe(e.target.value)}>
                <option value="">— valores por defecto —</option>
                {datos.convenios.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </>
          ) : null}
          <div className="modal-acciones">
            <button type="button" className="btn btn-fantasma" onClick={() => setModal(null)}>Cancelar</button>
            <button type="submit" className="btn btn-primario">Crear</button>
          </div>
        </form>
      </Modal>
    );
  }

  const centrosConEste = datos.config.filter((c) => c.convenio_id === conv.id).map((c) => datos.centros.find((x) => x.id === c.centro_id)?.nombre).filter(Boolean);

  return (
    <>
      <h2>Convenios y reglas</h2>
      <div className="nota" style={{ margin: "4px 0 14px" }}>Las reglas alimentan los avisos del cuadrante y los contadores. No bloquean: avisan.</div>
      <div className="aj-cab-conv">
        <div className="chip-conv">
          {datos.convenios.map((x) => (
            <button key={x.id} className={x.id === conv.id ? "activa" : ""} onClick={() => setConvSel(x.id)}>
              {x.nombre}{x.es_por_defecto ? <span className="badge-def">por defecto</span> : null}
            </button>
          ))}
        </div>
        <div className="aj-cab-botones">
          <button className="btn btn-fantasma btn-peque" onClick={() => { setNuevoNombre(conv.nombre + " (copia)"); setModal({ modo: "duplicar" }); }}>Duplicar</button>
          <button className="btn btn-fantasma btn-peque" onClick={() => { setNuevoNombre(""); setCopiaDe(""); setModal({ modo: "nuevo" }); }}>+ Nuevo convenio</button>
        </div>
      </div>

      <div className="panel">
        <div className="aj-fila-nombre">
          <div style={{ flex: 1 }}>
            <label style={{ marginTop: 0 }}>Nombre del convenio</label>
            <input value={form.nombre ?? ""} onChange={(e) => campo("nombre", e.target.value)} style={{ width: "100%" }} />
          </div>
          {!conv.es_por_defecto ? (
            <button className="btn btn-fantasma btn-peque" onClick={async () => {
              const r = await aj.marcarConvenioDefecto(conv.id);
              avisar(r.ok ? `«${conv.nombre}» es ahora el convenio por defecto` : "No se pudo: " + r.error);
              if (r.ok) recargar();
            }}>Hacer por defecto</button>
          ) : null}
        </div>
        <div className="nota" style={{ marginTop: 8 }}>
          {conv.es_por_defecto ? "Es el que se aplica a cualquier centro sin convenio propio." : "Un centro lo usa si lo eliges en «Centros y fichaje»."}
          {centrosConEste.length ? <> Lo tienen: {centrosConEste.join(", ")}.</> : <> Ahora no lo tiene ningún centro de forma explícita.</>}
        </div>
      </div>

      <div className="panel">
        <h3>Descansos y jornadas (avisos del cuadrante)</h3>
        <div className="nota" style={{ marginBottom: 12 }}>Deja un campo vacío para desactivar ese aviso.</div>
        {REGLAS_AVISO.map(([k, t, d, u]) => (
          <div key={k} className="grid-regla">
            <div className="txt">{t}<small>{d}</small></div>
            <div className="aj-regla-input">
              <input type="number" step={0.5} min={0} value={form[k] ?? ""} onChange={(e) => campo(k, e.target.value)} />
              <span>{u}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>Vacaciones, contadores y nocturnidad</h3>
        <div className="nota" style={{ marginBottom: 12 }}>Lo que usan Contadores y el informe de nómina. El coste de empresa solo lo aplica dirección (es quien ve el coste por hora de cada empleado).</div>
        {REGLAS_CONTADOR.map(([k, t, d, u]) => (
          <div key={k} className="grid-regla">
            <div className="txt">{t}{OBLIGATORIAS.has(k) ? "" : <span className="aj-opcional"> · opcional</span>}<small>{d}</small></div>
            <div className="aj-regla-input">
              <input type="number" step={PASO[k] ?? 0.5} min={0} value={form[k] ?? ""} onChange={(e) => campo(k, e.target.value)} />
              <span>{u}</span>
            </div>
          </div>
        ))}
        <div className="grid-regla">
          <div className="txt">Tramo nocturno<small>las horas de turno dentro de este tramo cuentan como nocturnas en el informe de nómina</small></div>
          <div className="aj-regla-input aj-tramo">
            <input type="time" value={form.nocturno_inicio ?? ""} onChange={(e) => campo("nocturno_inicio", e.target.value)} />
            <span>a</span>
            <input type="time" value={form.nocturno_fin ?? ""} onChange={(e) => campo("nocturno_fin", e.target.value)} />
          </div>
        </div>
        <div className="fila-guardar">
          <button className="btn btn-primario" onClick={guardar}>Guardar convenio</button>
        </div>
      </div>
      {modal ? modalNuevo() : null}
    </>
  );
}

/* ==================== Centros y fichaje ==================== */

const REGLAS_HORAS: [aj.CamposCentroConfig["regla_horas"], string, string][] = [
  ["plan_tolerancia", "Planificado con tolerancia", "Si el fichaje se desvía menos de la tolerancia, se retienen las horas del turno planificado. Si se desvía más, las fichadas. Es lo que hace Skello por defecto."],
  ["planificado", "Siempre lo planificado", "Se retienen las horas del turno, fiche como fiche. El fichaje queda solo como registro. Útil mientras las tablets no sean fiables."],
  ["fichado", "Siempre lo fichado", "Se retienen las horas fichadas tal cual (con el redondeo que elijas). Si no hay fichaje, 0 h hasta que lo corrijas."],
];

function SubCentros({ datos, recargar, avisar }: SubProps) {
  return (
    <>
      <h2>Centros y fichaje</h2>
      <div className="nota" style={{ margin: "4px 0 14px" }}>Por centro: cómo se calculan las horas retenidas a partir del fichaje, convenio, pacto de descanso y ubicación para el fichaje móvil.</div>
      {datos.centros.map((c) => {
        const cfg = datos.config.find((x) => x.centro_id === c.id);
        if (!cfg) return <div key={c.id} className="panel"><h3>{c.nombre}</h3><div className="nota">Este centro aún no tiene configuración de RRHH (se crea con la migración).</div></div>;
        return <PanelCentro key={c.id} centro={c} cfg={cfg} convenios={datos.convenios} avisar={avisar} recargar={recargar} />;
      })}
    </>
  );
}

function PanelCentro({ centro, cfg, convenios, avisar, recargar }: { centro: aj.CentroAj; cfg: Datos["config"][number]; convenios: Convenio[]; avisar: Avisar; recargar: () => void }) {
  const [lat, setLat] = useState(centro.lat != null ? String(centro.lat) : "");
  const [lng, setLng] = useState(centro.lng != null ? String(centro.lng) : "");
  const [radio, setRadio] = useState(String(cfg.radio_fichaje_m ?? 150));
  const [convenioId, setConvenioId] = useState(cfg.convenio_id ?? "");
  const [pacto, setPacto] = useState(!!cfg.pacto_descanso_10h);
  const [regla, setRegla] = useState<aj.CamposCentroConfig["regla_horas"]>((cfg.regla_horas as aj.CamposCentroConfig["regla_horas"]) || "plan_tolerancia");
  const [tol, setTol] = useState(String(cfg.tolerancia_min ?? 10));
  const [red, setRed] = useState(String(cfg.redondeo_min ?? 0));
  const [aviso, setAviso] = useState(String(cfg.aviso_retraso_min ?? 10));
  const [abierto, setAbierto] = useState(false);
  const porDefecto = convenios.find((c) => c.es_por_defecto);
  const convNombre = convenios.find((c) => c.id === convenioId)?.nombre ?? (porDefecto ? `${porDefecto.nombre} (por defecto)` : "—");

  return (
    <div className="panel aj-centro">
      <button className="aj-centro-cab" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}>
        <h3>{centro.nombre}</h3>
        <span className="aj-centro-resumen">
          {REGLAS_HORAS.find((r) => r[0] === regla)?.[1]}
          {regla === "plan_tolerancia" ? ` · ±${tol} min` : ""}
          {regla !== "planificado" ? ` · redondeo ${red === "0" ? "no" : `${red} min`}` : ""}
          {` · ${convNombre}`}
          {centro.lat == null ? <span className="aj-pill-amber">sin ubicación</span> : null}
        </span>
        <span className="aj-chevron">{abierto ? "▾" : "▸"}</span>
      </button>
      {abierto ? (
        <>
          <h4 className="aj-h4">Cómo se retienen las horas</h4>
          <div className="aj-reglas-horas">
            {REGLAS_HORAS.map(([id, t, d]) => (
              <label key={id} className={`aj-opcion ${regla === id ? "activa" : ""}`}>
                <input type="radio" name={`regla-${centro.id}`} checked={regla === id} onChange={() => setRegla(id)} />
                <span><b>{t}</b><small>{d}</small></span>
              </label>
            ))}
          </div>
          <div className="grid-3">
            <div><label>Tolerancia (min)</label><input type="number" min={0} step={1} value={tol} onChange={(e) => setTol(e.target.value)} disabled={regla !== "plan_tolerancia"} /><small className="nota">Desvío que se perdona antes de retener lo fichado.</small></div>
            <div><label>Redondeo del fichaje</label>
              <select value={red} onChange={(e) => setRed(e.target.value)}>
                <option value="0">Sin redondeo</option><option value="5">A 5 minutos</option><option value="10">A 10 minutos</option><option value="15">A 15 minutos</option>
              </select>
              <small className="nota">La hora fichada se redondea al múltiplo más cercano.</small>
            </div>
            <div><label>Aviso de retraso (min)</label><input type="number" min={0} step={1} value={aviso} onChange={(e) => setAviso(e.target.value)} /><small className="nota">A partir de aquí el día se marca en ámbar en Fichajes y Hoy.</small></div>
          </div>

          <h4 className="aj-h4">Convenio y descanso</h4>
          <div className="grid-2">
            <div><label>Convenio</label>
              <select value={convenioId} onChange={(e) => setConvenioId(e.target.value)} style={{ width: "100%" }}>
                <option value="">— el de la cuenta{porDefecto ? ` (${porDefecto.nombre})` : ""} —</option>
                {convenios.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
            </div>
            <div className="check" style={{ marginTop: 28 }}>
              <input type="checkbox" id={`rh-pacto-${centro.id}`} checked={pacto} onChange={(e) => setPacto(e.target.checked)} />
              <label htmlFor={`rh-pacto-${centro.id}`} style={{ margin: 0 }}>Pacto de descanso reducido a 10 h entre jornadas</label>
            </div>
          </div>

          <h4 className="aj-h4">Fichaje móvil</h4>
          <div className="nota" style={{ marginBottom: 6 }}>Para obtener latitud y longitud: abre Google Maps, clic derecho sobre el local y copia los dos números.</div>
          <div className="grid-3">
            <div><label>Latitud</label><input type="number" step={0.000001} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="39.8xxxxx" /></div>
            <div><label>Longitud</label><input type="number" step={0.000001} value={lng} onChange={(e) => setLng(e.target.value)} placeholder="4.2xxxxx" /></div>
            <div><label>Radio de fichaje (m)</label><input type="number" min={20} step={10} value={radio} onChange={(e) => setRadio(e.target.value)} /></div>
          </div>
          <div className="fila-guardar">
            <button className="btn btn-primario btn-peque" onClick={async () => {
              const geoNueva = { lat: lat === "" ? null : Number(lat), lng: lng === "" ? null : Number(lng) };
              const geoCambia = geoNueva.lat !== centro.lat || geoNueva.lng !== centro.lng;
              const r = await aj.guardarCentroConfig(centro.id, {
                radio_fichaje_m: num(radio, 150),
                convenio_id: convenioId || null,
                pacto_descanso_10h: pacto,
                regla_horas: regla,
                tolerancia_min: Math.round(num(tol, 10)),
                redondeo_min: Number(red) as 0 | 5 | 10 | 15,
                aviso_retraso_min: Math.round(num(aviso, 10)),
              }, geoCambia ? geoNueva : null);
              if (!r.ok) { avisar("No se pudo guardar: " + r.error); return; }
              avisar(r.data?.geoGuardada ? `${centro.nombre}: guardado` : `${centro.nombre}: reglas guardadas, pero la ubicación solo la puede cambiar el operador`);
              recargar();
            }}>Guardar {centro.nombre}</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ==================== Puestos ==================== */

const SIN_DEPTO = "Sin departamento";

function SubPuestos({ datos, recargar, avisar }: SubProps) {
  const [filtro, setFiltro] = useState("");
  const [deptoSel, setDeptoSel] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [fusion, setFusion] = useState<aj.PuestoCat | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const deptoNombre = (id: string | null) => datos.departamentos.find((d) => d.id === id)?.nombre ?? null;

  // Agrupados por departamento (como las filas del cuadrante) y, dentro, por orden y nombre. «Sin departamento» al final.
  const lista = useMemo(() => {
    const f = sinAcentos(filtro.trim());
    const nombre = (id: string | null) => datos.departamentos.find((d) => d.id === id)?.nombre ?? null;
    const filas = datos.puestos
      .filter((p) => (verInactivos || p.activo) && (!deptoSel || (deptoSel === "sin" ? !p.departamento_id : p.departamento_id === deptoSel)) && (!f || sinAcentos(p.nombre).includes(f) || sinAcentos(nombre(p.departamento_id) ?? "").includes(f)))
      .map((p) => ({ p, grupo: nombre(p.departamento_id) }));
    filas.sort((a, b) => {
      if ((a.grupo === null) !== (b.grupo === null)) return a.grupo === null ? 1 : -1;
      const g = (a.grupo ?? "").localeCompare(b.grupo ?? "");
      if (g) return g;
      return (a.p.orden - b.p.orden) || a.p.nombre.localeCompare(b.p.nombre);
    });
    return filas;
  }, [datos.puestos, datos.departamentos, filtro, deptoSel, verInactivos]);

  const guardar = async (p: aj.PuestoCat, campos: aj.CamposPuesto, msg = "Guardado") => {
    const r = await aj.guardarPuesto(p.id, campos);
    avisar(r.ok ? msg : "No se pudo guardar: " + r.error);
    recargar();
    return r.ok;
  };
  const inactivos = datos.puestos.filter((p) => !p.activo).length;
  const deptosConPuesto = datos.departamentos.filter((d) => datos.puestos.some((p) => p.departamento_id === d.id));
  const haySinDepto = datos.puestos.some((p) => !p.departamento_id);

  return (
    <>
      <h2>Puestos</h2>
      <div className="nota" style={{ margin: "4px 0 14px" }}>Los puestos de los turnos. El color es el del chip en el cuadrante; el departamento agrupa las filas. Si hay dos puestos que son lo mismo con otra grafía, fusiónalos.</div>
      <div className="aj-filtros">
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar puesto o departamento…" aria-label="Buscar puesto" style={{ flex: 1, minWidth: 200 }} />
        <select value={deptoSel} onChange={(e) => setDeptoSel(e.target.value)} aria-label="Departamento">
          <option value="">Todos los departamentos</option>
          {deptosConPuesto.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          {haySinDepto ? <option value="sin">{SIN_DEPTO}</option> : null}
        </select>
        <label className="aj-check-inline"><input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Ver desactivados{inactivos ? ` (${inactivos})` : ""}</label>
        <button className="btn btn-primario btn-peque" onClick={() => setNuevo(true)}>+ Nuevo puesto</button>
      </div>
      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="aj aj-tabla-puestos">
          <thead><tr><th className="c">Color</th><th>Puesto</th><th>Departamento</th><th className="c">Orden</th><th className="c">Activo</th><th /></tr></thead>
          <tbody>
            {lista.map(({ p, grupo }, i) => (
              <Fragment key={p.id}>
                {i === 0 || lista[i - 1].grupo !== grupo ? (
                  <tr className="aj-grupo"><td colSpan={6}>{grupo ?? SIN_DEPTO}</td></tr>
                ) : null}
                <tr className={p.activo ? "" : "aj-inactivo"}>
                  <td className="c"><ColorInline valor={p.color} label={`${p.nombre}: color`} onGuardar={(v) => guardar(p, { color: v }, "Color guardado")} /></td>
                  <td><TextoInline valor={p.nombre} label="Nombre del puesto" onGuardar={(v) => guardar(p, { nombre: v }, "Puesto renombrado")} /></td>
                  <td>
                    <select value={p.departamento_id ?? ""} className="aj-select" aria-label={`${p.nombre}: departamento`} onChange={(e) => guardar(p, { departamento_id: e.target.value || null })}>
                      <option value="">— sin departamento —</option>
                      {datos.departamentos.filter((d) => d.activo || d.id === p.departamento_id).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                    </select>
                  </td>
                  <td className="c"><TextoInline valor={String(p.orden)} ancho={56} label={`${p.nombre}: orden`} onGuardar={(v) => guardar(p, { orden: Math.round(num(v, 100)) })} /></td>
                  <td className="c"><Switch checked={p.activo} label={`${p.nombre}: activo`} onChange={(v) => guardar(p, { activo: v }, v ? "Puesto activado" : "Puesto desactivado")} /></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="link-btn2" onClick={() => setFusion(p)}>Fusionar en…</button>
                  </td>
                </tr>
              </Fragment>
            ))}
            {!lista.length ? <tr><td colSpan={6} className="vacio">Nada que mostrar</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="nota">Un puesto desactivado no sale en el desplegable del turno, pero los turnos que ya lo tenían lo conservan. El orden manda dentro del departamento (menor = antes).</div>

      {fusion ? <ModalFusion origen={fusion} puestos={datos.puestos} deptoNombre={deptoNombre} onCerrar={() => setFusion(null)} avisar={avisar} recargar={recargar} /> : null}
      {nuevo ? <ModalNuevoPuesto departamentos={datos.departamentos} onCerrar={() => setNuevo(false)} avisar={avisar} recargar={recargar} /> : null}
    </>
  );
}

function ModalNuevoPuesto({ departamentos, onCerrar, avisar, recargar }: { departamentos: Datos["departamentos"]; onCerrar: () => void; avisar: Avisar; recargar: () => void }) {
  const [nombre, setNombre] = useState("");
  const [depto, setDepto] = useState("");
  const [color, setColor] = useState("#888888");
  const [colorTocado, setColorTocado] = useState(false);
  return (
    <Modal titulo="Nuevo puesto" onCerrar={onCerrar}>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const r = await aj.crearPuesto({ nombre, departamento_id: depto || null, color });
        avisar(r.ok ? "Puesto creado" : "No se pudo crear: " + r.error);
        if (r.ok) { onCerrar(); recargar(); }
      }}>
        <label>Nombre</label>
        <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Camarero/a de terraza" />
        <div className="fila-2">
          <div>
            <label>Departamento</label>
            <select value={depto} onChange={(e) => {
              setDepto(e.target.value);
              if (!colorTocado) setColor(colorDeDepto(departamentos.find((d) => d.id === e.target.value)?.nombre));
            }}>
              <option value="">— sin departamento —</option>
              {departamentos.filter((d) => d.activo).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </div>
          <div>
            <label>Color</label>
            <input type="color" value={color} onChange={(e) => { setColor(e.target.value); setColorTocado(true); }} style={{ height: 36, padding: 2 }} />
          </div>
        </div>
        <div className="modal-acciones">
          <button type="button" className="btn btn-fantasma" onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn btn-primario">Crear</button>
        </div>
      </form>
    </Modal>
  );
}

function ModalFusion({ origen, puestos, deptoNombre, onCerrar, avisar, recargar }: {
  origen: aj.PuestoCat; puestos: aj.PuestoCat[]; deptoNombre: (id: string | null) => string | null; onCerrar: () => void; avisar: Avisar; recargar: () => void;
}) {
  const [destino, setDestino] = useState("");
  const [uso, setUso] = useState<{ turnos: number; empleados: number; plantillas: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { aj.usoPuesto(origen.id).then(setUso); }, [origen.id]);
  const candidatos = puestos.filter((p) => p.id !== origen.id && p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const dest = candidatos.find((p) => p.id === destino);
  return (
    <Modal titulo={`Fusionar «${origen.nombre}»`} sub="Todo lo que apunta a este puesto pasará al que elijas, y este quedará desactivado." onCerrar={onCerrar} ancho={480}>
      <div className="aj-uso">
        {uso ? <>Ahora mismo lo usan <b>{uso.turnos}</b> turnos, <b>{uso.empleados}</b> empleados como puesto por defecto y <b>{uso.plantillas}</b> plantillas.</> : "Contando usos…"}
      </div>
      <label>Fusionar en</label>
      <select value={destino} onChange={(e) => setDestino(e.target.value)} autoFocus>
        <option value="">— elige el puesto que se queda —</option>
        {candidatos.map((p) => <option key={p.id} value={p.id}>{p.nombre}{deptoNombre(p.departamento_id) ? ` · ${deptoNombre(p.departamento_id)}` : ""}</option>)}
      </select>
      {dest ? (
        <div className="aj-aviso-fusion">
          Los turnos pasarán a llamarse «{dest.nombre}» (también el texto que lee Ratios). No se puede deshacer en bloque: si te equivocas, tendrás que fusionar al revés. Se hace en varios pasos y, si uno falla a medias, basta con repetir la fusión.
        </div>
      ) : null}
      <div className="modal-acciones">
        <button type="button" className="btn btn-fantasma" onClick={onCerrar}>Cancelar</button>
        <button type="button" className="btn btn-primario" disabled={!dest || ocupado} onClick={async () => {
          if (!dest) return;
          setOcupado(true);
          const r = await aj.fusionarPuestos(origen.id, dest.id);
          setOcupado(false);
          if (!r.ok) { avisar(r.error ?? "No se pudo fusionar"); recargar(); return; }
          avisar(`Fusionado: ${r.data?.turnos ?? 0} turnos y ${r.data?.empleados ?? 0} empleados ahora en «${dest.nombre}»`);
          onCerrar();
          recargar();
        }}>{ocupado ? "Fusionando…" : "Fusionar"}</button>
      </div>
    </Modal>
  );
}

/* ==================== Tipos de ausencia ==================== */

const CATEGORIAS: [aj.CategoriaAusencia, string, string][] = [
  ["retribuida_empresa", "Retribuida (empresa)", "La paga la empresa: vacaciones, permisos retribuidos, formación…"],
  ["retribuida_terceros", "Retribuida (terceros)", "La paga la Seguridad Social o la mutua: baja, accidente, maternidad…"],
  ["no_retribuida", "No retribuida", "Sin sueldo: permiso sin sueldo, ausencia injustificada."],
  ["neutra", "Neutra", "No es ni trabajo ni ausencia pagada: descanso semanal, festivo, incorporación/salida."],
];
const CAT_CORTA: Record<string, string> = { retribuida_empresa: "Retribuida · empresa", retribuida_terceros: "Retribuida · terceros", no_retribuida: "No retribuida", neutra: "Neutra" };

function SubTiposAusencia({ datos, recargar, avisar }: SubProps) {
  const [nuevo, setNuevo] = useState(false);
  const guardar = async (t: aj.TipoAusenciaCat, campos: aj.CamposTipoAusencia, msg = "Guardado") => {
    const r = await aj.guardarTipoAusencia(t.id, campos);
    avisar(r.ok ? msg : "No se pudo guardar: " + r.error);
    recargar();
    return r.ok;
  };
  // [campo, cabecera, cabecera corta (pantallas estrechas), ayuda]
  const SWITCHES: [keyof aj.CamposTipoAusencia & ("computa_contador" | "computa_vacaciones" | "solicitable_empleado" | "requiere_justificante" | "activo"), string, string, string][] = [
    ["computa_contador", "Computa contador", "Contador", "Cuenta como horas trabajadas en el contador de horas (como en Skello: vacaciones y bajas sí, descanso compensatorio no)."],
    ["computa_vacaciones", "Resta vacaciones", "Vacac.", "Descuenta días del saldo de vacaciones."],
    ["solicitable_empleado", "La pide el empleado", "Empleado", "Aparece en la app del empleado para solicitarla."],
    ["requiere_justificante", "Justificante", "Justif.", "Hay que adjuntar o entregar un justificante."],
    ["activo", "Activo", "Activo", "Si no, no se puede usar en ausencias nuevas."],
  ];
  return (
    <>
      <h2>Tipos de ausencia</h2>
      <div className="nota" style={{ margin: "4px 0 14px" }}>Qué ausencias existen, de qué categoría son y qué hacen con los contadores. El código corto es el que sale en el informe de nómina.</div>
      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="aj aj-tabla-aus">
          <thead>
            <tr>
              <th className="c">Color</th><th>Tipo</th><th>Categoría</th><th>Código</th>
              {SWITCHES.map(([k, t, corto, d]) => <th key={k} className="c" title={d}><span className="aj-th-largo">{t}</span><span className="aj-th-corto">{corto}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {datos.tiposAusencia.map((t) => (
              <tr key={t.id} className={t.activo ? "" : "aj-inactivo"}>
                <td className="c"><ColorInline valor={t.color ?? "#888888"} label={`${t.nombre}: color`} onGuardar={(v) => guardar(t, { color: v }, "Color guardado")} /></td>
                <td><TextoInline valor={t.nombre} label="Nombre del tipo" onGuardar={(v) => guardar(t, { nombre: v }, "Renombrado")} /></td>
                <td>
                  <select value={t.categoria} className="aj-select" aria-label={`${t.nombre}: categoría`} onChange={(e) => guardar(t, { categoria: e.target.value })}>
                    {CATEGORIAS.map(([id, nombre]) => <option key={id} value={id}>{CAT_CORTA[id] ?? nombre}</option>)}
                  </select>
                </td>
                <td><TextoInline valor={t.codigo ?? ""} ancho={56} mayus placeholder="VAC" label={`${t.nombre}: código`} onGuardar={(v) => guardar(t, { codigo: v || null })} /></td>
                {SWITCHES.map(([k, titulo, , d]) => (
                  <td key={k} className="c"><Switch checked={!!t[k]} title={d} label={`${t.nombre}: ${titulo}`} onChange={(v) => guardar(t, { [k]: v })} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="aj-leyenda-cat">
        {CATEGORIAS.map(([id, nombre, det]) => <div key={id}><b>{nombre}</b> — {det}</div>)}
      </div>
      <div className="fila-guardar" style={{ justifyContent: "flex-start" }}>
        <button className="btn btn-primario btn-peque" onClick={() => setNuevo(true)}>+ Nuevo tipo</button>
      </div>
      {nuevo ? <ModalNuevoTipo onCerrar={() => setNuevo(false)} avisar={avisar} recargar={recargar} /> : null}
    </>
  );
}

function ModalNuevoTipo({ onCerrar, avisar, recargar }: { onCerrar: () => void; avisar: Avisar; recargar: () => void }) {
  const [f, setF] = useState({ nombre: "", categoria: "retribuida_empresa" as aj.CategoriaAusencia, color: "#42A5F5", codigo: "", computa_contador: true, computa_vacaciones: false, solicitable_empleado: true, requiere_justificante: false });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal titulo="Nuevo tipo de ausencia" onCerrar={onCerrar}>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const r = await aj.crearTipoAusencia({ ...f, codigo: f.codigo || null });
        avisar(r.ok ? "Tipo creado" : "No se pudo crear: " + r.error);
        if (r.ok) { onCerrar(); recargar(); }
      }}>
        <label>Nombre</label>
        <input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Ej.: Permiso por mudanza" />
        <label>Categoría</label>
        <select value={f.categoria} onChange={(e) => set("categoria", e.target.value as aj.CategoriaAusencia)}>
          {CATEGORIAS.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
        </select>
        <small className="nota">{CATEGORIAS.find((c) => c[0] === f.categoria)?.[2]}</small>
        <div className="fila-2">
          <div><label>Código corto</label><input value={f.codigo} onChange={(e) => set("codigo", e.target.value.toUpperCase())} placeholder="MUD" maxLength={8} /></div>
          <div><label>Color</label><input type="color" value={f.color} onChange={(e) => set("color", e.target.value)} style={{ height: 36, padding: 2 }} /></div>
        </div>
        {([["computa_contador", "Computa en el contador de horas"], ["computa_vacaciones", "Resta días de vacaciones"], ["solicitable_empleado", "La puede pedir el empleado"], ["requiere_justificante", "Requiere justificante"]] as const).map(([k, t]) => (
          <div key={k} className="check" style={{ marginTop: 8 }}>
            <input type="checkbox" id={`nt-${k}`} checked={f[k]} onChange={(e) => set(k, e.target.checked)} />
            <label htmlFor={`nt-${k}`} style={{ margin: 0 }}>{t}</label>
          </div>
        ))}
        <div className="modal-acciones">
          <button type="button" className="btn btn-fantasma" onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn btn-primario">Crear</button>
        </div>
      </form>
    </Modal>
  );
}

/* ==================== Festivos ==================== */

const AMBITO: Record<string, string> = { nacional: "Nacional", autonomico: "Autonómico", local: "Local" };

function SubFestivos({ datos, avisar }: SubProps) {
  const [anio, setAnio] = useState(new Date().getFullYear());
  // Centro recordado (el mismo que el resto del panel); "" = todos. Si ya no existe, todos.
  const [centroSel, setCentroSel] = useState<string>(() => {
    const g = leerPref<string>("centro", "");
    return datos.centros.some((c) => c.id === g) ? g : "";
  });
  const [lista, setLista] = useState<aj.Festivo[] | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [quitar, setQuitar] = useState<aj.Festivo | null>(null);
  const cargar = useCallback(() => { aj.listarFestivos(anio).then(setLista); }, [anio]);
  useEffect(() => { setLista(null); cargar(); }, [cargar]);
  const centroNombre = (id: string | null) => datos.centros.find((c) => c.id === id)?.nombre ?? "—";
  // Nacionales y autonómicos siempre; locales solo del centro elegido.
  const visibles = lista?.filter((f) => !centroSel || f.ambito !== "local" || f.centro_id === centroSel) ?? null;

  return (
    <>
      <h2>Festivos</h2>
      <div className="nota" style={{ margin: "4px 0 14px" }}>Los nacionales y autonómicos valen para toda la cuenta; los locales, solo para su centro. Un festivo inactivo no cuenta (sirve para dejar anotados los que están por confirmar).</div>
      <div className="aj-filtros">
        <div className="sem-nav">
          <button onClick={() => setAnio((a) => a - 1)} aria-label="Año anterior">‹</button>
          <span className="sem-label" style={{ minWidth: 70 }}>{anio}</span>
          <button onClick={() => setAnio((a) => a + 1)} aria-label="Año siguiente">›</button>
        </div>
        <select value={centroSel} onChange={(e) => setCentroSel(e.target.value)} aria-label="Centro">
          <option value="">Todos los centros</option>
          {datos.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <span className="nota">{visibles ? `${visibles.filter((f) => f.activo).length} activos · ${visibles.length} en total` : ""}</span>
        <button className="btn btn-primario btn-peque" style={{ marginLeft: "auto" }} onClick={() => setNuevo(true)}>+ Añadir festivo</button>
      </div>
      {visibles === null ? <div className="vacio">Cargando…</div> : (
        <div className="panel" style={{ padding: 0 }}>
          <table className="aj">
            <thead><tr><th>Fecha</th><th>Nombre</th><th>Ámbito</th><th>Centro</th><th className="c">Activo</th><th /></tr></thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.id} className={f.activo ? "" : "aj-inactivo"}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtFechaCorta(f.fecha)}</td>
                  <td>
                    <TextoInline valor={f.nombre} label="Nombre del festivo" onGuardar={async (v) => { const r = await aj.guardarFestivo(f.id, { nombre: v }); avisar(r.ok ? "Guardado" : "No se pudo: " + r.error); cargar(); return r.ok; }} />
                    {f.comentario ? <div className="nota">{f.comentario}</div> : null}
                  </td>
                  <td><span className={`aj-pill aj-amb-${f.ambito}`}>{AMBITO[f.ambito] ?? f.ambito}</span></td>
                  <td>{f.ambito === "local" ? centroNombre(f.centro_id) : <span className="nota">toda la cuenta</span>}</td>
                  <td className="c"><Switch checked={f.activo} label={`${f.nombre} (${fmtFecha(f.fecha)}): activo`} onChange={async (v) => { const r = await aj.guardarFestivo(f.id, { activo: v }); avisar(r.ok ? (v ? "Festivo activado" : "Festivo desactivado") : "No se pudo: " + r.error); cargar(); }} /></td>
                  <td style={{ textAlign: "right" }}><button className="link-btn2 rojo" onClick={() => setQuitar(f)}>Quitar</button></td>
                </tr>
              ))}
              {!visibles.length ? <tr><td colSpan={6} className="vacio">{lista?.length ? `Sin festivos para ${centroNombre(centroSel)} en ${anio}.` : `No hay festivos cargados para ${anio}. Añádelos cuando salga el calendario laboral en el BOIB.`}</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {nuevo ? <ModalNuevoFestivo anio={anio} centros={datos.centros} centroDefecto={centroSel} onCerrar={() => setNuevo(false)} avisar={avisar} recargar={cargar} /> : null}
      {quitar ? (
        <Confirmar
          titulo="Quitar festivo"
          peligro
          textoOk="Quitar"
          texto={<>¿Quitar «{quitar.nombre}» del {fmtFecha(quitar.fecha)}? Si solo quieres que no cuente de momento, mejor desactívalo.</>}
          onCancelar={() => setQuitar(null)}
          onOk={async () => { const r = await aj.borrarFestivo(quitar.id); avisar(r.ok ? "Festivo quitado" : "No se pudo: " + r.error); setQuitar(null); cargar(); }}
        />
      ) : null}
    </>
  );
}

function ModalNuevoFestivo({ anio, centros, centroDefecto, onCerrar, avisar, recargar }: { anio: number; centros: aj.CentroAj[]; centroDefecto: string; onCerrar: () => void; avisar: Avisar; recargar: () => void }) {
  const [fecha, setFecha] = useState(`${anio}-01-01`);
  const [nombre, setNombre] = useState("");
  const [ambito, setAmbito] = useState<"nacional" | "autonomico" | "local">("local");
  const [centro, setCentro] = useState(centroDefecto || (centros[0]?.id ?? ""));
  return (
    <Modal titulo="Añadir festivo" onCerrar={onCerrar}>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const r = await aj.crearFestivo({ fecha, nombre, ambito, centro_id: ambito === "local" ? centro : null });
        avisar(r.ok ? "Festivo añadido" : "No se pudo añadir: " + r.error);
        if (r.ok) { onCerrar(); recargar(); }
      }}>
        <div className="fila-2">
          <div><label>Fecha</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div><label>Ámbito</label>
            <select value={ambito} onChange={(e) => setAmbito(e.target.value as typeof ambito)}>
              <option value="nacional">Nacional</option><option value="autonomico">Autonómico</option><option value="local">Local (de un centro)</option>
            </select>
          </div>
        </div>
        <label>Nombre</label>
        <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Sant Antoni" />
        {ambito === "local" ? (
          <>
            <label>Centro</label>
            <select value={centro} onChange={(e) => setCentro(e.target.value)}>
              {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <small className="nota">Si el mismo festivo local vale para varios centros, añádelo una vez por centro.</small>
          </>
        ) : null}
        <div className="modal-acciones">
          <button type="button" className="btn btn-fantasma" onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn btn-primario">Añadir</button>
        </div>
      </form>
    </Modal>
  );
}

/* ==================== Plantillas de turno ==================== */

function SubPlantillas({ datos, recargar, avisar }: SubProps) {
  // Centro recordado del panel; si ya no existe en esta cuenta (borrado, otra cuenta), «Globales».
  const [centroSel, setCentroSel] = useState<string>(() => {
    const g = leerPref<string>("centro", "");
    return datos.centros.some((c) => c.id === g) ? g : "global";
  });
  const [edit, setEdit] = useState<aj.PlantillaTurno | "nueva" | null>(null);
  const [quitar, setQuitar] = useState<aj.PlantillaTurno | null>(null);
  const puestoNombre = (id: string | null) => datos.puestos.find((p) => p.id === id)?.nombre ?? "";
  const lista = datos.plantillas.filter((p) => (centroSel === "global" ? p.centro_id === null : p.centro_id === centroSel));
  const globales = datos.plantillas.filter((p) => p.centro_id === null && p.activo).length;

  return (
    <>
      <h2>Plantillas de turno</h2>
      <div className="nota" style={{ margin: "4px 0 14px" }}>Los botones de «turno rápido» del modal de turno: rellenan horas, pausa y puesto de un clic. Las globales salen en todos los centros{globales ? ` (ahora hay ${globales})` : ""}.</div>
      <div className="aj-filtros">
        <select value={centroSel} onChange={(e) => setCentroSel(e.target.value)}>
          <option value="global">Globales (todos los centros)</option>
          {datos.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <button className="btn btn-primario btn-peque" style={{ marginLeft: "auto" }} onClick={() => setEdit("nueva")}>+ Nueva plantilla</button>
      </div>
      <div className="panel" style={{ padding: 0 }}>
        <table className="aj">
          <thead><tr><th>Nombre</th><th>Horario</th><th className="c">Pausa</th><th>Puesto</th><th className="c">Orden</th><th className="c">Activa</th><th /></tr></thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} className={p.activo ? "" : "aj-inactivo"}>
                <td style={{ fontWeight: 600 }}>{p.nombre}</td>
                <td>{hhmm(p.hora_inicio)}–{hhmm(p.hora_fin)}</td>
                <td className="c">{p.pausa_min ? `${p.pausa_min} min` : "—"}</td>
                <td>{puestoNombre(p.puesto_id) || <span className="nota">cualquiera</span>}</td>
                <td className="c">{p.orden}</td>
                <td className="c"><Switch checked={p.activo} label={`${p.nombre}: activa`} onChange={async (v) => {
                  const r = await aj.guardarPlantilla(p.id, { nombre: p.nombre, centro_id: p.centro_id, hora_inicio: hhmm(p.hora_inicio), hora_fin: hhmm(p.hora_fin), pausa_min: p.pausa_min, puesto_id: p.puesto_id, orden: p.orden, activo: v });
                  avisar(r.ok ? "Guardado" : "No se pudo: " + r.error); recargar();
                }} /></td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="link-btn2" onClick={() => setEdit(p)}>Editar</button>
                  <button className="link-btn2 rojo" style={{ marginLeft: 10 }} onClick={() => setQuitar(p)}>Quitar</button>
                </td>
              </tr>
            ))}
            {!lista.length ? <tr><td colSpan={7} className="vacio">Sin plantillas aquí todavía.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {edit ? (
        <ModalPlantilla
          inicial={edit === "nueva" ? null : edit}
          centroDefecto={centroSel === "global" ? null : centroSel}
          centros={datos.centros}
          puestos={datos.puestos.filter((p) => p.activo)}
          onCerrar={() => setEdit(null)}
          avisar={avisar}
          recargar={recargar}
        />
      ) : null}
      {quitar ? (
        <Confirmar titulo="Quitar plantilla" peligro textoOk="Quitar" texto={<>¿Quitar «{quitar.nombre}»? Los turnos ya creados con ella no cambian.</>} onCancelar={() => setQuitar(null)}
          onOk={async () => { const r = await aj.borrarPlantilla(quitar.id); avisar(r.ok ? "Plantilla quitada" : "No se pudo: " + r.error); setQuitar(null); recargar(); }} />
      ) : null}
    </>
  );
}

function ModalPlantilla({ inicial, centroDefecto, centros, puestos, onCerrar, avisar, recargar }: {
  inicial: aj.PlantillaTurno | null; centroDefecto: string | null; centros: aj.CentroAj[]; puestos: aj.PuestoCat[]; onCerrar: () => void; avisar: Avisar; recargar: () => void;
}) {
  const [f, setF] = useState({
    nombre: inicial?.nombre ?? "",
    centro_id: inicial ? inicial.centro_id ?? "" : centroDefecto ?? "",
    hora_inicio: hhmm(inicial?.hora_inicio) || "09:00",
    hora_fin: hhmm(inicial?.hora_fin) || "17:00",
    pausa_min: String(inicial?.pausa_min ?? 0),
    puesto_id: inicial?.puesto_id ?? "",
    orden: String(inicial?.orden ?? 100),
    activo: inicial?.activo ?? true,
  });
  const [nombreTocado, setNombreTocado] = useState(!!inicial);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const nombreAuto = `${f.hora_inicio}–${f.hora_fin}${Number(f.pausa_min) ? ` · ${f.pausa_min} min` : ""}`;
  return (
    <Modal titulo={inicial ? "Editar plantilla" : "Nueva plantilla"} onCerrar={onCerrar}>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const r = await aj.guardarPlantilla(inicial?.id ?? null, {
          nombre: nombreTocado && f.nombre.trim() ? f.nombre : nombreAuto,
          centro_id: f.centro_id || null,
          hora_inicio: f.hora_inicio,
          hora_fin: f.hora_fin,
          pausa_min: Math.round(num(f.pausa_min, 0)),
          puesto_id: f.puesto_id || null,
          orden: Math.round(num(f.orden, 100)),
          activo: f.activo,
        });
        avisar(r.ok ? "Plantilla guardada" : "No se pudo guardar: " + r.error);
        if (r.ok) { onCerrar(); recargar(); }
      }}>
        <label>Centro</label>
        <select value={f.centro_id} onChange={(e) => set("centro_id", e.target.value)}>
          <option value="">Global (todos los centros)</option>
          {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <div className="fila-2">
          <div><label>Entrada</label><input type="time" value={f.hora_inicio} onChange={(e) => set("hora_inicio", e.target.value)} required /></div>
          <div><label>Salida</label><input type="time" value={f.hora_fin} onChange={(e) => set("hora_fin", e.target.value)} required /></div>
        </div>
        <div className="fila-2">
          <div><label>Pausa (min)</label><input type="number" min={0} step={5} value={f.pausa_min} onChange={(e) => set("pausa_min", e.target.value)} /></div>
          <div><label>Orden</label><input type="number" min={0} step={1} value={f.orden} onChange={(e) => set("orden", e.target.value)} /></div>
        </div>
        <label>Puesto (opcional)</label>
        <select value={f.puesto_id} onChange={(e) => set("puesto_id", e.target.value)}>
          <option value="">— cualquiera —</option>
          {puestos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <label>Nombre</label>
        <input value={nombreTocado ? f.nombre : nombreAuto} onChange={(e) => { setNombreTocado(true); set("nombre", e.target.value); }} placeholder={nombreAuto} />
        <small className="nota">Si lo dejas como está, se llama como el horario.</small>
        {inicial ? (
          <div className="check"><input type="checkbox" id="pl-activa" checked={f.activo} onChange={(e) => set("activo", e.target.checked)} /><label htmlFor="pl-activa" style={{ margin: 0 }}>Activa</label></div>
        ) : null}
        <div className="modal-acciones">
          <button type="button" className="btn btn-fantasma" onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn btn-primario">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}

/* ==================== Encargados por centro ==================== */

const ROL_NOMBRE: Record<string, string> = { responsable_area: "Responsable de área", jefe_sala: "Jefe/a de sala", direccion: "Dirección", administracion: "Administración" };

function SubEncargados({ datos, recargar, avisar }: SubProps) {
  const set = new Set(datos.encargados.map((e) => `${e.user_id}|${e.centro_id}`));
  const perfiles = [...datos.perfiles].sort((a, b) => (a.nombre ?? a.correo).localeCompare(b.nombre ?? b.correo));
  return (
    <>
      <h2>Encargados por centro</h2>
      <div className="nota" style={{ margin: "4px 0 14px" }}>
        Un encargado ve y planifica solo los centros marcados aquí (cuadrante, fichajes, ausencias de ese centro). Dirección y administración lo ven todo sin necesidad de esta rejilla.
      </div>
      {!datos.perfilesVisibles ? (
        <div className="aviso-caja">No puedo listar los usuarios de la cuenta con tu rol: solo dirección ve los perfiles. Pídele a alguien de dirección que asigne los centros.</div>
      ) : null}
      {perfiles.length ? (
        <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
          <table className="aj aj-rejilla">
            <thead>
              <tr>
                <th className="aj-fijo">Usuario</th>
                {datos.centros.map((c) => <th key={c.id} className="c aj-vert"><span>{c.nombre}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {perfiles.map((p) => (
                <tr key={p.id}>
                  <td className="aj-fijo">
                    <div style={{ fontWeight: 600 }}>{p.nombre || p.correo}</div>
                    <div className="nota">{p.nombre ? p.correo + " · " : ""}{ROL_NOMBRE[p.rol] ?? p.rol}</div>
                  </td>
                  {datos.centros.map((c) => (
                    <td key={c.id} className="c">
                      <Switch checked={set.has(`${p.id}|${c.id}`)} label={`${p.nombre || p.correo} · ${c.nombre}`} onChange={async (v) => {
                        const r = await aj.toggleEncargado(p.id, c.id, v);
                        avisar(r.ok ? (v ? `${p.nombre || p.correo} gestiona ${c.nombre}` : `${p.nombre || p.correo} ya no gestiona ${c.nombre}`) : "No se pudo: " + r.error);
                        recargar();
                      }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : datos.perfilesVisibles ? (
        <div className="vacio">No hay usuarios con rol responsable de área o jefe/a de sala. Se crean en el módulo de usuarios.</div>
      ) : null}
      <div className="nota">Los usuarios y sus roles se gestionan en el módulo de usuarios; aquí solo se reparten los centros.</div>
    </>
  );
}

/* ==================== Departamentos y contratos ==================== */

function SubCatalogos({ datos, recargar, avisar }: SubProps) {
  const [quitar, setQuitar] = useState<{ tabla: "rrhh_tipos_contrato" | "departamentos"; id: string; nombre: string } | null>(null);
  return (
    <>
      <h2>Departamentos y contratos</h2>
      <div className="nota" style={{ margin: "4px 0 14px" }}>Las listas de la ficha del empleado. Desactivar un valor lo oculta de los desplegables, pero no cambia a quien ya lo tenga.</div>
      {([["Departamentos", "departamentos", datos.departamentos], ["Tipos de contrato", "rrhh_tipos_contrato", datos.tiposContrato]] as const).map(([titulo, tabla, filas]) => (
        <div key={tabla} className="panel">
          <h3>{titulo}</h3>
          <table className="aj">
            <thead><tr><th>Nombre</th><th className="c">Activo</th><th className="c" /></tr></thead>
            <tbody>
              {filas.map((fila) => (
                <tr key={fila.id} className={fila.activo ? "" : "aj-inactivo"}>
                  <td>
                    <TextoInline valor={fila.nombre} label="Nombre" onGuardar={async (v) => {
                      const r = await api.guardarCatalogo(tabla, fila.id, { nombre: v });
                      avisar(r.ok ? "Renombrado" : "No se pudo: " + r.error); recargar();
                      return r.ok;
                    }} />
                  </td>
                  <td className="c">
                    <Switch checked={!!fila.activo} label={`${fila.nombre}: activo`} onChange={async (v) => {
                      const r = await api.guardarCatalogo(tabla, fila.id, { activo: v });
                      avisar(r.ok ? "Guardado" : "No se pudo guardar"); recargar();
                    }} />
                  </td>
                  <td className="c"><button className="link-btn2 rojo" onClick={() => setQuitar({ tabla, id: fila.id, nombre: fila.nombre })}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <AnadirCatalogo tabla={tabla} titulo={`Añadir a ${titulo.toLowerCase()}`} placeholder="Nombre nuevo" avisar={avisar} recargar={recargar} />
        </div>
      ))}
      {quitar ? (
        <Confirmar titulo="Quitar de la lista" peligro textoOk="Quitar" texto={<>¿Quitar «{quitar.nombre}»? Quien ya lo tenga asignado lo conserva. Si está en uso en otras tablas no se podrá: desactívalo en su lugar.</>} onCancelar={() => setQuitar(null)}
          onOk={async () => { const r = await api.borrarCatalogo(quitar.tabla, quitar.id); avisar(r.ok ? "Quitado" : r.error || "No se pudo quitar"); setQuitar(null); recargar(); }} />
      ) : null}
    </>
  );
}

function AnadirCatalogo({ tabla, titulo, placeholder, avisar, recargar }: {
  tabla: "rrhh_tipos_contrato" | "departamentos"; titulo: string; placeholder: string; avisar: Avisar; recargar: () => void;
}) {
  const [nombre, setNombre] = useState("");
  return (
    <form className="aj-anadir" onSubmit={async (e) => {
      e.preventDefault();
      if (!nombre.trim()) { avisar("Escribe un nombre"); return; }
      const r = await api.anadirCatalogo(tabla, nombre.trim());
      avisar(r.ok ? "Añadido" : "No se pudo añadir: " + r.error);
      if (r.ok) { setNombre(""); recargar(); }
    }}>
      <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={placeholder} aria-label={titulo} style={{ flex: 1, minWidth: 180 }} />
      <button type="submit" className="btn btn-fantasma btn-peque">{titulo}</button>
    </form>
  );
}

/* ==================== Departamentos por centro ==================== */

function SubMatriz({ datos, recargar, avisar }: SubProps) {
  const matrizSet = new Set(datos.matriz.map((r) => `${r.centro_id}|${r.departamento_id}`));
  const deptos = datos.departamentos.filter((d) => d.activo);
  return (
    <>
      <h2>Departamentos por centro</h2>
      <div className="nota" style={{ margin: "4px 0 14px" }}>Marca qué departamentos existen en cada centro. En la ficha del empleado, el desplegable mostrará solo los de su centro.</div>
      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="aj aj-rejilla">
          <thead>
            <tr>
              <th className="aj-fijo">Centro</th>
              {deptos.map((d) => <th key={d.id} className="c aj-vert"><span>{d.nombre}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {datos.centros.map((c) => (
              <tr key={c.id}>
                <td className="aj-fijo" style={{ fontWeight: 600 }}>{c.nombre}</td>
                {deptos.map((d) => (
                  <td key={d.id} className="c">
                    <Switch checked={matrizSet.has(`${c.id}|${d.id}`)} label={`${c.nombre} · ${d.nombre}`} onChange={async (v) => {
                      const r = await api.toggleMatriz(c.id, d.id, v);
                      avisar(r.ok ? "Guardado" : "No se pudo guardar"); recargar();
                    }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ==================== Tablets (antes Dispositivos) ==================== */

function SubTablets({ ctx, avisar }: SecProps) {
  const [lista, setLista] = useState<Dispositivo[] | null>(null);
  const [tokenNuevo, setTokenNuevo] = useState<{ nombre: string; token: string } | null>(null);
  const [alta, setAlta] = useState(false);
  const [regenerar, setRegenerar] = useState<Dispositivo | null>(null);
  const [nNombre, setNNombre] = useState("");
  const [nCentro, setNCentro] = useState(ctx.centros[0]?.id ?? "");

  const cargar = useCallback(() => { api.listarDispositivos().then(setLista); }, []);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <>
      <h2>Tablets</h2>
      <div className="nota" style={{ margin: "4px 0 14px" }}>Los kioscos de fichaje de cada centro. Cada tablet lleva un código que se pega una vez en /kiosco.</div>
      <div className="aj-filtros">
        <button className="btn btn-primario btn-peque" onClick={() => setAlta(true)}>+ Nueva tablet</button>
      </div>
      {tokenNuevo ? (
        <div className="aviso-caja">
          Código de <b>{tokenNuevo.nombre}</b> (cópialo ahora, no se volverá a mostrar):{" "}
          <code style={{ fontSize: 14, fontWeight: 700, userSelect: "all" }}>{tokenNuevo.token}</code>
          {" "}· pégalo en el kiosco de la tablet (/kiosco).
        </div>
      ) : null}
      {lista === null ? <div className="vacio">Cargando…</div> : (
        <div className="panel" style={{ padding: 0 }}>
          <table className="aj">
            <thead><tr><th>Tablet</th><th>Centro</th><th className="c">Activa</th><th /></tr></thead>
            <tbody>
              {lista.map((d) => (
                <tr key={d.id} className={d.activo ? "" : "aj-inactivo"}>
                  <td style={{ fontWeight: 600 }}>{d.nombre}</td>
                  <td>{d.centros?.nombre || "—"}</td>
                  <td className="c">
                    <Switch checked={d.activo} label={`${d.nombre}: activa`} onChange={async (v) => {
                      const r = await api.toggleDispositivo(d.id, v);
                      avisar(r.ok ? (v ? "Tablet activada" : "Tablet desactivada") : r.error || "No se pudo");
                      cargar();
                    }} />
                  </td>
                  <td style={{ textAlign: "right" }}><button className="link-btn2" onClick={() => setRegenerar(d)}>Regenerar código</button></td>
                </tr>
              ))}
              {!lista.length ? <tr><td colSpan={4} className="vacio">Aún no hay tablets.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      <div className="nota">El código solo se guarda cifrado: al crear o regenerar se muestra una única vez. Las tablets lo recuerdan en su pantalla de configuración (5 toques en la cabecera del kiosco).</div>

      {regenerar ? (
        <Confirmar titulo="Regenerar código" textoOk="Regenerar" texto={<>¿Regenerar el código de «{regenerar.nombre}»? El actual dejará de funcionar y habrá que pegar el nuevo en esa tablet.</>} onCancelar={() => setRegenerar(null)}
          onOk={async () => {
            const r = await api.regenerarToken(regenerar.id);
            if (!r.ok || !r.data) { avisar(r.error || "No se pudo"); setRegenerar(null); return; }
            setTokenNuevo({ nombre: regenerar.nombre ?? "tablet", token: r.data });
            setRegenerar(null);
            avisar("Código regenerado");
          }} />
      ) : null}

      {alta ? (
        <Modal titulo="Nueva tablet" onCerrar={() => setAlta(false)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            if (!nNombre.trim()) return;
            const r = await api.crearDispositivo(nCentro, nNombre.trim());
            if (!r.ok || !r.data) { avisar(r.error || "No se pudo crear"); return; }
            setAlta(false);
            setTokenNuevo({ nombre: nNombre.trim(), token: r.data });
            setNNombre("");
            cargar();
          }}>
            <label>Nombre</label>
            <input autoFocus value={nNombre} onChange={(e) => setNNombre(e.target.value)} placeholder="Tablet Casa Tirant barra" />
            <label>Centro</label>
            <select value={nCentro} onChange={(e) => setNCentro(e.target.value)}>
              {ctx.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <div className="modal-acciones">
              <button type="button" className="btn btn-fantasma" onClick={() => setAlta(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primario">Crear y ver código</button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
