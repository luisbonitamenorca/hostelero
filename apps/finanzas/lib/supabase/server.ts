import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { Database } from "@hostelero/db";
import { ruta } from "@/lib/rutas";

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
 *
 * Los tres guards van envueltos en cache() de React: el layout y la página se
 * pintan en la misma petición y ambos llaman al guard. Sin la caché eran ~9
 * idas a Supabase en serie por pantalla; con ella, cada comprobación se hace
 * una sola vez por petición (la caché muere con la petición, así que no se
 * arrastra nada entre usuarios ni entre visitas).
 */
export const exigirPerfil = cache(async function exigirPerfil() {
  const supabase = await crearClienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(ruta("/login"));

  const { data: perfil } = await supabase
    .from("perfiles")
    .select("id, correo, nombre, rol, cuenta_id, cuentas(id, nombre, plan, estado)")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil || !perfil.cuentas) redirect(ruta("/no-autorizado"));

  return { supabase, perfil, cuenta: perfil.cuentas };
});

/**
 * Quién entra a las finanzas. Mismo criterio que apps/general, con los módulos
 * del área añadidos donde toca: administración lleva facturación y contabilidad,
 * y dirección lo ve todo. Pasará a tabla cuando haya más roles en uso.
 */
export const ACCESO_POR_ROL: Record<string, string[] | null> = {
  direccion: null,
  responsable_area: [],
  jefe_sala: [],
  administracion: ["contabilidad", "bancos", "impuestos", "remesas"],
  empleado: [],
};

/**
 * Exige sesión + módulo contratado y activo para la cuenta + permitido por rol.
 * Devuelve además la sociedad sobre la que se factura.
 */
export const exigirModulo = cache(async function exigirModulo(moduloId: string) {
  const { supabase, perfil, cuenta } = await exigirPerfil();

  const [{ data: contratacion }, { data: veto }, { data: concesion }] = await Promise.all([
    supabase
      .from("modulos_contratados")
      .select("activo")
      .eq("cuenta_id", cuenta.id)
      .eq("modulo_id", moduloId)
      .maybeSingle(),
    // El veto por usuario (módulo Usuarios de hostelero-app) resta sobre lo
    // que el rol permite. Se comprueba también aquí porque esta app tiene su
    // propio guard: sin esto, un vetado entraría tecleando /finanzas.
    supabase
      .from("modulos_vetados")
      .select("modulo_id")
      .eq("perfil_id", perfil.id)
      .eq("modulo_id", moduloId)
      .maybeSingle(),
    // La concesión suma por encima del rol (rejilla de Usuarios); el veto
    // manda sobre las dos cosas.
    supabase
      .from("modulos_concedidos")
      .select("modulo_id")
      .eq("perfil_id", perfil.id)
      .eq("modulo_id", moduloId)
      .maybeSingle(),
  ]);

  const permitidos = ACCESO_POR_ROL[perfil.rol] ?? null;
  const conAcceso =
    contratacion?.activo === true &&
    (permitidos === null || permitidos.includes(moduloId) || !!concesion) &&
    !veto;

  if (!conAcceso) notFound();

  return { supabase, perfil, cuenta };
});

/**
 * Contexto de facturación: módulo + sociedad emisora. Hoy Bonita tiene una sola
 * sociedad; cuando haya varias, esto pasará a ser una elección del usuario.
 */
export const exigirFacturacion = cache(async function exigirFacturacion() {
  // La sociedad solo depende de la cuenta: se pide a la vez que se comprueba
  // el módulo (exigirPerfil ya está en caché, no repite la ida).
  const { supabase, cuenta } = await exigirPerfil();

  // Desde el 25-08-2026 facturación vive dentro del módulo contabilidad.
  const [ctx, { data: sociedad }] = await Promise.all([
    exigirModulo("contabilidad"),
    supabase
      .from("sociedades")
      .select("id, nombre, cif")
      .eq("cuenta_id", cuenta.id)
      .order("nombre")
      .limit(1)
      .maybeSingle(),
  ]);

  return { ...ctx, sociedad };
});
