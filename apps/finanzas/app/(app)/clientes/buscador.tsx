"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/** La búsqueda vive en la URL: se puede compartir y sobrevive a recargar. */
export default function Buscador({
  q,
  soloActivos,
  sinFiltroActivos = false,
  etiqueta = "Buscar por nombre, NIF, correo o municipio…",
}: {
  q: string;
  soloActivos: boolean;
  /** Hay listados (proveedores, recibidas) que no tienen concepto de "activo". */
  sinFiltroActivos?: boolean;
  etiqueta?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [texto, setTexto] = useState(q);
  const [activos, setActivos] = useState(soloActivos);

  useEffect(() => {
    // Se espera a que pare de teclear para no navegar por cada letra.
    const t = setTimeout(() => {
      const p = new URLSearchParams();
      if (texto.trim()) p.set("q", texto.trim());
      if (!sinFiltroActivos && !activos) p.set("todos", "1");
      const destino = p.toString() ? `${pathname}?${p}` : pathname;
      router.replace(destino, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
  }, [texto, activos, sinFiltroActivos, pathname, router]);

  return (
    <div className="barra-filtros">
      <input
        className="buscador"
        type="search"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={etiqueta}
        aria-label="Buscar clientes"
      />
      {!sinFiltroActivos && (
        <label className="casilla">
          <input type="checkbox" checked={activos} onChange={(e) => setActivos(e.target.checked)} />
          <span>Solo activos</span>
        </label>
      )}
    </div>
  );
}
