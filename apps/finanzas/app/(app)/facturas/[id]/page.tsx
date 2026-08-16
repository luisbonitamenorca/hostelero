import Link from "next/link";
import { notFound } from "next/navigation";
import EditorFactura, { type BorradorExistente } from "../editor";
import DetalleFactura, { type FacturaExpedida } from "../detalle";
import { cargarCatalogos } from "../datos";

export const dynamic = "force-dynamic";

export default async function Factura({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, series, clientes, centros, serieDefecto } = await cargarCatalogos();

  const { data: factura } = await supabase
    .from("fin_facturas")
    .select(
      "id, serie_id, tipo, estado, cliente_id, centro_id, fecha_operacion, descripcion_operacion, notas_internas, numero_completo, fecha_expedicion, base_total, cuota_iva_total, cuota_retencion, total",
    )
    .eq("id", id)
    .maybeSingle();

  if (!factura) notFound();

  const { data: lineas } = await supabase
    .from("fin_factura_lineas")
    .select("orden, concepto, cantidad, precio_unitario, descuento_pct, tipo_iva, tipo_retencion, base, cuota_iva")
    .eq("factura_id", id)
    .order("orden");

  // ---------------------------------------------------------------- borrador
  if (factura.estado === "borrador") {
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

  // -------------------------------------------------- expedida o anulada
  const [{ data: cliente }, { data: impuestos }, { data: registros }] = await Promise.all([
    factura.cliente_id
      ? supabase
          .from("fin_clientes")
          .select("nombre_fiscal, nif, direccion, codigo_postal, municipio, provincia")
          .eq("id", factura.cliente_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("fin_factura_impuestos").select("impuesto, tipo_pct, base, cuota").eq("factura_id", id),
    supabase
      .from("fin_verifactu_registros")
      .select("id, tipo_registro, orden, huella, huella_anterior, fecha_hora_registro, payload")
      .eq("factura_id", id)
      .order("orden"),
  ]);

  const registroAlta = (registros ?? []).find((r) => r.tipo_registro === "alta");
  const { data: envio } = registroAlta
    ? await supabase
        .from("fin_verifactu_envios")
        .select("estado, csv_aeat, intento")
        .eq("registro_id", registroAlta.id)
        .order("intento", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const detalle = {
    ...factura,
    cliente: cliente ?? null,
    lineas: lineas ?? [],
    impuestos: impuestos ?? [],
    registros: registros ?? [],
    envio: envio ?? null,
  } as unknown as FacturaExpedida;

  return (
    <>
      <div className="cabecera-pagina">
        <p className="miga">
          <Link className="enlace" href="/facturas">
            Facturas
          </Link>{" "}
          / {factura.numero_completo ?? "Factura"}
        </p>
        <h1>{factura.numero_completo}</h1>
        <p className="sub">
          Contenido inmutable por ley. Para corregirla se emite una rectificativa (R1–R5).
        </p>
      </div>
      <DetalleFactura factura={detalle} />
    </>
  );
}
