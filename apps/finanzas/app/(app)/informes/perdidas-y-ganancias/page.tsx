import { Fragment } from "react";
import { euros } from "@/lib/importes";
import { perdidasYGanancias, type BloquePyG } from "@/lib/contabilidad";
import { cargarSaldos } from "../datos";
import SelectorPeriodo from "../selector-periodo";
import SinDiario from "../sin-diario";

export const dynamic = "force-dynamic";

function Bloques({ titulo, bloques, total }: { titulo: string; bloques: BloquePyG[]; total: number }) {
  return (
    <div className="tabla-envoltura">
      <table className="tabla">
        <thead>
          <tr>
            <th>{titulo}</th>
            <th className="dato">Importe</th>
          </tr>
        </thead>
        <tbody>
          {bloques.length === 0 && (
            <tr>
              <td colSpan={2} className="texto-suave">
                Sin movimiento en el periodo
              </td>
            </tr>
          )}
          {bloques.map((b) => (
            <Fragment key={b.subgrupo}>
              <tr>
                <td colSpan={2}>
                  <strong>
                    {b.subgrupo} · {b.titulo}
                  </strong>
                </td>
              </tr>
              {b.lineas.map((l) => (
                <tr key={l.codigo}>
                  <td className="dato">
                    {l.codigo} <span className="texto-suave">{l.nombre}</span>
                  </td>
                  <td className="dato">{l.importe < 0 ? `(${euros(-l.importe)})` : euros(l.importe)}</td>
                </tr>
              ))}
              <tr>
                <td className="dato">
                  <em>Total {b.titulo.toLowerCase()}</em>
                </td>
                <td className="dato">
                  <em>{euros(b.total)}</em>
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>
              <strong>Total {titulo.toLowerCase()}</strong>
            </td>
            <td className="dato">
              <strong>{euros(total)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default async function PerdidasYGanancias({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { anio, modo, periodo, filasDelCentro, centros, centroPedido, error, hayApuntes } =
    await cargarSaldos(sp);
  const pyg = perdidasYGanancias(filasDelCentro);
  const nombreCentro = centros.find((c) => c.id === centroPedido)?.nombre;

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Pérdidas y ganancias</h1>
        {/* Al revés que el balance: aquí SÍ manda el tramo, no el acumulado.
            La PyG de marzo es lo que pasó en marzo. */}
        <p className="sub">
          {periodo.titulo} · solo el movimiento del periodo
          {nombreCentro ? ` · ${nombreCentro}` : " · todos los centros"}
        </p>
      </div>

      <div className="barra-filtros">
        <SelectorPeriodo
          base="/informes/perdidas-y-ganancias"
          anio={anio}
          modo={modo}
          sp={sp}
          centros={centros}
        />
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudo calcular la cuenta de resultados</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && !hayApuntes && <SinDiario />}

      {!error && hayApuntes && (
        <>
          <div className="rejilla">
            <Bloques titulo="Ingresos" bloques={pyg.ingresos} total={pyg.totalIngresos} />
            <Bloques titulo="Gastos" bloques={pyg.gastos} total={pyg.totalGastos} />
          </div>

          <div className="totales">
            <div>
              <span>Ingresos</span>
              <strong>{euros(pyg.totalIngresos)}</strong>
            </div>
            <div>
              <span>Gastos</span>
              <strong>{euros(pyg.totalGastos)}</strong>
            </div>
            <div>
              <span>Resultado</span>
              <strong className={pyg.resultado < 0 ? "error-texto" : undefined}>
                {euros(pyg.resultado)}
              </strong>
            </div>
          </div>

          <p className="pista">
            Agrupado por subgrupo contable, que es como se mira el negocio. No es el
            modelo oficial de cuentas anuales: ese lleva epígrafes normalizados y hace
            falta un mapa cuenta→epígrafe que decide la asesoría.
            {nombreCentro && (
              <>
                {" "}
                <strong>
                  Al filtrar por un centro quedan fuera los apuntes sin centro
                </strong>{" "}
                — los gastos de estructura, sobre todo —, así que la suma de los centros
                no tiene por qué dar el resultado de la empresa. Ese sale con «Todos».
              </>
            )}
          </p>
        </>
      )}
    </>
  );
}
