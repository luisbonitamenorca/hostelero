/**
 * Tipos del inmovilizado y el único punto donde se esquiva el tipado.
 * fin_activos y fin_amortizaciones no están todavía en packages/db/types.ts
 * porque la migración F2c no está aplicada. Al aplicarla y regenerar, sobra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clienteActivos(supabase: unknown): SupabaseClient<any, "public", any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as SupabaseClient<any, "public", any>;
}

export const MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
