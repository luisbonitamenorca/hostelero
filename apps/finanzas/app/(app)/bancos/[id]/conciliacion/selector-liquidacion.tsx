"use client";

import { useState } from "react";
import { conciliarLiquidando } from "@/app/acciones-bancos";

type CandidatoCartera = {
  ap_id: string;
  asiento_numero: number;
  asiento_fecha: string;
  cuenta_codigo: string;
  descripcion: string;
  importe: number;
};

/**
 * Liquidar contra lo vivo: facturas de cliente por cobrar (43x), de proveedor
 * por pagar (40x/41x), nóminas (465), IRPF (475) y Seguridad Social (476).
 * Al cuadrar la suma con el movimiento se GENERA el asiento de cobro/pago
 * contra el banco — no hace falta que exista en el diario. El servidor repite
 * la validación.
 */
export default function SelectorLiquidacion({
  bancoId,
  movId,
  objetivo,
  candidatos,
}: {
  bancoId: string;
  movId: string;
  objetivo: number;
  candidatos: CandidatoCartera[];
}) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const euros = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  const fecha = (f: string) => f.split("-").reverse().join("/");

  const suma = candidatos
    .filter((c) => marcados.has(c.ap_id))
    .reduce((s, c) => s + Number(c.importe), 0);
  const clavado = Math.round(suma * 100) === Math.round(Math.abs(objetivo) * 100) && marcados.size >= 1;

  function alternar(id: string) {
    setMarcados((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  return (
    <form action={conciliarLiquidando} style={{ border: "1px solid #DDE2DF", borderRadius: 8, padding: 12, background: "#fff", marginTop: 8 }}>
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
              {euros(Number(c.importe))}
            </span>
            <span style={{ color: "#5F6B65" }}>
              {c.cuenta_codigo} · nº {c.asiento_numero} · {fecha(c.asiento_fecha)} · {c.descripcion.slice(0, 46)}
            </span>
          </label>
        ))}
        {candidatos.length === 0 && (
          <p style={{ color: "#5F6B65", fontSize: 13, margin: 0 }}>
            No hay facturas ni cuentas pendientes de importe compatible.
          </p>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10, borderTop: "1px solid #EEF1EF", paddingTop: 10 }}>
        <span style={{ fontSize: 13 }}>
          Suma: <strong style={{ color: clavado ? "#0F6E56" : suma !== 0 ? "#B4423A" : undefined }}>{euros(suma)}</strong>
          {" "}de <strong>{euros(Math.abs(objetivo))}</strong>
          {!clavado && suma !== 0 && (
            <span style={{ color: "#5F6B65" }}> · faltan {euros(Math.abs(objetivo) - suma)}</span>
          )}
        </span>
        <button className="boton" type="submit" disabled={!clavado} style={{ marginLeft: "auto", opacity: clavado ? 1 : 0.45 }} title="Genera el asiento de cobro/pago y liquida la cartera">
          {objetivo > 0 ? "Cobrar" : "Pagar"} ({marcados.size})
        </button>
      </div>
    </form>
  );
}
