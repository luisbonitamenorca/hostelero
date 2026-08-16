import { redondear, aNumero, calcularLinea, calcularTotales } from "../lib/importes.ts";

let fallos = 0;
function comprueba(nombre: string, obtenido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}: ${JSON.stringify(obtenido)}${ok ? "" : " ≠ " + JSON.stringify(esperado)}`);
}

// --- Redondeo: los casos que rompen un Math.round ingenuo ---
comprueba("1,005 -> 1,01 (half-up, no 1,00 del binario)", redondear(1.005), 1.01);
comprueba("2,675 -> 2,68", redondear(2.675), 2.68);
comprueba("-1,005 -> -1,01 (se aleja del cero)", redondear(-1.005), -1.01);
comprueba("1,004 -> 1,00", redondear(1.004), 1);
comprueba("0,125 -> 0,13", redondear(0.125), 0.13);
comprueba("NaN -> 0", redondear(NaN), 0);

// --- Entrada en formato español ---
comprueba('"1.234,56" -> 1234.56', aNumero("1.234,56"), 1234.56);
comprueba('"1234,56" -> 1234.56', aNumero("1234,56"), 1234.56);
comprueba('"1234.56" -> 1234.56', aNumero("1234.56"), 1234.56);
comprueba('"12,50 €" -> 12.5', aNumero("12,50 €"), 12.5);
comprueba('"" -> 0', aNumero(""), 0);

// --- Una línea con IVA 10 y descuento ---
comprueba(
  "3 x 12,40 con 5% dto, IVA 10",
  calcularLinea({ cantidad: 3, precio_unitario: 12.4, descuento_pct: 5, tipo_iva: 10, tipo_retencion: 0 }),
  { base: 35.34, cuota_iva: 3.53, cuota_retencion: 0, total: 38.87 },
);

// --- Factura con dos tipos de IVA (caso típico de hostelería) ---
const t = calcularTotales([
  { cantidad: 10, precio_unitario: 18.5, descuento_pct: 0, tipo_iva: 10, tipo_retencion: 0 },
  { cantidad: 4, precio_unitario: 22.0, descuento_pct: 0, tipo_iva: 21, tipo_retencion: 0 },
]);
comprueba("base total", t.base_total, 273);
comprueba("cuota IVA total (18,50 al 10 + 18,48 al 21)", t.cuota_iva_total, 36.98);
comprueba("total (273 + 36,98)", t.total, 309.98);
comprueba("desglose por tipo", t.desglose_iva, [
  { tipo_pct: 21, base: 88, cuota: 18.48 },
  { tipo_pct: 10, base: 185, cuota: 18.5 },
]);

// --- Retención de profesional (IRPF 15%) ---
const p = calcularTotales([
  { cantidad: 1, precio_unitario: 1000, descuento_pct: 0, tipo_iva: 21, tipo_retencion: 15 },
]);
comprueba("con retención: base/iva/ret/total", [p.base_total, p.cuota_iva_total, p.cuota_retencion, p.total], [1000, 210, 150, 1060]);

// --- La suma de líneas redondeadas no se vuelve a redondear ---
const c = calcularTotales(Array.from({ length: 3 }, () => ({ cantidad: 1, precio_unitario: 0.335, descuento_pct: 0, tipo_iva: 21, tipo_retencion: 0 })));
comprueba("tres líneas de 0,335 -> base 1,02 (0,34 x 3)", c.base_total, 1.02);

console.log(fallos === 0 ? "\nTODO CORRECTO" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
