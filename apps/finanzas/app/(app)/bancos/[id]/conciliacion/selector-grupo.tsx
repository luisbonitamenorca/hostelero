"use client";

import { useState } from "react";
import { conciliarGrupo } from "@/app/acciones-bancos";

type Candidato = {
  ap_id: string;
  asiento_numero: number;
  asiento_fecha: string;
  descripcion: string;
  importe: number;
};

/**
 * Tickar facturas hasta cuadrar: la suma corre en vivo y el botón solo se
 * enciende cuando clava el importe del movimiento al céntimo. La validación
 * de verdad la repite el servidor.
 */
export default function SelectorGrupo({
  bancoId,
  movId,
  objetivo,
  candidatos,
}: {
  bancoId: string;
  movId: string;
  objetivo: number;
  candidatos: Candidato[];
}) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const euros = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  const fecha = (f: string) => f.split("-").reverse().join("/");

  const suma = candidatos
    .filter((c) => marcados.has(c.ap_id))
    .reduce((s, c) => s + Number(c.importe) * Math.sign(objetivo), 0);
  const clavado = Math.round(suma * 100) === Math.round(objetivo * 100) && marcados.size >= 2;

  function alternar(id: string) {
    setMarcados((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  return (
    <form action={conciliarGrupo} style={{ border: "1px solid #DDE2DF", borderRadius: 8, padding: 12, background: "#fff", marginTop: 8 }}>
      <input type="hidden" name="banco" value={bancoId} />
      <input type="hidden" name="mov" value={movId} />
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {candidatos.map((c) => (
          <label key={c.ap_id} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "3px 0", fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              name="apunte"
              value={c.ap_id}
              checked={marcados.has(c.ap_id)}
              onChange={() => alternar(c.ap_id)}
            />
            <span style={{ minWidth: 84, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {euros(Number(c.importe) * Math.sign(objetivo))}
            </span>
            <span style={{ color: "#5F6B65" }}>
              nº {c.asiento_numero} · {fecha(c.asiento_fecha)} · {c.descripcion.slice(0, 52)}
            </span>
          </label>
        ))}
        {candidatos.length === 0 && (
          <p style={{ color: "#5F6B65", fontSize: 13, margin: 0 }}>
            No hay apuntes libres de importe compatible a menos de 60 días.
          </p>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10, borderTop: "1px solid #EEF1EF", paddingTop: 10 }}>
        <span style={{ fontSize: 13 }}>
          Suma: <strong style={{ color: clavado ? "#0F6E56" : suma !== 0 ? "#B4423A" : undefined }}>{euros(suma)}</strong>
          {" "}de <strong>{euros(objetivo)}</strong>
          {!clavado && suma !== 0 && (
            <span style={{ color: "#5F6B65" }}> · faltan {euros(objetivo - suma)}</span>
          )}
        </span>
        <button className="boton" type="submit" disabled={!clavado} style={{ marginLeft: "auto", opacity: clavado ? 1 : 0.45 }}>
          Conciliar grupo ({marcados.size})
        </button>
      </div>
    </form>
  );
}
