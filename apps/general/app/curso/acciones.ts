"use server";

import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/supabase/server";

type R = { ok: boolean; error?: string };

/**
 * Elimina una inscripción NO acabada (y sus intentos), para limpiar las
 * estadísticas de gente que empezó el curso varias veces. Las aprobadas no
 * se tocan jamás: son la prueba de la formación ante una inspección, y el
 * guard es del servidor — el botón del panel solo es comodidad.
 */
export async function borrarInscripcion(id: string): Promise<R> {
  const { supabase } = await exigirModulo("curso");

  const { data: insc } = await supabase
    .from("curso_inscripciones")
    .select("id, estado")
    .eq("id", id)
    .maybeSingle();
  if (!insc) return { ok: false, error: "Inscripción no encontrada." };
  if (insc.estado === "aprobado") {
    return { ok: false, error: "Una inscripción aprobada no se puede eliminar: es la prueba de la formación." };
  }

  // Primero los intentos (FK), luego la inscripción.
  const { error: errIntentos } = await supabase
    .from("curso_intentos")
    .delete()
    .eq("inscripcion_id", insc.id);
  if (errIntentos) return { ok: false, error: "No se han podido eliminar los intentos." };

  const { error } = await supabase.from("curso_inscripciones").delete().eq("id", insc.id);
  if (error) return { ok: false, error: "No se ha podido eliminar la inscripción." };

  revalidatePath("/curso");
  return { ok: true };
}
