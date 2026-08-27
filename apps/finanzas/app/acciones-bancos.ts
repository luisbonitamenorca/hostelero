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

export async function conciliarGrupo(formData: FormData) {
  const { supabase, cuenta } = await exigirModulo("contabilidad");
  const bancoId = String(formData.get("banco") ?? "");
  const movId = String(formData.get("mov") ?? "");
  const apuntes = formData.getAll("apunte").map(String).filter(Boolean);
  if (!bancoId || !movId || apuntes.length < 2) volver(bancoId);

  // La suma del grupo debe clavar el importe del movimiento AL CÉNTIMO, y se
  // comprueba en servidor: el navegador solo propone.
  const [{ data: mov }, { data: aps }] = await Promise.all([
    supabase.from("fin_banco_movimientos").select("id, importe, estado").eq("id", movId).maybeSingle(),
    supabase.from("fin_apuntes").select("id, debe, haber").in("id", apuntes),
  ]);
  if (!mov || mov.estado !== "pendiente" || (aps ?? []).length !== apuntes.length) volver(bancoId);
  const suma = (aps ?? []).reduce((s, a) => s + Number(a.debe) - Number(a.haber), 0);
  if (Math.abs(Math.round(suma * 100) - Math.round(Number(mov!.importe) * 100)) > 0) volver(bancoId);

  const { error } = await supabase.from("fin_banco_mov_apuntes").insert(
    apuntes.map((apunteId) => ({ movimiento_id: movId, apunte_id: apunteId, cuenta_id: cuenta.id })),
  );
  // UNIQUE(apunte_id): si otro lo enlazó a la vez, no se consuma nada.
  if (!error) {
    await supabase
      .from("fin_banco_movimientos")
      .update({ estado: "conciliado", conciliado_via: "grupo", conciliado_en: new Date().toISOString() })
      .eq("id", movId)
      .eq("estado", "pendiente");
  }

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

  // Vale tanto para deshacer una conciliación (auto, manual o de grupo) como
  // para recuperar un ignorado: el movimiento vuelve a pendiente y sus
  // enlaces de grupo se sueltan.
  await supabase.from("fin_banco_mov_apuntes").delete().eq("movimiento_id", movId);
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

export async function conciliarLiquidando(formData: FormData) {
  const { supabase } = await exigirModulo("contabilidad");
  const bancoId = String(formData.get("banco") ?? "");
  const movId = String(formData.get("mov") ?? "");
  const apuntes = formData.getAll("apunte").map(String).filter(Boolean);
  if (!bancoId || !movId || apuntes.length < 1) volver(bancoId);

  // La función valida en servidor (apuntes vivos + suma al céntimo), crea el
  // asiento de cobro/pago contra el banco, enlaza el movimiento y liquida la
  // cartera de las facturas de Compras implicadas.
  const rpc = supabase as unknown as {
    rpc: (fn: "fin_conciliar_liquidando", args: { p_banco: string; p_mov: string; p_apuntes: string[] }) => PromiseLike<{ error: unknown }>;
  };
  await rpc.rpc("fin_conciliar_liquidando", { p_banco: bancoId, p_mov: movId, p_apuntes: apuntes });

  volver(bancoId);
}

export async function desconciliarLiquidacion(formData: FormData) {
  const { supabase } = await exigirModulo("contabilidad");
  const bancoId = String(formData.get("banco") ?? "");
  const movId = String(formData.get("mov") ?? "");
  if (!bancoId || !movId) redirect(`/bancos`);

  // Única vía por la que muere un asiento confirmado: el de la liquidación,
  // que nació de este movimiento. Cartera y enlaces se revierten dentro.
  const rpc = supabase as unknown as {
    rpc: (fn: "fin_desconciliar_liquidando", args: { p_mov: string }) => PromiseLike<{ error: unknown }>;
  };
  await rpc.rpc("fin_desconciliar_liquidando", { p_mov: movId });

  volver(bancoId);
}

export async function clasificarMovimiento(formData: FormData) {
  const { supabase } = await exigirModulo("contabilidad");
  const bancoId = String(formData.get("banco") ?? "");
  const movId = String(formData.get("mov") ?? "");
  const destino = String(formData.get("destino") ?? "");
  if (!bancoId || !movId || !destino) volver(bancoId);

  // destino = "codigo" o "codigo|centro_uuid". Genera el asiento contra esa
  // cuenta (caja de centro, anticipos, comisiones…) y concilia el movimiento.
  const [codigo, centro] = destino.split("|");
  const rpc = supabase as unknown as {
    rpc: (fn: "fin_clasificar_a_cuenta", args: { p_banco: string; p_mov: string; p_codigo: string; p_centro: string | null }) => PromiseLike<{ error: unknown }>;
  };
  await rpc.rpc("fin_clasificar_a_cuenta", { p_banco: bancoId, p_mov: movId, p_codigo: codigo, p_centro: centro || null });

  volver(bancoId);
}
