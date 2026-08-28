"use client";

import { useState, useTransition } from "react";
import { clasificarMovimiento, ignorarMovimiento } from "@/app/acciones-bancos";
import AsientoManual from "./asiento-manual";

type Centro = { id: string; nombre: string };

/**
 * Todas las acciones de un movimiento pendiente en un desplegable único:
 * liquidar facturas, asiento manual, enviar a una cuenta rápida o ignorar.
 * Sustituye a la botonera que crecía sin control.
 */
export default function MenuConciliar({
  bancoId,
  movId,
  objetivo,
  concepto,
  centros,
  destinos,
  hrefLiquidar,
  liquidarAbierto,
}: {
  bancoId: string;
  movId: string;
  objetivo: number;
  concepto: string;
  centros: Centro[];
  destinos: [string, string][];
  hrefLiquidar: string;
  liquidarAbierto: boolean;
}) {
  const [modo, setModo] = useState<"" | "asiento">("");
  const [aplicando, empezar] = useTransition();

  function elegir(valor: string) {
    if (!valor) return;
    if (valor === "liquidar") {
      window.location.href = hrefLiquidar;
      return;
    }
    if (valor === "asiento") {
      setModo("asiento");
      return;
    }
    if (valor === "ignorar") {
      const fd = new FormData();
      fd.set("banco", bancoId);
      fd.set("mov", movId);
      empezar(() => void ignorarMovimiento(fd));
      return;
    }
    if (valor.startsWith("destino:")) {
      const fd = new FormData();
      fd.set("banco", bancoId);
      fd.set("mov", movId);
      fd.set("destino", valor.slice(8));
      empezar(() => void clasificarMovimiento(fd));
    }
  }

  return (
    <>
      <select
        value=""
        disabled={aplicando}
        onChange={(e) => {
          const v = e.target.value;
          e.currentTarget.value = "";
          elegir(v);
        }}
        style={{ padding: "4px 8px", border: "1px solid #DDE2DF", borderRadius: 6, fontSize: 13, maxWidth: 220 }}
      >
        <option value="" disabled>
          {aplicando ? "Aplicando…" : "Conciliar…"}
        </option>
        <option value="liquidar">{liquidarAbierto ? "Cerrar el panel de liquidar" : "Liquidar facturas o nóminas…"}</option>
        <option value="asiento">Asiento manual…</option>
        <optgroup label="Enviar a cuenta">
          {destinos.map(([v, t]) => (
            <option key={v} value={"destino:" + v}>{t}</option>
          ))}
        </optgroup>
        <option value="ignorar">Ignorar movimiento</option>
      </select>
      {modo === "asiento" && (
        <AsientoManual
          bancoId={bancoId}
          movId={movId}
          objetivo={objetivo}
          concepto={concepto}
          centros={centros}
          abiertoPorDefecto
          onCerrar={() => setModo("")}
        />
      )}
    </>
  );
}
