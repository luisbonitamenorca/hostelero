import QRCode from "qrcode";
import { exigirFacturacion } from "@/lib/supabase/server";
import { construirPdfFactura, type DatosPdf } from "@/lib/factura-pdf";

// jsPDF no corre en el runtime edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_peticion: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, cuenta } = await exigirFacturacion();

  const { data: factura } = await supabase
    .from("fin_facturas")
    .select(
      "id, cuenta_id, sociedad_id, numero_completo, estado, fecha_expedicion, fecha_operacion, descripcion_operacion, cliente_id, base_total, cuota_iva_total, cuota_retencion, total",
    )
    .eq("id", id)
    .maybeSingle();

  if (!factura) {
    return new Response("Factura no encontrada", { status: 404 });
  }

  // La RLS ya filtra por cuenta, pero esto es una descarga: se comprueba igual.
  if (factura.cuenta_id !== cuenta.id) {
    return new Response("Sin permiso sobre esta factura", { status: 403 });
  }

  // Un borrador no tiene número ni registro: no hay factura que imprimir.
  if (factura.estado === "borrador") {
    return new Response("Un borrador no tiene PDF: primero hay que expedirlo", { status: 409 });
  }

  const [{ data: sociedad }, { data: cliente }, { data: lineas }, { data: impuestos }, { data: registro }] =
    await Promise.all([
      supabase.from("sociedades").select("nombre, cif, direccion").eq("id", factura.sociedad_id).maybeSingle(),
      factura.cliente_id
        ? supabase
            .from("fin_clientes")
            .select("nombre_fiscal, nif, direccion, codigo_postal, municipio, provincia")
            .eq("id", factura.cliente_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("fin_factura_lineas")
        .select("concepto, cantidad, precio_unitario, descuento_pct, tipo_iva, base")
        .eq("factura_id", id)
        .order("orden"),
      supabase.from("fin_factura_impuestos").select("impuesto, tipo_pct, base, cuota").eq("factura_id", id),
      supabase
        .from("fin_verifactu_registros")
        .select("huella, payload")
        .eq("factura_id", id)
        .eq("tipo_registro", "alta")
        .maybeSingle(),
    ]);

  if (!sociedad?.cif) {
    return new Response("La sociedad emisora no tiene CIF", { status: 409 });
  }

  // El QR sale del registro, no se recalcula: tiene que ser exactamente el que
  // se selló al expedir. Nivel M de corrección, como fija el artículo 21.
  const contenidoQr = (registro?.payload as { qr?: string } | null)?.qr ?? null;
  const qrPng = contenidoQr
    ? await QRCode.toDataURL(contenidoQr, { errorCorrectionLevel: "M", margin: 1, width: 600 })
    : null;

  const datos: DatosPdf = {
    emisor: { nombre: sociedad.nombre, cif: sociedad.cif, direccion: sociedad.direccion },
    numero_completo: factura.numero_completo ?? "",
    fecha_expedicion: factura.fecha_expedicion ?? "",
    fecha_operacion: factura.fecha_operacion,
    descripcion: factura.descripcion_operacion,
    cliente: cliente ?? null,
    lineas: (lineas ?? []).map((l) => ({
      concepto: l.concepto,
      cantidad: Number(l.cantidad),
      precio_unitario: Number(l.precio_unitario),
      descuento_pct: Number(l.descuento_pct),
      tipo_iva: Number(l.tipo_iva),
      base: Number(l.base),
    })),
    impuestos: (impuestos ?? []).map((i) => ({
      impuesto: i.impuesto,
      tipo_pct: Number(i.tipo_pct),
      base: Number(i.base),
      cuota: Number(i.cuota),
    })),
    base_total: Number(factura.base_total),
    cuota_iva_total: Number(factura.cuota_iva_total),
    cuota_retencion: Number(factura.cuota_retencion),
    total: Number(factura.total),
    anulada: factura.estado === "anulada",
    qrPng,
    huella: registro?.huella ?? null,
  };

  const pdf = construirPdfFactura(datos);

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${factura.numero_completo ?? "factura"}.pdf"`,
      // Documento congelado: no cambia nunca. Pero es privado, así que la
      // caché es del navegador de quien lo descarga, no compartida.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
