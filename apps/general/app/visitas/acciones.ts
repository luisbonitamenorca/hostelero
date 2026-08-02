"use server";

import { revalidatePath } from "next/cache";
import type { Database } from "@hostelero/db";
import { exigirModulo } from "@/lib/supabase/server";
import type { QuienViene, ResultadoBono, SesionDia } from "./comun";

type Idioma = Database["public"]["Enums"]["visitas_idioma"];

// Todas las escrituras exigen el módulo (sesión + contratado + rol) y corren
// bajo RLS con el rol authenticated. La cuenta la pone la sesión (cuenta_actual()).
async function cliente() {
  const { supabase } = await exigirModulo("visitas");
  return supabase;
}

function refrescarTodo() {
  for (const p of [
    "/visitas",
    "/visitas/calendario",
    "/visitas/reservas",
    "/visitas/bonos",
    "/visitas/productos",
  ]) {
    revalidatePath(p);
  }
}

type Resultado = { ok: boolean; error?: string };

/* ============================ RESERVAS ============================ */

/** Reserva presencial: ocupa plaza y se cobra en Ágora (se marca pagada). */
export async function crearReservaPresencial(input: {
  sesionId: string;
  nombre: string;
  personas: number;
  importe: number;
  email?: string;
  telefono?: string;
  pais?: string;
}): Promise<Resultado> {
  const sb = await cliente();
  const { data, error } = await sb.rpc("visitas_crear_reserva", {
    p_sesion_id: input.sesionId,
    p_cliente_nombre: input.nombre.trim() || "Reserva mostrador",
    p_cliente_email: input.email?.trim() || "",
    p_cliente_telefono: (input.telefono?.trim() || null) as unknown as string,
    p_cliente_pais: (input.pais?.trim() || null) as unknown as string,
    p_idioma_preferido: null as unknown as Idioma,
    p_num_personas: input.personas,
    p_importe_total: input.importe,
    p_metodo_pago: "agora_tpv",
  });
  if (error) return { ok: false, error: error.message };

  const reserva = data as unknown as { id?: string } | null;
  if (reserva?.id) {
    await sb.from("visitas_reservas").update({ estado: "pagada" }).eq("id", reserva.id);
  }
  refrescarTodo();
  return { ok: true };
}

export async function cancelarReserva(codigo: string): Promise<Resultado> {
  const sb = await cliente();
  const { error } = await sb.rpc("visitas_cancelar_reserva", { p_codigo_reserva: codigo });
  if (error) return { ok: false, error: error.message };
  refrescarTodo();
  return { ok: true };
}

export async function marcarEntrada(id: string, entra: boolean): Promise<Resultado> {
  const sb = await cliente();
  const { error } = await sb
    .from("visitas_reservas")
    .update({ check_in_at: entra ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/visitas/reservas");
  return { ok: true };
}

/* ============================ SESIONES ============================ */

export async function generarSesiones(input: {
  productoId: string;
  desde: string;
  hasta: string;
  hora: string;
  dias: number[];
  aforo: number | null;
  centroId: string | null;
}): Promise<Resultado & { creadas?: number }> {
  const sb = await cliente();
  const { data, error } = await sb.rpc("visitas_generar_sesiones", {
    p_producto_id: input.productoId,
    p_fecha_desde: input.desde,
    p_fecha_hasta: input.hasta,
    p_hora: input.hora,
    p_dias_semana: input.dias,
    p_aforo: input.aforo ?? undefined,
    p_centro_id: input.centroId ?? undefined,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/visitas/calendario");
  revalidatePath("/visitas");
  return { ok: true, creadas: Number(data ?? 0) };
}

export async function crearSesion(input: {
  productoId: string;
  fecha: string;
  hora: string;
  aforo: number;
  centroId: string | null;
}): Promise<Resultado> {
  const sb = await cliente();
  const { error } = await sb.from("visitas_sesiones").insert({
    producto_id: input.productoId,
    fecha: input.fecha,
    hora_inicio: input.hora,
    aforo: input.aforo,
    centro_id: input.centroId,
    estado: "activa",
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/visitas/calendario");
  return { ok: true };
}

export async function duplicarSesion(input: {
  productoId: string;
  fechas: string[];
  hora: string;
  aforo: number;
  centroId: string | null;
}): Promise<Resultado & { creadas?: number }> {
  const sb = await cliente();
  const rows = input.fechas.map((f) => ({
    producto_id: input.productoId,
    fecha: f,
    hora_inicio: input.hora,
    aforo: input.aforo,
    centro_id: input.centroId,
    estado: "activa" as const,
  }));
  const { error } = await sb.from("visitas_sesiones").insert(rows);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/visitas/calendario");
  return { ok: true, creadas: rows.length };
}

export async function ajustarAforo(id: string, nuevo: number): Promise<Resultado> {
  const sb = await cliente();
  const { error } = await sb.from("visitas_sesiones").update({ aforo: nuevo }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/visitas/calendario");
  return { ok: true };
}

export async function cancelarSesion(id: string): Promise<Resultado> {
  const sb = await cliente();
  const { error } = await sb.from("visitas_sesiones").update({ estado: "cancelada" }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/visitas/calendario");
  return { ok: true };
}

export async function guardarNota(id: string, nota: string): Promise<Resultado> {
  const sb = await cliente();
  const { error } = await sb
    .from("visitas_sesiones")
    .update({ nota: nota.trim() || null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/visitas/calendario");
  return { ok: true };
}

export async function toggleVisibleWeb(id: string, actual: boolean): Promise<Resultado> {
  const sb = await cliente();
  const { error } = await sb
    .from("visitas_sesiones")
    .update({ visible_web: !actual })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/visitas/calendario");
  return { ok: true };
}

export async function eliminarSesion(id: string): Promise<Resultado> {
  const sb = await cliente();
  // Solo si no tiene reservas vivas: si las tiene, se cancela, no se borra.
  const { count } = await sb
    .from("visitas_reservas")
    .select("id", { count: "exact", head: true })
    .eq("sesion_id", id)
    .neq("estado", "cancelada");
  if ((count ?? 0) > 0) {
    return { ok: false, error: "No se puede eliminar: tiene reservas. Cancélala en su lugar." };
  }
  const { error } = await sb.from("visitas_sesiones").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/visitas/calendario");
  return { ok: true };
}

/* ============================ PRODUCTOS ============================ */

export async function guardarProducto(
  id: string | null,
  rec: {
    tipo: Database["public"]["Enums"]["visitas_tipo_producto"];
    nombre_es: string;
    nombre_en: string | null;
    nombre_fr: string | null;
    descripcion_es: string | null;
    precio: number;
    activo: boolean;
    idioma: Idioma | null;
    duracion_min: number | null;
    aforo_default: number | null;
    tipo_bono: Database["public"]["Enums"]["visitas_tipo_bono"] | null;
    caducidad_meses: number | null;
  },
): Promise<Resultado> {
  const sb = await cliente();
  if (!rec.nombre_es.trim()) return { ok: false, error: "Pon al menos el nombre en español" };
  const { error } = id
    ? await sb.from("visitas_productos").update(rec).eq("id", id)
    : await sb.from("visitas_productos").insert(rec);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/visitas/productos");
  return { ok: true };
}

/* ============================== BONOS ============================== */

export async function venderBono(rec: {
  producto_id: string;
  comprador_nombre: string;
  comprador_email: string;
  beneficiario_nombre: string | null;
  unidades: number;
  importe: number;
  caduca_at: string | null;
}): Promise<Resultado> {
  const sb = await cliente();
  if (!rec.comprador_nombre.trim() || !rec.comprador_email.trim()) {
    return { ok: false, error: "Falta comprador o email" };
  }
  const { error } = await sb.from("visitas_bonos").insert(rec);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/visitas/bonos");
  return { ok: true };
}

/** Solo valida: NO gasta el bono. */
export async function validarBono(codigo: string): Promise<ResultadoBono> {
  const cod = codigo.trim().toUpperCase();
  if (!cod) return { ok: false, error: "Introduce un código" };
  const sb = await cliente();
  const { data, error } = await sb.rpc("visitas_validar_bono", { p_codigo_canje: cod });
  if (error) return { ok: false, error: error.message };
  const r = Array.isArray(data) ? data[0] : data;
  if (!r) return { ok: false, error: "Sin respuesta" };
  let unidades = 1;
  if (r.valido) {
    const { data: b } = await sb
      .from("visitas_bonos")
      .select("unidades")
      .eq("codigo_canje", cod)
      .maybeSingle();
    if (b?.unidades) unidades = b.unidades;
  }
  return {
    ok: true,
    valido: r.valido,
    motivo: r.motivo,
    concepto: r.concepto,
    importe: r.importe,
    caduca_at: r.caduca_at,
    unidades,
  };
}

/** "Quién viene" a una sesión: reservas vivas (no canceladas). */
export async function reservasDeSesion(sesionId: string): Promise<QuienViene[]> {
  const sb = await cliente();
  const { data } = await sb
    .from("visitas_reservas")
    .select("codigo_reserva, cliente_nombre, num_personas, metodo_pago")
    .eq("sesion_id", sesionId)
    .neq("estado", "cancelada")
    .order("created_at");
  return (data ?? []).map((r) => ({
    codigo: r.codigo_reserva,
    nombre: r.cliente_nombre,
    personas: r.num_personas,
    metodo: r.metodo_pago,
  }));
}

/** Sesiones activas de un día, para elegir dónde canjear un bono. */
export async function sesionesActivasDia(fecha: string): Promise<SesionDia[]> {
  const sb = await cliente();
  const { data } = await sb
    .from("visitas_sesiones")
    .select("id, hora_inicio, visitas_productos(nombre_es, idioma)")
    .eq("fecha", fecha)
    .eq("estado", "activa")
    .order("hora_inicio");
  return (data ?? []).map((s) => ({
    id: s.id,
    hora: (s.hora_inicio || "").slice(0, 5),
    nombre: s.visitas_productos?.nombre_es ?? "",
    idioma: s.visitas_productos?.idioma ?? null,
  }));
}

export async function canjearBono(input: {
  codigo: string;
  sesionId: string;
  personas: number;
  nombre: string | null;
}): Promise<Resultado> {
  const sb = await cliente();
  const { error } = await sb.rpc("visitas_canjear_bono", {
    p_codigo_canje: input.codigo,
    p_sesion_id: input.sesionId,
    p_num_personas: input.personas,
    p_nombre: input.nombre ?? undefined,
  });
  if (error) return { ok: false, error: error.message };
  refrescarTodo();
  return { ok: true };
}
