"use server";

import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/supabase/server";
import { errorDeIban } from "@/lib/nif";
import { FORMAS_PAGO, type PlazoTipo } from "@/lib/cartera";
import { COLUMNAS_PROVEEDOR, columnasValidas } from "@/lib/proveedores";
import type { EstadoAccion } from "./acciones";

function limpio(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s : null;
}

/**
 * Ficha del proveedor en Contabilidad (13-10-2026). Solo escribe en
 * fin_proveedor_condiciones: el maestro (nombre, NIF, cuentas, departamento)
 * es de Compras y se edita allí. Si la migración 20261013202351 aún no está
 * aplicada, se guardan los campos que existen y se avisa.
 */
export async function guardarFichaProveedor(_previo: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const { supabase, cuenta } = await exigirModulo("compras");

  const proveedorId = limpio(formData.get("proveedor_id"));
  if (!proveedorId) return { error: "Falta el proveedor." };

  const dias = Number(String(formData.get("dias_pago") ?? "").replace(",", "."));
  if (!Number.isInteger(dias) || dias < 0 || dias > 365) return { error: "Los días de pago van de 0 a 365." };

  const plazoTipo = (limpio(formData.get("plazo_tipo")) ?? "dias") as PlazoTipo;
  if (!["dias", "dia_semana", "dia_mes"].includes(plazoTipo)) return { error: "Tipo de plazo no válido." };
  const diaBruto = Number(String(formData.get("plazo_dia") ?? ""));
  const plazoDia = plazoTipo === "dias" ? null : Number.isInteger(diaBruto) ? diaBruto : null;
  if (plazoTipo === "dia_semana" && (plazoDia == null || plazoDia < 1 || plazoDia > 7)) return { error: "Elige el día de la semana." };
  if (plazoTipo === "dia_mes" && (plazoDia == null || plazoDia < 1 || plazoDia > 31)) return { error: "El día del mes va de 1 a 31." };

  const forma = limpio(formData.get("forma_pago"));
  if (forma && !FORMAS_PAGO.some((f) => f.valor === forma)) return { error: "Forma de pago no válida." };

  const ibanLimpio = (limpio(formData.get("iban")) ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
  if (ibanLimpio) {
    const fallo = errorDeIban(ibanLimpio);
    if (fallo) return { error: fallo };
  }

  const email = limpio(formData.get("email"))?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "El correo no tiene pinta de correo." };

  const base = {
    proveedor_id: proveedorId,
    cuenta_id: cuenta.id,
    dias_pago: dias,
    forma_pago: forma,
    iban: ibanLimpio,
    notas: limpio(formData.get("notas")),
    plazo_tipo: plazoTipo,
    plazo_dia: plazoDia,
  };
  const contacto = {
    telefono: limpio(formData.get("telefono")),
    email,
    contacto: limpio(formData.get("contacto")),
  };

  const { error } = await supabase
    .from("fin_proveedor_condiciones")
    .upsert({ ...base, ...contacto }, { onConflict: "proveedor_id" });

  if (error) {
    if (/telefono|email|contacto/.test(error.message)) {
      const { error: e2 } = await supabase.from("fin_proveedor_condiciones").upsert(base, { onConflict: "proveedor_id" });
      if (e2) return { error: `No se pudo guardar la ficha: ${e2.message}` };
      revalidatePath("/proveedores");
      return {
        ok: true,
        ir: `/proveedores/${proveedorId}?aviso=contacto`,
      };
    }
    return { error: `No se pudo guardar la ficha: ${error.message}` };
  }

  revalidatePath("/proveedores");
  revalidatePath(`/proveedores/${proveedorId}`);
  return { ok: true, ir: "/proveedores" };
}

/** Ajustes del módulo: hoy, las columnas del listado de proveedores. */
export async function guardarAjustes(_previo: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const { supabase, cuenta } = await exigirModulo("compras");

  const marcadas = COLUMNAS_PROVEEDOR.map((c) => c.clave).filter((c) => formData.get(`col_${c}`) === "on");
  const columnas = columnasValidas(marcadas);

  const { data: actual } = await supabase.from("fin_ajustes").select("ajustes").eq("cuenta_id", cuenta.id).maybeSingle();
  const ajustes = { ...((actual?.ajustes as Record<string, unknown> | null) ?? {}), proveedores_columnas: columnas };

  const { error } = await supabase.from("fin_ajustes").upsert({ cuenta_id: cuenta.id, ajustes }, { onConflict: "cuenta_id" });
  if (error) {
    if (/fin_ajustes/.test(error.message)) {
      return { error: "Los ajustes necesitan la migración 20261013202351 en la base. Hasta entonces el listado usa las columnas de siempre." };
    }
    return { error: `No se pudieron guardar los ajustes: ${error.message}` };
  }

  revalidatePath("/proveedores");
  revalidatePath("/ajustes");
  return { ok: true, ir: "/proveedores" };
}
