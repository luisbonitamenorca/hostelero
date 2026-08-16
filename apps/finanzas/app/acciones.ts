"use server";

import { revalidatePath } from "next/cache";
import { crearClienteServidor, exigirFacturacion } from "@/lib/supabase/server";
import { errorDeIban, errorDeNif } from "@/lib/nif";
import { calcularLinea, calcularTotales, type LineaBruta } from "@/lib/importes";

/** Recorta y convierte vacío en null. */
function limpio(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s : null;
}

function numeroDe(v: FormDataEntryValue | null, porDefecto = 0): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : porDefecto;
}

// ---------------------------------------------------------------- sesión

/**
 * Las acciones NO redirigen: devuelven a dónde ir en `ir` y navega el cliente.
 * El motivo está en lib/rutas.ts — redirect() y el basePath no se llevan bien
 * y el destino acababa duplicado.
 */
export type EstadoAccion = { error?: string; ok?: boolean; ir?: string } | null;

export async function iniciarSesion(_previo: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const correo = String(formData.get("correo") ?? "").trim();
  const clave = String(formData.get("clave") ?? "");

  if (!correo || !clave) return { error: "Escribe el correo y la contraseña." };

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({
    email: correo,
    password: clave,
  });

  if (error) return { error: "No se pudo iniciar sesión. Revisa el correo y la contraseña." };

  return { ok: true, ir: "/panel" };
}

export async function cerrarSesion(): Promise<EstadoAccion> {
  const supabase = await crearClienteServidor();
  await supabase.auth.signOut();
  return { ok: true, ir: "/login" };
}

// --------------------------------------------------------------- clientes

export async function guardarCliente(_previo: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const { supabase, cuenta } = await exigirFacturacion();

  const id = limpio(formData.get("id"));
  const pais = (limpio(formData.get("pais")) ?? "ES").toUpperCase().slice(0, 2);
  const nif = limpio(formData.get("nif"));
  const iban = limpio(formData.get("iban"));

  // La validación del servidor es la que manda: la del navegador solo avisa antes.
  const nombre_fiscal = limpio(formData.get("nombre_fiscal"));
  if (!nombre_fiscal) return { error: "El nombre fiscal es obligatorio." };

  if (pais === "ES") {
    const fallo = errorDeNif(nif ?? "");
    if (fallo) return { error: fallo };
  }

  const ibanLimpio = iban ? iban.toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
  if (ibanLimpio) {
    const fallo = errorDeIban(ibanLimpio);
    if (fallo) return { error: fallo };
  }

  const dias = numeroDe(formData.get("dias_vencimiento"));
  if (!Number.isInteger(dias) || dias < 0 || dias > 365) {
    return { error: "Los días de vencimiento van de 0 a 365." };
  }

  const retencion = numeroDe(formData.get("retencion_pct"));
  if (retencion < 0 || retencion > 100) {
    return { error: "La retención va de 0 a 100." };
  }

  const fila = {
    nif: nif ? nif.toUpperCase() : null,
    nombre_fiscal,
    nombre_comercial: limpio(formData.get("nombre_comercial")),
    direccion: limpio(formData.get("direccion")),
    codigo_postal: limpio(formData.get("codigo_postal")),
    municipio: limpio(formData.get("municipio")),
    provincia: limpio(formData.get("provincia")),
    pais,
    email: limpio(formData.get("email"))?.toLowerCase() ?? null,
    telefono: limpio(formData.get("telefono")),
    iban: ibanLimpio,
    dias_vencimiento: dias,
    tipo_iva_defecto: numeroDe(formData.get("tipo_iva_defecto"), 21),
    retencion_pct: retencion,
    notas: limpio(formData.get("notas")),
    activo: formData.get("activo") === "on",
  };

  const { error } = id
    ? await supabase.from("fin_clientes").update(fila).eq("id", id)
    : await supabase.from("fin_clientes").insert({ ...fila, cuenta_id: cuenta.id });

  if (error) return { error: `No se pudo guardar: ${error.message}` };

  revalidatePath("/clientes");
  return { ok: true, ir: "/clientes" };
}

// ----------------------------------------------------------------- series

export async function crearSerie(_previo: EstadoAccion, formData: FormData): Promise<EstadoAccion> {
  const { supabase, cuenta } = await exigirFacturacion();

  const codigo = (limpio(formData.get("codigo")) ?? "").toUpperCase();
  if (!/^[A-Z0-9]{1,4}$/.test(codigo)) {
    return { error: "El código son de 1 a 4 letras o números, sin espacios ni guiones." };
  }

  const sociedad_id = limpio(formData.get("sociedad_id"));
  const ejercicio = numeroDe(formData.get("ejercicio"));
  if (!sociedad_id || !ejercicio) return { error: "Elige sociedad y ejercicio." };

  const desde = numeroDe(formData.get("siguiente_numero"), 1);
  if (!Number.isInteger(desde) || desde < 1) {
    return { error: "El primer número debe ser un entero de 1 en adelante." };
  }

  const { error } = await supabase.from("fin_series").insert({
    cuenta_id: cuenta.id,
    sociedad_id,
    codigo,
    ejercicio,
    descripcion: limpio(formData.get("descripcion")),
    tipo_defecto: String(formData.get("tipo_defecto") ?? "F1"),
    siguiente_numero: desde,
    activa: true,
  });

  if (error) {
    return {
      error:
        error.code === "23505"
          ? `Ya existe la serie ${codigo} para ${ejercicio} en esa sociedad.`
          : `No se pudo crear la serie: ${error.message}`,
    };
  }

  revalidatePath("/series");
  return { ok: true };
}

export async function cambiarActivaSerie(id: string, activa: boolean) {
  const { supabase } = await exigirFacturacion();
  const { error } = await supabase.from("fin_series").update({ activa }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/series");
  return { ok: true };
}

// --------------------------------------------------------------- facturas

export type LineaEnviada = {
  concepto: string;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  tipo_iva: number;
  tipo_retencion: number;
};

export type FacturaEnviada = {
  id?: string;
  serie_id: string;
  tipo: string;
  cliente_id: string | null;
  centro_id: string | null;
  fecha_operacion: string | null;
  descripcion_operacion: string | null;
  notas_internas: string | null;
  lineas: LineaEnviada[];
};

export async function guardarBorrador(datos: FacturaEnviada) {
  const { supabase, cuenta } = await exigirFacturacion();

  if (!datos.serie_id) return { error: "Elige una serie: sin serie no hay numeración posible." };

  const { data: serie, error: errorSerie } = await supabase
    .from("fin_series")
    .select("id, sociedad_id, ejercicio, activa")
    .eq("id", datos.serie_id)
    .maybeSingle();

  if (errorSerie || !serie) return { error: "La serie elegida ya no existe." };
  if (!serie.activa) return { error: "Esa serie está desactivada." };

  // Los totales se recalculan aquí SIEMPRE: lo que manda el navegador es
  // orientativo. Al expedir volverá a recalcularlos la función de la base.
  const brutas: LineaBruta[] = datos.lineas.map((l) => ({
    cantidad: l.cantidad,
    precio_unitario: l.precio_unitario,
    descuento_pct: l.descuento_pct,
    tipo_iva: l.tipo_iva,
    tipo_retencion: l.tipo_retencion,
  }));
  const totales = calcularTotales(brutas);

  const cabecera = {
    cuenta_id: cuenta.id,
    sociedad_id: serie.sociedad_id,
    centro_id: datos.centro_id,
    serie_id: serie.id,
    ejercicio: serie.ejercicio,
    tipo: datos.tipo,
    cliente_id: datos.cliente_id,
    fecha_operacion: datos.fecha_operacion,
    descripcion_operacion: datos.descripcion_operacion,
    notas_internas: datos.notas_internas,
    base_total: totales.base_total,
    cuota_iva_total: totales.cuota_iva_total,
    cuota_retencion: totales.cuota_retencion,
    total: totales.total,
  };

  let id = datos.id;

  if (id) {
    const { data: actual } = await supabase
      .from("fin_facturas")
      .select("estado")
      .eq("id", id)
      .maybeSingle();
    if (!actual) return { error: "Ese borrador ya no existe." };
    if (actual.estado !== "borrador") {
      return { error: "La factura ya está expedida: su contenido es inmutable." };
    }

    const { error } = await supabase.from("fin_facturas").update(cabecera).eq("id", id);
    if (error) return { error: `No se pudieron guardar los cambios: ${error.message}` };

    const { error: errBorrado } = await supabase
      .from("fin_factura_lineas")
      .delete()
      .eq("factura_id", id);
    if (errBorrado) return { error: `No se pudieron actualizar las líneas: ${errBorrado.message}` };
  } else {
    const { data, error } = await supabase
      .from("fin_facturas")
      .insert({ ...cabecera, estado: "borrador" })
      .select("id")
      .single();
    if (error || !data) {
      return { error: `No se pudo guardar el borrador: ${error?.message ?? "error desconocido"}` };
    }
    id = data.id;
  }

  const utiles = datos.lineas.filter((l) => l.concepto.trim() !== "" || l.precio_unitario !== 0);
  if (utiles.length > 0) {
    const filas = utiles.map((l, i) => {
      const bruta: LineaBruta = {
        cantidad: l.cantidad,
        precio_unitario: l.precio_unitario,
        descuento_pct: l.descuento_pct,
        tipo_iva: l.tipo_iva,
        tipo_retencion: l.tipo_retencion,
      };
      const calc = calcularLinea(bruta);
      return {
        cuenta_id: cuenta.id,
        factura_id: id,
        orden: i + 1,
        concepto: l.concepto.trim() || "(sin concepto)",
        ...bruta,
        base: calc.base,
        cuota_iva: calc.cuota_iva,
        cuota_retencion: calc.cuota_retencion,
        total: calc.total,
      };
    });
    const { error } = await supabase.from("fin_factura_lineas").insert(filas);
    if (error) return { error: `La cabecera se guardó, pero las líneas no: ${error.message}` };
  }

  revalidatePath("/facturas");
  return { ok: true, id };
}

export type ResultadoExpedicion =
  | { error: string; ok?: undefined; id?: undefined }
  | { ok: true; id: string; error?: undefined };

/**
 * Guarda el borrador y lo expide en la misma acción. Se guarda antes a
 * propósito: la función de la base recalcula los totales DESDE LAS LÍNEAS
 * guardadas, así que expedir sin guardar congelaría datos viejos.
 */
export async function guardarYExpedir(datos: FacturaEnviada): Promise<ResultadoExpedicion> {
  const guardado = await guardarBorrador(datos);
  if (guardado?.error) return guardado;
  if (!guardado?.id) return { error: "No se pudo guardar el borrador antes de expedir." };

  const { supabase } = await exigirFacturacion();
  const { error } = await supabase.rpc("fin_expedir_factura", {
    p_factura_id: guardado.id,
  });

  if (error) {
    // La función valida y aborta la transacción entera: si algo falla, la
    // factura sigue siendo borrador y la serie no ha gastado número.
    return { error: `No se pudo expedir: ${error.message}` };
  }

  revalidatePath("/facturas");
  return { ok: true, id: guardado.id };
}

export async function anularFactura(id: string, motivo: string) {
  if (!motivo.trim()) return { error: "La anulación necesita un motivo." };

  const { supabase } = await exigirFacturacion();
  const { error } = await supabase.rpc("fin_anular_factura", {
    p_factura_id: id,
    p_motivo: motivo.trim(),
  });

  if (error) return { error: `No se pudo anular: ${error.message}` };

  revalidatePath("/facturas");
  revalidatePath(`/facturas/${id}`);
  return { ok: true };
}

/** Códigos de la AEAT (mismas listas que el SII). El texto es el suyo, no una
 *  interpretación: quien elige la causa es quien factura. */
export const CAUSAS_RECTIFICACION = [
  { codigo: "R1", texto: "Error fundado en derecho y art. 80 Uno, Dos y Seis de la Ley del IVA" },
  { codigo: "R2", texto: "Concurso de acreedores (art. 80 Tres)" },
  { codigo: "R3", texto: "Créditos incobrables (art. 80 Cuatro)" },
  { codigo: "R4", texto: "Resto de causas" },
  { codigo: "R5", texto: "Rectificación de facturas simplificadas" },
] as const;

/**
 * Crea el BORRADOR de una rectificativa a partir de una factura expedida.
 * No expide nada: deja el borrador listo para revisar y, si procede, expedir.
 *
 *  · Por sustitución (S): se copian las líneas de la original para corregirlas,
 *    porque la rectificativa contiene la factura correcta entera.
 *  · Por diferencias (I): se deja sin líneas, porque solo lleva el ajuste, y
 *    ese lo escribe quien factura (normalmente en negativo).
 */
export async function crearRectificativa(datos: {
  facturaId: string;
  tipo: string;
  tipoRectificativa: "S" | "I";
  motivo: string;
}) {
  const { supabase, cuenta } = await exigirFacturacion();

  if (!CAUSAS_RECTIFICACION.some((c) => c.codigo === datos.tipo)) {
    return { error: "Causa de rectificación no válida." };
  }
  if (!datos.motivo.trim()) return { error: "La rectificativa necesita un motivo." };

  const { data: original } = await supabase
    .from("fin_facturas")
    .select("id, sociedad_id, serie_id, ejercicio, estado, cliente_id, centro_id, numero_completo")
    .eq("id", datos.facturaId)
    .maybeSingle();

  if (!original) return { error: "La factura original ya no existe." };
  if (original.estado === "borrador") {
    return { error: "Un borrador no se rectifica: se corrige y ya está." };
  }

  // La rectificativa va en su propia serie si la hay (la R de la casa), y si no
  // en la misma que la original. Nunca reutiliza el número de la original.
  const { data: series } = await supabase
    .from("fin_series")
    .select("id, codigo, ejercicio, activa")
    .eq("ejercicio", original.ejercicio)
    .eq("activa", true);

  const serieR = (series ?? []).find((s) => s.codigo.toUpperCase().startsWith("R"));
  const serieId = serieR?.id ?? original.serie_id;

  const { data: creada, error } = await supabase
    .from("fin_facturas")
    .insert({
      cuenta_id: cuenta.id,
      sociedad_id: original.sociedad_id,
      serie_id: serieId,
      ejercicio: original.ejercicio,
      tipo: datos.tipo,
      estado: "borrador",
      cliente_id: original.cliente_id,
      centro_id: original.centro_id,
      fecha_operacion: new Date().toISOString().slice(0, 10),
      factura_rectificada_id: original.id,
      tipo_rectificativa: datos.tipoRectificativa,
      motivo_rectificacion: datos.motivo.trim(),
      descripcion_operacion: `Rectifica a ${original.numero_completo ?? "factura anterior"}`,
    })
    .select("id")
    .single();

  if (error || !creada) {
    return { error: `No se pudo crear la rectificativa: ${error?.message ?? "error desconocido"}` };
  }

  if (datos.tipoRectificativa === "S") {
    const { data: lineas } = await supabase
      .from("fin_factura_lineas")
      .select("orden, concepto, cantidad, precio_unitario, descuento_pct, tipo_iva, tipo_retencion, base, cuota_iva, cuota_retencion, total")
      .eq("factura_id", original.id)
      .order("orden");

    if (lineas && lineas.length > 0) {
      await supabase.from("fin_factura_lineas").insert(
        lineas.map((l) => ({ ...l, cuenta_id: cuenta.id, factura_id: creada.id })),
      );
    }
  }

  revalidatePath("/facturas");
  return { ok: true, id: creada.id, ir: `/facturas/${creada.id}` };
}

export async function borrarBorrador(id: string) {
  const { supabase } = await exigirFacturacion();

  const { data: actual } = await supabase
    .from("fin_facturas")
    .select("estado")
    .eq("id", id)
    .maybeSingle();
  if (!actual) return { error: "Ese borrador ya no existe." };
  if (actual.estado !== "borrador") {
    return { error: "Una factura expedida no se borra: se anula o se rectifica." };
  }

  // Las líneas se borran ANTES que la cabecera a propósito: con el
  // `on delete cascade`, el trigger protector de las líneas ya no encuentra la
  // factura padre, la da por expedida y aborta el borrado. Hay una migración
  // de arreglo propuesta en supabase/migrations.
  const { error: errLineas } = await supabase
    .from("fin_factura_lineas")
    .delete()
    .eq("factura_id", id);
  if (errLineas) return { error: `No se pudieron borrar las líneas: ${errLineas.message}` };

  const { error } = await supabase.from("fin_facturas").delete().eq("id", id);
  if (error) return { error: `No se pudo borrar: ${error.message}` };

  revalidatePath("/facturas");
  return { ok: true, ir: "/facturas" };
}
