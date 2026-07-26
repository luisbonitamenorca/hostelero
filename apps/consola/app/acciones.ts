"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { crearClienteServidor, exigirOperador } from "@/lib/supabase/server";

export async function iniciarSesion(formData: FormData) {
  const correo = String(formData.get("correo") ?? "").trim();
  const clave = String(formData.get("clave") ?? "");

  if (!correo || !clave) redirect("/login?error=datos");

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({
    email: correo,
    password: clave,
  });

  if (error) redirect("/login?error=credenciales");

  redirect("/");
}

export async function cerrarSesion() {
  const supabase = await crearClienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function crearCuenta(formData: FormData) {
  const { supabase } = await exigirOperador();

  const nombre = String(formData.get("nombre") ?? "").trim();
  const plan = String(formData.get("plan") ?? "basico");
  const estado = String(formData.get("estado") ?? "en_pruebas");

  if (!nombre) redirect("/cuentas/nueva?error=nombre");

  const { data, error } = await supabase
    .from("cuentas")
    .insert({ nombre, plan, estado })
    .select("id")
    .single();

  if (error || !data) redirect("/cuentas/nueva?error=guardar");

  revalidatePath("/");
  redirect(`/cuentas/${data.id}`);
}

export async function alternarModulo(formData: FormData) {
  const { supabase } = await exigirOperador();

  const cuentaId = String(formData.get("cuenta_id") ?? "");
  const moduloId = String(formData.get("modulo_id") ?? "");
  const estabaActivo = formData.get("activo") === "true";

  if (!cuentaId || !moduloId) return;

  // Upsert: si la contratación no existe todavía, se crea ya activa.
  const { error } = await supabase
    .from("modulos_contratados")
    .upsert(
      { cuenta_id: cuentaId, modulo_id: moduloId, activo: !estabaActivo },
      { onConflict: "cuenta_id,modulo_id" }
    );

  if (!error) revalidatePath(`/cuentas/${cuentaId}`);
}
