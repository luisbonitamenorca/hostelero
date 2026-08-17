"use server";

import { revalidatePath } from "next/cache";
import { exigirModulo } from "@/lib/supabase/server";
import { redondear } from "@/lib/importes";
import { clienteDiario, type LineaAsiento } from "@/lib/diario";

/**
 * Guarda un asiento en BORRADOR: cabecera y apuntes.
 *
 * Los apuntes se borran y se reescriben enteros en vez de ir casando cuál
 * cambió. Es más simple y es seguro porque solo se hace sobre borradores: en
 * cuanto el asiento está confirmado, la base rechaza tocarlos (F5a).
 */
export async function guardarAsiento(datos: {
  id: string | null;
  fecha: string;
  descripcion: string;
  lineas: LineaAsiento[];
}) {
  const { supabase, cuenta } = await exigirModulo("contabilidad");
  const db = clienteDiario(supabase);

  if (!datos.fecha) return { error: "Falta la fecha del asiento." };

  // Se descartan las líneas en blanco antes de validar: el editor siempre
  // enseña una fila vacía al final y no es un error dejarla.
  const lineas = datos.lineas.filter(
    (l) => l.cuentaPlanId && (redondear(l.debe) !== 0 || redondear(l.haber) !== 0),
  );

  if (lineas.length < 2) {
    return { error: "Un asiento necesita al menos dos apuntes con importe." };
  }
  if (lineas.some((l) => redondear(l.debe) !== 0 && redondear(l.haber) !== 0)) {
    return { error: "Un apunte va al debe o al haber, no a los dos." };
  }
  if (lineas.some((l) => l.debe < 0 || l.haber < 0)) {
    return { error: "Los importes no pueden ser negativos: cambia de columna." };
  }

  const debe = redondear(lineas.reduce((s, l) => s + l.debe, 0));
  const haber = redondear(lineas.reduce((s, l) => s + l.haber, 0));
  if (debe !== haber) {
    return { error: `El asiento no cuadra: debe ${debe} y haber ${haber}.` };
  }

  const { data: sociedad } = await supabase
    .from("sociedades").select("id").eq("cuenta_id", cuenta.id).limit(1).maybeSingle();
  if (!sociedad) return { error: "No hay sociedad en la cuenta." };

  // El ejercicio se deduce del año de la fecha: es el único que puede ser.
  const anio = Number(datos.fecha.slice(0, 4));
  const { data: ejercicio } = await supabase
    .from("fin_ejercicios")
    .select("id, estado")
    .eq("sociedad_id", sociedad.id)
    .eq("anio", anio)
    .maybeSingle();

  if (!ejercicio) {
    return { error: `No hay ejercicio abierto para ${anio}. Créalo antes de contabilizar.` };
  }
  if (ejercicio.estado !== "abierto") {
    return { error: `El ejercicio ${anio} está cerrado.` };
  }

  let asientoId = datos.id;

  if (asientoId) {
    // El ejercicio se reescribe con la fecha: si al reeditar el borrador se le
    // cambia el año, el ejercicio viejo dejaría de corresponder y confirmar
    // fallaría con «la fecha queda fuera del ejercicio», que no dice nada al
    // que solo ha corregido una fecha.
    const { error } = await db
      .from("fin_asientos")
      .update({
        fecha: datos.fecha,
        ejercicio_id: ejercicio.id,
        descripcion: datos.descripcion.trim() || null,
      })
      .eq("id", asientoId);
    if (error) return { error: `No se pudo guardar el asiento: ${error.message}` };

    const { error: errorBorrado } = await db.from("fin_apuntes").delete().eq("asiento_id", asientoId);
    if (errorBorrado) return { error: `No se pudieron reescribir los apuntes: ${errorBorrado.message}` };
  } else {
    // Sin `estado` ni `numero` a propósito: los pone la base (F5a).
    const { data, error } = await db
      .from("fin_asientos")
      .insert({
        cuenta_id: cuenta.id,
        sociedad_id: sociedad.id,
        ejercicio_id: ejercicio.id,
        fecha: datos.fecha,
        descripcion: datos.descripcion.trim() || null,
        origen_tipo: "manual",
      })
      .select("id")
      .single();
    if (error || !data) return { error: `No se pudo crear el asiento: ${error?.message}` };
    asientoId = data.id;
  }

  const { error: errorApuntes } = await db.from("fin_apuntes").insert(
    lineas.map((l, i) => ({
      cuenta_id: cuenta.id,
      asiento_id: asientoId,
      orden: i + 1,
      cuenta_plan_id: l.cuentaPlanId,
      descripcion: l.descripcion?.trim() || null,
      debe: redondear(l.debe),
      haber: redondear(l.haber),
    })),
  );
  if (errorApuntes) return { error: `No se pudieron guardar los apuntes: ${errorApuntes.message}` };

  revalidatePath("/asientos");
  revalidatePath(`/asientos/${asientoId}`);
  return { ok: true, id: asientoId };
}

/**
 * Confirma el asiento. Todo lo importante lo comprueba la base: cuadre, número
 * correlativo, ejercicio abierto y mes no bloqueado. Aquí solo se llama y se
 * traduce el error, porque la app no es la que manda.
 */
export async function confirmarAsiento(id: string) {
  const { supabase } = await exigirModulo("contabilidad");

  const { data, error } = await clienteDiario(supabase).rpc("fin_confirmar_asiento", {
    p_asiento_id: id,
  });

  if (error) return { error: error.message };

  revalidatePath("/asientos");
  revalidatePath(`/asientos/${id}`);
  return { ok: true, numero: (data as { numero?: number } | null)?.numero ?? null };
}

/** Solo borradores. Un asiento confirmado se corrige con otro asiento. */
export async function borrarAsiento(id: string) {
  const { supabase } = await exigirModulo("contabilidad");

  const { error } = await clienteDiario(supabase).from("fin_asientos").delete().eq("id", id);
  if (error) return { error: `No se pudo borrar: ${error.message}` };

  revalidatePath("/asientos");
  return { ok: true, ir: "/asientos" };
}

/**
 * Alta de una cuenta contable a mano.
 *
 * Hace falta porque el plan de cuentas de hoy son 635 subcuentas de proveedor
 * más las del inmovilizado: no hay ni una cuenta de venta, de gasto o de
 * tesorería, así que sin esto no se puede escribir un asiento. Cuando llegue
 * el plan completo de A3 esto seguirá valiendo para las altas sueltas.
 */
export async function crearCuenta(datos: { codigo: string; nombre: string }) {
  const { supabase, cuenta } = await exigirModulo("contabilidad");

  const codigo = datos.codigo.trim();
  const nombre = datos.nombre.trim();

  if (!/^\d{3,10}$/.test(codigo)) {
    return { error: "El código son de 3 a 10 dígitos, sin letras ni puntos." };
  }
  if (!nombre) return { error: "Ponle nombre a la cuenta." };

  const { data: sociedad } = await supabase
    .from("sociedades").select("id").eq("cuenta_id", cuenta.id).limit(1).maybeSingle();
  if (!sociedad) return { error: "No hay sociedad en la cuenta." };

  const { error } = await supabase.from("fin_plan_cuentas").insert({
    cuenta_id: cuenta.id,
    sociedad_id: sociedad.id,
    codigo,
    nombre,
    origen: "manual",
  });

  if (error) {
    // La restricción es UNIQUE (sociedad_id, codigo).
    if (error.code === "23505") return { error: `La cuenta ${codigo} ya existe.` };
    return { error: `No se pudo crear la cuenta: ${error.message}` };
  }

  revalidatePath("/plan-cuentas");
  return { ok: true };
}
