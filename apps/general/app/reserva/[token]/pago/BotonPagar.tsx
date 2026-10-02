"use client";

import { useEffect, useState } from "react";

/**
 * Botón que pide al servidor el formulario firmado y lo envía al TPV del banco (POST con
 * campos ocultos). Aquí no hay ni importe ni tarjeta: solo el token de la reserva.
 */
const TXT = {
  es: {
    garantia: "Registrar tarjeta",
    prepago: "Pagar ahora",
    cargando: "Conectando con el banco…",
    errores: {
      no_pendiente: "Esta reserva ya no está pendiente de tarjeta. Recarga la página para ver cómo está.",
      caducada: "El plazo para completar este paso ha terminado.",
      tpv_no_configurado: "El pago con tarjeta no está disponible ahora mismo. Llama al restaurante.",
      generico: "No hemos podido conectar con el banco. Inténtalo de nuevo en unos segundos.",
    },
  },
  en: {
    garantia: "Add card",
    prepago: "Pay now",
    cargando: "Connecting to the bank…",
    errores: {
      no_pendiente: "This booking no longer needs a card. Reload the page to see its status.",
      caducada: "The time to complete this step has run out.",
      tpv_no_configurado: "Card payment is not available right now. Please call the restaurant.",
      generico: "We could not reach the bank. Please try again in a few seconds.",
    },
  },
} as const;

export default function BotonPagar({ token, modo, idioma }: { token: string; modo: "garantia" | "prepago"; idioma: "es" | "en" }) {
  const t = TXT[idioma];
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si el cliente vuelve atrás desde el banco, el navegador puede restaurar la página tal cual
  // (caché de ida y vuelta) con el botón en «Conectando…»: lo reactivamos.
  useEffect(() => {
    const alVolver = (e: PageTransitionEvent) => {
      if (e.persisted) setCargando(false);
    };
    window.addEventListener("pageshow", alVolver);
    return () => window.removeEventListener("pageshow", alVolver);
  }, []);

  async function ir() {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch("/api/publico/reservas/pago/iniciar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, idioma }),
      });
      const j = (await r.json().catch(() => ({}))) as { url?: string; campos?: Record<string, string>; error?: string };
      if (!r.ok || !j.url || !j.campos) {
        const clave = (j.error || "generico") as keyof typeof t.errores;
        setError(t.errores[clave] ?? t.errores.generico);
        setCargando(false);
        return;
      }
      // Formulario POST al TPV: el cliente teclea la tarjeta en la página del banco.
      const form = document.createElement("form");
      form.method = "POST";
      form.action = j.url;
      for (const [k, v] of Object.entries(j.campos)) {
        const inp = document.createElement("input");
        inp.type = "hidden";
        inp.name = k;
        inp.value = v;
        form.appendChild(inp);
      }
      document.body.appendChild(form);
      form.submit();
    } catch {
      setError(t.errores.generico);
      setCargando(false);
    }
  }

  return (
    <>
      {error ? <div className="aviso err" role="alert">{error}</div> : null}
      <button className="btn" type="button" onClick={ir} disabled={cargando}>
        {cargando ? <span className="cargando" aria-hidden /> : null}
        {cargando ? t.cargando : modo === "garantia" ? t.garantia : t.prepago}
      </button>
    </>
  );
}
