"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generarVencimientoCompra } from "../../acciones-cartera";

export default function BotonVencimiento({ id, yaTiene }: { id: string; yaTiene: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (yaTiene) return <span className="texto-suave">en cartera</span>;

  return (
    <>
      <button
        className="boton-enlace"
        disabled={pendiente}
        onClick={() => {
          setError(null);
          iniciar(async () => {
            const r = await generarVencimientoCompra(id);
            if (r?.error) {
              setError(r.error);
              return;
            }
            router.refresh();
          });
        }}
      >
        {pendiente ? "Creando…" : "A cartera"}
      </button>
      {error && <em className="error-campo">{error}</em>}
    </>
  );
}
