import { exigirModulo } from "@/lib/supabase/server";
import type { CuentaPlan } from "@/lib/diario";

/**
 * Cuentas donde se puede imputar un apunte. Se cargan todas (hoy son ~660) y
 * no por páginas: el editor las necesita en un desplegable, y partirlas
 * obligaría a buscar contra el servidor en cada tecla.
 */
export async function cargarCuentas() {
  const { supabase } = await exigirModulo("contabilidad");

  const { data, error } = await supabase
    .from("fin_plan_cuentas")
    .select("id, codigo, nombre")
    .eq("activo", true)
    .order("codigo");

  return { supabase, cuentas: (data ?? []) as CuentaPlan[], error };
}
