"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarCuentaBancaria } from "../../acciones-remesas";

export default function FormularioCuenta() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!abierto) {
    return (
      <div className="barra-filtros">
        <button className="boton boton-auto" onClick={() => setAbierto(true)}>
          Nueva cuenta
        </button>
      </div>
    );
  }

  return (
    <fieldset className="bloque">
      <legend>Nueva cuenta bancaria</legend>
      <div className="rejilla">
        <label className="campo ancho-2">
          <span>Nombre *</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="CaixaBank operativa" autoFocus />
        </label>
        <label className="campo ancho-2">
          <span>IBAN *</span>
          <input className="dato" value={iban} onChange={(e) => setIban(e.target.value.toUpperCase())} placeholder="ES91 2100 0418 4502 0005 1332" />
        </label>
        <label className="campo">
          <span>BIC</span>
          <input className="dato" value={bic} onChange={(e) => setBic(e.target.value.toUpperCase())} placeholder="CAIXESBBXXX" />
          <em className="pista">Opcional dentro de la zona SEPA.</em>
        </label>
      </div>
      {error && <p className="error-texto">{error}</p>}
      <div className="acciones">
        <button
          className="boton boton-auto"
          disabled={pendiente}
          onClick={() => {
            setError(null);
            iniciar(async () => {
              const r = await guardarCuentaBancaria({ nombre, iban, bic: bic || null });
              if (r?.error) {
                setError(r.error);
                return;
              }
              setAbierto(false);
              setNombre(""); setIban(""); setBic("");
              router.refresh();
            });
          }}
        >
          {pendiente ? "Guardando…" : "Guardar cuenta"}
        </button>
        <button className="boton-secundario" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
    </fieldset>
  );
}
