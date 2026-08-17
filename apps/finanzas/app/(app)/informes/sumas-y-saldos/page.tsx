import { euros } from "@/lib/importes";
import { cargarSaldos } from "../datos";
import SelectorPeriodo from "../selector-periodo";
import DescargarExcel, { type CeldaExcel } from "../descargar-excel";
import SinDiario from "../sin-diario";

export const dynamic = "force-dynamic";

export default async function SumasYSaldos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { anio, modo, periodo, filas, error, hayApuntes } = await cargarSaldos(sp);

  const t = filas.reduce(
    (acc, f) => ({
      debeAnterior: acc.debeAnterior + f.debeAnterior,
      haberAnterior: acc.haberAnterior + f.haberAnterior,
      debePeriodo: acc.debePeriodo + f.debePeriodo,
      haberPeriodo: acc.haberPeriodo + f.haberPeriodo,
      debeTotal: acc.debeTotal + f.debeTotal,
      haberTotal: acc.haberTotal + f.haberTotal,
    }),
    { debeAnterior: 0, haberAnterior: 0, debePeriodo: 0, haberPeriodo: 0, debeTotal: 0, haberTotal: 0 },
  );

  const descuadre = Math.round((t.debeTotal - t.haberTotal) * 100) / 100;

  const filasExcel: CeldaExcel[][] = [
    ["Cuenta", "Nombre", "Debe anterior", "Haber anterior", "Debe periodo", "Haber periodo",
      "Debe acumulado", "Haber acumulado", "Saldo"],
    ...filas.map((f): CeldaExcel[] => [
      f.codigo, f.nombre, f.debeAnterior, f.haberAnterior, f.debePeriodo, f.haberPeriodo,
      f.debeTotal, f.haberTotal, f.saldo,
    ]),
    ["", "TOTALES", t.debeAnterior, t.haberAnterior, t.debePeriodo, t.haberPeriodo,
      t.debeTotal, t.haberTotal, descuadre],
  ];

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Sumas y saldos</h1>
        <p className="sub">{periodo.titulo}</p>
      </div>

      <div className="barra-filtros">
        <SelectorPeriodo base="/informes/sumas-y-saldos" anio={anio} modo={modo} sp={sp} />
        {hayApuntes && (
          <DescargarExcel nombre={`sumas-y-saldos-${anio}-${modo}`} filas={filasExcel} />
        )}
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudo calcular el informe</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && !hayApuntes && <SinDiario />}

      {!error && hayApuntes && (
        <>
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead>
                <tr>
                  <th rowSpan={2}>Cuenta</th>
                  <th colSpan={2} className="dato">
                    Saldo anterior
                  </th>
                  <th colSpan={2} className="dato">
                    Movimiento del periodo
                  </th>
                  <th colSpan={2} className="dato">
                    Acumulado
                  </th>
                  <th rowSpan={2} className="dato">
                    Saldo
                  </th>
                </tr>
                <tr>
                  <th className="dato">Debe</th>
                  <th className="dato">Haber</th>
                  <th className="dato">Debe</th>
                  <th className="dato">Haber</th>
                  <th className="dato">Debe</th>
                  <th className="dato">Haber</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.codigo}>
                    <td className="dato">
                      {f.codigo} <span className="texto-suave">{f.nombre}</span>
                    </td>
                    <td className="dato">{f.debeAnterior ? euros(f.debeAnterior) : ""}</td>
                    <td className="dato">{f.haberAnterior ? euros(f.haberAnterior) : ""}</td>
                    <td className="dato">{f.debePeriodo ? euros(f.debePeriodo) : ""}</td>
                    <td className="dato">{f.haberPeriodo ? euros(f.haberPeriodo) : ""}</td>
                    <td className="dato">{f.debeTotal ? euros(f.debeTotal) : ""}</td>
                    <td className="dato">{f.haberTotal ? euros(f.haberTotal) : ""}</td>
                    <td className="dato">
                      {f.saldo === 0 ? "" : f.saldo > 0 ? euros(f.saldo) : `(${euros(-f.saldo)})`}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    <strong>Totales</strong>
                  </td>
                  <td className="dato">{euros(t.debeAnterior)}</td>
                  <td className="dato">{euros(t.haberAnterior)}</td>
                  <td className="dato">{euros(t.debePeriodo)}</td>
                  <td className="dato">{euros(t.haberPeriodo)}</td>
                  <td className="dato">
                    <strong>{euros(t.debeTotal)}</strong>
                  </td>
                  <td className="dato">
                    <strong>{euros(t.haberTotal)}</strong>
                  </td>
                  <td className="dato">{euros(descuadre)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="pista">
            El saldo entre paréntesis es acreedor. Las dos columnas de acumulado tienen
            que sumar lo mismo: si no, hay un asiento descuadrado y todo lo demás sobra.
            {descuadre !== 0 && (
              <strong className="error-texto"> Ahora mismo hay un descuadre de {euros(descuadre)}.</strong>
            )}
          </p>
        </>
      )}
    </>
  );
}
