// ÚNICO sitio donde se redondea dinero en el cliente (regla 1 de la casa).
// El servidor recalcula todo al expedir: lo de aquí es para que quien factura
// vea los totales mientras escribe, no la verdad fiscal.
//
// Criterio provisional, el mismo que aplicará fin_expedir_factura: redondeo
// POR LÍNEA, half-up a 2 decimales. Pendiente de contrastar con la
// especificación oficial de la AEAT antes de expedir nada real.

/** Half-up sobre el valor absoluto (0,005 → 0,01; −0,005 → −0,01). */
export function redondear(valor: number, decimales = 2): number {
  if (!Number.isFinite(valor)) return 0;
  const factor = 10 ** decimales;
  // toFixed(6) antes de redondear corrige el error binario: 1,005 * 100 vale
  // 100.49999999999999 en coma flotante y un half-up ingenuo daría 1,00.
  const escalado = Number((valor * factor).toFixed(6));
  const signo = escalado < 0 ? -1 : 1;
  return (signo * Math.round(Math.abs(escalado))) / factor;
}

/** Acepta lo que escribe una persona en España: "1.234,56" y también "1234.56". */
export function aNumero(texto: string): number {
  const t = String(texto).trim().replace(/\s|€/g, "");
  if (!t) return 0;
  // Con coma, el punto es separador de miles. Sin coma, el punto es decimal.
  const limpio = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : NaN;
}

export type LineaBruta = {
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  tipo_iva: number;
  tipo_retencion: number;
};

export type LineaCalculada = {
  base: number;
  cuota_iva: number;
  cuota_retencion: number;
  total: number;
};

export function calcularLinea(l: LineaBruta): LineaCalculada {
  const bruto = l.cantidad * l.precio_unitario;
  const base = redondear(bruto * (1 - l.descuento_pct / 100));
  const cuota_iva = redondear((base * l.tipo_iva) / 100);
  const cuota_retencion = redondear((base * l.tipo_retencion) / 100);
  return { base, cuota_iva, cuota_retencion, total: redondear(base + cuota_iva - cuota_retencion) };
}

export type DesgloseImpuesto = { tipo_pct: number; base: number; cuota: number };

export type Totales = {
  base_total: number;
  cuota_iva_total: number;
  cuota_retencion: number;
  total: number;
  desglose_iva: DesgloseImpuesto[];
};

/** Suma de líneas ya redondeadas: nunca se redondea dos veces. */
export function calcularTotales(lineas: LineaBruta[]): Totales {
  const calculadas = lineas.map((l) => ({ bruta: l, calc: calcularLinea(l) }));

  const base_total = redondear(calculadas.reduce((s, x) => s + x.calc.base, 0));
  const cuota_iva_total = redondear(calculadas.reduce((s, x) => s + x.calc.cuota_iva, 0));
  const cuota_retencion = redondear(calculadas.reduce((s, x) => s + x.calc.cuota_retencion, 0));

  const porTipo = new Map<number, DesgloseImpuesto>();
  for (const { bruta, calc } of calculadas) {
    const actual = porTipo.get(bruta.tipo_iva) ?? { tipo_pct: bruta.tipo_iva, base: 0, cuota: 0 };
    actual.base = redondear(actual.base + calc.base);
    actual.cuota = redondear(actual.cuota + calc.cuota_iva);
    porTipo.set(bruta.tipo_iva, actual);
  }

  return {
    base_total,
    cuota_iva_total,
    cuota_retencion,
    total: redondear(base_total + cuota_iva_total - cuota_retencion),
    desglose_iva: [...porTipo.values()].sort((a, b) => b.tipo_pct - a.tipo_pct),
  };
}

const EUROS = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const NUMERO = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function euros(valor: number): string {
  return EUROS.format(valor);
}

export function numero(valor: number, decimales = 2): string {
  return decimales === 2
    ? NUMERO.format(valor)
    : new Intl.NumberFormat("es-ES", {
        minimumFractionDigits: decimales,
        maximumFractionDigits: decimales,
      }).format(valor);
}

export function fecha(valor: string | null): string {
  return valor ? new Date(valor).toLocaleDateString("es-ES") : "—";
}
