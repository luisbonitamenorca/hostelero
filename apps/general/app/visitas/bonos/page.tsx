import { crearClienteServidor } from "@/lib/supabase/server";
import { euro, fDate } from "../comun";
import { ValidarCanje, VenderBono } from "../_ui/BonoWidgets";

export const dynamic = "force-dynamic";

const EST: Record<string, string> = { vendido: "green", canjeado: "grey", caducado: "red" };

export default async function Bonos() {
  const sb = await crearClienteServidor();
  const [{ data: bonosProd }, { data, error }] = await Promise.all([
    sb
      .from("visitas_productos")
      .select("id, nombre_es, precio, tipo_bono")
      .eq("tipo", "bono")
      .eq("activo", true)
      .order("nombre_es"),
    sb
      .from("visitas_bonos")
      .select("*, visitas_productos(nombre_es)")
      .order("fecha_venta", { ascending: false })
      .limit(200),
  ]);

  const bonos = data ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Bonos</h2>
          <p>Vender, validar y canjear bonos regalo.</p>
        </div>
        <VenderBono productos={bonosProd ?? []} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr", marginBottom: 18 }}>
        <ValidarCanje />
      </div>

      <div className="card">
        <div className="card-h"><h3>Bonos emitidos</h3></div>
        {error ? (
          <div className="empty">Error: {error.message}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Incluye</th>
                  <th>Comprador / Para</th>
                  <th className="right">Importe</th>
                  <th>Vendido</th>
                  <th>Caduca</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {bonos.length ? (
                  bonos.map((b) => {
                    const uds = b.unidades || 1;
                    return (
                      <tr key={b.id}>
                        <td className="nowrap"><code>{b.codigo_canje}</code></td>
                        <td>{uds > 1 ? <strong>{uds} × </strong> : null}{b.visitas_productos?.nombre_es || "—"}</td>
                        <td>
                          {b.comprador_nombre}
                          {b.beneficiario_nombre ? <div className="muted" style={{ fontSize: 12 }}>Para: {b.beneficiario_nombre}</div> : null}
                        </td>
                        <td className="right nowrap">{euro(b.importe)}</td>
                        <td className="nowrap">{fDate((b.fecha_venta || "").slice(0, 10))}</td>
                        <td className="nowrap">{b.caduca_at ? fDate(b.caduca_at.slice(0, 10)) : "—"}</td>
                        <td>
                          <span className={`pill ${EST[b.estado] || "grey"}`}>{b.estado}</span>
                          {b.estado === "canjeado" && b.fecha_canje ? (
                            <div className="muted" style={{ fontSize: 11 }}>{fDate(b.fecha_canje.slice(0, 10))}</div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr><td colSpan={7}><div className="empty">Aún no hay bonos.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
