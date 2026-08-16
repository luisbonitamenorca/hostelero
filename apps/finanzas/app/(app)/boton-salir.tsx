"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cerrarSesion } from "../acciones";

export default function BotonSalir() {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  return (
    <button
      className="boton-fantasma"
      disabled={pendiente}
      onClick={() =>
        iniciar(async () => {
          const r = await cerrarSesion();
          // Navega el cliente: router.push pone el prefijo /finanzas solo.
          if (r?.ir) router.push(r.ir);
          router.refresh();
        })
      }
    >
      {pendiente ? "Saliendo…" : "Salir"}
    </button>
  );
}
