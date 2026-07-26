import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Database } from "@hostelero/db";

export async function crearClienteServidor() {
  const almacenCookies = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return almacenCookies.getAll();
        },
        setAll(cookiesAEscribir) {
          try {
            cookiesAEscribir.forEach(({ name, value, options }) =>
              almacenCookies.set(name, value, options)
            );
          } catch {
            // Llamado desde un Server Component: el middleware refresca la sesión.
          }
        },
      },
    }
  );
}

/**
 * Exige sesión de operador de Hostelero. Redirige a /login sin sesión
 * y a /no-autorizado si el usuario existe pero no es operador.
 */
export async function exigirOperador() {
  const supabase = await crearClienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: operador } = await supabase
    .from("operadores")
    .select("id, correo, nombre")
    .eq("id", user.id)
    .maybeSingle();

  if (!operador) redirect("/no-autorizado");

  return { supabase, operador };
}
