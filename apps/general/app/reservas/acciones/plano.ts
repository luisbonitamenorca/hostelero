"use server";

/* Acciones de servidor del plano de sala (componentes/plano.tsx y plano-editor.tsx).
   Todo pasa por el cliente autenticado: la RLS acota a la cuenta. Sin service key. */

import { unstable_rethrow } from "next/navigation";
import { exigirModulo } from "@/lib/supabase/server";
import type { Tables, TablesInsert, TablesUpdate } from "@hostelero/db";
import type { Mesa } from "../tipos";

type R<T = undefined> = { ok: boolean; error?: string; data?: T };

export type PlanoObjeto = Tables<"reservas_plano_objetos">;
export type Bloqueo = Tables<"reservas_bloqueos">;

/** Cambio sobre una mesa. `_nuevo` = id temporal (empieza por "nuevo-"), se inserta.
    `_borrar` = la mesa se desactiva (nunca se borra: tiene historial de reservas). */
export type CambioMesa = Partial<Mesa> & { id: string; _nuevo?: boolean; _borrar?: boolean };
/** Cambio sobre un objeto decorativo. Sin id o `_nuevo` = se inserta; `_borrar` = se elimina. */
export type CambioObjeto = Partial<PlanoObjeto> & { id?: string; _borrar?: boolean; _nuevo?: boolean };
export type PlanoCambios = { mesas: CambioMesa[]; objetos: CambioObjeto[] };

/** Campos de mesa que el editor puede tocar (el resto —sala, cuenta— no se mueve desde aquí). */
const CAMPOS_MESA = [
  "nombre", "cap_min", "cap_max", "forma", "tipo", "pos_x", "pos_y", "ancho", "alto", "rotacion",
  "color", "etiqueta", "reservable_online", "activa", "unible", "prioridad",
] as const;
const CAMPOS_OBJETO = ["tipo", "pos_x", "pos_y", "ancho", "alto", "rotacion", "texto", "color"] as const;

const TIPOS_OBJETO = ["planta", "pared", "barra", "texto", "puerta", "columna", "ventana", "escalera", "cocina"];
const FORMAS = ["redonda", "cuadrada", "rectangular"];
const TIPOS_MESA = ["mesa", "barra", "alta"];
/** Estados que ocupan mesa (espejo de ESTADOS_VIVOS en lib-reservas, que es módulo de cliente). */
const ESTADOS_VIVOS = ["pendiente", "confirmada", "reconfirmada", "llegada", "sentada", "postre", "cuenta", "a_revisar", "tarjeta_pendiente"];
/** Solo colores hexadecimales: el valor acaba en un style del SVG (nada de url(...) a otros dominios). */
const COLOR_RE = /^#[0-9a-f]{3,8}$/i;

/** Error con texto ya pensado para el usuario (el resto se sustituye por uno genérico). */
class ErrorPlano extends Error {}

function recortar<T extends object, K extends readonly (keyof T)[]>(obj: T, campos: K): Partial<Pick<T, K[number]>> {
  const out: Partial<Pick<T, K[number]>> = {};
  for (const c of campos) if (obj[c] !== undefined) out[c] = obj[c];
  return out;
}

const num = (v: unknown, def: number) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : def;
};
const redondear = (v: number) => Math.round(v * 10) / 10;
const limpiarColor = (v: unknown) => (typeof v === "string" && COLOR_RE.test(v.trim()) ? v.trim() : null);
const numeroVisible = (m: { nombre: string; etiqueta: string | null }) => ((m.etiqueta || "").trim() || m.nombre).trim();
const hoyMadrid = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date());
const lienzoValido = (ancho: unknown, alto: unknown) => ({
  ancho: Math.round(Math.max(40, Math.min(400, num(ancho, 100)))),
  alto: Math.round(Math.max(30, Math.min(400, num(alto, 70)))),
});

/** Traduce un error de Postgres/PostgREST a un mensaje en español (el original va al log del servidor). */
function traducir(e: { code?: string; message?: string } | null | undefined, que: string): string {
  console.error(`[plano] ${que}:`, e?.code, e?.message);
  switch (e?.code) {
    case "42501":
      return `${que}: no tienes permiso para guardar en esta sala`;
    case "23505":
      return `${que}: dato repetido`;
    case "23503":
      return `${que}: la sala o la mesa ya no existe`;
    case "23502":
    case "23514":
    case "22P02":
    case "22003":
    case "22001":
      return `${que}: dato no válido`;
    case "PGRST116":
      return `${que}: no encontrado`;
    default:
      if (/row-level security|permission denied/i.test(e?.message ?? "")) return `${que}: no tienes permiso para guardar en esta sala`;
      return `${que}: no se pudo guardar`;
  }
}

/** Ejecuta las tareas en paralelo por lotes (evita decenas de viajes en serie al guardar el plano entero). */
async function enLotes(tareas: (() => Promise<void>)[], tam = 10) {
  for (let i = 0; i < tareas.length; i += tam) await Promise.all(tareas.slice(i, i + tam).map((t) => t()));
}

/** ¿Puede este perfil editar el plano? Dirección siempre; el resto según reservas_permisos_perfil. */
async function exigirEdicionPlano() {
  const { supabase: sb, perfil } = await exigirModulo("reservas");
  if (perfil.rol === "direccion") return sb;
  const { data } = await sb
    .from("reservas_permisos_perfil")
    .select("puede_editar_plano")
    .eq("perfil_id", perfil.id)
    .maybeSingle();
  if (!data?.puede_editar_plano) throw new ErrorPlano("No tienes permiso para editar el plano");
  return sb;
}

/* ================= Lecturas ================= */

/** Objetos decorativos de la sala y bloqueos que la afectan en una fecha
    (los de la mesa, los de la sala entera y los de todo el restaurante). */
export async function cargarPlano(salaId: string, fecha?: string): Promise<{ objetos: PlanoObjeto[]; bloqueos: Bloqueo[] }> {
  const { supabase: sb } = await exigirModulo("reservas");
  const [{ data: objetos }, { data: sala }] = await Promise.all([
    sb.from("reservas_plano_objetos").select("*").eq("sala_id", salaId).order("creado_en"),
    sb.from("reservas_salas").select("id, restaurante_id, mesas:reservas_mesas(id)").eq("id", salaId).maybeSingle(),
  ]);
  if (!fecha || !sala) return { objetos: objetos ?? [], bloqueos: [] };

  const { data: bloqueos } = await sb
    .from("reservas_bloqueos")
    .select("*")
    .eq("restaurante_id", sala.restaurante_id)
    .eq("fecha", fecha)
    .order("hora_inicio");
  const mesasSala = new Set((sala.mesas ?? []).map((m) => m.id));
  const propios = (bloqueos ?? []).filter(
    (b) => (!b.mesa_id && !b.sala_id) || b.sala_id === salaId || (b.mesa_id && mesasSala.has(b.mesa_id)),
  );
  return { objetos: objetos ?? [], bloqueos: propios };
}

/* ================= Escrituras ================= */

type CamposMesa = Partial<Pick<Mesa, (typeof CAMPOS_MESA)[number]>>;
type CamposObjeto = Partial<Pick<PlanoObjeto, (typeof CAMPOS_OBJETO)[number]>>;
/** Lo que la validación necesita saber de cada mesa del restaurante, ya con los cambios aplicados. */
type MesaFinal = { id: string; sala_id: string; nombre: string; etiqueta: string | null; activa: boolean; cap_min: number; cap_max: number };

/** Normaliza los campos de una mesa que llegan del editor (tipos, rangos, longitudes). */
function normalizarMesa(c: CambioMesa, ancho: number, alto: number): CamposMesa {
  const campos: CamposMesa = recortar(c, CAMPOS_MESA);
  if (campos.forma !== undefined && !FORMAS.includes(String(campos.forma))) delete campos.forma;
  if (campos.tipo !== undefined && !TIPOS_MESA.includes(String(campos.tipo))) delete campos.tipo;
  if (campos.pos_x !== undefined) campos.pos_x = redondear(Math.max(0, Math.min(ancho, num(campos.pos_x, 10))));
  if (campos.pos_y !== undefined) campos.pos_y = redondear(Math.max(0, Math.min(alto, num(campos.pos_y, 10))));
  if (campos.ancho !== undefined) campos.ancho = campos.ancho == null ? null : redondear(Math.max(2, Math.min(60, num(campos.ancho, 7))));
  if (campos.alto !== undefined) campos.alto = campos.alto == null ? null : redondear(Math.max(2, Math.min(60, num(campos.alto, 7))));
  if (campos.rotacion !== undefined) campos.rotacion = ((Math.round(num(campos.rotacion, 0)) % 360) + 360) % 360;
  if (campos.cap_min !== undefined) campos.cap_min = Math.max(1, Math.min(99, Math.round(num(campos.cap_min, 1))));
  if (campos.cap_max !== undefined) campos.cap_max = Math.max(1, Math.min(99, Math.round(num(campos.cap_max, 2))));
  if (campos.nombre !== undefined) campos.nombre = String(campos.nombre ?? "").trim().slice(0, 40);
  if (campos.etiqueta !== undefined) campos.etiqueta = String(campos.etiqueta ?? "").trim().slice(0, 30) || null;
  if (campos.color !== undefined) campos.color = limpiarColor(campos.color);
  if (campos.prioridad !== undefined) campos.prioridad = Math.round(num(campos.prioridad, 100));
  for (const k of ["reservable_online", "activa", "unible"] as const) if (campos[k] !== undefined) campos[k] = !!campos[k];
  return campos;
}

function normalizarObjeto(c: CambioObjeto, ancho: number, alto: number): CamposObjeto {
  const campos: CamposObjeto = recortar(c, CAMPOS_OBJETO);
  if (campos.pos_x !== undefined) campos.pos_x = redondear(Math.max(0, Math.min(ancho, num(campos.pos_x, 10))));
  if (campos.pos_y !== undefined) campos.pos_y = redondear(Math.max(0, Math.min(alto, num(campos.pos_y, 10))));
  if (campos.ancho !== undefined) campos.ancho = redondear(Math.max(0.5, Math.min(400, num(campos.ancho, 6))));
  if (campos.alto !== undefined) campos.alto = redondear(Math.max(0.5, Math.min(400, num(campos.alto, 6))));
  if (campos.rotacion !== undefined) campos.rotacion = ((Math.round(num(campos.rotacion, 0)) % 360) + 360) % 360;
  if (campos.texto !== undefined) campos.texto = campos.texto ? String(campos.texto).trim().slice(0, 60) : null;
  if (campos.color !== undefined) campos.color = limpiarColor(campos.color);
  return campos;
}

/** Guarda los cambios del editor: mesas (update / insert / desactivar) y objetos (update / insert / delete).
    Con `opciones.lienzo` guarda antes el tamaño de la sala (así las posiciones se limitan al lienzo nuevo).
    Valida antes de escribir nada: capacidad mínima ≤ máxima y números de mesa sin repetir en el restaurante.
    Devuelve el mapa de ids temporales → ids reales para que el editor los sustituya sin recargar,
    y `aviso` si se ha desactivado alguna mesa con reservas futuras. */
export async function guardarPlano(
  salaId: string,
  cambios: PlanoCambios,
  opciones?: { lienzo?: { ancho: number; alto: number } },
): Promise<R<{ idsNuevos: Record<string, string>; aviso?: string }>> {
  try {
    const sb = await exigirEdicionPlano();
    if (typeof salaId !== "string" || !salaId) return { ok: false, error: "Sala no válida" };

    // Entrada saneada: descartamos lo que no tenga la forma esperada.
    const entradaMesas = (Array.isArray(cambios?.mesas) ? cambios.mesas : []).filter(
      (c): c is CambioMesa => !!c && typeof c === "object" && typeof c.id === "string" && c.id.length > 0,
    );
    const entradaObjetos = (Array.isArray(cambios?.objetos) ? cambios.objetos : []).filter(
      (c): c is CambioObjeto => !!c && typeof c === "object" && (c.id === undefined || typeof c.id === "string"),
    );

    const { data: sala, error: eSala } = await sb
      .from("reservas_salas")
      .select("id, nombre, ancho, alto, cuenta_id, restaurante_id")
      .eq("id", salaId)
      .maybeSingle();
    if (eSala) return { ok: false, error: traducir(eSala, "Sala") };
    if (!sala) return { ok: false, error: "Sala no encontrada" };

    /* ---- lienzo: las posiciones se limitan al tamaño NUEVO (se escribe tras validar) ---- */
    let { ancho, alto } = sala;
    let lienzoCambia = false;
    if (opciones?.lienzo) {
      const l = lienzoValido(opciones.lienzo.ancho, opciones.lienzo.alto);
      if (l.ancho !== ancho || l.alto !== alto) { ({ ancho, alto } = l); lienzoCambia = true; }
    }

    /* ---- normalización y validación de mesas (antes de escribir nada) ---- */
    const mesas = entradaMesas.map((c) => ({ c, nuevo: !!c._nuevo || c.id.startsWith("nuevo-"), campos: normalizarMesa(c, ancho, alto), omitir: false }));

    const { data: salasRest, error: eSalas } = await sb.from("reservas_salas").select("id, nombre").eq("restaurante_id", sala.restaurante_id);
    if (eSalas) return { ok: false, error: traducir(eSalas, "Salas") };
    const nombreSala = new Map((salasRest ?? []).map((s) => [s.id, s.nombre]));
    const idsSalas = (salasRest ?? []).map((s) => s.id);
    const { data: actuales, error: eMesas } = await sb
      .from("reservas_mesas")
      .select("id, sala_id, nombre, etiqueta, activa, cap_min, cap_max")
      .in("sala_id", idsSalas.length ? idsSalas : [salaId]);
    if (eMesas) return { ok: false, error: traducir(eMesas, "Mesas") };

    const finales = new Map<string, MesaFinal>((actuales ?? []).map((m) => [m.id, { ...m }]));
    const activasAntes = new Set((actuales ?? []).filter((m) => m.activa).map((m) => m.id));
    const renumeradas = new Set<string>(); // mesas cuyo número visible cambia o que vuelven a estar activas
    const errores: string[] = [];

    for (const x of mesas) {
      const { c, nuevo, campos } = x;
      if (nuevo) {
        if (c._borrar) continue;
        if (!campos.nombre) return { ok: false, error: "Hay una mesa nueva sin número" };
        finales.set(c.id, {
          id: c.id, sala_id: salaId, nombre: campos.nombre, etiqueta: campos.etiqueta ?? null,
          activa: campos.activa ?? true, cap_min: campos.cap_min ?? 1, cap_max: campos.cap_max ?? 2,
        });
        renumeradas.add(c.id);
        continue;
      }
      const f = finales.get(c.id);
      if (!f || f.sala_id !== salaId) { errores.push("Una mesa ya no existe en esta sala"); x.omitir = true; continue; }
      if (campos.nombre === "") return { ok: false, error: `La mesa ${numeroVisible(f)} necesita un número` };
      const antes = numeroVisible(f);
      if (campos.nombre !== undefined) f.nombre = campos.nombre;
      if (campos.etiqueta !== undefined) f.etiqueta = campos.etiqueta;
      if (campos.activa !== undefined) f.activa = campos.activa;
      if (c._borrar) f.activa = false;
      if (campos.cap_min !== undefined) f.cap_min = campos.cap_min;
      if (campos.cap_max !== undefined) f.cap_max = campos.cap_max;
      if (numeroVisible(f) !== antes || (f.activa && !activasAntes.has(f.id))) renumeradas.add(f.id);
    }

    // Capacidad: mínima ≤ máxima con los valores finales (aunque solo llegue uno de los dos).
    for (const { c, omitir } of mesas) {
      if (omitir) continue;
      const f = finales.get(c.id);
      if (f && f.cap_min > f.cap_max) return { ok: false, error: `La capacidad mínima no puede superar la máxima (mesa ${numeroVisible(f)})` };
    }

    // Números de mesa repetidos entre las mesas activas del restaurante (solo si este guardado los provoca).
    const porNumero = new Map<string, MesaFinal[]>();
    for (const f of finales.values()) {
      if (!f.activa) continue;
      const k = numeroVisible(f).toLowerCase();
      porNumero.set(k, [...(porNumero.get(k) ?? []), f]);
    }
    for (const id of renumeradas) {
      const f = finales.get(id);
      if (!f?.activa) continue;
      const otra = (porNumero.get(numeroVisible(f).toLowerCase()) ?? []).find((o) => o.id !== id);
      if (otra) return { ok: false, error: `Ya existe la mesa ${numeroVisible(f)} en ${nombreSala.get(otra.sala_id) ?? "otra sala"}` };
    }

    /* ---- lienzo (antes que mesas y objetos; si falla no se escribe nada más) ---- */
    if (lienzoCambia) {
      const { error } = await sb.from("reservas_salas").update({ ancho, alto }).eq("id", salaId);
      if (error) return { ok: false, error: traducir(error, "Tamaño del lienzo") };
    }

    /* ---- escritura de mesas ---- */
    const idsNuevos: Record<string, string> = {};
    const desactivadas: string[] = [];
    const tareas: (() => Promise<void>)[] = [];

    for (const { c, nuevo, campos, omitir } of mesas) {
      if (omitir) continue;
      const etiquetaError = `Mesa ${campos.etiqueta || campos.nombre || numeroVisible(finales.get(c.id) ?? { nombre: "", etiqueta: null })}`.trim();
      if (c._borrar) {
        if (nuevo) continue;
        tareas.push(async () => {
          const { error } = await sb.from("reservas_mesas").update({ activa: false }).eq("id", c.id).eq("sala_id", salaId);
          if (error) errores.push(traducir(error, etiquetaError));
          else if (activasAntes.has(c.id)) desactivadas.push(c.id);
        });
        continue;
      }
      if (nuevo) {
        const fila: TablesInsert<"reservas_mesas"> = {
          cuenta_id: sala.cuenta_id, // explícita: un operador puede estar editando una sala de otra cuenta
          sala_id: salaId,
          nombre: campos.nombre!,
          cap_min: campos.cap_min ?? 1,
          cap_max: campos.cap_max ?? 2,
          forma: campos.forma ?? "cuadrada",
          tipo: campos.tipo ?? "mesa",
          pos_x: campos.pos_x ?? 10,
          pos_y: campos.pos_y ?? 10,
          ancho: campos.ancho ?? 7,
          alto: campos.alto ?? 7,
          rotacion: campos.rotacion ?? 0,
          color: campos.color ?? null,
          etiqueta: campos.etiqueta ?? null,
          reservable_online: campos.reservable_online ?? true,
          activa: campos.activa ?? true,
          unible: campos.unible ?? true,
          prioridad: campos.prioridad ?? 100,
        };
        tareas.push(async () => {
          const { data, error } = await sb.from("reservas_mesas").insert(fila).select("id").single();
          if (error) errores.push(traducir(error, etiquetaError));
          else if (data) idsNuevos[c.id] = data.id;
        });
        continue;
      }
      if (Object.keys(campos).length === 0) continue;
      tareas.push(async () => {
        const { error } = await sb.from("reservas_mesas").update(campos as TablesUpdate<"reservas_mesas">).eq("id", c.id).eq("sala_id", salaId);
        if (error) errores.push(traducir(error, etiquetaError));
        else if (campos.activa === false && activasAntes.has(c.id)) desactivadas.push(c.id);
      });
    }

    /* ---- objetos ---- */
    for (const c of entradaObjetos) {
      const nuevo = !!c._nuevo || !c.id || c.id.startsWith("nuevo-");
      if (c._borrar) {
        if (nuevo || !c.id) continue;
        const id = c.id;
        tareas.push(async () => {
          const { error } = await sb.from("reservas_plano_objetos").delete().eq("id", id).eq("sala_id", salaId);
          if (error) errores.push(traducir(error, "Objeto"));
        });
        continue;
      }
      const campos = normalizarObjeto(c, ancho, alto);
      if (campos.tipo !== undefined && !TIPOS_OBJETO.includes(String(campos.tipo))) { errores.push(`Objeto de tipo desconocido: ${String(campos.tipo).slice(0, 20)}`); continue; }
      if (nuevo) {
        if (!campos.tipo) { errores.push("Objeto nuevo sin tipo"); continue; }
        const fila: TablesInsert<"reservas_plano_objetos"> = { ...campos, cuenta_id: sala.cuenta_id, sala_id: salaId, tipo: campos.tipo };
        const idTemp = c.id;
        tareas.push(async () => {
          const { data, error } = await sb.from("reservas_plano_objetos").insert(fila).select("id").single();
          if (error) errores.push(traducir(error, "Objeto"));
          else if (data && idTemp) idsNuevos[idTemp] = data.id;
        });
        continue;
      }
      if (Object.keys(campos).length === 0) continue;
      const id = c.id!;
      tareas.push(async () => {
        const { error } = await sb.from("reservas_plano_objetos").update(campos).eq("id", id).eq("sala_id", salaId);
        if (error) errores.push(traducir(error, "Objeto"));
      });
    }

    await enLotes(tareas);

    /* ---- aviso: mesas desactivadas con reservas futuras ---- */
    let aviso: string | undefined;
    if (desactivadas.length) {
      const hoy = hoyMadrid();
      const [{ data: directas }, { data: enlaces }] = await Promise.all([
        sb.from("reservas_reservas").select("id, mesa_id").in("mesa_id", desactivadas).gte("fecha", hoy).in("estado", ESTADOS_VIVOS),
        sb.from("reservas_reserva_mesas").select("reserva_id, mesa_id").in("mesa_id", desactivadas),
      ]);
      const porMesa = new Map<string, Set<string>>();
      const anotar = (mesaId: string | null, reservaId: string) => {
        if (!mesaId) return;
        if (!porMesa.has(mesaId)) porMesa.set(mesaId, new Set());
        porMesa.get(mesaId)!.add(reservaId);
      };
      for (const r of directas ?? []) anotar(r.mesa_id, r.id);
      const idsEnlace = [...new Set((enlaces ?? []).map((e) => e.reserva_id))];
      if (idsEnlace.length) {
        const { data: vivas } = await sb.from("reservas_reservas").select("id").in("id", idsEnlace).gte("fecha", hoy).in("estado", ESTADOS_VIVOS);
        const setVivas = new Set((vivas ?? []).map((v) => v.id));
        for (const e of enlaces ?? []) if (setVivas.has(e.reserva_id)) anotar(e.mesa_id, e.reserva_id);
      }
      const partes = [...porMesa.entries()].map(([id, rs]) => {
        const f = finales.get(id);
        return `mesa ${f ? numeroVisible(f) : "?"} (${rs.size} reserva${rs.size === 1 ? "" : "s"})`;
      });
      if (partes.length) aviso = `Has desactivado mesas con reservas futuras: ${partes.join(", ")}. Reasígnalas desde el Día.`;
    }

    if (errores.length) return { ok: false, error: [...new Set(errores)].join(" · "), data: { idsNuevos, aviso } };
    return { ok: true, data: { idsNuevos, aviso } };
  } catch (e) {
    unstable_rethrow(e); // redirecciones de Next (sesión caducada, módulo retirado) siguen su curso
    if (e instanceof ErrorPlano) return { ok: false, error: e.message };
    console.error("[plano] guardarPlano:", e);
    return { ok: false, error: "No se pudo guardar el plano" };
  }
}

/** Tamaño del lienzo de la sala (unidades del plano). */
export async function guardarLienzo(salaId: string, ancho: number, alto: number): Promise<R> {
  try {
    const sb = await exigirEdicionPlano();
    const l = lienzoValido(ancho, alto);
    const { error } = await sb.from("reservas_salas").update({ ancho: l.ancho, alto: l.alto }).eq("id", salaId);
    return error ? { ok: false, error: traducir(error, "Tamaño del lienzo") } : { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ErrorPlano) return { ok: false, error: e.message };
    console.error("[plano] guardarLienzo:", e);
    return { ok: false, error: "No se pudo cambiar el tamaño" };
  }
}
