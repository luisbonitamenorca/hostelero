import { Fragment } from "react";
import { numero } from "@/lib/importes";
import { balanceEnColumnas, type BloqueColumnas } from "@/lib/contabilidad";
import { cargarApuntes } from "../datos";
import SelectorVista from "../selector-vista";
import DescargarExcel, { type CeldaExcel } from "../descargar-excel";
import SinDiario from "../sin-diario";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Celda de importe: el cero no se pinta; el negativo (correctoras) entre paréntesis. */
function Importe({ v }: { v: number }) {
  return <td className="dato">{v === 0 ? "" : v < 0 ? `(${numero(-v)})` : numero(v)}</td>;
}

function Tabla({
  titulo,
  columnas,
  bloques,
  totales,
}: {
  titulo: string;
  columnas: string[];
  bloques: BloqueColumnas[];
  totales: number[];
}) {
  return (
    <div className="tabla-envoltura">
      <table className="tabla tabla-informe">
        <thead>
          <tr>
            <th>{titulo}</th>
            {columnas.map((c) => (
              <th key={c} className="dato">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bloques.map((b) => (
            <Fragment key={b.clave}>
              <tr className="fila-seccion">
                <td colSpan={columnas.length + 1}>
                  <strong>{b.titulo}</strong>
                </td>
              </tr>
              {b.filas.map((f) => (
                <tr key={f.codigo}>
                  <td>
                    {f.codigo} <span className="texto-suave">{f.nombre}</span>
                  </td>
                  {f.importes.map((v, i) => (
                    <Importe key={i} v={v} />
                  ))}
                </tr>
              ))}
              <tr className="fila-subtotal">
                <td>
                  <em>Total {b.titulo.toLowerCase()}</em>
                </td>
                {b.totales.map((v, i) => (
                  <td key={i} className="dato">
                    <em>{v === 0 ? "" : numero(v)}</em>
                  </td>
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>
              <strong>Total {titulo.toLowerCase()}</strong>
            </td>
            {totales.map((v, i) => (
              <td key={i} className="dato">
                <strong>{numero(v)}</strong>
              </td>
            ))}
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
  const { anio, vista, tramos, inicioEjercicio, apuntes, error, hayApuntes } =
    await cargarApuntes(sp);
  const b = balanceEnColumnas(apuntes, tramos, inicioEjercicio);

  // Cada columna es una FOTO al último día de su tramo. Por eso aquí no hay
  // columna «Total año»: sumar fotos no significa nada — la última columna YA
  // es el balance a fin del periodo.
  const columnas = tramos.map((t) =>
    tramos.length > 1 ? `a ${t.hasta.split("-").reverse().join("/")}` : t.titulo,
  );

  const descuadrado = b.descuadres.some((d) => d !== 0);

  const filasExcel: CeldaExcel[][] = [["Cuenta", "Nombre", ...columnas]];
  for (const [titulo, bloques, totales] of [
    ["ACTIVO", b.activo, b.totalActivo],
    ["PATRIMONIO NETO Y PASIVO", b.pasivo, b.totalPasivo],
  ] as const) {
    filasExcel.push([titulo]);
    for (const bl of bloques) {
      for (const f of bl.filas) filasExcel.push([f.codigo, f.nombre, ...f.importes]);
      filasExcel.push(["", `Total ${bl.titulo}`, ...bl.totales]);
    }
    filasExcel.push(["", `TOTAL ${titulo}`, ...totales]);
  }
  if (b.sinClasificar.length > 0) {
    filasExcel.push(["SIN CLASIFICAR"]);
    for (const f of b.sinClasificar) filasExcel.push([f.codigo, f.nombre, ...f.importes]);
  }

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Balance de situación</h1>
        {/* Un balance es una FOTO a una fecha, no un movimiento de un tramo.
            En la vista por meses cada columna es la foto a fin de ese mes. */}
        <p className="sub">
          Ejercicio {anio} · acumulado desde el 1 de enero · importes en euros
          {vista === "meses"
            ? " · una columna por fin de mes"
            : vista === "trimestres"
              ? " · una columna por fin de trimestre"
              : ""}
        </p>
      </div>

      <div className="barra-filtros">
        <SelectorVista base="/informes/balance" anio={anio} vista={vista} sp={sp} />
        {hayApuntes && <DescargarExcel nombre={`balance-${anio}-${vista}`} filas={filasExcel} />}
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
          <Tabla titulo="Activo" columnas={columnas} bloques={b.activo} totales={b.totalActivo} />
          <Tabla
            titulo="Patrimonio neto y pasivo"
            columnas={columnas}
            bloques={b.pasivo}
            totales={b.totalPasivo}
          />

          {!descuadrado ? (
            <p className="pista">
              El balance cuadra en todas las columnas: activo y pasivo suman lo mismo.
              El resultado del ejercicio va incorporado al patrimonio neto (línea 129);
              en la contabilidad todavía vive en los grupos 6 y 7 hasta que se
              regularice al cierre. Los importes entre paréntesis restan: son las
              cuentas correctoras (amortización acumulada y deterioros).
            </p>
          ) : (
            <div className="aviso-banda">
              <span className="aviso-texto">
                <strong>El balance no cuadra en alguna columna.</strong>{" "}
                {b.sinClasificar.length > 0
                  ? "Hay cuentas que no se han podido colocar en una masa patrimonial; salen listadas abajo."
                  : "El descuadre viene del propio diario, no de la clasificación."}
              </span>
            </div>
          )}

          {b.sinClasificar.length > 0 && (
            <div className="tabla-envoltura">
              <table className="tabla tabla-informe">
                <thead>
                  <tr>
                    <th>Sin clasificar</th>
                    {columnas.map((c) => (
                      <th key={c} className="dato">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.sinClasificar.map((f) => (
                    <tr key={f.codigo}>
                      <td>
                        {f.codigo} <span className="texto-suave">{f.nombre}</span>
                      </td>
                      {f.importes.map((v, i) => (
                        <Importe key={i} v={v} />
                      ))}
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
