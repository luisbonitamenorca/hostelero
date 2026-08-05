import { exigirModulo } from "@/lib/supabase/server";
import PanelCurso, { type Inscripcion } from "./PanelCurso";

export const dynamic = "force-dynamic";

/**
 * Panel de Formación (ex admin.html del legado). Lecturas bajo RLS con el
 * cliente de sesión: cuenta_id = cuenta_actual() OR es_operador().
 */
export default async function PaginaCurso() {
  const { supabase } = await exigirModulo("curso");

  const [{ data: inscripciones }, { data: centros }] = await Promise.all([
    supabase
      .from("curso_inscripciones")
      .select(
        "id, nombre, apellidos, dni, dni_purgado_en, email, telefono, centro_id, puesto, estado, nota_final, codigo_certificado, fecha_certificado, creado_en"
      )
      .order("creado_en", { ascending: false }),
    supabase.from("centros").select("id, nombre").order("nombre"),
  ]);

  return (
    <PanelCurso
      inscripciones={(inscripciones ?? []) as Inscripcion[]}
      centros={centros ?? []}
    />
  );
}
