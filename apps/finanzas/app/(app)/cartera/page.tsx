import Link from "next/link";
import { exigirFacturacion } from "@/lib/supabase/server";
import { euros, fecha as formatoFecha } from "@/lib/importes";
import { diasHasta, tramo, NOMBRE_TRAMO, type Vencimiento } from "@/lib/cartera";
import { paginar } from "@/lib/paginar";
import FilaVencimiento from "./fila-vencimiento";

export const dynamic = "force-dynamic";

const TRAMOS = ["vencido", "30", "60", "90", "mas"] as const;

export default async function Cartera({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string; q?: string }>;
}) {
  const { ver = "pendientes", q: qCrudo = "" } = await searchParams;
  const q = qCrudo.trim().toLowerCase();
  const { supabase } = await exigirFacturacion();
  const db = supabase;

  const vencimientos = (await paginar((d, h) => {
    let c = db
      .from("fin_vencimientos")
      .select("id, sentido, factura_id, compra_doc_id, asiento_id, fecha_vencimiento, importe, importe_liquidado, estado, forma_pago, notas")
      .order("fecha_vencimiento")
      .range(d, h);
    if (ver === "pendientes") c = c.in("estado", ["pendiente", "parcial"]);
    return c;
  })) as Vencimiento[];
  const error = null;

  // Nombres para que la lista se lea: de quién es cada cobro y cada pago.
  const idsFactura = vencimientos.map((v) => v.factura_id).filter(Boolean) as string[];
  const idsCompra = vencimientos.map((v) => v.compra_doc_id).filter(Boolean) as string[];
  const idsAsiento = vencimientos.map((v) => v.asiento_id).filter(Boolean) as string[];

  const [{ data: facturas }, { data: compras }, { data: asientosIngreso }] = await Promise.all([
    idsFactura.length
      ? supabase.from("fin_facturas").select("id, numero_completo, cliente_id").in("id", idsFactura)
      : Promise.resolve({ data: [] }),
    idsCompra.length
      ? db.from("compras_doc").select("id, proveedor, num_documento").in("id", idsCompra)
      : Promise.resolve({ data: [] }),
    idsAsiento.length
      ? supabase.from("fin_asientos").select("id, descripcion").in("id", idsAsiento)
      : Promise.resolve({ data: [] }),
  ]);

  const idsCliente = (facturas ?? []).map((f) => f.cliente_id).filter(Boolean) as string[];
  const { data: clientes } = idsCliente.length
    ? await supabase.from("fin_clientes").select("id, nombre_fiscal").in("id", idsCliente)
    : { data: [] };

  const nombreCliente = new Map((clientes ?? []).map((c) => [c.id, c.nombre_fiscal]));
  const infoFactura = new Map(
    (facturas ?? []).map((f) => [
      f.id,
      { numero: f.numero_completo, quien: f.cliente_id ? (nombreCliente.get(f.cliente_id) ?? "—") : "—" },
    ]),
  );
  const infoCompra = new Map(
    (compras ?? []).map((c: { id: string; proveedor: string | null; num_documento: string | null }) => [
      c.id,
      { numero: c.num_documento, quien: c.proveedor ?? "—" },
    ]),
  );
  // Facturas de ingreso (Ágora): número y cliente salen de la descripción del
  // asiento: «Fra. FV-X (Cliente)».
  const infoAsiento = new Map(
    (asientosIngreso ?? []).map((a: { id: string; descripcion: string | null }) => {
      const m = (a.descripcion ?? "").match(/^Fra\. (\S+) \((.+)\)$/);
      return [a.id, { numero: m ? m[1] : "asiento", quien: m ? m[2] : (a.descripcion ?? "—") }];
    }),
  );

  // El buscador filtra por quién (cliente/proveedor) o número de documento;
  // los nombres llegan de los mapas de arriba, así que se filtra aquí.
  const pasaBusqueda = (v: Vencimiento) => {
    if (!q) return true;
    const info = v.factura_id
      ? infoFactura.get(v.factura_id)
      : v.compra_doc_id
        ? infoCompra.get(v.compra_doc_id)
        : v.asiento_id
          ? infoAsiento.get(v.asiento_id)
          : null;
    return !!info && (`${info.quien ?? ""} ${info.numero ?? ""}`.toLowerCase().includes(q));
  };
  const cobros = vencimientos.filter((v) => v.sentido === "cobro" && pasaBusqueda(v));
  const pagos = vencimientos.filter((v) => v.sentido === "pago" && pasaBusqueda(v));

  function pendienteDe(v: Vencimiento) {
    return Number(v.importe) - Number(v.importe_liquidado);
  }

  function resumen(lista: Vencimiento[]) {
    const abiertos = lista.filter((v) => v.estado === "pendiente" || v.estado === "parcial");
    const porTramo = new Map<string, number>();
    for (const v of abiertos) {
      const t = tramo(v.fecha_vencimiento);
      porTramo.set(t, (porTramo.get(t) ?? 0) + pendienteDe(v));
    }
    return { total: abiertos.reduce((s, v) => s + pendienteDe(v), 0), porTramo };
  }

  const resCobros = resumen(cobros);
  const resPagos = resumen(pagos);

  function Bloque({ titulo, lista, res, vacio }: { titulo: string; lista: Vencimiento[]; res: ReturnType<typeof resumen>; vacio: string }) {
    return (
      <section style={{ marginBottom: 32 }}>
        <div className="cabecera-pagina con-accion" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{titulo}</h2>
            <p className="sub">{euros(res.total)} pendiente</p>
          </div>
        </div>

        {res.total !== 0 && (
          <div className="tarjetas" style={{ marginBottom: 12 }}>
            {TRAMOS.map((t) => (
              <div className="tarjeta" key={t}>
                <p className="etiqueta">{NOMBRE_TRAMO[t]}</p>
                <p className={t === "vencido" && (res.porTramo.get(t) ?? 0) !== 0 ? "valor dato alerta" : "valor dato"}>
                  {euros(res.porTramo.get(t) ?? 0)}
                </p>
              </div>
            ))}
          </div>
        )}

        {lista.length === 0 ? (
          <div className="estado-vacio">
            <strong>{vacio}</strong>
          </div>
        ) : (
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Vence</th>
                  <th>{titulo === "Cobros" ? "Cliente" : "Proveedor"}</th>
                  <th>Documento</th>
                  <th className="a-derecha">Importe</th>
                  <th className="a-derecha">Pendiente</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lista.map((v) => {
                  const info = v.factura_id
                    ? infoFactura.get(v.factura_id)
                    : v.compra_doc_id
                      ? infoCompra.get(v.compra_doc_id)
                      : v.asiento_id
                        ? infoAsiento.get(v.asiento_id)
                        : undefined;
                  const dias = diasHasta(v.fecha_vencimiento);
                  const abierto = v.estado === "pendiente" || v.estado === "parcial";
                  return (
                    <tr key={v.id} className={v.estado === "anulado" ? "fila-inactiva" : undefined}>
                      <td className="dato">
                        {formatoFecha(v.fecha_vencimiento)}
                        {abierto && dias < 0 && <span className="etiqueta-estado">{-dias} d</span>}
                      </td>
                      <td>{info?.quien ?? "—"}</td>
                      <td className="dato">
                        {v.factura_id ? (
                          <Link className="enlace" href={`/facturas/${v.factura_id}`}>
                            {info?.numero ?? "ver"}
                          </Link>
                        ) : v.asiento_id ? (
                          <Link className="enlace" href={`/asientos/${v.asiento_id}`}>
                            {info?.numero ?? "ver"}
                          </Link>
                        ) : (
                          (info?.numero ?? "—")
                        )}
                      </td>
                      <td className="numero">{euros(Number(v.importe))}</td>
                      <td className="numero">{euros(pendienteDe(v))}</td>
                      <td>
                        {v.estado === "liquidado"
                          ? titulo === "Cobros"
                            ? "cobrado"
                            : "pagado"
                          : v.estado === "parcial"
                            ? "parcial"
                            : v.estado === "anulado"
                              ? "anulado"
                              : "pendiente"}
                      </td>
                      <td className="a-derecha">
                        <FilaVencimiento
                          id={v.id}
                          pendiente={pendienteDe(v)}
                          estado={v.estado}
                          sentido={v.sentido}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  }

  return (
    <>
      <div className="cabecera-pagina con-accion">
        <div>
          <h1>Cartera</h1>
          <p className="sub">Qué hay que cobrar, qué hay que pagar y cuándo</p>
        </div>
        <Link className="boton-secundario" href={ver === "pendientes" ? "/cartera?ver=todos" : "/cartera"}>
          {ver === "pendientes" ? "Ver también los liquidados" : "Ver solo lo pendiente"}
        </Link>
      </div>

      <form method="get" style={{ margin: "0 0 14px" }}>
        {ver !== "pendientes" && <input type="hidden" name="ver" value={ver} />}
        <input
          name="q"
          defaultValue={qCrudo}
          placeholder="Buscar por cliente, proveedor o número de documento…"
          style={{ width: "100%", maxWidth: 420, padding: "8px 12px", border: "1px solid #DDE2DF", borderRadius: 8 }}
        />
      </form>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudo cargar la cartera</strong>
          Si acaba de aplicarse la migración, recarga. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && (
        <>
          <Bloque
            titulo="Cobros"
            lista={cobros}
            res={resCobros}
            vacio="No hay cobros pendientes. Se crean solos al expedir una factura."
          />
          <Bloque
            titulo="Pagos"
            lista={pagos}
            res={resPagos}
            vacio="No hay pagos pendientes. Se dan de alta desde Facturas recibidas."
          />

          <p className="pista">
            El cobro y el pago se marcan a mano por ahora. La conciliación automática contra el
            extracto del banco llega con la fase 2: entonces esto se marcará solo y lo manual será la
            excepción.
          </p>
        </>
      )}
    </>
  );
}
