import { exigirModulo } from "@/lib/supabase/server";
import { euros, fecha } from "@/lib/importes";
import Buscador from "../clientes/buscador";

export const dynamic = "force-dynamic";

const LIMITE = 200;

function limpiarBusqueda(texto: string): string {
  return texto.replace(/[,()*%\\]/g, " ").trim();
}

export default async function FacturasRecibidas({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const { supabase } = await exigirModulo("compras");

  let consulta = supabase
    .from("compras_doc")
    .select("id, fecha, proveedor, proveedor_nif, num_documento, base, iva, total, estado, centro_id, imagen_url, origen")
    .eq("tipo", "factura")
    .order("fecha", { ascending: false })
    .limit(LIMITE);

  const termino = limpiarBusqueda(q);
  if (termino) {
    consulta = consulta.or(
      `proveedor.ilike.%${termino}%,proveedor_nif.ilike.%${termino}%,num_documento.ilike.%${termino}%`,
    );
  }

  const [{ data, error }, { data: centros }] = await Promise.all([
    consulta,
    supabase.from("centros").select("id, nombre"),
  ]);

  const nombreCentro = new Map((centros ?? []).map((c) => [c.id, c.nombre]));
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
                  <th>Fecha</th>
                  <th>Proveedor</th>
                  <th>Número</th>
                  <th>Centro</th>
                  <th className="a-derecha">Base</th>
                  <th className="a-derecha">IVA</th>
                  <th className="a-derecha">Total</th>
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
                    <td>{f.centro_id ? (nombreCentro.get(f.centro_id) ?? "—") : "—"}</td>
                    <td className="numero">{euros(Number(f.base ?? 0))}</td>
                    <td className="numero">{euros(Number(f.iva ?? 0))}</td>
                    <td className="numero">{euros(Number(f.total ?? 0))}</td>
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
        módulo de compras. Duplicar el alta aquí daría dos verdades. Lo que falta por construir es
        lo financiero — vencimiento, estado de pago y conciliación —, que engancha con bancos.
      </p>
    </>
  );
}
