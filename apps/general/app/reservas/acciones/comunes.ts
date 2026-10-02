"use server";

/* Acciones de servidor de la barra superior y del armazón del panel: contadores por turno,
   interruptor de cupo, buscador global y cargas puntuales (una reserva, un cliente) para abrir
   el modal o la ficha desde cualquier sección. Cliente autenticado bajo RLS; sin service key. */

import { exigirModulo } from "@/lib/supabase/server";
import type { Tables } from "@hostelero/db";
import type { Cliente, Reserva } from "../tipos";

async function cliente() {
  const { supabase } = await exigirModulo("reservas");
  return supabase;
}

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

/** Estados que cuentan como reserva viva (ocupan plaza): misma lista que ESTADOS_VIVOS en
    lib-reservas.ts, repetida aquí porque un fichero "use server" no importa de uno "use client". */
const VIVOS = ["pendiente", "confirmada", "reconfirmada", "llegada", "sentada", "postre", "cuenta", "a_revisar", "tarjeta_pendiente"];
/** Estados que cuentan en los contadores del turno: vivos + visita realizada (terminada), igual
    que reservas_ocupacion_mes (Mes) y Ratios. Así el contador no baja al liberar mesas. */
const CUENTAN = [...VIVOS, "terminada"];

const h5 = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");
const dowDe = (fecha: string) => ((new Date(fecha + "T12:00:00").getDay() + 6) % 7) + 1;
const hoyISO = () => new Date().toLocaleDateString("sv-SE");

/* ==================== Contadores por turno (barra) ==================== */

export type ContadorTurno = {
  turno_id: string;
  nombre: string;
  color: string | null;
  hora_inicio: string;
  hora_fin: string;
  /** Cupo del turno cerrado (reservas_cupos.cerrado o cierre legado). */
  cerrado: boolean;
  /** El día entero está cerrado (cupo con turno_id null). */
  cerrado_dia: boolean;
  /** Comensales de reservas vivas o atendidas del turno. */
  pax: number;
  /** Aforo: cupo del día > aforo del turno > capacidad máxima de las mesas activas. */
  aforo: number;
  /** Reservas vivas o atendidas del turno (solo se enseña en el title). */
  reservas: number;
  /** Mesas activas del restaurante (total de «mesas ocupadas / mesas»). */
  mesas: number;
  /** Mesas distintas ocupadas en el turno (principal + combinadas), como Mes. */
  mesas_ocupadas: number;
};

/** Contadores de la barra para un restaurante y un día: por turno del día de la semana,
    pax reservados / aforo, mesas ocupadas / mesas y si el cupo está cerrado. */
export async function contadoresDia(restauranteId: string, fecha: string): Promise<ContadorTurno[]> {
  const sb = await cliente();
  const dow = dowDe(fecha);
  const [turnos, cupos, cierres, reservas, salas] = await Promise.all([
    sb
      .from("reservas_turnos")
      .select("id, nombre, color, hora_inicio, hora_fin, dias_semana, max_pax_total")
      .eq("restaurante_id", restauranteId)
      .eq("activo", true)
      .order("hora_inicio"),
    sb.from("reservas_cupos").select("turno_id, cerrado, max_pax_total").eq("restaurante_id", restauranteId).eq("fecha", fecha),
    sb.from("reservas_cierres").select("turno_id").eq("restaurante_id", restauranteId).eq("fecha", fecha),
    sb
      .from("reservas_reservas")
      .select("hora, pax, estado, turno_id, mesa_id, reservas_reserva_mesas(mesa_id)")
      .eq("restaurante_id", restauranteId)
      .eq("fecha", fecha)
      .in("estado", CUENTAN),
    sb.from("reservas_salas").select("id, activa, mesas:reservas_mesas(cap_max, activa)").eq("restaurante_id", restauranteId),
  ]);

  // Capacidad del local: mesas activas de salas activas.
  let mesasActivas = 0;
  let capacidad = 0;
  for (const s of salas.data ?? []) {
    if (!s.activa) continue;
    for (const m of (s.mesas ?? []) as { cap_max: number; activa: boolean }[]) {
      if (!m.activa) continue;
      mesasActivas += 1;
      capacidad += m.cap_max ?? 0;
    }
  }

  const cupoDia = (cupos.data ?? []).find((c) => c.turno_id === null);
  const cerradoDia = !!cupoDia?.cerrado || (cierres.data ?? []).some((c) => c.turno_id === null);
  const filas = (reservas.data ?? []) as {
    hora: string;
    pax: number;
    estado: string;
    turno_id: string | null;
    mesa_id: string | null;
    reservas_reserva_mesas: { mesa_id: string }[] | null;
  }[];
  const turnosDia = (turnos.data ?? []).filter((t) => (t.dias_semana ?? []).includes(dow));

  return turnosDia.map((t) => {
    const cupo = (cupos.data ?? []).find((c) => c.turno_id === t.id);
    const cierre = (cierres.data ?? []).some((c) => c.turno_id === t.id);
    // Una reserva es del turno si lleva su id o, sin turno, si su hora cae en la franja.
    const propias = filas.filter((r) =>
      r.turno_id ? r.turno_id === t.id : h5(r.hora) >= h5(t.hora_inicio) && h5(r.hora) <= h5(t.hora_fin),
    );
    const mesasOcupadas = new Set(
      propias.flatMap((r) => [r.mesa_id, ...(r.reservas_reserva_mesas ?? []).map((x) => x.mesa_id)]).filter(Boolean),
    ).size;
    return {
      turno_id: t.id,
      nombre: t.nombre,
      color: t.color,
      hora_inicio: h5(t.hora_inicio),
      hora_fin: h5(t.hora_fin),
      cerrado: cerradoDia || !!cupo?.cerrado || cierre,
      cerrado_dia: cerradoDia,
      pax: propias.reduce((a, r) => a + (r.pax ?? 0), 0),
      // Mismo orden de preferencia que reservas_cupo_motivo: cupo del turno > cupo del día > turno.
      aforo: (cupo ?? cupoDia)?.max_pax_total ?? t.max_pax_total ?? capacidad,
      reservas: propias.length,
      mesas: mesasActivas,
      mesas_ocupadas: mesasOcupadas,
    };
  });
}

/** Abre o cierra el cupo de un turno para un día.
    - Si el turno no tiene fila propia en reservas_cupos, se crea copiando los límites y la nota
      del cupo del día (turno_id null): los RPC eligen la fila del turno antes que la del día, así
      que una fila vacía haría desaparecer el aforo online fijado para el día.
    - Al reabrir, si la fila del turno no aporta nada propio (todo null o idéntico al día), se
      borra para que vuelva a mandar el cupo del día. */
export async function alternarCupo(
  restauranteId: string,
  fecha: string,
  turnoId: string,
  cerrado: boolean,
): Promise<R<Tables<"reservas_cupos">>> {
  const FALLO = "No se ha podido cambiar el cupo (sin permiso o sin conexión). Inténtalo de nuevo.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: "Fecha no válida." };
  const sb = await cliente();

  // El turno tiene que ser de ese restaurante y visible bajo RLS (de la cuenta del usuario).
  // Sin esto se podría cerrar el cupo de un turno ajeno: las FK no pasan por RLS.
  const { data: turno } = await sb
    .from("reservas_turnos")
    .select("id")
    .eq("id", turnoId)
    .eq("restaurante_id", restauranteId)
    .maybeSingle();
  if (!turno) return { ok: false, error: "Turno no válido." };

  const [propia, delDia] = await Promise.all([
    sb.from("reservas_cupos").select("*").eq("restaurante_id", restauranteId).eq("fecha", fecha).eq("turno_id", turnoId).maybeSingle(),
    sb
      .from("reservas_cupos")
      .select("max_pax_online, max_pax_total, nota")
      .eq("restaurante_id", restauranteId)
      .eq("fecha", fecha)
      .is("turno_id", null)
      .maybeSingle(),
  ]);
  if (propia.error || delDia.error) {
    console.error("[reservas] alternarCupo lectura", propia.error?.code ?? delDia.error?.code);
    return { ok: false, error: FALLO };
  }
  const existe = propia.data;
  const dia = delDia.data;
  const ahora = new Date().toISOString();

  let data: Tables<"reservas_cupos"> | undefined;
  if (existe && !cerrado && sinValoresPropios(existe, dia)) {
    // Reabrir sin límites propios: fuera la fila, manda el cupo del día.
    const del = await sb.from("reservas_cupos").delete().eq("id", existe.id);
    if (del.error) {
      console.error("[reservas] alternarCupo borrar", del.error.code, del.error.message);
      return { ok: false, error: FALLO };
    }
    data = { ...existe, cerrado: false, actualizado_en: ahora };
  } else {
    const res = existe
      ? await sb.from("reservas_cupos").update({ cerrado, actualizado_en: ahora }).eq("id", existe.id).select("*").single()
      : await sb
          .from("reservas_cupos")
          .insert({
            restaurante_id: restauranteId,
            fecha,
            turno_id: turnoId,
            cerrado,
            max_pax_online: dia?.max_pax_online ?? null,
            max_pax_total: dia?.max_pax_total ?? null,
            nota: dia?.nota ?? null,
          })
          .select("*")
          .single();
    if (res.error) {
      console.error("[reservas] alternarCupo escribir", res.error.code, res.error.message);
      return { ok: false, error: FALLO };
    }
    data = res.data;
  }

  // Al abrir se retiran también los cierres antiguos (reservas_cierres) del mismo turno y día;
  // si no, el turno seguiría cerrado para el widget y el interruptor volvería a OFF al recargar.
  if (!cerrado) {
    const del = await sb
      .from("reservas_cierres")
      .delete()
      .eq("restaurante_id", restauranteId)
      .eq("fecha", fecha)
      .eq("turno_id", turnoId);
    if (del.error) {
      console.error("[reservas] alternarCupo cierres", del.error.code, del.error.message);
      return { ok: false, error: "Cupo abierto, pero queda un cierre antiguo de ese turno. Revísalo en Mes o Ajustes." };
    }
  }
  return { ok: true, data };
}

/** ¿La fila del turno no aporta límites ni nota propios? (todo null o copia exacta del día) */
function sinValoresPropios(
  fila: Pick<Tables<"reservas_cupos">, "max_pax_online" | "max_pax_total" | "nota">,
  dia: Pick<Tables<"reservas_cupos">, "max_pax_online" | "max_pax_total" | "nota"> | null,
): boolean {
  const vacia = fila.max_pax_online == null && fila.max_pax_total == null && !fila.nota;
  const copia =
    !!dia &&
    fila.max_pax_online === dia.max_pax_online &&
    fila.max_pax_total === dia.max_pax_total &&
    (fila.nota ?? null) === (dia.nota ?? null);
  return vacia || copia;
}

/* ==================== Buscador global ==================== */

export type ReservaEncontrada = {
  id: string;
  fecha: string;
  hora: string;
  pax: number;
  estado: string;
  localizador: string;
  restaurante_id: string;
  mesa: string | null;
  nombre: string;
  telefono: string | null;
};

export type ClienteEncontrado = Pick<Cliente, "id" | "nombre" | "apellidos" | "telefono" | "email" | "vip" | "lista_negra"> & {
  visitas: number;
  ultima_visita: string | null;
};

export type ResultadoBusqueda = { reservas: ReservaEncontrada[]; clientes: ClienteEncontrado[] };

/** Quita lo que rompe la sintaxis de filtros de PostgREST. */
const limpiar = (s: string) => s.replace(/[,()"'\\%_]/g, " ").replace(/\s+/g, " ").trim();

type FilaReserva = Pick<Tables<"reservas_reservas">, "id" | "fecha" | "hora" | "pax" | "estado" | "localizador" | "restaurante_id"> & {
  reservas_clientes: Pick<Cliente, "nombre" | "apellidos" | "telefono"> | null;
  reservas_mesas: { nombre: string } | null;
};

const aEncontrada = (r: FilaReserva): ReservaEncontrada => ({
  id: r.id,
  fecha: r.fecha,
  hora: h5(r.hora),
  pax: r.pax,
  estado: r.estado,
  localizador: r.localizador,
  restaurante_id: r.restaurante_id,
  mesa: r.reservas_mesas?.nombre ?? null,
  nombre: [r.reservas_clientes?.nombre, r.reservas_clientes?.apellidos].filter(Boolean).join(" ").trim() || "—",
  telefono: r.reservas_clientes?.telefono ?? null,
});

/** Busca reservas (por localizador o por el cliente) y clientes (nombre, apellidos, teléfono,
    email). Las reservas salen primero las próximas (ascendente) y luego las pasadas (descendente). */
export async function buscarGlobal(q: string): Promise<ResultadoBusqueda> {
  const texto = limpiar(q);
  if (texto.length < 2) return { reservas: [], clientes: [] };
  const sb = await cliente();
  const digitos = texto.replace(/\D/g, "");
  const hoy = hoyISO();
  // Relación con nombre: entre reservas y mesas hay FK directa y una N:M (reservas_reserva_mesas),
  // y sin nombre PostgREST responde PGRST201 (ambigüedad).
  const SEL =
    "id, fecha, hora, pax, estado, localizador, restaurante_id, reservas_clientes(nombre, apellidos, telefono), reservas_mesas!reservas_reservas_mesa_id_fkey(nombre)";

  // 1) Clientes que casan con el texto.
  const partes = [`nombre.ilike.%${texto}%`, `apellidos.ilike.%${texto}%`, `email_norm.ilike.%${texto.toLowerCase()}%`];
  if (digitos.length >= 4) partes.push(`telefono_norm.ilike.%${digitos}%`, `telefono.ilike.%${digitos}%`);
  // «Juan García»: nombre en una columna y apellidos en otra. Se prueban los cortes habituales
  // (primera palabra / resto, todo menos la última / última) y el orden «apellido nombre».
  const w = texto.split(" ").filter(Boolean);
  if (w.length >= 2) {
    const primera = w[0];
    const resto = w.slice(1).join(" ");
    const inicio = w.slice(0, -1).join(" ");
    const ultima = w[w.length - 1];
    partes.push(
      `and(nombre.ilike.%${primera}%,apellidos.ilike.%${resto}%)`,
      `and(nombre.ilike.%${inicio}%,apellidos.ilike.%${ultima}%)`,
      `and(apellidos.ilike.%${primera}%,nombre.ilike.%${resto}%)`,
    );
  }
  // Un localizador suele ser una sola palabra alfanumérica.
  const pareceLocalizador = /^[a-z0-9-]{3,}$/i.test(texto);

  const [cli, loc] = await Promise.all([
    sb
      .from("reservas_clientes")
      .select("id, nombre, apellidos, telefono, email, vip, lista_negra")
      .or(partes.join(","))
      .order("actualizado_en", { ascending: false })
      .limit(8),
    pareceLocalizador
      ? sb.from("reservas_reservas").select(SEL).ilike("localizador", `%${texto}%`).order("fecha", { ascending: false }).limit(8)
      : Promise.resolve({ data: [] as FilaReserva[], error: null }),
  ]);

  if (cli.error || loc.error) console.error("[reservas] buscarGlobal", cli.error?.code ?? "", loc.error?.code ?? "");
  const clientes = (cli.data ?? []) as Omit<ClienteEncontrado, "visitas" | "ultima_visita">[];
  const ids = clientes.map((c) => c.id);

  // 2) Estadísticas de esos clientes y sus reservas recientes/próximas.
  const [stats, deClientes] = await Promise.all([
    ids.length
      ? sb.from("reservas_clientes_stats").select("cliente_id, visitas, ultima_visita").in("cliente_id", ids)
      : Promise.resolve({ data: [] as { cliente_id: string | null; visitas: number | null; ultima_visita: string | null }[], error: null }),
    ids.length
      ? sb.from("reservas_reservas").select(SEL).in("cliente_id", ids).order("fecha", { ascending: false }).limit(12)
      : Promise.resolve({ data: [] as FilaReserva[], error: null }),
  ]);

  if (stats.error || deClientes.error) console.error("[reservas] buscarGlobal clientes", stats.error?.code ?? "", deClientes.error?.code ?? "");
  const porCliente = new Map((stats.data ?? []).map((s) => [s.cliente_id, s]));
  const vistas = new Set<string>();
  const reservas: ReservaEncontrada[] = [];
  for (const r of [...((loc.data ?? []) as FilaReserva[]), ...((deClientes.data ?? []) as FilaReserva[])]) {
    if (vistas.has(r.id)) continue;
    vistas.add(r.id);
    reservas.push(aEncontrada(r));
  }
  const proximas = reservas.filter((r) => r.fecha >= hoy).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
  const pasadas = reservas.filter((r) => r.fecha < hoy).sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));

  return {
    reservas: [...proximas, ...pasadas].slice(0, 12),
    clientes: clientes.map((c) => ({
      ...c,
      visitas: porCliente.get(c.id)?.visitas ?? 0,
      ultima_visita: porCliente.get(c.id)?.ultima_visita ?? null,
    })),
  };
}

/* ==================== Cargas puntuales ==================== */

/** Una reserva completa (con cliente y mesas) para abrirla en el modal. */
export async function cargarReserva(id: string): Promise<Reserva | null> {
  const sb = await cliente();
  const { data } = await sb
    .from("reservas_reservas")
    .select("*, reservas_clientes(*), reservas_reserva_mesas(mesa_id)")
    .eq("id", id)
    .maybeSingle();
  return (data as unknown as Reserva | null) ?? null;
}

/** Un cliente por id (para prellenar «Nueva reserva» desde su ficha). */
export async function cargarCliente(id: string): Promise<Cliente | null> {
  const sb = await cliente();
  const { data } = await sb.from("reservas_clientes").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}
