import { exigirFacturacion } from "@/lib/supabase/server";
import type { CentroBreve, CuentaPlan } from "@/lib/diario";
import { paginarEnParalelo } from "@/lib/paginar";

/**
 * Cuentas donde se puede imputar un apunte. Se cargan todas (hoy son 6.400+)
 * para que el editor busque en local sin ir al servidor en cada tecla. Por
 * eso se piden paginadas: de una vez, db-max-rows las cortaba a 1.000 y el
 * editor no ofrecía la mayoría.
 */
export async function cargarCuentas() {
  // exigirFacturacion = exigirModulo("contabilidad") + la sociedad, y ya lo ha
  // resuelto el layout en esta misma petición (va en caché): cero idas extra.
  // Hoy hay una sociedad por cuenta; cuando haya varias esto pasará a ser una
  // elección del usuario.
  const { supabase, sociedad } = await exigirFacturacion();

  // Los centros se filtran por la sociedad porque la RLS de `centros` filtra
  // por CUENTA: en un cliente con varias sociedades el desplegable ofrecería
  // centros de la sociedad hermana, y la base los rechaza — pero al CONFIRMAR,
  // con el asiento ya tecleado y un mensaje que habla de sociedades a quien
  // solo eligió un centro de una lista. Mejor no ofrecerlos.
  const [{ filas: data, error }, { data: centros }] = await Promise.all([
    paginarEnParalelo((d, h, contar) =>
      supabase
        .from("fin_plan_cuentas")
        .select("id, codigo, nombre", contar ? { count: "exact" } : undefined)
        .eq("activo", true)
        .order("codigo")
        .order("id")
        .range(d, h),
    ),
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
