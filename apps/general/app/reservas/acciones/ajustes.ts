"use server";

/* Acciones de servidor de la sección Ajustes del panel de Reservas.
   Una función por entidad (listar / guardar / borrar). Todo pasa por el cliente autenticado del
   esqueleto bajo RLS (cuenta_id = cuenta_actual()); nada de service key.
   Las escrituras pasan por escribir(ámbito, …): dirección, o `puede_ajustes` de
   reservas_permisos_perfil que cubra el restaurante afectado (columna `restaurantes`); lo común a
   todos los restaurantes exige el permiso sin restricción de local. Además se comprueba que el
   restaurante es de la cuenta: la RLS solo mira cuenta_id y la FK a reservas_restaurantes no pasa
   por RLS, así que sin esto se podrían colgar filas de un restaurante ajeno.
   PENDIENTE (integrador, migración): la RLS de las tablas de configuración deja escribir a toda la
   cuenta; esta comprobación se salta llamando a PostgREST directamente. Ver informe del agente. */

import { unstable_rethrow } from "next/navigation";
import { exigirModulo } from "@/lib/supabase/server";
import { enviarCorreo } from "@/lib/correo";
import type { Tables, TablesInsert, TablesUpdate } from "@hostelero/db";
import type { Mesa, Restaurante, Sala, Turno } from "../tipos";

type R<T = undefined> = { ok: boolean; error?: string; data?: T };
/** El paquete db no reexporta Json: lo derivamos de una columna jsonb. */
type Json = Tables<"reservas_restaurantes">["duracion_por_pax"];

export type Etiqueta = Tables<"reservas_etiquetas">;
export type Prescriptor = Tables<"reservas_prescriptores">;
export type Experiencia = Tables<"reservas_experiencias">;
export type Plantilla = Tables<"reservas_plantillas">;
export type Pregunta = Tables<"reservas_preguntas">;
export type Permiso = Tables<"reservas_permisos_perfil">;
export type Codigo = Tables<"reservas_codigos">;
export type Camarero = Tables<"reservas_camareros">;
export type CamareroDia = Tables<"reservas_mesas_camarero_dia">;
export type Combinacion = Tables<"reservas_mesas_combinaciones">;
export type Cupo = Tables<"reservas_cupos">;
export type Cierre = Tables<"reservas_cierres"> & { reservas_turnos?: { nombre: string } | null };
export type PerfilMin = { id: string; nombre: string | null; correo: string; rol: string };

/* ================= Acceso ================= */

async function cliente() {
  const { supabase, perfil } = await exigirModulo("reservas");
  return { sb: supabase, perfil };
}
type Sb = Awaited<ReturnType<typeof cliente>>["sb"];
type Perfil = Awaited<ReturnType<typeof cliente>>["perfil"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);

/** Permisos efectivos de un perfil en Reservas. Sin fila en reservas_permisos_perfil valen los
    valores por defecto de la tabla (estados y mover sí; cobrar, plano y ajustes no; todos los
    restaurantes). Dirección lo puede todo. `restaurantes` null = todos. */
export type PermisosReservas = {
  esDireccion: boolean;
  estado: boolean;
  mover: boolean;
  cobrar: boolean;
  plano: boolean;
  ajustes: boolean;
  restaurantes: string[] | null;
};

async function permisosDe(sb: Sb, perfil: Perfil): Promise<PermisosReservas> {
  if (perfil.rol === "direccion") {
    return { esDireccion: true, estado: true, mover: true, cobrar: true, plano: true, ajustes: true, restaurantes: null };
  }
  const { data, error } = await sb
    .from("reservas_permisos_perfil")
    .select("puede_cambiar_estado, puede_mover, puede_cobrar, puede_editar_plano, puede_ajustes, restaurantes")
    .eq("perfil_id", perfil.id)
    .maybeSingle();
  // Si la lectura falla no se presume nada: sin permisos de escritura.
  if (error) return { esDireccion: false, estado: false, mover: false, cobrar: false, plano: false, ajustes: false, restaurantes: [] };
  if (!data) return { esDireccion: false, estado: true, mover: true, cobrar: false, plano: false, ajustes: false, restaurantes: null };
  return {
    esDireccion: false,
    estado: data.puede_cambiar_estado,
    mover: data.puede_mover,
    cobrar: data.puede_cobrar,
    plano: data.puede_editar_plano,
    ajustes: data.puede_ajustes,
    restaurantes: data.restaurantes,
  };
}

/** Permisos del usuario actual (para el panel y para que otras acciones —dia, reserva,
    cronograma, pagos— apliquen el mismo criterio). Con restId, `restaurantes` ya viene resuelto
    en `enRestaurante`. */
export async function permisosReservas(restId?: string | null): Promise<PermisosReservas & { enRestaurante: boolean }> {
  const { sb, perfil } = await cliente();
  const p = await permisosDe(sb, perfil);
  return { ...p, enRestaurante: !restId || !p.restaurantes || p.restaurantes.includes(restId) };
}

/** El restaurante existe y es de la cuenta del usuario (la FK de las tablas hijas no pasa por RLS). */
async function restPropio(sb: Sb, perfil: Perfil, restId: string): Promise<boolean> {
  if (!esUuid(restId)) return false;
  const { data } = await sb.from("reservas_restaurantes").select("id").eq("id", restId).eq("cuenta_id", perfil.cuenta_id).maybeSingle();
  return !!data;
}

/** Tablas de configuración con restaurante_id (para resolver el restaurante desde el id de la fila). */
type TablaRest =
  | "reservas_turnos"
  | "reservas_cupos"
  | "reservas_cierres"
  | "reservas_salas"
  | "reservas_mesas_combinaciones"
  | "reservas_experiencias"
  | "reservas_preguntas"
  | "reservas_camareros"
  | "reservas_plantillas"
  | "reservas_codigos";

/** A qué afecta una escritura:
    - { rest }: un restaurante concreto (se comprueba que es de la cuenta y que el permiso lo cubre);
    - { tabla, id } / { tabla, ids }: se lee el restaurante de la(s) fila(s);
    - { mesa } / { sala }: mesas y salas (la mesa cuelga de la sala);
    - "cuenta": catálogos comunes a todos los restaurantes (exige permiso sin restricción de local). */
type Ambito =
  | { rest: string }
  | { tabla: TablaRest; id: string }
  | { tabla: TablaRest; ids: string[] }
  | { mesa: string }
  | { sala: string }
  | "cuenta";

const SIN_PERMISO = "Solo dirección (o quien tenga el permiso de ajustes) puede cambiar la configuración.";
const SIN_LOCAL = "Tu permiso de ajustes no incluye este restaurante.";
const SIN_CUENTA = "Esto afecta a todos los restaurantes: hace falta permiso de ajustes sin restricción de local.";

/** Restaurante(s) afectados por el ámbito; null = no encontrado (o de otra cuenta); "cuenta" = común. */
async function restaurantesDe(sb: Sb, perfil: Perfil, a: Ambito): Promise<string[] | "cuenta" | null> {
  if (a === "cuenta") return "cuenta";
  if ("rest" in a) return (await restPropio(sb, perfil, a.rest)) ? [a.rest] : null;
  if ("sala" in a) {
    if (!esUuid(a.sala)) return null;
    const { data } = await sb.from("reservas_salas").select("restaurante_id").eq("id", a.sala).maybeSingle();
    return data && (await restPropio(sb, perfil, data.restaurante_id)) ? [data.restaurante_id] : null;
  }
  if ("mesa" in a) {
    if (!esUuid(a.mesa)) return null;
    const { data } = await sb.from("reservas_mesas").select("sala_id").eq("id", a.mesa).maybeSingle();
    return data ? restaurantesDe(sb, perfil, { sala: data.sala_id }) : null;
  }
  const ids = "id" in a ? [a.id] : [...new Set(a.ids)];
  if (!ids.length || !ids.every(esUuid)) return null;
  // Todas las tablas de TablaRest tienen restaurante_id (nullable en plantillas y códigos).
  const { data, error } = await (sb.from(a.tabla as "reservas_plantillas").select("id, restaurante_id").in("id", ids));
  if (error || !data || data.length !== ids.length) return null;
  const rests = [...new Set(data.map((f) => f.restaurante_id))];
  if (rests.includes(null)) return rests.length === 1 ? "cuenta" : null;
  for (const r of rests as string[]) if (!(await restPropio(sb, perfil, r))) return null;
  return rests as string[];
}

/** null si el perfil puede escribir en ese ámbito; si no, el motivo. */
async function comprobar(sb: Sb, perfil: Perfil, ambito: Ambito, p?: PermisosReservas): Promise<string | null> {
  const per = p ?? (await permisosDe(sb, perfil));
  if (!per.ajustes) return SIN_PERMISO;
  const rests = await restaurantesDe(sb, perfil, ambito);
  if (rests === null) return "No se encuentra lo que intentas cambiar (o no es de tu cuenta).";
  if (rests === "cuenta") return per.restaurantes ? SIN_CUENTA : null;
  if (per.restaurantes && !rests.every((r) => per.restaurantes!.includes(r))) return SIN_LOCAL;
  return null;
}

/** Envuelve una escritura: comprueba el permiso (por restaurante) y convierte cualquier excepción
    en {ok:false} (Next oculta el mensaje de los errores lanzados en producción). Las excepciones
    de control de flujo de Next (redirect a /login, notFound) se relanzan. */
async function escribir<T = undefined>(ambito: Ambito, fn: (sb: Sb, perfil: Perfil) => Promise<R<T>>): Promise<R<T>> {
  try {
    const { sb, perfil } = await cliente();
    const motivo = await comprobar(sb, perfil, ambito);
    if (motivo) return { ok: false, error: motivo };
    return await fn(sb, perfil);
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: (e as Error).message || "No se ha podido guardar." };
  }
}

/** Mensaje legible para los errores de Postgres más habituales. */
function legible(e: { code?: string; message: string }, duplicado = "Ya existe uno con ese nombre.", enUso = "No se puede borrar: está en uso."): string {
  if (e.code === "23505") return duplicado;
  if (e.code === "23503") return enUso;
  if (e.code === "23514") return "Algún valor no es válido.";
  return e.message;
}

/** Quién soy y qué puedo (para que la sección muestre o esconda lo editable). Con restId,
    `puedeAjustes` es para ese restaurante (el permiso puede estar limitado a algunos locales). */
export async function quienSoy(restId?: string | null): Promise<{
  id: string; nombre: string; rol: string; puedeAjustes: boolean; puedeAjustesCuenta: boolean; puedeEditarPlano: boolean; esDireccion: boolean;
}> {
  const { sb, perfil } = await cliente();
  const p = await permisosDe(sb, perfil);
  const enRest = !restId || !p.restaurantes || p.restaurantes.includes(restId);
  return {
    id: perfil.id,
    nombre: perfil.nombre || perfil.correo,
    rol: perfil.rol,
    esDireccion: p.esDireccion,
    puedeAjustes: p.ajustes && enRest,
    // Catálogos comunes (etiquetas, prescriptores, plantillas y códigos de la cuenta).
    puedeAjustesCuenta: p.ajustes && !p.restaurantes,
    // El editor del plano mira su propio permiso (acciones/plano.ts › exigirEdicionPlano).
    puedeEditarPlano: p.plano && enRest,
  };
}

/* ================= Validadores ================= */

const HEX = /^#[0-9A-Fa-f]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HORA = /^\d{2}:\d{2}(:\d{2})?$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const IDIOMAS = ["es", "en", "ca", "fr", "de", "it"];

const txt = (v: unknown, max = 200): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};
const ent = (v: unknown, def: number, min = 0, max = 100000): number => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.round(n)));
};
const entONulo = (v: unknown, min = 0, max = 100000): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
};
const decONulo = (v: unknown, min = 0, max = 100000): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n * 100) / 100));
};
const url = (v: unknown): string | null => {
  const s = txt(v, 500);
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
};
const hex = (v: unknown, def: string | null): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return HEX.test(s) ? s.toUpperCase() : def;
};
const h5 = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return HORA.test(s) ? s.slice(0, 5) : null;
};
const dias = (v: unknown): number[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => ent(x, 0, 1, 7)).filter((x) => x >= 1 && x <= 7))].sort() : [];

/** Slug con el mismo criterio que la función SQL reservas_slug (minúsculas, sin acentos, guiones). */
function slugDe(s: string): string | null {
  const t = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return t || null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESTAURANTE (datos, widget, políticas y pagos, mensajería)
   ═══════════════════════════════════════════════════════════════════════════ */

export type TramoDuracion = { desde: number; hasta: number | null; min: number };

/** Tramos → {"1-2":90,"3-4":120,"9+":180} (formato que lee reservas_duracion_pax). La lectura
    inversa la hace el cliente (secciones/ajustes/comunes.tsx → tramosDeJson). */
function jsonDeTramos(tramos: TramoDuracion[]): Json | null {
  const o: Record<string, number> = {};
  for (const t of tramos) {
    const desde = ent(t.desde, 1, 1, 999);
    const min = ent(t.min, 120, 15, 600);
    if (t.hasta === null || t.hasta === undefined) o[`${desde}+`] = min;
    else o[`${desde}-${Math.max(desde, ent(t.hasta, desde, 1, 999))}`] = min;
  }
  return Object.keys(o).length ? (o as Json) : null;
}

/** Restaurante recién leído (la copia del panel puede estar desfasada). */
export async function cargarRestaurante(id: string): Promise<Restaurante | null> {
  const { sb } = await cliente();
  const { data } = await sb.from("reservas_restaurantes").select("*").eq("id", id).maybeSingle();
  return data;
}

/** Campos editables desde Ajustes. Todo opcional: solo se actualiza lo que llega. */
export type CamposRestaurante = Partial<{
  nombre: string;
  descripcion: string | null;
  direccion: string | null;
  ubicacion: string | null;
  telefono: string | null;
  telefono_whatsapp: string | null;
  email: string | null;
  email_reservas: string | null;
  idiomas: string[];
  color_marca: string | null;
  mensaje_widget: string | null;
  url_condiciones: string | null;
  url_resena_google: string | null;
  url_base: string | null;
  zona_horaria: string;
  prefijo_localizador: string | null;
  online_activo: boolean;
  antelacion_min_horas: number;
  antelacion_max_dias: number;
  max_pax_online: number;
  grupos_telefono: string | null;
  confirmar_online_auto: boolean;
  liberar_tras_min: number;
  duracion_por_pax: TramoDuracion[];
  /* políticas y pagos */
  tarjeta_desde_pax: number | null;
  garantia_importe_pax: number | null;
  prepago_importe_pax: number | null;
  politica_cancelacion_horas: number;
  tarjeta_caduca_min: number;
  cobro_noshow_automatico: boolean;
  noshow_automatico: boolean;
  envio_noshow: boolean;
  /* mensajería */
  envio_email: boolean;
  envio_sms: boolean;
  envio_whatsapp: boolean;
  recordatorio_horas: number;
  reconfirmacion_horas: number;
  valoracion_horas: number;
}>;

export async function guardarRestauranteAjustes(id: string, c: CamposRestaurante): Promise<R<Restaurante>> {
  return escribir({ rest: id }, async (sb) => {
    const u: TablesUpdate<"reservas_restaurantes"> = {};
    if (c.nombre !== undefined) {
      const n = txt(c.nombre, 80);
      if (!n) return { ok: false, error: "El restaurante necesita un nombre." };
      u.nombre = n;
    }
    if (c.descripcion !== undefined) u.descripcion = txt(c.descripcion, 600);
    if (c.direccion !== undefined) u.direccion = txt(c.direccion, 300);
    if (c.ubicacion !== undefined) u.ubicacion = txt(c.ubicacion, 300);
    if (c.telefono !== undefined) u.telefono = txt(c.telefono, 40);
    if (c.telefono_whatsapp !== undefined) u.telefono_whatsapp = txt(c.telefono_whatsapp, 40);
    if (c.email !== undefined) {
      const e = txt(c.email, 120);
      if (e && !EMAIL.test(e)) return { ok: false, error: "El email de contacto no es válido." };
      u.email = e;
    }
    if (c.email_reservas !== undefined) {
      const e = txt(c.email_reservas, 120);
      if (e && !EMAIL.test(e)) return { ok: false, error: "El email de reservas no es válido." };
      u.email_reservas = e;
    }
    if (c.idiomas !== undefined) {
      const ids = (Array.isArray(c.idiomas) ? c.idiomas : []).map((x) => String(x).toLowerCase()).filter((x) => IDIOMAS.includes(x));
      if (!ids.length) return { ok: false, error: "Deja al menos un idioma activo." };
      u.idiomas = [...new Set(ids)];
    }
    if (c.color_marca !== undefined) {
      if (c.color_marca && !HEX.test(c.color_marca)) return { ok: false, error: "El color de marca debe ser hexadecimal (#RRGGBB)." };
      u.color_marca = hex(c.color_marca, null);
    }
    if (c.mensaje_widget !== undefined) u.mensaje_widget = txt(c.mensaje_widget, 600);
    if (c.url_condiciones !== undefined) u.url_condiciones = url(c.url_condiciones);
    if (c.url_resena_google !== undefined) u.url_resena_google = url(c.url_resena_google);
    if (c.url_base !== undefined) u.url_base = url(c.url_base)?.replace(/\/+$/, "") ?? null;
    if (c.zona_horaria !== undefined) u.zona_horaria = txt(c.zona_horaria, 60) ?? "Europe/Madrid";
    if (c.prefijo_localizador !== undefined) {
      const p = txt(c.prefijo_localizador, 6);
      if (p && !/^[A-Z0-9]{1,6}$/i.test(p)) return { ok: false, error: "El prefijo del localizador: letras o números, máximo 6." };
      u.prefijo_localizador = p ? p.toUpperCase() : null;
    }
    if (c.online_activo !== undefined) u.online_activo = !!c.online_activo;
    if (c.antelacion_min_horas !== undefined) u.antelacion_min_horas = ent(c.antelacion_min_horas, 0, 0, 720);
    if (c.antelacion_max_dias !== undefined) u.antelacion_max_dias = ent(c.antelacion_max_dias, 60, 1, 730);
    if (c.max_pax_online !== undefined) u.max_pax_online = ent(c.max_pax_online, 8, 1, 200);
    if (c.grupos_telefono !== undefined) u.grupos_telefono = txt(c.grupos_telefono, 400);
    if (c.confirmar_online_auto !== undefined) u.confirmar_online_auto = !!c.confirmar_online_auto;
    if (c.liberar_tras_min !== undefined) u.liberar_tras_min = ent(c.liberar_tras_min, 20, 0, 240);
    if (c.duracion_por_pax !== undefined) {
      const tramos = Array.isArray(c.duracion_por_pax) ? c.duracion_por_pax : [];
      for (const t of tramos) {
        if (t.hasta !== null && t.hasta !== undefined && t.hasta < t.desde) return { ok: false, error: "En la duración por personas, «hasta» no puede ser menor que «desde»." };
      }
      u.duracion_por_pax = jsonDeTramos(tramos);
    }
    if (c.tarjeta_desde_pax !== undefined) u.tarjeta_desde_pax = entONulo(c.tarjeta_desde_pax, 1, 500);
    if (c.garantia_importe_pax !== undefined) u.garantia_importe_pax = decONulo(c.garantia_importe_pax, 0, 10000);
    if (c.prepago_importe_pax !== undefined) u.prepago_importe_pax = decONulo(c.prepago_importe_pax, 0, 10000);
    if (c.politica_cancelacion_horas !== undefined) u.politica_cancelacion_horas = ent(c.politica_cancelacion_horas, 24, 0, 720);
    if (c.tarjeta_caduca_min !== undefined) u.tarjeta_caduca_min = ent(c.tarjeta_caduca_min, 30, 5, 1440);
    if (c.cobro_noshow_automatico !== undefined) u.cobro_noshow_automatico = !!c.cobro_noshow_automatico;
    if (c.noshow_automatico !== undefined) u.noshow_automatico = !!c.noshow_automatico;
    if (c.envio_noshow !== undefined) u.envio_noshow = !!c.envio_noshow;
    if (c.envio_email !== undefined) u.envio_email = !!c.envio_email;
    if (c.envio_sms !== undefined) u.envio_sms = !!c.envio_sms;
    if (c.envio_whatsapp !== undefined) u.envio_whatsapp = !!c.envio_whatsapp;
    if (c.recordatorio_horas !== undefined) u.recordatorio_horas = ent(c.recordatorio_horas, 24, 0, 720);
    if (c.reconfirmacion_horas !== undefined) u.reconfirmacion_horas = ent(c.reconfirmacion_horas, 48, 0, 720);
    if (c.valoracion_horas !== undefined) u.valoracion_horas = ent(c.valoracion_horas, 2, 0, 720);
    if (!Object.keys(u).length) return { ok: false, error: "No hay nada que guardar." };

    const { data, error } = await sb.from("reservas_restaurantes").update(u).eq("id", id).select("*").single();
    if (error) return { ok: false, error: legible(error, "Ya hay un restaurante con ese nombre.") };
    return { ok: true, data };
  });
}

/* ---- Logo (bucket privado «docs»: se guarda una URL firmada de larga duración) ---- */

const LOGO_MAX_MB = 2;
/* Sin SVG: la URL firmada es pública y un SVG puede llevar scripts. */
const LOGO_TIPOS = ["image/png", "image/jpeg", "image/webp"];
const LOGO_FIRMA_SEG = 60 * 60 * 24 * 365 * 10; // 10 años
const LOGO_CARPETA = (cuentaId: string) => `${cuentaId}/reservas/logos`;

/** La ruta no lleva el id del restaurante (la URL del logo es pública); solo un UUID aleatorio. */
export async function prepararSubidaLogo(restId: string, nombre: string, tamano: number, tipo: string | null): Promise<R<{ ruta: string; urlSubida: string }>> {
  return escribir({ rest: restId }, async (sb, perfil) => {
    if (!tipo || !LOGO_TIPOS.includes(tipo)) return { ok: false, error: "El logo debe ser PNG, JPG o WebP." };
    if (!(tamano > 0) || tamano > LOGO_MAX_MB * 1024 * 1024) return { ok: false, error: `El logo no puede superar ${LOGO_MAX_MB} MB.` };
    const ext = tipo === "image/png" ? "png" : tipo === "image/webp" ? "webp" : "jpg";
    const ruta = `${LOGO_CARPETA(perfil.cuenta_id)}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await sb.storage.from("docs").createSignedUploadUrl(ruta);
    if (error || !data) return { ok: false, error: "No se ha podido preparar la subida del logo." };
    void nombre;
    return { ok: true, data: { ruta: data.path, urlSubida: data.signedUrl } };
  });
}

/** Comprueba el fichero subido de verdad (tipo y tamaño reales, no los que dijo el navegador)
    antes de enlazarlo; si no cumple, se borra. */
export async function registrarLogo(restId: string, ruta: string): Promise<R<{ logo_url: string }>> {
  return escribir({ rest: restId }, async (sb, perfil) => {
    const carpeta = LOGO_CARPETA(perfil.cuenta_id);
    const nombre = ruta.startsWith(`${carpeta}/`) ? ruta.slice(carpeta.length + 1) : "";
    if (!/^[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(nombre)) return { ok: false, error: "Ruta de fichero no válida." };
    const { data: lista, error: eL } = await sb.storage.from("docs").list(carpeta, { search: nombre, limit: 5 });
    const obj = (lista ?? []).find((o) => o.name === nombre);
    if (eL || !obj) return { ok: false, error: "No se encuentra el logo subido. Vuelve a intentarlo." };
    const meta = (obj.metadata ?? {}) as { mimetype?: string; size?: number };
    if (!meta.mimetype || !LOGO_TIPOS.includes(meta.mimetype) || !(Number(meta.size) > 0) || Number(meta.size) > LOGO_MAX_MB * 1024 * 1024) {
      await sb.storage.from("docs").remove([ruta]);
      return { ok: false, error: `El logo debe ser PNG, JPG o WebP de ${LOGO_MAX_MB} MB como mucho.` };
    }
    const { data, error } = await sb.storage.from("docs").createSignedUrl(ruta, LOGO_FIRMA_SEG);
    if (error || !data) return { ok: false, error: "No se ha podido generar el enlace del logo." };
    const { error: eU } = await sb.from("reservas_restaurantes").update({ logo_url: data.signedUrl }).eq("id", restId);
    if (eU) return { ok: false, error: eU.message };
    return { ok: true, data: { logo_url: data.signedUrl } };
  });
}

export async function quitarLogo(restId: string): Promise<R> {
  return escribir({ rest: restId }, async (sb) => {
    const { error } = await sb.from("reservas_restaurantes").update({ logo_url: null }).eq("id", restId);
    return error ? { ok: false, error: error.message } : { ok: true };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   TURNOS Y CUPOS
   ═══════════════════════════════════════════════════════════════════════════ */

export async function listarTurnos(restId: string): Promise<Turno[]> {
  const { sb } = await cliente();
  const { data } = await sb.from("reservas_turnos").select("*").eq("restaurante_id", restId).order("hora_inicio");
  return data ?? [];
}

export type CamposTurno = {
  nombre: string;
  hora_inicio: string;
  hora_fin: string;
  fin_servicio: string | null;
  intervalo_min: number;
  duracion_min: number;
  dias_semana: number[];
  max_pax_online: number;
  max_pax_total: number | null;
  max_reservas_intervalo: number | null;
  color: string | null;
  activo: boolean;
};

export async function guardarTurnoAjustes(turnoId: string | null, restId: string, c: CamposTurno): Promise<R<Turno>> {
  return escribir(turnoId ? { tabla: "reservas_turnos", id: turnoId } : { rest: restId }, async (sb) => {
    const nombre = txt(c.nombre, 40);
    const ini = h5(c.hora_inicio), fin = h5(c.hora_fin), finServ = c.fin_servicio ? h5(c.fin_servicio) : null;
    if (!nombre) return { ok: false, error: "El turno necesita un nombre." };
    if (!ini || !fin) return { ok: false, error: "Indica la primera y la última hora de reserva." };
    if (fin <= ini) return { ok: false, error: "La última hora debe ser posterior a la primera." };
    if (finServ && finServ < fin) return { ok: false, error: "El fin de servicio no puede ser anterior a la última hora de reserva." };
    const ds = dias(c.dias_semana);
    if (!ds.length) return { ok: false, error: "Marca al menos un día de la semana." };
    const fila = {
      nombre,
      hora_inicio: ini,
      hora_fin: fin,
      fin_servicio: finServ,
      intervalo_min: ent(c.intervalo_min, 15, 5, 120),
      duracion_min: ent(c.duracion_min, 120, 15, 600),
      dias_semana: ds,
      max_pax_online: ent(c.max_pax_online, 8, 1, 500),
      max_pax_total: entONulo(c.max_pax_total, 1, 5000),
      max_reservas_intervalo: entONulo(c.max_reservas_intervalo, 1, 500),
      color: hex(c.color, null),
      activo: !!c.activo,
    };
    const res = turnoId
      ? await sb.from("reservas_turnos").update(fila).eq("id", turnoId).select("*").single()
      : await sb.from("reservas_turnos").insert({ ...fila, restaurante_id: restId }).select("*").single();
    if (res.error) return { ok: false, error: legible(res.error, "Ya hay un turno con ese nombre.") };
    return { ok: true, data: res.data };
  });
}

/** Borra el turno si no tiene reservas; si las tiene, lo desactiva (hay historial que lo referencia). */
export async function borrarTurno(turnoId: string): Promise<R<{ desactivado: boolean }>> {
  return escribir<{ desactivado: boolean }>({ tabla: "reservas_turnos", id: turnoId }, async (sb) => {
    const { count, error: eC } = await sb.from("reservas_reservas").select("id", { count: "exact", head: true }).eq("turno_id", turnoId);
    if (eC) return { ok: false, error: "No se ha podido comprobar si está en uso. Vuelve a intentarlo." };
    if (count && count > 0) {
      const { error } = await sb.from("reservas_turnos").update({ activo: false }).eq("id", turnoId);
      return error ? { ok: false, error: error.message } : { ok: true, data: { desactivado: true } };
    }
    const { error } = await sb.from("reservas_turnos").delete().eq("id", turnoId);
    if (error) {
      if (error.code === "23503") {
        const { error: e2 } = await sb.from("reservas_turnos").update({ activo: false }).eq("id", turnoId);
        return e2 ? { ok: false, error: e2.message } : { ok: true, data: { desactivado: true } };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true, data: { desactivado: false } };
  });
}

/** Cupos por fecha (excepciones) y cierres del esquema antiguo, desde una fecha. */
export async function listarCupos(restId: string, desde: string, hasta: string): Promise<{ cupos: Cupo[]; cierres: Cierre[] }> {
  const { sb } = await cliente();
  const [c, z] = await Promise.all([
    sb.from("reservas_cupos").select("*").eq("restaurante_id", restId).gte("fecha", desde).lte("fecha", hasta).order("fecha").order("turno_id"),
    sb.from("reservas_cierres").select("*, reservas_turnos(nombre)").eq("restaurante_id", restId).gte("fecha", desde).lte("fecha", hasta).order("fecha"),
  ]);
  return { cupos: c.data ?? [], cierres: (z.data ?? []) as Cierre[] };
}

export type CamposCupo = { cerrado: boolean; max_pax_online: number | null; max_pax_total: number | null; nota: string | null };

/** Crea o actualiza la excepción de un día (y turno, o día completo si turnoId es null). */
export async function guardarCupoAjustes(restId: string, fecha: string, turnoId: string | null, c: CamposCupo): Promise<R<Cupo>> {
  return escribir({ rest: restId }, async (sb) => {
    if (!FECHA.test(fecha)) return { ok: false, error: "Fecha no válida." };
    let q = sb.from("reservas_cupos").select("id").eq("restaurante_id", restId).eq("fecha", fecha);
    q = turnoId ? q.eq("turno_id", turnoId) : q.is("turno_id", null);
    const { data: existe } = await q.maybeSingle();
    const fila = {
      cerrado: !!c.cerrado,
      max_pax_online: entONulo(c.max_pax_online, 0, 5000),
      max_pax_total: entONulo(c.max_pax_total, 0, 5000),
      nota: txt(c.nota, 200),
      actualizado_en: new Date().toISOString(),
    };
    const res = existe
      ? await sb.from("reservas_cupos").update(fila).eq("id", existe.id).select("*").single()
      : await sb.from("reservas_cupos").insert({ ...fila, restaurante_id: restId, fecha, turno_id: turnoId }).select("*").single();
    if (res.error) return { ok: false, error: res.error.message };
    // Al abrir, retiramos el cierre antiguo equivalente (la disponibilidad lo sigue mirando).
    if (!fila.cerrado) {
      let d = sb.from("reservas_cierres").delete().eq("restaurante_id", restId).eq("fecha", fecha);
      d = turnoId ? d.eq("turno_id", turnoId) : d.is("turno_id", null);
      await d;
    }
    return { ok: true, data: res.data };
  });
}

export async function borrarCupo(id: string): Promise<R> {
  return escribir({ tabla: "reservas_cupos", id }, async (sb) => {
    const { error } = await sb.from("reservas_cupos").delete().eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  });
}

export async function borrarCierreAjustes(id: string): Promise<R> {
  return escribir({ tabla: "reservas_cierres", id }, async (sb) => {
    const { error } = await sb.from("reservas_cierres").delete().eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   SALAS Y MESAS
   ═══════════════════════════════════════════════════════════════════════════ */

export async function listarSalas(restId: string): Promise<Sala[]> {
  const { sb } = await cliente();
  const { data } = await sb.from("reservas_salas").select("*, mesas:reservas_mesas(*)").eq("restaurante_id", restId).order("orden").order("nombre");
  return ((data ?? []) as unknown as Sala[]).map((s) => ({ ...s, mesas: [...(s.mesas ?? [])].sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true })) }));
}

export type CamposSala = {
  nombre: string;
  activa: boolean;
  reservable_online: boolean;
  color: string | null;
  prioridad: number;
  ancho: number;
  alto: number;
  fondo: string;
};

export async function guardarSalaAjustes(salaId: string | null, restId: string, c: CamposSala, ordenNueva?: number): Promise<R<Sala>> {
  return escribir(salaId ? { sala: salaId } : { rest: restId }, async (sb) => {
    const nombre = txt(c.nombre, 40);
    if (!nombre) return { ok: false, error: "La sala necesita un nombre." };
    const fila = {
      nombre,
      activa: !!c.activa,
      reservable_online: !!c.reservable_online,
      color: hex(c.color, null),
      prioridad: ent(c.prioridad, 100, 1, 999),
      ancho: ent(c.ancho, 100, 40, 400),
      alto: ent(c.alto, 70, 30, 400),
      fondo: c.fondo === "claro" ? "claro" : "oscuro",
    };
    const res = salaId
      ? await sb.from("reservas_salas").update(fila).eq("id", salaId).select("*, mesas:reservas_mesas(*)").single()
      : await sb.from("reservas_salas").insert({ ...fila, restaurante_id: restId, orden: ent(ordenNueva, 100, 0, 999) }).select("*, mesas:reservas_mesas(*)").single();
    if (res.error) return { ok: false, error: legible(res.error, "Ya hay una sala con ese nombre.") };
    return { ok: true, data: res.data as unknown as Sala };
  });
}

/** Orden de las pestañas de sala: la posición en la lista es el orden. */
export async function ordenarSalas(ids: string[]): Promise<R> {
  return escribir({ tabla: "reservas_salas", ids }, async (sb) => {
    for (let i = 0; i < ids.length; i++) {
      const { error } = await sb.from("reservas_salas").update({ orden: i + 1 }).eq("id", ids[i]);
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true };
  });
}

/** Solo se borra una sala sin mesas; con mesas (tienen historial) se desactiva. */
export async function borrarSala(salaId: string): Promise<R<{ desactivada: boolean }>> {
  return escribir<{ desactivada: boolean }>({ sala: salaId }, async (sb) => {
    const { count, error: eC } = await sb.from("reservas_mesas").select("id", { count: "exact", head: true }).eq("sala_id", salaId);
    if (eC) return { ok: false, error: "No se ha podido comprobar si está en uso. Vuelve a intentarlo." };
    if (count && count > 0) {
      const { error } = await sb.from("reservas_salas").update({ activa: false }).eq("id", salaId);
      return error ? { ok: false, error: error.message } : { ok: true, data: { desactivada: true } };
    }
    await sb.from("reservas_plano_objetos").delete().eq("sala_id", salaId);
    const { error } = await sb.from("reservas_salas").delete().eq("id", salaId);
    if (error) return { ok: false, error: legible(error, "", "No se puede borrar: hay reservas que la tienen como zona preferida. Desactívala.") };
    return { ok: true, data: { desactivada: false } };
  });
}

export type CamposMesa = Partial<{
  nombre: string;
  etiqueta: string | null;
  cap_min: number;
  cap_max: number;
  forma: string;
  tipo: string;
  prioridad: number;
  unible: boolean;
  reservable_online: boolean;
  activa: boolean;
  color: string | null;
}>;

const FORMAS = ["redonda", "cuadrada", "rectangular"];
const TIPOS_MESA = ["mesa", "barra", "alta"];

/** Edición en línea de una mesa: solo los campos que llegan. */
export async function guardarMesaAjustes(mesaId: string, c: CamposMesa): Promise<R<Mesa>> {
  return escribir({ mesa: mesaId }, async (sb) => {
    const u: TablesUpdate<"reservas_mesas"> = {};
    if (c.nombre !== undefined) {
      const n = txt(c.nombre, 40);
      if (!n) return { ok: false, error: "La mesa necesita un nombre." };
      u.nombre = n;
    }
    if (c.etiqueta !== undefined) u.etiqueta = txt(c.etiqueta, 12);
    if (c.cap_min !== undefined) u.cap_min = ent(c.cap_min, 1, 1, 200);
    if (c.cap_max !== undefined) u.cap_max = ent(c.cap_max, 2, 1, 200);
    if (c.forma !== undefined && FORMAS.includes(c.forma)) u.forma = c.forma;
    if (c.tipo !== undefined && TIPOS_MESA.includes(c.tipo)) u.tipo = c.tipo;
    if (c.prioridad !== undefined) u.prioridad = ent(c.prioridad, 100, 1, 999);
    if (c.unible !== undefined) u.unible = !!c.unible;
    if (c.reservable_online !== undefined) u.reservable_online = !!c.reservable_online;
    if (c.activa !== undefined) u.activa = !!c.activa;
    if (c.color !== undefined) u.color = hex(c.color, null);
    if (!Object.keys(u).length) return { ok: false, error: "No hay nada que guardar." };
    // Coherencia mín ≤ máx con lo que ya hay en la fila
    if (u.cap_min !== undefined || u.cap_max !== undefined) {
      const { data: actual } = await sb.from("reservas_mesas").select("cap_min, cap_max").eq("id", mesaId).maybeSingle();
      const min = u.cap_min ?? actual?.cap_min ?? 1, max = u.cap_max ?? actual?.cap_max ?? 2;
      if (min > max) return { ok: false, error: "La capacidad mínima no puede superar la máxima." };
    }
    const { data, error } = await sb.from("reservas_mesas").update(u).eq("id", mesaId).select("*").single();
    if (error) return { ok: false, error: legible(error, "Ya hay una mesa con ese nombre en la sala.") };
    return { ok: true, data };
  });
}

export async function crearMesaAjustes(salaId: string, c: { nombre: string; cap_min: number; cap_max: number; forma: string; tipo: string }): Promise<R<Mesa>> {
  return escribir({ sala: salaId }, async (sb) => {
    const nombre = txt(c.nombre, 40);
    if (!nombre) return { ok: false, error: "La mesa necesita un nombre." };
    const min = ent(c.cap_min, 1, 1, 200), max = ent(c.cap_max, 2, 1, 200);
    if (min > max) return { ok: false, error: "La capacidad mínima no puede superar la máxima." };
    const { data: sala } = await sb.from("reservas_salas").select("ancho, alto").eq("id", salaId).maybeSingle();
    const fila: TablesInsert<"reservas_mesas"> = {
      sala_id: salaId,
      nombre,
      cap_min: min,
      cap_max: max,
      forma: FORMAS.includes(c.forma) ? c.forma : "cuadrada",
      tipo: TIPOS_MESA.includes(c.tipo) ? c.tipo : "mesa",
      // Se deja en una esquina libre del lienzo; el editor del plano la coloca después.
      pos_x: Math.round((sala?.ancho ?? 100) * 0.1),
      pos_y: Math.round((sala?.alto ?? 70) * 0.1),
    };
    const { data, error } = await sb.from("reservas_mesas").insert(fila).select("*").single();
    if (error) return { ok: false, error: legible(error, "Ya hay una mesa con ese nombre en la sala.") };
    return { ok: true, data };
  });
}

/* ---- combinaciones habituales ---- */

export async function listarCombinaciones(restId: string): Promise<Combinacion[]> {
  const { sb } = await cliente();
  const { data } = await sb.from("reservas_mesas_combinaciones").select("*").eq("restaurante_id", restId).order("prioridad").order("nombre");
  return data ?? [];
}

export type CamposCombinacion = { nombre: string; mesas: string[]; pax_min: number; pax_max: number; prioridad: number; activa: boolean };

export async function guardarCombinacion(id: string | null, restId: string, c: CamposCombinacion): Promise<R<Combinacion>> {
  return escribir(id ? { tabla: "reservas_mesas_combinaciones", id } : { rest: restId }, async (sb) => {
    const nombre = txt(c.nombre, 60);
    const mesas = [...new Set((c.mesas ?? []).filter((x) => typeof x === "string" && x))];
    if (!nombre) return { ok: false, error: "La combinación necesita un nombre (p. ej. «T3+T4»)." };
    if (mesas.length < 2) return { ok: false, error: "Elige al menos dos mesas." };
    const min = ent(c.pax_min, 1, 1, 500), max = ent(c.pax_max, 8, 1, 500);
    if (min > max) return { ok: false, error: "El mínimo de personas no puede superar el máximo." };
    // Las mesas tienen que ser del restaurante de la combinación.
    let restDestino = restId;
    if (id) {
      const { data: actual } = await sb.from("reservas_mesas_combinaciones").select("restaurante_id").eq("id", id).maybeSingle();
      if (!actual) return { ok: false, error: "Combinación no encontrada." };
      restDestino = actual.restaurante_id;
    }
    const { data: salasR } = await sb.from("reservas_salas").select("mesas:reservas_mesas(id)").eq("restaurante_id", restDestino);
    const propias = new Set((salasR ?? []).flatMap((s) => (s.mesas ?? []).map((m) => m.id)));
    if (!mesas.every((m) => propias.has(m))) return { ok: false, error: "Alguna mesa no es de este restaurante." };
    const fila = { nombre, mesas, pax_min: min, pax_max: max, prioridad: ent(c.prioridad, 100, 1, 999), activa: !!c.activa };
    const res = id
      ? await sb.from("reservas_mesas_combinaciones").update(fila).eq("id", id).select("*").single()
      : await sb.from("reservas_mesas_combinaciones").insert({ ...fila, restaurante_id: restId }).select("*").single();
    if (res.error) return { ok: false, error: legible(res.error, "Ya hay una combinación con ese nombre.") };
    return { ok: true, data: res.data };
  });
}

export async function borrarCombinacion(id: string): Promise<R> {
  return escribir({ tabla: "reservas_mesas_combinaciones", id }, async (sb) => {
    const { error } = await sb.from("reservas_mesas_combinaciones").delete().eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   ETIQUETAS (reserva · cliente · alérgeno)
   ═══════════════════════════════════════════════════════════════════════════ */

const AMBITOS = ["reserva", "cliente", "alergeno"];

export async function listarEtiquetas(): Promise<Etiqueta[]> {
  const { sb } = await cliente();
  const { data } = await sb.from("reservas_etiquetas").select("*").order("ambito").order("orden").order("nombre");
  return data ?? [];
}

export async function guardarEtiqueta(id: string | null, c: { ambito: string; nombre: string; color: string; orden: number; activa: boolean }): Promise<R<Etiqueta>> {
  return escribir("cuenta", async (sb) => {
    const nombre = txt(c.nombre, 40);
    if (!nombre) return { ok: false, error: "La etiqueta necesita un nombre." };
    if (!AMBITOS.includes(c.ambito)) return { ok: false, error: "Ámbito no válido." };
    const fila = { ambito: c.ambito, nombre, color: hex(c.color, "#888888") as string, orden: ent(c.orden, 100, 0, 999), activa: !!c.activa };
    const res = id
      ? await sb.from("reservas_etiquetas").update(fila).eq("id", id).select("*").single()
      : await sb.from("reservas_etiquetas").insert(fila).select("*").single();
    if (res.error) return { ok: false, error: legible(res.error, "Ya existe una etiqueta con ese nombre en ese ámbito.") };
    return { ok: true, data: res.data };
  });
}

/** Orden dentro de un ámbito: la posición en la lista es el orden. */
export async function ordenarEtiquetas(ids: string[]): Promise<R> {
  return escribir("cuenta", async (sb) => {
    for (let i = 0; i < ids.length; i++) {
      const { error } = await sb.from("reservas_etiquetas").update({ orden: (i + 1) * 10 }).eq("id", ids[i]);
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true };
  });
}

/** Las etiquetas viven en arrays uuid[] de clientes y reservas (sin FK): borrar deja huérfanos
    silenciosos, así que se desactiva. Solo se borra de verdad si nadie la usa. */
export async function borrarEtiqueta(id: string): Promise<R<{ desactivada: boolean }>> {
  return escribir<{ desactivada: boolean }>("cuenta", async (sb) => {
    if (!esUuid(id)) return { ok: false, error: "Etiqueta no válida." };
    const [cl, rs, at] = await Promise.all([
      sb.from("reservas_clientes").select("id", { count: "exact", head: true }).or(`etiquetas.cs.{${id}},alergenos.cs.{${id}}`),
      sb.from("reservas_reservas").select("id", { count: "exact", head: true }).contains("etiquetas", [id]),
      sb.from("reservas_autotags").select("id", { count: "exact", head: true }).eq("etiqueta_id", id),
    ]);
    // Sin FK que haga de red: si cualquier conteo falla, no se borra.
    if (cl.error || rs.error || at.error) return { ok: false, error: "No se ha podido comprobar si está en uso. Vuelve a intentarlo." };
    const usos = (cl.count ?? 0) + (rs.count ?? 0) + (at.count ?? 0);
    if (usos > 0) {
      const { error } = await sb.from("reservas_etiquetas").update({ activa: false }).eq("id", id);
      return error ? { ok: false, error: error.message } : { ok: true, data: { desactivada: true } };
    }
    const { error } = await sb.from("reservas_etiquetas").delete().eq("id", id);
    return error ? { ok: false, error: legible(error) } : { ok: true, data: { desactivada: false } };
  });
}

/* ---- etiquetas automáticas (reservas_autotags; las aplica el cron con reservas_aplicar_autotags) ---- */

export type Autotag = Tables<"reservas_autotags">;
const CONDICIONES_AUTOTAG = ["no_show", "cancelar", "asistir"];
const OPERADORES_AUTOTAG = [">=", "=", "<="];

export async function listarAutotags(): Promise<Autotag[]> {
  const { sb } = await cliente();
  const { data } = await sb.from("reservas_autotags").select("*").order("creado_en");
  return data ?? [];
}

export type CamposAutotag = { condicion: string; operador: string; n: number; periodo_dias: number; etiqueta_id: string; activa: boolean };

export async function guardarAutotag(id: string | null, c: CamposAutotag): Promise<R<Autotag>> {
  return escribir("cuenta", async (sb) => {
    if (!CONDICIONES_AUTOTAG.includes(c.condicion)) return { ok: false, error: "Condición no válida." };
    if (!OPERADORES_AUTOTAG.includes(c.operador)) return { ok: false, error: "Operador no válido." };
    if (!esUuid(c.etiqueta_id)) return { ok: false, error: "Elige la etiqueta que se pondrá al cliente." };
    // Solo etiquetas de cliente: el cron las añade a reservas_clientes.etiquetas.
    const { data: et } = await sb.from("reservas_etiquetas").select("id, ambito").eq("id", c.etiqueta_id).maybeSingle();
    if (!et || et.ambito !== "cliente") return { ok: false, error: "La etiqueta tiene que ser de cliente." };
    const fila = {
      condicion: c.condicion,
      operador: c.operador,
      n: ent(c.n, 1, 0, 1000),
      periodo_dias: ent(c.periodo_dias, 365, 1, 3650),
      etiqueta_id: c.etiqueta_id,
      activa: !!c.activa,
    };
    if (id && !esUuid(id)) return { ok: false, error: "Regla no válida." };
    const res = id
      ? await sb.from("reservas_autotags").update(fila).eq("id", id).select("*").single()
      : await sb.from("reservas_autotags").insert(fila).select("*").single();
    if (res.error) return { ok: false, error: legible(res.error) };
    return { ok: true, data: res.data };
  });
}

export async function borrarAutotag(id: string): Promise<R> {
  return escribir("cuenta", async (sb) => {
    if (!esUuid(id)) return { ok: false, error: "Regla no válida." };
    const { error } = await sb.from("reservas_autotags").delete().eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   PRESCRIPTORES
   ═══════════════════════════════════════════════════════════════════════════ */

const TIPOS_PRESCRIPTOR = ["hotel", "agencia", "empresa", "canal", "otro"];

export async function listarPrescriptores(): Promise<Prescriptor[]> {
  const { sb } = await cliente();
  const { data } = await sb.from("reservas_prescriptores").select("*").order("activo", { ascending: false }).order("nombre");
  return data ?? [];
}

export type CamposPrescriptor = { nombre: string; tipo: string; telefono: string | null; email: string | null; comision_pct: number | null; slug: string | null; notas: string | null; activo: boolean };

export async function guardarPrescriptor(id: string | null, c: CamposPrescriptor): Promise<R<Prescriptor>> {
  return escribir("cuenta", async (sb) => {
    const nombre = txt(c.nombre, 80);
    if (!nombre) return { ok: false, error: "El prescriptor necesita un nombre." };
    const email = txt(c.email, 120);
    if (email && !EMAIL.test(email)) return { ok: false, error: "El email no es válido." };
    const slug = c.slug ? slugDe(String(c.slug)) : slugDe(nombre);
    const fila = {
      nombre,
      tipo: TIPOS_PRESCRIPTOR.includes(c.tipo) ? c.tipo : "otro",
      telefono: txt(c.telefono, 40),
      email,
      comision_pct: decONulo(c.comision_pct, 0, 100),
      slug,
      notas: txt(c.notas, 400),
      activo: !!c.activo,
    };
    const res = id
      ? await sb.from("reservas_prescriptores").update(fila).eq("id", id).select("*").single()
      : await sb.from("reservas_prescriptores").insert(fila).select("*").single();
    if (res.error) return { ok: false, error: legible(res.error, "Ya hay un prescriptor con ese nombre o ese enlace (slug).") };
    return { ok: true, data: res.data };
  });
}

/** Con reservas o clientes asociados se desactiva; si no, se borra. */
export async function borrarPrescriptor(id: string): Promise<R<{ desactivado: boolean }>> {
  return escribir<{ desactivado: boolean }>("cuenta", async (sb) => {
    if (!esUuid(id)) return { ok: false, error: "Prescriptor no válido." };
    const [rs, cl] = await Promise.all([
      sb.from("reservas_reservas").select("id", { count: "exact", head: true }).eq("prescriptor_id", id),
      sb.from("reservas_clientes").select("id", { count: "exact", head: true }).eq("prescriptor_id", id),
    ]);
    if (rs.error || cl.error) return { ok: false, error: "No se ha podido comprobar si está en uso. Vuelve a intentarlo." };
    if ((rs.count ?? 0) + (cl.count ?? 0) > 0) {
      const { error } = await sb.from("reservas_prescriptores").update({ activo: false }).eq("id", id);
      return error ? { ok: false, error: error.message } : { ok: true, data: { desactivado: true } };
    }
    const { error } = await sb.from("reservas_prescriptores").delete().eq("id", id);
    if (error?.code === "23503") {
      const { error: e2 } = await sb.from("reservas_prescriptores").update({ activo: false }).eq("id", id);
      return e2 ? { ok: false, error: e2.message } : { ok: true, data: { desactivado: true } };
    }
    return error ? { ok: false, error: error.message } : { ok: true, data: { desactivado: false } };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXPERIENCIAS
   ═══════════════════════════════════════════════════════════════════════════ */

export async function listarExperiencias(restId: string): Promise<Experiencia[]> {
  const { sb } = await cliente();
  const { data } = await sb.from("reservas_experiencias").select("*").eq("restaurante_id", restId).order("orden").order("nombre");
  return data ?? [];
}

export type CamposExperiencia = {
  nombre: string;
  descripcion: string | null;
  precio_pax: number | null;
  requiere_prepago: boolean;
  pax_min: number;
  pax_max: number | null;
  turnos: string[] | null;
  dias_semana: number[] | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  activa: boolean;
  orden: number;
  imagen_url: string | null;
};

export async function guardarExperiencia(id: string | null, restId: string, c: CamposExperiencia): Promise<R<Experiencia>> {
  return escribir(id ? { tabla: "reservas_experiencias", id } : { rest: restId }, async (sb) => {
    const nombre = txt(c.nombre, 80);
    if (!nombre) return { ok: false, error: "La experiencia necesita un nombre." };
    const min = ent(c.pax_min, 1, 1, 500), max = entONulo(c.pax_max, 1, 500);
    if (max !== null && max < min) return { ok: false, error: "El máximo de personas no puede ser menor que el mínimo." };
    const desde = c.fecha_desde && FECHA.test(c.fecha_desde) ? c.fecha_desde : null;
    const hasta = c.fecha_hasta && FECHA.test(c.fecha_hasta) ? c.fecha_hasta : null;
    if (desde && hasta && hasta < desde) return { ok: false, error: "La fecha de fin no puede ser anterior a la de inicio." };
    const precio = decONulo(c.precio_pax, 0, 100000);
    if (c.requiere_prepago && !precio) return { ok: false, error: "Para exigir prepago la experiencia necesita un precio por persona." };
    const turnos = Array.isArray(c.turnos) ? c.turnos.filter((x) => typeof x === "string" && x) : [];
    const ds = Array.isArray(c.dias_semana) ? dias(c.dias_semana) : [];
    const fila = {
      nombre,
      descripcion: txt(c.descripcion, 1000),
      precio_pax: precio,
      requiere_prepago: !!c.requiere_prepago,
      pax_min: min,
      pax_max: max,
      turnos: turnos.length ? turnos : null,
      dias_semana: ds.length && ds.length < 7 ? ds : null,
      fecha_desde: desde,
      fecha_hasta: hasta,
      activa: !!c.activa,
      orden: ent(c.orden, 100, 0, 999),
      imagen_url: url(c.imagen_url),
    };
    const res = id
      ? await sb.from("reservas_experiencias").update(fila).eq("id", id).select("*").single()
      : await sb.from("reservas_experiencias").insert({ ...fila, restaurante_id: restId }).select("*").single();
    if (res.error) return { ok: false, error: legible(res.error, "Ya hay una experiencia con ese nombre.") };
    return { ok: true, data: res.data };
  });
}

export async function borrarExperiencia(id: string): Promise<R<{ desactivada: boolean }>> {
  return escribir<{ desactivada: boolean }>({ tabla: "reservas_experiencias", id }, async (sb) => {
    const { count, error: eC } = await sb.from("reservas_reservas").select("id", { count: "exact", head: true }).eq("experiencia_id", id);
    if (eC) return { ok: false, error: "No se ha podido comprobar si está en uso. Vuelve a intentarlo." };
    if (count && count > 0) {
      const { error } = await sb.from("reservas_experiencias").update({ activa: false }).eq("id", id);
      return error ? { ok: false, error: error.message } : { ok: true, data: { desactivada: true } };
    }
    const { error } = await sb.from("reservas_experiencias").delete().eq("id", id);
    if (error?.code === "23503") {
      const { error: e2 } = await sb.from("reservas_experiencias").update({ activa: false }).eq("id", id);
      return e2 ? { ok: false, error: e2.message } : { ok: true, data: { desactivada: true } };
    }
    return error ? { ok: false, error: error.message } : { ok: true, data: { desactivada: false } };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   MENSAJES (plantillas por tipo × canal × idioma)
   ═══════════════════════════════════════════════════════════════════════════ */

const TIPOS_PLANTILLA_LISTA = ["confirmacion", "confirmada", "recordatorio", "reconfirmacion", "cancelacion", "modificacion", "lista_espera", "valoracion", "pago", "garantia", "noshow", "invitacion"];
const CANALES = ["email", "sms", "whatsapp"];

/** Plantillas de la cuenta (restaurante_id null) y las propias del restaurante. */
export async function listarPlantillas(restId: string): Promise<Plantilla[]> {
  if (!esUuid(restId)) return [];
  const { sb } = await cliente();
  const { data } = await sb
    .from("reservas_plantillas")
    .select("*")
    .or(`restaurante_id.is.null,restaurante_id.eq.${restId}`)
    .order("tipo")
    .order("canal")
    .order("idioma");
  return data ?? [];
}

export type CamposPlantilla = { restaurante_id: string | null; canal: string; tipo: string; idioma: string; asunto: string | null; cuerpo: string; activa: boolean };

/** Crea o actualiza. Si llega sin id y ya existe la misma (restaurante, canal, tipo, idioma), la actualiza. */
export async function guardarPlantilla(id: string | null, c: CamposPlantilla): Promise<R<Plantilla>> {
  return escribir(c.restaurante_id ? { rest: c.restaurante_id } : "cuenta", async (sb) => {
    if (!CANALES.includes(c.canal)) return { ok: false, error: "Canal no válido." };
    if (!TIPOS_PLANTILLA_LISTA.includes(c.tipo)) return { ok: false, error: "Tipo de mensaje no válido." };
    const idioma = (c.idioma || "es").toLowerCase().slice(0, 2);
    const cuerpo = typeof c.cuerpo === "string" ? c.cuerpo.trim() : "";
    if (!cuerpo) return { ok: false, error: "El mensaje no puede estar vacío." };
    if (c.canal === "sms" && cuerpo.length > 480) return { ok: false, error: "Un SMS no debería pasar de 480 caracteres (3 segmentos)." };
    const fila = { restaurante_id: c.restaurante_id || null, canal: c.canal, tipo: c.tipo, idioma, asunto: c.canal === "email" ? txt(c.asunto, 200) : null, cuerpo: cuerpo.slice(0, 5000), activa: !!c.activa, actualizado_en: new Date().toISOString() };
    let destino = id;
    if (destino) {
      // Editar por id no puede mover la plantilla de ámbito (restaurante ↔ cuenta): se comprobó el permiso del destino.
      const { data: actual } = await sb.from("reservas_plantillas").select("restaurante_id").eq("id", destino).maybeSingle();
      if (!actual) return { ok: false, error: "Plantilla no encontrada." };
      if ((actual.restaurante_id ?? null) !== fila.restaurante_id) destino = null;
    }
    if (!destino) {
      let q = sb.from("reservas_plantillas").select("id").eq("canal", fila.canal).eq("tipo", fila.tipo).eq("idioma", idioma);
      q = fila.restaurante_id ? q.eq("restaurante_id", fila.restaurante_id) : q.is("restaurante_id", null);
      const { data: ex } = await q.maybeSingle();
      destino = ex?.id ?? null;
    }
    const res = destino
      ? await sb.from("reservas_plantillas").update(fila).eq("id", destino).select("*").single()
      : await sb.from("reservas_plantillas").insert(fila).select("*").single();
    if (res.error) return { ok: false, error: legible(res.error, "Ya existe esa plantilla.") };
    return { ok: true, data: res.data };
  });
}

/** Borra una plantilla propia del restaurante (vuelve a usarse la de la cuenta). Las de cuenta no se borran. */
export async function borrarPlantilla(id: string): Promise<R> {
  return escribir({ tabla: "reservas_plantillas", id }, async (sb) => {
    const { data } = await sb.from("reservas_plantillas").select("restaurante_id").eq("id", id).maybeSingle();
    if (!data) return { ok: false, error: "Plantilla no encontrada." };
    if (!data.restaurante_id) return { ok: false, error: "La plantilla de la cuenta no se borra: edítala o desactívala." };
    const { error } = await sb.from("reservas_plantillas").delete().eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  });
}

/** Vista previa con datos de ejemplo del restaurante (misma función SQL que usa el envío real). */
export async function previsualizarPlantilla(restId: string, asunto: string | null, cuerpo: string): Promise<R<{ asunto: string; cuerpo: string }>> {
  if (!esUuid(restId)) return { ok: false, error: "Restaurante no válido." };
  const { sb } = await cliente();
  const { data: r } = await sb.from("reservas_restaurantes").select("nombre, direccion, telefono, politica_cancelacion_horas, garantia_importe_pax, mensaje_widget, url_base, slug").eq("id", restId).maybeSingle();
  const base = (r?.url_base || "https://hostelero-app.vercel.app").replace(/\/+$/, "");
  const hoy = new Date();
  hoy.setDate(hoy.getDate() + 3);
  const fecha = hoy.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  const vars: Record<string, string> = {
    nombre: "Marta",
    nombre_completo: "Marta Ejemplo",
    restaurante: r?.nombre ?? "Restaurante",
    fecha,
    hora: "13:30",
    pax: "4",
    localizador: "ABC123",
    enlace: `${base}/reserva/ejemplo`,
    enlace_cancelar: `${base}/reserva/ejemplo?cancelar=1`,
    enlace_confirmar: `${base}/reserva/ejemplo?confirmar=1`,
    enlace_pago: `${base}/reserva/ejemplo/pago`,
    enlace_valorar: `${base}/valorar/ejemplo`,
    direccion: r?.direccion ?? "",
    telefono: r?.telefono ?? "",
    mensaje: r?.mensaje_widget ?? "",
    // Sin «€»: las plantillas ya lo escriben («{{importe}} €»), igual que el envío real.
    importe: r?.garantia_importe_pax != null ? (Number(r.garantia_importe_pax) * 4).toFixed(2) : "",
    horas_politica: String(r?.politica_cancelacion_horas ?? 24),
  };
  const [a, b] = await Promise.all([
    asunto ? sb.rpc("reservas_renderizar", { p_texto: asunto, p_vars: vars }) : Promise.resolve({ data: "", error: null }),
    sb.rpc("reservas_renderizar", { p_texto: cuerpo, p_vars: vars }),
  ]);
  if (a.error || b.error) return { ok: false, error: (a.error || b.error)?.message };
  return { ok: true, data: { asunto: a.data ?? "", cuerpo: b.data ?? "" } };
}

/** Envía la plantilla de email, ya renderizada con datos de ejemplo, al correo del usuario que la pide. */
export async function enviarPruebaPlantilla(restId: string, asunto: string | null, cuerpo: string): Promise<R<{ para: string }>> {
  return escribir({ rest: restId }, async (sb, perfil) => {
    const vista = await previsualizarPlantilla(restId, asunto, cuerpo);
    if (!vista.ok || !vista.data) return { ok: false, error: vista.error };
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;white-space:pre-wrap">${esc(vista.data.cuerpo)}</div>`;
    const enviado = await enviarCorreo({ para: perfil.correo, asunto: `[Prueba] ${vista.data.asunto || "Plantilla de reservas"}`, html });
    if (!enviado) return { ok: false, error: "No se ha podido enviar: falta el proveedor de correo (RESEND_API_KEY) o ha fallado el envío." };
    void sb;
    return { ok: true, data: { para: perfil.correo } };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   PREGUNTAS DEL WIDGET
   ═══════════════════════════════════════════════════════════════════════════ */

const TIPOS_PREGUNTA = ["si_no", "texto", "desplegable", "multiple"];

export async function listarPreguntas(restId: string): Promise<Pregunta[]> {
  const { sb } = await cliente();
  const { data } = await sb.from("reservas_preguntas").select("*").eq("restaurante_id", restId).order("orden").order("creado_en");
  return data ?? [];
}

export type CamposPregunta = { texto: string; texto_en: string | null; tipo: string; opciones: string[] | null; obligatoria: boolean; orden: number; activa: boolean };

export async function guardarPregunta(id: string | null, restId: string, c: CamposPregunta): Promise<R<Pregunta>> {
  return escribir(id ? { tabla: "reservas_preguntas", id } : { rest: restId }, async (sb) => {
    const texto = txt(c.texto, 200);
    if (!texto) return { ok: false, error: "Escribe el texto de la pregunta." };
    const tipo = TIPOS_PREGUNTA.includes(c.tipo) ? c.tipo : "si_no";
    const opciones = (c.opciones ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 20);
    if ((tipo === "desplegable" || tipo === "multiple") && opciones.length < 2) return { ok: false, error: "Una pregunta con opciones necesita al menos dos." };
    const fila = { texto, texto_en: txt(c.texto_en, 200), tipo, opciones: tipo === "desplegable" || tipo === "multiple" ? opciones : null, obligatoria: !!c.obligatoria, orden: ent(c.orden, 100, 0, 999), activa: !!c.activa };
    const res = id
      ? await sb.from("reservas_preguntas").update(fila).eq("id", id).select("*").single()
      : await sb.from("reservas_preguntas").insert({ ...fila, restaurante_id: restId }).select("*").single();
    if (res.error) return { ok: false, error: legible(res.error) };
    return { ok: true, data: res.data };
  });
}

export async function ordenarPreguntas(ids: string[]): Promise<R> {
  return escribir({ tabla: "reservas_preguntas", ids }, async (sb) => {
    for (let i = 0; i < ids.length; i++) {
      const { error } = await sb.from("reservas_preguntas").update({ orden: (i + 1) * 10 }).eq("id", ids[i]);
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true };
  });
}

/** Las respuestas viven en reservas_reservas.respuestas (jsonb, sin FK): se puede borrar sin romper nada. */
export async function borrarPregunta(id: string): Promise<R> {
  return escribir({ tabla: "reservas_preguntas", id }, async (sb) => {
    const { error } = await sb.from("reservas_preguntas").delete().eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   PERMISOS (reservas_permisos_perfil) — solo dirección
   ═══════════════════════════════════════════════════════════════════════════ */

/** Perfiles de la cuenta (la RLS de perfiles solo deja leerlos a dirección) con su fila de permisos si la hay. */
export async function listarPermisos(): Promise<{ perfiles: PerfilMin[]; permisos: Permiso[]; soloLectura: boolean }> {
  const { sb, perfil } = await cliente();
  const [p, x] = await Promise.all([
    sb.from("perfiles").select("id, nombre, correo, rol").eq("cuenta_id", perfil.cuenta_id).order("nombre").order("correo"),
    sb.from("reservas_permisos_perfil").select("*"),
  ]);
  return { perfiles: (p.data ?? []) as PerfilMin[], permisos: x.data ?? [], soloLectura: perfil.rol !== "direccion" };
}

export type CamposPermiso = { puede_cobrar: boolean; puede_mover: boolean; puede_cambiar_estado: boolean; puede_editar_plano: boolean; puede_ajustes: boolean; restaurantes: string[] | null };

export async function guardarPermiso(perfilId: string, c: CamposPermiso): Promise<R<Permiso>> {
  try {
    const { sb, perfil } = await cliente();
    if (perfil.rol !== "direccion") return { ok: false, error: "Solo dirección puede cambiar los permisos." };
    if (!esUuid(perfilId)) return { ok: false, error: "Usuario no válido." };
    let rests = Array.isArray(c.restaurantes) ? c.restaurantes.filter(esUuid) : null;
    if (rests && rests.length) {
      // Solo restaurantes de la cuenta.
      const { data: propios } = await sb.from("reservas_restaurantes").select("id").eq("cuenta_id", perfil.cuenta_id).in("id", rests);
      const ok = new Set((propios ?? []).map((r) => r.id));
      rests = rests.filter((r) => ok.has(r));
      if (!rests.length) return { ok: false, error: "Elige al menos un restaurante de la cuenta." };
    }
    const fila = {
      puede_cobrar: !!c.puede_cobrar,
      puede_mover: !!c.puede_mover,
      puede_cambiar_estado: !!c.puede_cambiar_estado,
      puede_editar_plano: !!c.puede_editar_plano,
      puede_ajustes: !!c.puede_ajustes,
      restaurantes: rests && rests.length ? rests : null,
      actualizado_en: new Date().toISOString(),
    };
    const { data: ex } = await sb.from("reservas_permisos_perfil").select("id").eq("perfil_id", perfilId).maybeSingle();
    const res = ex
      ? await sb.from("reservas_permisos_perfil").update(fila).eq("id", ex.id).select("*").single()
      : await sb.from("reservas_permisos_perfil").insert({ ...fila, perfil_id: perfilId }).select("*").single();
    if (res.error) return { ok: false, error: res.error.message };
    return { ok: true, data: res.data };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: (e as Error).message };
  }
}

/** Quita la fila: el usuario vuelve a los permisos por defecto (todo salvo cobrar, plano y ajustes). */
export async function restablecerPermiso(perfilId: string): Promise<R> {
  try {
    const { sb, perfil } = await cliente();
    if (perfil.rol !== "direccion") return { ok: false, error: "Solo dirección puede cambiar los permisos." };
    if (!esUuid(perfilId)) return { ok: false, error: "Usuario no válido." };
    const { error } = await sb.from("reservas_permisos_perfil").delete().eq("perfil_id", perfilId);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: (e as Error).message };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CÓDIGOS PROMOCIONALES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Códigos de la cuenta (restaurante_id null = valen en todos) y los del restaurante. */
export async function listarCodigos(restId: string): Promise<Codigo[]> {
  if (!esUuid(restId)) return [];
  const { sb } = await cliente();
  const { data } = await sb
    .from("reservas_codigos")
    .select("*")
    .or(`restaurante_id.is.null,restaurante_id.eq.${restId}`)
    .order("activo", { ascending: false })
    .order("codigo");
  return data ?? [];
}

export type CamposCodigo = { codigo: string; descripcion: string | null; descuento_pct: number | null; descuento_importe: number | null; experiencia_id: string | null; valido_desde: string | null; valido_hasta: string | null; usos_max: number | null; activo: boolean; restaurante_id: string | null };

export async function guardarCodigo(id: string | null, c: CamposCodigo): Promise<R<Codigo>> {
  return escribir(c.restaurante_id ? { rest: c.restaurante_id } : "cuenta", async (sb, perfil) => {
    const codigo = (txt(c.codigo, 30) ?? "").toUpperCase().replace(/\s+/g, "");
    if (!codigo || !/^[A-Z0-9_-]{3,30}$/.test(codigo)) return { ok: false, error: "El código: de 3 a 30 letras o números, sin espacios." };
    const pct = decONulo(c.descuento_pct, 0, 100), imp = decONulo(c.descuento_importe, 0, 100000);
    if (pct && imp) return { ok: false, error: "Elige un descuento en porcentaje o en importe, no los dos." };
    const desde = c.valido_desde && FECHA.test(c.valido_desde) ? c.valido_desde : null;
    const hasta = c.valido_hasta && FECHA.test(c.valido_hasta) ? c.valido_hasta : null;
    if (desde && hasta && hasta < desde) return { ok: false, error: "La fecha de fin no puede ser anterior a la de inicio." };
    const fila = {
      codigo,
      descripcion: txt(c.descripcion, 200),
      descuento_pct: pct,
      descuento_importe: imp,
      experiencia_id: c.experiencia_id || null,
      valido_desde: desde,
      valido_hasta: hasta,
      usos_max: entONulo(c.usos_max, 1, 100000),
      activo: !!c.activo,
      restaurante_id: c.restaurante_id || null,
    };
    if (id) {
      // Cambiar el ámbito (restaurante ↔ todos) exige permiso también sobre el ámbito actual.
      const motivo = await comprobar(sb, perfil, { tabla: "reservas_codigos", id });
      if (motivo) return { ok: false, error: motivo };
    }
    const res = id
      ? await sb.from("reservas_codigos").update(fila).eq("id", id).select("*").single()
      : await sb.from("reservas_codigos").insert(fila).select("*").single();
    if (res.error) return { ok: false, error: legible(res.error, "Ya existe ese código.") };
    return { ok: true, data: res.data };
  });
}

export async function borrarCodigo(id: string): Promise<R> {
  return escribir({ tabla: "reservas_codigos", id }, async (sb) => {
    const { error } = await sb.from("reservas_codigos").delete().eq("id", id);
    return error ? { ok: false, error: legible(error, "", "No se puede borrar: ya se ha usado en reservas. Desactívalo.") } : { ok: true };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAMAREROS (y asignación por mesa y día)
   ═══════════════════════════════════════════════════════════════════════════ */

export async function listarCamareros(restId: string): Promise<Camarero[]> {
  const { sb } = await cliente();
  const { data } = await sb.from("reservas_camareros").select("*").eq("restaurante_id", restId).order("activo", { ascending: false }).order("nombre");
  return data ?? [];
}

export async function guardarCamarero(id: string | null, restId: string, c: { nombre: string; color: string; activo: boolean; empleado_id?: string | null }): Promise<R<Camarero>> {
  return escribir(id ? { tabla: "reservas_camareros", id } : { rest: restId }, async (sb) => {
    const nombre = txt(c.nombre, 60);
    if (!nombre) return { ok: false, error: "El camarero necesita un nombre." };
    // empleado_id solo se toca si llega (undefined = dejar el vínculo como está).
    const fila: { nombre: string; color: string; activo: boolean; empleado_id?: string | null } = { nombre, color: hex(c.color, "#888888") as string, activo: !!c.activo };
    if (c.empleado_id !== undefined) fila.empleado_id = c.empleado_id || null;
    const res = id
      ? await sb.from("reservas_camareros").update(fila).eq("id", id).select("*").single()
      : await sb.from("reservas_camareros").insert({ ...fila, restaurante_id: restId }).select("*").single();
    if (res.error) return { ok: false, error: legible(res.error, "Ya hay un camarero con ese nombre.") };
    return { ok: true, data: res.data };
  });
}

export async function borrarCamarero(id: string): Promise<R<{ desactivado: boolean }>> {
  return escribir<{ desactivado: boolean }>({ tabla: "reservas_camareros", id }, async (sb) => {
    // Mientras nadie rellene reservas_reservas.camarero_id este conteo da 0 (ver repartoDelDia).
    const { count, error: eC } = await sb.from("reservas_reservas").select("id", { count: "exact", head: true }).eq("camarero_id", id);
    if (eC) return { ok: false, error: "No se ha podido comprobar si está en uso. Vuelve a intentarlo." };
    if (count && count > 0) {
      const { error } = await sb.from("reservas_camareros").update({ activo: false }).eq("id", id);
      return error ? { ok: false, error: error.message } : { ok: true, data: { desactivado: true } };
    }
    const { error } = await sb.from("reservas_camareros").delete().eq("id", id);
    if (error?.code === "23503") {
      const { error: e2 } = await sb.from("reservas_camareros").update({ activo: false }).eq("id", id);
      return e2 ? { ok: false, error: e2.message } : { ok: true, data: { desactivado: true } };
    }
    return error ? { ok: false, error: error.message } : { ok: true, data: { desactivado: false } };
  });
}

/** Asignaciones mesa → camarero de un día (todas las mesas del restaurante). */
export async function listarAsignacionesCamarero(restId: string, fecha: string): Promise<CamareroDia[]> {
  if (!esUuid(restId) || !FECHA.test(fecha)) return [];
  const { sb } = await cliente();
  const { data: salas } = await sb.from("reservas_salas").select("mesas:reservas_mesas(id)").eq("restaurante_id", restId);
  const ids = (salas ?? []).flatMap((s) => (s.mesas ?? []).map((m) => m.id));
  if (!ids.length) return [];
  const { data } = await sb.from("reservas_mesas_camarero_dia").select("*").eq("fecha", fecha).in("mesa_id", ids);
  return data ?? [];
}

/** Mesas del restaurante (ids). */
async function mesasDe(sb: Sb, restId: string): Promise<Set<string>> {
  const { data: salas } = await sb.from("reservas_salas").select("mesas:reservas_mesas(id)").eq("restaurante_id", restId);
  return new Set((salas ?? []).flatMap((s) => (s.mesas ?? []).map((m) => m.id)));
}

type FilaReparto = { fecha: string; mesa_id: string; turno_id: string | null; camarero_id: string };

/** Sustituye filas del reparto «borrar y volver a insertar». Sin transacción en PostgREST: si el
    insert falla, se reponen las filas que había (lo más parecido a deshacer). */
async function sustituirReparto(sb: Sb, previas: CamareroDia[], nuevas: FilaReparto[]): Promise<string | null> {
  if (previas.length) {
    const { error } = await sb.from("reservas_mesas_camarero_dia").delete().in("id", previas.map((x) => x.id));
    if (error) return error.message;
  }
  if (!nuevas.length) return null;
  const { error } = await sb.from("reservas_mesas_camarero_dia").insert(nuevas);
  if (!error) return null;
  if (previas.length) {
    await sb.from("reservas_mesas_camarero_dia").insert(previas.map((x) => ({ fecha: x.fecha, mesa_id: x.mesa_id, turno_id: x.turno_id, camarero_id: x.camarero_id })));
  }
  return error.code === "23505" ? "Otra persona ha cambiado el reparto a la vez. Recarga y vuelve a intentarlo." : error.message;
}

/** Una mesa: mismas comprobaciones que la asignación en bloque. camareroId null = quitar; turnoId null = todo el día. */
export async function asignarCamareroMesa(restId: string, fecha: string, mesaId: string, turnoId: string | null, camareroId: string | null): Promise<R> {
  const r = await asignarCamareroMesas(restId, fecha, [mesaId], turnoId, camareroId);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** Asignación en bloque (p. ej. «toda la terraza a Ana»). camareroId null = quitar.
    Mesas, turno y camarero tienen que ser del restaurante. */
export async function asignarCamareroMesas(restId: string, fecha: string, mesaIds: string[], turnoId: string | null, camareroId: string | null): Promise<R<{ cambiadas: number }>> {
  return escribir<{ cambiadas: number }>({ rest: restId }, async (sb) => {
    if (!FECHA.test(fecha)) return { ok: false, error: "Fecha no válida." };
    const pedidas = [...new Set((mesaIds ?? []).filter(esUuid))];
    if (!pedidas.length) return { ok: true, data: { cambiadas: 0 } };
    const propias = await mesasDe(sb, restId);
    const ids = pedidas.filter((id) => propias.has(id));
    if (!ids.length) return { ok: false, error: "Esas mesas no son de este restaurante." };
    if (turnoId) {
      const { data: t } = await sb.from("reservas_turnos").select("id").eq("id", turnoId).eq("restaurante_id", restId).maybeSingle();
      if (!t) return { ok: false, error: "Ese turno no es de este restaurante." };
    }
    if (camareroId) {
      const { data: cam } = await sb.from("reservas_camareros").select("id").eq("id", camareroId).eq("restaurante_id", restId).maybeSingle();
      if (!cam) return { ok: false, error: "Ese camarero no es de este restaurante." };
    }
    let q = sb.from("reservas_mesas_camarero_dia").select("*").eq("fecha", fecha).in("mesa_id", ids);
    q = turnoId ? q.eq("turno_id", turnoId) : q.is("turno_id", null);
    const { data: previas, error: eP } = await q;
    if (eP) return { ok: false, error: eP.message };
    const nuevas = camareroId ? ids.map((mesa_id) => ({ fecha, mesa_id, turno_id: turnoId, camarero_id: camareroId })) : [];
    const fallo = await sustituirReparto(sb, previas ?? [], nuevas);
    return fallo ? { ok: false, error: fallo } : { ok: true, data: { cambiadas: ids.length } };
  });
}

/** Reparto efectivo de un día para Día y el plano: mesa_id → camarero. Si se pasa turno, manda la
    asignación de ese turno y, si no la hay, la de «todo el día»; sin turno, solo la de todo el día. */
export async function repartoDelDia(
  restId: string,
  fecha: string,
  turnoId?: string | null,
): Promise<Record<string, { camarero_id: string; nombre: string; color: string; turno_id: string | null }>> {
  if (!esUuid(restId) || !FECHA.test(fecha)) return {};
  const [asig, cams] = await Promise.all([listarAsignacionesCamarero(restId, fecha), listarCamareros(restId)]);
  const porId = new Map(cams.map((c) => [c.id, c]));
  const out: Record<string, { camarero_id: string; nombre: string; color: string; turno_id: string | null }> = {};
  const poner = (a: CamareroDia) => {
    const c = porId.get(a.camarero_id);
    if (c) out[a.mesa_id] = { camarero_id: c.id, nombre: c.nombre, color: c.color, turno_id: a.turno_id };
  };
  for (const a of asig) if (a.turno_id === null) poner(a);
  if (turnoId) for (const a of asig) if (a.turno_id === turnoId) poner(a);
  return out;
}

/** Empleados en activo de Personal, para vincular un camarero con su ficha (opcional).
    Si la RLS de empleados no deja leerlos a este usuario, la lista llega vacía y no se ofrece. */
export async function listarEmpleadosCamareros(): Promise<{ id: string; nombre: string }[]> {
  try {
    const { sb } = await cliente();
    const hoy = new Date().toISOString().slice(0, 10);
    const { data } = await sb.from("empleados").select("id, nombre, apellidos, fecha_baja").order("nombre").limit(1000);
    return (data ?? [])
      .filter((e) => !e.fecha_baja || e.fecha_baja >= hoy)
      .map((e) => ({ id: e.id, nombre: [e.nombre, e.apellidos].filter(Boolean).join(" ") }));
  } catch {
    return [];
  }
}

/** Copia las asignaciones de un día a otro (p. ej. «como ayer»). El día destino queda igual que
    el de origen; si algo falla, se repone el reparto que tenía. */
export async function copiarAsignacionesCamarero(restId: string, desde: string, hasta: string): Promise<R<{ copiadas: number }>> {
  return escribir({ rest: restId }, async (sb) => {
    if (!FECHA.test(desde) || !FECHA.test(hasta) || desde === hasta) return { ok: false, error: "Fechas no válidas." };
    const origen = await listarAsignacionesCamarero(restId, desde);
    if (!origen.length) return { ok: false, error: "Ese día no tiene asignaciones." };
    const previas = await listarAsignacionesCamarero(restId, hasta);
    const fallo = await sustituirReparto(sb, previas, origen.map((a) => ({ fecha: hasta, mesa_id: a.mesa_id, turno_id: a.turno_id, camarero_id: a.camarero_id })));
    return fallo ? { ok: false, error: fallo } : { ok: true, data: { copiadas: origen.length } };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   PROVEEDORES (solo si hay clave configurada; nunca se devuelve el valor)
   ═══════════════════════════════════════════════════════════════════════════ */

export async function estadoProveedores(): Promise<{ tpv: boolean; email: boolean; sms: boolean; whatsapp: boolean }> {
  await cliente();
  return {
    tpv: !!(process.env.TPV_COMERCIO && process.env.TPV_CLAVE),
    email: !!process.env.RESEND_API_KEY,
    sms: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM),
    whatsapp: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM),
  };
}
