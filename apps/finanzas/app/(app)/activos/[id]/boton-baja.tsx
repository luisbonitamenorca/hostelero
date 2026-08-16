"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aNumero } from "@/lib/importes";
import { darDeBajaActivo } from "../../../acciones-activos";

export default function BotonBaja({ id, nombre }: { id: string; nombre: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [fechaBaja, setFechaBaja] = useState(new Date().toISOString().slice(0, 10));
  const [motivo, setMotivo] = useState("");
  const [valor, setValor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!abierto) {
    return (
      <div className="acciones" style={{ marginTop: 16 }}>
        <button className="boton-secundario" onClick={() => setAbierto(true)}>Dar de baja</button>
      </div>
    );
  }

  return (
    <fieldset className="bloque" style={{ marginTop: 16 }}>
      <legend>Dar de baja {nombre}</legend>
      <p className="pista">
        El activo no se borra: se marca como de baja y se conserva lo amortizado hasta hoy. Lo que
        quede sin amortizar habrá que llevarlo a resultado cuando el diario esté montado.
      </p>
      <div className="rejilla" style={{ marginTop: 12 }}>
        <label className="campo">
          <span>Fecha de baja *</span>
          <input className="dato" type="date" value={fechaBaja} onChange={(e) => setFechaBaja(e.target.value)} />
        </label>
        <label className="campo">
          <span>Importe de venta</span>
          <input className="dato a-derecha" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" />
          <em className="pista">Si se vende. Si se tira, déjalo vacío.</em>
        </label>
        <label className="campo ancho-2">
          <span>Motivo *</span>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Venta, rotura, obsolescencia…" autoFocus />
        </label>
      </div>
      {error && <p className="error-texto">{error}</p>}
      <div className="acciones">
        <button
          className="boton boton-auto"
          disabled={pendiente || !motivo.trim()}
          onClick={() => {
            setError(null);
            iniciar(async () => {
              const r = await darDeBajaActivo(id, fechaBaja, motivo, valor ? aNumero(valor) : null);
              if (r?.error) { setError(r.error); return; }
              setAbierto(false);
              router.refresh();
            });
          }}
        >
          {pendiente ? "Dando de baja…" : "Confirmar baja"}
        </button>
        <button className="boton-secundario" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
    </fieldset>
  );
}
