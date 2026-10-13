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

export type PlazoTipo = "dias" | "dia_semana" | "dia_mes";

export type CondicionesProveedor = {
  proveedor_id: string;
  dias_pago: number;
  forma_pago: string | null;
  iban: string | null;
  /** Cómo se interpreta dias_pago (migración 20261013121000). Ausente = 'dias'. */
  plazo_tipo?: PlazoTipo | null;
  /** Día de la semana (1 = lunes … 7) o del mes (1..31) según plazo_tipo. */
  plazo_dia?: number | null;
};

/** Formas de pago que ofrece la ficha. La columna es texto: lo antiguo sigue valiendo. */
export const FORMAS_PAGO = [
  { valor: "transferencia", etiqueta: "Transferencia" },
  { valor: "giro", etiqueta: "Giro / recibo domiciliado" },
  { valor: "tarjeta", etiqueta: "Tarjeta" },
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "confirming", etiqueta: "Confirming" },
  { valor: "pagare", etiqueta: "Pagaré" },
  { valor: "otra", etiqueta: "Otra" },
] as const;

export const DIAS_SEMANA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;

function aIso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Fecha de vencimiento de una factura según las condiciones del proveedor.
 * Función pura (fechas en UTC para que no dependa del huso del servidor):
 *   dias       → fecha + N
 *   dia_semana → fecha + N y después el primer día de la semana indicado
 *                (si fecha + N ya cae en ese día, es ese mismo)
 *   dia_mes    → fecha + N y después el primer día del mes indicado (si el mes
 *                no lo tiene, el último día del mes; si cae justo, ese mismo)
 * Un tipo sin día coherente se trata como 'dias' en vez de romper.
 */
export function calcularVencimiento(
  fechaFactura: string,
  cond: Pick<CondicionesProveedor, "dias_pago" | "plazo_tipo" | "plazo_dia">,
): string {
  const d = new Date(fechaFactura.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) throw new Error(`Fecha no válida: ${fechaFactura}`);
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.trunc(Number(cond.dias_pago) || 0)));

  const tipo = cond.plazo_tipo ?? "dias";
  const dia = cond.plazo_dia ?? null;

  if (tipo === "dia_semana" && dia != null && dia >= 1 && dia <= 7) {
    // getUTCDay: 0 = domingo … 6 = sábado; el nuestro: 1 = lunes … 7 = domingo
    const actual = ((d.getUTCDay() + 6) % 7) + 1;
    const salto = (dia - actual + 7) % 7;
    d.setUTCDate(d.getUTCDate() + salto);
    return aIso(d);
  }

  if (tipo === "dia_mes" && dia != null && dia >= 1 && dia <= 31) {
    const ultimoDelMes = (a: number, m: number) => new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
    let a = d.getUTCFullYear();
    let m = d.getUTCMonth();
    let objetivo = Math.min(dia, ultimoDelMes(a, m));
    if (d.getUTCDate() > objetivo) {
      m += 1;
      if (m > 11) {
        m = 0;
        a += 1;
      }
      objetivo = Math.min(dia, ultimoDelMes(a, m));
    }
    return aIso(new Date(Date.UTC(a, m, objetivo)));
  }

  return aIso(d);
}

/** Texto corto del plazo para la ficha: «a 30 días», «primer lunes tras 30 días», «día 10 tras 60 días». */
export function describirPlazo(cond: Pick<CondicionesProveedor, "dias_pago" | "plazo_tipo" | "plazo_dia">): string {
  const n = Number(cond.dias_pago) || 0;
  const tipo = cond.plazo_tipo ?? "dias";
  if (tipo === "dia_semana" && cond.plazo_dia && cond.plazo_dia >= 1 && cond.plazo_dia <= 7) {
    return `primer ${DIAS_SEMANA[cond.plazo_dia - 1]} tras ${n} días`;
  }
  if (tipo === "dia_mes" && cond.plazo_dia) {
    return `día ${cond.plazo_dia} tras ${n} días`;
  }
  return n === 0 ? "al contado" : `a ${n} días`;
}

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
