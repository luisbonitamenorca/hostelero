"use server";

import { revalidatePath } from "next/cache";
import { exigirFacturacion } from "@/lib/supabase/server";

/** Cuenta bancaria ordenante. Sin al menos una no hay remesas. */
export async function guardarCuentaBancaria(datos: {
  id?: string;
  nombre: string;
  iban: string;
  bic: string | null;
}) {
  const { supabase, cuenta } = await exigirFacturacion();

  const { data: sociedad } = await supabase
    .from("sociedades")
    .select("id")
    .eq("cuenta_id", cuenta.id)
    .limit(1)
    .maybeSingle();

  if (!sociedad) return { error: "No hay sociedad en la cuenta." };
  if (!datos.nombre.trim()) return { error: "Ponle un nombre para reconocerla." };

  const iban = datos.iban.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^ES\d{22}$/.test(iban)) return { error: "El IBAN español tiene 24 caracteres: ES y 22 dígitos." };

  const fila = {
    cuenta_id: cuenta.id,
    sociedad_id: sociedad.id,
    nombre: datos.nombre.trim(),
    iban,
    bic: datos.bic?.trim().toUpperCase() || null,
  };

  const { error } = datos.id
    ? await supabase.from("fin_bancos_cuentas").update(fila).eq("id", datos.id)
    : await supabase.from("fin_bancos_cuentas").insert(fila);

  if (error) {
    return {
      error: error.code === "23505" ? "Esa cuenta ya está dada de alta." : `No se pudo guardar: ${error.message}`,
    };
  }

  revalidatePath("/bancos");
  return { ok: true };
}

/** Mandato SEPA de un cliente. Sin mandato no se puede domiciliar. */
export async function guardarMandato(datos: {
  clienteId: string;
  referencia: string;
  tipo: "CORE" | "B2B";
  fechaFirma: string;
  iban: string;
}) {
  const { supabase, cuenta } = await exigirFacturacion();

  if (!datos.referencia.trim()) return { error: "El mandato necesita una referencia." };
  if (!datos.fechaFirma) return { error: "Falta la fecha de firma: es obligatoria en el fichero." };

  const iban = datos.iban.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^ES\d{22}$/.test(iban)) return { error: "El IBAN español tiene 24 caracteres." };

  const { error } = await supabase.from("fin_mandatos").insert({
    cuenta_id: cuenta.id,
    cliente_id: datos.clienteId,
    referencia: datos.referencia.trim(),
    tipo: datos.tipo,
    fecha_firma: datos.fechaFirma,
    iban,
  });

  if (error) {
    return {
      error: error.code === "23505" ? "Ya existe un mandato con esa referencia." : `No se pudo guardar: ${error.message}`,
    };
  }

  revalidatePath("/mandatos");
  return { ok: true };
}

export async function revocarMandato(id: string) {
  const { supabase } = await exigirFacturacion();
  const { error } = await supabase.from("fin_mandatos").update({ estado: "revocado" }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/mandatos");
  return { ok: true };
}

/**
 * Crea la remesa con los vencimientos elegidos. Congela aquí el nombre, el IBAN
 * y el mandato: lo que viajó en el fichero tiene que poder reconstruirse dentro
 * de tres meses aunque cambie la ficha del cliente.
 */
export async function crearRemesa(datos: {
  sentido: "cobro" | "pago";
  bancoCuentaId: string;
  fechaEjecucion: string;
  concepto: string | null;
  vencimientoIds: string[];
}) {
  const { supabase, cuenta } = await exigirFacturacion();

  if (datos.vencimientoIds.length === 0) return { error: "Elige al menos un vencimiento." };
  if (!datos.fechaEjecucion) return { error: "Falta la fecha de cargo o abono." };

  const { data: banco } = await supabase
    .from("fin_bancos_cuentas")
    .select("id, sociedad_id")
    .eq("id", datos.bancoCuentaId)
    .maybeSingle();
  if (!banco) return { error: "Esa cuenta bancaria ya no existe." };

  const { data: vencimientos } = await supabase
    .from("fin_vencimientos")
    .select("id, sentido, importe, importe_liquidado, estado, factura_id, compra_doc_id")
    .in("id", datos.vencimientoIds);

  const elegidos = (vencimientos ?? []).filter(
    (v) => v.sentido === datos.sentido && (v.estado === "pendiente" || v.estado === "parcial"),
  );
  if (elegidos.length === 0) return { error: "Ninguno de los vencimientos elegidos sigue pendiente." };

  // Datos del otro lado: cliente en los cobros, proveedor en los pagos.
  const lineas: {
    vencimiento_id: string;
    importe: number;
    nombre: string;
    iban: string;
    mandato_ref: string | null;
    mandato_fecha: string | null;
    secuencia: string | null;
    concepto: string | null;
  }[] = [];
  const problemas: string[] = [];

  for (const v of elegidos) {
    const pendiente = Number(v.importe) - Number(v.importe_liquidado);

    if (datos.sentido === "cobro") {
      const { data: factura } = await supabase
        .from("fin_facturas")
        .select("numero_completo, cliente_id")
        .eq("id", v.factura_id!)
        .maybeSingle();

      const { data: cliente } = factura?.cliente_id
        ? await supabase.from("fin_clientes").select("nombre_fiscal, iban").eq("id", factura.cliente_id).maybeSingle()
        : { data: null };

      const { data: mandato } = factura?.cliente_id
        ? await supabase
            .from("fin_mandatos")
            .select("referencia, fecha_firma, iban, usado")
            .eq("cliente_id", factura.cliente_id)
            .eq("estado", "activo")
            .order("fecha_firma", { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null };

      if (!cliente) {
        problemas.push("Un vencimiento no tiene cliente.");
        continue;
      }
      if (!mandato) {
        problemas.push(`${cliente.nombre_fiscal}: sin mandato activo, no se puede domiciliar.`);
        continue;
      }

      lineas.push({
        vencimiento_id: v.id,
        importe: pendiente,
        nombre: cliente.nombre_fiscal,
        iban: mandato.iban ?? cliente.iban ?? "",
        mandato_ref: mandato.referencia,
        mandato_fecha: mandato.fecha_firma,
        secuencia: mandato.usado ? "RCUR" : "FRST",
        concepto: factura?.numero_completo ?? null,
      });
    } else {
      const { data: doc } = await supabase
        .from("compras_doc")
        .select("proveedor, proveedor_id, num_documento")
        .eq("id", v.compra_doc_id!)
        .maybeSingle();

      const { data: cond } = doc?.proveedor_id
        ? await supabase
            .from("fin_proveedor_condiciones")
            .select("iban")
            .eq("proveedor_id", doc.proveedor_id)
            .maybeSingle()
        : { data: null };

      if (!cond?.iban) {
        problemas.push(`${doc?.proveedor ?? "Un proveedor"}: sin IBAN en sus condiciones de pago.`);
        continue;
      }

      lineas.push({
        vencimiento_id: v.id,
        importe: pendiente,
        nombre: doc?.proveedor ?? "Proveedor",
        iban: cond.iban,
        mandato_ref: null,
        mandato_fecha: null,
        secuencia: null,
        concepto: doc?.num_documento ?? null,
      });
    }
  }

  if (lineas.length === 0) {
    return { error: `No se pudo montar ninguna línea. ${problemas.join(" ")}` };
  }

  const total = Number(lineas.reduce((s, l) => s + l.importe, 0).toFixed(2));

  const { data: remesa, error } = await supabase
    .from("fin_remesas")
    .insert({
      cuenta_id: cuenta.id,
      sociedad_id: banco.sociedad_id,
      sentido: datos.sentido,
      banco_cuenta_id: banco.id,
      fecha_ejecucion: datos.fechaEjecucion,
      concepto: datos.concepto?.trim() || null,
      total,
      num_items: lineas.length,
    })
    .select("id")
    .single();

  if (error || !remesa) return { error: `No se pudo crear la remesa: ${error?.message}` };

  const { error: errorItems } = await supabase.from("fin_remesas_items").insert(
    lineas.map((l, i) => ({
      cuenta_id: cuenta.id,
      remesa_id: remesa.id,
      referencia: `${remesa.id.slice(0, 8)}-${i + 1}`,
      ...l,
    })),
  );

  if (errorItems) return { error: `La remesa se creó pero sus líneas no: ${errorItems.message}` };

  revalidatePath("/remesas");
  return { ok: true, id: remesa.id, avisos: problemas };
}

/** Marca la remesa como generada. A partir de aquí sus líneas no se tocan. */
export async function marcarRemesa(id: string, estado: "generada" | "enviada" | "anulada") {
  const { supabase } = await exigirFacturacion();

  const ahora = new Date().toISOString();
  const campos = {
    estado,
    ...(estado === "generada" ? { generada_en: ahora } : {}),
    ...(estado === "enviada" ? { enviada_en: ahora } : {}),
  };

  const { error } = await supabase.from("fin_remesas").update(campos).eq("id", id);
  if (error) return { error: error.message };

  // Al enviarla, los mandatos usados dejan de ser "primer adeudo".
  if (estado === "enviada") {
    const { data: items } = await supabase
      .from("fin_remesas_items")
      .select("mandato_ref")
      .eq("remesa_id", id)
      .not("mandato_ref", "is", null);

    const refs = (items ?? []).map((i) => i.mandato_ref).filter(Boolean) as string[];
    if (refs.length > 0) {
      await supabase
        .from("fin_mandatos")
        .update({ usado: true, fecha_ultimo_uso: new Date().toISOString().slice(0, 10) })
        .in("referencia", refs);
    }
  }

  revalidatePath("/remesas");
  revalidatePath(`/remesas/${id}`);
  return { ok: true };
}
