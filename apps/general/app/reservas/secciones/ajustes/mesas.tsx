"use client";

/* Ajustes › Mesas: tabla de mesas de la sala con edición en línea (cada celda guarda al salir o con
   Enter) y combinaciones habituales de mesas para grupos (reservas_mesas_combinaciones). */

import { useEffect, useMemo, useState } from "react";
import type { Mesa } from "../../tipos";
import {
  borrarCombinacion, crearMesaAjustes, guardarCombinacion, guardarMesaAjustes, listarCombinaciones,
  type CamposCombinacion, type CamposMesa, type Combinacion,
} from "../../acciones/ajustes";
import { Boton, Cabecera, Campo, Chip, ColorCampo, Confirmar, Interruptor, ModalForm, Panel, SoloLectura, Vacio, useAccion, type AjProps } from "./comunes";

const FORMAS = [{ id: "cuadrada", t: "Cuadrada" }, { id: "redonda", t: "Redonda" }, { id: "rectangular", t: "Rectangular" }];
const TIPOS = [{ id: "mesa", t: "Mesa" }, { id: "barra", t: "Barra" }, { id: "alta", t: "Alta" }];

/* ---- celdas editables (onGuardar devuelve si el servidor lo aceptó; si no, la celda vuelve al valor guardado) ---- */

function CeldaTexto({ valor, onGuardar, disabled, placeholder, max, corto }: { valor: string; onGuardar: (v: string) => Promise<boolean>; disabled?: boolean; placeholder?: string; max?: number; corto?: boolean }) {
  const [v, setV] = useState(valor);
  useEffect(() => { setV(valor); }, [valor]);
  const confirmar = async () => {
    const t = v.trim();
    if (t === valor) return;
    if (!(await onGuardar(t))) setV(valor);
  };
  return (
    <input
      className={corto ? "corto" : undefined}
      value={v}
      disabled={disabled}
      placeholder={placeholder}
      maxLength={max}
      onChange={(e) => setV(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setV(valor); }}
    />
  );
}

function CeldaNum({ valor, onGuardar, disabled, min = 1, max = 999 }: { valor: number; onGuardar: (v: number) => Promise<boolean>; disabled?: boolean; min?: number; max?: number }) {
  const [v, setV] = useState(String(valor));
  useEffect(() => { setV(String(valor)); }, [valor]);
  const confirmar = async () => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < min || n > max) { setV(String(valor)); return; }
    if (n === valor) return;
    if (!(await onGuardar(n))) setV(String(valor));
  };
  return (
    <input type="number" min={min} max={max} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setV(String(valor)); }} />
  );
}

/* ---- modal de combinación ---- */

type FormComb = { nombre: string; mesas: string[]; pax_min: string; pax_max: string; prioridad: string; activa: boolean };

function ModalCombinacion({ comb, restId, mesasPorSala, avisar, cerrar, guardado, ro }: {
  comb: Combinacion | null; restId: string; mesasPorSala: { sala: string; mesas: Mesa[] }[]; avisar: (m: string) => void; cerrar: () => void; guardado: () => void; ro: boolean;
}) {
  const [f, setF] = useState<FormComb>({
    nombre: comb?.nombre ?? "",
    mesas: comb?.mesas ?? [],
    pax_min: String(comb?.pax_min ?? 5),
    pax_max: String(comb?.pax_max ?? 8),
    prioridad: String(comb?.prioridad ?? 100),
    activa: comb ? comb.activa : true,
  });
  const [confirmar, setConfirmar] = useState(false);
  const { ocupado, correr } = useAccion(avisar);
  const set = <K extends keyof FormComb>(k: K, v: FormComb[K]) => setF((x) => ({ ...x, [k]: v }));
  const todas = useMemo(() => mesasPorSala.flatMap((g) => g.mesas), [mesasPorSala]);
  const capacidad = f.mesas.reduce((a, id) => a + (todas.find((m) => m.id === id)?.cap_max ?? 0), 0);

  // Nombre automático si el usuario no lo ha escrito: «T3+T4»
  const nombreAuto = f.mesas.map((id) => todas.find((m) => m.id === id)?.nombre ?? "?").join("+");

  async function guardar() {
    const c: CamposCombinacion = {
      nombre: f.nombre.trim() || nombreAuto,
      mesas: f.mesas,
      pax_min: parseInt(f.pax_min) || 1,
      pax_max: parseInt(f.pax_max) || 1,
      prioridad: parseInt(f.prioridad) || 100,
      activa: f.activa,
    };
    const r = await correr(guardarCombinacion(comb?.id ?? null, restId, c), comb ? "Combinación guardada." : "Combinación creada.");
    if (r.ok) guardado();
  }

  return (
    <>
      <ModalForm
        soloLectura={ro}
        titulo={comb ? `Combinación · ${comb.nombre}` : "Nueva combinación de mesas"}
        onCerrar={cerrar}
        onGuardar={guardar}
        ocupado={ocupado}
        extra={comb ? <Boton tipo="peligro" onClick={() => setConfirmar(true)}>Borrar</Boton> : null}
      >
        <div className="aj-form">
          <Campo label="Mesas que se juntan" ancho="todo" ayuda={f.mesas.length ? `${f.mesas.length} mesas · hasta ${capacidad} personas juntando sus capacidades.` : "Elige dos o más mesas (pueden ser de salas distintas si están pegadas)."}>
            {mesasPorSala.map((g) => (
              <div key={g.sala} style={{ marginBottom: 6 }}>
                <div className="aj-label" style={{ marginBottom: 4 }}>{g.sala}</div>
                <div className="aj-chips">
                  {g.mesas.map((m) => {
                    const on = f.mesas.includes(m.id);
                    return (
                      <button key={m.id} type="button" className={`aj-chip-mesa${on ? " on" : ""}`} onClick={() => set("mesas", on ? f.mesas.filter((x) => x !== m.id) : [...f.mesas, m.id])}>
                        {m.nombre} <span style={{ opacity: 0.7 }}>({m.cap_max})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </Campo>
          <Campo label="Nombre" ancho={2}><input value={f.nombre} placeholder={nombreAuto || "T3+T4"} onChange={(e) => set("nombre", e.target.value)} maxLength={60} /></Campo>
          <Campo label="Prioridad" ayuda="Menor número = se usa antes."><input type="number" min={1} max={999} value={f.prioridad} onChange={(e) => set("prioridad", e.target.value)} /></Campo>
          <Campo label="Personas mínimo"><input type="number" min={1} max={500} value={f.pax_min} onChange={(e) => set("pax_min", e.target.value)} /></Campo>
          <Campo label="Personas máximo"><input type="number" min={1} max={500} value={f.pax_max} onChange={(e) => set("pax_max", e.target.value)} /></Campo>
          <Campo label="Estado"><Interruptor on={f.activa} onChange={(v) => set("activa", v)} texto={f.activa ? "Activa" : "Inactiva"} /></Campo>
        </div>
      </ModalForm>
      {confirmar && comb ? (
        <Confirmar texto={`¿Borrar la combinación «${comb.nombre}»?`} confirmarTexto="Borrar" peligro ocupado={ocupado} onNo={() => setConfirmar(false)}
          onSi={async () => { const r = await correr(borrarCombinacion(comb.id), "Combinación borrada."); setConfirmar(false); if (r.ok) guardado(); }} />
      ) : null}
    </>
  );
}

/* ==================== Sección ==================== */

export default function AjMesas({ rest, salas, avisar, puedeEditar, recargarBase }: AjProps) {
  const [salaId, setSalaId] = useState<string>(() => salas[0]?.id ?? "");
  const [verInactivas, setVerInactivas] = useState(false);
  const [nueva, setNueva] = useState({ nombre: "", cap_min: "2", cap_max: "4", forma: "cuadrada", tipo: "mesa" });
  const [combs, setCombs] = useState<Combinacion[] | null>(null);
  const [modalComb, setModalComb] = useState<{ comb: Combinacion | null } | null>(null);
  const { ocupado, correr } = useAccion(avisar);
  const ro = !puedeEditar;

  useEffect(() => { if (!salas.some((s) => s.id === salaId)) setSalaId(salas[0]?.id ?? ""); }, [salas, salaId]);
  const sala = salas.find((s) => s.id === salaId) ?? null;
  const mesas = useMemo(() => (sala?.mesas ?? []).filter((m) => verInactivas || m.activa), [sala, verInactivas]);
  const inactivas = (sala?.mesas ?? []).filter((m) => !m.activa).length;
  const mesasPorSala = useMemo(() => salas.map((s) => ({ sala: s.nombre, mesas: (s.mesas ?? []).filter((m) => m.activa) })).filter((g) => g.mesas.length), [salas]);
  const nombreMesa = (id: string) => salas.flatMap((s) => s.mesas ?? []).find((m) => m.id === id)?.nombre ?? "?";

  const cargarCombs = async () => setCombs(await listarCombinaciones(rest.id));
  useEffect(() => { setCombs(null); listarCombinaciones(rest.id).then(setCombs); }, [rest.id]);

  async function cambiar(m: Mesa, c: CamposMesa): Promise<boolean> {
    const r = await correr(guardarMesaAjustes(m.id, c));
    if (r.ok) await recargarBase();
    return r.ok;
  }

  async function crear() {
    if (!sala) return;
    if (!nueva.nombre.trim()) { avisar("Pon un nombre a la mesa (p. ej. T5)."); return; }
    const r = await correr(crearMesaAjustes(sala.id, { nombre: nueva.nombre, cap_min: parseInt(nueva.cap_min) || 1, cap_max: parseInt(nueva.cap_max) || 2, forma: nueva.forma, tipo: nueva.tipo }), "Mesa creada. Colócala en el plano desde «Salas y planos».");
    if (r.ok) { setNueva((n) => ({ ...n, nombre: "" })); await recargarBase(); }
  }

  const totalCap = mesas.filter((m) => m.activa).reduce((a, m) => a + m.cap_max, 0);

  return (
    <>
      <Cabecera titulo="Mesas" texto="Capacidades, prioridad de asignación y qué mesas pueden reservarse online. Cada celda se guarda al salir de ella. La posición en el plano se cambia en «Salas y planos».">
        <div className="aj-linea">
          <select value={salaId} onChange={(e) => setSalaId(e.target.value)} aria-label="Sala">
            {salas.map((s) => <option key={s.id} value={s.id}>{s.nombre}{s.activa ? "" : " (inactiva)"}</option>)}
          </select>
          {inactivas ? <Interruptor on={verInactivas} onChange={setVerInactivas} texto={`Ver retiradas (${inactivas})`} pequeno /> : null}
        </div>
      </Cabecera>
      {ro ? <SoloLectura /> : null}

      {!sala ? (
        <Vacio>No hay salas. Crea una en «Salas y planos».</Vacio>
      ) : (
        <>
          <div className="aj-tabla-env">
            <table className="aj-tabla">
              <thead>
                <tr>
                  <th>Mesa</th>
                  <th title="Número visible en el plano si es distinto del nombre">Etiqueta</th>
                  <th className="num">Mín</th>
                  <th className="num">Máx</th>
                  <th>Forma</th>
                  <th>Tipo</th>
                  <th className="num" title="Menor número = se asigna antes">Prior.</th>
                  <th className="centro" title="Se puede juntar con otras">Unible</th>
                  <th className="centro">Online</th>
                  <th>Color</th>
                  <th className="centro">Activa</th>
                </tr>
              </thead>
              <tbody>
                {mesas.map((m) => (
                  <tr key={m.id} className={m.activa ? "" : "inactiva"}>
                    <td className="nombre"><CeldaTexto valor={m.nombre} disabled={ro} max={40} corto onGuardar={(v) => cambiar(m, { nombre: v })} /></td>
                    <td><CeldaTexto valor={m.etiqueta ?? ""} disabled={ro} max={12} corto placeholder="—" onGuardar={(v) => cambiar(m, { etiqueta: v || null })} /></td>
                    <td className="num"><CeldaNum valor={m.cap_min} disabled={ro} min={1} max={200} onGuardar={(v) => cambiar(m, { cap_min: v })} /></td>
                    <td className="num"><CeldaNum valor={m.cap_max} disabled={ro} min={1} max={200} onGuardar={(v) => cambiar(m, { cap_max: v })} /></td>
                    <td>
                      <select value={m.forma} disabled={ro} onChange={(e) => cambiar(m, { forma: e.target.value })}>
                        {FORMAS.map((x) => <option key={x.id} value={x.id}>{x.t}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={m.tipo} disabled={ro} onChange={(e) => cambiar(m, { tipo: e.target.value })}>
                        {TIPOS.map((x) => <option key={x.id} value={x.id}>{x.t}</option>)}
                      </select>
                    </td>
                    <td className="num"><CeldaNum valor={m.prioridad} disabled={ro} min={1} max={999} onGuardar={(v) => cambiar(m, { prioridad: v })} /></td>
                    <td className="centro"><Interruptor on={m.unible} disabled={ro} pequeno onChange={(v) => cambiar(m, { unible: v })} /></td>
                    <td className="centro"><Interruptor on={m.reservable_online} disabled={ro} pequeno onChange={(v) => cambiar(m, { reservable_online: v })} /></td>
                    <td><ColorCampo valor={m.color} disabled={ro} permitirVacio onChange={(v) => cambiar(m, { color: v })} /></td>
                    <td className="centro"><Interruptor on={m.activa} disabled={ro} pequeno onChange={(v) => cambiar(m, { activa: v })} /></td>
                  </tr>
                ))}
                {!mesas.length ? <tr><td colSpan={11}><Vacio>Sin mesas en esta sala.</Vacio></td></tr> : null}
              </tbody>
              {!ro ? (
                <tfoot>
                  <tr>
                    <td className="nombre"><input className="corto" placeholder="Nueva: T5" value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") crear(); }} /></td>
                    <td className="mudo" style={{ fontSize: 12 }}>nueva mesa</td>
                    <td className="num"><input type="number" min={1} max={200} value={nueva.cap_min} onChange={(e) => setNueva({ ...nueva, cap_min: e.target.value })} /></td>
                    <td className="num"><input type="number" min={1} max={200} value={nueva.cap_max} onChange={(e) => setNueva({ ...nueva, cap_max: e.target.value })} /></td>
                    <td><select value={nueva.forma} onChange={(e) => setNueva({ ...nueva, forma: e.target.value })}>{FORMAS.map((x) => <option key={x.id} value={x.id}>{x.t}</option>)}</select></td>
                    <td><select value={nueva.tipo} onChange={(e) => setNueva({ ...nueva, tipo: e.target.value })}>{TIPOS.map((x) => <option key={x.id} value={x.id}>{x.t}</option>)}</select></td>
                    <td colSpan={5} className="acc"><Boton tipo="primario" className="mini" disabled={ocupado} onClick={crear}>+ Añadir mesa</Boton></td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          <div className="mudo" style={{ fontSize: 12, marginBottom: 14 }}>
            {mesas.filter((m) => m.activa).length} mesas activas · {totalCap} personas de capacidad máxima en {sala.nombre}. Las mesas retiradas se conservan por el historial.
          </div>
        </>
      )}

      <Panel titulo="Combinaciones habituales" texto="Mesas que se juntan para grupos. La asignación automática las usa cuando una sola mesa no basta.">
        {combs === null ? (
          <div className="spinner" />
        ) : combs.length ? (
          <div className="aj-lista">
            {combs.map((c) => (
              <div key={c.id} className={`aj-item${c.activa ? "" : " inactiva"}`}>
                <div className="cuerpo">
                  <div className="tit">
                    {c.nombre}
                    {!c.activa ? <Chip color="#8A9199">inactiva</Chip> : null}
                    <span className="mudo" style={{ fontWeight: 600, fontSize: 12.5 }}>{c.pax_min}–{c.pax_max} pax · prioridad {c.prioridad}</span>
                  </div>
                  <div className="det">{c.mesas.map(nombreMesa).join(" + ")}</div>
                </div>
                <div className="acc"><Boton className="mini" onClick={() => setModalComb({ comb: c })}>{ro ? "Ver" : "Editar"}</Boton></div>
              </div>
            ))}
          </div>
        ) : (
          <Vacio>Sin combinaciones. Útil para grupos: p. ej. «T3+T4» para 6–8 personas.</Vacio>
        )}
        {!ro ? <div className="aj-form-pie"><Boton onClick={() => setModalComb({ comb: null })}>+ Nueva combinación</Boton></div> : null}
      </Panel>

      {modalComb ? (
        <ModalCombinacion ro={ro} comb={modalComb.comb} restId={rest.id} mesasPorSala={mesasPorSala} avisar={avisar} cerrar={() => setModalComb(null)} guardado={async () => { setModalComb(null); await cargarCombs(); }} />
      ) : null}
    </>
  );
}
