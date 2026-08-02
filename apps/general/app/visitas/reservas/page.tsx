import { crearClienteServidor } from "@/lib/supabase/server";
import { euro, fDate, fHora, PAGO_LABEL } from "../comun";
import ReservaAcciones, { type ReservaVista } from "../_ui/ReservaAcciones";

export const dynamic = "force-dynamic";

const PILL: Record<string, string> = { pagada: "green", pendiente_pago: "amber", cancelada: "red" };

export default async function Reservas({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q || "").trim();
  const estado = sp.estado || "";

  const sb = await crearClienteServidor();
  let consulta = sb
    .from("visitas_reservas")
    .select("*, visitas_sesiones(fecha, hora_inicio, visitas_productos(nombre_es))");

  if (estado) {
    consulta = consulta.eq("estado", estado as "pendiente_pago" | "pagada" | "cancelada");
  }
  if (q) {
    const t = q.replace(/[%,()]/g, " ").trim();
    if (t) {
      consulta = consulta.or(
        `cliente_nombre.ilike.%${t}%,cliente_email.ilike.%${t}%,codigo_reserva.ilike.%${t}%`,
      );
    }
  }

  const { data, error } = await consulta
    .order("created_at", { ascending: false })
    .limit(q ? 500 : 200);
  const filas = (data ?? []) as unknown as ReservaVista[];

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Reservas</h2>
          <p>Busca por nombre, email o nº de comanda. Cancelar libera la plaza automáticamente.</p>
        </div>
      </div>

      <form className="toolbar" method="get">
        <div className="field" style={{ flex: 1, minWidth: 240 }}>
          <label>Buscar</label>
          <input name="q" defaultValue={q} placeholder="Nombre, email o nº de comanda…" />
        </div>
        <div className="field">
          <label>Estado</label>
          <select name="estado" defaultValue={estado}>
            <option value="">Todos</option>
            <option value="pagada">Pagadas</option>
            <option value="pendiente_pago">A medias / pendientes</option>
            <option value="cancelada">Canceladas</option>
          </select>
        </div>
        <button className="btn" type="submit">Aplicar</button>
      </form>

      <div className="card">
        {error ? (
          <div className="empty">Error: {error.message}</div>
        ) : filas.length === 0 ? (
          <div className="empty">No hay reservas que coincidan.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Cliente</th>
                  <th>Visita</th>
                  <th>Sesión</th>
                  <th className="right">Pers.</th>
                  <th className="right">Importe</th>
                  <th>Pago</th>
                  <th>Estado</th>
                  <th className="center">Entrada</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((r) => {
                  const s = r.visitas_sesiones;
                  return (
                    <tr key={r.id}>
                      <td className="nowrap"><code>{r.codigo_reserva}</code></td>
                      <td>
                        {r.cliente_nombre}
                        <div className="muted" style={{ fontSize: 12 }}>
                          {r.cliente_email || ""}
                          {r.cliente_pais ? ` · ${r.cliente_pais}` : ""}
                        </div>
                      </td>
                      <td>{s?.visitas_productos?.nombre_es || "—"}</td>
                      <td className="nowrap">{s ? `${fDate(s.fecha)} ${fHora(s.hora_inicio)}` : "—"}</td>
                      <td className="right">{r.num_personas}</td>
                      <td className="right nowrap">{euro(r.importe_total)}</td>
                      <td>{PAGO_LABEL[r.metodo_pago] || r.metodo_pago}</td>
                      <td><span className={`pill ${PILL[r.estado] || "grey"}`}>{r.estado.replace("_", " ")}</span></td>
                      <td className="center">
                        {r.check_in_at ? <span className="pill green">✓</span> : <span className="muted" style={{ fontSize: 12 }}>—</span>}
                      </td>
                      <td className="right nowrap"><ReservaAcciones reserva={r} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
