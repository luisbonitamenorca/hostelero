"use client";

import { useRouter } from "next/navigation";
import type { Vista } from "@/lib/contabilidad";

/**
 * Selector del balance y la PyG: aquí no se elige «un mes», se elige la FORMA
 * del informe — todo junto, una columna por trimestre o una columna por mes.
 * Sumas y saldos conserva el selector clásico de un solo tramo.
 *
 * El estado va en la URL y no en useState a propósito: así un informe se puede
 * guardar en favoritos o pasar por correo, y al recargar sale lo mismo.
 */
export default function SelectorVista({
  base,
  anio,
  vista,
  sp,
  /** Solo lo pasa la PyG: filtrar por centro un balance no significa nada. */
  centros,
}: {
  base: string;
  anio: number;
  vista: Vista;
  sp: Record<string, string | undefined>;
  centros?: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const ahora = new Date();
  const anios = [ahora.getFullYear() + 1, ahora.getFullYear(), ahora.getFullYear() - 1, ahora.getFullYear() - 2];

  function ir(cambios: Record<string, string | undefined>) {
    const p = new URLSearchParams();
    const combinado = { anio: String(anio), vista, ...sp, ...cambios };
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
        <span>Vista</span>
        <select value={vista} onChange={(e) => ir({ vista: e.target.value })}>
          <option value="anual">Anual (todo junto)</option>
          <option value="trimestres">Por trimestres</option>
          <option value="meses">Por meses</option>
          <option value="rango">Entre dos fechas</option>
        </select>
      </label>

      {centros && centros.length > 0 && (
        <label className="campo">
          <span>Centro</span>
          <select value={sp.centro ?? ""} onChange={(e) => ir({ centro: e.target.value })}>
            <option value="">Todos</option>
            {centros.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
      )}

      {vista === "rango" && (
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
