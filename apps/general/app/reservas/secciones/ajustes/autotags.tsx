"use client";

/* Ajustes › Etiquetas automáticas (reservas_autotags): reglas «si el cliente tiene N no-shows /
   cancelaciones / visitas en X días, ponle la etiqueta E». Las aplica el cron de mensajes
   (reservas_aplicar_autotags, cada pocos minutos). Solo etiquetas de ámbito cliente. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { borrarAutotag, guardarAutotag, listarAutotags, listarEtiquetas, type Autotag, type CamposAutotag, type Etiqueta } from "../../acciones/ajustes";
import { Boton, Cabecera, Campo, Chip, Confirmar, Interruptor, ModalForm, SoloLectura, Vacio, useAccion, type AjProps } from "./comunes";

const CONDICIONES: { id: string; texto: string; plural: string }[] = [
  { id: "no_show", texto: "No-shows", plural: "no-shows" },
  { id: "cancelar", texto: "Cancelaciones", plural: "cancelaciones" },
  { id: "asistir", texto: "Visitas", plural: "visitas" },
];
const OPERADORES: { id: string; texto: string }[] = [
  { id: ">=", texto: "al menos" },
  { id: "=", texto: "exactamente" },
  { id: "<=", texto: "como mucho" },
];

const nombreCond = (id: string) => CONDICIONES.find((c) => c.id === id)?.plural ?? id;
const nombreOp = (id: string) => OPERADORES.find((o) => o.id === id)?.texto ?? id;

/** «Al menos 2 no-shows en los últimos 365 días» */
export function textoRegla(a: Pick<Autotag, "condicion" | "operador" | "n" | "periodo_dias">): string {
  const op = nombreOp(a.operador);
  return `${op.charAt(0).toUpperCase()}${op.slice(1)} ${a.n} ${nombreCond(a.condicion)} en los últimos ${a.periodo_dias} días`;
}

type Form = { condicion: string; operador: string; n: string; periodo_dias: string; etiqueta_id: string; activa: boolean };

function Modal({ a, etiquetas, avisar, cerrar, guardado, ro }: {
  a: Autotag | null;
  etiquetas: Etiqueta[];
  avisar: (m: string) => void;
  cerrar: () => void;
  guardado: () => void;
  ro: boolean;
}) {
  const [f, setF] = useState<Form>({
    condicion: a?.condicion ?? "no_show",
    operador: a?.operador ?? ">=",
    n: String(a?.n ?? 2),
    periodo_dias: String(a?.periodo_dias ?? 365),
    etiqueta_id: a?.etiqueta_id ?? etiquetas[0]?.id ?? "",
    activa: a ? a.activa : true,
  });
  const [confirmar, setConfirmar] = useState(false);
  const { ocupado, correr } = useAccion(avisar);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const etiqueta = etiquetas.find((e) => e.id === f.etiqueta_id);

  async function guardar() {
    if (!f.etiqueta_id) { avisar("Elige la etiqueta que se pondrá al cliente."); return; }
    const c: CamposAutotag = {
      condicion: f.condicion,
      operador: f.operador,
      n: parseInt(f.n) || 0,
      periodo_dias: parseInt(f.periodo_dias) || 365,
      etiqueta_id: f.etiqueta_id,
      activa: f.activa,
    };
    const r = await correr(guardarAutotag(a?.id ?? null, c), a ? "Regla guardada." : "Regla creada.");
    if (r.ok) guardado();
  }

  return (
    <>
      <ModalForm
        soloLectura={ro}
        titulo={a ? "Editar regla" : "Nueva etiqueta automática"}
        onCerrar={cerrar}
        onGuardar={guardar}
        ocupado={ocupado}
        guardarTexto={a ? "Guardar" : "Crear"}
        ancho={560}
        extra={a && !ro ? <Boton tipo="peligro" onClick={() => setConfirmar(true)}>Borrar</Boton> : null}
      >
        <div className="aj-form">
          <Campo label="Qué se cuenta">
            <select value={f.condicion} onChange={(e) => set("condicion", e.target.value)}>
              {CONDICIONES.map((c) => <option key={c.id} value={c.id}>{c.texto}</option>)}
            </select>
          </Campo>
          <Campo label="Cuántas">
            <div className="aj-linea">
              <select value={f.operador} onChange={(e) => set("operador", e.target.value)} style={{ width: "auto" }}>
                {OPERADORES.map((o) => <option key={o.id} value={o.id}>{o.texto}</option>)}
              </select>
              <input type="number" min={0} max={1000} value={f.n} onChange={(e) => set("n", e.target.value)} style={{ width: 80 }} />
            </div>
          </Campo>
          <Campo label="En los últimos"><div className="aj-con-unidad"><input type="number" min={1} max={3650} value={f.periodo_dias} onChange={(e) => set("periodo_dias", e.target.value)} /><span>días</span></div></Campo>
          <Campo label="Etiqueta que se pone" ayuda="Solo etiquetas de cliente (se crean en Etiquetas › Cliente).">
            <select value={f.etiqueta_id} onChange={(e) => set("etiqueta_id", e.target.value)}>
              {!etiquetas.length ? <option value="">No hay etiquetas de cliente</option> : null}
              {etiquetas.map((e) => <option key={e.id} value={e.id}>{e.nombre}{e.activa ? "" : " (inactiva)"}</option>)}
            </select>
          </Campo>
          <Campo label="Estado" ancho="todo"><Interruptor on={f.activa} onChange={(v) => set("activa", v)} texto={f.activa ? "Activa: se aplica sola" : "Pausada"} /></Campo>
        </div>
        <div className="aj-aviso info" style={{ marginTop: 12, marginBottom: 0 }}>
          {textoRegla({ condicion: f.condicion, operador: f.operador, n: parseInt(f.n) || 0, periodo_dias: parseInt(f.periodo_dias) || 365 })}
          {" → "}{etiqueta ? <b>{etiqueta.nombre}</b> : "…"}
        </div>
      </ModalForm>
      {confirmar && a ? (
        <Confirmar
          texto="¿Borrar esta regla?"
          detalle="Los clientes que ya tienen la etiqueta la conservan; solo deja de ponerse a los nuevos."
          confirmarTexto="Borrar"
          peligro
          ocupado={ocupado}
          onNo={() => setConfirmar(false)}
          onSi={async () => { const r = await correr(borrarAutotag(a.id), "Regla borrada."); setConfirmar(false); if (r.ok) guardado(); }}
        />
      ) : null}
    </>
  );
}

export default function AjAutotags({ avisar, puedeEditar }: AjProps) {
  const [reglas, setReglas] = useState<Autotag[] | null>(null);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [modal, setModal] = useState<{ a: Autotag | null } | null>(null);
  const { correr } = useAccion(avisar);
  const ro = !puedeEditar;

  const cargar = useCallback(async () => {
    const [r, e] = await Promise.all([listarAutotags(), listarEtiquetas()]);
    setReglas(r);
    setEtiquetas(e.filter((x) => x.ambito === "cliente"));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const porId = useMemo(() => new Map(etiquetas.map((e) => [e.id, e])), [etiquetas]);

  return (
    <>
      <Cabecera
        titulo="Etiquetas automáticas"
        texto="Reglas que ponen una etiqueta al cliente según su historial: por ejemplo, 2 no-shows en un año → «Riesgo no-show». Se revisan cada pocos minutos. La etiqueta se añade, no se quita sola; si la quitas a mano y se sigue cumpliendo la regla, vuelve a ponerse."
      >
        {!ro ? <Boton tipo="primario" onClick={() => setModal({ a: null })} disabled={!etiquetas.length}>+ Nueva regla</Boton> : null}
      </Cabecera>
      {ro ? <SoloLectura /> : null}

      {reglas === null ? (
        <div className="spinner" />
      ) : (
        <div className="aj-tabla-env">
          <table className="aj-tabla">
            <thead><tr><th>Regla</th><th>Etiqueta</th><th className="centro">Activa</th><th className="acc" /></tr></thead>
            <tbody>
              {reglas.map((a) => {
                const e = porId.get(a.etiqueta_id);
                return (
                  <tr key={a.id} className={a.activa ? "" : "inactiva"}>
                    <td className="nombre">{textoRegla(a)}</td>
                    <td>{e ? <Chip color={e.color}>{e.nombre}</Chip> : <span className="mudo">etiqueta borrada</span>}</td>
                    <td className="centro">
                      <Interruptor
                        pequeno
                        on={a.activa}
                        disabled={ro}
                        onChange={async (v) => {
                          const r = await correr(guardarAutotag(a.id, { condicion: a.condicion, operador: a.operador, n: a.n, periodo_dias: a.periodo_dias, etiqueta_id: a.etiqueta_id, activa: v }));
                          if (r.ok) cargar();
                        }}
                      />
                    </td>
                    <td className="acc"><Boton className="mini" onClick={() => setModal({ a })}>{ro ? "Ver" : "Editar"}</Boton></td>
                  </tr>
                );
              })}
              {!reglas.length ? (
                <tr><td colSpan={4}><Vacio>{etiquetas.length ? "Sin reglas. Crea la primera: p. ej. al menos 2 no-shows en 365 días → «Riesgo no-show»." : "Primero crea alguna etiqueta de cliente en Etiquetas › Cliente."}</Vacio></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {modal ? <Modal a={modal.a} etiquetas={etiquetas} avisar={avisar} ro={ro} cerrar={() => setModal(null)} guardado={async () => { setModal(null); await cargar(); }} /> : null}
    </>
  );
}
