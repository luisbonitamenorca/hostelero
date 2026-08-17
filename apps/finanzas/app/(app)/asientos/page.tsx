import Link from "next/link";
import { exigirModulo } from "@/lib/supabase/server";
import { euros, fecha as formatearFecha } from "@/lib/importes";
import { calcularPeriodo, type ModoPeriodo } from "@/lib/contabilidad";
import SelectorPeriodo from "../informes/selector-periodo";

export const dynamic = "force-dynamic";

type AsientoFila = {
  id: string;
  numero: number | null;
  fecha: string;
  descripcion: string | null;
  estado: string;
  origen_tipo: string;
  fin_apuntes: { debe: number; haber: number }[];
};

export default async function Diario({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase } = await exigirModulo("contabilidad");

  const anio = Number(sp.anio) || new Date().getFullYear();
  const modo = (sp.modo as ModoPeriodo) || "anual";
  const periodo = calcularPeriodo(anio, modo, {
    mes: sp.mes ? Number(sp.mes) : undefined,
    trimestre: sp.trimestre ? Number(sp.trimestre) : undefined,
    desde: sp.desde,
    hasta: sp.hasta,
  });

  const { data, error } = await supabase
    .from("fin_asientos")
    .select("id, numero, fecha, descripcion, estado, origen_tipo, fin_apuntes(debe, haber)")
    .gte("fecha", periodo.desde)
    .lte("fecha", periodo.hasta)
    .order("fecha", { ascending: false })
    .order("numero", { ascending: false, nullsFirst: true })
    .limit(300);

  const filas = (data ?? []) as unknown as AsientoFila[];

  const importeDe = (f: AsientoFila) =>
    (f.fin_apuntes ?? []).reduce((s, a) => s + Number(a.debe), 0);

  const borradores = filas.filter((f) => f.estado === "borrador").length;

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Diario</h1>
        <p className="sub">
          Asientos de {periodo.titulo}
          {filas.length > 0 ? ` · ${filas.length === 300 ? "los 300 más recientes — acota el periodo para ver el resto" : filas.length}` : ""}
          {borradores > 0 ? ` · ${borradores} en borrador` : ""}
        </p>
      </div>

      <div className="barra-filtros">
        <SelectorPeriodo base="/asientos" anio={anio} modo={modo} sp={sp} />
        <Link className="boton" href="/asientos/nuevo">
          Asiento nuevo
        </Link>
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudo cargar el diario</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && filas.length === 0 && (
        <div className="estado-vacio">
          <strong>No hay asientos en {periodo.titulo}</strong>
          El diario está vacío. Hasta que haya asientos, los informes de sumas y
          saldos, balance y pérdidas y ganancias saldrán en blanco: los tres se
          calculan desde aquí.
        </div>
      )}

      {!error && filas.length > 0 && (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>Origen</th>
                <th className="dato">Importe</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className={f.estado === "borrador" ? "fila-inactiva" : undefined}>
                  <td className="dato">
                    <Link className="enlace" href={`/asientos/${f.id}`}>
                      {f.numero ?? "—"}
                    </Link>
                  </td>
                  <td className="dato">{formatearFecha(f.fecha)}</td>
                  <td>{f.descripcion ?? "—"}</td>
                  <td className="texto-suave">{f.origen_tipo}</td>
                  <td className="dato">{euros(importeDe(f))}</td>
                  <td>
                    <span className="etiqueta-estado">{f.estado}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
