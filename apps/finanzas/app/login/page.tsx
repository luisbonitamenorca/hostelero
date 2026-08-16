import Link from "next/link";
import { iniciarSesion } from "../acciones";

export const dynamic = "force-dynamic";

const MENSAJES: Record<string, string> = {
  datos: "Escribe el correo y la contraseña.",
  credenciales: "No se pudo iniciar sesión. Revisa el correo y la contraseña.",
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="pantalla-centrada">
      <form className="tarjeta-login" action={iniciarSesion}>
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

        <button className="boton" type="submit">
          Entrar
        </button>

        {error && MENSAJES[error] && <p className="error-texto">{MENSAJES[error]}</p>}

        <div className="pie-formulario">
          <Link className="enlace" href="/recuperar">
            He olvidado la contraseña
          </Link>
        </div>
      </form>
    </main>
  );
}
