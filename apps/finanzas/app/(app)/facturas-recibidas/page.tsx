import { exigirModulo } from "@/lib/supabase/server";
import { euros, fecha } from "@/lib/importes";
import { ruta } from "@/lib/rutas";
import Buscador from "../clientes/buscador";
import BotonVencimiento from "./boton-vencimiento";

export const dynamic = "force-dynamic";

const LIMITE = 200;

function limpiarBusqueda(texto: string): string {
  return texto.replace(/[,()*%\\]/g, " ").trim();
}

export default async function FacturasRecibidas({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; orden?: string; dir?: string; pag?: string }>;
}) {
  const { q = "", ...sp } = await searchParams;
  const { supabase } = await exigirModulo("compras");

  const orden = ["fecha", "proveedor", "num_documento", "base", "total", "estado"].includes(sp.orden ?? "") ? sp.orden! : "fecha";
  const dir = sp.dir === "asc" ? "asc" : "desc";
  const pag = Math.max(1, parseInt(sp.pag ?? "1", 10) || 1);
  const termino = limpiarBusqueda(q);

  // La misma consulta dos veces: contada (para paginar) y paginada.
  const filtrar = <T,>(c: T): T => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let r = (c as any).eq("tipo", "factura");
    if (termino) {
      r = r.or(`proveedor.ilike.%${termino}%,proveedor_nif.ilike.%${termino}%,num_documento.ilike.%${termino}%`);
    }
    return r as T;
  };

  const consulta = filtrar(
    supabase
      .from("compras_doc")
      // `canal` es el centro en el mundo de Compras (texto, no uuid): la página
      // se escribió contra un esquema previsto con centro_id que el port real
      // no trae. Salió a la luz al regenerar packages/db/types.ts el 25-08-2026.
      .select("id, fecha, proveedor, proveedor_nif, num_documento, base, iva, total, estado, canal, imagen_url, origen"),
  )
    .order(orden, { ascending: dir === "asc" })
    .order("fecha", { ascending: false })
    .range((pag - 1) * LIMITE, pag * LIMITE - 1);

  const [{ data, error }, { count: totalFiltrado }] = await Promise.all([
    consulta,
    filtrar(supabase.from("compras_doc").select("id", { count: "exact", head: true })),
  ]);

  // Cuáles ya están en cartera. Si la migración F2a aún no está aplicada, la
  // tabla no existe: se sigue adelante sin la columna en vez de romper la
  // pantalla entera.
  const { data: enCartera } = await supabase
    .from("fin_vencimientos")
    .select("compra_doc_id, estado, importe, importe_liquidado")
    .eq("sentido", "pago");

  const conVencimiento = new Set((enCartera ?? []).map((v) => v.compra_doc_id).filter(Boolean));
  // Estado de pago desde la cartera: la conciliación bancaria va liquidando
  // los vencimientos y aquí se ve de un vistazo qué está pagado y qué no.
  const pagoDoc = new Map(
    (enCartera ?? [])
      .filter((v) => v.compra_doc_id)
      .map((v) => [v.compra_doc_id as string, { estado: v.estado, importe: Number(v.importe), liquidado: Number(v.importe_liquidado) }]),
  );

  // El asiento que generó cada factura en el diario (origen_tipo 'compra'
  // apunta al doc de Compras). Si no hay, la factura aún no está contabilizada.
  const { data: asientosCompra } = await supabase
    .from("fin_asientos")
    .select("id, numero, origen_id")
    .eq("origen_tipo", "compra")
    .eq("estado", "confirmado");
  const asientoDoc = new Map((asientosCompra ?? []).map((a) => [a.origen_id, a]));

  const filas = data ?? [];
  const suma = filas.reduce((s, f) => s + Number(f.total ?? 0), 0);
  const total = totalFiltrado ?? filas.length;
  const paginas = Math.max(1, Math.ceil(total / LIMITE));
  const enlace = (cambios: Record<string, string>) => {
    const base: Record<string, string> = {
      ...(q ? { q } : {}),
      ...(orden !== "fecha" || dir !== "desc" ? { orden, dir } : {}),
      ...(pag > 1 ? { pag: String(pag) } : {}),
      ...cambios,
    };
    return `?${Object.entries(base).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
  };
  // El centro, abreviado: si no, la tabla no cabe en pantalla.
  const CENTRO_CORTO: Record<string, string> = {
    "BINIFADET RESTAURANTE": "Binifadet",
    "BINIFADET BODEGA": "Bodega",
    "BINIFADET TIENDA": "Tienda",
    "TAMARINDOS RESTAURANTE": "Tamarindos",
    "TAMARINDOS BAR": "Tam. Bar",
    "CASA TIRANT": "Tirant",
    "COCINA PRODUCCION": "Producción",
    ESTRUCTURA: "Estructura",
  };

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Facturas recibidas</h1>
        <p className="sub">
          Las que emiten tus proveedores. Llegan por el módulo de compras y aquí se consultan con
          ojos de contabilidad.
        </p>
      </div>

      <Buscador q={q} soloActivos={false} sinFiltroActivos etiqueta="Buscar por proveedor, NIF o número de factura…" />

      {error && (
        <div className="estado-vacio">
          <strong>No se pudieron cargar las facturas recibidas</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && filas.length === 0 && (
        <div className="estado-vacio">
          <strong>{termino ? `Ninguna factura coincide con «${termino}»` : "Aún no hay facturas recibidas"}</strong>
          {termino ? "Prueba con parte del proveedor o del número." : "Entran por el módulo de compras."}
        </div>
      )}

      {!error && filas.length > 0 && (
        <>
          <div className="tabla-envoltura">
            <table className="tabla" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  {(
                    [
                      ["fecha", "Fecha", ""],
                      ["proveedor", "Proveedor", ""],
                      ["num_documento", "Número", ""],
                      ["", "Centro", ""],
                      ["base", "Base", "a-derecha"],
                      ["total", "Total", "a-derecha"],
                    ] as const
                  ).map(([campo, titulo, clase]) => (
                    <th key={titulo} className={clase || undefined} style={{ whiteSpace: "nowrap" }}>
                      {campo ? (
                        <a
                          href={enlace({ orden: campo, dir: orden === campo && dir === "desc" ? "asc" : "desc", pag: "" })}
                          style={{ color: "inherit", textDecoration: "none" }}
                          title={`Ordenar por ${titulo.toLowerCase()}`}
                        >
                          {titulo} {orden === campo ? (dir === "asc" ? "↑" : "↓") : "↕"}
                        </a>
                      ) : (
                        titulo
                      )}
                    </th>
                  ))}
                  <th className="a-derecha">Asiento</th>
                  <th className="a-derecha">Pago</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id}>
                    <td className="dato" style={{ whiteSpace: "nowrap" }}>{fecha(f.fecha)}</td>
                    <td title={`${f.proveedor ?? ""} · ${f.proveedor_nif ?? ""}`}>
                      <span style={{ display: "block", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.proveedor ?? "—"}
                      </span>
                    </td>
                    <td className="dato" style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.num_documento ?? ""}>
                      {f.num_documento ?? "—"}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{f.canal ? (CENTRO_CORTO[f.canal] ?? f.canal) : "—"}</td>
                    <td className="numero" title={`IVA ${euros(Number(f.iva ?? 0))}`}>{euros(Number(f.base ?? 0))}</td>
                    <td className="numero">{euros(Number(f.total ?? 0))}</td>
                    <td className="a-derecha">
                      {asientoDoc.has(f.id) ? (
                        <a className="enlace" href={ruta(`/asientos/${asientoDoc.get(f.id)!.id}`)}>
                          nº {asientoDoc.get(f.id)!.numero}
                        </a>
                      ) : (
                        <span className="secundario" style={{ display: "inline" }}>sin asiento</span>
                      )}
                    </td>
                    <td className="a-derecha">
                      {(() => {
                        const p = pagoDoc.get(f.id);
                        if (!p) return <BotonVencimiento id={f.id} yaTiene={conVencimiento.has(f.id)} />;
                        if (p.estado === "liquidado") return <span style={{ color: "#0F6E56", fontWeight: 600 }}>✓ pagada</span>;
                        if (p.estado === "parcial")
                          return <span style={{ color: "#B4831A" }}>{euros(p.liquidado)} de {euros(p.importe)}</span>;
                        return <span className="texto-suave">pendiente</span>;
                      })()}
                    </td>
                    <td className="a-derecha">
                      {f.estado === "REVISAR" && <span className="etiqueta-estado">revisar</span>}
                      {f.imagen_url && (
                        <a className="enlace" href={f.imagen_url} target="_blank" rel="noreferrer">
                          Ver
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", margin: "10px 0" }}>
            <p className="pie-tabla" style={{ margin: 0 }}>
              {total} {total === 1 ? "factura" : "facturas"} · {euros(suma)} en esta página
            </p>
            <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
              <span className="secundario" style={{ display: "inline" }}>
                {(pag - 1) * LIMITE + 1}–{Math.min(pag * LIMITE, total)} de {total}
              </span>
              {pag > 1 && <a className="boton-secundario" style={{ padding: "4px 12px", fontSize: 13 }} href={enlace({ pag: String(pag - 1) })}>← Anteriores</a>}
              {pag < paginas && <a className="boton-secundario" style={{ padding: "4px 12px", fontSize: 13 }} href={enlace({ pag: String(pag + 1) })}>Siguientes →</a>}
            </span>
          </div>
        </>
      )}

      <p className="pista" style={{ marginTop: 12 }}>
        Solo lectura, y a propósito: el maestro de proveedores y la entrada de facturas viven en el
        módulo de compras. Duplicar el alta aquí daría dos verdades. Lo financiero es automático:
        en cuanto una factura queda OK, genera sola su vencimiento en cartera (con los días de las
        condiciones del proveedor, o 30) y la conciliación bancaria lo va liquidando. El botón
        «A cartera» solo aparece como repesca si algo se quedó fuera.
      </p>
    </>
  );
}
