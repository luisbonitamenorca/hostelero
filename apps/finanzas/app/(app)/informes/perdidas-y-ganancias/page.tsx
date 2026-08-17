import { Fragment } from "react";
import { euros, redondear } from "@/lib/importes";
import { pygEnColumnas, type BloqueColumnas } from "@/lib/contabilidad";
import { cargarApuntes } from "../datos";
import SelectorVista from "../selector-vista";
import DescargarExcel, { type CeldaExcel } from "../descargar-excel";
import SinDiario from "../sin-diario";

export const dynamic = "force-dynamic";

/** Celda de importe: el cero no se pinta — doce columnas de 0,00 € no se leen. */
function Importe({ v }: { v: number }) {
  return <td className="dato">{v === 0 ? "" : v < 0 ? `(${euros(-v)})` : euros(v)}</td>;
}

const totalFila = (importes: number[]) => redondear(importes.reduce((s, x) => s + x, 0));

function Seccion({
  titulo,
  bloques,
  totales,
  conTotal,
}: {
  titulo: string;
  bloques: BloqueColumnas[];
  totales: number[];
  conTotal: boolean;
}) {
  const nCols = totales.length + (conTotal ? 1 : 0) + 1;
  return (
    <>
      <tr className="fila-seccion">
        <td colSpan={nCols}>
          <strong>{titulo}</strong>
        </td>
      </tr>
      {bloques.length === 0 && (
        <tr>
          <td colSpan={nCols} className="texto-suave">
            Sin movimiento en el periodo
          </td>
        </tr>
      )}
      {bloques.map((b) => (
        <Fragment key={b.clave}>
          {b.filas.map((f) => (
            <tr key={f.codigo}>
              <td>
                {f.codigo} <span className="texto-suave">{f.nombre}</span>
              </td>
              {f.importes.map((v, i) => (
                <Importe key={i} v={v} />
              ))}
              {conTotal && <Importe v={totalFila(f.importes)} />}
            </tr>
          ))}
          <tr className="fila-subtotal">
            <td>
              <em>
                {b.clave} · {b.titulo}
              </em>
            </td>
            {b.totales.map((v, i) => (
              <td key={i} className="dato">
                <em>{v === 0 ? "" : euros(v)}</em>
              </td>
            ))}
            {conTotal && (
              <td className="dato">
                <em>{euros(totalFila(b.totales))}</em>
              </td>
            )}
          </tr>
        </Fragment>
      ))}
      <tr className="fila-total">
        <td>
          <strong>Total {titulo.toLowerCase()}</strong>
        </td>
        {totales.map((v, i) => (
          <td key={i} className="dato">
            <strong>{euros(v)}</strong>
          </td>
        ))}
        {conTotal && (
          <td className="dato">
            <strong>{euros(totalFila(totales))}</strong>
          </td>
        )}
      </tr>
    </>
  );
}

export default async function PerdidasYGanancias({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { anio, vista, tramos, apuntesDelCentro, centros, centroPedido, error, hayApuntes } =
    await cargarApuntes(sp);
  const pyg = pygEnColumnas(apuntesDelCentro, tramos);
  const nombreCentro = centros.find((c) => c.id === centroPedido)?.nombre;
  const conTotal = tramos.length > 1;

  // Las mismas filas de la tabla, en crudo, para el CSV que abre Excel.
  const cabecera: CeldaExcel[] = [
    "Cuenta",
    "Nombre",
    ...tramos.map((t) => t.titulo),
    ...(conTotal ? ["Total año"] : []),
  ];
  const filasExcel: CeldaExcel[][] = [cabecera];
  for (const [titulo, bloques, totales] of [
    ["INGRESOS", pyg.ingresos, pyg.totalIngresos],
    ["GASTOS", pyg.gastos, pyg.totalGastos],
  ] as const) {
    filasExcel.push([titulo]);
    for (const b of bloques) {
      for (const f of b.filas) {
        filasExcel.push([f.codigo, f.nombre, ...f.importes, ...(conTotal ? [totalFila(f.importes)] : [])]);
      }
      filasExcel.push([b.clave, `Total ${b.titulo}`, ...b.totales, ...(conTotal ? [totalFila(b.totales)] : [])]);
    }
    filasExcel.push(["", `TOTAL ${titulo}`, ...totales, ...(conTotal ? [totalFila(totales)] : [])]);
  }
  filasExcel.push(["", "RESULTADO", ...pyg.resultado, ...(conTotal ? [totalFila(pyg.resultado)] : [])]);

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Pérdidas y ganancias</h1>
        {/* Al revés que el balance: cada columna es el MOVIMIENTO de su tramo.
            La columna de marzo es lo que pasó en marzo. */}
        <p className="sub">
          Ejercicio {anio}
          {vista === "meses" ? " · una columna por mes" : vista === "trimestres" ? " · una columna por trimestre" : ""}
          {nombreCentro ? ` · ${nombreCentro}` : " · todos los centros"}
        </p>
      </div>

      <div className="barra-filtros">
        <SelectorVista
          base="/informes/perdidas-y-ganancias"
          anio={anio}
          vista={vista}
          sp={sp}
          centros={centros}
        />
        {hayApuntes && <DescargarExcel nombre={`pyg-${anio}-${vista}`} filas={filasExcel} />}
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
          <div className="tabla-envoltura">
            <table className="tabla tabla-informe">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  {tramos.map((t) => (
                    <th key={t.titulo} className="dato">
                      {t.titulo}
                    </th>
                  ))}
                  {conTotal && <th className="dato">Total año</th>}
                </tr>
              </thead>
              <tbody>
                <Seccion
                  titulo="Ingresos"
                  bloques={pyg.ingresos}
                  totales={pyg.totalIngresos}
                  conTotal={conTotal}
                />
                <Seccion
                  titulo="Gastos"
                  bloques={pyg.gastos}
                  totales={pyg.totalGastos}
                  conTotal={conTotal}
                />
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    <strong>Resultado</strong>
                  </td>
                  {pyg.resultado.map((v, i) => (
                    <td key={i} className="dato">
                      <strong className={v < 0 ? "error-texto" : undefined}>{euros(v)}</strong>
                    </td>
                  ))}
                  {conTotal && (
                    <td className="dato">
                      <strong className={totalFila(pyg.resultado) < 0 ? "error-texto" : undefined}>
                        {euros(totalFila(pyg.resultado))}
                      </strong>
                    </td>
                  )}
                </tr>
              </tfoot>
            </table>
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
