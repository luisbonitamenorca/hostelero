"use server";

import { exigirModulo } from "@/lib/supabase/server";
import type { Campana, Canal, Cliente, ConsentMap, Lista, Supresion } from "./tipos";
import { SIN_CONSENT } from "./tipos";

// Todo el acceso a datos del CRM pasa por aquí: cliente autenticado del esqueleto
// bajo RLS. Regla de oro: `consentimientos` SOLO recibe inserts (eventos), jamás
// update/delete. Los booleanos se leen de la vista clientes_consentimiento_vigente.
async function cliente() {
  const { supabase, perfil } = await exigirModulo("crm");
  return { sb: supabase, correo: perfil.correo };
}

type R<T = undefined> = { ok: boolean; error?: string; data?: T };
const POR_PAGINA = 50;

/* ================= Panel (censo) ================= */

export async function kpis() {
  const { sb } = await cliente();
  const cuenta = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const [total, email, sms, whatsapp, salaSinFicha, supresiones] = await Promise.all([
    cuenta(sb.from("clientes").select("id", { count: "exact", head: true })),
    cuenta(sb.from("clientes_consentimiento_vigente").select("cliente_id", { count: "exact", head: true }).eq("email", true)),
    cuenta(sb.from("clientes_consentimiento_vigente").select("cliente_id", { count: "exact", head: true }).eq("sms", true)),
    cuenta(sb.from("clientes_consentimiento_vigente").select("cliente_id", { count: "exact", head: true }).eq("whatsapp", true)),
    cuenta(sb.from("reservas_clientes").select("id", { count: "exact", head: true }).is("cliente_id", null)),
    cuenta(sb.from("supresiones").select("id", { count: "exact", head: true })),
  ]);
  return { total, email, sms, whatsapp, salaSinFicha, supresiones };
}

export async function canales(): Promise<Canal[]> {
  const { sb } = await cliente();
  const { data } = await sb.from("crm_canales").select("*").order("canal");
  return data ?? [];
}

/* ================= Clientes ================= */

export async function listarClientes(input: { filtro: string; q: string; pagina: number }) {
  const { sb } = await cliente();
  const { filtro, q, pagina } = input;

  // Filtro por canal o por baja: primero los ids que cumplen, luego la página.
  let idsFiltro: string[] | null = null;
  if (filtro === "email" || filtro === "sms" || filtro === "whatsapp") {
    const { data } = await sb
      .from("clientes_consentimiento_vigente")
      .select("cliente_id")
      .eq(filtro, true)
      .limit(2000);
    idsFiltro = (data ?? []).map((x) => x.cliente_id).filter((x): x is string => !!x);
    if (!idsFiltro.length) return { clientes: [], consentimientos: {}, count: 0 };
  } else if (filtro === "baja") {
    const { data } = await sb.from("supresiones").select("cliente_id").not("cliente_id", "is", null).limit(2000);
    idsFiltro = [...new Set((data ?? []).map((x) => x.cliente_id).filter((x): x is string => !!x))];
    if (!idsFiltro.length) return { clientes: [], consentimientos: {}, count: 0 };
  }

  let query = sb
    .from("clientes")
    .select("*", { count: "exact" })
    .order("creado_en", { ascending: false })
    .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
  if (idsFiltro) query = query.in("id", idsFiltro);
  if (q.trim()) {
    const b = q.trim().replace(/[%,()]/g, "");
    query = query.or(`nombre.ilike.%${b}%,email.ilike.%${b}%,telefono.ilike.%${b}%`);
  }
  const { data, count, error } = await query;
  if (error) return { clientes: [], consentimientos: {}, count: 0 };

  const clientes = (data ?? []) as Cliente[];
  const consentimientos: Record<string, ConsentMap> = {};
  if (clientes.length) {
    const { data: vs } = await sb
      .from("clientes_consentimiento_vigente")
      .select("cliente_id, email, sms, whatsapp")
      .in("cliente_id", clientes.map((c) => c.id));
    (vs ?? []).forEach((v) => {
      if (v.cliente_id) consentimientos[v.cliente_id] = { email: !!v.email, sms: !!v.sms, whatsapp: !!v.whatsapp };
    });
  }
  return { clientes, consentimientos, count: count ?? 0 };
}

export async function ficha(id: string) {
  const { sb } = await cliente();
  const [{ data: c }, { data: v }, { data: origenes }] = await Promise.all([
    sb.from("clientes").select("*").eq("id", id).single(),
    sb.from("clientes_consentimiento_vigente").select("email, sms, whatsapp").eq("cliente_id", id).maybeSingle(),
    sb.from("clientes_origenes").select("origen, id_externo, creado_en").eq("cliente_id", id).order("creado_en"),
  ]);
  if (!c) return null;
  // Supresiones que afectan a esta ficha (por vínculo o por valor normalizado)
  const valores = [c.email_norm, c.telefono_norm].filter(Boolean) as string[];
  let supresiones: Supresion[] = [];
  {
    const consultas = [sb.from("supresiones").select("*").eq("cliente_id", id)];
    if (valores.length) consultas.push(sb.from("supresiones").select("*").in("valor_norm", valores));
    const res = await Promise.all(consultas);
    const vistos = new Set<string>();
    res.flatMap((r) => r.data ?? []).forEach((s) => {
      if (!vistos.has(s.id)) { vistos.add(s.id); supresiones.push(s as Supresion); }
    });
  }
  // "En el restaurante": fichas de sala vinculadas → resumen de reservas
  const { data: sala } = await sb.from("reservas_clientes").select("id").eq("cliente_id", id);
  let visitas = 0, noshows = 0, ultima: string | null = null;
  if (sala?.length) {
    const { data: rs } = await sb
      .from("reservas_reservas")
      .select("fecha, estado")
      .in("cliente_id", sala.map((s) => s.id))
      .order("fecha", { ascending: false })
      .limit(500);
    (rs ?? []).forEach((r) => {
      if (r.estado === "terminada") { visitas++; if (!ultima) ultima = r.fecha; }
      if (r.estado === "no_show") noshows++;
    });
  }
  return {
    cliente: c as Cliente,
    consent: v ? { email: !!v.email, sms: !!v.sms, whatsapp: !!v.whatsapp } : SIN_CONSENT,
    origenes: origenes ?? [],
    supresiones,
    sala: { vinculadas: sala?.length ?? 0, visitas, noshows, ultima },
  };
}

/** Candidatas de la base de sala para vincular por teléfono (sin ficha aún). */
export async function candidatosSala(telefono: string | null) {
  const { sb } = await cliente();
  const dig = (telefono || "").replace(/\D/g, "");
  if (!dig) return [];
  const ultimos9 = dig.slice(-9);
  const { data } = await sb
    .from("reservas_clientes")
    .select("id, nombre, telefono")
    .is("cliente_id", null)
    .ilike("telefono", `%${ultimos9}%`)
    .limit(3);
  return data ?? [];
}

export async function vincularSala(salaClienteId: string, clienteId: string): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb.from("reservas_clientes").update({ cliente_id: clienteId }).eq("id", salaClienteId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function crearCliente(input: {
  nombre: string | null;
  email: string | null;
  telefono: string | null;
  cumpleanos: string | null;
}): Promise<R<Cliente>> {
  const { sb } = await cliente();
  if (!input.email && !input.telefono) return { ok: false, error: "Hace falta al menos email o teléfono" };
  const { data, error } = await sb
    .from("clientes")
    .insert({ ...input, origen_alta: "manual" })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  await sb.from("clientes_origenes").insert({ cliente_id: data.id, origen: "manual" });
  return { ok: true, data: data as Cliente };
}

export async function guardarCliente(
  id: string,
  campos: { nombre: string | null; email: string | null; telefono: string | null; cumpleanos: string | null; notas: string | null },
): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb.from("clientes").update(campos).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Cambia un consentimiento: SIEMPRE insert de evento; la vista hace el resto. */
export async function cambiarConsent(clienteId: string, canal: "email" | "sms" | "whatsapp", valor: boolean): Promise<R> {
  const { sb, correo } = await cliente();
  const { error } = await sb.from("consentimientos").insert({
    cliente_id: clienteId,
    finalidad: `marketing_${canal}`,
    estado: valor ? "otorgado" : "retirado",
    origen: "panel",
    evidencia: { detalle: `Cambiado por ${correo} desde la ficha` },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Baja total: supresiones por valor normalizado + eventos retirado. La ficha se conserva. */
export async function darDeBaja(clienteId: string): Promise<R> {
  const { sb, correo } = await cliente();
  const { data: c } = await sb.from("clientes").select("email_norm, telefono_norm").eq("id", clienteId).single();
  if (!c) return { ok: false, error: "Cliente no encontrado" };
  const sup: { canal: string; valor_norm: string; motivo: string; detalle: string; cliente_id: string }[] = [];
  if (c.email_norm) sup.push({ canal: "email", valor_norm: c.email_norm, motivo: "manual", detalle: "Baja desde ficha", cliente_id: clienteId });
  if (c.telefono_norm) {
    sup.push({ canal: "sms", valor_norm: c.telefono_norm, motivo: "manual", detalle: "Baja desde ficha", cliente_id: clienteId });
    sup.push({ canal: "whatsapp", valor_norm: c.telefono_norm, motivo: "manual", detalle: "Baja desde ficha", cliente_id: clienteId });
  }
  if (sup.length) {
    const { error } = await sb.from("supresiones").upsert(sup, { onConflict: "cuenta_id,canal,valor_norm", ignoreDuplicates: true });
    if (error) return { ok: false, error: error.message };
  }
  const { error } = await sb.from("consentimientos").insert(
    (["email", "sms", "whatsapp"] as const).map((canal) => ({
      cliente_id: clienteId,
      finalidad: `marketing_${canal}`,
      estado: "retirado",
      origen: "panel",
      evidencia: { detalle: `Baja total desde ficha por ${correo}` },
    })),
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ================= Listas ================= */

export async function listarListas(): Promise<Lista[]> {
  const { sb } = await cliente();
  const { data } = await sb.from("crm_listas").select("*, crm_lista_clientes(count)").order("creado_en");
  return (data ?? []).map((l) => ({
    ...l,
    n: (l as unknown as { crm_lista_clientes?: { count: number }[] }).crm_lista_clientes?.[0]?.count ?? 0,
  }));
}

export async function crearLista(nombre: string, descripcion: string | null): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb.from("crm_listas").insert({ nombre, descripcion });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function miembrosLista(listaId: string) {
  const { sb } = await cliente();
  const { data } = await sb
    .from("crm_lista_clientes")
    .select("cliente_id, anadido_en, clientes(id, nombre, email, telefono)")
    .eq("lista_id", listaId)
    .order("anadido_en", { ascending: false })
    .limit(200);
  return data ?? [];
}

export async function anadirALista(listaId: string, clienteId: string): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb.from("crm_lista_clientes").insert({ lista_id: listaId, cliente_id: clienteId });
  if (error && error.code === "23505") return { ok: false, error: "Ya está en la lista" };
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function quitarDeLista(listaId: string, clienteId: string): Promise<R> {
  const { sb } = await cliente();
  const { error } = await sb.from("crm_lista_clientes").delete().eq("lista_id", listaId).eq("cliente_id", clienteId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function sugerirClientes(q: string): Promise<Cliente[]> {
  const { sb } = await cliente();
  const t = q.trim();
  if (t.length < 2) return [];
  const b = t.replace(/[%,()]/g, "");
  const { data } = await sb
    .from("clientes")
    .select("*")
    .or(`nombre.ilike.%${b}%,email.ilike.%${b}%,telefono.ilike.%${b}%`)
    .limit(6);
  return (data ?? []) as Cliente[];
}

/* ================= Campañas (email v1) ================= */

export async function listarCampanas(): Promise<Campana[]> {
  const { sb } = await cliente();
  const { data } = await sb.from("crm_campanas").select("*").order("creado_en", { ascending: false }).limit(100);
  return (data ?? []) as Campana[];
}

export async function guardarCampana(
  id: string | null,
  fila: {
    nombre: string;
    asunto: string | null;
    preencabezado: string | null;
    cuerpo_html: string | null;
    audiencia: { tipo: string; lista_id?: string };
    lista_id: string | null;
  },
): Promise<R> {
  const { sb } = await cliente();
  const payload = { ...fila, estado: "borrador" };
  const { error } = id
    ? await sb.from("crm_campanas").update(payload).eq("id", id)
    : await sb.from("crm_campanas").insert(payload);
  return error ? { ok: false, error: error.message } : { ok: true };
}
