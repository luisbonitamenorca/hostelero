"use client";

/* Selector del centro para el que se pide. Con un solo centro pinta su nombre sin desplegable.
   PanelPedidos recuerda la elección en «ped:centro». */

import { useId } from "react";
import type { PropsSelectorCentro } from "../tipos";

export default function SelectorCentro({ centros, valor, onCambio }: PropsSelectorCentro) {
  const id = useId();

  if (centros.length <= 1) {
    const unico = centros[0];
    return (
      <div className="ped-centro ped-centro--unico">
        <span className="ped-centro-rotulo">Centro</span>
        <span className="ped-centro-nombre">{unico ? unico.nombre : "Sin centro"}</span>
      </div>
    );
  }

  return (
    <div className="ped-centro">
      <label className="ped-centro-rotulo" htmlFor={id}>
        Centro
      </label>
      <select id={id} className="ped-centro-select" value={valor} onChange={(e) => onCambio(e.target.value)}>
        {centros.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
    </div>
  );
}
