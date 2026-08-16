/** Tipos y ayudas de las remesas. */
export type CuentaBancaria = {
  id: string;
  nombre: string;
  iban: string;
  bic: string | null;
  activa: boolean;
  sociedad_id: string;
};

export type Mandato = {
  id: string;
  cliente_id: string;
  referencia: string;
  tipo: "CORE" | "B2B";
  fecha_firma: string;
  iban: string;
  estado: "activo" | "revocado";
  usado: boolean;
};

export type Remesa = {
  id: string;
  sentido: "cobro" | "pago";
  banco_cuenta_id: string;
  concepto: string | null;
  fecha_ejecucion: string;
  estado: "borrador" | "generada" | "enviada" | "cerrada" | "anulada";
  total: number;
  num_items: number;
  creado_en: string;
};

export type ItemRemesa = {
  id: string;
  vencimiento_id: string;
  importe: number;
  nombre: string;
  iban: string;
  bic: string | null;
  mandato_ref: string | null;
  mandato_fecha: string | null;
  secuencia: "FRST" | "RCUR" | "OOFF" | "FNAL" | null;
  concepto: string | null;
  referencia: string | null;
};

export const ESTADO_REMESA: Record<string, string> = {
  borrador: "en borrador",
  generada: "fichero generado",
  enviada: "enviada al banco",
  cerrada: "cerrada",
  anulada: "anulada",
};
