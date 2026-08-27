import Link from "next/link";
import { exigirFacturacion } from "@/lib/supabase/server";
import { euros, fecha } from "@/lib/importes";

export const dynamic = "force-dynamic";

const LIMITE = 200;

/**
 * Facturas emitidas: las del emisor propio (fin_facturas, llegarán del TPV)
 * MÁS las facturas de ingreso de Ágora, que viven como asientos del diario —
 * nominativas una a una y simplificadas agrupadas por día y centro. Todo en
 * una misma tabla, cada fila enlazando a su detalle (factura o asiento).
 */
export default async function Facturas({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; orden?: string; dir?: string; pag?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const orden = ["numero", "cliente", "tipo", "fecha", "total"].includes(sp.orden ?? "") ? sp.orden! : "fecha";
  const dir = sp.dir === "asc" ? 1 : -1;
  const pag = Math.max(1, parseInt(sp.pag ?? "1", 10) || 1);
  const { supabase } = await exigirFacturacion();

  const rpc = supabase as unknown as {
    rpc: (fn: "fin_facturas_ingreso", args: Record<string, never>) => PromiseLike<{ data: unknown; error: unknown }>;
  };
  const [{ data: propias, error }, ingresoResp] = await Promise.all([
    supabase
      .from("fin_facturas")
      .select("id, numero_completo, tipo, estado, fecha_expedicion, fecha_operacion, total, fin_clientes(nombre_fiscal)")
      .order("creado_en", { ascending: false })
      .limit(500),
    rpc.rpc("fin_facturas_ingreso", {}),
  ]);

  type Ingreso = { asiento_id: string; numero: number; fecha: string; tipo: string; descripcion: string; total: number; cobro: string };
  const ingresos = ((ingresoResp.data as Ingreso[] | null) ?? []);

  // Fila unificada: da igual si nació en el TPV o en Ágora. `cobro` dice si el
  // dinero ya está (caja/banco) o si la factura espera transferencia o giro.
  type Fila = { clave: string; href: string; numero: string; cliente: string; tipo: string; estado: string; fecha: string; total: number; asiento?: { numero: number; href: string } };
  const filasPropias: Fila[] = (propias ?? []).map((f) => {
    const c = Array.isArray(f.fin_clientes) ? f.fin_clientes[0] : f.fin_clientes;
    return {
      clave: `f-${f.id}`,
      href: `/facturas/${f.id}`,
      numero: f.estado === "borrador" ? "borrador" : (f.numero_completo ?? "—"),
      cliente: c?.nombre_fiscal ?? "—",
      tipo: f.tipo ?? "F1",
      estado: f.estado ?? "",
      fecha: f.fecha_expedicion ?? f.fecha_operacion ?? "",
      total: Number(f.total ?? 0),
    };
  });
  const filasIngreso: Fila[] = ingresos.map((a) => {
    const nominativa = a.tipo === "nominativa";
    const m = nominativa ? a.descripcion.match(/^Fra\. (\S+) \((.+)\)$/) : null;
    return {
      clave: `a-${a.asiento_id}`,
      href: `/asientos/${a.asiento_id}`,
      numero: m ? m[1] : "—",
      cliente: m ? m[2] : a.descripcion,
      tipo: nominativa ? "Ágora" : "Ágora · día",
      estado: a.cobro === "pendiente" ? "pendiente de cobro" : `cobrada (${a.cobro})`,
      fecha: a.fecha,
      total: Number(a.total),
      asiento: { numero: a.numero, href: `/asientos/${a.asiento_id}` },
    };
  });

  let filas = [...filasPropias, ...filasIngreso].filter(
    (f) => !q || f.numero.toLowerCase().includes(q) || f.cliente.toLowerCase().includes(q),
  );
  const clave = (f: Fila): string | number => {
    if (orden === "numero") return f.numero;
    if (orden === "cliente") return f.cliente;
    if (orden === "tipo") return f.tipo;
    if (orden === "total") return f.total;
    return f.fecha;
  };
  filas = filas.sort((a, b) => (clave(a) < clave(b) ? -dir : clave(a) > clave(b) ? dir : 0));

  const totalFilas = filas.length;
  const sumaTotal = filas.reduce((s, f) => s + f.total, 0);
  const paginas = Math.max(1, Math.ceil(totalFilas / LIMITE));
  const pagina = filas.slice((pag - 1) * LIMITE, pag * LIMITE);

  const enlace = (cambios: Record<string, string>) => {
    const base: Record<string, string> = {
      ...(sp.q ? { q: sp.q } : {}),
      ...(orden !== "fecha" || sp.dir === "asc" ? { orden, dir: sp.dir === "asc" ? "asc" : "desc" } : {}),
      ...(pag > 1 ? { pag: String(pag) } : {}),
      ...cambios,
    };
    const p = Object.entries(base).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    return `?${p}`;
  };

  return (
    <>
      <div className="cabecera-pagina con-accion">
        <div>
          <h1>Facturas</h1>
          <p className="sub">Facturas emitidas por la sociedad: las del TPV y las de Ágora (nominativas una a una, simplificadas agrupadas por día y centro)</p>
        </div>
        <Link className="boton boton-auto" href="/facturas/nueva">
          Nueva factura
        </Link>
      </div>

      <form method="get" style={{ margin: "0 0 14px" }}>
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Buscar por número o cliente…"
          style={{ width: "100%", maxWidth: 420, padding: "8px 12px", border: "1px solid #DDE2DF", borderRadius: 8 }}
        />
      </form>

      {error != null && (
        <div className="estado-vacio">
          <strong>No se pudieron cargar las facturas</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && totalFilas === 0 && (
        <div className="estado-vacio">
          <strong>{q ? `Ninguna factura coincide con «${sp.q}»` : "Aún no hay facturas"}</strong>
          {q ? "Prueba con parte del número o del cliente." : "Llegarán del TPV; también puedes empezar por un borrador manual."}
        </div>
      )}

      {!error && totalFilas > 0 && (
        <>
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead>
                <tr>
                  {(
                    [
                      ["numero", "Número", ""],
                      ["cliente", "Cliente", ""],
                      ["tipo", "Tipo", ""],
                      ["", "Cobro", ""],
                      ["fecha", "Fecha", ""],
                      ["total", "Total", "a-derecha"],
                      ["", "Asiento", "a-derecha"],
                    ] as const
                  ).map(([campo, titulo, clase]) => (
                    <th key={titulo} className={clase || undefined}>
                      {campo ? (
                        <a href={enlace({ orden: campo, dir: orden === campo && dir === -1 ? "asc" : "desc", pag: "" })} style={{ color: "inherit", textDecoration: "none" }} title={`Ordenar por ${titulo.toLowerCase()}`}>
                          {titulo}
                          {orden === campo ? (dir === 1 ? " ↑" : " ↓") : ""}
                        </a>
                      ) : (
                        titulo
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagina.map((f) => (
                  <tr key={f.clave}>
                    <td className="dato">
                      {f.numero === "—" ? "—" : (
                        <Link className="enlace" href={f.href}>
                          {f.numero}
                        </Link>
                      )}
                    </td>
                    <td>{f.cliente}</td>
                    <td>{f.tipo}</td>
                    <td>
                      {f.estado === "borrador" || f.estado === "anulada" ? (
                        <span className="etiqueta-estado">{f.estado}</span>
                      ) : f.estado === "pendiente de cobro" ? (
                        <span style={{ color: "#B4831A" }}>pendiente de cobro</span>
                      ) : f.estado.startsWith("cobrada") ? (
                        <span style={{ color: "#0F6E56" }}>✓ {f.estado}</span>
                      ) : (
                        f.estado
                      )}
                    </td>
                    <td className="dato">{fecha(f.fecha)}</td>
                    <td className="numero">{euros(f.total)}</td>
                    <td className="a-derecha">
                      {f.asiento ? (
                        <Link className="enlace" href={f.asiento.href}>
                          nº {f.asiento.numero}
                        </Link>
                      ) : (
                        <span className="texto-suave">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", margin: "12px 0" }}>
            <p className="pie-tabla" style={{ margin: 0 }}>
              {totalFilas} {totalFilas === 1 ? "factura" : "facturas"} · {euros(sumaTotal)} en total
            </p>
            <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
              <span className="secundario" style={{ display: "inline" }}>
                {(pag - 1) * LIMITE + 1}–{Math.min(pag * LIMITE, totalFilas)} de {totalFilas}
              </span>
              {pag > 1 && <a className="boton-secundario" style={{ padding: "4px 12px", fontSize: 13 }} href={enlace({ pag: String(pag - 1) })}>← Anteriores</a>}
              {pag < paginas && <a className="boton-secundario" style={{ padding: "4px 12px", fontSize: 13 }} href={enlace({ pag: String(pag + 1) })}>Siguientes →</a>}
            </span>
          </div>
        </>
      )}

      <p className="pista">
        Las filas «Ágora» enlazan a su asiento del diario: las nominativas una a una y las
        simplificadas agrupadas por día y centro (el total del día incluye propinas). El cobro:
        lo que entra por efectivo, tarjeta, Agorapay o Shopify nace <strong>cobrado</strong> (caja);
        las de transferencia o giro quedan <strong>pendientes de cobro</strong> hasta que el banco
        las liquida en la conciliación — esa es la cartera de cobro viva. Las del TPV llegarán aquí
        como facturas propias con su registro Verifactu.
      </p>
    </>
  );
}
