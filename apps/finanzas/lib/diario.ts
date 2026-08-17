/**
 * Tipos del diario y el único punto sin tipar del módulo.
 *
 * fin_asientos y fin_apuntes SÍ están en packages/db/types.ts (vienen de la
 * F0), pero la función fin_confirmar_asiento no: los tipos se generan desde la
 * base y la F5a todavía no está aplicada. Al aplicarla y regenerar, este
 * archivo se queda solo con los tipos y `clienteDiario` sobra.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type LineaAsiento = {
  cuentaPlanId: string;
  centroId: string | null;
  descripcion: string | null;
  debe: number;
  haber: number;
};

export type CentroBreve = { id: string; nombre: string };

export type CuentaPlan = { id: string; codigo: string; nombre: string };

export type AsientoCabecera = {
  id: string;
  numero: number | null;
  fecha: string;
  descripcion: string | null;
  estado: "borrador" | "confirmado";
  origen_tipo: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clienteDiario(supabase: unknown): SupabaseClient<any, "public", any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as SupabaseClient<any, "public", any>;
}
