"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { revocarMandato } from "../../acciones-remesas";

export default function BotonRevocar({ id }: { id: string }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();

  return (
    <button
      className="boton-enlace"
      disabled={pendiente}
      onClick={() => {
        if (!confirm("¿Revocar este mandato? Dejará de poder domiciliarse a ese cliente.")) return;
        iniciar(async () => {
          await revocarMandato(id);
          router.refresh();
        });
      }}
    >
      {pendiente ? "Revocando…" : "Revocar"}
    </button>
  );
}
