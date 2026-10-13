"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guardarCondicionesProveedor } from "../../acciones-cartera";
import {
  DIAS_SEMANA,
  FORMAS_PAGO,
  describirPlazo,
  type CondicionesProveedor,
  type PlazoTipo,
} from "@/lib/cartera";

/** Condiciones de pago de un proveedor en su fila: forma y plazo (13-10-2026, Luis).
 *  El plazo no siempre es «a N días»: también «primer lunes tras 30 días» o
 *  «día 10 tras 60 días». La fecha la calcula lib/cartera.ts. */
export default function Condiciones({
  proveedorId,
  cond,
}: {
  proveedorId: string;
  cond: Partial<CondicionesProveedor> | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [dias, setDias] = useState(String(cond?.dias_pago ?? 30));
  const [forma, setForma] = useState(cond?.forma_pago ?? "");
  const [tipo, setTipo] = useState<PlazoTipo>((cond?.plazo_tipo as PlazoTipo) ?? "dias");
  const [dia, setDia] = useState(String(cond?.plazo_dia ?? (cond?.plazo_tipo === "dia_mes" ? 10 : 1)));
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!abierto) {
    return (
      <button className="boton-enlace" onClick={() => setAbierto(true)} title="Forma y plazo de pago">
        {cond && cond.dias_pago != null
          ? `${describirPlazo(cond as CondicionesProveedor)}${cond.forma_pago ? ` · ${etiquetaForma(cond.forma_pago)}` : ""}`
          : "Poner condiciones"}
      </button>
    );
  }

  const etiquetaDia =
    tipo === "dia_semana" ? "Día de la semana" : tipo === "dia_mes" ? "Día del mes" : null;

  return (
    <div className="acciones-fila" style={{ flexWrap: "wrap", gap: 6 }}>
      <select className="celda" value={forma} onChange={(e) => setForma(e.target.value)} aria-label="Forma de pago" autoFocus>
        <option value="">Forma de pago…</option>
        {FORMAS_PAGO.map((f) => (
          <option key={f.valor} value={f.valor}>
            {f.etiqueta}
          </option>
        ))}
        {forma && !FORMAS_PAGO.some((f) => f.valor === forma) && <option value={forma}>{forma}</option>}
      </select>
      <select className="celda" value={tipo} onChange={(e) => setTipo(e.target.value as PlazoTipo)} aria-label="Tipo de plazo">
        <option value="dias">A N días</option>
        <option value="dia_semana">Primer día de la semana tras N días</option>
        <option value="dia_mes">Día del mes tras N días</option>
      </select>
      <label className="secundario" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        N =
        <input
          className="celda dato a-derecha"
          style={{ width: 56 }}
          value={dias}
          onChange={(e) => setDias(e.target.value)}
          inputMode="numeric"
          aria-label="Días de pago"
        />
        días
      </label>
      {etiquetaDia && (
        <label className="secundario" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {etiquetaDia}:
          {tipo === "dia_semana" ? (
            <select className="celda" value={dia} onChange={(e) => setDia(e.target.value)} aria-label="Día de la semana">
              {DIAS_SEMANA.map((n, i) => (
                <option key={n} value={i + 1}>
                  {n}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="celda dato a-derecha"
              style={{ width: 48 }}
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              inputMode="numeric"
              aria-label="Día del mes"
            />
          )}
        </label>
      )}
      <button
        className="boton-enlace"
        disabled={pendiente}
        onClick={() => {
          setError(null);
          setAviso(null);
          iniciar(async () => {
            const r = await guardarCondicionesProveedor({
              proveedorId,
              diasPago: Number(dias),
              formaPago: forma || null,
              iban: null,
              plazoTipo: tipo,
              plazoDia: tipo === "dias" ? null : Number(dia),
            });
            if (r?.error) {
              setError(r.error);
              return;
            }
            if (r?.aviso) setAviso(r.aviso);
            setAbierto(false);
            router.refresh();
          });
        }}
      >
        {pendiente ? "Guardando…" : "Guardar"}
      </button>
      <button className="boton-enlace" onClick={() => setAbierto(false)}>
        Cancelar
      </button>
      {error && <em className="error-campo">{error}</em>}
      {aviso && <em className="secundario">{aviso}</em>}
    </div>
  );
}

function etiquetaForma(valor: string) {
  return FORMAS_PAGO.find((f) => f.valor === valor)?.etiqueta ?? valor;
}
