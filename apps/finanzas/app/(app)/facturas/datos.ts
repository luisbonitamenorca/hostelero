import { exigirFacturacion } from "@/lib/supabase/server";

/** Catálogos que necesita el editor de borradores. */
export async function cargarCatalogos() {
  const { supabase } = await exigirFacturacion();

  const [rSeries, rClientes, rCentros, rConfig] = await Promise.all([
    supabase.from("fin_series").select("id, codigo, ejercicio, tipo_defecto, activa").order("ejercicio", { ascending: false }).order("codigo"),
    supabase.from("fin_clientes").select("id, nombre_fiscal, nif, tipo_iva_defecto, retencion_pct").eq("activo", true).order("nombre_fiscal"),
    supabase.from("centros").select("id, nombre").order("nombre"),
    supabase.from("fin_config").select("serie_defecto_id").limit(1).maybeSingle(),
  ]);

  return {
    supabase,
    series: rSeries.data ?? [],
    clientes: rClientes.data ?? [],
    centros: rCentros.data ?? [],
    serieDefecto: rConfig.data?.serie_defecto_id ?? null,
  };
}
