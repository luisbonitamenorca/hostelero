"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { crearClienteNavegador } from "@/lib/supabase/cliente";

// El enlace del correo llega con el token en el hash (#access_token=…&type=recovery)
// porque el cliente usa el flujo implícito. supabase-js lo detecta solo al cargar
// la página y abre sesión; aquí solo esperamos a que eso ocurra y damos un
// mensaje claro cuando el enlace ya no vale.

type Estado = "verificando" | "listo" | "enlace-invalido" | "guardando" | "guardado";

const MINIMO = 8;

function motivoLegible(codigo: string | null, descripcion: string | null): string {
  if (codigo === "otp_expired") return "El enlace ha caducado. Pide uno nuevo.";
  if (codigo === "access_denied") return "El enlace ya se ha usado o no es válido. Pide uno nuevo.";
  if (descripcion) return descripcion.replace(/\+/g, " ");
  return "El enlace no es válido o ha caducado. Pide uno nuevo.";
}

export default function NuevaClave() {
  const [supabase] = useState(crearClienteNavegador);
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>("verificando");
  const [motivo, setMotivo] = useState<string | null>(null);
  const [clave, setClave] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);

    const codigoError = hash.get("error_code") ?? query.get("error_code");
    const descError = hash.get("error_description") ?? query.get("error_description");
    if (codigoError || descError) {
      setMotivo(motivoLegible(codigoError, descError));
      setEstado("enlace-invalido");
      return;
    }

    const traeToken = hash.has("access_token") || query.has("code");

    function abierta() {
      setEstado((e) => (e === "verificando" ? "listo" : e));
      // Fuera el token de la barra de direcciones en cuanto ya no hace falta.
      window.history.replaceState({}, "", "/nueva-clave");
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_evento, sesion) => {
      if (sesion) abierta();
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        abierta();
        return;
      }
      if (!traeToken) {
        setMotivo("Abre esta pantalla desde el enlace que te hemos enviado por correo.");
        setEstado("enlace-invalido");
      }
    });

    // Si trae token pero la sesión no llega, el enlace no sirve.
    const espera = setTimeout(() => {
      setEstado((e) => {
        if (e !== "verificando") return e;
        setMotivo("No hemos podido validar el enlace. Pide uno nuevo.");
        return "enlace-invalido";
      });
    }, 5000);

    return () => {
      clearTimeout(espera);
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  async function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (clave.length < MINIMO) {
      setError(`La contraseña debe tener al menos ${MINIMO} caracteres.`);
      return;
    }
    if (clave !== repetida) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }

    setEstado("guardando");
    const { error: err } = await supabase.auth.updateUser({ password: clave });
    if (err) {
      setEstado("listo");
      setError(
        /should be different|same as the old/i.test(err.message)
          ? "La contraseña nueva debe ser distinta de la anterior."
          : `No se pudo cambiar la contraseña: ${err.message}`,
      );
      return;
    }

    setEstado("guardado");
    setTimeout(() => router.replace("/panel"), 1200);
  }

  if (estado === "verificando") {
    return (
      <main className="pantalla-centrada">
        <p className="texto-suave">Comprobando el enlace…</p>
      </main>
    );
  }

  if (estado === "enlace-invalido") {
    return (
      <main className="pantalla-centrada">
        <div className="tarjeta-login">
          <h1>Enlace no válido</h1>
          <p className="sub">{motivo}</p>
          <div className="pie-formulario">
            <Link className="enlace" href="/recuperar">
              Pedir otro enlace
            </Link>
            <Link className="enlace" href="/login">
              Volver a entrar
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (estado === "guardado") {
    return (
      <main className="pantalla-centrada">
        <div className="tarjeta-login">
          <h1>Contraseña cambiada</h1>
          <p className="sub">Entrando…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="pantalla-centrada">
      <form className="tarjeta-login" onSubmit={guardar}>
        <h1>Nueva contraseña</h1>
        <p className="sub">Al guardarla entrarás directamente.</p>
        <label className="campo">
          <span>Contraseña nueva</span>
          <input
            type="password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            autoComplete="new-password"
            minLength={MINIMO}
            required
            autoFocus
          />
          <em className="pista">Mínimo {MINIMO} caracteres.</em>
        </label>
        <label className="campo">
          <span>Repítela</span>
          <input
            type="password"
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        <button className="boton" type="submit" disabled={estado === "guardando"}>
          {estado === "guardando" ? "Guardando…" : "Guardar y entrar"}
        </button>
        {error && <p className="error-texto">{error}</p>}
      </form>
    </main>
  );
}
