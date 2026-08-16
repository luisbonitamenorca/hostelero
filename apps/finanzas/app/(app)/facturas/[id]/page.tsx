import Link from "next/link";
import { notFound } from "next/navigation";
import EditorFactura, { type BorradorExistente } from "../editor";
import { cargarCatalogos } from "../datos";

export const dynamic = "force-dynamic";

export default async function Factura({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, series, clientes, centros, serieDefecto } = await cargarCatalogos();

  const { data: factura } = await supabase
    .from("fin_facturas")
    .select("id, serie_id, tipo, estado, cliente_id, centro_id, fecha_operacion, descripcion_operacion, notas_internas, numero_completo")
    .eq("id", id)
    .maybeSingle();

  if (!factura) notFound();

  if (factura.estado !== "borrador") {
    return (
      <>
        <div className="cabecera-pagina">
          <p className="miga">
            <Link className="enlace" href="/facturas">
              Facturas
            </Link>{" "}
            / {factura.numero_completo ?? "Factura"}
          </p>
          <h1>{factura.numero_completo ?? "Factura expedida"}</h1>
        </div>
        <div className="estado-vacio">
          <strong>Esta factura ya está expedida</strong>
          Su contenido es inmutable por ley. Para corregirla se emite una rectificativa (R1–R5). La
          vista de detalle con huella y QR llega con la expedición.
        </div>
      </>
    );
  }

  const { data: lineas } = await supabase
    .from("fin_factura_lineas")
    .select("concepto, cantidad, precio_unitario, descuento_pct, tipo_iva, tipo_retencion")
    .eq("factura_id", id)
    .order("orden");

  const borrador = { ...factura, lineas: lineas ?? [] } as unknown as BorradorExistente;

  return (
    <>
      <div className="cabecera-pagina">
        <p className="miga">
          <Link className="enlace" href="/facturas">
            Facturas
          </Link>{" "}
          / Borrador
        </p>
        <h1>Borrador de factura</h1>
        <p className="sub">Todo editable mientras no se expida.</p>
      </div>
      <EditorFactura
        series={series}
        clientes={clientes}
        centros={centros}
        serieDefecto={serieDefecto}
        borrador={borrador}
      />
    </>
  );
}
