import { crearClienteServidor } from "@/lib/supabase/server";
import { euro, IDIOMAS } from "../comun";
import ProductoForm, { type ProductoVista } from "../_ui/ProductoForm";

export const dynamic = "force-dynamic";

export default async function Productos() {
  const sb = await crearClienteServidor();
  const { data, error } = await sb
    .from("visitas_productos")
    .select("*")
    .order("orden")
    .order("nombre_es");

  const productos = (data ?? []) as unknown as ProductoVista[];

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Productos</h2>
          <p>Visitas, experiencias y bonos. Las visitas generan sesiones; los bonos no.</p>
        </div>
        <ProductoForm />
      </div>

      <div className="card">
        {error ? (
          <div className="empty">Error: {error.message}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Tipo</th>
                  <th>Idioma</th>
                  <th className="right">Precio</th>
                  <th className="right">Aforo</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {productos.length ? (
                  productos.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.nombre_es}</strong>
                        {p.nombre_en ? (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {p.nombre_en}{p.nombre_fr ? ` · ${p.nombre_fr}` : ""}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {p.tipo === "bono" ? (
                          <span className="pill gold">Bono · {p.tipo_bono || ""}</span>
                        ) : (
                          <span className="pill wine">Visita</span>
                        )}
                      </td>
                      <td>{p.idioma ? IDIOMAS[p.idioma] : "—"}</td>
                      <td className="right nowrap">{euro(p.precio)}</td>
                      <td className="right">{p.tipo === "bono" ? "—" : p.aforo_default ?? "—"}</td>
                      <td>{p.activo ? <span className="pill green">Activo</span> : <span className="pill grey">Inactivo</span>}</td>
                      <td className="right nowrap"><ProductoForm producto={p} /></td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={7}><div className="empty">Aún no hay productos. Crea el primero.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
