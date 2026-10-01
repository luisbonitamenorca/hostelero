"use client";

import { fmtFechaLarga, type SecProps } from "../lib-reservas";
import "./cronograma.css";

/* Cronograma (mesas × horas). Pendiente: lo construye el agente de esta sección. */
export default function SecCronograma({ rest, fecha }: SecProps) {
  return (
    <div className="tarjeta">
      <h3 className="seccion">Cronograma · {rest.nombre}</h3>
      <div className="vacio">
        Aquí irá la vista de mesas por horas del {fmtFechaLarga(fecha)}: barras de reserva arrastrables, huecos y línea de ahora.
        <br />Mientras tanto, usa la pestaña <b>Día</b>.
      </div>
    </div>
  );
}
