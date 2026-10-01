"use client";

/* Sección Empleados (plan 2.7). Lista a la izquierda con filtros y badges; ficha a la derecha con
   estado y saldos en la cabecera, datos, centros, periodos de contrato, PIN e historial de fichajes.
   Nada de prompt(): todo con modales y toasts. */

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import * as base from "../acciones";
import * as api from "../acciones/empleados";
import { calcularDia, efectivosDe, horaDe, hoyIso, iniciales, NT, sumaDia, type Periodo } from "../tipos";
import { fmtFecha, fmtHoras, guardarPref, leerPref, type SecProps } from "../lib-rrhh";
import "./empleados.css";

type Maestros = Awaited<ReturnType<typeof api.cargarMaestrosEmp>>;
type Datos = Awaited<ReturnType<typeof api.cargarEmpleadosV2>>;
type Ficha = Awaited<ReturnType<typeof api.cargarFicha>>;
type FiltroEstado = api.EstadoEmp | "todos";

const ESTADO_TXT: Record<api.EstadoEmp, string> = { activo: "Activo", inactivo: "Inactivo", baja: "Baja" };
const MOTIVOS_BAJA = ["Fin de temporada (fijo-discontinuo)", "Fin de contrato", "Baja voluntaria", "Despido", "No supera el periodo de prueba", "Jubilación", "Otro"];

const fmtNum = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
/** dd/mm si es del año en curso; dd/mm/aa si no (en enero, «desde 31/10» sería ambiguo). */
const fmtDdMm = (iso: string) => (iso.slice(0, 4) === hoyIso().slice(0, 4) ? fmtFecha(iso).slice(0, 5) : fmtFecha(iso).slice(0, 6) + iso.slice(2, 4));
const edadDe = (iso: string | null) => {
  if (!iso) return null;
  const n = new Date(iso + "T12:00");
  const h = new Date();
  let e = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) e--;
  return e;
};
const ordenApellidos = (a: { nombre: string; apellidos: string | null }, b: { nombre: string; apellidos: string | null }) =>
  (a.apellidos || "￿").localeCompare(b.apellidos || "￿", "es") || a.nombre.localeCompare(b.nombre, "es");

/* ==================== Sección ==================== */

export default function SecEmpleados({ ctx, avisar }: SecProps) {
  const [maestros, setMaestros] = useState<Maestros | null>(null);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [fCentro, setFCentro] = useState(() => leerPref<string>("centro", ""));
  const [fDepto, setFDepto] = useState("");
  const [fEstado, setFEstado] = useState<FiltroEstado>("activo");
  const [modalAlta, setModalAlta] = useState(false);

  const cargar = useCallback(() => { api.cargarEmpleadosV2().then(setDatos); }, []);
  useEffect(() => {
    api.cargarMaestrosEmp().then((m) => {
      setMaestros(m);
      // Si el centro recordado ya no existe (o no es de esta cuenta), el select y el filtro no deben quedar desacoplados
      setFCentro((v) => (v && !m.centros.some((c) => c.id === v) ? "" : v));
    });
    cargar();
  }, [cargar]);

  const lista = useMemo(() => {
    if (!datos) return [];
    const f = filtro.trim().toLowerCase();
    return datos.empleados
      .filter(
        (e) =>
          (!f || `${e.nombre} ${e.apellidos || ""} ${e.email || ""} ${e.codigo_nomina || ""}`.toLowerCase().includes(f)) &&
          (!fDepto || e.departamento === fDepto) &&
          (!fCentro || e.centro_principal_id === fCentro || e._centros.includes(fCentro)) &&
          (fEstado === "todos" || e._estado === fEstado),
      )
      .sort(ordenApellidos);
  }, [datos, filtro, fDepto, fCentro, fEstado]);

  if (!maestros || !datos) return <div className="vacio">Cargando…</div>;

  const nombreCentro = (id: string | null) => maestros.centros.find((c) => c.id === id)?.nombre || "—";
  const centrosUsados = new Set(datos.empleados.flatMap((e) => [e.centro_principal_id, ...e._centros]).filter(Boolean));
  const baseDep = fCentro ? datos.empleados.filter((e) => e.centro_principal_id === fCentro || e._centros.includes(fCentro)) : datos.empleados;
  const depUsados = [...new Set(baseDep.map((e) => e.departamento).filter(Boolean))].sort() as string[];
  const nPor = (s: FiltroEstado) => (s === "todos" ? datos.empleados.length : datos.empleados.filter((e) => e._estado === s).length);
  const empleadoSel = sel ? datos.empleados.find((e) => e.id === sel) ?? null : null;

  return (
    <>
      <div className="barra">
        <div className="emp-titulo">Empleados <small>{nPor("activo")} activos · {datos.empleados.length} en total</small></div>
        {ctx.esGestor ? <button className="btn btn-primario emp-nuevo" onClick={() => setModalAlta(true)}>+ Nuevo empleado</button> : null}
      </div>

      <div className="layout-emp">
        <aside className="aside-emp">
          <input placeholder="Buscar por nombre, email o código…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          <select value={fCentro} onChange={(e) => { setFCentro(e.target.value); setFDepto(""); if (e.target.value) guardarPref("centro", e.target.value); }}>
            <option value="">Todos los centros</option>
            {maestros.centros.filter((c) => centrosUsados.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <select value={fDepto} onChange={(e) => setFDepto(e.target.value)}>
            <option value="">Todos los departamentos</option>
            {depUsados.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <div className="emp-estados">
            {(["activo", "inactivo", "baja", "todos"] as FiltroEstado[]).map((s) => (
              <button key={s} className={fEstado === s ? "activa" : ""} onClick={() => setFEstado(s)} title={s === "inactivo" ? "Fijos-discontinuos entre temporadas" : undefined}>
                {s === "todos" ? "Todos" : s === "activo" ? "Activos" : s === "inactivo" ? "Inactivos" : "Baja"} {nPor(s)}
              </button>
            ))}
          </div>
          <div className="contador-emp">{lista.length} {lista.length === 1 ? "persona" : "personas"}{lista.length !== datos.empleados.length ? ` de ${datos.empleados.length}` : ""}</div>
          <div className="lista-emp">
            {lista.map((e) => (
              <div key={e.id} className={`emp-item ${sel === e.id ? "activo" : ""} ${e._estado !== "activo" ? "apagado" : ""}`} onClick={() => setSel(e.id)}>
                <div className="avatar">{iniciales(e.nombre + " " + (e.apellidos || ""))}</div>
                <div>
                  <div className="emp-np">{e.nombre} {e.apellidos || ""}</div>
                  <div className="emp-sub">{nombreCentro(e.centro_principal_id)}{e.departamento ? ` · ${e.departamento}` : ""}</div>
                  {e._estado !== "activo" || !e.tiene_pin || !e.email ? (
                    <div className="emp-minis">
                      {e._estado === "inactivo" ? <span className="emp-mini inactivo">{e._vuelve ? `vuelve el ${fmtDdMm(e._vuelve)}` : `inactivo${e._desde ? ` desde ${fmtDdMm(e._desde)}` : ""}`}</span> : null}
                      {e._estado === "baja" ? <span className="emp-mini baja">baja{e._desde ? ` ${fmtDdMm(e._desde)}` : ""}</span> : null}
                      {!e.tiene_pin ? <span className="emp-mini">sin PIN</span> : null}
                      {!e.email ? <span className="emp-mini">sin email</span> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {!lista.length ? <div className="vacio">Nadie con esos filtros.</div> : null}
          </div>
        </aside>

        <section>
          {!empleadoSel ? (
            <div className="vacio">Elige a alguien de la lista.</div>
          ) : (
            <FichaEmpleado
              key={empleadoSel.id}
              empleado={empleadoSel}
              maestros={maestros}
              esGestor={ctx.esGestor}
              avisar={avisar}
              recargar={cargar}
              onEstadoCambiado={(estado) => setFEstado(estado)}
            />
          )}
        </section>
      </div>

      {modalAlta ? (
        <ModalAlta
          maestros={maestros}
          centroInicial={fCentro || ctx.centros[0]?.id || ""}
          onCerrar={() => setModalAlta(false)}
          onCreado={(id, nombre) => {
            setModalAlta(false);
            avisar(`${nombre} dado de alta`);
            setFEstado("todos");
            cargar();
            setSel(id);
          }}
          avisar={avisar}
        />
      ) : null}
    </>
  );
}

/* ==================== Modal genérico ==================== */

/** `bloqueado`: mientras la acción está en curso no se cierra ni con Escape ni con clic fuera. */
function Modal({ titulo, sub, ancho, bloqueado, onCerrar, children }: { titulo: string; sub?: string; ancho?: boolean; bloqueado?: boolean; onCerrar: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !bloqueado) onCerrar(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCerrar, bloqueado]);
  return (
    <div className="rh-modal" onClick={(e) => { if (e.target === e.currentTarget && !bloqueado) onCerrar(); }}>
      <div className={`modal ${ancho ? "emp-modal-ancho" : ""}`} role="dialog" aria-modal="true" aria-label={titulo}>
        <h2>{titulo}</h2>
        {sub ? <div className="sub">{sub}</div> : null}
        {children}
      </div>
    </div>
  );
}

function ModalConfirmar({ titulo, texto, boton, peligro, onOk, onCerrar }: {
  titulo: string; texto: ReactNode; boton: string; peligro?: boolean; onOk: () => Promise<void> | void; onCerrar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal titulo={titulo} bloqueado={ocupado} onCerrar={onCerrar}>
      <p className="emp-texto">{texto}</p>
      <div className="modal-acciones">
        <button className="btn btn-fantasma" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
        <button className={`btn ${peligro ? "btn-peligro" : "btn-primario"}`} disabled={ocupado} onClick={async () => { setOcupado(true); try { await onOk(); } finally { setOcupado(false); } }}>{boton}</button>
      </div>
    </Modal>
  );
}

/* ==================== Selector de puesto ==================== */

function SelectPuesto({ puestos, departamentos, departamento, value, onChange, disabled }: {
  puestos: api.PuestoCat[];
  departamentos: { id: string; nombre: string }[];
  departamento: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  // Siempre agrupado por departamento; el del empleado va primero
  const depId = departamentos.find((d) => d.nombre.toLowerCase() === departamento.trim().toLowerCase())?.id ?? null;
  const activos = puestos.filter((p) => p.activo || p.id === value);
  const grupos = departamentos
    .map((d) => ({ id: d.id, label: d.nombre, items: activos.filter((p) => p.departamento_id === d.id) }))
    .filter((g) => g.items.length)
    .sort((a, b) => (a.id === depId ? -1 : b.id === depId ? 1 : 0));
  const sinDepto = activos.filter((p) => !p.departamento_id || !departamentos.some((d) => d.id === p.departamento_id));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">— sin puesto por defecto —</option>
      {grupos.map((g) => (
        <optgroup key={g.id} label={g.label}>{g.items.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</optgroup>
      ))}
      {sinDepto.length ? <optgroup label="Sin departamento">{sinDepto.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</optgroup> : null}
    </select>
  );
}

/* ==================== Alta ==================== */

function ModalAlta({ maestros, centroInicial, onCerrar, onCreado, avisar }: {
  maestros: Maestros;
  centroInicial: string;
  onCerrar: () => void;
  onCreado: (id: string, nombre: string) => void;
  avisar: (m: string) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [apellidos, setApellidos] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [centroId, setCentroId] = useState(centroInicial || maestros.centros[0]?.id || "");
  const [depto, setDepto] = useState("");
  const [puestoId, setPuestoId] = useState("");
  const [contrato, setContrato] = useState(maestros.contratos[0] ?? "");
  const [horas, setHoras] = useState("40");
  const [fechaAlta, setFechaAlta] = useState(hoyIso());
  const [codigo, setCodigo] = useState("");
  const [nacimiento, setNacimiento] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const deptosCentro = maestros.deptosPorCentro[centroId]?.length ? maestros.deptosPorCentro[centroId] : maestros.departamentos.map((d) => d.nombre);
  const edad = edadDe(nacimiento || null);

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!nombre.trim()) { avisar("Falta el nombre"); return; }
    if (!centroId) { avisar("Elige el centro principal"); return; }
    if (!fechaAlta) { avisar("Falta la fecha de alta"); return; }
    setOcupado(true);
    const r = await api.altaEmpleadoV2({
      nombre: nombre.trim(),
      apellidos: apellidos.trim() || null,
      email: email.trim() || null,
      telefono: telefono.trim() || null,
      centro_principal_id: centroId,
      departamento: depto || null,
      puesto_defecto_id: puestoId || null,
      tipo_contrato: contrato || null,
      horas_semana: horas === "" ? null : Number(horas),
      fecha_alta: fechaAlta,
      codigo_nomina: codigo.trim() || null,
      fecha_nacimiento: nacimiento || null,
      nota: null,
    });
    setOcupado(false);
    if (!r.ok || !r.data) { avisar("No se pudo dar de alta: " + (r.error || "error desconocido")); return; }
    if (r.error) avisar(r.error);
    onCreado(r.data, nombre.trim());
  };

  return (
    <Modal titulo="Nuevo empleado" sub="Se crea la ficha, su asignación al centro y el primer periodo de contrato." ancho bloqueado={ocupado} onCerrar={onCerrar}>
      <form onSubmit={enviar}>
        <div className="fila-2">
          <div><label>Nombre *</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus required /></div>
          <div><label>Apellidos</label><input value={apellidos} onChange={(e) => setApellidos(e.target.value)} /></div>
        </div>
        <div className="fila-2">
          <div><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Para la app del empleado" /></div>
          <div><label>Teléfono</label><input value={telefono} onChange={(e) => setTelefono(e.target.value)} /></div>
        </div>
        <div className="fila-2">
          <div><label>Centro principal *</label>
            <select value={centroId} onChange={(e) => { setCentroId(e.target.value); setDepto(""); }}>
              {maestros.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div><label>Departamento</label>
            <select value={depto} onChange={(e) => { setDepto(e.target.value); setPuestoId(""); }}>
              <option value="">— sin asignar —</option>
              {deptosCentro.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>
        <div className="fila-2">
          <div><label>Puesto por defecto</label>
            <SelectPuesto puestos={maestros.puestos} departamentos={maestros.departamentos} departamento={depto} value={puestoId} onChange={setPuestoId} />
          </div>
          <div><label>Tipo de contrato</label>
            <select value={contrato} onChange={(e) => setContrato(e.target.value)}>
              <option value="">— sin asignar —</option>
              {maestros.contratos.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="emp-fila-3">
          <div><label>Horas/semana</label><input type="number" step={0.5} min={0} max={80} value={horas} onChange={(e) => setHoras(e.target.value)} /></div>
          <div><label>Fecha de alta *</label><input type="date" value={fechaAlta} onChange={(e) => setFechaAlta(e.target.value)} required /></div>
          <div><label>Código nómina</label><input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Código en la gestoría" /></div>
        </div>
        <div className="fila-2">
          <div><label>Fecha de nacimiento</label><input type="date" value={nacimiento} onChange={(e) => setNacimiento(e.target.value)} /></div>
          <div />
        </div>
        {edad != null && edad < 18 ? <div className="aviso-modal">Menor de edad ({edad} años): no puede trabajar en horario nocturno.</div> : null}
        <div className="modal-acciones">
          <button type="button" className="btn btn-fantasma" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={ocupado}>{ocupado ? "Creando…" : "Dar de alta"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ==================== Ficha ==================== */

function FichaEmpleado({ empleado: e, maestros, esGestor, avisar, recargar, onEstadoCambiado }: {
  empleado: api.EmpleadoLista;
  maestros: Maestros;
  esGestor: boolean;
  avisar: (m: string) => void;
  recargar: () => void;
  /** Tras baja/reactivar: para que la lista cambie de pestaña y la persona no «desaparezca». */
  onEstadoCambiado: (estado: FiltroEstado) => void;
}) {
  const [nombre, setNombre] = useState(e.nombre);
  const [apellidos, setApellidos] = useState(e.apellidos ?? "");
  const [email, setEmail] = useState(e.email ?? "");
  const [telefono, setTelefono] = useState(e.telefono ?? "");
  const [centroId, setCentroId] = useState(e.centro_principal_id ?? maestros.centros[0]?.id ?? "");
  const [depto, setDepto] = useState(e.departamento ?? "");
  const [puestoId, setPuestoId] = useState(e.puesto_defecto_id ?? "");
  const [contrato, setContrato] = useState(e.tipo_contrato ?? "");
  const [codigo, setCodigo] = useState(e.codigo_nomina ?? "");
  const [nacimiento, setNacimiento] = useState(e.fecha_nacimiento ?? "");
  const [nota, setNota] = useState(e.nota ?? "");
  const [movil, setMovil] = useState(!!e.fichaje_movil);
  const [contIni, setContIni] = useState(e.contador_inicial_h != null ? String(e.contador_inicial_h) : "0");
  const [contIniFecha, setContIniFecha] = useState(e.contador_inicial_fecha ?? "");
  const [guardando, setGuardando] = useState(false);

  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [pinNuevo, setPinNuevo] = useState("");

  // Centros: alta inline + modal de cierre
  const [nCentro, setNCentro] = useState("");
  const [nCentroDesde, setNCentroDesde] = useState(hoyIso());
  const [cerrarAsig, setCerrarAsig] = useState<api.Asignacion | null>(null);
  const [cerrarAsigFecha, setCerrarAsigFecha] = useState(hoyIso());
  const [cerrandoAsig, setCerrandoAsig] = useState(false);

  // Modales
  const [modalPeriodo, setModalPeriodo] = useState<{ periodo: Periodo | null } | null>(null);
  const [borrarPer, setBorrarPer] = useState<Periodo | null>(null);
  const [modalBaja, setModalBaja] = useState(false);
  const [modalReactivar, setModalReactivar] = useState(false);
  const [confirmPin, setConfirmPin] = useState(false);

  const cargarFicha = useCallback(() => { api.cargarFicha(e.id).then(setFicha); }, [e.id]);
  useEffect(() => { cargarFicha(); }, [cargarFicha]);
  const refrescar = () => { cargarFicha(); recargar(); };

  const dis = !esGestor;
  const hoy = hoyIso();
  const deptosCentro = maestros.deptosPorCentro[centroId]?.length ? maestros.deptosPorCentro[centroId] : maestros.departamentos.map((d) => d.nombre);
  const nombreCentro = (id: string | null) => maestros.centros.find((c) => c.id === id)?.nombre || "—";
  const puestoDefecto = maestros.puestos.find((p) => p.id === e.puesto_defecto_id) ?? null;
  const edad = edadDe(e.fecha_nacimiento);
  const periodos = ficha?.periodos ?? null;
  const asignaciones = ficha?.asignaciones ?? [];
  const asigAbiertas = asignaciones.filter((a) => !a.fecha_fin || a.fecha_fin >= hoy);
  const centrosDisponibles = maestros.centros.filter((c) => !asigAbiertas.some((a) => a.centro_id === c.id));
  const ultimoPeriodo = periodos?.length ? periodos[0] : null;

  const estadoPeriodo = (p: Periodo) =>
    p.fecha_alta > hoy ? { txt: "Próximo", cl: "prox" } : p.fecha_baja && p.fecha_baja < hoy ? { txt: "Finalizado", cl: "fin" } : { txt: "Activo", cl: "ok" };
  const estadoAsig = (a: api.Asignacion) =>
    a.fecha_inicio && a.fecha_inicio > hoy ? { txt: "Próxima", cl: "prox" } : a.fecha_fin && a.fecha_fin < hoy ? { txt: "Cerrada", cl: "fin" } : { txt: "Vigente", cl: "ok" };

  // Histórico agrupado por día
  const dias: Record<string, NonNullable<Ficha["historial"]>> = {};
  for (const fch of ficha?.historial ?? []) {
    const d = new Date(fch.ts).toLocaleDateString("sv-SE");
    (dias[d] = dias[d] || []).push(fch);
  }

  const guardar = async (ev: FormEvent) => {
    ev.preventDefault();
    setGuardando(true);
    const r = await api.guardarEmpleadoV2(e.id, {
      nombre: nombre.trim(),
      apellidos: apellidos.trim() || null,
      email: email.trim() || null,
      telefono: telefono.trim() || null,
      centro_principal_id: centroId,
      departamento: depto.replace(/ \(otro centro\)$/, "").trim() || null,
      puesto_defecto_id: puestoId || null,
      tipo_contrato: contrato.trim() || null,
      codigo_nomina: codigo.trim() || null,
      fecha_nacimiento: nacimiento || null,
      nota: nota.trim() || null,
      fichaje_movil: movil,
      contador_inicial_h: Number(contIni.replace(",", ".")) || 0,
      contador_inicial_fecha: contIniFecha || null,
    });
    setGuardando(false);
    if (!r.ok) { avisar("No se pudo guardar: " + r.error); return; }
    avisar(r.error ? `Ficha guardada. ${r.error}` : "Ficha guardada");
    refrescar();
  };

  const saldoH = ficha?.saldoHoras ?? null;
  const saldoV = ficha?.saldoVacaciones ?? null;
  const tituloSaldoH = e.contador_inicial_fecha
    ? `Contador desde el saldo inicial de ${fmtHoras(e.contador_inicial_h)} a cierre del ${fmtFecha(e.contador_inicial_fecha)} hasta hoy (semanas completas)`
    : `Contador desde el 1 de enero hasta hoy (semanas completas)${e.contador_inicial_h ? `, con saldo inicial de ${fmtHoras(e.contador_inicial_h)}` : ""}`;

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="emp-cab">
        <div className="avatar grande">{iniciales(e.nombre + " " + (e.apellidos || ""))}</div>
        <div>
          <h2>{e.nombre} {e.apellidos || ""}</h2>
          <div className="nota">{nombreCentro(e.centro_principal_id)}{e.departamento ? ` · ${e.departamento}` : ""}{e.codigo_nomina ? ` · nº ${e.codigo_nomina}` : ""}</div>
        </div>
        {esGestor ? (
          <div className="emp-acciones">
            {e._estado === "activo" ? (
              <button className="btn btn-borrar btn-peque" onClick={() => setModalBaja(true)}>Dar de baja</button>
            ) : (
              <button className="btn btn-primario btn-peque" onClick={() => setModalReactivar(true)}>Reactivar / llamamiento</button>
            )}
          </div>
        ) : null}
      </div>

      <div className="emp-chips">
        <span className={`emp-chip estado-${e._estado}`}>
          <span className="emp-punto" style={{ background: "currentColor" }} />
          {ESTADO_TXT[e._estado]}
          {e._estado === "activo" && e._horas != null ? <small>{fmtNum(e._horas)} h/sem</small> : null}
          {e._estado === "inactivo" ? <small>fijo-disc.{e._desde ? ` · desde ${fmtFecha(e._desde)}` : ""}{e._vuelve ? ` · vuelve el ${fmtFecha(e._vuelve)}` : ""}</small> : null}
          {e._estado === "baja" && e._desde ? <small>último día {fmtFecha(e._desde)}</small> : null}
        </span>
        {puestoDefecto ? (
          <span className="emp-chip"><span className="emp-punto" style={{ background: puestoDefecto.color }} />{puestoDefecto.nombre}</span>
        ) : null}
        {ficha === null ? (
          <span className="emp-chip"><small>Calculando saldos…</small></span>
        ) : (
          <>
            <span className={`emp-chip ${saldoH == null ? "" : saldoH >= 0 ? "saldo-pos" : "saldo-neg"}`} title={tituloSaldoH}>
              Horas {saldoH == null ? "—" : (saldoH > 0 ? "+" : "") + fmtHoras(saldoH)}
              <small>saldo</small>
            </span>
            <span className="emp-chip" title={saldoV ? `Derecho anual ${fmtNum(saldoV.derecho_anual)} · devengado a hoy ${fmtNum(saldoV.devengado_hoy)} · disfrutados ${fmtNum(saldoV.disfrutados)} · pendientes de aprobar ${fmtNum(saldoV.pendientes_aprobar)}` : undefined}>
              Vacaciones {saldoV ? <><small>quedan</small> {fmtNum(saldoV.resto)} de {fmtNum(saldoV.derecho_anual)} días</> : "—"}
            </span>
          </>
        )}
        {edad != null && edad < 18 ? <span className="emp-chip menor">Menor de edad · {edad} años</span> : null}
        {e.fichaje_movil ? <span className="emp-chip">Fichaje móvil</span> : null}
        {!e.tiene_pin ? <span className="emp-chip"><small>sin PIN</small></span> : null}
      </div>

      {/* ---------- Datos ---------- */}
      <div className="panel">
        <h3>Datos</h3>
        <form onSubmit={guardar}>
          <div className="grid-2 emp-grid-2">
            <div><label>Nombre</label><input value={nombre} onChange={(ev) => setNombre(ev.target.value)} disabled={dis} required /></div>
            <div><label>Apellidos</label><input value={apellidos} onChange={(ev) => setApellidos(ev.target.value)} disabled={dis} /></div>
            <div><label>Email</label><input type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} disabled={dis} /></div>
            <div><label>Teléfono</label><input value={telefono} onChange={(ev) => setTelefono(ev.target.value)} disabled={dis} /></div>
          </div>
          <div className="grid-2 emp-grid-2">
            <div><label>Centro principal</label>
              <select value={centroId} onChange={(ev) => setCentroId(ev.target.value)} disabled={dis}>
                {maestros.centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div><label>Departamento</label>
              <select value={depto} onChange={(ev) => setDepto(ev.target.value)} disabled={dis}>
                <option value="">— sin asignar —</option>
                {deptosCentro.map((d) => <option key={d} value={d}>{d}</option>)}
                {depto && !deptosCentro.includes(depto) ? <option value={depto}>{depto} (otro centro)</option> : null}
              </select>
            </div>
            <div><label>Puesto por defecto</label>
              <SelectPuesto puestos={maestros.puestos} departamentos={maestros.departamentos} departamento={depto} value={puestoId} onChange={setPuestoId} disabled={dis} />
              <div className="emp-ayuda">Se propone al crear un turno nuevo.</div>
            </div>
            <div><label>Tipo de contrato</label>
              <select value={contrato} onChange={(ev) => setContrato(ev.target.value)} disabled={dis}>
                <option value="">— sin asignar —</option>
                {maestros.contratos.map((c) => <option key={c} value={c}>{c}</option>)}
                {contrato && !maestros.contratos.includes(contrato) ? <option value={contrato}>{contrato}</option> : null}
              </select>
            </div>
          </div>
          <div className="emp-grid-3">
            <div><label>Código nómina</label><input value={codigo} onChange={(ev) => setCodigo(ev.target.value)} disabled={dis} placeholder="Código en la gestoría" /></div>
            <div><label>Fecha de nacimiento</label><input type="date" value={nacimiento} onChange={(ev) => setNacimiento(ev.target.value)} disabled={dis} /></div>
            <div><label>Alta / baja</label>
              <div style={{ padding: "8px 0", fontSize: 13 }}>
                {e.fecha_alta ? fmtFecha(e.fecha_alta) : "—"}{e.fecha_baja ? ` → ${fmtFecha(e.fecha_baja)}` : ""}
                <div className="emp-ayuda">Se calcula desde los periodos de contrato.</div>
              </div>
            </div>
          </div>
          <div>
            <label>Nota</label>
            <textarea className="emp-textarea" value={nota} onChange={(ev) => setNota(ev.target.value)} disabled={dis} placeholder="Lo que haga falta recordar de esta persona" />
          </div>
          <div className="emp-sep" />
          <div className="grid-2 emp-grid-2">
            <div><label>Contador inicial de horas</label><input type="number" step={0.25} value={contIni} onChange={(ev) => setContIni(ev.target.value)} disabled={dis} />
              <div className="emp-ayuda">Saldo con el que arranca el contador (el que traiga de Skello, en horas; negativo si debe).</div>
            </div>
            <div><label>Saldo a cierre del día</label><input type="date" value={contIniFecha} onChange={(ev) => setContIniFecha(ev.target.value)} disabled={dis} />
              <div className="emp-ayuda">Normalmente el domingo de cierre. Se cuenta desde el lunes siguiente. Sin fecha: desde el 1 de enero.</div>
            </div>
          </div>
          <div className="check">
            <input type="checkbox" id="rh-ef-movil" checked={movil} onChange={(ev) => setMovil(ev.target.checked)} disabled={dis} />
            <label htmlFor="rh-ef-movil" style={{ margin: 0 }}>Puede fichar desde el móvil (con geolocalización)</label>
          </div>
          {esGestor ? <div className="fila-acciones"><button className="btn btn-primario" type="submit" disabled={guardando}>{guardando ? "Guardando…" : "Guardar cambios"}</button></div> : null}
        </form>
      </div>

      {/* ---------- Centros ---------- */}
      <div className="panel">
        <h3>Centros</h3>
        <div className="nota" style={{ marginBottom: 10 }}>
          Dónde puede tener turnos. El centro principal se cambia en los datos de arriba y no se puede cerrar desde aquí.
        </div>
        {ficha === null ? (
          <div className="nota">Cargando…</div>
        ) : !asignaciones.length ? (
          <div className="nota">No está asignado a ningún centro: no saldrá en el cuadrante.</div>
        ) : (
          <table className="emp-tabla">
            <thead><tr><th>Centro</th><th>Desde</th><th>Hasta</th><th>Estado</th>{esGestor ? <th /> : null}</tr></thead>
            <tbody>
              {asignaciones.map((a) => {
                const s = estadoAsig(a);
                const principal = a.centro_id === e.centro_principal_id && !a.fecha_fin;
                return (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 600 }}>{nombreCentro(a.centro_id)}{principal ? <span className="emp-badge principal">principal</span> : null}</td>
                    <td>{a.fecha_inicio ? fmtFecha(a.fecha_inicio) : "—"}</td>
                    <td>{a.fecha_fin ? fmtFecha(a.fecha_fin) : <span style={{ color: "var(--tinta-suave)" }}>abierta</span>}</td>
                    <td><span className={`emp-badge ${s.cl}`}>{s.txt}</span></td>
                    {esGestor ? (
                      <td className="r">
                        {!a.fecha_fin && !principal ? <button className="link-btn2" onClick={() => { setCerrarAsigFecha(hoy); setCerrarAsig(a); }}>Cerrar</button> : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {esGestor && ficha ? (
          <div className="emp-fila-add">
            <div><label>Añadir centro</label>
              <select value={nCentro} onChange={(ev) => setNCentro(ev.target.value)} style={{ minWidth: 200 }}>
                <option value="">— elige —</option>
                {centrosDisponibles.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div><label>Desde</label><input type="date" value={nCentroDesde} onChange={(ev) => setNCentroDesde(ev.target.value)} /></div>
            <button className="btn btn-fantasma btn-peque" disabled={!nCentro} onClick={async () => {
              const r = await api.anadirAsignacion(e.id, nCentro, nCentroDesde);
              if (!r.ok) { avisar("No se pudo añadir: " + r.error); return; }
              avisar(`Añadido a ${nombreCentro(nCentro)}`); setNCentro(""); refrescar();
            }}>Añadir</button>
          </div>
        ) : null}
      </div>

      {/* ---------- Periodos ---------- */}
      <div className="panel">
        <h3>Periodos de contrato</h3>
        <div className="nota" style={{ marginBottom: 10 }}>
          Para fijos-discontinuos, cada temporada es un periodo (alta–baja). La fecha de baja es el último día que trabaja. Fuera de sus periodos no aparece en el cuadrante.
        </div>
        {periodos === null ? (
          <div className="nota">Cargando…</div>
        ) : !periodos.length ? (
          <div className="nota">Sin periodos registrados.</div>
        ) : (
          <table className="emp-tabla" style={{ marginBottom: esGestor ? 12 : 0 }}>
            <thead><tr><th>Alta</th><th>Baja</th><th>Horas/sem.</th><th>Estado</th><th>Nota</th>{esGestor ? <th /> : null}</tr></thead>
            <tbody>
              {periodos.map((p) => {
                const s = estadoPeriodo(p);
                return (
                  <tr key={p.id}>
                    <td>{fmtFecha(p.fecha_alta)}</td>
                    <td>{p.fecha_baja ? fmtFecha(p.fecha_baja) : <span style={{ color: "var(--tinta-suave)" }}>abierto</span>}</td>
                    <td>{p.horas_semana != null ? fmtHoras(p.horas_semana) : "—"}</td>
                    <td><span className={`emp-badge ${s.cl}`}>{s.txt}</span></td>
                    <td><div className="emp-nota-periodo" title={p.nota ?? ""}>{p.nota || ""}</div></td>
                    {esGestor ? (
                      <td className="r">
                        <button className="link-btn2" onClick={() => setModalPeriodo({ periodo: p })}>Editar</button>
                        <button className="link-btn2" style={{ color: "var(--red)" }} onClick={() => setBorrarPer(p)}>Borrar</button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {esGestor ? <button className="btn btn-fantasma btn-peque" onClick={() => setModalPeriodo({ periodo: null })}>+ Añadir periodo</button> : null}
      </div>

      {/* ---------- PIN ---------- */}
      <div className="panel">
        <h3>PIN de fichaje</h3>
        <div className="pin-caja">
          <span className="nota">{e.tiene_pin ? "Tiene PIN. No se puede consultar (solo se guarda cifrado)." : "Todavía no tiene PIN: no puede fichar en la tablet."}</span>
          {esGestor ? <button className="btn btn-fantasma" onClick={() => setConfirmPin(true)}>{e.tiene_pin ? "Generar nuevo PIN" : "Generar PIN"}</button> : null}
          <span className="pin-valor">{pinNuevo}</span>
        </div>
        {pinNuevo ? <div className="nota" style={{ marginTop: 6 }}>Apúntalo y dáselo ahora: no se volverá a mostrar.</div> : null}
      </div>

      {/* ---------- Historial ---------- */}
      <div className="panel">
        <h3>Fichajes · últimos 14 días</h3>
        {ficha === null ? (
          <div className="nota">Cargando…</div>
        ) : !ficha.historial.length ? (
          <div className="nota">Sin fichajes en las dos últimas semanas.</div>
        ) : (
          Object.keys(dias).sort().reverse().map((d) => {
            const { efectivos, anulados } = efectivosDe(dias[d]);
            const { horas, inc, enCurso } = calcularDia(efectivos, d === hoy);
            const sinSalida = inc.includes("entrada sin salida");
            return (
              <div key={d} className="dia-h">
                <span className="f">{new Date(d + "T12:00").toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit" })}</span>
                <span className="h">{fmtHoras(horas)}</span>
                {dias[d].map((fch) => {
                  const anu = anulados.has(fch.id);
                  const cl = anu ? fch.tipo + " anulado" : fch.metodo === "correccion" ? "correccion" : fch.tipo;
                  return (
                    <span key={fch.id} className={`chip ${cl}`} style={{ cursor: "default" }} title={fch.metodo === "correccion" ? fch.motivo_correccion || "" : fch.metodo}>
                      {NT[fch.tipo]} {horaDe(fch.ts)}
                    </span>
                  );
                })}
                {enCurso && d === hoy ? <span className="badge-inc" style={{ background: "var(--green-light)", color: "var(--green)" }}>En curso</span> : null}
                {sinSalida ? <span className="badge-inc">⚠ sin salida</span> : null}
              </div>
            );
          })
        )}
      </div>

      {/* ---------- Modales ---------- */}
      {modalPeriodo ? (
        <ModalPeriodo
          periodo={modalPeriodo.periodo}
          horasDefecto={ultimoPeriodo?.horas_semana ?? e.horas_semana ?? null}
          onCerrar={() => setModalPeriodo(null)}
          onGuardar={async (fila) => {
            const r = await api.guardarPeriodoV2(modalPeriodo.periodo?.id ?? null, e.id, fila);
            if (!r.ok) { avisar("No se pudo guardar: " + r.error); return false; }
            avisar(modalPeriodo.periodo ? "Periodo actualizado" : "Periodo añadido");
            setModalPeriodo(null); refrescar();
            return true;
          }}
        />
      ) : null}

      {borrarPer ? (
        <ModalConfirmar
          titulo="Borrar periodo"
          texto={<>¿Borrar el periodo del {fmtFecha(borrarPer.fecha_alta)}{borrarPer.fecha_baja ? ` al ${fmtFecha(borrarPer.fecha_baja)}` : " (abierto)"}? Se usa para saber cuándo está activo y para el contador de horas.</>}
          boton="Borrar"
          peligro
          onCerrar={() => setBorrarPer(null)}
          onOk={async () => {
            const r = await base.borrarPeriodo(borrarPer.id, e.id);
            if (!r.ok) { avisar("No se pudo borrar: " + r.error); return; }
            avisar("Periodo borrado"); setBorrarPer(null); refrescar();
          }}
        />
      ) : null}

      {cerrarAsig ? (
        <Modal titulo={`Cerrar ${nombreCentro(cerrarAsig.centro_id)}`} sub="A partir del día siguiente no se le podrán poner turnos en este centro." bloqueado={cerrandoAsig} onCerrar={() => setCerrarAsig(null)}>
          <label>Último día en este centro</label>
          <input type="date" value={cerrarAsigFecha} min={cerrarAsig.fecha_inicio ?? undefined} onChange={(ev) => setCerrarAsigFecha(ev.target.value)} autoFocus />
          <div className="modal-acciones">
            <button className="btn btn-fantasma" onClick={() => setCerrarAsig(null)} disabled={cerrandoAsig}>Cancelar</button>
            <button className="btn btn-primario" disabled={cerrandoAsig} onClick={async () => {
              setCerrandoAsig(true);
              try {
                const r = await api.cerrarAsignacion(cerrarAsig.id, cerrarAsigFecha);
                if (!r.ok) { avisar(r.error || "No se pudo cerrar"); return; }
                avisar("Centro cerrado"); setCerrarAsig(null); refrescar();
              } finally { setCerrandoAsig(false); }
            }}>{cerrandoAsig ? "Cerrando…" : "Cerrar centro"}</button>
          </div>
        </Modal>
      ) : null}

      {modalBaja ? (
        <ModalBaja
          nombre={e.nombre}
          fijoDisc={/discontinu/i.test(e.tipo_contrato ?? "")}
          centros={asigAbiertas.map((a) => nombreCentro(a.centro_id))}
          onCerrar={() => setModalBaja(false)}
          onOk={async (ultimoDia, motivo, detalle) => {
            const r = await api.darDeBaja(e.id, ultimoDia, motivo, detalle);
            if (!r.ok) { avisar(r.error || "No se pudo dar de baja"); return; }
            avisar(`${e.nombre}: baja el ${fmtFecha(ultimoDia)}`); setModalBaja(false);
            onEstadoCambiado(/discontinu/i.test(e.tipo_contrato ?? "") ? "inactivo" : "baja"); refrescar();
          }}
        />
      ) : null}

      {modalReactivar ? (
        <ModalReactivar
          nombre={e.nombre}
          centro={nombreCentro(e.centro_principal_id)}
          horasDefecto={ultimoPeriodo?.horas_semana ?? e.horas_semana ?? null}
          ultimoDia={e._desde}
          onCerrar={() => setModalReactivar(false)}
          onOk={async (fechaAlta, horas, notaP) => {
            const r = await api.reactivar(e.id, fechaAlta, horas, notaP);
            if (!r.ok) { avisar(r.error || "No se pudo reactivar"); return; }
            avisar(`${e.nombre} vuelve el ${fmtFecha(fechaAlta)}`); setModalReactivar(false);
            onEstadoCambiado(fechaAlta > hoy ? "inactivo" : "activo"); refrescar();
          }}
        />
      ) : null}

      {confirmPin ? (
        <ModalConfirmar
          titulo={e.tiene_pin ? "Generar nuevo PIN" : "Generar PIN"}
          texto={e.tiene_pin ? `El PIN anterior de ${e.nombre} dejará de funcionar al instante. El nuevo se muestra una sola vez.` : `Se genera un PIN de 4 cifras para que ${e.nombre} fiche en la tablet. Se muestra una sola vez.`}
          boton="Generar"
          onCerrar={() => setConfirmPin(false)}
          onOk={async () => {
            const r = await fetch("/api/rrhh/fichar", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ accion: "nuevo_pin", empleado_id: e.id }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.ok) { avisar(d.error || "No se pudo generar el PIN"); return; }
            setPinNuevo(String(d.pin)); setConfirmPin(false); recargar();
          }}
        />
      ) : null}
    </div>
  );
}

/* ==================== Modal periodo ==================== */

function ModalPeriodo({ periodo, horasDefecto, onCerrar, onGuardar }: {
  periodo: Periodo | null;
  horasDefecto: number | null;
  onCerrar: () => void;
  onGuardar: (fila: { fecha_alta: string; fecha_baja: string | null; horas_semana: number | null; nota: string | null }) => Promise<boolean>;
}) {
  const [alta, setAlta] = useState(periodo?.fecha_alta ?? hoyIso());
  const [baja, setBaja] = useState(periodo?.fecha_baja ?? "");
  const [horas, setHoras] = useState(periodo ? (periodo.horas_semana != null ? String(periodo.horas_semana) : "") : horasDefecto != null ? String(horasDefecto) : "");
  const [nota, setNota] = useState(periodo?.nota ?? "");
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal titulo={periodo ? "Editar periodo" : "Nuevo periodo de contrato"} sub="La baja es el último día que trabaja. Déjala vacía si el periodo sigue abierto." bloqueado={ocupado} onCerrar={onCerrar}>
      <form onSubmit={async (ev) => {
        ev.preventDefault();
        if (!alta) return;
        setOcupado(true);
        const ok = await onGuardar({ fecha_alta: alta, fecha_baja: baja || null, horas_semana: horas === "" ? null : Number(horas.replace(",", ".")), nota: nota || null });
        if (!ok) setOcupado(false);
      }}>
        <div className="fila-2">
          <div><label>Alta *</label><input type="date" value={alta} onChange={(ev) => setAlta(ev.target.value)} required autoFocus /></div>
          <div><label>Baja</label><input type="date" value={baja} min={alta || undefined} onChange={(ev) => setBaja(ev.target.value)} /></div>
        </div>
        <label>Horas/semana</label>
        <input type="number" step={0.5} min={0} max={80} value={horas} onChange={(ev) => setHoras(ev.target.value)} placeholder="40" />
        <label>Nota</label>
        <input value={nota} onChange={(ev) => setNota(ev.target.value)} placeholder="Temporada, cambio de jornada, motivo…" />
        <div className="modal-acciones">
          <button type="button" className="btn btn-fantasma" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={ocupado || !alta}>{ocupado ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ==================== Modal baja ==================== */

function ModalBaja({ nombre, fijoDisc, centros, onCerrar, onOk }: {
  nombre: string;
  fijoDisc: boolean;
  centros: string[];
  onCerrar: () => void;
  onOk: (ultimoDia: string, motivo: string, detalle: string | null) => Promise<void>;
}) {
  const [ultimoDia, setUltimoDia] = useState(hoyIso());
  const [motivo, setMotivo] = useState(fijoDisc ? MOTIVOS_BAJA[0] : MOTIVOS_BAJA[1]);
  const [detalle, setDetalle] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal titulo={`Dar de baja a ${nombre}`} bloqueado={ocupado} onCerrar={onCerrar}>
      <form onSubmit={async (ev) => { ev.preventDefault(); setOcupado(true); try { await onOk(ultimoDia, motivo, detalle || null); } finally { setOcupado(false); } }}>
        <label>Último día que trabaja *</label>
        <input type="date" value={ultimoDia} onChange={(ev) => setUltimoDia(ev.target.value)} required autoFocus />
        <label>Motivo *</label>
        <select value={motivo} onChange={(ev) => setMotivo(ev.target.value)}>
          {MOTIVOS_BAJA.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <label>Detalle</label>
        <input value={detalle} onChange={(ev) => setDetalle(ev.target.value)} placeholder="Opcional" />
        <div className="emp-resumen">
          Se cierra su periodo de contrato{centros.length ? ` y su asignación a ${centros.join(", ")}` : ""} el {ultimoDia ? fmtFecha(ultimoDia) : "…"}.
          {" Los turnos posteriores a esa fecha hay que quitarlos del cuadrante."}
          {fijoDisc ? " Al ser fijo-discontinuo, queda como inactivo: para la próxima temporada usa «Reactivar / llamamiento»." : ""}
        </div>
        <div className="modal-acciones">
          <button type="button" className="btn btn-fantasma" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
          <button type="submit" className="btn btn-peligro" disabled={ocupado || !ultimoDia}>{ocupado ? "Cerrando…" : "Dar de baja"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ==================== Modal reactivar ==================== */

function ModalReactivar({ nombre, centro, horasDefecto, ultimoDia, onCerrar, onOk }: {
  nombre: string;
  centro: string;
  horasDefecto: number | null;
  ultimoDia: string | null;
  onCerrar: () => void;
  onOk: (fechaAlta: string, horas: number | null, nota: string | null) => Promise<void>;
}) {
  // El primer día tiene que ser posterior al último trabajado: si no, se duplicaría un día en el contador
  const minDia = ultimoDia ? sumaDia(ultimoDia, 1) : undefined;
  const [fechaAlta, setFechaAlta] = useState(() => (minDia && hoyIso() < minDia ? minDia : hoyIso()));
  const [horas, setHoras] = useState(horasDefecto != null ? String(horasDefecto) : "");
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal titulo={`Reactivar a ${nombre}`} sub={ultimoDia ? `Último día trabajado: ${fmtFecha(ultimoDia)}.` : undefined} bloqueado={ocupado} onCerrar={onCerrar}>
      <form onSubmit={async (ev) => { ev.preventDefault(); setOcupado(true); try { await onOk(fechaAlta, horas === "" ? null : Number(horas.replace(",", ".")), nota || null); } finally { setOcupado(false); } }}>
        <div className="fila-2">
          <div><label>Primer día *</label><input type="date" value={fechaAlta} min={minDia} onChange={(ev) => setFechaAlta(ev.target.value)} required autoFocus /></div>
          <div><label>Horas/semana</label><input type="number" step={0.5} min={0} max={80} value={horas} onChange={(ev) => setHoras(ev.target.value)} placeholder="40" /></div>
        </div>
        <label>Nota</label>
        <input value={nota} onChange={(ev) => setNota(ev.target.value)} placeholder="Temporada 2027, llamamiento…" />
        <div className="emp-resumen">
          Se abre un periodo de contrato nuevo desde el {fechaAlta ? fmtFecha(fechaAlta) : "…"} y vuelve a {centro}. Los centros que tuviera además de ese se añaden desde la ficha.
        </div>
        <div className="modal-acciones">
          <button type="button" className="btn btn-fantasma" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
          <button type="submit" className="btn btn-primario" disabled={ocupado || !fechaAlta || (!!minDia && fechaAlta < minDia)}>{ocupado ? "Reactivando…" : "Reactivar"}</button>
        </div>
      </form>
    </Modal>
  );
}
