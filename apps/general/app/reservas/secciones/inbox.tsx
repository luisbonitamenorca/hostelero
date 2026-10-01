"use client";

import type { SecProps } from "../lib-reservas";
import "./inbox.css";

/* Inbox: pendientes de confirmación, tarjeta no introducida, pagos, valoraciones, mensajes con error,
   solicitudes de lista de espera. Pendiente: lo construye el agente de esta sección. */
export default function SecInbox({ rest }: SecProps) {
  return (
    <div className="tarjeta">
      <h3 className="seccion">Inbox · {rest.nombre}</h3>
      <div className="vacio">
        Aquí se agruparán las reservas que requieren una acción: pendientes de confirmar, tarjeta sin introducir,
        pagos, valoraciones recibidas, mensajes con error y solicitudes de lista de espera.
      </div>
    </div>
  );
}
