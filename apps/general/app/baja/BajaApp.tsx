"use client";

import { useState } from "react";

/** Confirmación de baja de comunicaciones por email. Llega con ?e=<email>&t=<token>. */
export default function BajaApp({ email, token }: { email: string; token: string }) {
  const [estado, setEstado] = useState<"pendiente" | "enviando" | "hecho" | "error">(
    email && token ? "pendiente" : "error",
  );

  async function confirmar() {
    setEstado("enviando");
    try {
      const r = await fetch("/api/publico/crm/baja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token }),
      });
      const j = await r.json();
      setEstado(j.ok ? "hecho" : "error");
    } catch {
      setEstado("error");
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#F3F4F0", color: "#242D36", fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "min(420px,100%)", background: "#fff", border: "1px solid #DEDFE1", borderRadius: 12, padding: "28px 26px", textAlign: "center", boxShadow: "0 4px 14px rgba(34,48,58,.05)" }}>
        <h1 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 24, margin: "0 0 6px" }}>Bonita Menorca</h1>
        {estado === "pendiente" ? (
          <>
            <p style={{ color: "#5C6872", fontSize: 14 }}>
              ¿Quieres dejar de recibir nuestras comunicaciones por email en <b>{email}</b>?
            </p>
            <button
              onClick={confirmar}
              style={{ background: "#C75146", color: "#fff", border: 0, borderRadius: 8, padding: "12px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 10 }}
            >
              Sí, darme de baja
            </button>
            <p style={{ color: "#5C6872", fontSize: 12, marginTop: 14 }}>
              Solo afecta a los emails de noticias y ofertas; seguirás recibiendo las confirmaciones de tus reservas.
            </p>
          </>
        ) : estado === "enviando" ? (
          <p style={{ color: "#5C6872" }}>Un momento…</p>
        ) : estado === "hecho" ? (
          <>
            <p style={{ fontSize: 34, margin: "6px 0" }}>✓</p>
            <p style={{ color: "#242D36", fontWeight: 600 }}>Baja completada.</p>
            <p style={{ color: "#5C6872", fontSize: 13 }}>No volverás a recibir nuestras noticias por email. Sentimos verte marchar.</p>
          </>
        ) : (
          <p style={{ color: "#C75146", fontSize: 14 }}>
            El enlace no es válido o ha caducado. Escríbenos y te damos de baja a mano.
          </p>
        )}
      </div>
    </div>
  );
}
