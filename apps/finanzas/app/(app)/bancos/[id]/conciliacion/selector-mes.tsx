"use client";

/**
 * Desplegable de mes que aplica el filtro AL CAMBIAR, sin tener que pulsar
 * «Buscar» (trampa de UI cazada por Luis el 28-08-2026: cambiaba el mes y los
 * indicadores no se movían porque el formulario nunca se enviaba).
 */
export default function SelectorMes({ meses, valor }: { meses: string[]; valor: string }) {
  return (
    <select
      name="mes"
      defaultValue={valor}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      style={{ padding: "6px 8px", border: "1px solid #DDE2DF", borderRadius: 6 }}
    >
      <option value="">Todo el año</option>
      {meses.map((m) => (
        <option key={m} value={m}>
          {m.split("-").reverse().join("/")}
        </option>
      ))}
    </select>
  );
}
