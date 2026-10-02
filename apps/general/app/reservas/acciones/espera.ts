"use server";

/* Acciones de servidor de la Lista de espera del panel de Reservas.
   Cliente autenticado bajo RLS; nada de service key. El aviso al cliente lo compone el RPC
   reservas_lista_espera_avisar (encola en reservas_mensajes) y lo envía el cron. */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables } from "@hostelero/db";

async function cliente() {
  const { supabase, perfil } = await exigirModulo("reservas");
  return { sb: supabase, perfil };
}
type Sb = Awaited<ReturnType<typeof cliente>>["sb"];
type Perfil = Awaited<ReturnType<typeof cliente>>["perfil"];

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

/* ================= Permisos de sala (reservas_permisos_perfil) =================
   Mismo criterio que acciones/dia.ts e inbox.ts: dirección pasa siempre; sin fila, todo
   permitido; con fila, se exige el flag (si se pide) y el restaurante de su lista. Privado
   (en un "use server" lo exportado es acción pública); el integrador lo consolida. */

async function exigirPermisoSala(sb: Sb, perfil: Perfil, permiso: "puede_cambiar_estado" | null, restauranteId: string | null): Promise<string | null> {
  if (perfil.rol === "direccion") return null;
  const { data } = await sb
    .from("reservas_permisos_perfil")
    .select("puede_cambiar_estado, restaurantes")
    .eq("perfil_id", perfil.id)
    .maybeSingle();
  if (!data) return null;
  if (permiso === "puede_cambiar_estado" && !data.puede_cambiar_estado) return "No tienes permiso para cambiar el estado de las reservas.";
  if (restauranteId && data.restaurantes && !data.restaurantes.includes(restauranteId)) return "No tienes permiso sobre este restaurante.";
  return null;
}

/** Restaurante de una entrada (y de paso comprueba que existe y es de la cuenta). */
async function restDeEntrada(sb: Sb, id: string): Promise<string | null> {
  const { data } = await sb.from("reservas_lista_espera").select("restaurante_id").eq("id", id).maybeSingle();
  return data?.restaurante_id ?? null;
}

/** Fecha de hoy en la zona horaria del restaurante. */
async function hoyDelRestaurante(sb: Sb, restauranteId: string): Promise<string> {
  const { data } = await sb.from("reservas_restaurantes").select("zona_horaria").eq("id", restauranteId).maybeSingle();
  const fmt = (zona: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  try { return fmt(data?.zona_horaria || "Europe/Madrid"); } catch { return fmt("Europe/Madrid"); }
}

/* ================= Tipos ================= */

/** Lo que la pantalla necesita de cada entrada (sin token ni email: no viajan al navegador). */
export type EntradaEspera = Pick<
  Tables<"reservas_lista_espera">,
  "id" | "restaurante_id" | "fecha" | "nombre" | "telefono" | "pax" | "estado" | "hora_preferida" | "zona_id" | "notas" | "creado_en" | "avisado_en" | "reserva_id" | "cliente_id"
>;
const CAMPOS_ENTRADA = "id, restaurante_id, fecha, nombre, telefono, pax, estado, hora_preferida, zona_id, notas, creado_en, avisado_en, reserva_id, cliente_id";
export type MesaEspera = Pick<Tables<"reservas_mesas">, "id" | "nombre" | "sala_id" | "cap_min" | "cap_max" | "activa" | "tipo">;
export type SalaEspera = Pick<Tables<"reservas_salas">, "id" | "nombre" | "activa" | "orden"> & { mesas: MesaEspera[] };
/** Reserva viva del día, lo justo para saber qué mesas están ocupadas y cuándo se liberan. */
export type OcupacionEspera = { id: string; hora: string; duracion_min: number; pax: number; estado: string; mesas: string[] };
export type BloqueoEspera = Pick<Tables<"reservas_bloqueos">, "id" | "mesa_id" | "sala_id" | "hora_inicio" | "hora_fin">;

export type DatosEspera = {
  entradas: EntradaEspera[];
  salas: SalaEspera[];
  turnos: Tables<"reservas_turnos">[];
  ocupacion: OcupacionEspera[];
  bloqueos: BloqueoEspera[];
};

/** Estados que ocupan mesa (espejo de reservas_estados_activos). */
const ESTADOS_ACTIVOS = ["pendiente", "confirmada", "reconfirmada", "llegada", "sentada", "postre", "cuenta", "a_revisar", "tarjeta_pendiente"];

/** Teléfono normalizado como reservas_norm_tel: solo dígitos, con prefijo 34 si son 9. */
function normTel(t: string | null | undefined): string | null {
  const d = (t ?? "").replace(/\D/g, "");
  if (!d) return null;
  return d.length === 9 ? "34" + d : d;
}

/* ================= Lectura ================= */

export async function lista(restauranteId: string, fecha: string): Promise<R<DatosEspera>> {
  const { sb, perfil } = await cliente();
  const sinPermiso = await exigirPermisoSala(sb, perfil, null, restauranteId);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const [ent, salas, turnos, res, blo] = await Promise.all([
    sb.from("reservas_lista_espera").select(CAMPOS_ENTRADA).eq("restaurante_id", restauranteId).eq("fecha", fecha).order("creado_en"),
    sb.from("reservas_salas").select("id, nombre, activa, orden, mesas:reservas_mesas(id, nombre, sala_id, cap_min, cap_max, activa, tipo)")
      .eq("restaurante_id", restauranteId).eq("activa", true).order("orden"),
    sb.from("reservas_turnos").select("*").eq("restaurante_id", restauranteId).eq("activo", true).order("hora_inicio"),
    sb.from("reservas_reservas").select("id, hora, duracion_min, pax, estado, mesa_id, reservas_reserva_mesas(mesa_id)")
      .eq("restaurante_id", restauranteId).eq("fecha", fecha).in("estado", ESTADOS_ACTIVOS),
    sb.from("reservas_bloqueos").select("id, mesa_id, sala_id, hora_inicio, hora_fin").eq("restaurante_id", restauranteId).eq("fecha", fecha),
  ]);
  const fallo = [ent, salas, turnos, res, blo].find((x) => x.error);
  if (fallo?.error) return { ok: false, error: fallo.error.message };

  const ocupacion: OcupacionEspera[] = (res.data ?? []).map((r) => {
    const mesas = (r.reservas_reserva_mesas ?? []).map((m) => m.mesa_id);
    if (r.mesa_id && !mesas.includes(r.mesa_id)) mesas.push(r.mesa_id);
    return { id: r.id, hora: r.hora, duracion_min: r.duracion_min, pax: r.pax, estado: r.estado, mesas };
  });
  return {
    ok: true,
    data: {
      entradas: ent.data ?? [],
      salas: (salas.data ?? []).map((s) => ({ ...s, mesas: (s.mesas ?? []).filter((m) => m.activa) })),
      turnos: turnos.data ?? [],
      ocupacion,
      bloqueos: blo.data ?? [],
    },
  };
}

/* ================= Escrituras ================= */

export async function crear(input: {
  restauranteId: string;
  fecha: string;
  nombre: string;
  telefono: string;
  pax: number;
  horaPreferida: string | null;
  zonaId: string | null;
  notas: string | null;
  email?: string | null;
}): Promise<R<EntradaEspera>> {
  const { sb, perfil } = await cliente();
  const sinPermiso = await exigirPermisoSala(sb, perfil, null, input.restauranteId);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const nombre = input.nombre.trim().slice(0, 120);
  if (!nombre) return { ok: false, error: "Falta el nombre." };
  const tel = normTel(input.telefono);
  if (!tel || tel.length < 9) return { ok: false, error: "Hace falta un teléfono válido para poder avisar." };
  const pax = Math.max(1, Math.min(99, Math.round(input.pax || 1)));

  // Cliente ya conocido por teléfono (para el histórico y el aviso en su idioma).
  const { data: cli } = await sb.from("reservas_clientes").select("id, idioma").or(`telefono_norm.eq.${tel},telefono.eq.${tel}`).limit(1).maybeSingle();
  // Turno al que cae la hora preferida (si la hay).
  let turnoId: string | null = null;
  if (input.horaPreferida) {
    const { data: t } = await sb
      .from("reservas_turnos").select("id").eq("restaurante_id", input.restauranteId).eq("activo", true)
      .lte("hora_inicio", input.horaPreferida).gte("hora_fin", input.horaPreferida).order("hora_inicio").limit(1).maybeSingle();
    turnoId = t?.id ?? null;
  }
  const { data, error } = await sb
    .from("reservas_lista_espera")
    .insert({
      restaurante_id: input.restauranteId,
      fecha: input.fecha,
      nombre,
      telefono: tel,
      pax,
      hora_preferida: input.horaPreferida || null,
      zona_id: input.zonaId || null,
      notas: input.notas?.trim().slice(0, 1000) || null,
      email: input.email?.trim().toLowerCase() || null,
      turno_id: turnoId,
      cliente_id: cli?.id ?? null,
      idioma: cli?.idioma ?? "es",
    })
    .select(CAMPOS_ENTRADA)
    .single();
  return error ? { ok: false, error: error.message } : { ok: true, data };
}

/** Avisa al cliente de que hay mesa a la hora dada (RPC: encola email/SMS/WhatsApp según los
    canales activos del restaurante; el cron envía). Devuelve cuántos mensajes se han encolado y
    el enlace de reserva para mandarlo a mano si no hay canal configurado. */
export async function avisar(id: string, hora: string): Promise<R<{ encolados: number; enlace: string }>> {
  const { sb, perfil } = await cliente();
  const rid = await restDeEntrada(sb, id);
  if (!rid) return { ok: false, error: "La entrada ya no existe." };
  const sinPermiso = await exigirPermisoSala(sb, perfil, null, rid);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { data, error } = await sb.rpc("reservas_lista_espera_avisar", { p_id: id, p_hora: hora });
  if (error) return { ok: false, error: error.message };
  const j = (data ?? {}) as { ok?: boolean; error?: string; estado?: string; encolados?: number; enlace?: string };
  if (j.error === "NO_ENCONTRADA") return { ok: false, error: "La entrada ya no existe." };
  if (j.error === "ESTADO_INVALIDO") return { ok: false, error: `La entrada ya está «${j.estado}».` };
  if (j.error) return { ok: false, error: j.error };
  return { ok: true, data: { encolados: j.encolados ?? 0, enlace: j.enlace ?? "" } };
}

/** Sienta a una entrada de la lista: crea una reserva walk-in y marca la entrada como convertida.
    - estado "sentada" (por defecto): solo en el día de hoy; sella llegada, sentada y pax llegados
      (el trigger de sellos es BEFORE UPDATE y en un INSERT no actúa).
    - estado "confirmada": la convierte en reserva para más tarde (otro día, o hoy cuando se libere
      la mesa). Origen «walkin» si es hoy y «telefono» si es otro día.
    Para que dos tablets no la sienten a la vez, primero se reclama la entrada con un update
    condicional; si algo falla después, se devuelve a su estado. */
export async function sentar(input: {
  id: string;
  mesaId: string;
  hora: string; // "HH:MM"
  duracionMin: number;
  turnoId: string | null;
  estado?: "sentada" | "confirmada";
}): Promise<R<{ reservaId: string }>> {
  const { sb, perfil } = await cliente();
  const estado = input.estado === "confirmada" ? "confirmada" : "sentada";
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(input.hora || "")) return { ok: false, error: "Hora no válida." };

  const { data: e, error: e1 } = await sb
    .from("reservas_lista_espera")
    .select("id, restaurante_id, fecha, nombre, telefono, email, pax, notas, idioma, cliente_id, estado")
    .eq("id", input.id)
    .maybeSingle();
  if (e1) return { ok: false, error: e1.message };
  if (!e) return { ok: false, error: "La entrada ya no existe." };
  const sinPermiso = await exigirPermisoSala(sb, perfil, "puede_cambiar_estado", e.restaurante_id);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  if (!["esperando", "avisado"].includes(e.estado)) return { ok: false, error: `La entrada ya está «${e.estado}».` };

  const hoy = await hoyDelRestaurante(sb, e.restaurante_id);
  if (estado === "sentada" && e.fecha !== hoy) return { ok: false, error: "Solo se puede sentar en el día de hoy: conviértela en reserva." };

  // La mesa (y el turno) tienen que ser del mismo restaurante que la entrada.
  const { data: mesa, error: eMesa } = await sb
    .from("reservas_mesas")
    .select("id, sala_id, nombre, reservas_salas!inner(restaurante_id)")
    .eq("id", input.mesaId)
    .maybeSingle();
  if (eMesa) return { ok: false, error: eMesa.message };
  if (!mesa) return { ok: false, error: "La mesa no existe." };
  const salaMesa = mesa.reservas_salas as unknown as { restaurante_id: string } | { restaurante_id: string }[] | null;
  const restMesa = Array.isArray(salaMesa) ? salaMesa[0]?.restaurante_id : salaMesa?.restaurante_id;
  if (restMesa !== e.restaurante_id) return { ok: false, error: "La mesa no es de este restaurante." };
  let turnoId: string | null = null;
  if (input.turnoId) {
    const { data: t } = await sb.from("reservas_turnos").select("id").eq("id", input.turnoId).eq("restaurante_id", e.restaurante_id).maybeSingle();
    if (!t) return { ok: false, error: "El turno no es de este restaurante." };
    turnoId = t.id;
  }

  // Comprobación de última hora: la mesa sigue libre a esa hora (otra tablet puede haberla ocupado).
  const dur = Math.max(30, Math.min(600, Math.round(input.duracionMin || 120)));
  const { data: ocupada, error: eOcup } = await sb.rpc("reservas_mesa_ocupada", { p_mesa: mesa.id, p_fecha: e.fecha, p_hora: input.hora, p_duracion: dur });
  if (eOcup) return { ok: false, error: `No se ha podido comprobar la mesa: ${eOcup.message}` };
  if (ocupada) return { ok: false, error: `La mesa ${mesa.nombre} ya está ocupada a esa hora.` };

  // Reclamar la entrada: solo una tablet gana.
  const { data: reclamada, error: eRecl } = await sb
    .from("reservas_lista_espera")
    .update({ estado: "convertida" })
    .eq("id", e.id)
    .in("estado", ["esperando", "avisado"])
    .select("id");
  if (eRecl) return { ok: false, error: eRecl.message };
  if (!reclamada?.length) return { ok: false, error: "Esta entrada ya la ha sentado o descartado otra persona." };
  const devolver = async () => {
    await sb.from("reservas_lista_espera").update({ estado: e.estado }).eq("id", e.id).eq("estado", "convertida").is("reserva_id", null);
  };

  // Cliente: el enlazado, el que tenga ese teléfono, o uno nuevo.
  let clienteId = e.cliente_id;
  if (!clienteId) {
    const tel = normTel(e.telefono);
    if (tel) {
      const { data: cli } = await sb.from("reservas_clientes").select("id").or(`telefono_norm.eq.${tel},telefono.eq.${tel}`).limit(1).maybeSingle();
      clienteId = cli?.id ?? null;
    }
    if (!clienteId) {
      const { data: nuevo, error: e2 } = await sb.from("reservas_clientes").insert({ nombre: e.nombre, telefono: tel, email: e.email }).select("id").single();
      if (e2) { await devolver(); return { ok: false, error: e2.message }; }
      clienteId = nuevo.id;
    }
  }

  const ahoraIso = new Date().toISOString();
  const sellos = estado === "sentada" ? { llegada_en: ahoraIso, sentada_en: ahoraIso, pax_llegados: e.pax } : {};
  const { data: r, error: e3 } = await sb
    .from("reservas_reservas")
    .insert({
      restaurante_id: e.restaurante_id,
      cliente_id: clienteId,
      mesa_id: mesa.id,
      zona_id: mesa.sala_id,
      turno_id: turnoId,
      fecha: e.fecha,
      hora: input.hora,
      duracion_min: dur,
      pax: e.pax,
      estado,
      origen: estado === "sentada" || e.fecha === hoy ? "walkin" : "telefono",
      notas_internas: e.notas ? `Lista de espera: ${e.notas}` : "Desde lista de espera",
      idioma: e.idioma,
      creado_por: perfil.id,
      ...sellos,
    })
    .select("id")
    .single();
  if (e3) { await devolver(); return { ok: false, error: e3.message }; }

  // La reserva ya existe y la entrada ya está convertida: si solo falla este enlace no se deshace
  // nada (reintentar duplicaría la reserva); la entrada queda convertida sin «Ver reserva».
  await sb.from("reservas_lista_espera").update({ reserva_id: r.id, cliente_id: clienteId }).eq("id", e.id);
  return { ok: true, data: { reservaId: r.id } };
}

export async function descartar(id: string): Promise<R> {
  const { sb, perfil } = await cliente();
  const rid = await restDeEntrada(sb, id);
  if (!rid) return { ok: false, error: "La entrada ya no existe." };
  const sinPermiso = await exigirPermisoSala(sb, perfil, "puede_cambiar_estado", rid);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { error } = await sb.from("reservas_lista_espera").update({ estado: "descartada" }).eq("id", id).in("estado", ["esperando", "avisado"]);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Deshace un descarte (se ha pulsado sin querer). */
export async function reactivar(id: string): Promise<R> {
  const { sb, perfil } = await cliente();
  const rid = await restDeEntrada(sb, id);
  if (!rid) return { ok: false, error: "La entrada ya no existe." };
  const sinPermiso = await exigirPermisoSala(sb, perfil, null, rid);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const { error } = await sb.from("reservas_lista_espera").update({ estado: "esperando" }).eq("id", id).eq("estado", "descartada");
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Edita los datos de una entrada (pax, hora preferida, zona, notas). */
export async function editar(id: string, campos: { pax?: number; horaPreferida?: string | null; zonaId?: string | null; notas?: string | null }): Promise<R> {
  const { sb, perfil } = await cliente();
  const rid = await restDeEntrada(sb, id);
  if (!rid) return { ok: false, error: "La entrada ya no existe." };
  const sinPermiso = await exigirPermisoSala(sb, perfil, null, rid);
  if (sinPermiso) return { ok: false, error: sinPermiso };
  const fila: Partial<Tables<"reservas_lista_espera">> = {};
  if (campos.pax != null) fila.pax = Math.max(1, Math.min(99, Math.round(campos.pax)));
  if (campos.horaPreferida !== undefined) fila.hora_preferida = campos.horaPreferida || null;
  if (campos.zonaId !== undefined) fila.zona_id = campos.zonaId || null;
  if (campos.notas !== undefined) fila.notas = campos.notas?.trim().slice(0, 1000) || null;
  if (!Object.keys(fila).length) return { ok: true };
  // Solo las abiertas: una ya sentada o descartada no se toca.
  const { error } = await sb.from("reservas_lista_espera").update(fila).eq("id", id).in("estado", ["esperando", "avisado"]);
  return error ? { ok: false, error: error.message } : { ok: true };
}
