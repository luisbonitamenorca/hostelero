import Link from "next/link";
import { exigirFacturacion } from "@/lib/supabase/server";
import { euros, fecha } from "@/lib/importes";

export const dynamic = "force-dynamic";

export default async function Facturas() {
  const { supabase } = await exigirFacturacion();

  const { data, error } = await supabase
    .from("fin_facturas")
    .select(
      "id, numero_completo, tipo, estado, fecha_expedicion, fecha_operacion, total, estado_cobro, fin_clientes(nombre_fiscal)",
    )
    .order("creado_en", { ascending: false })
    .limit(100);

  const filas = data ?? [];

  return (
    <>
      <div className="cabecera-pagina con-accion">
        <div>
          <h1>Facturas</h1>
          <p className="sub">Facturas emitidas por la sociedad</p>
        </div>
        <Link className="boton boton-auto" href="/facturas/nueva">
          Nueva factura
        </Link>
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudieron cargar las facturas</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && filas.length === 0 && (
        <div className="estado-vacio">
          <strong>Aún no hay facturas</strong>
          Empieza por un borrador. La expedición con número y registro Verifactu llega en el siguiente
          paso.
        </div>
      )}

      {!error && filas.length > 0 && (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Número</th>
                <th>Cliente</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th className="a-derecha">Total</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const cliente = Array.isArray(f.fin_clientes) ? f.fin_clientes[0] : f.fin_clientes;
                return (
                  <tr key={f.id}>
                    <td className="dato">
                      <Link className="enlace" href={`/facturas/${f.id}`}>
                        {f.estado === "borrador" ? "borrador" : (f.numero_completo ?? "—")}
                      </Link>
                    </td>
                    <td>{cliente?.nombre_fiscal ?? "—"}</td>
                    <td>{f.tipo}</td>
                    <td>
                      {f.estado === "borrador" && <span className="etiqueta-estado">borrador</span>}
                      {f.estado === "expedida" && "expedida"}
                      {f.estado === "anulada" && <span className="etiqueta-estado">anulada</span>}
                    </td>
                    <td className="dato">{fecha(f.fecha_expedicion ?? f.fecha_operacion)}</td>
                    <td className="numero">{euros(Number(f.total))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
