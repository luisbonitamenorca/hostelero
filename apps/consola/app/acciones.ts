"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { crearClienteServidor, exigirOperador } from "@/lib/supabase/server";

/** Normaliza un campo de formulario: recorta y convierte vacío en null. */
function limpio(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s : null;
}

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

  const nombre = limpio(formData.get("nombre"));
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

export async function actualizarCuenta(formData: FormData) {
  const { supabase } = await exigirOperador();

  const id = String(formData.get("id") ?? "");
  const nombre = limpio(formData.get("nombre"));
  const plan = String(formData.get("plan") ?? "basico");
  const estado = String(formData.get("estado") ?? "en_pruebas");

  if (!id) return;
  if (!nombre) redirect(`/cuentas/${id}?error=nombre`);

  const { error } = await supabase
    .from("cuentas")
    .update({ nombre, plan, estado })
    .eq("id", id);

  redirect(`/cuentas/${id}?${error ? "error=guardar" : "ok=cuenta"}`);
}

export async function crearSociedad(formData: FormData) {
  const { supabase } = await exigirOperador();

  const cuentaId = String(formData.get("cuenta_id") ?? "");
  const nombre = limpio(formData.get("nombre"));

  if (!cuentaId) return;
  if (!nombre) redirect(`/cuentas/${cuentaId}?error=nombre`);

  const { error } = await supabase.from("sociedades").insert({
    cuenta_id: cuentaId,
    nombre,
    cif: limpio(formData.get("cif")),
    direccion: limpio(formData.get("direccion")),
    telefono: limpio(formData.get("telefono")),
    email: limpio(formData.get("email")),
  });

  redirect(`/cuentas/${cuentaId}?${error ? "error=guardar" : "ok=sociedad"}`);
}

export async function actualizarSociedad(formData: FormData) {
  const { supabase } = await exigirOperador();

  const cuentaId = String(formData.get("cuenta_id") ?? "");
  const sociedadId = String(formData.get("sociedad_id") ?? "");
  const nombre = limpio(formData.get("nombre"));

  if (!cuentaId || !sociedadId) return;
  if (!nombre) redirect(`/cuentas/${cuentaId}?error=nombre`);

  const { error } = await supabase
    .from("sociedades")
    .update({
      nombre,
      cif: limpio(formData.get("cif")),
      direccion: limpio(formData.get("direccion")),
      telefono: limpio(formData.get("telefono")),
      email: limpio(formData.get("email")),
    })
    .eq("id", sociedadId)
    .eq("cuenta_id", cuentaId);

  redirect(`/cuentas/${cuentaId}?${error ? "error=guardar" : "ok=sociedad"}`);
}

export async function crearCentro(formData: FormData) {
  const { supabase } = await exigirOperador();

  const cuentaId = String(formData.get("cuenta_id") ?? "");
  const sociedadId = String(formData.get("sociedad_id") ?? "");
  const nombre = limpio(formData.get("nombre"));

  if (!cuentaId || !sociedadId) return;
  if (!nombre) redirect(`/cuentas/${cuentaId}?error=nombre`);

  const { error } = await supabase.from("centros").insert({
    cuenta_id: cuentaId,
    sociedad_id: sociedadId,
    nombre,
    direccion: limpio(formData.get("direccion")),
    telefono: limpio(formData.get("telefono")),
    email: limpio(formData.get("email")),
    persona_contacto: limpio(formData.get("persona_contacto")),
    observaciones: limpio(formData.get("observaciones")),
  });

  redirect(`/cuentas/${cuentaId}?${error ? "error=guardar" : "ok=centro"}`);
}

export async function actualizarCentro(formData: FormData) {
  const { supabase } = await exigirOperador();

  const cuentaId = String(formData.get("cuenta_id") ?? "");
  const centroId = String(formData.get("centro_id") ?? "");
  const nombre = limpio(formData.get("nombre"));

  if (!cuentaId || !centroId) return;
  if (!nombre) redirect(`/cuentas/${cuentaId}?error=nombre`);

  const { error } = await supabase
    .from("centros")
    .update({
      nombre,
      direccion: limpio(formData.get("direccion")),
      telefono: limpio(formData.get("telefono")),
      email: limpio(formData.get("email")),
      persona_contacto: limpio(formData.get("persona_contacto")),
      observaciones: limpio(formData.get("observaciones")),
    })
    .eq("id", centroId)
    .eq("cuenta_id", cuentaId);

  redirect(`/cuentas/${cuentaId}?${error ? "error=guardar" : "ok=centro"}`);
}

export async function alternarModulo(formData: FormData) {
  const { supabase } = await exigirOperador();

  const cuentaId = String(formData.get("cuenta_id") ?? "");
  const moduloId = String(formData.get("modulo_id") ?? "");
  const estabaActivo = formData.get("activo") === "true";

  if (!cuentaId || !moduloId) return;

  const { error } = await supabase
    .from("modulos_contratados")
    .upsert(
      { cuenta_id: cuentaId, modulo_id: moduloId, activo: !estabaActivo },
      { onConflict: "cuenta_id,modulo_id" }
    );

  if (error) redirect(`/cuentas/${cuentaId}?error=modulo`);
  revalidatePath(`/cuentas/${cuentaId}`);
}
