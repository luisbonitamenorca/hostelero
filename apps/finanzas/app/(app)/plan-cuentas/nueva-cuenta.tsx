"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { crearCuenta } from "../../acciones-diario";

/** Sugerencias de las cuentas que hoy faltan y hacen falta para cualquier
 *  asiento. No se siembran en la base a propósito: el plan bueno viene de A3 y
 *  sembrarlo por nuestra cuenta crearía dos verdades. Esto solo ahorra teclear. */
const HABITUALES = [
  { codigo: "570", nombre: "Caja, euros" },
  { codigo: "572", nombre: "Bancos e instituciones de crédito c/c vista, euros" },
  { codigo: "430", nombre: "Clientes" },
  { codigo: "472", nombre: "Hacienda Pública, IVA soportado" },
  { codigo: "477", nombre: "Hacienda Pública, IVA repercutido" },
  { codigo: "600", nombre: "Compras de mercaderías" },
  { codigo: "621", nombre: "Arrendamientos y cánones" },
  { codigo: "628", nombre: "Suministros" },
  { codigo: "640", nombre: "Sueldos y salarios" },
  { codigo: "642", nombre: "Seguridad Social a cargo de la empresa" },
  { codigo: "700", nombre: "Ventas de mercaderías" },
  { codigo: "705", nombre: "Prestaciones de servicios" },
  { codigo: "100", nombre: "Capital social" },
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
