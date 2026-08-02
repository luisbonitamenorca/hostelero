import { crearClienteServidor } from "@/lib/supabase/server";
import { euro, todayISO } from "./comun";

export const dynamic = "force-dynamic";

function primerDiaMes() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const sp = await searchParams;
  const desde = sp.desde || primerDiaMes();
  const hasta = sp.hasta || todayISO();

  const sb = await crearClienteServidor();
  const [{ data: res }, { data: bon }] = await Promise.all([
    sb
      .from("visitas_reservas")
      .select(
        "importe_total,num_personas,metodo_pago,created_at, visitas_sesiones(fecha, visitas_productos(nombre_es))",
      )
      .eq("estado", "pagada"),
    sb.from("visitas_bonos").select("importe,estado,fecha_venta"),
  ]);

  const inRange = (iso: string | null | undefined) => !!iso && iso >= desde && iso <= hasta;

  let ingresos = 0;
  let visitas = 0;
  let nReservas = 0;
  const porProducto: Record<string, number> = {};

  (res ?? []).forEach((r) => {
    const fv = (r.created_at || "").slice(0, 10);
    const fr = r.visitas_sesiones?.fecha;
    // Ingreso: por fecha de venta, salvo las pagadas con bono (ya contadas en la venta del bono).
    if (inRange(fv) && r.metodo_pago !== "bono") ingresos += Number(r.importe_total || 0);
    // Visita: por fecha de realización (todas las reservas, incluidas presenciales).
    if (fr && inRange(fr)) {
      visitas += r.num_personas;
      nReservas++;
      const k = r.visitas_sesiones?.visitas_productos?.nombre_es || "—";
      porProducto[k] = (porProducto[k] || 0) + r.num_personas;
    }
  });

  let bonosVendidos = 0;
  let bonosImporte = 0;
  let bonosPend = 0;
  (bon ?? []).forEach((b) => {
    const fv = (b.fecha_venta || "").slice(0, 10);
    if (inRange(fv) && (b.estado === "vendido" || b.estado === "canjeado")) {
      bonosVendidos++;
      bonosImporte += Number(b.importe || 0);
      ingresos += Number(b.importe || 0);
    }
    if (b.estado === "vendido") bonosPend++;
  });

  const prodRows = Object.entries(porProducto).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Dashboard</h2>
          <p>Resumen de ventas y visitas. Ingresos por fecha de venta; visitas por fecha de realización.</p>
        </div>
      </div>

      <form className="toolbar" method="get">
        <div className="field">
          <label>Desde</label>
          <input type="date" name="desde" defaultValue={desde} />
        </div>
        <div className="field">
          <label>Hasta</label>
          <input type="date" name="hasta" defaultValue={hasta} />
        </div>
        <button className="btn" type="submit">Aplicar</button>
      </form>

      <div className="kpis">
        <div className="kpi accent">
          <div className="label">Ingresos</div>
          <div className="value">{euro(ingresos)}</div>
        </div>
        <div className="kpi">
          <div className="label">Visitas realizadas</div>
          <div className="value">{visitas} <small>pers.</small></div>
        </div>
        <div className="kpi">
          <div className="label">Reservas</div>
          <div className="value">{nReservas}</div>
        </div>
        <div className="kpi">
          <div className="label">Bonos vendidos</div>
          <div className="value">{bonosVendidos} <small>· {euro(bonosImporte)}</small></div>
        </div>
        <div className="kpi">
          <div className="label">Bonos sin canjear</div>
          <div className="value">{bonosPend}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-h"><h3>Visitas por producto</h3></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th className="right">Personas</th>
              </tr>
            </thead>
            <tbody>
              {prodRows.length ? (
                prodRows.map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="right">{v}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2}><div className="empty">Sin visitas en el rango.</div></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
