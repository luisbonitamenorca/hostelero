/** Tipos y ayudas de la cartera. */
export type Vencimiento = {
  id: string;
  cuenta_id: string;
  sentido: "cobro" | "pago";
  factura_id: string | null;
  compra_doc_id: string | null;
  // Las facturas de ingreso de Ágora viven como asientos: su vencimiento de
  // cobro cuelga de aquí en vez de en factura_id.
  asiento_id: string | null;
  fecha_vencimiento: string;
  importe: number;
  importe_liquidado: number;
  estado: "pendiente" | "parcial" | "liquidado" | "anulado";
  forma_pago: string | null;
  notas: string | null;
};

export type CondicionesProveedor = {
  proveedor_id: string;
  dias_pago: number;
  forma_pago: string | null;
  iban: string | null;
};

/** Días que faltan (negativo si ya venció). */
export function diasHasta(fecha: string): number {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const v = new Date(fecha + "T00:00:00");
  return Math.round((v.getTime() - hoy.getTime()) / 86400000);
}

/** Tramo en el que cae un vencimiento, que es como se mira la tesorería. */
export function tramo(fecha: string): "vencido" | "30" | "60" | "90" | "mas" {
  const d = diasHasta(fecha);
  if (d < 0) return "vencido";
  if (d <= 30) return "30";
  if (d <= 60) return "60";
  if (d <= 90) return "90";
  return "mas";
}

export const NOMBRE_TRAMO: Record<string, string> = {
  vencido: "Vencido",
  "30": "Hasta 30 días",
  "60": "31 a 60 días",
  "90": "61 a 90 días",
  mas: "Más de 90 días",
};
