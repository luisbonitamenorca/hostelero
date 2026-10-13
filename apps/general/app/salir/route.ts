import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** «Salir» para los HTML heredados: la banda de Jano (lib/banda-jano.ts) no
 *  puede llamar a la acción de servidor cerrarSesion, así que enlaza aquí.
 *  Hace exactamente lo mismo: cierra la sesión y manda al login. */
export async function GET() {
  const supabase = await crearClienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}
