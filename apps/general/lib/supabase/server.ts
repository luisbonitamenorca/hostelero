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
 * Exige sesión de usuario de cuenta (perfil). Redirige a /login sin sesión
 * y a /no-autorizado si el usuario no está vinculado a ninguna cuenta.
 * Devuelve el perfil con su cuenta.
 */
export async function exigirPerfil() {
  const supabase = await crearClienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: perfil } = await supabase
    .from("perfiles")
    .select("id, correo, nombre, rol, cuenta_id, cuentas(id, nombre, plan, estado)")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil || !perfil.cuentas) redirect("/no-autorizado");

  return { supabase, perfil, cuenta: perfil.cuentas };
}

/** Módulos visibles por rol. null = todos. Pasará a tabla cuando haya más roles en uso. */
export const ACCESO_POR_ROL: Record<string, string[] | null> = {
  direccion: null,
  jefe_sala: ["reservas", "visitas", "tpv", "rrhh"],
  administracion: ["compras", "docs", "crm"],
};
