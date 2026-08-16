"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiarActivaSerie } from "../../acciones";

export default function BotonActiva({ id, activa }: { id: string; activa: boolean }) {
  const [pendiente, iniciar] = useTransition();
  const router = useRouter();

  return (
    <button
      className="boton-enlace"
      disabled={pendiente}
      onClick={() =>
        iniciar(async () => {
          await cambiarActivaSerie(id, !activa);
          router.refresh();
        })
      }
    >
      {activa ? "Desactivar" : "Activar"}
    </button>
  );
}
