import { jsPDF } from "jspdf";
import { euros, numero } from "./importes.ts";

/**
 * Construcción del PDF de una factura expedida. Función pura: recibe los datos
 * ya congelados y devuelve el fichero. Así se puede probar sin base de datos y
 * sin navegador (ver pruebas/pdf.test.ts).
 *
 * Reglas que vienen de la norma, no del gusto (artículos 20 y 21 de la orden):
 *  · QR al principio de la factura, entre 30 y 40 mm, con al menos 2 mm de
 *    margen en blanco alrededor (se dejan 6, que es lo recomendado).
 *  · El texto «QR tributario:» va encima del código.
 *  · Debajo, la frase «Factura verificable en la sede electrónica de la AEAT»,
 *    con letra igual o mayor que el resto de datos de la factura.
 *  · Con retención se muestran los DOS importes, etiquetados y distinguidos:
 *    «Total factura» (el que va en el QR) y «Total a pagar».
 */

export type LineaPdf = {
  concepto: string;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  tipo_iva: number;
  base: number;
};

export type ImpuestoPdf = { impuesto: string; tipo_pct: number; base: number; cuota: number };

export type DatosPdf = {
  emisor: { nombre: string; cif: string; direccion: string | null };
  numero_completo: string;
  fecha_expedicion: string;
  fecha_operacion: string | null;
  descripcion: string | null;
  cliente: {
    nombre_fiscal: string;
    nif: string | null;
    direccion: string | null;
    codigo_postal: string | null;
    municipio: string | null;
    provincia: string | null;
  } | null;
  lineas: LineaPdf[];
  impuestos: ImpuestoPdf[];
  base_total: number;
  cuota_iva_total: number;
  cuota_retencion: number;
  total: number;
  anulada: boolean;
  qrPng: string | null;
  huella: string | null;
};

const MARGEN = 18;
const ANCHO = 210;
const LADO_QR = 35; // dentro del rango 30–40 mm que fija el artículo 21

function fechaCorta(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("es-ES") : "—";
}

export function construirPdfFactura(d: DatosPdf): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const derecha = ANCHO - MARGEN;
  let y = MARGEN;

  // ---- QR arriba, antes del contenido, como manda el artículo 21 ----------
  if (d.qrPng) {
    doc.addImage(d.qrPng, "PNG", MARGEN, y, LADO_QR, LADO_QR);
    doc.setFontSize(8).setTextColor(90);
    doc.text("QR tributario:", MARGEN, y - 2);
    doc.setFontSize(8).setTextColor(0);
    doc.text("Factura verificable en la sede", MARGEN, y + LADO_QR + 4);
    doc.text("electrónica de la AEAT", MARGEN, y + LADO_QR + 8);
  }

  // ---- Emisor, a la derecha del QR ---------------------------------------
  const xEmisor = d.qrPng ? MARGEN + LADO_QR + 12 : MARGEN;
  let yEmisor = y + 2;
  doc.setFontSize(13).setTextColor(0).setFont("helvetica", "bold");
  doc.text(d.emisor.nombre, xEmisor, yEmisor);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(70);
  yEmisor += 5;
  doc.text(d.emisor.cif, xEmisor, yEmisor);
  if (d.emisor.direccion) {
    yEmisor += 4;
    doc.text(d.emisor.direccion, xEmisor, yEmisor);
  }

  yEmisor += 9;
  doc.setFontSize(14).setTextColor(0).setFont("helvetica", "bold");
  doc.text(d.numero_completo, xEmisor, yEmisor);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(70);
  yEmisor += 5;
  doc.text(`Fecha de expedición: ${fechaCorta(d.fecha_expedicion)}`, xEmisor, yEmisor);
  if (d.fecha_operacion) {
    yEmisor += 4;
    doc.text(`Fecha de operación: ${fechaCorta(d.fecha_operacion)}`, xEmisor, yEmisor);
  }

  if (d.anulada) {
    yEmisor += 6;
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(180, 35, 24);
    doc.text("FACTURA ANULADA", xEmisor, yEmisor);
    doc.setFont("helvetica", "normal").setTextColor(0);
  }

  y = Math.max(y + LADO_QR + 14, yEmisor + 10);

  // ---- Destinatario -------------------------------------------------------
  doc.setFontSize(8).setTextColor(120);
  doc.text("FACTURAR A", MARGEN, y);
  y += 5;
  doc.setFontSize(10).setTextColor(0);
  if (d.cliente) {
    doc.setFont("helvetica", "bold").text(d.cliente.nombre_fiscal, MARGEN, y);
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(70);
    y += 4.5;
    if (d.cliente.nif) {
      doc.text(d.cliente.nif, MARGEN, y);
      y += 4;
    }
    if (d.cliente.direccion) {
      doc.text(d.cliente.direccion, MARGEN, y);
      y += 4;
    }
    const localidad = [d.cliente.codigo_postal, d.cliente.municipio, d.cliente.provincia && `(${d.cliente.provincia})`]
      .filter(Boolean)
      .join(" ");
    if (localidad) {
      doc.text(localidad, MARGEN, y);
      y += 4;
    }
  } else {
    doc.text("Factura simplificada — sin destinatario identificado", MARGEN, y);
    y += 4;
  }

  if (d.descripcion) {
    y += 3;
    doc.setFontSize(9).setTextColor(0).text(d.descripcion, MARGEN, y);
    y += 4;
  }

  // ---- Líneas -------------------------------------------------------------
  y += 6;
  const col = { concepto: MARGEN, cant: 108, precio: 130, dto: 152, iva: 168, base: derecha };

  doc.setFontSize(8).setTextColor(120);
  doc.text("CONCEPTO", col.concepto, y);
  doc.text("CANT.", col.cant, y, { align: "right" });
  doc.text("PRECIO", col.precio, y, { align: "right" });
  doc.text("DTO", col.dto, y, { align: "right" });
  doc.text("IVA", col.iva, y, { align: "right" });
  doc.text("BASE", col.base, y, { align: "right" });
  y += 2;
  doc.setDrawColor(210).line(MARGEN, y, derecha, y);
  y += 5;

  doc.setFontSize(9).setTextColor(0);
  for (const l of d.lineas) {
    // Un concepto largo no debe pisar las columnas de la derecha.
    const trozos = doc.splitTextToSize(l.concepto, col.cant - col.concepto - 6) as string[];
    doc.text(trozos, col.concepto, y);
    doc.text(numero(l.cantidad, 2), col.cant, y, { align: "right" });
    doc.text(numero(l.precio_unitario, 2), col.precio, y, { align: "right" });
    doc.text(l.descuento_pct ? `${numero(l.descuento_pct, 0)}%` : "—", col.dto, y, { align: "right" });
    doc.text(`${numero(l.tipo_iva, 0)}%`, col.iva, y, { align: "right" });
    doc.text(numero(l.base, 2), col.base, y, { align: "right" });
    y += Math.max(5, trozos.length * 4.6);
  }

  doc.setDrawColor(210).line(MARGEN, y, derecha, y);
  y += 6;

  // ---- Desglose y totales -------------------------------------------------
  const xEtiqueta = 130;
  doc.setFontSize(9).setTextColor(70);
  doc.text("Base imponible", xEtiqueta, y);
  doc.setTextColor(0).text(euros(d.base_total), derecha, y, { align: "right" });
  y += 5;

  for (const i of d.impuestos.filter((x) => x.impuesto === "IVA")) {
    doc.setTextColor(70).text(`IVA ${numero(i.tipo_pct, 0)}% sobre ${euros(i.base)}`, xEtiqueta, y);
    doc.setTextColor(0).text(euros(i.cuota), derecha, y, { align: "right" });
    y += 5;
  }

  const totalFactura = d.base_total + d.cuota_iva_total;
  const hayRetencion = d.cuota_retencion > 0;

  y += 1;
  doc.setDrawColor(210).line(xEtiqueta, y, derecha, y);
  y += 5;
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(0);
  doc.text("Total factura", xEtiqueta, y);
  doc.text(euros(totalFactura), derecha, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  y += 6;

  if (hayRetencion) {
    doc.setFontSize(9).setTextColor(70);
    for (const i of d.impuestos.filter((x) => x.impuesto === "IRPF")) {
      doc.text(`Retención IRPF ${numero(i.tipo_pct, 0)}% sobre ${euros(i.base)}`, xEtiqueta, y);
      doc.setTextColor(0).text(`-${euros(i.cuota)}`, derecha, y, { align: "right" });
      doc.setTextColor(70);
      y += 5;
    }
    y += 1;
    doc.setDrawColor(210).line(xEtiqueta, y, derecha, y);
    y += 5;
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(0);
    doc.text("Total a pagar", xEtiqueta, y);
    doc.text(euros(d.total), derecha, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 6;
  }

  // ---- Pie ----------------------------------------------------------------
  const yPie = 275;
  doc.setDrawColor(225).line(MARGEN, yPie - 6, derecha, yPie - 6);
  doc.setFontSize(7).setTextColor(120);
  if (d.huella) {
    doc.text(`Huella del registro de facturación: ${d.huella}`, MARGEN, yPie);
  }
  doc.text(`${d.emisor.nombre} · ${d.emisor.cif}`, derecha, yPie, { align: "right" });

  return new Uint8Array(doc.output("arraybuffer"));
}
