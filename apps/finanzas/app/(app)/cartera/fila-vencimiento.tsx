"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { liquidarVencimiento, reabrirVencimiento } from "../../acciones-cartera";
import { aNumero } from "@/lib/importes";

export default function FilaVencimiento({
  id,
  pendiente,
  estado,
  sentido,
}: {
  id: string;
  pendiente: number;
  estado: string;
  sentido: "cobro" | "pago";
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [importe, setImporte] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendienteAccion, iniciar] = useTransition();

  const verbo = sentido === "cobro" ? "Cobrar" : "Pagar";

  function ejecutar(cantidad: number) {
    setError(null);
    iniciar(async () => {
      const r = await liquidarVencimiento(id, cantidad);
      if (r?.error) {
        setError(r.error);
        return;
      }
      setAbierto(false);
      setImporte("");
      router.refresh();
    });
  }

  if (estado === "anulado") return <span className="texto-suave">—</span>;

  if (estado === "liquidado") {
    return (
      <button
        className="boton-enlace"
        disabled={pendienteAccion}
        onClick={() => {
          setError(null);
          iniciar(async () => {
            await reabrirVencimiento(id);
            router.refresh();
          });
        }}
      >
        Reabrir
      </button>
    );
  }

  if (!abierto) {
    return (
      <div className="acciones-fila">
        <button className="boton-enlace" disabled={pendienteAccion} onClick={() => ejecutar(pendiente)}>
          {verbo} todo
        </button>
        <button className="boton-enlace" onClick={() => setAbierto(true)}>
          Parcial
        </button>
      </div>
    );
  }

  return (
    <div className="acciones-fila">
      <input
        className="celda dato a-derecha"
        style={{ width: 90 }}
        value={importe}
        onChange={(e) => setImporte(e.target.value)}
        placeholder="0,00"
        inputMode="decimal"
        autoFocus
      />
      <button
        className="boton-enlace"
        disabled={pendienteAccion || !aNumero(importe)}
        onClick={() => ejecutar(aNumero(importe))}
      >
        Aplicar
      </button>
      <button className="boton-enlace" onClick={() => setAbierto(false)}>
        Cancelar
      </button>
      {error && <em className="error-campo">{error}</em>}
    </div>
  );
}
