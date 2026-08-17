import { exigirModulo } from "@/lib/supabase/server";
import type { CentroBreve, CuentaPlan } from "@/lib/diario";

/**
 * Cuentas donde se puede imputar un apunte. Se cargan todas (hoy son ~660) y
 * no por páginas: el editor las necesita en un desplegable, y partirlas
 * obligaría a buscar contra el servidor en cada tecla.
 */
export async function cargarCuentas() {
  const { supabase, cuenta } = await exigirModulo("contabilidad");

  // La sociedad se resuelve igual que en guardarAsiento: hoy hay una por
  // cuenta, y cuando haya varias esto pasará a ser una elección del usuario.
  const { data: sociedad } = await supabase
    .from("sociedades").select("id").eq("cuenta_id", cuenta.id).limit(1).maybeSingle();

  // Los centros se filtran por la sociedad porque la RLS de `centros` filtra
  // por CUENTA: en un cliente con varias sociedades el desplegable ofrecería
  // centros de la sociedad hermana, y la base los rechaza — pero al CONFIRMAR,
  // con el asiento ya tecleado y un mensaje que habla de sociedades a quien
  // solo eligió un centro de una lista. Mejor no ofrecerlos.
  const [{ data, error }, { data: centros }] = await Promise.all([
    supabase.from("fin_plan_cuentas").select("id, codigo, nombre").eq("activo", true).order("codigo"),
    supabase.from("centros").select("id, nombre")
      .eq("sociedad_id", sociedad?.id ?? "00000000-0000-0000-0000-000000000000")
      .order("nombre"),
  ]);

  return {
    supabase,
    cuentas: (data ?? []) as CuentaPlan[],
    centros: (centros ?? []) as CentroBreve[],
    error,
  };
}
