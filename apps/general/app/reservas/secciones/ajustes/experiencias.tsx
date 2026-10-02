"use client";

/* Ajustes › Experiencias: menús y experiencias reservables (precio por persona, prepago,
   fechas, días, turnos, cupo). El widget las ofrece en el paso «Adicional». */

import { useCallback, useEffect, useState } from "react";
import { fmtFecha } from "../../lib-reservas";
import { borrarExperiencia, guardarExperiencia, listarExperiencias, type CamposExperiencia, type Experiencia } from "../../acciones/ajustes";
import { Boton, Cabecera, Campo, Chip, Confirmar, DiasCampo, Interruptor, ModalForm, SoloLectura, Vacio, fmtEuros, textoDias, useAccion, type AjProps } from "./comunes";

type Form = {
  nombre: string; descripcion: string; precio_pax: string; requiere_prepago: boolean; pax_min: string; pax_max: string;
  turnos: string[]; dias_semana: number[]; fecha_desde: string; fecha_hasta: string; activa: boolean; orden: string; imagen_url: string;
};

function Modal({ x, restId, turnos, avisar, cerrar, guardado, puedeBorrar }: { x: Experiencia | null; restId: string; turnos: AjProps["turnos"]; avisar: (m: string) => void; cerrar: () => void; guardado: () => void; puedeBorrar: boolean }) {
  const [f, setF] = useState<Form>({
    nombre: x?.nombre ?? "",
    descripcion: x?.descripcion ?? "",
    precio_pax: x?.precio_pax != null ? String(x.precio_pax) : "",
    requiere_prepago: x?.requiere_prepago ?? false,
    pax_min: String(x?.pax_min ?? 1),
    pax_max: x?.pax_max != null ? String(x.pax_max) : "",
    turnos: x?.turnos ?? [],
    dias_semana: x?.dias_semana ?? [1, 2, 3, 4, 5, 6, 7],
    fecha_desde: x?.fecha_desde ?? "",
    fecha_hasta: x?.fecha_hasta ?? "",
    activa: x ? x.activa : true,
    orden: String(x?.orden ?? 100),
    imagen_url: x?.imagen_url ?? "",
  });
  const [confirmar, setConfirmar] = useState(false);
  const { ocupado, correr } = useAccion(avisar);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  async function guardar() {
    const c: CamposExperiencia = {
      nombre: f.nombre,
      descripcion: f.descripcion || null,
      precio_pax: f.precio_pax === "" ? null : parseFloat(f.precio_pax.replace(",", ".")),
      requiere_prepago: f.requiere_prepago,
      pax_min: parseInt(f.pax_min) || 1,
      pax_max: f.pax_max === "" ? null : parseInt(f.pax_max) || null,
      turnos: f.turnos.length ? f.turnos : null,
      dias_semana: f.dias_semana.length === 7 ? null : f.dias_semana,
      fecha_desde: f.fecha_desde || null,
      fecha_hasta: f.fecha_hasta || null,
      activa: f.activa,
      orden: parseInt(f.orden) || 100,
      imagen_url: f.imagen_url || null,
    };
    const r = await correr(guardarExperiencia(x?.id ?? null, restId, c), x ? "Experiencia guardada." : "Experiencia creada.");
    if (r.ok) guardado();
  }

  return (
    <>
      <ModalForm soloLectura={!puedeBorrar} titulo={x ? x.nombre : "Nueva experiencia"} onCerrar={cerrar} onGuardar={guardar} ocupado={ocupado} guardarTexto={x ? "Guardar" : "Crear"}
        extra={x && puedeBorrar ? <Boton tipo="peligro" onClick={() => setConfirmar(true)}>Borrar</Boton> : null}>
        <div className="aj-form">
          <Campo label="Nombre" ancho={2}><input autoFocus value={f.nombre} onChange={(e) => set("nombre", e.target.value)} maxLength={80} placeholder="Menú maridaje, Cata al atardecer…" /></Campo>
          <Campo label="Orden" ayuda="Menor = antes en el widget."><input type="number" min={0} max={999} value={f.orden} onChange={(e) => set("orden", e.target.value)} /></Campo>
          <Campo label="Descripción (la ve el cliente)" ancho="todo"><textarea value={f.descripcion} onChange={(e) => set("descripcion", e.target.value)} maxLength={1000} /></Campo>
          <Campo label="Precio por persona"><div className="aj-con-unidad"><input type="number" min={0} step={0.5} value={f.precio_pax} onChange={(e) => set("precio_pax", e.target.value)} placeholder="0" /><span>€</span></div></Campo>
          <Campo label="Prepago" ayuda="El cliente paga al reservar (Redsys)."><Interruptor on={f.requiere_prepago} onChange={(v) => set("requiere_prepago", v)} texto={f.requiere_prepago ? "Se cobra al reservar" : "Se paga en el restaurante"} /></Campo>
          <Campo label="Personas mínimo"><input type="number" min={1} max={500} value={f.pax_min} onChange={(e) => set("pax_min", e.target.value)} /></Campo>
          <Campo label="Personas máximo" ayuda="Vacío = sin límite."><input type="number" min={1} max={500} value={f.pax_max} placeholder="sin límite" onChange={(e) => set("pax_max", e.target.value)} /></Campo>
          <Campo label="Disponible desde"><input type="date" value={f.fecha_desde} onChange={(e) => set("fecha_desde", e.target.value)} /></Campo>
          <Campo label="Hasta"><input type="date" value={f.fecha_hasta} onChange={(e) => set("fecha_hasta", e.target.value)} /></Campo>
          <Campo label="Días de la semana" ancho={2}><DiasCampo valor={f.dias_semana} onChange={(v) => set("dias_semana", v)} /></Campo>
          <Campo label="Turnos" ayuda="Ninguno marcado = todos." ancho={2}>
            <div className="aj-chips">
              {turnos.map((t) => {
                const on = f.turnos.includes(t.id);
                return <button key={t.id} type="button" className={`aj-chip-mesa${on ? " on" : ""}`} onClick={() => set("turnos", on ? f.turnos.filter((i) => i !== t.id) : [...f.turnos, t.id])}>{t.nombre}</button>;
              })}
            </div>
          </Campo>
          <Campo label="Imagen (URL)" ancho={2}><input value={f.imagen_url} onChange={(e) => set("imagen_url", e.target.value)} placeholder="https://…/foto.jpg" /></Campo>
          <Campo label="Estado"><Interruptor on={f.activa} onChange={(v) => set("activa", v)} texto={f.activa ? "Activa" : "Inactiva"} /></Campo>
        </div>
      </ModalForm>
      {confirmar && x ? (
        <Confirmar texto={`¿Borrar «${x.nombre}»?`} detalle="Si tiene reservas asociadas, se desactiva en vez de borrarse." confirmarTexto="Borrar" peligro ocupado={ocupado} onNo={() => setConfirmar(false)}
          onSi={async () => { const r = await correr(borrarExperiencia(x.id)); if (r.ok) { avisar(r.data?.desactivada ? "Tenía reservas: se ha desactivado." : "Experiencia borrada."); guardado(); } setConfirmar(false); }} />
      ) : null}
    </>
  );
}

export default function AjExperiencias({ rest, turnos, avisar, puedeEditar }: AjProps) {
  const [lista, setLista] = useState<Experiencia[] | null>(null);
  const [modal, setModal] = useState<{ x: Experiencia | null } | null>(null);
  const ro = !puedeEditar;
  const cargar = useCallback(async () => setLista(await listarExperiencias(rest.id)), [rest.id]);
  useEffect(() => { setLista(null); cargar(); }, [cargar]);
  const nombreTurno = (id: string) => turnos.find((t) => t.id === id)?.nombre ?? "?";

  return (
    <>
      <Cabecera titulo="Experiencias" texto="Menús, catas y eventos con precio por persona. El cliente los elige al reservar; si exigen prepago, paga antes de confirmar.">
        {!ro ? <Boton tipo="primario" onClick={() => setModal({ x: null })}>+ Nueva experiencia</Boton> : null}
      </Cabecera>
      {ro ? <SoloLectura /> : null}

      {lista === null ? (
        <div className="spinner" />
      ) : lista.length ? (
        <div className="aj-lista">
          {lista.map((x) => (
            <div key={x.id} className={`aj-item${x.activa ? "" : " inactiva"}`}>
              <div className="cuerpo">
                <div className="tit">
                  {x.nombre}
                  {x.precio_pax != null ? <Chip color="#0F6E56">{fmtEuros(x.precio_pax)} / pers.</Chip> : null}
                  {x.requiere_prepago ? <Chip color="#2F80ED">prepago</Chip> : null}
                  {!x.activa ? <Chip color="#8A9199">inactiva</Chip> : null}
                </div>
                <div className="det">
                  {x.pax_min}{x.pax_max ? `–${x.pax_max}` : "+"} personas · {textoDias(x.dias_semana)}
                  {x.turnos?.length ? ` · ${x.turnos.map(nombreTurno).join(", ")}` : " · todos los turnos"}
                  {x.fecha_desde || x.fecha_hasta ? ` · ${x.fecha_desde ? `desde ${fmtFecha(x.fecha_desde)}` : ""}${x.fecha_desde && x.fecha_hasta ? " " : ""}${x.fecha_hasta ? `hasta ${fmtFecha(x.fecha_hasta)}` : ""}` : ""}
                  {x.descripcion ? ` — ${x.descripcion.slice(0, 120)}${x.descripcion.length > 120 ? "…" : ""}` : ""}
                </div>
              </div>
              <div className="acc"><Boton className="mini" onClick={() => setModal({ x })}>{ro ? "Ver" : "Editar"}</Boton></div>
            </div>
          ))}
        </div>
      ) : (
        <Vacio>Sin experiencias. Crea una para ofrecer un menú o una cata con precio cerrado desde el widget.</Vacio>
      )}

      {modal ? <Modal x={modal.x} restId={rest.id} turnos={turnos} avisar={avisar} puedeBorrar={!ro} cerrar={() => setModal(null)} guardado={async () => { setModal(null); await cargar(); }} /> : null}
    </>
  );
}
