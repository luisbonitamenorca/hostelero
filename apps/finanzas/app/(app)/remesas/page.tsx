import Link from "next/link";
import { exigirFacturacion } from "@/lib/supabase/server";
import { euros, fecha } from "@/lib/importes";
import { ESTADO_REMESA, type Remesa } from "@/lib/remesas";

export const dynamic = "force-dynamic";

export default async function Remesas() {
  const { supabase } = await exigirFacturacion();
  const { data, error } = await supabase
    .from("fin_remesas")
    .select("id, sentido, banco_cuenta_id, concepto, fecha_ejecucion, estado, total, num_items, creado_en")
    .order("creado_en", { ascending: false })
    .limit(100);

  const remesas = (data ?? []) as Remesa[];

  return (
    <>
      <div className="cabecera-pagina con-accion">
        <div>
          <h1>Remesas</h1>
          <p className="sub">Agrupar vencimientos en un fichero para la banca electrónica</p>
        </div>
        <Link className="boton boton-auto" href="/remesas/nueva">Nueva remesa</Link>
      </div>

      <div className="aviso-banda">
        <strong>Antes de subir la primera al banco:</strong> pídeles que validen un fichero de
        prueba. La versión exacta de esquema que acepta cada entidad es un dato suyo, y un fichero
        de adeudos mal formado no da un error — carga importes a clientes reales.
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudieron cargar las remesas</strong>
          Si acaba de aplicarse la migración F4a, recarga.
        </div>
      )}

      {!error && remesas.length === 0 && (
        <div className="estado-vacio">
          <strong>Aún no hay remesas</strong>
          Se montan desde los vencimientos pendientes de Cartera.
        </div>
      )}

      {!error && remesas.length > 0 && (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Creada</th>
                <th>Tipo</th>
                <th>Concepto</th>
                <th>Fecha de cargo</th>
                <th className="a-derecha">Líneas</th>
                <th className="a-derecha">Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {remesas.map((r) => (
                <tr key={r.id} className={r.estado === "anulada" ? "fila-inactiva" : undefined}>
                  <td className="dato">{fecha(r.creado_en)}</td>
                  <td>{r.sentido === "cobro" ? "Cobro" : "Pago"}</td>
                  <td>
                    <Link className="enlace" href={`/remesas/${r.id}`}>
                      {r.concepto ?? "(sin concepto)"}
                    </Link>
                  </td>
                  <td className="dato">{fecha(r.fecha_ejecucion)}</td>
                  <td className="numero">{r.num_items}</td>
                  <td className="numero">{euros(Number(r.total))}</td>
                  <td>{ESTADO_REMESA[r.estado] ?? r.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
