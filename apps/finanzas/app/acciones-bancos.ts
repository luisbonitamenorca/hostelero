"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirModulo } from "@/lib/supabase/server";

/**
 * Acciones de la conciliación bancaria. Con el cliente de SESIÓN a propósito:
 * la RLS de fin_banco_movimientos vuelve a comprobar la cuenta. El importe y
 * el candidato ya vienen acotados por las funciones de sugerencia del
 * servidor; aquí solo se consuma la decisión humana.
 */

function volver(bancoId: string) {
  revalidatePath(`/bancos/${bancoId}/conciliacion`);
  redirect(`/bancos/${bancoId}/conciliacion`);
}

export async function conciliarManual(formData: FormData) {
  const { supabase } = await exigirModulo("contabilidad");
  const bancoId = String(formData.get("banco") ?? "");
  const movId = String(formData.get("mov") ?? "");
  const apunteId = String(formData.get("apunte") ?? "");
  if (!bancoId || !movId || !apunteId) redirect(`/bancos`);

  // El apunte no puede estar ya enlazado a otro movimiento (carrera entre dos
  // personas conciliando a la vez): se comprueba y se escribe condicionado.
  const { data: usado } = await supabase
    .from("fin_banco_movimientos")
    .select("id")
    .eq("apunte_id", apunteId)
    .maybeSingle();
  if (usado) volver(bancoId);

  await supabase
    .from("fin_banco_movimientos")
    .update({
      estado: "conciliado",
      apunte_id: apunteId,
      conciliado_via: "manual",
      conciliado_en: new Date().toISOString(),
    })
    .eq("id", movId)
    .eq("estado", "pendiente");

  volver(bancoId);
}

export async function ignorarMovimiento(formData: FormData) {
  const { supabase } = await exigirModulo("contabilidad");
  const bancoId = String(formData.get("banco") ?? "");
  const movId = String(formData.get("mov") ?? "");
  if (!bancoId || !movId) redirect(`/bancos`);

  await supabase
    .from("fin_banco_movimientos")
    .update({ estado: "ignorado" })
    .eq("id", movId)
    .eq("estado", "pendiente");

  volver(bancoId);
}

export async function desconciliarMovimiento(formData: FormData) {
  const { supabase } = await exigirModulo("contabilidad");
  const bancoId = String(formData.get("banco") ?? "");
  const movId = String(formData.get("mov") ?? "");
  if (!bancoId || !movId) redirect(`/bancos`);

  // Vale tanto para deshacer una conciliación (auto o manual) como para
  // recuperar un ignorado: el movimiento vuelve a pendiente.
  await supabase
    .from("fin_banco_movimientos")
    .update({ estado: "pendiente", apunte_id: null, conciliado_via: null, conciliado_en: null })
    .eq("id", movId);

  volver(bancoId);
}

export async function lanzarConciliacionAuto(formData: FormData) {
  const { supabase } = await exigirModulo("contabilidad");
  const bancoId = String(formData.get("banco") ?? "");
  if (!bancoId) redirect(`/bancos`);

  const rpc = supabase as unknown as {
    rpc: (fn: "fin_conciliar_auto", args: { p_banco: string }) => PromiseLike<{ error: unknown }>;
  };
  await rpc.rpc("fin_conciliar_auto", { p_banco: bancoId });

  volver(bancoId);
}
