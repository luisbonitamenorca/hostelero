import { cerrarSesion } from "../acciones";

export const dynamic = "force-dynamic";

export default function NoAutorizado() {
  return (
    <main className="pantalla-login">
      <div className="caja-login">
        <div style={{ marginBottom: 12 }}>
          <span className="marca">Consola Hostelero</span>
          <span className="etiqueta-interno">Interno</span>
        </div>
        <p style={{ margin: "0 0 16px", color: "var(--gris)" }}>
          Tu usuario existe pero no es operador de Hostelero, así que esta
          consola no te deja pasar. Si crees que deberías tener acceso, habla
          con Luis o con Joan.
        </p>
        <form action={cerrarSesion}>
          <button className="boton" type="submit">Salir</button>
        </form>
      </div>
    </main>
  );
}
