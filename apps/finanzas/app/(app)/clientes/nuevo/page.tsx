import Link from "next/link";
import FormularioCliente from "../formulario";

export default function NuevoCliente() {
  return (
    <>
      <div className="cabecera-pagina">
        <p className="miga">
          <Link className="enlace" href="/clientes">
            Clientes
          </Link>{" "}
          / Nuevo
        </p>
        <h1>Nuevo cliente</h1>
        <p className="sub">Los datos fiscales se congelan en cada factura que se le expida.</p>
      </div>
      <FormularioCliente />
    </>
  );
}
