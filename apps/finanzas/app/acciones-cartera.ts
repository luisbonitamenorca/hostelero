"use server";

import { revalidatePath } from "next/cache";
import { exigirFacturacion, exigirModulo } from "@/lib/supabase/server";
import { clienteCartera } from "@/lib/cartera";

/** Marca un cobro o un pago, entero o en parte. */
export async function liquidarVencimiento(id: string, importe: number) {
  const { supabase } = await exigirFacturacion();
  const db = clienteCartera(supabase);

  const { data: v } = await db
    .from("fin_vencimientos")
    .select("importe, importe_liquidado, estado")
    .eq("id", id)
    .maybeSingle();

  if (!v) return { error: "Ese vencimiento ya no existe." };
  if (v.estado === "anulado") return { error: "Está anulado: no se puede liquidar." };

  const liquidado = Number(v.importe_liquidado) + importe;
  const total = Number(v.importe);

  // Se compara en valor absoluto porque una devolución lleva importe negativo.
  const estado =
    Math.abs(liquidado) >= Math.abs(total) - 0.005
      ? "liquidado"
      : Math.abs(liquidado) < 0.005
        ? "pendiente"
        : "parcial";

  const { error } = await db
    .from("fin_vencimientos")
    .update({ importe_liquidado: liquidado, estado })
    .eq("id", id);

  if (error) return { error: `No se pudo actualizar: ${error.message}` };

  revalidatePath("/cartera");
  return { ok: true };
}

/** Deshace una liquidación puesta por error. */
export async function reabrirVencimiento(id: string) {
  const { supabase } = await exigirFacturacion();
  const { error } = await clienteCartera(supabase)
    .from("fin_vencimientos")
    .update({ importe_liquidado: 0, estado: "pendiente" })
    .eq("id", id);

  if (error) return { error: `No se pudo reabrir: ${error.message}` };
  revalidatePath("/cartera");
  return { ok: true };
}

/**
 * Crea el vencimiento de pago de una factura recibida, usando los días del
 * proveedor si los tiene. No se genera solo al llegar la factura porque las
 * facturas de compra entran por otro módulo y no todas tienen condiciones.
 */
export async function generarVencimientoCompra(compraDocId: string) {
  const { supabase, cuenta } = await exigirModulo("compras");
  const db = clienteCartera(supabase);

  const { data: doc } = await db
    .from("compras_doc")
    .select("id, fecha, total, proveedor_id, proveedor")
    .eq("id", compraDocId)
    .maybeSingle();

  if (!doc) return { error: "Esa factura ya no existe." };

  const { data: existente } = await db
    .from("fin_vencimientos")
    .select("id")
    .eq("compra_doc_id", compraDocId)
    .limit(1);

  if (existente && existente.length > 0) {
    return { error: "Esa factura ya tiene vencimiento." };
  }

  let dias = 30;
  let forma: string | null = null;
  if (doc.proveedor_id) {
    const { data: cond } = await db
      .from("fin_proveedor_condiciones")
      .select("dias_pago, forma_pago")
      .eq("proveedor_id", doc.proveedor_id)
      .maybeSingle();
    if (cond) {
      dias = Number(cond.dias_pago);
      forma = cond.forma_pago;
    }
  }

  const base = doc.fecha ? new Date(doc.fecha) : new Date();
  base.setDate(base.getDate() + dias);

  const { error } = await db.from("fin_vencimientos").insert({
    cuenta_id: cuenta.id,
    sentido: "pago",
    compra_doc_id: doc.id,
    fecha_vencimiento: base.toISOString().slice(0, 10),
    importe: Number(doc.total ?? 0),
    forma_pago: forma,
  });

  if (error) return { error: `No se pudo crear el vencimiento: ${error.message}` };

  revalidatePath("/cartera");
  revalidatePath("/facturas-recibidas");
  return { ok: true, dias };
}

/** Condiciones de pago de un proveedor. Viven en fin_*, no en compras_proveedor. */
export async function guardarCondicionesProveedor(datos: {
  proveedorId: string;
  diasPago: number;
  formaPago: string | null;
  iban: string | null;
}) {
  const { supabase, cuenta } = await exigirModulo("compras");

  if (!Number.isInteger(datos.diasPago) || datos.diasPago < 0 || datos.diasPago > 365) {
    return { error: "Los días de pago van de 0 a 365." };
  }

  const { error } = await clienteCartera(supabase)
    .from("fin_proveedor_condiciones")
    .upsert(
      {
        proveedor_id: datos.proveedorId,
        cuenta_id: cuenta.id,
        dias_pago: datos.diasPago,
        forma_pago: datos.formaPago?.trim() || null,
        iban: datos.iban?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || null,
      },
      { onConflict: "proveedor_id" },
    );

  if (error) return { error: `No se pudieron guardar las condiciones: ${error.message}` };

  revalidatePath("/proveedores");
  return { ok: true };
}
