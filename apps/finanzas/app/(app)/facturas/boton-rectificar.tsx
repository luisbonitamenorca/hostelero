"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CAUSAS_RECTIFICACION, crearRectificativa } from "../../acciones";

export default function BotonRectificar({ id, numero }: { id: string; numero: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState("R1");
  const [forma, setForma] = useState<"S" | "I">("I");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!abierto) {
    return (
      <button className="boton boton-auto" onClick={() => setAbierto(true)}>
        Rectificar
      </button>
    );
  }

  return (
    <fieldset className="bloque" style={{ marginTop: 16 }}>
      <legend>Rectificar {numero}</legend>
      <p className="pista">
        La original no se toca: sigue siendo válida y con su número. La rectificativa es una factura
        nueva, con su propio número, que dice qué corrige y por qué.
      </p>

      <div className="rejilla" style={{ marginTop: 12 }}>
        <label className="campo ancho-2">
          <span>Causa (la clasificación es de la AEAT)</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {CAUSAS_RECTIFICACION.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.codigo} · {c.texto}
              </option>
            ))}
          </select>
        </label>

        <label className="campo ancho-2">
          <span>Forma de rectificar</span>
          <select value={forma} onChange={(e) => setForma(e.target.value as "S" | "I")}>
            <option value="I">Por diferencias · solo el ajuste</option>
            <option value="S">Por sustitución · la factura correcta entera</option>
          </select>
          <em className="pista">
            {forma === "I"
              ? "Se crea sin líneas: escribes solo la diferencia, normalmente en negativo."
              : "Se copian las líneas de la original para que las corrijas. Sustituye a la anterior."}
          </em>
        </label>

        <label className="campo ancho-4">
          <span>Motivo *</span>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Qué estaba mal y qué se corrige"
            autoFocus
          />
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
              const r = await crearRectificativa({
                facturaId: id,
                tipo,
                tipoRectificativa: forma,
                motivo,
              });
              if (r?.error) {
                setError(r.error);
                return;
              }
              if (r?.ir) {
                router.push(r.ir);
                router.refresh();
              }
            });
          }}
        >
          {pendiente ? "Creando…" : "Crear borrador de rectificativa"}
        </button>
        <button className="boton-secundario" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </fieldset>
  );
}
