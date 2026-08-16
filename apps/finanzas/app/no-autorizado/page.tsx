import BotonSalir from "../(app)/boton-salir";

export default function NoAutorizado() {
  return (
    <main className="pantalla-centrada">
      <div className="tarjeta-login">
        <h1>Sin acceso</h1>
        <p className="sub">
          Tu usuario no está vinculado a ninguna cuenta de Hostelero, o esa cuenta no tiene
          contratado el módulo de facturación.
        </p>
        <BotonSalir />
      </div>
    </main>
  );
}
