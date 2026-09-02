import { exigirFacturacion } from "@/lib/supabase/server";
import { ruta } from "@/lib/rutas";
import { type CuentaBancaria } from "@/lib/remesas";
import FormularioCuenta from "./formulario-cuenta";

export const dynamic = "force-dynamic";

export default async function Bancos() {
  const { supabase } = await exigirFacturacion();
  const { data, error } = await supabase
    .from("fin_bancos_cuentas")
    .select("id, nombre, iban, bic, activa, sociedad_id")
    .order("nombre");

  const cuentas = (data ?? []) as CuentaBancaria[];

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Cuentas bancarias</h1>
        <p className="sub">Las cuentas desde las que se cobra y se paga. Sin al menos una no hay remesas.</p>
      </div>

      <div style={{ marginBottom: 14 }}>
        <a className="boton" href={ruta(`/bancos/todos/conciliacion`)}>
          Conciliación de todos los bancos
        </a>
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudieron cargar las cuentas</strong>
          Si acaba de aplicarse la migración F4a, recarga.
        </div>
      )}

      {!error && (
        <>
          <FormularioCuenta />

          {cuentas.length === 0 ? (
            <div className="estado-vacio">
              <strong>Aún no hay ninguna cuenta</strong>
              Da de alta la cuenta operativa desde la que se domicilian los recibos y se pagan las
              facturas.
            </div>
          ) : (
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>IBAN</th>
                    <th>BIC</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {cuentas.map((c) => (
                    <tr key={c.id} className={c.activa ? undefined : "fila-inactiva"}>
                      <td>{c.nombre}</td>
                      <td className="dato">{c.iban}</td>
                      <td className="dato">{c.bic ?? "—"}</td>
                      <td>{c.activa ? "activa" : <span className="etiqueta-estado">inactiva</span>}</td>
                      <td>
                        <a className="boton-secundario" style={{ padding: "4px 10px", fontSize: 13 }} href={ruta(`/bancos/${c.id}/conciliacion`)}>
                          Conciliación
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
