"use client";

import { useRouter } from "next/navigation";
import type { ModoPeriodo } from "@/lib/contabilidad";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * El mismo selector para el diario y para los tres informes: si cada pantalla
 * tuviera el suyo, «marzo» acabaría significando cosas distintas en cada una.
 *
 * El estado va en la URL y no en useState a propósito: así un informe se puede
 * guardar en favoritos o pasar por correo, y al recargar sale lo mismo.
 */
export default function SelectorPeriodo({
  base,
  anio,
  modo,
  sp,
}: {
  base: string;
  anio: number;
  modo: ModoPeriodo;
  sp: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const ahora = new Date();
  const anios = [ahora.getFullYear() + 1, ahora.getFullYear(), ahora.getFullYear() - 1, ahora.getFullYear() - 2];

  function ir(cambios: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const combinado = { anio: String(anio), modo, ...sp, ...cambios };
    for (const [k, v] of Object.entries(combinado)) {
      if (v !== undefined && v !== "") p.set(k, v);
    }
    router.push(`${base}?${p.toString()}`);
  }

  return (
    <div className="acciones-fila">
      <label className="campo">
        <span>Ejercicio</span>
        <select value={anio} onChange={(e) => ir({ anio: e.target.value })}>
          {anios.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>

      <label className="campo">
        <span>Periodo</span>
        <select value={modo} onChange={(e) => ir({ modo: e.target.value })}>
          <option value="anual">Acumulado anual</option>
          <option value="mes">Un mes</option>
          <option value="trimestre">Un trimestre</option>
          <option value="rango">Entre dos fechas</option>
        </select>
      </label>

      {(modo === "mes" || modo === "anual") && (
        <label className="campo">
          <span>{modo === "anual" ? "Hasta el final de" : "Mes"}</span>
          <select value={sp.mes ?? (modo === "anual" ? "12" : "1")} onChange={(e) => ir({ mes: e.target.value })}>
            {MESES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}

      {modo === "trimestre" && (
        <label className="campo">
          <span>Trimestre</span>
          <select value={sp.trimestre ?? "1"} onChange={(e) => ir({ trimestre: e.target.value })}>
            <option value="1">1.º (enero – marzo)</option>
            <option value="2">2.º (abril – junio)</option>
            <option value="3">3.º (julio – septiembre)</option>
            <option value="4">4.º (octubre – diciembre)</option>
          </select>
        </label>
      )}

      {modo === "rango" && (
        <>
          <label className="campo">
            <span>Desde</span>
            <input
              type="date"
              defaultValue={sp.desde ?? `${anio}-01-01`}
              onChange={(e) => ir({ desde: e.target.value })}
            />
          </label>
          <label className="campo">
            <span>Hasta</span>
            <input
              type="date"
              defaultValue={sp.hasta ?? `${anio}-12-31`}
              onChange={(e) => ir({ hasta: e.target.value })}
            />
          </label>
        </>
      )}
    </div>
  );
}
