"use client";

import { useActionState, useEffect, useState } from "react";
import { crearSerie, type EstadoAccion } from "../../acciones";

type Sociedad = { id: string; nombre: string };
type Ejercicio = { anio: number; estado: string; sociedad_id: string };

export default function NuevaSerie({
  sociedades,
  ejercicios,
}: {
  sociedades: Sociedad[];
  ejercicios: Ejercicio[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [sociedadId, setSociedadId] = useState(sociedades[0]?.id ?? "");
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(crearSerie, null);

  useEffect(() => {
    if (estado?.ok) setAbierto(false);
  }, [estado]);

  const delaSociedad = ejercicios.filter((e) => e.sociedad_id === sociedadId);
  const porDefecto = delaSociedad.find((e) => e.estado === "abierto") ?? delaSociedad[0];

  if (!abierto) {
    return (
      <div className="barra-filtros">
        <button className="boton boton-auto" onClick={() => setAbierto(true)}>
          Nueva serie
        </button>
      </div>
    );
  }

  return (
    <form className="formulario" action={accion}>
      <fieldset className="bloque">
        <legend>Nueva serie</legend>
        <div className="rejilla">
          <label className="campo ancho-2">
            <span>Sociedad</span>
            <select name="sociedad_id" value={sociedadId} onChange={(e) => setSociedadId(e.target.value)}>
              {sociedades.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Ejercicio</span>
            <select className="dato" name="ejercicio" defaultValue={String(porDefecto?.anio ?? "")}>
              {delaSociedad.map((e) => (
                <option key={e.anio} value={String(e.anio)}>
                  {e.anio} {e.estado !== "abierto" ? `(${e.estado})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Código</span>
            <input className="dato" name="codigo" maxLength={4} placeholder="F" autoFocus />
            <em className="pista">Aparece en el número: F-2026-000001.</em>
          </label>
          <label className="campo ancho-2">
            <span>Descripción</span>
            <input name="descripcion" placeholder="Facturas 2026" />
          </label>
          <label className="campo">
            <span>Tipo por defecto</span>
            <select className="dato" name="tipo_defecto" defaultValue="F1">
              <option value="F1">F1 · completa</option>
              <option value="F2">F2 · simplificada</option>
            </select>
          </label>
          <label className="campo">
            <span>Primer número</span>
            <input className="dato" type="number" name="siguiente_numero" min={1} defaultValue={1} />
            <em className="pista">Solo se elige aquí: después manda el correlativo.</em>
          </label>
        </div>
        {estado?.error && <p className="error-texto">{estado.error}</p>}
      </fieldset>
      <div className="acciones">
        <button className="boton boton-auto" type="submit" disabled={pendiente}>
          {pendiente ? "Creando…" : "Crear serie"}
        </button>
        <button className="boton-secundario" type="button" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
