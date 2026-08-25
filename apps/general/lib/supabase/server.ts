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
  responsable_area: ["ratios", "rrhh", "tpv", "compras", "crm", "docs", "reservas"],
  jefe_sala: ["reservas", "visitas", "tpv", "rrhh"],
  administracion: ["compras", "docs", "crm", "curso"],
  empleado: [],
};

/**
 * Módulos que NINGÚN rol trae de serie, ni dirección (que en el mapa es null
 * = todos): solo se ven con concesión expresa en la rejilla. Decidido por
 * Luis el 25-08-2026 para Usuarios: gestionar gente y permisos es de una
 * persona, no de un rol.
 */
export const SOLO_CONCESION = new Set(["usuarios"]);

/** ¿El rol trae este módulo de serie? (las concesiones van aparte) */
export function rolIncluye(rol: string, moduloId: string): boolean {
  if (SOLO_CONCESION.has(moduloId)) return false;
  const permitidos = ACCESO_POR_ROL[rol] ?? null;
  return permitidos === null || permitidos.includes(moduloId);
}

/**
 * Exige acceso a un módulo concreto: sesión de perfil + módulo contratado y
 * activo + permitido por el rol. Redirige/`notFound` igual que /m/[modulo].
 * Devuelve el mismo contexto que exigirPerfil (cliente, perfil, cuenta).
 */
export async function exigirModulo(moduloId: string) {
  const ctx = await exigirPerfil();
  const { supabase, perfil, cuenta } = ctx;

  const [{ data: contratacion }, { data: veto }, { data: concesion }] = await Promise.all([
    supabase
      .from("modulos_contratados")
      .select("activo")
      .eq("cuenta_id", cuenta.id)
      .eq("modulo_id", moduloId)
      .maybeSingle(),
    // El veto por usuario resta sobre lo que el rol permite (modulo Usuarios).
    supabase
      .from("modulos_vetados")
      .select("modulo_id")
      .eq("perfil_id", perfil.id)
      .eq("modulo_id", moduloId)
      .maybeSingle(),
    // Y la concesión SUMA un módulo concreto por encima del rol. El veto
    // manda sobre las dos cosas: vetado es vetado, esté concedido o no.
    supabase
      .from("modulos_concedidos")
      .select("modulo_id")
      .eq("perfil_id", perfil.id)
      .eq("modulo_id", moduloId)
      .maybeSingle(),
  ]);

  const conAcceso =
    contratacion?.activo === true &&
    (rolIncluye(perfil.rol, moduloId) || !!concesion) &&
    !veto;

  if (!conAcceso) notFound();

  return ctx;
}
