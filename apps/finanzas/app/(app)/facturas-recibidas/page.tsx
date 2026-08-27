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
  searchParams: Promise<{ q?: string; orden?: string; dir?: string }>;
}) {
  const { q = "", ...sp } = await searchParams;
  const { supabase } = await exigirModulo("compras");

  const orden = ["fecha", "proveedor", "num_documento", "base", "total", "estado"].includes(sp.orden ?? "") ? sp.orden! : "fecha";
  const dir = sp.dir === "asc" ? "asc" : "desc";

  let consulta = supabase
    .from("compras_doc")
    // `canal` es el centro en el mundo de Compras (texto, no uuid): la página
    // se escribió contra un esquema previsto con centro_id que el port real
    // no trae. Salió a la luz al regenerar packages/db/types.ts el 25-08-2026.
    .select("id, fecha, proveedor, proveedor_nif, num_documento, base, iva, total, estado, canal, imagen_url, origen")
    .eq("tipo", "factura")
    .order(orden, { ascending: dir === "asc" })
    .order("fecha", { ascending: false })
    .limit(LIMITE);

  const termino = limpiarBusqueda(q);
  if (termino) {
    consulta = consulta.or(
      `proveedor.ilike.%${termino}%,proveedor_nif.ilike.%${termino}%,num_documento.ilike.%${termino}%`,
    );
  }

  const { data, error } = await consulta;

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
            <table className="tabla">
              <thead>
                <tr>
                  {(
                    [
                      ["fecha", "Fecha", ""],
                      ["proveedor", "Proveedor", ""],
                      ["num_documento", "Número", ""],
                      ["", "Centro", ""],
                      ["base", "Base", "a-derecha"],
                      ["", "IVA", "a-derecha"],
                      ["total", "Total", "a-derecha"],
                    ] as const
                  ).map(([campo, titulo, clase]) => (
                    <th key={titulo} className={clase || undefined}>
                      {campo ? (
                        <a
                          href={`?${new URLSearchParams({ ...(q ? { q } : {}), orden: campo, dir: orden === campo && dir === "desc" ? "asc" : "desc" }).toString()}`}
                          style={{ color: "inherit", textDecoration: "none" }}
                          title={`Ordenar por ${titulo.toLowerCase()}`}
                        >
                          {titulo}
                          {orden === campo ? (dir === "asc" ? " ↑" : " ↓") : ""}
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
                    <td className="dato">{fecha(f.fecha)}</td>
                    <td>
                      {f.proveedor ?? "—"}
                      {f.proveedor_nif && <span className="secundario">{f.proveedor_nif}</span>}
                    </td>
                    <td className="dato">{f.num_documento ?? "—"}</td>
                    <td>{f.canal ?? "—"}</td>
                    <td className="numero">{euros(Number(f.base ?? 0))}</td>
                    <td className="numero">{euros(Number(f.iva ?? 0))}</td>
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
          <p className="pie-tabla">
            {filas.length} {filas.length === 1 ? "factura" : "facturas"} · {euros(suma)} en total
            {filas.length === LIMITE && ` · mostrando las ${LIMITE} más recientes`}
          </p>
        </>
      )}

      <p className="pista" style={{ marginTop: 12 }}>
        Solo lectura, y a propósito: el maestro de proveedores y la entrada de facturas viven en el
        módulo de compras. Duplicar el alta aquí daría dos verdades. Lo que sí es nuestro es lo
        financiero: «A cartera» crea el vencimiento de pago con los días que tenga ese proveedor en
        sus condiciones, o 30 si no los tiene puestos.
      </p>
    </>
  );
}
