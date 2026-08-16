import Link from "next/link";
import { exigirFacturacion } from "@/lib/supabase/server";
import { normalizarNif } from "@/lib/nif";
import Buscador from "./buscador";

export const dynamic = "force-dynamic";

const COLUMNAS = "id, nif, nombre_fiscal, nombre_comercial, municipio, email, dias_vencimiento, tipo_iva_defecto, activo";
const LIMITE = 200;

/** PostgREST separa los filtros de `or` por comas y paréntesis: si el texto
 *  buscado los lleva, rompe la consulta. Se quitan antes de montarla. */
function limpiarBusqueda(texto: string): string {
  return texto.replace(/[,()*%\\]/g, " ").trim();
}

export default async function Clientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; todos?: string }>;
}) {
  const { q = "", todos } = await searchParams;
  const { supabase } = await exigirFacturacion();

  let consulta = supabase.from("fin_clientes").select(COLUMNAS).order("nombre_fiscal").limit(LIMITE);
  if (todos !== "1") consulta = consulta.eq("activo", true);

  const termino = limpiarBusqueda(q);
  if (termino) {
    const nif = normalizarNif(termino) ?? termino;
    consulta = consulta.or(
      [
        `nombre_fiscal.ilike.%${termino}%`,
        `nombre_comercial.ilike.%${termino}%`,
        `email.ilike.%${termino}%`,
        `municipio.ilike.%${termino}%`,
        `nif_norm.ilike.%${nif}%`,
      ].join(","),
    );
  }

  const { data, error } = await consulta;
  const filas = data ?? [];

  return (
    <>
      <div className="cabecera-pagina con-accion">
        <div>
          <h1>Clientes</h1>
          <p className="sub">Clientes fiscales para facturación (con NIF y domicilio)</p>
        </div>
        <Link className="boton boton-auto" href="/clientes/nuevo">
          Nuevo cliente
        </Link>
      </div>

      <Buscador q={q} soloActivos={todos !== "1"} />

      {error && (
        <div className="estado-vacio">
          <strong>No se pudieron cargar los clientes</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && filas.length === 0 && !termino && (
        <div className="estado-vacio">
          <strong>Aún no hay clientes fiscales</strong>
          Crea el primero con «Nuevo cliente». Son una entidad distinta de los comensales de reservas.
        </div>
      )}

      {!error && filas.length === 0 && termino && (
        <div className="estado-vacio">
          <strong>Ningún cliente coincide con «{termino}»</strong>
          Prueba con parte del nombre o con el NIF.
        </div>
      )}

      {!error && filas.length > 0 && (
        <>
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Nombre fiscal</th>
                  <th>NIF</th>
                  <th>Municipio</th>
                  <th>Correo</th>
                  <th className="a-derecha">Venc.</th>
                  <th className="a-derecha">IVA</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((c) => (
                  <tr key={c.id} className={c.activo ? undefined : "fila-inactiva"}>
                    <td>
                      <Link className="enlace" href={`/clientes/${c.id}`}>
                        {c.nombre_fiscal}
                      </Link>
                      {!c.activo && <span className="etiqueta-estado">inactivo</span>}
                      {c.nombre_comercial && <span className="secundario">{c.nombre_comercial}</span>}
                    </td>
                    <td className="dato">{c.nif ?? "—"}</td>
                    <td>{c.municipio ?? "—"}</td>
                    <td>{c.email ?? "—"}</td>
                    <td className="numero">{c.dias_vencimiento} d</td>
                    <td className="numero">{Number(c.tipo_iva_defecto)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pie-tabla">
            {filas.length === LIMITE
              ? `Mostrando los ${LIMITE} primeros. Afina la búsqueda para ver el resto.`
              : `${filas.length} ${filas.length === 1 ? "cliente" : "clientes"}.`}
          </p>
        </>
      )}
    </>
  );
}
