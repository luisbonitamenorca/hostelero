import { exigirFacturacion } from "@/lib/supabase/server";
import { fecha } from "@/lib/importes";
import { clienteRemesas, type Mandato } from "@/lib/remesas";
import FormularioMandato from "./formulario-mandato";
import BotonRevocar from "./boton-revocar";

export const dynamic = "force-dynamic";

export default async function Mandatos() {
  const { supabase } = await exigirFacturacion();

  const [{ data, error }, { data: clientes }] = await Promise.all([
    clienteRemesas(supabase)
      .from("fin_mandatos")
      .select("id, cliente_id, referencia, tipo, fecha_firma, iban, estado, usado")
      .order("fecha_firma", { ascending: false }),
    supabase.from("fin_clientes").select("id, nombre_fiscal").eq("activo", true).order("nombre_fiscal"),
  ]);

  const mandatos = (data ?? []) as Mandato[];
  const nombre = new Map((clientes ?? []).map((c) => [c.id, c.nombre_fiscal]));

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Mandatos SEPA</h1>
        <p className="sub">
          La autorización firmada por el cliente para domiciliarle los recibos. Sin mandato vigente no
          se le puede pasar un cobro — y eso no es una regla nuestra, es la norma.
        </p>
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudieron cargar los mandatos</strong>
          Si acaba de aplicarse la migración F4a, recarga.
        </div>
      )}

      {!error && (
        <>
          <FormularioMandato clientes={clientes ?? []} />

          {mandatos.length === 0 ? (
            <div className="estado-vacio">
              <strong>Aún no hay mandatos</strong>
              Hasta que un cliente firme el suyo, sus facturas se cobran por transferencia, no por
              domiciliación.
            </div>
          ) : (
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Referencia</th>
                    <th>Tipo</th>
                    <th>Firmado</th>
                    <th>IBAN</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {mandatos.map((m) => (
                    <tr key={m.id} className={m.estado === "revocado" ? "fila-inactiva" : undefined}>
                      <td>{nombre.get(m.cliente_id) ?? "—"}</td>
                      <td className="dato">{m.referencia}</td>
                      <td>{m.tipo}</td>
                      <td className="dato">{fecha(m.fecha_firma)}</td>
                      <td className="dato">{m.iban}</td>
                      <td>
                        {m.estado === "revocado" ? (
                          <span className="etiqueta-estado">revocado</span>
                        ) : m.usado ? (
                          "activo"
                        ) : (
                          <>activo <span className="etiqueta-estado">sin usar</span></>
                        )}
                      </td>
                      <td className="a-derecha">
                        {m.estado === "activo" && <BotonRevocar id={m.id} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="pista">
            El primer adeudo de cada mandato viaja marcado como «primero» y los siguientes como
            «recurrente». Eso lo lleva el sistema solo: por eso importa la columna «sin usar».
          </p>
        </>
      )}
    </>
  );
}
