"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { guardarAjustes } from "../../acciones-proveedores";
import type { EstadoAccion } from "../../acciones";
import { COLUMNAS_PROVEEDOR } from "@/lib/proveedores";

export default function FormularioAjustes({ columnas }: { columnas: string[] }) {
  const router = useRouter();
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(guardarAjustes, null);

  useEffect(() => {
    if (estado?.ok && estado.ir) {
      router.push(estado.ir);
      router.refresh();
    }
  }, [estado, router]);

  const activas = new Set(columnas);

  return (
    <form className="formulario" action={accion}>
      <fieldset className="bloque">
        <legend>Listado de proveedores · columnas</legend>
        <p className="pista" style={{ marginBottom: 12 }}>
          El nombre sale siempre. Marca el resto de columnas que quieres ver en el listado; el detalle
          completo está en la ficha de cada proveedor.
        </p>
        <div className="rejilla">
          {COLUMNAS_PROVEEDOR.map((c) => (
            <label key={c.clave} className="casilla ancho-2" style={{ gridColumn: "span 2" }}>
              <input type="checkbox" name={`col_${c.clave}`} defaultChecked={activas.has(c.clave)} />
              <span>
                {c.etiqueta}{" "}
                <em className="pista" style={{ display: "inline" }}>
                  · {c.origen === "compras" ? "maestro de Compras" : c.origen === "finanzas" ? "ficha de Contabilidad" : "calculado"}
                </em>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {estado?.error && <p className="error-texto">{estado.error}</p>}

      <div className="acciones">
        <button className="boton boton-auto" type="submit" disabled={pendiente || estado?.ok}>
          {pendiente || estado?.ok ? "Guardando…" : "Guardar ajustes"}
        </button>
      </div>
    </form>
  );
}
