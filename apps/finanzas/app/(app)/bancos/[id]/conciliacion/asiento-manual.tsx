"use client";

import { useState } from "react";
import { conciliarAsientoManual } from "@/app/acciones-bancos";

type Centro = { id: string; nombre: string };
type Linea = { codigo: string; descripcion: string; centro: string; importe: string; lado: "debe" | "haber" };

/**
 * Asiento libre desde la conciliación: para cargos o ingresos raros que no
 * encajan ni en Liquidar ni en los destinos rápidos. El usuario escribe las
 * contrapartidas (cuenta, centro, debe/haber); la línea del banco la pone el
 * servidor con el importe del movimiento y el asiento debe cuadrar al céntimo.
 */
export default function AsientoManual({
  bancoId,
  movId,
  objetivo,
  concepto,
  centros,
}: {
  bancoId: string;
  movId: string;
  objetivo: number;
  concepto: string;
  centros: Centro[];
}) {
  const [abierto, setAbierto] = useState(false);
  const ladoInicial: "debe" | "haber" = objetivo > 0 ? "haber" : "debe";
  const [lineas, setLineas] = useState<Linea[]>([
    { codigo: "", descripcion: "", centro: "", importe: Math.abs(objetivo).toFixed(2), lado: ladoInicial },
  ]);
  const [descripcion, setDescripcion] = useState(concepto);
  const euros = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });

  const num = (s: string) => {
    const v = Number(s.replace(",", "."));
    return Number.isFinite(v) ? v : 0;
  };
  // La línea del banco: debe si es un ingreso, haber si es un cargo.
  const bancoDebe = objetivo > 0 ? Math.abs(objetivo) : 0;
  const bancoHaber = objetivo > 0 ? 0 : Math.abs(objetivo);
  const sumaDebe = bancoDebe + lineas.reduce((s, l) => s + (l.lado === "debe" ? num(l.importe) : 0), 0);
  const sumaHaber = bancoHaber + lineas.reduce((s, l) => s + (l.lado === "haber" ? num(l.importe) : 0), 0);
  const diferencia = Math.round((sumaDebe - sumaHaber) * 100) / 100;
  const completas = lineas.every((l) => l.codigo.trim().length >= 3 && num(l.importe) > 0);
  const cuadra = diferencia === 0 && completas && lineas.length > 0;

  const payload = JSON.stringify(
    lineas.map((l) => ({
      codigo: l.codigo.trim(),
      descripcion: l.descripcion.trim() || null,
      centro: l.centro || null,
      debe: l.lado === "debe" ? num(l.importe) : 0,
      haber: l.lado === "haber" ? num(l.importe) : 0,
    })),
  );

  function cambiar(i: number, patch: Partial<Linea>) {
    setLineas((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  if (!abierto) {
    return (
      <button
        className="boton-secundario"
        type="button"
        style={{ fontSize: 12, padding: "3px 10px", marginLeft: 6 }}
        onClick={() => setAbierto(true)}
        title="Contabilizar este movimiento con un asiento libre, línea a línea"
      >
        Asiento…
      </button>
    );
  }

  const celda: React.CSSProperties = { padding: "4px 6px", border: "1px solid #DDE2DF", borderRadius: 6, fontSize: 13 };

  return (
    <form action={conciliarAsientoManual} style={{ border: "1px solid #DDE2DF", borderRadius: 8, padding: 12, background: "#fff", marginTop: 8 }}>
      <input type="hidden" name="banco" value={bancoId} />
      <input type="hidden" name="mov" value={movId} />
      <input type="hidden" name="lineas" value={payload} />
      <p style={{ margin: "0 0 8px", fontSize: 13, color: "#5F6B65" }}>
        La línea del banco ({euros(Math.abs(objetivo))} al {objetivo > 0 ? "debe" : "haber"}) se añade sola. Escribe las contrapartidas:
      </p>
      <input
        name="descripcion"
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        placeholder="Descripción del asiento"
        style={{ ...celda, width: "100%", marginBottom: 8 }}
      />
      {lineas.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={l.codigo}
            onChange={(e) => cambiar(i, { codigo: e.target.value.replace(/\D/g, "") })}
            placeholder="Cuenta (p. ej. 430100003)"
            style={{ ...celda, width: 150, fontVariantNumeric: "tabular-nums" }}
          />
          <input
            value={l.descripcion}
            onChange={(e) => cambiar(i, { descripcion: e.target.value })}
            placeholder="Concepto de la línea (opcional)"
            style={{ ...celda, flex: 1, minWidth: 140 }}
          />
          <select value={l.centro} onChange={(e) => cambiar(i, { centro: e.target.value })} style={{ ...celda, maxWidth: 150 }}>
            <option value="">— sin centro —</option>
            {centros.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          <select value={l.lado} onChange={(e) => cambiar(i, { lado: e.target.value as "debe" | "haber" })} style={celda}>
            <option value="debe">Debe</option>
            <option value="haber">Haber</option>
          </select>
          <input
            value={l.importe}
            onChange={(e) => cambiar(i, { importe: e.target.value })}
            placeholder="0,00"
            style={{ ...celda, width: 100, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
          />
          {lineas.length > 1 && (
            <button type="button" className="boton-secundario" style={{ fontSize: 12, padding: "3px 8px" }}
              onClick={() => setLineas((prev) => prev.filter((_, j) => j !== i))}>
              ×
            </button>
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10, borderTop: "1px solid #EEF1EF", paddingTop: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="boton-secundario"
          style={{ fontSize: 12 }}
          onClick={() =>
            setLineas((prev) => [...prev, { codigo: "", descripcion: "", centro: "", importe: Math.abs(diferencia) > 0 ? Math.abs(diferencia).toFixed(2) : "", lado: diferencia > 0 ? "haber" : "debe" }])
          }
        >
          + Línea
        </button>
        <span style={{ fontSize: 13 }}>
          Debe <strong>{euros(sumaDebe)}</strong> · Haber <strong>{euros(sumaHaber)}</strong>
          {diferencia !== 0 && (
            <span style={{ color: "#B4423A" }}> · descuadre de {euros(Math.abs(diferencia))} {diferencia > 0 ? "al haber" : "al debe"}</span>
          )}
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
          <button type="button" className="boton-secundario" onClick={() => setAbierto(false)}>Cancelar</button>
          <button className="boton" type="submit" disabled={!cuadra} style={{ opacity: cuadra ? 1 : 0.45 }} title="Crea el asiento y concilia el movimiento">
            Contabilizar
          </button>
        </span>
      </div>
    </form>
  );
}
