import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
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

/**
 * Quién entra a las finanzas. Mismo criterio que apps/general, con los módulos
 * del área añadidos donde toca: administración lleva facturación y contabilidad,
 * y dirección lo ve todo. Pasará a tabla cuando haya más roles en uso.
 */
export const ACCESO_POR_ROL: Record<string, string[] | null> = {
  direccion: null,
  jefe_sala: [],
  administracion: ["facturacion", "contabilidad", "bancos", "impuestos", "remesas"],
  empleado: [],
};

/**
 * Exige sesión + módulo contratado y activo para la cuenta + permitido por rol.
 * Devuelve además la sociedad sobre la que se factura.
 */
export async function exigirModulo(moduloId: string) {
  const { supabase, perfil, cuenta } = await exigirPerfil();

  const { data: contratacion } = await supabase
    .from("modulos_contratados")
    .select("activo")
    .eq("cuenta_id", cuenta.id)
    .eq("modulo_id", moduloId)
    .maybeSingle();

  const permitidos = ACCESO_POR_ROL[perfil.rol] ?? null;
  const conAcceso =
    contratacion?.activo === true &&
    (permitidos === null || permitidos.includes(moduloId));

  if (!conAcceso) notFound();

  return { supabase, perfil, cuenta };
}

/**
 * Contexto de facturación: módulo + sociedad emisora. Hoy Bonita tiene una sola
 * sociedad; cuando haya varias, esto pasará a ser una elección del usuario.
 */
export async function exigirFacturacion() {
  const ctx = await exigirModulo("facturacion");

  const { data: sociedad } = await ctx.supabase
    .from("sociedades")
    .select("id, nombre, cif")
    .eq("cuenta_id", ctx.cuenta.id)
    .order("nombre")
    .limit(1)
    .maybeSingle();

  return { ...ctx, sociedad };
}
