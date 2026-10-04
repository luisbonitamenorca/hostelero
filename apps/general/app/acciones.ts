"use server";

import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";

export async function iniciarSesion(formData: FormData) {
  const correo = String(formData.get("correo") ?? "").trim();
  const clave = String(formData.get("clave") ?? "");

  if (!correo || !clave) redirect("/login?error=datos");

  const supabase = await crearClienteServidor();
  let { error } = await supabase.auth.signInWithPassword({
    email: correo,
    password: clave,
  });
  // Al copiar la contraseña de un WhatsApp o un correo en el móvil se suele colar
  // un espacio al principio o al final: si falla tal cual, se prueba sin ellos.
  if (error && clave.trim() !== clave && clave.trim()) {
    ({ error } = await supabase.auth.signInWithPassword({ email: correo, password: clave.trim() }));
  }

  if (error) redirect("/login?error=credenciales");

  redirect("/");
}

export async function cerrarSesion() {
  const supabase = await crearClienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}
