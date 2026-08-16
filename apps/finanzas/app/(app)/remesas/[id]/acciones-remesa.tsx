"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { marcarRemesa } from "../../../acciones-remesas";

export default function AccionesRemesa({ id, estado }: { id: string; estado: string }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  function marcar(nuevo: "generada" | "enviada" | "anulada", aviso?: string) {
    if (aviso && !confirm(aviso)) return;
    iniciar(async () => {
      await marcarRemesa(id, nuevo);
      router.refresh();
    });
  }

  return (
    <>
      {estado === "borrador" && (
        <>
          <button
            className="boton-secundario"
            disabled={pendiente}
            onClick={() => marcar("generada", "¿Marcar como generada? A partir de aquí sus líneas ya no se pueden tocar.")}
          >
            He generado el fichero
          </button>
          <button
            className="boton-enlace peligro"
            disabled={pendiente}
            onClick={() => marcar("anulada", "¿Anular la remesa? Los vencimientos vuelven a quedar libres para otra.")}
          >
            Anular
          </button>
        </>
      )}
      {estado === "generada" && (
        <button
          className="boton-secundario"
          disabled={pendiente}
          onClick={() => marcar("enviada", "¿Confirmas que la has subido al banco? Los mandatos usados pasarán a recurrentes.")}
        >
          La he subido al banco
        </button>
      )}
    </>
  );
}
