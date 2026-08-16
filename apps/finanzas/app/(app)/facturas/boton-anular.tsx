"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { anularFactura } from "../../acciones";

export default function BotonAnular({ id, numero }: { id: string; numero: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!abierto) {
    return (
      <div className="acciones" style={{ marginTop: 16 }}>
        <button className="boton-secundario" onClick={() => setAbierto(true)}>
          Anular factura
        </button>
      </div>
    );
  }

  return (
    <fieldset className="bloque" style={{ marginTop: 16 }}>
      <legend>Anular {numero}</legend>
      <p className="pista">
        Anular no borra nada: añade un registro de anulación a la cadena y la factura queda como
        anulada, con su contenido intacto. Si lo que quieres es corregirla, lo que toca es una
        rectificativa (R1–R5), no esto.
      </p>
      <label className="campo" style={{ marginTop: 12 }}>
        <span>Motivo *</span>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Por qué se anula"
          autoFocus
        />
      </label>
      {error && <p className="error-texto">{error}</p>}
      <div className="acciones">
        <button
          className="boton boton-auto"
          disabled={pendiente || !motivo.trim()}
          onClick={() => {
            setError(null);
            iniciar(async () => {
              const r = await anularFactura(id, motivo);
              if (r?.error) {
                setError(r.error);
                return;
              }
              setAbierto(false);
              router.refresh();
            });
          }}
        >
          {pendiente ? "Anulando…" : "Confirmar anulación"}
        </button>
        <button className="boton-secundario" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </fieldset>
  );
}
