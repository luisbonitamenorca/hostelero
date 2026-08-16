import Link from "next/link";

/**
 * El vacío honesto. Los tres informes salen del diario, así que sin asientos
 * confirmados no hay nada que enseñar — y conviene decir POR QUÉ está vacío y
 * qué hacer, en vez de una tabla de ceros que parece un error.
 */
export default function SinDiario() {
  return (
    <div className="estado-vacio">
      <strong>No hay asientos confirmados en este periodo</strong>
      Los tres informes se calculan desde el diario, y solo cuentan los asientos
      confirmados: un borrador todavía no es un hecho contable.
      <br />
      <Link className="enlace" href="/asientos/nuevo">
        Crear un asiento
      </Link>{" "}
      o revisar el <Link className="enlace" href="/asientos">diario</Link>.
    </div>
  );
}
