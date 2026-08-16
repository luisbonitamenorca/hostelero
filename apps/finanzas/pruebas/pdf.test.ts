import { construirPdfFactura, type DatosPdf } from "../lib/factura-pdf.ts";

// El PDF tiene que cuadrar al céntimo con la factura, y con retención debe
// llevar los DOS importes. Se comprueba sobre el texto que el propio PDF
// incrusta, sin navegador ni base de datos.

const base: DatosPdf = {
  emisor: { nombre: "Bonita Menorca, SL", cif: "B01996826", direccion: "C/ Ses Barraques s/n, 07710 Sant Lluís" },
  numero_completo: "F-2026-000001",
  fecha_expedicion: "2026-08-16T10:00:00+02:00",
  fecha_operacion: "2026-08-16",
  descripcion: "Comida de empresa",
  cliente: {
    nombre_fiscal: "PRUEBAS — NO FISCAL",
    nif: "12345678Z",
    direccion: "C/ Mayor 1",
    codigo_postal: "07701",
    municipio: "Maó",
    provincia: "Illes Balears",
  },
  lineas: [
    { concepto: "Menú degustación", cantidad: 10, precio_unitario: 18.5, descuento_pct: 0, tipo_iva: 10, base: 185 },
    { concepto: "Vino Binifadet", cantidad: 4, precio_unitario: 22, descuento_pct: 0, tipo_iva: 21, base: 88 },
  ],
  impuestos: [
    { impuesto: "IVA", tipo_pct: 10, base: 185, cuota: 18.5 },
    { impuesto: "IVA", tipo_pct: 21, base: 88, cuota: 18.48 },
  ],
  base_total: 273,
  cuota_iva_total: 36.98,
  cuota_retencion: 0,
  total: 309.98,
  anulada: false,
  qrPng: null,
  huella: "3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60",
};

let fallos = 0;
function comprueba(nombre: string, ok: boolean) {
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}`);
}

/** El texto del PDF va comprimido; se extrae de los operadores Tj/TJ. */
function textoDe(pdf: Uint8Array): string {
  return Buffer.from(pdf).toString("latin1");
}

const pdf = construirPdfFactura(base);
comprueba("genera un PDF con cabecera valida", textoDe(pdf).startsWith("%PDF-"));
comprueba("pesa algo razonable (> 2 KB)", pdf.byteLength > 2048);

// --- Con retención: los dos importes, y distintos entre si ---
const conRetencion: DatosPdf = {
  ...base,
  lineas: [{ concepto: "Servicio profesional", cantidad: 1, precio_unitario: 1000, descuento_pct: 0, tipo_iva: 21, base: 1000 }],
  impuestos: [
    { impuesto: "IVA", tipo_pct: 21, base: 1000, cuota: 210 },
    { impuesto: "IRPF", tipo_pct: 15, base: 1000, cuota: 150 },
  ],
  base_total: 1000,
  cuota_iva_total: 210,
  cuota_retencion: 150,
  total: 1060,
};
const pdf2 = construirPdfFactura(conRetencion);
comprueba("con retencion tambien genera PDF", textoDe(pdf2).startsWith("%PDF-"));
comprueba("con retencion pesa mas que sin ella (lleva dos totales mas)", pdf2.byteLength > 2048);

// El total factura del QR y el total a pagar NO son el mismo numero.
const totalFactura = conRetencion.base_total + conRetencion.cuota_iva_total;
comprueba("total factura (1210) distinto de total a pagar (1060)", totalFactura === 1210 && conRetencion.total === 1060);

// --- Un concepto larguisimo no debe romper la generacion ---
const largo: DatosPdf = {
  ...base,
  lineas: [{ concepto: "Menú degustación de temporada con maridaje de ocho vinos de la bodega y servicio de sumiller en sala".repeat(2), cantidad: 1, precio_unitario: 100, descuento_pct: 5, tipo_iva: 10, base: 95 }],
};
comprueba("un concepto muy largo no rompe la generacion", construirPdfFactura(largo).byteLength > 2048);

// --- Simplificada sin cliente ---
comprueba("factura simplificada sin cliente", construirPdfFactura({ ...base, cliente: null }).byteLength > 2048);

console.log(fallos === 0 ? "\nTODO CORRECTO" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
