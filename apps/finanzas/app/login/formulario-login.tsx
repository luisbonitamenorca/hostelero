"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { iniciarSesion, type EstadoAccion } from "../acciones";

export default function FormularioLogin() {
  const router = useRouter();
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(iniciarSesion, null);

  useEffect(() => {
    // Navega el cliente, no la acción: router.push añade el prefijo /finanzas
    // él solo y sin duplicarlo (ver lib/rutas.ts).
    if (estado?.ok && estado.ir) router.push(estado.ir);
  }, [estado, router]);

  return (
    <form className="tarjeta-login" action={accion}>
      <h1>Hostelero · Finanzas</h1>
      <p className="sub">Entra con tu usuario de Hostelero</p>

      <label className="campo">
        <span>Correo</span>
        <input name="correo" type="email" autoComplete="email" required />
      </label>
      <label className="campo">
        <span>Contraseña</span>
        <input name="clave" type="password" autoComplete="current-password" required />
      </label>

      <button className="boton" type="submit" disabled={pendiente || estado?.ok}>
        {pendiente ? "Entrando…" : estado?.ok ? "Entrando…" : "Entrar"}
      </button>

      {estado?.error && <p className="error-texto">{estado.error}</p>}

      <div className="pie-formulario">
        <Link className="enlace" href="/recuperar">
          He olvidado la contraseña
        </Link>
      </div>
    </form>
  );
}
