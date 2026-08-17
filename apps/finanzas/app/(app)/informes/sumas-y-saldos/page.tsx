import { numero } from "@/lib/importes";
import { cargarSaldos } from "../datos";
import SelectorPeriodo from "../selector-periodo";
import DescargarExcel, { type CeldaExcel } from "../descargar-excel";
import SinDiario from "../sin-diario";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Importe de tabla: sin símbolo (el informe entero va en euros), cero en
 *  blanco y el negativo entre paréntesis, que es como se lee en contabilidad. */
function celda(v: number): string {
  if (v === 0) return "";
  return v < 0 ? `(${numero(-v)})` : numero(v);
}

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

  // La columna de saldo anterior solo aparece si el periodo no arranca el 1 de
  // enero: en el año completo estaría entera a cero y solo ocuparía sitio.
  const conAnterior = filas.some((f) => f.debeAnterior !== 0 || f.haberAnterior !== 0);
  const saldoAnterior = (f: (typeof filas)[number]) => f.debeAnterior - f.haberAnterior;

  const filasExcel: CeldaExcel[][] = [
    ["Cuenta", "Nombre",
      ...(conAnterior ? ["Saldo anterior"] : []),
      "Debe del periodo", "Haber del periodo", "Saldo"],
    ...filas.map((f): CeldaExcel[] => [
      f.codigo, f.nombre,
      ...(conAnterior ? [saldoAnterior(f)] : []),
      f.debePeriodo, f.haberPeriodo, f.saldo,
    ]),
    ["", "TOTALES",
      ...(conAnterior ? [t.debeAnterior - t.haberAnterior] : []),
      t.debePeriodo, t.haberPeriodo, descuadre],
  ];

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Sumas y saldos</h1>
        <p className="sub">{periodo.titulo} · importes en euros</p>
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
            <table className="tabla tabla-informe">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  {conAnterior && <th className="dato">Saldo anterior</th>}
                  <th className="dato">Debe</th>
                  <th className="dato">Haber</th>
                  <th className="dato">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.codigo}>
                    <td>
                      {f.codigo} <span className="texto-suave">{f.nombre}</span>
                    </td>
                    {conAnterior && <td className="dato">{celda(saldoAnterior(f))}</td>}
                    <td className="dato">{celda(f.debePeriodo)}</td>
                    <td className="dato">{celda(f.haberPeriodo)}</td>
                    <td className="dato">{celda(f.saldo)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    <strong>Totales</strong>
                  </td>
                  {conAnterior && (
                    <td className="dato">
                      <strong>{celda(t.debeAnterior - t.haberAnterior)}</strong>
                    </td>
                  )}
                  <td className="dato">
                    <strong>{numero(t.debePeriodo)}</strong>
                  </td>
                  <td className="dato">
                    <strong>{numero(t.haberPeriodo)}</strong>
                  </td>
                  <td className="dato">
                    <strong>{celda(descuadre) || "0,00"}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="pista">
            Debe y haber son el movimiento del periodo; el saldo es el acumulado al
            final (entre paréntesis, acreedor). El saldo total tiene que ser 0,00: si
            no, hay un asiento descuadrado y todo lo demás sobra.
            {descuadre !== 0 && (
              <strong className="error-texto"> Ahora mismo hay un descuadre de {numero(descuadre)} €.</strong>
            )}
          </p>
        </>
      )}
    </>
  );
}
