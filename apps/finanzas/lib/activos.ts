/** Tipos y ayudas del inmovilizado. */
export type Activo = {
  id: string;
  codigo: string | null;
  nombre: string;
  descripcion: string | null;
  centro_id: string | null;
  cuenta_activo_id: string;
  cuenta_amortizacion_id: string | null;
  cuenta_dotacion_id: string | null;
  fecha_alta: string;
  valor_adquisicion: number;
  valor_residual: number;
  anios_vida_util: number;
  proveedor: string | null;
  estado: "alta" | "baja";
  fecha_baja: string | null;
  notas: string | null;
};

export type FilaAmortizacion = {
  id: string;
  ejercicio: number;
  periodo: number;
  importe: number;
  acumulado: number;
  contabilizado: boolean;
};

export const MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
