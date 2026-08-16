import Link from "next/link";
import EditorFactura from "../editor";
import { cargarCatalogos } from "../datos";

export const dynamic = "force-dynamic";

export default async function NuevaFactura() {
  const { series, clientes, centros, serieDefecto } = await cargarCatalogos();

  return (
    <>
      <div className="cabecera-pagina">
        <p className="miga">
          <Link className="enlace" href="/facturas">
            Facturas
          </Link>{" "}
          / Nueva
        </p>
        <h1>Nueva factura</h1>
        <p className="sub">
          Nace como borrador: sin número y editable. El número y el registro Verifactu se asignan al
          expedirla.
        </p>
      </div>
      <EditorFactura series={series} clientes={clientes} centros={centros} serieDefecto={serieDefecto} />
    </>
  );
}
