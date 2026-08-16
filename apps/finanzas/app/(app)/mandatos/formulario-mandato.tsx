"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarMandato } from "../../acciones-remesas";

export default function FormularioMandato({ clientes }: { clientes: { id: string; nombre_fiscal: string }[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [clienteId, setClienteId] = useState(clientes[0]?.id ?? "");
  const [referencia, setReferencia] = useState("");
  const [tipo, setTipo] = useState<"CORE" | "B2B">("CORE");
  const [fechaFirma, setFechaFirma] = useState("");
  const [iban, setIban] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!abierto) {
    return (
      <div className="barra-filtros">
        <button className="boton boton-auto" onClick={() => setAbierto(true)} disabled={clientes.length === 0}>
          Nuevo mandato
        </button>
        {clientes.length === 0 && <span className="texto-suave">Primero hace falta algún cliente activo.</span>}
      </div>
    );
  }

  return (
    <fieldset className="bloque">
      <legend>Nuevo mandato</legend>
      <div className="rejilla">
        <label className="campo ancho-2">
          <span>Cliente *</span>
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre_fiscal}</option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Referencia *</span>
          <input className="dato" value={referencia} onChange={(e) => setReferencia(e.target.value.toUpperCase())} placeholder="MND-0001" autoFocus />
          <em className="pista">La que viaja en el fichero. Única y estable.</em>
        </label>
        <label className="campo">
          <span>Tipo</span>
          <select className="dato" value={tipo} onChange={(e) => setTipo(e.target.value as "CORE" | "B2B")}>
            <option value="CORE">CORE · particulares y general</option>
            <option value="B2B">B2B · solo entre empresas</option>
          </select>
        </label>
        <label className="campo">
          <span>Fecha de firma *</span>
          <input className="dato" type="date" value={fechaFirma} onChange={(e) => setFechaFirma(e.target.value)} />
        </label>
        <label className="campo ancho-2">
          <span>IBAN del cliente *</span>
          <input className="dato" value={iban} onChange={(e) => setIban(e.target.value.toUpperCase())} placeholder="ES91 2100 0418 4502 0005 1332" />
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
              const r = await guardarMandato({ clienteId, referencia, tipo, fechaFirma, iban });
              if (r?.error) { setError(r.error); return; }
              setAbierto(false);
              setReferencia(""); setIban(""); setFechaFirma("");
              router.refresh();
            });
          }}
        >
          {pendiente ? "Guardando…" : "Guardar mandato"}
        </button>
        <button className="boton-secundario" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
    </fieldset>
  );
}
