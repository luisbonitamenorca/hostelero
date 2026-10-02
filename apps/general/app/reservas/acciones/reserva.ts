"use server";

/* Acciones de servidor del modal de reserva (nueva / editar).
   Todo pasa por el cliente autenticado del esqueleto bajo RLS (cuenta_id = cuenta_actual()).
   Nada de service key aquí: lo público va por los route handlers. */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables } from "@hostelero/db";
import type { Cliente, Reserva, Turno } from "../tipos";

/** El paquete db no reexporta Json: lo derivamos de una columna jsonb. */
type Json = Tables<"reservas_reservas">["adjuntos"];
import { dowDe, h5, minutos, solapan } from "../tipos";

/** Estados que ocupan mesa: espejo de reservas_estados_activos() (y de ESTADOS_VIVOS en lib-reservas,
    que no se importa aquí porque ese módulo es "use client"). */
const ESTADOS_VIVOS = ["pendiente", "confirmada", "reconfirmada", "llegada", "sentada", "postre", "cuenta", "a_revisar", "tarjeta_pendiente"];

async function cliente() {
  const { supabase, perfil } = await exigirModulo("reservas");
  return { sb: supabase, perfil };
}
type Sb = Awaited<ReturnType<typeof cliente>>["sb"];
type Perfil = Awaited<ReturnType<typeof cliente>>["perfil"];

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);

/** Escapa los comodines de LIKE (% _ \) para comparar un texto del usuario «tal cual». */
const sinComodines = (s: string) => s.replace(/[%_\\]/g, "\\$&");

/** RPC que aún no está en los tipos generados (migración 20261002090000): llamada sin tipar.
    Si la migración no se ha aplicado, devuelve error y quien llama usa su plan B. */
type RpcLibre = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
function rpcLibre(sb: Sb, fn: string, args?: Record<string, unknown>) {
  return (sb.rpc as unknown as RpcLibre).call(sb, fn, args);
}

/* ---- Permisos de sala (reservas_permisos_perfil). Mismo criterio que acciones/dia.ts:
        dirección pasa siempre; sin fila, todo permitido; con fila, se aplican sus flags. */
type PermisosSala = { puede_cambiar_estado: boolean; restaurantes: string[] | null } | null;

async function permisosSala(sb: Sb, perfil: Perfil): Promise<PermisosSala> {
  if (perfil.rol === "direccion") return null;
  const { data } = await sb.from("reservas_permisos_perfil").select("puede_cambiar_estado, restaurantes").eq("perfil_id", perfil.id).maybeSingle();
  return data ?? null;
}
const restauranteVetado = (p: PermisosSala, restauranteId: string) => !!p?.restaurantes && !p.restaurantes.includes(restauranteId);

/* ---- Usuarios que pueden figurar como «Anotado por»: los de la cuenta con el módulo de
        reservas (RPC definer, porque la RLS de perfiles solo deja leerlos a dirección). */
type Usuario = { id: string; nombre: string };

async function usuariosAnotadores(sb: Sb, perfil: Perfil): Promise<Usuario[]> {
  const yo: Usuario = { id: perfil.id, nombre: perfil.nombre || perfil.correo };
  const { data, error } = await rpcLibre(sb, "reservas_usuarios_anotadores");
  if (error || !Array.isArray(data)) return [yo];
  const lista = (data as { id: string; nombre: string | null }[])
    .filter((u) => esUuid(u.id))
    .map((u) => ({ id: u.id, nombre: u.nombre || "—" }));
  if (!lista.some((u) => u.id === yo.id)) lista.push(yo);
  return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** Teléfono normalizado como reservas_norm_tel: solo dígitos y, si quitando 34/0034 quedan 9,
    sin el prefijo español (así están guardados los clientes heredados). */
function normTel(t: string | null | undefined): string {
  const n = (t || "").replace(/\D/g, "");
  const sin = n.replace(/^(0034|34)/, "");
  return sin !== n && sin.length === 9 ? sin : n;
}

export type Etiqueta = Tables<"reservas_etiquetas">;
export type Prescriptor = Tables<"reservas_prescriptores">;
export type Experiencia = Tables<"reservas_experiencias">;
export type Mensaje = Tables<"reservas_mensajes">;
export type StatsCliente = Tables<"reservas_clientes_stats">;
export type Adjunto = { nombre: string; ruta: string; tamano: number; tipo: string | null; subido_en: string };

/* ================= Catálogos del modal ================= */

/** Todo lo que el modal necesita de catálogo, en una ida: etiquetas (los tres ámbitos),
    prescriptores, experiencias del restaurante y quién está anotando. */
export async function catalogosModal(restauranteId: string, reservaId?: string | null) {
  const { sb, perfil } = await cliente();
  const [eti, pres, exp, usuarios] = await Promise.all([
    sb.from("reservas_etiquetas").select("*").eq("activa", true).order("ambito").order("orden").order("nombre"),
    sb.from("reservas_prescriptores").select("*").eq("activo", true).order("nombre"),
    sb.from("reservas_experiencias").select("*").eq("restaurante_id", restauranteId).eq("activa", true).order("orden").order("nombre"),
    usuariosAnotadores(sb, perfil),
  ]);
  // Quién anotó la reserva: id (para el selector) y nombre (por si ya no está en la lista).
  let anotadoPor: string | null = null;
  let anotadoPorId: string | null = null;
  if (reservaId) {
    const { data: r } = await sb.from("reservas_reservas").select("anotado_por, cover_meta").eq("id", reservaId).maybeSingle();
    if (r?.anotado_por) {
      anotadoPorId = r.anotado_por;
      const u = usuarios.find((x) => x.id === r.anotado_por);
      if (u) anotadoPor = u.nombre;
      else {
        const { data: p } = await sb.from("perfiles").select("nombre, correo").eq("id", r.anotado_por).maybeSingle();
        anotadoPor = p ? p.nombre || p.correo : null;
      }
    } else if (r?.cover_meta && typeof r.cover_meta === "object" && !Array.isArray(r.cover_meta)) {
      // Reservas importadas de Cover: el usuario que la anotó viene en el tracking.
      const v = (r.cover_meta as Record<string, unknown>).anotado_por;
      if (typeof v === "string" && v.trim()) anotadoPor = v.trim();
    }
  }
  return {
    etiquetas: (eti.data ?? []) as Etiqueta[],
    prescriptores: (pres.data ?? []) as Prescriptor[],
    experiencias: (exp.data ?? []) as Experiencia[],
    usuario: { id: perfil.id, nombre: perfil.nombre || perfil.correo },
    /** Usuarios con el módulo de reservas (selector «Anotado por»). */
    usuarios,
    anotadoPor,
    anotadoPorId,
  };
}

export async function crearPrescriptorRapido(nombre: string, tipo = "hotel"): Promise<R<Prescriptor>> {
  const { sb } = await cliente();
  const n = nombre.trim();
  if (!n) return { ok: false, error: "El prescriptor necesita un nombre" };
  const { data, error } = await sb.from("reservas_prescriptores").insert({ nombre: n, tipo }).select("*").single();
  if (error) {
    if (error.code === "23505") {
      // Ya existe (índice único por nombre): lo devolvemos en vez de fallar.
      const { data: ex } = await sb.from("reservas_prescriptores").select("*").ilike("nombre", sinComodines(n)).limit(1).maybeSingle();
      if (ex) return { ok: true, data: ex as Prescriptor };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, data: data as Prescriptor };
}

/* ================= Ocupación por franja y por mesa ================= */

export type Franja = { hora: string; pax: number; reservas: number };
export type TurnoOcupacion = {
  turnoId: string;
  nombre: string;
  aforo: number | null;
  cerrado: boolean;
  paxTurno: number;
  maxReservasIntervalo: number | null;
  franjas: Franja[];
};

/** Ocupación «(6 / 216)» de cada franja de cada turno del día: pax reservados en esa hora y
    aforo del turno (cupo del día si lo hay). `cerrado` = cupo cerrado o cierre del turno/día. */
export async function ocupacionFranjas(restauranteId: string, fecha: string, excluirId?: string | null): Promise<TurnoOcupacion[]> {
  const { sb } = await cliente();
  const [turnos, res, cupos, cierres] = await Promise.all([
    sb.from("reservas_turnos").select("*").eq("restaurante_id", restauranteId).eq("activo", true).order("hora_inicio"),
    sb.from("reservas_reservas").select("id, hora, pax, estado, turno_id").eq("restaurante_id", restauranteId).eq("fecha", fecha).in("estado", ESTADOS_VIVOS),
    sb.from("reservas_cupos").select("*").eq("restaurante_id", restauranteId).eq("fecha", fecha),
    sb.from("reservas_cierres").select("turno_id").eq("restaurante_id", restauranteId).eq("fecha", fecha),
  ]);
  const dow = dowDe(fecha);
  const vivas = (res.data ?? []).filter((r) => r.id !== excluirId);
  const cupoDia = (cupos.data ?? []).find((c) => c.turno_id === null) ?? null;
  const cierreDia = (cierres.data ?? []).some((c) => c.turno_id === null);

  return ((turnos.data ?? []) as Turno[])
    .filter((t) => (t.dias_semana || []).includes(dow))
    .map((t) => {
      const cupo = (cupos.data ?? []).find((c) => c.turno_id === t.id) ?? cupoDia;
      const aforo = cupo?.max_pax_total ?? t.max_pax_total ?? null;
      const cerrado = cierreDia || !!cupo?.cerrado || (cierres.data ?? []).some((c) => c.turno_id === t.id);
      const ini = minutos(h5(t.hora_inicio));
      const fin = minutos(h5(t.hora_fin));
      const paso = Math.max(5, t.intervalo_min || 15);
      const franjas: Franja[] = [];
      for (let m = ini; m <= fin; m += paso) {
        const hora = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        const enFranja = vivas.filter((r) => h5(r.hora) === hora);
        franjas.push({ hora, pax: enFranja.reduce((a, r) => a + r.pax, 0), reservas: enFranja.length });
      }
      const delTurno = vivas.filter((r) => (r.turno_id ? r.turno_id === t.id : h5(r.hora) >= h5(t.hora_inicio) && h5(r.hora) <= h5(t.hora_fin)));
      return {
        turnoId: t.id,
        nombre: t.nombre,
        aforo,
        cerrado,
        paxTurno: delTurno.reduce((a, r) => a + r.pax, 0),
        maxReservasIntervalo: t.max_reservas_intervalo,
        franjas,
      };
    });
}

export type OcupanteMesa = { reservaId: string; hora: string; nombre: string; pax: number; estado: string };

/** Qué mesas están ocupadas (o bloqueadas) en una franja. Devuelve por mesa la reserva que
    solapa; el modal lo usa para avisar y para listar las libres. */
export async function ocupacionMesas(input: {
  restauranteId: string;
  fecha: string;
  hora: string; // "HH:MM"
  duracion: number;
  excluirId?: string | null;
}): Promise<{ ocupadas: Record<string, OcupanteMesa>; bloqueadas: string[]; salasBloqueadas: string[] }> {
  const { sb } = await cliente();
  const [res, blo] = await Promise.all([
    sb
      .from("reservas_reservas")
      .select("id, hora, pax, estado, duracion_min, mesa_id, reservas_clientes(nombre, apellidos), reservas_reserva_mesas(mesa_id)")
      .eq("restaurante_id", input.restauranteId)
      .eq("fecha", input.fecha)
      .in("estado", ESTADOS_VIVOS),
    sb.from("reservas_bloqueos").select("*").eq("restaurante_id", input.restauranteId).eq("fecha", input.fecha),
  ]);
  const ocupadas: Record<string, OcupanteMesa> = {};
  for (const r of res.data ?? []) {
    if (r.id === input.excluirId) continue;
    if (!solapan(r.hora, r.duracion_min || 120, input.hora + ":00", input.duracion)) continue;
    const c = r.reservas_clientes as { nombre: string | null; apellidos: string | null } | null;
    const nombre = [c?.nombre, c?.apellidos].filter(Boolean).join(" ") || "Sin nombre";
    const ids = new Set<string>((r.reservas_reserva_mesas ?? []).map((x) => x.mesa_id));
    if (r.mesa_id) ids.add(r.mesa_id);
    for (const id of ids) ocupadas[id] = { reservaId: r.id, hora: h5(r.hora), nombre, pax: r.pax, estado: r.estado };
  }
  const bloqueadas: string[] = [];
  const salasBloqueadas: string[] = [];
  for (const b of blo.data ?? []) {
    if (!solapan(b.hora_inicio, minutos(h5(b.hora_fin)) - minutos(h5(b.hora_inicio)), input.hora + ":00", input.duracion)) continue;
    if (b.mesa_id) bloqueadas.push(b.mesa_id);
    else if (b.sala_id) salasBloqueadas.push(b.sala_id);
    else salasBloqueadas.push("*");
  }
  return { ocupadas, bloqueadas, salasBloqueadas };
}

/** Duración sugerida por pax (reservas_restaurantes.duracion_por_pax vía RPC). */
export async function duracionPorPax(restauranteId: string, pax: number, defecto = 120): Promise<number> {
  const { sb } = await cliente();
  const { data } = await sb.rpc("reservas_duracion_pax", { p_restaurante: restauranteId, p_pax: pax, p_defecto: defecto });
  return typeof data === "number" && data > 0 ? data : defecto;
}

/** Mejor mesa (o combinación) para la franja: RPC reservas_mejor_mesa_v2. null = no cabe. */
export async function mejorMesa(input: {
  restauranteId: string;
  fecha: string;
  hora: string;
  duracion: number;
  pax: number;
  zonaId?: string | null;
  excluirId?: string | null;
}): Promise<string[] | null> {
  const { sb } = await cliente();
  const { data } = await sb.rpc("reservas_mejor_mesa_v2", {
    p_restaurante: input.restauranteId,
    p_fecha: input.fecha,
    p_hora: input.hora + ":00",
    p_duracion: input.duracion,
    p_pax: input.pax,
    p_solo_online: false,
    p_zona: input.zonaId ?? undefined,
    p_permitir_union: true,
    p_excluir: input.excluirId ?? undefined,
  });
  return Array.isArray(data) && data.length ? (data as string[]) : null;
}

/* ================= Clientes ================= */

/** Autocompletar del modal: nombre/apellidos, teléfono o email, con sus estadísticas. */
export async function buscarClientesModal(q: string): Promise<{ clientes: Cliente[]; stats: Record<string, StatsCliente> }> {
  const { sb } = await cliente();
  // Comas y paréntesis romperían la sintaxis de filtros de PostgREST; % _ * \ son comodines.
  const t = q.trim().replace(/[,()%_*\\]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length < 2) return { clientes: [], stats: {} };
  // Sin acentos: cada vocal (con o sin tilde) y la ñ valen por «cualquier letra» (_), así
  // «Garcia» encuentra «García» y al revés sin depender de la extensión unaccent.
  const flex = (s: string) => s.replace(/[aeiouáéíóúàèìòùâêîôûäëïöüñ]/gi, "_");
  const digitos = t.replace(/\D/g, "");
  const partes = [`nombre.ilike.%${flex(t)}%`, `apellidos.ilike.%${flex(t)}%`, `email.ilike.%${t}%`];
  if (digitos.length >= 3) {
    partes.push(`telefono_norm.ilike.%${digitos}%`, `telefono.ilike.%${digitos}%`);
    // «+34 612 345 678» → 612345678: los clientes heredados están guardados sin prefijo.
    const norm = normTel(digitos);
    if (norm !== digitos) partes.push(`telefono_norm.ilike.%${norm}%`);
  }
  // Nombre y apellido juntos («stuart kean»): buscamos cada palabra en nombre+apellidos.
  const palabras = t.split(/\s+/).filter((p) => p.length >= 2);
  // Los más recientes primero (la ficha se actualiza en cada reserva): salen los habituales.
  let query = sb.from("reservas_clientes").select("*").order("actualizado_en", { ascending: false }).limit(8);
  if (palabras.length >= 2 && !/^[\d\s+()-]+$/.test(t) && !t.includes("@")) {
    query = query.ilike("nombre", `%${flex(palabras[0])}%`).ilike("apellidos", `%${flex(palabras[palabras.length - 1])}%`);
  } else {
    query = query.or(partes.join(","));
  }
  const { data } = await query;
  let clientes = (data ?? []) as Cliente[];
  if (!clientes.length && palabras.length >= 2) {
    // Sin resultado por nombre+apellido: probamos la búsqueda suelta.
    const { data: d2 } = await sb.from("reservas_clientes").select("*").or(partes.join(",")).order("actualizado_en", { ascending: false }).limit(8);
    clientes = (d2 ?? []) as Cliente[];
  }
  const stats: Record<string, StatsCliente> = {};
  if (clientes.length) {
    const { data: st } = await sb.from("reservas_clientes_stats").select("*").in("cliente_id", clientes.map((c) => c.id));
    for (const s of st ?? []) if (s.cliente_id) stats[s.cliente_id] = s as StatsCliente;
  }
  return { clientes, stats };
}

export async function statsCliente(clienteId: string): Promise<StatsCliente | null> {
  const { sb } = await cliente();
  const { data } = await sb.from("reservas_clientes_stats").select("*").eq("cliente_id", clienteId).maybeSingle();
  return (data as StatsCliente) ?? null;
}

/* ================= Mensajes ================= */

/** Tracking de notificaciones de una reserva (lo que ha salido y lo que está en cola). */
export async function trackingMensajes(reservaId: string): Promise<Mensaje[]> {
  const { sb } = await cliente();
  const { data } = await sb.from("reservas_mensajes").select("*").eq("reserva_id", reservaId).order("creado_en", { ascending: false }).limit(50);
  return (data ?? []) as Mensaje[];
}

/** Mensaje escrito a mano desde la tarjeta del cliente: se encola en reservas_mensajes
    (tipo 'manual') y el cron lo manda por el canal que toque. El destinatario sale SIEMPRE de
    la ficha guardada del cliente (`destinatario` se ignora: se conserva por compatibilidad). */
export async function enviarMensajeManual(input: {
  restauranteId: string;
  clienteId: string;
  reservaId?: string | null;
  canal: "email" | "sms" | "whatsapp";
  destinatario?: string;
  asunto?: string | null;
  cuerpo: string;
}): Promise<R<{ id: string }>> {
  const { sb, perfil } = await cliente();
  const cuerpo = (input.cuerpo || "").trim();
  if (!cuerpo) return { ok: false, error: "Escribe el mensaje" };
  if (!["email", "sms", "whatsapp"].includes(input.canal)) return { ok: false, error: "Canal no válido" };
  if (!esUuid(input.restauranteId) || !esUuid(input.clienteId)) return { ok: false, error: "Datos no válidos" };
  if (input.reservaId && !esUuid(input.reservaId)) return { ok: false, error: "Reserva no válida" };
  if (restauranteVetado(await permisosSala(sb, perfil), input.restauranteId)) return { ok: false, error: "No tienes permiso sobre este restaurante." };

  const [{ data: c }, { data: rest }, { data: rsv }] = await Promise.all([
    sb.from("reservas_clientes").select("id, email, email_norm, telefono, telefono_norm").eq("id", input.clienteId).maybeSingle(),
    sb.from("reservas_restaurantes").select("id, envio_email, envio_sms, envio_whatsapp").eq("id", input.restauranteId).maybeSingle(),
    input.reservaId
      ? sb.from("reservas_reservas").select("cliente_id, restaurante_id").eq("id", input.reservaId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!c) return { ok: false, error: "Cliente no encontrado" };
  if (!rest) return { ok: false, error: "Restaurante no encontrado" };
  if (input.reservaId && (!rsv || rsv.cliente_id !== c.id || rsv.restaurante_id !== rest.id)) {
    return { ok: false, error: "La reserva no es de este cliente" };
  }
  if (input.canal === "email" && !rest.envio_email) return { ok: false, error: "El restaurante no tiene el email activo" };
  if (input.canal === "sms" && !rest.envio_sms) return { ok: false, error: "El restaurante no tiene SMS activo" };
  if (input.canal === "whatsapp" && !rest.envio_whatsapp) return { ok: false, error: "El restaurante no tiene WhatsApp activo" };

  // Mismo formato que reservas_mensaje_encolar: email normalizado / telefono_norm.
  const dest =
    input.canal === "email"
      ? (c.email_norm || c.email || "").trim().toLowerCase()
      : (c.telefono_norm || normTel(c.telefono)).replace(/\D/g, "");
  if (!dest) return { ok: false, error: input.canal === "email" ? "El cliente no tiene email" : "El cliente no tiene teléfono" };
  if (input.canal === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) return { ok: false, error: "El email no parece válido" };
  const { data, error } = await sb
    .from("reservas_mensajes")
    .insert({
      restaurante_id: rest.id,
      reserva_id: input.reservaId ?? null,
      cliente_id: c.id,
      canal: input.canal,
      tipo: "manual",
      destinatario: dest,
      asunto: input.canal === "email" ? (input.asunto?.trim() || "Mensaje del restaurante") : null,
      cuerpo,
      estado: "pendiente",
      creado_por: perfil.id,
    })
    .select("id")
    .single();
  return error ? { ok: false, error: error.message } : { ok: true, data: { id: data.id } };
}

/* ================= Guardar ================= */

export type DatosCliente = {
  id?: string | null;
  nombre: string;
  apellidos?: string | null;
  idioma?: string;
  prefijo?: string; // "34"
  telefono?: string | null; // sin prefijo
  email?: string | null;
  etiquetas?: string[];
  alergenos?: string[];
  alergias?: string | null;
  notas?: string | null;
  consentimiento_marketing?: boolean;
  fecha_nacimiento?: string | null;
  empresa?: string | null;
  numero_socio?: string | null;
  vip?: boolean;
};

export type DatosReserva = {
  id?: string | null;
  restauranteId: string;
  fecha: string;
  hora: string; // "HH:MM"
  pax: number;
  duracion: number;
  turnoId?: string | null;
  zonaId?: string | null;
  mesas: string[];
  estado: string;
  tipo: string;
  importe?: number | null; // garantía o prepago (total)
  experienciaId?: string | null;
  prescriptorId?: string | null;
  etiquetas: string[];
  notasInternas?: string | null;
  notasCliente?: string | null;
  referencia?: string | null;
  codigoPromo?: string | null;
  idioma?: string;
  cliente: DatosCliente;
  /** Canales marcados en el pie. `notificar` = «Guardar y notificar». */
  notificar: boolean;
  canales?: { email: boolean; sms: boolean; whatsapp: boolean };
  /** El usuario ya ha visto el aviso y quiere guardar igualmente. */
  confirmarSolape?: boolean;
  confirmarCupo?: boolean;
  /** Perfil que figura como «Anotado por» (por defecto, quien guarda). */
  anotadoPor?: string | null;
};

/** `advertencia`: la reserva SÍ se ha guardado, pero algo accesorio falló (mesas, avisos). */
export type ResultadoGuardar =
  | { ok: true; id: string; fecha: string; clienteId: string | null; advertencia?: string }
  | { ok: false; error: string; aviso?: "solape" | "cupo" };

/** Teléfono tal como lo guarda la base: solo dígitos con prefijo (34612345678). */
function telefonoCompleto(prefijo: string | undefined, telefono: string | null | undefined): string | null {
  const bruto = (telefono || "").trim();
  // Formato internacional explícito (+44 …, 0044 …): manda el número, no el selector.
  if (/^(\+|00)/.test(bruto)) {
    const n = bruto.replace(/^00/, "").replace(/\D/g, "");
    return n || null;
  }
  let n = bruto.replace(/\D/g, "");
  if (!n) return null;
  const p = (prefijo || "34").replace(/\D/g, "") || "34";
  // Si ya viene con el prefijo delante (pegado del portapapeles), no lo duplicamos.
  if (n.length > 9 && n.startsWith(p)) return n;
  // Prefijo troncal: fuera de España el 0 inicial no se marca con el prefijo (07911… → 447911…).
  if (p !== "34" && n.startsWith("0")) n = n.slice(1);
  return n ? p + n : null;
}

/** Crea o actualiza la ficha del cliente. Al crear, si el teléfono ya existe se reutiliza esa ficha. */
async function guardarCliente(sb: Sb, d: DatosCliente): Promise<R<string>> {
  const nombre = d.nombre.trim();
  if (!nombre) return { ok: false, error: "El cliente necesita un nombre" };
  if (d.id && !esUuid(d.id)) return { ok: false, error: "Cliente no válido" };
  const telefono = telefonoCompleto(d.prefijo, d.telefono);
  const email = d.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "El email no parece válido" };
  const ficha = {
    nombre,
    apellidos: d.apellidos?.trim() || null,
    idioma: d.idioma || "es",
    telefono,
    email,
    etiquetas: d.etiquetas ?? [],
    alergenos: d.alergenos ?? [],
    alergias: d.alergias?.trim() || null,
    notas: d.notas?.trim() || null,
    consentimiento_marketing: !!d.consentimiento_marketing,
    fecha_nacimiento: d.fecha_nacimiento || null,
    empresa: d.empresa?.trim() || null,
    numero_socio: d.numero_socio?.trim() || null,
    ...(d.vip !== undefined ? { vip: d.vip } : {}),
  };
  if (d.id) {
    // Mismo teléfono (normalizado) que la ficha: no se reescribe la columna, así los heredados
    // («612345678») no pasan a «34612345678» en cada edición.
    const { data: prev } = await sb.from("reservas_clientes").select("telefono").eq("id", d.id).maybeSingle();
    const { telefono: tel, ...resto } = ficha;
    const cambio = !prev || normTel(prev.telefono) !== normTel(tel);
    const { error } = await sb.from("reservas_clientes").update(cambio ? ficha : resto).eq("id", d.id);
    return error ? { ok: false, error: error.message } : { ok: true, data: d.id };
  }
  if (telefono) {
    const { data: norm } = await sb.rpc("reservas_norm_tel", { t: telefono });
    const { data: ex } = await sb.from("reservas_clientes").select("id").eq("telefono_norm", norm || telefono).limit(1).maybeSingle();
    if (ex) {
      // Mismo teléfono: es la misma persona; completamos lo que falte sin pisar lo que ya hay.
      const { data: actual } = await sb.from("reservas_clientes").select("*").eq("id", ex.id).single();
      if (actual) {
        await sb
          .from("reservas_clientes")
          .update({
            apellidos: actual.apellidos || ficha.apellidos,
            email: actual.email || ficha.email,
            alergias: actual.alergias || ficha.alergias,
            notas: actual.notas || ficha.notas,
            empresa: actual.empresa || ficha.empresa,
            numero_socio: actual.numero_socio || ficha.numero_socio,
            fecha_nacimiento: actual.fecha_nacimiento || ficha.fecha_nacimiento,
            etiquetas: [...new Set([...(actual.etiquetas ?? []), ...ficha.etiquetas])],
            alergenos: [...new Set([...(actual.alergenos ?? []), ...ficha.alergenos])],
            consentimiento_marketing: actual.consentimiento_marketing || ficha.consentimiento_marketing,
          })
          .eq("id", ex.id);
      }
      return { ok: true, data: ex.id };
    }
  }
  const { data, error } = await sb.from("reservas_clientes").insert(ficha).select("id").single();
  return error ? { ok: false, error: error.message } : { ok: true, data: data.id };
}

/** Valida y guarda la reserva (nueva o existente), su cliente y sus mesas. Devuelve {id, fecha}.
    Avisos (solape de mesa, cupo cerrado/aforo) se devuelven con `aviso` para que el modal pida
    confirmación y repita con confirmarSolape / confirmarCupo. */
export async function guardarReserva(d: DatosReserva): Promise<ResultadoGuardar> {
  return guardarInterno(d, {});
}

/** Tipos de mensaje que se anulan si en el pie se desmarca su canal (lo recién encolado). */
const TIPOS_ANULABLES = ["confirmacion", "confirmada", "modificacion", "cancelacion", "garantia", "pago", "recordatorio", "reconfirmacion"];
/** Estados que el trigger avisa SIEMPRE, aunque notificar = false (decisión de la base). */
const AVISAN_SIEMPRE = ["cancelada", "no_show", "tarjeta_pendiente"];

async function guardarInterno(d: DatosReserva, opc: { tarjeta?: boolean }): Promise<ResultadoGuardar> {
  const { sb, perfil } = await cliente();
  const inicio = Date.now();

  // ---- validaciones básicas
  if (!esUuid(d.restauranteId)) return { ok: false, error: "Restaurante no válido" };
  if (d.id && !esUuid(d.id)) return { ok: false, error: "Reserva no válida" };
  if (!d.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) return { ok: false, error: "Falta el día" };
  if (!d.hora || !/^\d{2}:\d{2}$/.test(d.hora)) return { ok: false, error: "Falta la hora" };
  const pax = Math.floor(Number(d.pax));
  if (!(pax > 0)) return { ok: false, error: "Las personas tienen que ser al menos 1" };
  const duracion = Math.max(15, Math.floor(Number(d.duracion) || 120));
  const promo = d.codigoPromo?.trim().toUpperCase() || "";
  if (promo && !/^[A-Z0-9_-]{1,40}$/.test(promo)) return { ok: false, error: "El código promocional solo admite letras, números y guiones" };

  // ---- permisos de sala y fila actual (en edición)
  const permisos = await permisosSala(sb, perfil);
  if (restauranteVetado(permisos, d.restauranteId)) return { ok: false, error: "No tienes permiso sobre este restaurante." };
  let actual: {
    restaurante_id: string;
    fecha: string;
    hora: string;
    pax: number;
    duracion_min: number | null;
    estado: string;
    turno_id: string | null;
    notificar: boolean;
    empresa: string | null;
    alergias: string | null;
    anotado_por: string | null;
    mesa_id: string | null;
    reservas_reserva_mesas: { mesa_id: string }[];
  } | null = null;
  if (d.id) {
    const { data, error } = await sb
      .from("reservas_reservas")
      .select("restaurante_id, fecha, hora, pax, duracion_min, estado, turno_id, notificar, empresa, alergias, anotado_por, mesa_id, reservas_reserva_mesas(mesa_id)")
      .eq("id", d.id)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Reserva no encontrada" };
    actual = data;
    if (restauranteVetado(permisos, data.restaurante_id)) return { ok: false, error: "No tienes permiso sobre este restaurante." };
    if (permisos && !permisos.puede_cambiar_estado && d.estado !== data.estado) {
      return { ok: false, error: "No tienes permiso para cambiar el estado de las reservas." };
    }
  }

  // ---- turno: la hora tiene que caer dentro de un turno del día
  const { data: turnosData } = await sb.from("reservas_turnos").select("*").eq("restaurante_id", d.restauranteId).eq("activo", true);
  const turnos = (turnosData ?? []) as Turno[];
  const dow = dowDe(d.fecha);
  const delDia = turnos.filter((t) => (t.dias_semana || []).includes(dow));
  let turno = d.turnoId ? delDia.find((t) => t.id === d.turnoId) ?? null : null;
  if (turno && !(d.hora >= h5(turno.hora_inicio) && d.hora <= h5(turno.hora_fin))) turno = null;
  if (!turno) turno = delDia.find((t) => d.hora >= h5(t.hora_inicio) && d.hora <= h5(t.hora_fin)) ?? null;
  if (!turno) {
    if (!delDia.length) return { ok: false, error: "Ese día el restaurante no tiene turnos" };
    const rangos = delDia.map((t) => `${t.nombre} ${h5(t.hora_inicio)}–${h5(t.hora_fin)}`).join(", ");
    return { ok: false, error: `La hora tiene que estar dentro de un turno (${rangos})` };
  }

  // ---- qué cambia respecto a lo guardado (en una reserva nueva, todo)
  const otroRest = !!actual && actual.restaurante_id !== d.restauranteId;
  const cambiaFecha = !actual || otroRest || actual.fecha !== d.fecha;
  const cambiaHora = !actual || h5(actual.hora) !== d.hora;
  const cambiaPax = !actual || actual.pax !== pax;
  const cambiaEstado = !actual || actual.estado !== d.estado;
  const eraViva = !!actual && ESTADOS_VIVOS.includes(actual.estado);
  const estadoVivo = ESTADOS_VIVOS.includes(d.estado);

  // ---- cupo: cerrado o aforo superado → aviso (se puede forzar). En una edición solo si la
  //      reserva pide más cupo: otro día/turno, más personas o vuelve a estar viva. Cambiar una
  //      nota de una reserva de un turno ya cerrado no tiene que avisar.
  const pideCupo = !actual || cambiaFecha || actual.turno_id !== turno.id || pax > actual.pax || !eraViva;
  if (estadoVivo && pideCupo && !d.confirmarCupo) {
    const [{ data: cupos }, { data: cierres }, { data: motivo }] = await Promise.all([
      sb.from("reservas_cupos").select("turno_id, cerrado").eq("restaurante_id", d.restauranteId).eq("fecha", d.fecha),
      sb.from("reservas_cierres").select("turno_id").eq("restaurante_id", d.restauranteId).eq("fecha", d.fecha),
      sb.rpc("reservas_cupo_motivo", {
        p_restaurante: d.restauranteId,
        p_fecha: d.fecha,
        p_turno: turno.id,
        p_pax: pax,
        p_online: false,
        p_hora: d.hora + ":00",
        p_excluir: d.id ?? undefined,
      }),
    ]);
    const cupo = (cupos ?? []).find((c) => c.turno_id === turno!.id) ?? (cupos ?? []).find((c) => c.turno_id === null);
    const cerrado = !!cupo?.cerrado || (cierres ?? []).some((c) => c.turno_id === null || c.turno_id === turno!.id);
    if (cerrado) return { ok: false, aviso: "cupo", error: `El turno ${turno.nombre} está cerrado ese día.` };
    if (motivo === "cupo_total") return { ok: false, aviso: "cupo", error: `Con ${pax} personas se supera el aforo del turno ${turno.nombre}.` };
    if (motivo === "intervalo") return { ok: false, aviso: "cupo", error: `A las ${d.hora} ya hay el máximo de reservas del turno.` };
  }

  // ---- mesas: ids válidos y todas del restaurante
  const mesas = [...new Set((d.mesas ?? []).filter(Boolean))];
  if (mesas.some((m) => !esUuid(m))) return { ok: false, error: "Alguna mesa no es válida. Vuelve a elegirlas." };
  let nombresMesas: { id: string; nombre: string; sala_id: string }[] = [];
  if (mesas.length) {
    const [{ data: ms, error: eM }, { data: ss, error: eS }] = await Promise.all([
      sb.from("reservas_mesas").select("id, nombre, sala_id").in("id", mesas),
      sb.from("reservas_salas").select("id").eq("restaurante_id", d.restauranteId),
    ]);
    if (eM || eS) return { ok: false, error: (eM ?? eS)!.message };
    const salasRest = new Set((ss ?? []).map((s) => s.id));
    nombresMesas = (ms ?? []).filter((m) => salasRest.has(m.sala_id));
    if (nombresMesas.length !== mesas.length) return { ok: false, error: "Alguna de las mesas no es de este restaurante. Vuelve a elegirlas." };
  }

  // ---- solape de mesas → aviso (se puede forzar). En edición, solo si cambia algo que pueda
  //      crear un solape nuevo (franja, mesas añadidas o vuelve a estar viva).
  const mesasPrevias = new Set<string>([...(actual?.reservas_reserva_mesas ?? []).map((x) => x.mesa_id), ...(actual?.mesa_id ? [actual.mesa_id] : [])]);
  const pideMesa =
    !actual || cambiaFecha || cambiaHora || duracion > (actual.duracion_min || 120) || !eraViva || mesas.some((m) => !mesasPrevias.has(m));
  if (estadoVivo && mesas.length && pideMesa && !d.confirmarSolape) {
    const oc = await ocupacionMesas({ restauranteId: d.restauranteId, fecha: d.fecha, hora: d.hora, duracion, excluirId: d.id });
    const conflictos = mesas
      .filter((m) => oc.ocupadas[m] || oc.bloqueadas.includes(m))
      .map((m) => {
        const mesa = nombresMesas.find((x) => x.id === m);
        const o = oc.ocupadas[m];
        return o ? `mesa ${mesa?.nombre ?? "?"}: ${o.nombre} a las ${o.hora} (${o.pax}p)` : `mesa ${mesa?.nombre ?? "?"}: bloqueada`;
      });
    const salasBloq = nombresMesas.filter((x) => oc.salasBloqueadas.includes("*") || oc.salasBloqueadas.includes(x.sala_id)).map((x) => `mesa ${x.nombre}: sala bloqueada`);
    const todos = [...conflictos, ...salasBloq];
    if (todos.length) return { ok: false, aviso: "solape", error: `Se solapa con otra reserva: ${todos.join("; ")}.` };
  }

  // ---- «Anotado por»: tiene que ser un usuario de la cuenta con el módulo
  let anotador: string | null = null;
  if (d.anotadoPor && d.anotadoPor !== (actual ? actual.anotado_por : perfil.id)) {
    const validos = await usuariosAnotadores(sb, perfil);
    if (!validos.some((u) => u.id === d.anotadoPor)) return { ok: false, error: "Ese usuario no puede anotar reservas" };
    anotador = d.anotadoPor;
  }

  // ---- cliente
  const rc = await guardarCliente(sb, d.cliente);
  if (!rc.ok || !rc.data) return { ok: false, error: rc.error || "No se ha podido guardar el cliente" };
  const clienteId = rc.data;

  // ---- importes según tipo
  const tipo = d.tipo || "gratis";
  const importe = d.importe != null && d.importe > 0 ? Math.round(d.importe * 100) / 100 : null;
  const esPrepago = tipo === "prepago" || tipo === "experiencia";
  const esGarantia = tipo === "garantia" || tipo === "politica_cancelacion";

  const fila = {
    restaurante_id: d.restauranteId,
    cliente_id: clienteId,
    fecha: d.fecha,
    hora: d.hora + ":00",
    pax,
    duracion_min: duracion,
    turno_id: turno.id,
    zona_id: d.zonaId || null,
    mesa_id: mesas[0] ?? null,
    estado: d.estado,
    tipo,
    importe_garantia: esGarantia ? importe : null,
    importe_prepago: esPrepago ? importe : null,
    experiencia_id: d.experienciaId || null,
    prescriptor_id: d.prescriptorId || null,
    etiquetas: d.etiquetas ?? [],
    notas_internas: d.notasInternas?.trim() || null,
    notas_cliente: d.notasCliente?.trim() || null,
    referencia: d.referencia?.trim() || null,
    codigo_promo: promo || null,
    idioma: d.idioma || d.cliente.idioma || "es",
    // Las importadas de Cover traen empresa/alergias en la reserva, no en el cliente: no se pierden.
    alergias: d.cliente.alergias?.trim() || actual?.alergias || null,
    empresa: d.cliente.empresa?.trim() || actual?.empresa || null,
    consentimiento_marketing: !!d.cliente.consentimiento_marketing,
    actualizado_en: new Date().toISOString(),
    // «Solicitar tarjeta»: en la misma escritura, para que el cron de caducidad nunca lea creado_en.
    ...(opc.tarjeta ? { estado_pago: "pendiente_tarjeta", tarjeta_solicitada_en: new Date().toISOString() } : {}),
  };

  const advertencias: string[] = [];
  let id = d.id ?? null;
  const cambiaFHP = cambiaFecha || cambiaHora || cambiaPax;
  if (actual && id) {
    // «Guardar» a secas no avisa al cliente: si la reserva tenía notificar = true (todas las
    // online) y cambia fecha/hora/pax/estado, se escribe con notificar = false para que el
    // trigger calle, se reprograman en silencio los recordatorios y luego se restaura.
    // Cancelada / no-show / tarjeta pendiente avisan siempre (lo decide la base).
    const silenciar = !d.notificar && actual.notificar && (cambiaFHP || cambiaEstado);
    const { error } = await sb
      .from("reservas_reservas")
      .update({ ...fila, ...(anotador ? { anotado_por: anotador } : {}), ...(d.notificar ? { notificar: true } : silenciar ? { notificar: false } : {}) })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    if (silenciar) {
      if (!AVISAN_SIEMPRE.includes(d.estado)) {
        const { error: eC } = await sb
          .from("reservas_mensajes")
          .update({ estado: "cancelado" })
          .eq("reserva_id", id)
          .eq("estado", "pendiente")
          .in("tipo", ["recordatorio", "reconfirmacion", "valoracion"]);
        if (eC) advertencias.push("no se han podido reprogramar los recordatorios");
        else await sb.rpc("reservas_programar_mensajes", { p_reserva_id: id });
      }
      // Solo cambia `notificar`: el trigger (after update of estado, fecha, hora, pax) no salta.
      const { error: eR } = await sb.from("reservas_reservas").update({ notificar: true }).eq("id", id);
      if (eR) advertencias.push("la reserva ha quedado sin avisos automáticos");
    }
  } else {
    const { data, error } = await sb
      .from("reservas_reservas")
      .insert({ ...fila, origen: "panel", notificar: d.notificar, anotado_por: anotador ?? perfil.id, creado_por: perfil.id })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    id = data.id;
  }
  const rid = id as string;

  // ---- mesas (el trigger mete la principal; aquí se sincroniza la combinación completa)
  {
    const del = mesas.length
      ? await sb.from("reservas_reserva_mesas").delete().eq("reserva_id", rid).not("mesa_id", "in", `(${mesas.join(",")})`)
      : await sb.from("reservas_reserva_mesas").delete().eq("reserva_id", rid);
    const ups = mesas.length
      ? await sb.from("reservas_reserva_mesas").upsert(mesas.map((m) => ({ reserva_id: rid, mesa_id: m })), { onConflict: "reserva_id,mesa_id", ignoreDuplicates: true })
      : { error: null };
    if (del.error || ups.error) advertencias.push("no se han podido asignar las mesas");
  }

  // ---- «Guardar y notificar». Si cambian fecha/hora/pax o el estado, avisa el trigger
  //      (modificación / confirmada / alta). Si no cambia nada de eso, el trigger no manda nada
  //      y encolamos aquí la confirmación. Después se anula lo recién encolado por los canales
  //      desmarcados en el pie.
  // Cancelada / no-show / tarjeta pendiente avisan aunque sea «Guardar» a secas: también ahí
  // se respetan los canales del pie.
  const avisaraTrigger = !!actual && cambiaEstado && AVISAN_SIEMPRE.includes(d.estado);
  if (d.notificar || avisaraTrigger) {
    if (d.notificar && actual && !cambiaFHP && !cambiaEstado) {
      const { error: eP } = await sb.rpc("reservas_programar_mensajes", {
        p_reserva_id: rid,
        p_evento: d.estado === "confirmada" || d.estado === "reconfirmada" ? "confirmada" : "alta",
      });
      if (eP) advertencias.push("no se ha podido encolar el aviso al cliente");
    }
    const canales = d.canales ?? { email: true, sms: true, whatsapp: true };
    const apagados = (["email", "sms", "whatsapp"] as const).filter((c) => !canales[c]);
    if (apagados.length) {
      const desde = new Date(inicio - 30_000).toISOString();
      const { error: eA } = await sb
        .from("reservas_mensajes")
        .update({ estado: "cancelado" })
        .eq("reserva_id", rid)
        .eq("estado", "pendiente")
        .in("canal", apagados)
        .in("tipo", TIPOS_ANULABLES)
        .gte("creado_en", desde);
      if (eA) {
        const nom = { email: "email", sms: "SMS", whatsapp: "WhatsApp" };
        advertencias.push(`no se ha podido anular el aviso por ${apagados.map((c) => nom[c]).join(" / ")}: puede que le llegue igualmente`);
      }
    }
  }

  return {
    ok: true,
    id: rid,
    fecha: d.fecha,
    clienteId,
    ...(advertencias.length ? { advertencia: `Reserva guardada, pero ${advertencias.join("; ")}.` } : {}),
  };
}

/** «Solicitar tarjeta»: guarda la reserva en tarjeta_pendiente (estado_pago pendiente_tarjeta) y
    devuelve el enlace /reserva/<token>/pago para mandárselo al cliente. El trigger de mensajería
    encola el aviso de garantía/pago por sí solo (tarjeta_pendiente avisa siempre). Si hay que
    confirmar solape o cupo, devuelve `aviso` igual que guardarReserva. */
export async function solicitarTarjeta(
  d: DatosReserva,
): Promise<R<{ id: string; enlace: string; token: string }> & { aviso?: "solape" | "cupo"; advertencia?: string }> {
  const { sb } = await cliente();
  if (!d.tipo || d.tipo === "gratis") return { ok: false, error: "Elige un tipo de reserva con tarjeta o pago" };
  if (!(d.importe != null && d.importe > 0)) return { ok: false, error: "Indica el importe" };
  const cli = d.cliente;
  if (!cli.email?.trim() && !cli.telefono?.trim()) return { ok: false, error: "El cliente necesita email o teléfono para recibir el enlace" };
  const r = await guardarInterno({ ...d, estado: "tarjeta_pendiente", notificar: true }, { tarjeta: true });
  if (!r.ok) return { ok: false, error: r.error, aviso: r.aviso };
  const [{ data: fila }, { data: base }] = await Promise.all([
    sb.from("reservas_reservas").select("token").eq("id", r.id).single(),
    sb.rpc("reservas_url_base", { p_restaurante: d.restauranteId }),
  ]);
  const token = fila?.token ?? "";
  const urlBase = (typeof base === "string" && base ? base : "").replace(/\/$/, "");
  return { ok: true, data: { id: r.id, token, enlace: `${urlBase}/reserva/${token}/pago` }, advertencia: r.advertencia };
}

/* ================= Código promocional ================= */

export async function validarCodigoPromo(codigo: string, restauranteId: string): Promise<{ valido: boolean; texto: string }> {
  const { sb } = await cliente();
  const c = codigo.trim().toUpperCase();
  if (!c) return { valido: false, texto: "" };
  // Solo letras, números, guion y guion bajo; y sin comodines de LIKE («%» casaría con cualquiera).
  if (!/^[A-Z0-9_-]{1,40}$/.test(c)) return { valido: false, texto: "Código no válido o caducado" };
  const { data } = await sb.from("reservas_codigos").select("*").ilike("codigo", sinComodines(c)).eq("activo", true).limit(5);
  const hoy = new Date().toISOString().slice(0, 10);
  const ok = (data ?? []).find(
    (x) =>
      (!x.restaurante_id || x.restaurante_id === restauranteId) &&
      (!x.valido_desde || x.valido_desde <= hoy) &&
      (!x.valido_hasta || x.valido_hasta >= hoy) &&
      (x.usos_max == null || x.usos < x.usos_max),
  );
  if (!ok) return { valido: false, texto: "Código no válido o caducado" };
  const dto = ok.descuento_pct ? `${ok.descuento_pct}% de descuento` : ok.descuento_importe ? `${ok.descuento_importe} € de descuento` : "";
  return { valido: true, texto: [ok.descripcion, dto].filter(Boolean).join(" · ") || "Código válido" };
}

/* ================= Adjuntos (bucket privado docs) ================= */

const MAX_MB_ADJUNTO = 10;
const MAX_ADJUNTOS = 8;
const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "archivo";

function leerAdjuntos(j: Json | null | undefined): Adjunto[] {
  return Array.isArray(j) ? (j as unknown as Adjunto[]).filter((a) => a && typeof a.ruta === "string") : [];
}

/** URL firmada de subida: el navegador sube el fichero directo al bucket (el binario no pasa por Next).
    Ruta: <cuenta>/reservas/<reserva>/<ts>-<nombre>. */
export async function prepararSubidaAdjunto(input: { reservaId: string; nombre: string; tamano: number; tipo: string | null }): Promise<R<{ ruta: string; urlSubida: string }>> {
  const { sb, perfil } = await cliente();
  if (!input.nombre) return { ok: false, error: "Falta el fichero" };
  if (!(input.tamano > 0) || input.tamano > MAX_MB_ADJUNTO * 1024 * 1024) return { ok: false, error: `El fichero supera el máximo de ${MAX_MB_ADJUNTO} MB` };
  const { data: r, error } = await sb.from("reservas_reservas").select("id, adjuntos").eq("id", input.reservaId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!r) return { ok: false, error: "Reserva no encontrada" };
  if (leerAdjuntos(r.adjuntos).length >= MAX_ADJUNTOS) return { ok: false, error: `Una reserva admite como mucho ${MAX_ADJUNTOS} archivos` };
  const ruta = `${perfil.cuenta_id}/reservas/${input.reservaId}/${Date.now()}-${slug(input.nombre)}`;
  const { data, error: eS } = await sb.storage.from("docs").createSignedUploadUrl(ruta);
  if (eS || !data) return { ok: false, error: "No se pudo preparar la subida" };
  return { ok: true, data: { ruta: data.path, urlSubida: data.signedUrl } };
}

/** Una vez subido, se apunta en reservas_reservas.adjuntos. */
export async function registrarAdjunto(input: { reservaId: string; nombre: string; ruta: string; tamano: number; tipo: string | null }): Promise<R<Adjunto[]>> {
  const { sb, perfil } = await cliente();
  const carpeta = `${perfil.cuenta_id}/reservas/${input.reservaId}`;
  const fichero = input.ruta.slice(carpeta.length + 1);
  if (!esUuid(input.reservaId) || !input.ruta.startsWith(carpeta + "/") || !fichero || fichero.includes("/")) return { ok: false, error: "Ruta de fichero no válida" };
  const { data: r } = await sb.from("reservas_reservas").select("adjuntos").eq("id", input.reservaId).maybeSingle();
  if (!r) return { ok: false, error: "Reserva no encontrada" };
  // El tamaño declarado por el navegador no vale: se mira el objeto real en el bucket (que no
  // tiene límite propio) y si no está o se pasa del máximo, se borra.
  const { data: objs, error: eL } = await sb.storage.from("docs").list(carpeta, { search: fichero, limit: 20 });
  const obj = (objs ?? []).find((o) => o.name === fichero);
  if (eL || !obj) return { ok: false, error: "No se encuentra el archivo subido" };
  const real = Number((obj.metadata as { size?: number } | null)?.size ?? 0);
  if (!(real > 0) || real > MAX_MB_ADJUNTO * 1024 * 1024) {
    await sb.storage.from("docs").remove([input.ruta]);
    return { ok: false, error: `El fichero supera el máximo de ${MAX_MB_ADJUNTO} MB` };
  }
  const lista = leerAdjuntos(r.adjuntos);
  if (lista.some((a) => a.ruta === input.ruta)) return { ok: true, data: lista };
  if (lista.length >= MAX_ADJUNTOS) {
    await sb.storage.from("docs").remove([input.ruta]);
    return { ok: false, error: `Una reserva admite como mucho ${MAX_ADJUNTOS} archivos` };
  }
  const nuevo: Adjunto = { nombre: input.nombre.slice(0, 200), ruta: input.ruta, tamano: real, tipo: input.tipo, subido_en: new Date().toISOString() };
  const adjuntos = [...lista, nuevo];
  const { error } = await sb.from("reservas_reservas").update({ adjuntos: adjuntos as unknown as Json }).eq("id", input.reservaId);
  if (error) {
    await sb.storage.from("docs").remove([input.ruta]);
    return { ok: false, error: error.message };
  }
  return { ok: true, data: adjuntos };
}

/** URL firmada (5 min) para abrir un adjunto. */
export async function urlAdjunto(reservaId: string, ruta: string): Promise<R<{ url: string }>> {
  const { sb } = await cliente();
  const { data: r } = await sb.from("reservas_reservas").select("adjuntos").eq("id", reservaId).maybeSingle();
  const a = leerAdjuntos(r?.adjuntos).find((x) => x.ruta === ruta);
  if (!a) return { ok: false, error: "Archivo no encontrado" };
  const { data, error } = await sb.storage.from("docs").createSignedUrl(a.ruta, 300, { download: a.nombre });
  if (error || !data) return { ok: false, error: "No se pudo firmar la URL" };
  return { ok: true, data: { url: data.signedUrl } };
}

export async function borrarAdjunto(reservaId: string, ruta: string): Promise<R<Adjunto[]>> {
  const { sb } = await cliente();
  const { data: r } = await sb.from("reservas_reservas").select("adjuntos").eq("id", reservaId).maybeSingle();
  if (!r) return { ok: false, error: "Reserva no encontrada" };
  const lista = leerAdjuntos(r.adjuntos);
  if (!lista.some((x) => x.ruta === ruta)) return { ok: false, error: "Archivo no encontrado" };
  const adjuntos = lista.filter((x) => x.ruta !== ruta);
  const { error } = await sb.from("reservas_reservas").update({ adjuntos: adjuntos as unknown as Json }).eq("id", reservaId);
  if (error) return { ok: false, error: error.message };
  const { error: eS } = await sb.storage.from("docs").remove([ruta]);
  return eS ? { ok: true, data: adjuntos, error: "Quitado de la reserva, pero el fichero no se pudo borrar del almacenamiento" } : { ok: true, data: adjuntos };
}

/** Reserva completa (con cliente y mesas) tras guardar, para refrescar el modal sin cerrarlo. */
export async function cargarReserva(id: string): Promise<Reserva | null> {
  const { sb } = await cliente();
  const { data } = await sb.from("reservas_reservas").select("*, reservas_clientes(*), reservas_reserva_mesas(mesa_id)").eq("id", id).maybeSingle();
  return (data as unknown as Reserva) ?? null;
}
