import { iniciarSesion } from "../acciones";

export const dynamic = "force-dynamic";

const MENSAJES: Record<string, string> = {
  datos: "Escribe el correo y la contraseña.",
  credenciales: "Correo o contraseña incorrectos.",
};

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="pantalla-login">
      <div className="caja-login">
        <div style={{ marginBottom: 20 }}>
          <span className="marca">Consola Hostelero</span>
          <span className="etiqueta-interno">Interno</span>
        </div>

        {error && MENSAJES[error] && (
          <p className="aviso-error">{MENSAJES[error]}</p>
        )}

        <form action={iniciarSesion} className="formulario" style={{ padding: 0 }}>
          <div className="campo">
            <label htmlFor="correo">Correo</label>
            <input
              id="correo"
              name="correo"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <div className="campo">
            <label htmlFor="clave">Contraseña</label>
            <input
              id="clave"
              name="clave"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <button className="boton" type="submit">
            Entrar
          </button>
        </form>
      </div>
    </main>
  );
}
