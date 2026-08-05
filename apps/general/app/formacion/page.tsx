import type { Metadata } from "next";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/publico";
import FormacionApp from "./FormacionApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Formación de Manipulador de Alimentos · Bonita Menorca",
  description:
    "Curso interno de higiene y seguridad alimentaria para el personal de Bonita Menorca.",
};

/**
 * Front público del curso de Manipulador. Sin sesión: todo lo que toca datos
 * pasa por los route handlers de /api/publico/curso con service key. Aquí solo
 * se resuelven los centros de la cuenta para el desplegable del registro.
 */
export default async function PaginaFormacion() {
  const sb = crearClienteServicio();
  const { data } = sb
    ? await sb
        .from("centros")
        .select("id, nombre")
        .eq("cuenta_id", CUENTA_PUBLICA)
        .order("nombre")
    : { data: [] };

  return <FormacionApp centros={data ?? []} />;
}
