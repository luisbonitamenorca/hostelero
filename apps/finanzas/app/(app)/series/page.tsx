import { exigirFacturacion } from "@/lib/supabase/server";
import NuevaSerie from "./nueva-serie";
import BotonActiva from "./boton-activa";

export const dynamic = "force-dynamic";

export default async function Series() {
  const { supabase } = await exigirFacturacion();

  const [rSeries, rSociedades, rEjercicios, rUsadas] = await Promise.all([
    supabase
      .from("fin_series")
      .select("id, sociedad_id, codigo, ejercicio, descripcion, tipo_defecto, siguiente_numero, activa")
      .order("ejercicio", { ascending: false })
      .order("codigo"),
    supabase.from("sociedades").select("id, nombre").order("nombre"),
    supabase.from("fin_ejercicios").select("anio, estado, sociedad_id").order("anio", { ascending: false }),
    // Una serie con facturas numeradas ya no puede tocar su correlativo.
    supabase.from("fin_facturas").select("serie_id").not("numero", "is", null),
  ]);

  const series = rSeries.data ?? [];
  const usadas = new Set((rUsadas.data ?? []).map((f) => f.serie_id));
  const error = rSeries.error ?? rSociedades.error ?? rEjercicios.error;

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Series</h1>
        <p className="sub">Numeración de facturas por sociedad y ejercicio</p>
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudieron cargar las series</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && (
        <NuevaSerie sociedades={rSociedades.data ?? []} ejercicios={rEjercicios.data ?? []} />
      )}

      {!error && series.length === 0 && (
        <div className="estado-vacio">
          <strong>Aún no hay series</strong>
          Sin una serie activa no se puede expedir ninguna factura. Crea al menos una por ejercicio.
        </div>
      )}

      {!error && series.length > 0 && (
        <>
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Serie</th>
                  <th>Ejercicio</th>
                  <th>Descripción</th>
                  <th>Tipo</th>
                  <th className="a-derecha">Siguiente nº</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {series.map((s) => (
                  <tr key={s.id} className={s.activa ? undefined : "fila-inactiva"}>
                    <td className="dato">{s.codigo}</td>
                    <td className="dato">{s.ejercicio}</td>
                    <td>
                      {s.descripcion ?? "—"}
                      {usadas.has(s.id) && <span className="secundario">con facturas expedidas</span>}
                    </td>
                    <td>{s.tipo_defecto}</td>
                    <td className="numero">{s.siguiente_numero}</td>
                    <td>{s.activa ? "activa" : <span className="etiqueta-estado">inactiva</span>}</td>
                    <td className="a-derecha">
                      <BotonActiva id={s.id} activa={s.activa} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pie-tabla">
            Una serie no se borra nunca: se desactiva. El correlativo lo asigna el servidor al
            expedir, de uno en uno y sin huecos.
          </p>
        </>
      )}
    </>
  );
}
