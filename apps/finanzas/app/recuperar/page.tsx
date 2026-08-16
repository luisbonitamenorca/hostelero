"use client";

import { useState } from "react";
import Link from "next/link";
import { crearClienteNavegador } from "@/lib/supabase/cliente";

type Estado = "formulario" | "enviando" | "enviado" | "demasiados";

export default function Recuperar() {
  const [supabase] = useState(crearClienteNavegador);
  const [correo, setCorreo] = useState("");
  const [estado, setEstado] = useState<Estado>("formulario");

  async function pedir(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEstado("enviando");

    const { error } = await supabase.auth.resetPasswordForEmail(correo.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/nueva-clave`,
    });

    // A propósito no se distingue "correo desconocido" de "correo enviado": decirlo
    // permitiría averiguar desde fuera qué direcciones tienen cuenta. La única
    // excepción es el límite de envíos, porque ahí el usuario sí puede actuar.
    if (error && (error.status === 429 || /rate limit/i.test(error.message))) {
      setEstado("demasiados");
      return;
    }
    setEstado("enviado");
  }

  if (estado === "enviado") {
    return (
      <main className="pantalla-centrada">
        <div className="tarjeta-login">
          <h1>Revisa tu correo</h1>
          <p className="sub">
            Si <strong>{correo.trim().toLowerCase()}</strong> tiene cuenta en Hostelero, le hemos
            enviado un enlace para poner una contraseña nueva. Caduca en una hora y solo sirve una vez.
          </p>
          <p className="pista">
            ¿No llega? Mira en correo no deseado. El remitente es el de Supabase, no una dirección de
            Bonita.
          </p>
          <div className="pie-formulario">
            <Link className="enlace" href="/login">
              Volver a entrar
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="pantalla-centrada">
      <form className="tarjeta-login" onSubmit={pedir}>
        <h1>Recuperar contraseña</h1>
        <p className="sub">Te enviamos un enlace para ponerte una nueva.</p>
        <label className="campo">
          <span>Correo</span>
          <input
            type="email"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            autoComplete="email"
            required
            autoFocus
          />
        </label>
        <button className="boton" type="submit" disabled={estado === "enviando"}>
          {estado === "enviando" ? "Enviando…" : "Enviar enlace"}
        </button>
        {estado === "demasiados" && (
          <p className="error-texto">
            Se han pedido demasiados correos seguidos. Espera unos minutos y vuelve a intentarlo.
          </p>
        )}
        <div className="pie-formulario">
          <Link className="enlace" href="/login">
            Volver a entrar
          </Link>
        </div>
      </form>
    </main>
  );
}
