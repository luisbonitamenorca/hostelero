"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarCondicionesProveedor } from "../../acciones-cartera";

export default function Condiciones({
  proveedorId,
  dias,
  forma,
}: {
  proveedorId: string;
  dias: number | null;
  forma: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [d, setD] = useState(String(dias ?? 30));
  const [f, setF] = useState(forma ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!abierto) {
    return (
      <button className="boton-enlace" onClick={() => setAbierto(true)}>
        {dias === null ? "Poner plazo" : `${dias} d${forma ? ` · ${forma}` : ""}`}
      </button>
    );
  }

  return (
    <div className="acciones-fila">
      <input
        className="celda dato a-derecha"
        style={{ width: 56 }}
        value={d}
        onChange={(e) => setD(e.target.value)}
        inputMode="numeric"
        aria-label="Días de pago"
        autoFocus
      />
      <input
        className="celda"
        style={{ width: 110 }}
        value={f}
        onChange={(e) => setF(e.target.value)}
        placeholder="Transferencia"
        aria-label="Forma de pago"
      />
      <button
        className="boton-enlace"
        disabled={pendiente}
        onClick={() => {
          setError(null);
          iniciar(async () => {
            const r = await guardarCondicionesProveedor({
              proveedorId,
              diasPago: Number(d),
              formaPago: f || null,
              iban: null,
            });
            if (r?.error) {
              setError(r.error);
              return;
            }
            setAbierto(false);
            router.refresh();
          });
        }}
      >
        {pendiente ? "Guardando…" : "Guardar"}
      </button>
      <button className="boton-enlace" onClick={() => setAbierto(false)}>
        Cancelar
      </button>
      {error && <em className="error-campo">{error}</em>}
    </div>
  );
}
