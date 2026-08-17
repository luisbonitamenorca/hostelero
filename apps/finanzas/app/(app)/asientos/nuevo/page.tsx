import Link from "next/link";
import { cargarCuentas } from "../datos";
import EditorAsiento from "../editor-asiento";

export const dynamic = "force-dynamic";

export default async function AsientoNuevo() {
  const { cuentas, centros, error } = await cargarCuentas();

  return (
    <>
      <div className="cabecera-pagina">
        <p className="miga">
          <Link className="enlace" href="/asientos">
            ← Diario
          </Link>
        </p>
        <h1>Asiento nuevo</h1>
        <p className="sub">Se guarda como borrador; al confirmarlo recibe número y ya no se toca.</p>
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudo cargar el plan de cuentas</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      <EditorAsiento cuentas={cuentas} centros={centros} />
    </>
  );
}
