import { exigirModulo } from "@/lib/supabase/server";
import PanelDocs, { type Categoria, type Subcategoria, type Documento } from "./PanelDocs";

export const dynamic = "force-dynamic";

/**
 * Repositorio de documentos (ex pestaña Documentos de ratios-bonita).
 * Lecturas bajo RLS con el cliente de sesión; los ficheros viven en el
 * bucket privado `docs` y se sirven con URL firmada bajo demanda.
 */
export default async function PaginaDocs() {
  const { supabase } = await exigirModulo("docs");

  const [{ data: categorias }, { data: subcategorias }, { data: documentos }, { data: centros }] =
    await Promise.all([
      supabase.from("docs_categorias").select("id, nombre, orden").order("orden"),
      supabase
        .from("docs_subcategorias")
        .select("id, categoria_id, nombre, orden")
        .order("orden"),
      supabase
        .from("docs_documentos")
        .select(
          "id, categoria_id, subcategoria_id, centro_id, nombre, descripcion, archivo_nombre, archivo_tipo, archivo_tamano, actualizado_en"
        )
        .order("actualizado_en", { ascending: false }),
      supabase.from("centros").select("id, nombre").order("nombre"),
    ]);

  return (
    <PanelDocs
      categorias={(categorias ?? []) as Categoria[]}
      subcategorias={(subcategorias ?? []) as Subcategoria[]}
      documentos={(documentos ?? []) as Documento[]}
      centros={centros ?? []}
    />
  );
}
