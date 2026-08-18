"use client";

import { useEffect, useState } from "react";

/**
 * Vigilante de versión para las páginas React de cara al público (/parte,
 * /subir-facturas): el mismo que llevan inyectado los HTML de módulo. Al
 * volver a la página (y cada 10 min) pregunta la versión desplegada; si ha
 * cambiado desde que la página arrancó, pinta la banda de «Actualizar».
 * Nunca recarga solo: el usuario puede estar a media subida.
 */
export default function AvisoVersion() {
  const [hayNueva, setHayNueva] = useState(false);

  useEffect(() => {
    let vInicial: string | null = null;
    let viva = true;

    async function comprobar() {
      try {
        const r = await fetch("/api/publico/version", { cache: "no-store" });
        const d = (await r.json()) as { v: string };
        if (!viva) return;
        if (vInicial === null) vInicial = d.v;
        else if (d.v !== vInicial) setHayNueva(true);
      } catch {
        /* sin red: se reintenta en el siguiente ciclo */
      }
    }

    const alVolver = () => {
      if (!document.hidden) comprobar();
    };
    document.addEventListener("visibilitychange", alVolver);
    const cadencia = setInterval(comprobar, 10 * 60 * 1000);
    comprobar();
    return () => {
      viva = false;
      document.removeEventListener("visibilitychange", alVolver);
      clearInterval(cadencia);
    };
  }, []);

  if (!hayNueva) return null;
  return (
    <div
      onClick={() => location.reload()}
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 99999,
        background: "#0F6E56", color: "#fff", padding: "10px 14px",
        font: "14px system-ui, sans-serif", textAlign: "center",
        cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.25)",
      }}
    >
      🔄 Hay una versión nueva de la app — toca aquí para actualizar
    </div>
  );
}
