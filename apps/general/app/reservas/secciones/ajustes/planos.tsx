"use client";

/* Ajustes › Salas y planos: alta/baja/orden de salas, propiedades (color, prioridad, reservable
   online, tamaño del lienzo) y el editor del plano (componente del agente «plano»).
   Dos permisos distintos: las salas (alta, propiedades, orden) van con «ajustes»; mover mesas y
   objetos en el plano va con «editar plano» (acciones/plano.ts › exigirEdicionPlano). */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Sala } from "../../tipos";
import { PlanoEditor } from "../../componentes/plano-editor";
import { cargarPlano, type PlanoObjeto } from "../../acciones/plano";
import { borrarSala, guardarSalaAjustes, ordenarSalas, type CamposSala } from "../../acciones/ajustes";
import { Boton, Cabecera, Campo, Chip, ColorCampo, Confirmar, Interruptor, ModalForm, Panel, SoloLectura, Vacio, useAccion, type AjProps } from "./comunes";

type FormSala = { nombre: string; activa: boolean; reservable_online: boolean; color: string | null; prioridad: string; ancho: string; alto: string; fondo: string };
const formSala = (s: Sala | null): FormSala => ({
  nombre: s?.nombre ?? "",
  activa: s ? s.activa : true,
  reservable_online: s ? s.reservable_online : true,
  color: s?.color ?? null,
  prioridad: String(s?.prioridad ?? 100),
  ancho: String(s?.ancho ?? 100),
  alto: String(s?.alto ?? 70),
  fondo: s?.fondo ?? "oscuro",
});

function ModalSala({ sala, restId, orden, avisar, cerrar, guardado, puedeBorrar }: { sala: Sala | null; restId: string; orden: number; avisar: (m: string) => void; cerrar: () => void; guardado: (s?: Sala) => void; puedeBorrar: boolean }) {
  const [f, setF] = useState<FormSala>(() => formSala(sala));
  const [confirmar, setConfirmar] = useState(false);
  const { ocupado, correr } = useAccion(avisar);
  const set = <K extends keyof FormSala>(k: K, v: FormSala[K]) => setF((x) => ({ ...x, [k]: v }));
  const nMesas = sala?.mesas?.length ?? 0;

  async function guardar() {
    const c: CamposSala = {
      nombre: f.nombre,
      activa: f.activa,
      reservable_online: f.reservable_online,
      color: f.color,
      prioridad: parseInt(f.prioridad) || 100,
      ancho: parseInt(f.ancho) || 100,
      alto: parseInt(f.alto) || 70,
      fondo: f.fondo,
    };
    const r = await correr(guardarSalaAjustes(sala?.id ?? null, restId, c, orden), sala ? "Sala guardada." : "Sala creada.");
    if (r.ok) guardado(r.data);
  }

  return (
    <>
      <ModalForm soloLectura={!puedeBorrar}
        titulo={sala ? `Sala · ${sala.nombre}` : "Nueva sala"}
        onCerrar={cerrar}
        onGuardar={guardar}
        ocupado={ocupado}
        guardarTexto={sala ? "Guardar" : "Crear sala"}
        extra={sala && puedeBorrar ? <Boton tipo="peligro" onClick={() => setConfirmar(true)}>{nMesas ? "Desactivar" : "Borrar"}</Boton> : null}
      >
        <div className="aj-form">
          <Campo label="Nombre" ancho={2}><input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Terraza, Interior, Viñedo…" maxLength={40} /></Campo>
          <Campo label="Color" ayuda="Pestaña de la sala y cronograma."><ColorCampo valor={f.color} onChange={(v) => set("color", v)} permitirVacio /></Campo>
          <Campo label="Prioridad" ayuda="Las reservas online se asignan primero a la sala de menor número."><input type="number" min={1} max={999} value={f.prioridad} onChange={(e) => set("prioridad", e.target.value)} /></Campo>
          <Campo label="Lienzo: ancho" ayuda="Unidades del plano (40–400)."><input type="number" min={40} max={400} value={f.ancho} onChange={(e) => set("ancho", e.target.value)} /></Campo>
          <Campo label="Lienzo: alto" ayuda="Unidades del plano (30–400)."><input type="number" min={30} max={400} value={f.alto} onChange={(e) => set("alto", e.target.value)} /></Campo>
          <Campo label="Suelo del plano">
            <select value={f.fondo} onChange={(e) => set("fondo", e.target.value)}>
              <option value="oscuro">Oscuro</option>
              <option value="claro">Claro</option>
            </select>
          </Campo>
          <Campo label="Opciones" ancho="todo">
            <div className="aj-interruptores">
              <Interruptor on={f.reservable_online} onChange={(v) => set("reservable_online", v)} texto={f.reservable_online ? "Reservable online: el widget puede sentar aquí" : "Solo desde el panel"} />
              <Interruptor on={f.activa} onChange={(v) => set("activa", v)} texto={f.activa ? "Activa" : "Inactiva (no aparece en Día)"} />
            </div>
          </Campo>
        </div>
      </ModalForm>
      {confirmar && sala ? (
        <Confirmar
          texto={nMesas ? `¿Desactivar la sala «${sala.nombre}»?` : `¿Borrar la sala «${sala.nombre}»?`}
          detalle={nMesas ? `Tiene ${nMesas} mesas con historial: se desactiva y deja de verse en Día; las mesas se conservan.` : "La sala no tiene mesas: se borra del todo."}
          confirmarTexto={nMesas ? "Desactivar" : "Borrar"}
          peligro
          ocupado={ocupado}
          onNo={() => setConfirmar(false)}
          onSi={async () => {
            const r = await correr(borrarSala(sala.id));
            if (r.ok) { avisar(r.data?.desactivada ? "Sala desactivada." : "Sala borrada."); guardado(); }
            setConfirmar(false);
          }}
        />
      ) : null}
    </>
  );
}

export default function AjPlanos({ rest, salas, avisar, puedeEditar, puedeEditarPlano, recargarBase, tema, onSucio }: AjProps) {
  const [salaId, setSalaId] = useState<string>(() => salas[0]?.id ?? "");
  const [objetos, setObjetos] = useState<PlanoObjeto[] | null>(null);
  const [modal, setModal] = useState<{ sala: Sala | null } | null>(null);
  const { ocupado, correr } = useAccion(avisar);
  const ro = !puedeEditar;
  // Cambios del editor sin guardar: cambiar de sala desmonta el editor, así que se pregunta antes.
  const [pendientes, setPendientes] = useState(0);
  const [irASala, setIrASala] = useState<string | null>(null);
  const elegirSala = (id: string) => { if (id === salaId) return; if (pendientes > 0) setIrASala(id); else setSalaId(id); };

  useEffect(() => {
    if (!salas.some((s) => s.id === salaId)) setSalaId(salas[0]?.id ?? "");
  }, [salas, salaId]);

  const sala = useMemo(() => salas.find((s) => s.id === salaId) ?? null, [salas, salaId]);

  const cargarObjetos = useCallback(async () => {
    if (!salaId) { setObjetos([]); return; }
    setObjetos(null);
    const r = await cargarPlano(salaId);
    setObjetos(r.objetos);
  }, [salaId]);
  useEffect(() => { cargarObjetos(); }, [cargarObjetos]);

  async function mover(idx: number, dir: -1 | 1) {
    const ids = salas.map((s) => s.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    const r = await correr(ordenarSalas(ids));
    if (r.ok) await recargarBase();
  }

  return (
    <>
      <Cabecera titulo="Salas y planos" texto="Cada sala tiene su plano. Arrastra mesas y objetos en el editor; guarda al terminar. El orden de las pestañas es el que verá la sala en Día.">
        {!ro ? <Boton tipo="primario" onClick={() => setModal({ sala: null })}>+ Nueva sala</Boton> : null}
      </Cabecera>
      {ro ? <SoloLectura /> : null}

      {salas.length ? (
        <>
          <div className="aj-salas-tabs">
            {salas.map((s, i) => (
              <button key={s.id} className={`${s.id === salaId ? "activo" : ""}${s.activa ? "" : " inactiva"}`} onClick={() => elegirSala(s.id)}>
                {s.color ? <span className="aj-punto" style={{ background: s.color, marginRight: 0 }} /> : null}
                {s.nombre}
                <span style={{ opacity: 0.7, fontWeight: 600 }}>({(s.mesas ?? []).filter((m) => m.activa).length})</span>
              </button>
            ))}
            {!ro && sala ? (
              <>
                <span className="aj-sep" />
                <Boton className="mover" disabled={ocupado || salas.findIndex((s) => s.id === salaId) === 0} onClick={() => mover(salas.findIndex((s) => s.id === salaId), -1)} title="Mover a la izquierda">◀</Boton>
                <Boton className="mover" disabled={ocupado || salas.findIndex((s) => s.id === salaId) === salas.length - 1} onClick={() => mover(salas.findIndex((s) => s.id === salaId), 1)} title="Mover a la derecha">▶</Boton>
              </>
            ) : null}
          </div>

          {sala ? (
            <Panel>
              <div className="aj-plano-props">
                <div>
                  <div className="aj-label">Sala</div>
                  <div style={{ fontWeight: 700, fontSize: 15, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {sala.nombre}
                    {!sala.activa ? <Chip color="#8A9199">inactiva</Chip> : null}
                    {!sala.reservable_online ? <Chip color="#4B5057">solo panel</Chip> : <Chip color="#2E9E5B">online</Chip>}
                  </div>
                </div>
                <div><div className="aj-label">Mesas</div><div style={{ fontWeight: 700 }}>{(sala.mesas ?? []).filter((m) => m.activa).length} activas <span className="mudo">/ {(sala.mesas ?? []).length}</span></div></div>
                <div><div className="aj-label">Capacidad</div><div style={{ fontWeight: 700 }}>{(sala.mesas ?? []).filter((m) => m.activa).reduce((a, m) => a + m.cap_max, 0)} pax</div></div>
                <div><div className="aj-label">Lienzo</div><div style={{ fontWeight: 700 }}>{sala.ancho} × {sala.alto}</div></div>
                <div><div className="aj-label">Prioridad</div><div style={{ fontWeight: 700 }}>{sala.prioridad}</div></div>
                <div className="aj-linea" style={{ justifyContent: "flex-end" }}>
                  <Boton onClick={() => setModal({ sala })}>{ro ? "Ver propiedades" : "Propiedades"}</Boton>
                </div>
              </div>
            </Panel>
          ) : null}

          {sala && objetos ? (
            <div className="aj-plano-editor">
              {!puedeEditarPlano ? (
                <div className="aj-aviso">Plano en solo lectura: para mover mesas y objetos necesitas el permiso «Plano» (Usuarios y permisos).</div>
              ) : null}
              <PlanoEditor
                key={sala.id}
                sala={sala}
                objetos={objetos}
                tema={tema}
                avisar={avisar}
                soloLectura={!puedeEditarPlano}
                onPendientes={(n) => { setPendientes(n); onSucio(n > 0); }}
                onGuardado={async (r) => { setObjetos(r.objetos); await recargarBase(); }}
              />
            </div>
          ) : sala ? (
            <div className="spinner" />
          ) : null}
        </>
      ) : (
        <Vacio>Este restaurante no tiene salas. Crea la primera (p. ej. «Terraza») y después añade las mesas en el editor.</Vacio>
      )}

      {irASala ? (
        <Confirmar
          texto="Hay cambios del plano sin guardar. Si cambias de sala se pierden."
          confirmarTexto="Descartar y salir"
          peligro
          onNo={() => setIrASala(null)}
          onSi={() => { const id = irASala; setIrASala(null); setPendientes(0); onSucio(false); setSalaId(id); }}
        />
      ) : null}
      {modal ? (
        <ModalSala
          sala={modal.sala}
          restId={rest.id}
          orden={salas.length + 1}
          avisar={avisar}
          puedeBorrar={!ro}
          cerrar={() => setModal(null)}
          guardado={async (s) => { setModal(null); await recargarBase(); if (s && !modal.sala) setSalaId(s.id); }}
        />
      ) : null}
    </>
  );
}
