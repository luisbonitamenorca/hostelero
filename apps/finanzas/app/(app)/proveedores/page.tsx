import Link from "next/link";
import { exigirModulo } from "@/lib/supabase/server";
import { euros } from "@/lib/importes";
import Buscador from "../clientes/buscador";
import Condiciones from "./condiciones";

export const dynamic = "force-dynamic";

const LIMITE = 300;

/** PostgREST separa los filtros de `or` por comas: se limpian antes. */
function limpiarBusqueda(texto: string): string {
  return texto.replace(/[,()*%\\]/g, " ").trim();
}

export default async function Proveedores({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  // Los proveedores son del módulo de compras: es su maestro, no lo duplicamos.
  const { supabase } = await exigirModulo("compras");

  let consulta = supabase
    .from("compras_proveedor")
    .select("id, nombre, nif, categoria, cuenta_contable, cuenta_proveedor, departamento, critico")
    .order("nombre")
    .limit(LIMITE);

  const termino = limpiarBusqueda(q);
  if (termino) {
    consulta = consulta.or(`nombre.ilike.%${termino}%,nif.ilike.%${termino}%,categoria.ilike.%${termino}%`);
  }

  const [{ data, error }, { data: docs }, { data: condiciones }] = await Promise.all([
    consulta,
    supabase.from("compras_doc").select("proveedor_id, total").eq("tipo", "factura"),
    supabase.from("fin_proveedor_condiciones").select("proveedor_id, dias_pago, forma_pago"),
  ]);

  const cond = new Map(
    (condiciones ?? []).map((c: { proveedor_id: string; dias_pago: number; forma_pago: string | null }) => [
      c.proveedor_id,
      c,
    ]),
  );

  // Cuántas facturas y cuánto lleva gastado cada proveedor.
  const resumen = new Map<string, { n: number; total: number }>();
  for (const d of docs ?? []) {
    if (!d.proveedor_id) continue;
    const r = resumen.get(d.proveedor_id) ?? { n: 0, total: 0 };
    r.n += 1;
    r.total += Number(d.total ?? 0);
    resumen.set(d.proveedor_id, r);
  }

  const filas = data ?? [];

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Proveedores</h1>
        <p className="sub">
          El maestro vive en el módulo de compras. Aquí se consulta, se ve lo que llevan facturado y
          se ponen sus condiciones de pago, que son las que calculan los vencimientos.
        </p>
      </div>

      <Buscador q={q} soloActivos={false} sinFiltroActivos />

      {error && (
        <div className="estado-vacio">
          <strong>No se pudieron cargar los proveedores</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && filas.length === 0 && (
        <div className="estado-vacio">
          <strong>{termino ? `Ningún proveedor coincide con «${termino}»` : "Aún no hay proveedores"}</strong>
          {termino ? "Prueba con parte del nombre o con el NIF." : "Se dan de alta desde el módulo de compras."}
        </div>
      )}

      {!error && filas.length > 0 && (
        <>
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>NIF</th>
                  <th>Categoría</th>
                  <th>Cuenta</th>
                  <th className="a-derecha">Facturas</th>
                  <th className="a-derecha">Facturado</th>
                  <th>Pago</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((p) => {
                  const r = resumen.get(p.id);
                  return (
                    <tr key={p.id}>
                      <td>
                        {p.nombre}
                        {p.critico && <span className="etiqueta-estado">crítico</span>}
                        {p.departamento && <span className="secundario">{p.departamento}</span>}
                      </td>
                      <td className="dato">{p.nif ?? "—"}</td>
                      <td>{p.categoria ?? "—"}</td>
                      <td className="dato">
                        {p.cuenta_proveedor ? (
                          <Link className="enlace" href={`/mayor?cuenta=${p.cuenta_proveedor}`} title="Ver el mayor de este proveedor">
                            {p.cuenta_proveedor}
                          </Link>
                        ) : (
                          (p.cuenta_contable ?? "—")
                        )}
                      </td>
                      <td className="numero">{r?.n ?? 0}</td>
                      <td className="numero">{r ? euros(r.total) : "—"}</td>
                      <td>
                        <Condiciones
                          proveedorId={p.id}
                          dias={cond.get(p.id)?.dias_pago ?? null}
                          forma={cond.get(p.id)?.forma_pago ?? null}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="pie-tabla">
            {filas.length === LIMITE
              ? `Mostrando los ${LIMITE} primeros. Afina la búsqueda para ver el resto.`
              : `${filas.length} ${filas.length === 1 ? "proveedor" : "proveedores"}.`}
          </p>
        </>
      )}
    </>
  );
}
