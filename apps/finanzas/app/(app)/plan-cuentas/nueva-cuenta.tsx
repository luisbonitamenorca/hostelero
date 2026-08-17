"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crearCuenta } from "../../acciones-diario";

/** Con el plan de A3 cargado (17-08-2026) todas estas existen y la lista se
 *  autooculta. Se queda por si algún día se borra o desactiva una básica: el
 *  hueco reaparece solo. Códigos de 9 dígitos, como el plan. */
const HABITUALES = [
  { codigo: "570000000", nombre: "Caja, euros" },
  { codigo: "572000000", nombre: "Bancos c/c vista, euros" },
  { codigo: "430000000", nombre: "Clientes" },
  { codigo: "472000021", nombre: "Hacienda Pública, IVA soportado 21%" },
  { codigo: "477000021", nombre: "Hacienda Pública, IVA repercutido 21%" },
  { codigo: "600000000", nombre: "Compras de mercaderías" },
  { codigo: "621000000", nombre: "Alquiler" },
  { codigo: "640000000", nombre: "Salarios" },
  { codigo: "642000000", nombre: "Seguridad Social" },
  { codigo: "700000000", nombre: "Ventas" },
];

export default function NuevaCuenta({ existentes }: { existentes: string[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const yaEstan = new Set(existentes);
  const sugerencias = HABITUALES.filter((h) => !yaEstan.has(h.codigo));

  function guardar() {
    setError(null);
    iniciar(async () => {
      const resultado = await crearCuenta({ codigo, nombre });
      if (resultado?.error) {
        setError(resultado.error);
        return;
      }
      setCodigo("");
      setNombre("");
      router.refresh();
    });
  }

  if (!abierto) {
    return (
      <button type="button" className="boton" onClick={() => setAbierto(true)}>
        Cuenta nueva
      </button>
    );
  }

  return (
    <div className="tarjeta">
      <div className="rejilla">
        <label className="campo">
          <span>Código</span>
          <input
            type="text"
            inputMode="numeric"
            value={codigo}
            placeholder="572"
            onChange={(e) => setCodigo(e.target.value)}
          />
        </label>
        <label className="campo ancho-2">
          <span>Nombre</span>
          <input
            type="text"
            value={nombre}
            placeholder="Bancos c/c vista, euros"
            onChange={(e) => setNombre(e.target.value)}
          />
        </label>
      </div>

      {sugerencias.length > 0 && (
        <p className="pista">
          Habituales que aún no tienes:{" "}
          {sugerencias.map((s, i) => (
            <span key={s.codigo}>
              {i > 0 && " · "}
              <button
                type="button"
                className="boton-enlace"
                onClick={() => {
                  setCodigo(s.codigo);
                  setNombre(s.nombre);
                }}
              >
                {s.codigo}
              </button>
            </span>
          ))}
        </p>
      )}

      {error && <p className="error-texto">{error}</p>}

      <div className="pie-formulario">
        <button type="button" className="boton" disabled={pendiente} onClick={guardar}>
          {pendiente ? "Guardando…" : "Crear cuenta"}
        </button>
        <button type="button" className="boton-fantasma" onClick={() => setAbierto(false)}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
