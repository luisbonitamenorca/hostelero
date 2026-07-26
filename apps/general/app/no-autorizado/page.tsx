import { cerrarSesion } from "../acciones";

export const dynamic = "force-dynamic";

export default function NoAutorizado() {
  return (
    <main className="pantalla-login">
      <div className="caja-login">
        <div style={{ marginBottom: 12 }}>
          <span className="marca" style={{ color: "var(--verde)" }}>Hostelero</span>
        </div>
        <p style={{ margin: "0 0 16px", color: "var(--gris)" }}>
          Tu usuario existe pero no está vinculado a ninguna empresa. Pide a tu
          administrador que te dé de alta, o escribe a soporte de Hostelero.
        </p>
        <form action={cerrarSesion}>
          <button className="boton" type="submit" style={{ background: "var(--verde)" }}>
            Salir
          </button>
        </form>
      </div>
    </main>
  );
}
