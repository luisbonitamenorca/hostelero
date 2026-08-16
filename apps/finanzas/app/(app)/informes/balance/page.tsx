import { Fragment } from "react";
import { euros } from "@/lib/importes";
import { balance, type BloqueBalance } from "@/lib/contabilidad";
import { cargarSaldos } from "../datos";
import SelectorPeriodo from "../selector-periodo";
import SinDiario from "../sin-diario";

export const dynamic = "force-dynamic";

function Columna({ titulo, bloques, total }: { titulo: string; bloques: BloqueBalance[]; total: number }) {
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
          {bloques.map((b) => (
            <Fragment key={b.masa}>
              <tr>
                <td colSpan={2}>
                  <strong>{b.titulo}</strong>
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

export default async function BalanceDeSituacion({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { anio, modo, periodo, filas, error, hayApuntes } = await cargarSaldos(sp);
  const b = balance(filas);

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Balance de situación</h1>
        {/* Un balance es una FOTO a una fecha, no un movimiento de un tramo.
            Se dice explícitamente porque el selector de arriba habla de
            periodos y es fácil leerlo como «el balance de marzo». */}
        <p className="sub">A {periodo.hasta.split("-").reverse().join("/")} · acumulado desde el 1 de enero de {anio}</p>
      </div>

      <div className="barra-filtros">
        <SelectorPeriodo base="/informes/balance" anio={anio} modo={modo} sp={sp} />
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudo calcular el balance</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && !hayApuntes && <SinDiario />}

      {!error && hayApuntes && (
        <>
          <div className="rejilla">
            <Columna titulo="Activo" bloques={b.activo} total={b.totalActivo} />
            <Columna titulo="Patrimonio neto y pasivo" bloques={b.pasivo} total={b.totalPasivo} />
          </div>

          {b.descuadre === 0 ? (
            <p className="pista">
              El balance cuadra: activo y pasivo suman {euros(b.totalActivo)}. El
              resultado del ejercicio ({euros(b.resultado)}) va incorporado al patrimonio
              neto; en la contabilidad todavía vive en los grupos 6 y 7 hasta que se
              regularice al cierre.
            </p>
          ) : (
            <div className="aviso-banda">
              <span className="aviso-texto">
                <strong>El balance no cuadra por {euros(b.descuadre)}.</strong>{" "}
                {b.sinClasificar.length > 0
                  ? "Hay cuentas que no se han podido colocar en una masa patrimonial; salen listadas abajo."
                  : "El descuadre viene del propio diario, no de la clasificación."}
              </span>
            </div>
          )}

          {b.sinClasificar.length > 0 && (
            <div className="tabla-envoltura">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Sin clasificar</th>
                    <th className="dato">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {b.sinClasificar.map((l) => (
                    <tr key={l.codigo}>
                      <td className="dato">
                        {l.codigo} <span className="texto-suave">{l.nombre}</span>
                      </td>
                      <td className="dato">{euros(l.importe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {b.sinClasificar.length > 0 && (
            <p className="pista">
              Estas cuentas pueden ir al activo o al pasivo según el caso (la 551 con
              socios, la 555 de partidas pendientes…), y colocarlas a ojo daría un
              balance que cuadra con las cifras mal. Se dejan a la vista a propósito.
            </p>
          )}
        </>
      )}
    </>
  );
}
