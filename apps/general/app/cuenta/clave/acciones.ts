"use server";

import { redirect } from "next/navigation";
import { createClient, isAuthSessionMissingError } from "@supabase/supabase-js";
import { crearClienteServidor } from "@/lib/supabase/server";
import { longitudValida } from "@/lib/clave";
import type { EstadoMiClave } from "./errores";

/**
 * Cambia la contraseña del usuario con sesión. Va con el cliente de SESIÓN
 * (auth.updateUser), nunca con la service key: cada cual solo puede cambiar
 * la suya, y Supabase aplica sus propias reglas (filtradas, reautenticación
 * si la sesión es antigua…). La contraseña nunca se registra en ningún log.
 *
 * Pide la contraseña ACTUAL y la comprueba antes de cambiar nada: si no,
 * quien encontrase una sesión abierta (un móvil o una tablet de sala) podría
 * poner otra y dejar fuera al dueño.
 */
export async function cambiarMiClave(_previo: EstadoMiClave, formData: FormData): Promise<EstadoMiClave> {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const actual = String(formData.get("actual") ?? "");
  // La nueva se guarda sin espacios al principio ni al final (se cuelan al copiar y pegar).
  const clave = String(formData.get("clave") ?? "").trim();
  const repetida = String(formData.get("repetida") ?? "").trim();
  if (!actual) return { error: "actual" };
  if (!longitudValida(clave)) return { error: "clave" };
  if (clave !== repetida) return { error: "distintas" };
  if (!user.email) return { error: "fallo" };

  // Comprobar la actual entrando con ella en un cliente aparte, sin cookies:
  // la sesión del navegador no se toca. La sesión de prueba se cierra en
  // cuanto sirve (solo esa: scope "local"), para no dejarla viva.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return { error: "fallo" };
  const verificador = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let { data: comprobada, error: errorActual } = await verificador.auth.signInWithPassword({
    email: user.email,
    password: actual,
  });
  // Mismo criterio que el login: si falla tal cual y lleva espacios alrededor, sin ellos.
  if (errorActual && actual.trim() !== actual && actual.trim()) {
    ({ data: comprobada, error: errorActual } = await verificador.auth.signInWithPassword({
      email: user.email,
      password: actual.trim(),
    }));
  }
  if (errorActual || !comprobada.session) {
    if (
      errorActual?.code === "invalid_credentials" ||
      (errorActual?.status === 400 && /invalid login credentials/i.test(errorActual.message))
    ) {
      return { error: "actual-incorrecta" };
    }
    if (errorActual?.status === 429 || errorActual?.code === "over_request_rate_limit") return { error: "limite" };
    console.error("cambiarMiClave: no se pudo comprobar la contraseña actual", {
      code: errorActual?.code,
      status: errorActual?.status,
      message: errorActual?.message,
    });
    return { error: "fallo" };
  }
  await verificador.auth.signOut({ scope: "local" });
  if (comprobada.user?.id !== user.id) return { error: "actual-incorrecta" };

  const { error } = await supabase.auth.updateUser({ password: clave });
  if (error) {
    // Sin sesión (caducó o se cerró entre medias): a entrar otra vez.
    if (isAuthSessionMissingError(error) || error.code === "session_not_found") redirect("/login");
    if (error.code === "weak_password") return { error: "clave-debil" };
    if (error.code === "same_password") return { error: "misma" };
    // Sesión antigua: Supabase pide reautenticarse antes de cambiarla.
    if (
      error.code === "reauthentication_needed" ||
      error.code === "reauthentication_not_valid" ||
      error.code === "session_expired" ||
      error.code === "insufficient_aal"
    ) {
      return { error: "reautenticar" };
    }
    if (error.status === 429 || error.code === "over_request_rate_limit") return { error: "limite" };
    console.error("cambiarMiClave: Auth rechazó el cambio", {
      code: error.code,
      status: error.status,
      message: error.message,
    });
    return { error: "fallo" };
  }

  return { ok: true };
}
