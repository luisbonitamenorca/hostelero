"use client";

/* Ajustes › Camareros: el equipo de sala del restaurante (nombre, color, ficha de Personal) y la
   asignación de mesas por día y turno (reservas_mesas_camarero_dia). Día y el plano pueden leer el
   reparto con acciones/ajustes › repartoDelDia (el filtro «por camarero» aún no está cableado). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { fmtFechaLarga, sumarDias } from "../../lib-reservas";
import type { Mesa } from "../../tipos";
import {
  asignarCamareroMesa,
  asignarCamareroMesas,
  borrarCamarero,
  copiarAsignacionesCamarero,
  guardarCamarero,
  listarAsignacionesCamarero,
  listarCamareros,
  listarEmpleadosCamareros,
  type Camarero,
  type CamareroDia,
} from "../../acciones/ajustes";
import { Boton, Cabecera, Campo, ColorCampo, Confirmar, Interruptor, ModalForm, Panel, PALETA, SoloLectura, Vacio, textoSobre, useAccion, type AjProps } from "./comunes";

const ordenMesa = (a: Mesa, b: Mesa) => a.nombre.localeCompare(b.nombre, "es", { numeric: true });

/* ==================== Modal de camarero ==================== */

function ModalCamarero({ c, restId, empleados, usados, avisar, cerrar, guardado, puedeBorrar }: {
  c: Camarero | null;
  restId: string;
  empleados: { id: string; nombre: string }[];
  usados: string[];
  avisar: (m: string) => void;
  cerrar: () => void;
  guardado: () => void;
  puedeBorrar: boolean;
}) {
  // Color nuevo: el primero de la paleta que no use nadie.
  const colorLibre = PALETA.find((x) => !usados.includes(x.toUpperCase())) ?? PALETA[0];
  const [nombre, setNombre] = useState(c?.nombre ?? "");
  const [color, setColor] = useState<string>(c?.color ?? colorLibre);
  const [activo, setActivo] = useState(c ? c.activo : true);
  const [empleado, setEmpleado] = useState<string>(c?.empleado_id ?? "");
  const [confirmar, setConfirmar] = useState(false);
  const { ocupado, correr } = useAccion(avisar);

  async function guardar() {
    if (!nombre.trim()) { avisar("Pon un nombre."); return; }
    const r = await correr(
      guardarCamarero(c?.id ?? null, restId, { nombre, color, activo, ...(empleados.length ? { empleado_id: empleado || null } : {}) }),
      c ? "Camarero guardado." : "Camarero añadido.",
    );
    if (r.ok) guardado();
  }

  return (
    <>
      <ModalForm soloLectura={!puedeBorrar} titulo={c ? `Camarero · ${c.nombre}` : "Nuevo camarero"} onCerrar={cerrar} onGuardar={guardar} ocupado={ocupado} guardarTexto={c ? "Guardar" : "Añadir"} ancho={520}
        extra={c && puedeBorrar ? <Boton tipo="peligro" onClick={() => setConfirmar(true)}>Borrar</Boton> : null}>
        <div className="aj-form">
          <Campo label="Nombre" ayuda="Como lo llama la sala (sale en el plano)." ancho="todo">
            <input autoFocus value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} placeholder="Ana" />
          </Campo>
          <Campo label="Color"><ColorCampo valor={color} onChange={(v) => v && setColor(v)} /></Campo>
          <Campo label="Estado"><Interruptor on={activo} onChange={setActivo} texto={activo ? "En activo" : "De baja"} /></Campo>
          {empleados.length ? (
            <Campo label="Ficha en Personal" ayuda="Opcional: enlaza con su ficha para cruzar turnos y propinas." ancho="todo">
              <select value={empleado} onChange={(e) => setEmpleado(e.target.value)}>
                <option value="">Sin enlazar</option>
                {empleados.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
            </Campo>
          ) : null}
        </div>
      </ModalForm>
      {confirmar && c ? (
        <Confirmar texto={`¿Borrar a ${c.nombre}?`} detalle="Si ya tiene reservas atendidas, se queda de baja en lugar de borrarse (para no perder el histórico)." confirmarTexto="Borrar" peligro ocupado={ocupado} onNo={() => setConfirmar(false)}
          onSi={async () => {
            const r = await correr(borrarCamarero(c.id));
            setConfirmar(false);
            if (r.ok) { avisar(r.data?.desactivado ? `${c.nombre} tiene histórico: se ha dado de baja.` : "Camarero borrado."); guardado(); }
          }} />
      ) : null}
    </>
  );
}

/* ==================== Pantalla ==================== */

export default function AjCamareros({ rest, fecha: fechaPanel, salas, turnos, avisar, puedeEditar }: AjProps) {
  const ro = !puedeEditar;
  const [camareros, setCamareros] = useState<Camarero[] | null>(null);
  const [empleados, setEmpleados] = useState<{ id: string; nombre: string }[]>([]);
  const [modal, setModal] = useState<{ c: Camarero | null } | null>(null);
  const [fecha, setFecha] = useState(fechaPanel);
  const [turno, setTurno] = useState<string>(""); // "" = todo el día
  const [asig, setAsig] = useState<CamareroDia[] | null>(null);
  const [preguntar, setPreguntar] = useState<null | "copiar" | "vaciar">(null);
  const { ocupado, correr } = useAccion(avisar);

  const turnosActivos = useMemo(() => turnos.filter((t) => t.activo), [turnos]);
  const salasActivas = useMemo(() => salas.filter((s) => s.activa).map((s) => ({ ...s, mesas: s.mesas.filter((m) => m.activa).sort(ordenMesa) })), [salas]);
  const activos = useMemo(() => (camareros ?? []).filter((c) => c.activo), [camareros]);
  const porId = useMemo(() => new Map((camareros ?? []).map((c) => [c.id, c])), [camareros]);

  const cargarCamareros = useCallback(async () => {
    setCamareros(await listarCamareros(rest.id));
  }, [rest.id]);
  const cargarAsig = useCallback(async () => {
    setAsig(await listarAsignacionesCamarero(rest.id, fecha));
  }, [rest.id, fecha]);

  useEffect(() => {
    cargarCamareros();
    listarEmpleadosCamareros().then(setEmpleados).catch(() => setEmpleados([]));
  }, [cargarCamareros]);
  useEffect(() => { setAsig(null); cargarAsig(); }, [cargarAsig]);

  // Asignación de cada mesa para el turno elegido, y la de «todo el día» como respaldo.
  const tId = turno || null;
  const deMesa = useMemo(() => {
    const m = new Map<string, { propia: CamareroDia | null; dia: CamareroDia | null }>();
    for (const a of asig ?? []) {
      const x = m.get(a.mesa_id) ?? { propia: null, dia: null };
      if ((a.turno_id ?? null) === tId) x.propia = a;
      if (a.turno_id === null) x.dia = a;
      m.set(a.mesa_id, x);
    }
    return m;
  }, [asig, tId]);

  /** Mesas por camarero en la vista actual (para el resumen). */
  const resumen = useMemo(() => {
    const cuenta = new Map<string, number>();
    let sin = 0;
    for (const s of salasActivas) for (const me of s.mesas) {
      const x = deMesa.get(me.id);
      const cid = x?.propia?.camarero_id ?? (tId ? x?.dia?.camarero_id : undefined);
      if (cid) cuenta.set(cid, (cuenta.get(cid) ?? 0) + 1);
      else sin++;
    }
    return { cuenta, sin };
  }, [salasActivas, deMesa, tId]);

  async function asignarUna(mesaId: string, camareroId: string) {
    const r = await correr(asignarCamareroMesa(rest.id, fecha, mesaId, tId, camareroId || null));
    if (r.ok) cargarAsig();
  }
  async function asignarSala(mesaIds: string[], camareroId: string, nombreSala: string) {
    if (!mesaIds.length) return;
    const cam = camareroId ? porId.get(camareroId)?.nombre : null;
    const r = await correr(asignarCamareroMesas(rest.id, fecha, mesaIds, tId, camareroId || null), cam ? `${nombreSala}: todas las mesas para ${cam}.` : `${nombreSala}: asignaciones quitadas.`);
    if (r.ok) cargarAsig();
  }

  const ayer = sumarDias(fecha, -1);
  const textoTurno = tId ? turnosActivos.find((t) => t.id === tId)?.nombre ?? "turno" : "todo el día";
  const hayAsig = !!asig?.length;

  return (
    <>
      <Cabecera titulo="Camareros" texto="El equipo de sala de este restaurante y qué mesas lleva cada uno cada día. El color identifica a cada camarero en este reparto.">
        {!ro ? <Boton tipo="primario" onClick={() => setModal({ c: null })}>+ Nuevo camarero</Boton> : null}
      </Cabecera>
      {ro ? <SoloLectura /> : null}

      {/* ---- equipo ---- */}
      {camareros === null ? (
        <div className="spinner" />
      ) : (
        <div className="aj-tabla-env">
          <table className="aj-tabla">
            <thead><tr><th>Camarero</th><th>Ficha en Personal</th><th className="num" title="Mesas que lleva en el día y turno elegidos abajo">Mesas</th><th>Estado</th><th className="acc" /></tr></thead>
            <tbody>
              {camareros.map((c) => {
                const emp = c.empleado_id ? empleados.find((e) => e.id === c.empleado_id)?.nombre ?? "enlazado" : null;
                return (
                  <tr key={c.id} className={c.activo ? "" : "inactiva"}>
                    <td className="nombre"><span className="aj-punto" style={{ background: c.color }} />{c.nombre}</td>
                    <td>{emp ?? <span className="mudo">—</span>}</td>
                    <td className="num">{resumen.cuenta.get(c.id) ?? 0}</td>
                    <td>{c.activo ? "En activo" : <span className="mudo">De baja</span>}</td>
                    <td className="acc">
                      {!ro ? (
                        <Interruptor pequeno on={c.activo} onChange={async (v) => { const r = await correr(guardarCamarero(c.id, rest.id, { nombre: c.nombre, color: c.color, activo: v })); if (r.ok) cargarCamareros(); }} />
                      ) : null}
                      <Boton className="mini" onClick={() => setModal({ c })}>{ro ? "Ver" : "Editar"}</Boton>
                    </td>
                  </tr>
                );
              })}
              {!camareros.length ? <tr><td colSpan={5}><Vacio>Aún no hay camareros. Añade el equipo de sala para poder repartir las mesas.</Vacio></td></tr> : null}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- reparto de mesas ---- */}
      <Panel titulo="Reparto de mesas" texto="Elige el día y el turno. «Todo el día» vale para los dos turnos salvo que un turno tenga su propio reparto.">
        <div className="aj-cupos-cab">
          <Boton className="mini" onClick={() => setFecha(sumarDias(fecha, -1))} title="Día anterior">←</Boton>
          <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} style={{ width: 150 }} />
          <Boton className="mini" onClick={() => setFecha(sumarDias(fecha, 1))} title="Día siguiente">→</Boton>
          <span className="mudo" style={{ textTransform: "capitalize" }}>{fmtFechaLarga(fecha)}</span>
          <span className="aj-sep" />
          <select value={turno} onChange={(e) => setTurno(e.target.value)} style={{ width: "auto" }} aria-label="Turno">
            <option value="">Todo el día</option>
            {turnosActivos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
          {!ro ? (
            <>
              <span className="aj-sep" />
              <Boton className="mini" onClick={() => setPreguntar("copiar")} disabled={ocupado}>Copiar del día anterior</Boton>
              {hayAsig ? <Boton className="mini" tipo="fantasma" onClick={() => setPreguntar("vaciar")} disabled={ocupado}>Quitar todo</Boton> : null}
            </>
          ) : null}
        </div>

        {activos.length ? (
          <div className="aj-chips" style={{ marginBottom: 8 }}>
            {activos.map((c) => (
              <span key={c.id} className="aj-chip" style={{ background: c.color, color: textoSobre(c.color) }}>{c.nombre} · {resumen.cuenta.get(c.id) ?? 0}</span>
            ))}
            {resumen.sin ? <span className="aj-chip" style={{ background: "var(--aj-panel2)", color: "var(--aj-gris)", border: "1px solid var(--aj-borde)" }}>sin asignar · {resumen.sin}</span> : null}
          </div>
        ) : null}

        {asig === null ? (
          <div className="spinner" />
        ) : !salasActivas.some((s) => s.mesas.length) ? (
          <Vacio>Este restaurante no tiene mesas activas. Créalas en Salas y planos.</Vacio>
        ) : !activos.length ? (
          <Vacio>Añade al menos un camarero en activo para repartir las mesas.</Vacio>
        ) : (
          salasActivas.filter((s) => s.mesas.length).map((s) => (
            <div key={s.id}>
              <div className="aj-cam-sala aj-linea" style={{ justifyContent: "space-between" }}>
                <span>{s.nombre} · {s.mesas.length} mesas</span>
                {!ro ? (
                  <select
                    value=""
                    disabled={ocupado}
                    onChange={(e) => { const v = e.target.value; if (v === "") return; asignarSala(s.mesas.map((m) => m.id), v === "-" ? "" : v, s.nombre); }}
                    style={{ width: "auto", minHeight: 28, padding: "3px 8px", fontSize: 12, textTransform: "none", letterSpacing: 0 }}
                    aria-label={`Asignar toda la sala ${s.nombre}`}
                  >
                    <option value="">Toda la sala para…</option>
                    {activos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    <option value="-">Quitar asignación</option>
                  </select>
                ) : null}
              </div>
              <div className="aj-cam-rejilla">
                {s.mesas.map((m) => {
                  const x = deMesa.get(m.id);
                  const propia = x?.propia?.camarero_id ?? "";
                  const heredada = tId && !propia ? x?.dia?.camarero_id ?? "" : "";
                  const efectivo = porId.get(propia || heredada);
                  // Un camarero de baja que sigue asignado se muestra igualmente para poder cambiarlo.
                  const opciones = propia && !activos.some((c) => c.id === propia) && porId.get(propia) ? [...activos, porId.get(propia)!] : activos;
                  return (
                    <div key={m.id} className="aj-cam-mesa" style={{ borderLeftColor: efectivo?.color ?? "var(--aj-borde)" }} title={heredada ? `Hereda de «todo el día»: ${porId.get(heredada)?.nombre ?? ""}` : undefined}>
                      <b>{m.nombre}</b>
                      <select value={propia} disabled={ro || ocupado} onChange={(e) => asignarUna(m.id, e.target.value)} aria-label={`Camarero de la mesa ${m.nombre}`}>
                        <option value="">{heredada ? `(${porId.get(heredada)?.nombre ?? "día"})` : "—"}</option>
                        {opciones.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.activo ? "" : " (baja)"}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
        {tId ? <p className="aj-ayuda" style={{ marginTop: 8 }}>Entre paréntesis, el camarero que la mesa tiene asignado para todo el día (si no se cambia en este turno).</p> : null}
      </Panel>

      {modal ? (
        <ModalCamarero
          c={modal.c}
          restId={rest.id}
          empleados={empleados}
          usados={(camareros ?? []).filter((c) => c.id !== modal.c?.id).map((c) => c.color.toUpperCase())}
          avisar={avisar}
          puedeBorrar={!ro}
          cerrar={() => setModal(null)}
          guardado={async () => { setModal(null); await cargarCamareros(); await cargarAsig(); }}
        />
      ) : null}

      {preguntar === "copiar" ? (
        <Confirmar
          texto={`¿Copiar el reparto del ${fmtFechaLarga(ayer)} al ${fmtFechaLarga(fecha)}?`}
          detalle="Se sustituye el reparto de este día (todos los turnos) por el del día anterior."
          confirmarTexto="Copiar"
          ocupado={ocupado}
          onNo={() => setPreguntar(null)}
          onSi={async () => {
            const r = await correr(copiarAsignacionesCamarero(rest.id, ayer, fecha));
            setPreguntar(null);
            if (r.ok) { avisar(`Copiadas ${r.data?.copiadas ?? 0} asignaciones.`); cargarAsig(); }
          }}
        />
      ) : null}
      {preguntar === "vaciar" ? (
        <Confirmar
          texto={`¿Quitar el reparto de ${textoTurno}?`}
          detalle={`Las mesas del ${fmtFechaLarga(fecha)} quedan sin camarero${tId ? " en este turno (las de «todo el día» se mantienen)" : " para todo el día (los repartos de cada turno se mantienen)"}.`}
          confirmarTexto="Quitar"
          peligro
          ocupado={ocupado}
          onNo={() => setPreguntar(null)}
          onSi={async () => {
            const ids = salasActivas.flatMap((s) => s.mesas.map((m) => m.id));
            const r = await correr(asignarCamareroMesas(rest.id, fecha, ids, tId, null), "Reparto quitado.");
            setPreguntar(null);
            if (r.ok) cargarAsig();
          }}
        />
      ) : null}
    </>
  );
}
