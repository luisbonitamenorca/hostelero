import { exigirModulo } from "@/lib/supabase/server";
import type { CentroBreve, CuentaPlan } from "@/lib/diario";

/**
 * Cuentas donde se puede imputar un apunte. Se cargan todas (hoy son ~660) y
 * no por páginas: el editor las necesita en un desplegable, y partirlas
 * obligaría a buscar contra el servidor en cada tecla.
 */
export async function cargarCuentas() {
  const { supabase } = await exigirModulo("contabilidad");

  const [{ data, error }, { data: centros }] = await Promise.all([
    supabase.from("fin_plan_cuentas").select("id, codigo, nombre").eq("activo", true).order("codigo"),
    supabase.from("centros").select("id, nombre").order("nombre"),
  ]);

  return {
    supabase,
    cuentas: (data ?? []) as CuentaPlan[],
    centros: (centros ?? []) as CentroBreve[],
    error,
  };
}
