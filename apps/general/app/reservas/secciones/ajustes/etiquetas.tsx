"use client";

/* Ajustes › Etiquetas: tres ámbitos (reserva, cliente, alérgeno), color, orden por arrastre
   o flechas, activar/desactivar y borrar (se desactiva si está en uso). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { borrarEtiqueta, guardarEtiqueta, listarEtiquetas, ordenarEtiquetas, type Etiqueta } from "../../acciones/ajustes";
import { Boton, Cabecera, Chip, ColorCampo, Confirmar, Interruptor, SoloLectura, Vacio, useAccion, type AjProps } from "./comunes";

const AMBITOS: { id: string; texto: string; ayuda: string; color: string }[] = [
  { id: "reserva", texto: "Reserva", ayuda: "Se ponen en la reserva: cumpleaños, trona, menú concertado, grupo…", color: "#2F80ED" },
  { id: "cliente", texto: "Cliente", ayuda: "Viven en la ficha del cliente: VIP, habitual, lista negra, no-show previo…", color: "#D99A1E" },
  { id: "alergeno", texto: "Alérgeno", ayuda: "Los 14 de la UE y los que quieras añadir; aparecen en rojo en la lista de sala.", color: "#D32F2F" },
];

function FilaNombre({ valor, onGuardar, disabled }: { valor: string; onGuardar: (v: string) => void; disabled?: boolean }) {
  const [v, setV] = useState(valor);
  useEffect(() => { setV(valor); }, [valor]);
  return (
    <input value={v} disabled={disabled} maxLength={40} onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v.trim() && v.trim() !== valor) onGuardar(v.trim()); else setV(valor); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setV(valor); }} />
  );
}

export default function AjEtiquetas({ avisar, puedeEditar }: AjProps) {
  const [ambito, setAmbito] = useState("reserva");
  const [todas, setTodas] = useState<Etiqueta[] | null>(null);
  const [nueva, setNueva] = useState({ nombre: "", color: "#2E9E5B" });
  const [confirmar, setConfirmar] = useState<Etiqueta | null>(null);
  const [arrastre, setArrastre] = useState<{ id: string; sobre: string | null } | null>(null);
  const { ocupado, correr } = useAccion(avisar);
  const ro = !puedeEditar;

  const cargar = useCallback(async () => setTodas(await listarEtiquetas()), []);
  useEffect(() => { cargar(); }, [cargar]);

  const lista = useMemo(() => (todas ?? []).filter((e) => e.ambito === ambito), [todas, ambito]);
  const def = AMBITOS.find((a) => a.id === ambito)!;

  async function cambiar(e: Etiqueta, c: Partial<{ nombre: string; color: string; activa: boolean }>) {
    const r = await correr(guardarEtiqueta(e.id, { ambito: e.ambito, nombre: c.nombre ?? e.nombre, color: c.color ?? e.color, orden: e.orden, activa: c.activa ?? e.activa }));
    if (r.ok && r.data) setTodas((xs) => (xs ?? []).map((x) => (x.id === e.id ? r.data! : x)));
  }

  async function crear() {
    if (!nueva.nombre.trim()) { avisar("Escribe el nombre de la etiqueta."); return; }
    const orden = (lista.length ? Math.max(...lista.map((e) => e.orden)) : 0) + 10;
    const r = await correr(guardarEtiqueta(null, { ambito, nombre: nueva.nombre, color: nueva.color, orden, activa: true }), "Etiqueta creada.");
    if (r.ok) { setNueva((n) => ({ ...n, nombre: "" })); await cargar(); }
  }

  async function reordenar(ids: string[]) {
    // Optimista: se reordena en pantalla y se guarda detrás
    setTodas((xs) => (xs ?? []).map((x) => (x.ambito === ambito && ids.includes(x.id) ? { ...x, orden: (ids.indexOf(x.id) + 1) * 10 } : x)));
    const r = await correr(ordenarEtiquetas(ids));
    if (!r.ok) await cargar();
  }
  const mover = (i: number, dir: -1 | 1) => {
    const ids = lista.map((e) => e.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reordenar(ids);
  };
  const soltar = () => {
    if (!arrastre || !arrastre.sobre || arrastre.id === arrastre.sobre) { setArrastre(null); return; }
    const ids = lista.map((e) => e.id);
    const de = ids.indexOf(arrastre.id), a = ids.indexOf(arrastre.sobre);
    ids.splice(de, 1);
    ids.splice(a, 0, arrastre.id);
    setArrastre(null);
    reordenar(ids);
  };

  return (
    <>
      <Cabecera titulo="Etiquetas" texto="Las etiquetas se ven en la lista de sala, en el modal de reserva y en la ficha del cliente. El orden aquí es el orden en que se ofrecen." />
      {ro ? <SoloLectura /> : null}

      <div className="aj-salas-tabs">
        {AMBITOS.map((a) => (
          <button key={a.id} className={ambito === a.id ? "activo" : ""} onClick={() => setAmbito(a.id)}>
            {a.texto} <span style={{ opacity: 0.7 }}>({(todas ?? []).filter((e) => e.ambito === a.id && e.activa).length})</span>
          </button>
        ))}
        <span className="mudo" style={{ fontSize: 12, marginLeft: 6 }}>{def.ayuda}</span>
      </div>

      {todas === null ? (
        <div className="spinner" />
      ) : (
        <div className="aj-tabla-env">
          <table className="aj-tabla" onDragOver={(e) => e.preventDefault()} onDrop={soltar}>
            <thead>
              <tr>
                <th style={{ width: 22 }} />
                <th>Etiqueta</th>
                <th>Vista</th>
                <th>Color</th>
                <th className="centro">Activa</th>
                <th className="acc">Orden</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((e, i) => (
                <tr
                  key={e.id}
                  className={`${e.activa ? "" : "inactiva"}${arrastre?.id === e.id ? " arrastrando" : ""}${arrastre?.sobre === e.id && arrastre.id !== e.id ? " destino" : ""}`}
                  draggable={!ro}
                  onDragStart={() => setArrastre({ id: e.id, sobre: null })}
                  onDragEnter={() => setArrastre((a) => (a ? { ...a, sobre: e.id } : a))}
                  onDragEnd={() => setArrastre(null)}
                >
                  <td className="arrastre" title="Arrastra para ordenar">⋮⋮</td>
                  <td className="nombre"><FilaNombre valor={e.nombre} disabled={ro} onGuardar={(v) => cambiar(e, { nombre: v })} /></td>
                  <td><Chip color={e.color}>{e.nombre}</Chip></td>
                  <td><ColorCampo valor={e.color} disabled={ro} onChange={(v) => { if (v) cambiar(e, { color: v }); }} /></td>
                  <td className="centro"><Interruptor on={e.activa} disabled={ro} pequeno onChange={(v) => cambiar(e, { activa: v })} /></td>
                  <td className="acc">
                    <Boton className="icono" tipo="fantasma" disabled={ro || i === 0} onClick={() => mover(i, -1)} title="Subir">↑</Boton>
                    <Boton className="icono" tipo="fantasma" disabled={ro || i === lista.length - 1} onClick={() => mover(i, 1)} title="Bajar">↓</Boton>
                    <Boton className="icono" tipo="peligro" disabled={ro} onClick={() => setConfirmar(e)} title="Borrar">✕</Boton>
                  </td>
                </tr>
              ))}
              {!lista.length ? <tr><td colSpan={6}><Vacio>Sin etiquetas de {def.texto.toLowerCase()}.</Vacio></td></tr> : null}
            </tbody>
            {!ro ? (
              <tfoot>
                <tr>
                  <td />
                  <td className="nombre"><input placeholder={`Nueva etiqueta de ${def.texto.toLowerCase()}`} value={nueva.nombre} maxLength={40} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") crear(); }} /></td>
                  <td>{nueva.nombre ? <Chip color={nueva.color}>{nueva.nombre}</Chip> : null}</td>
                  <td><ColorCampo valor={nueva.color} onChange={(v) => setNueva({ ...nueva, color: v ?? "#888888" })} /></td>
                  <td colSpan={2} className="acc"><Boton tipo="primario" className="mini" disabled={ocupado} onClick={crear}>+ Añadir</Boton></td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}

      {confirmar ? (
        <Confirmar
          texto={`¿Borrar la etiqueta «${confirmar.nombre}»?`}
          detalle="Si algún cliente o reserva la lleva, se desactiva en vez de borrarse."
          confirmarTexto="Borrar"
          peligro
          ocupado={ocupado}
          onNo={() => setConfirmar(null)}
          onSi={async () => {
            const r = await correr(borrarEtiqueta(confirmar.id));
            if (r.ok) { avisar(r.data?.desactivada ? "Estaba en uso: se ha desactivado." : "Etiqueta borrada."); await cargar(); }
            setConfirmar(null);
          }}
        />
      ) : null}
    </>
  );
}
