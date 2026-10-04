"use server";

/* Borradores de pedido: catálogo y búsqueda de productos, guardar borradores, editar líneas y
   aprender alias (constructor A). Contrato: docs/pedidos-contratos.md §3.2.
   Cualquiera con el módulo. Solo se editan pedidos en estado «borrador». Cliente de sesión (RLS). */

import type { TablesUpdate } from "@hostelero/db";
import {
  comoInterpretacion,
  esFechaISO,
  esUuid,
  fusionarLineas,
  hoyMadrid,
  limpiarTexto,
  limpiarTextoLargo,
  normalizarTexto,
  normalizarUnidad,
  redondear,
} from "../lib-pedidos";
import { aLineaPedido, centroDeLaCuenta, errorLegible, exigirPedidos, SELECT_LINEA_PEDIDO, type CtxPedidos } from "../servidor";
import { MAX_TEXTO_PEDIDO, ORIGENES_PEDIDO } from "../tipos";
import type {
  CambiosBorrador,
  CambiosLinea,
  EntradaGuardarBorradores,
  IdiomaDictado,
  InterpretacionCruda,
  Json,
  LineaGuardar,
  LineaInterpretacionCruda,
  LineaPedido,
  OrigenPedido,
  PedidoCreado,
  ProductoCatalogo,
  Resultado,
} from "../tipos";

/* ═══════════════════════ Ayudas internas (sin export: fichero "use server") ═══════════════════════ */

const ERROR_NO_BORRADOR = "El pedido ya está enviado: no se puede cambiar";
const ERROR_CANCELADO = "El pedido está cancelado: no se puede cambiar";
const ERROR_NO_PEDIDO = "No se ha encontrado el pedido";
const ERROR_OTRO_PROVEEDOR_PEDIDO = "Hay productos de otro proveedor en el pedido: quítalos o cámbialos antes";
const MAX_CANTIDAD = 100_000;
const MAX_ALIAS_POR_LLAMADA = 50;
/** Tope de la interpretación que se guarda en compras_pedido.interpretacion (JSON serializado). */
const MAX_INTERPRETACION = 50_000;

type FilaCatalogo = {
  producto_id: string;
  proveedor_id: string;
  proveedor_nombre: string | null;
  nombre: string | null;
  ref_proveedor: string | null;
  codigo_interno: string | null;
  unidad: string | null;
  formato: string | null;
  unidades_formato: number | null;
  categoria: string | null;
  precio_catalogo: number | null;
  veces: number | null;
  cantidad_total: number | null;
  ultima_cantidad: number | null;
  ultimo_precio: number | null;
  ultima_fecha: string | null;
  alias: string[] | null;
};

function aProductoCatalogo(f: FilaCatalogo): ProductoCatalogo {
  return {
    producto_id: f.producto_id,
    proveedor_id: f.proveedor_id,
    proveedor_nombre: f.proveedor_nombre ?? "",
    nombre: f.nombre?.trim() || f.ref_proveedor || "(sin nombre)",
    ref_proveedor: f.ref_proveedor,
    codigo_interno: f.codigo_interno,
    unidad: f.unidad,
    formato: f.formato,
    unidades_formato: f.unidades_formato,
    categoria: f.categoria,
    precio_catalogo: f.precio_catalogo,
    veces: f.veces ?? 0,
    cantidad_total: f.cantidad_total ?? 0,
    ultima_cantidad: f.ultima_cantidad,
    ultimo_precio: f.ultimo_precio,
    ultima_fecha: f.ultima_fecha,
    alias: f.alias ?? [],
  };
}

/** Quita lo que rompe la sintaxis de filtros de PostgREST. */
const sanearFiltro = (s: string) => s.replace(/[,()%*_\\"]/g, " ").replace(/\s+/g, " ").trim();

/** Expresión regular (Postgres, ~*) que casa una palabra al principio de palabra, con o sin
    acentos («jamon» casa «JAMÓN» y al revés). La palabra viene de normalizarTexto: [a-z0-9]. */
const CLASES: Record<string, string> = {
  a: "[aáàäâAÁÀÄÂ]",
  e: "[eéèëêEÉÈËÊ]",
  i: "[iíìïîIÍÌÏÎ]",
  o: "[oóòöôOÓÒÖÔ]",
  u: "[uúùüûUÚÙÜÛ]",
  n: "[nñNÑ]",
  c: "[cçCÇ]",
};
const patronPalabra = (p: string) => "\\m" + [...p].map((ch) => CLASES[ch] ?? ch).join("");

/** Cantidad válida (finita, > 0, ≤ 100.000, 3 decimales) o null. */
function cantidadValida(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > MAX_CANTIDAD) return null;
  const n = redondear(v, 3);
  return n > 0 ? n : null;
}

/** Precio: undefined/null → null; número finito ≥ 0 (4 decimales); otro → "error". */
function precioValido(v: unknown): number | null | "error" {
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1_000_000) return "error";
  return redondear(v, 4);
}

const unidadValida = (v: unknown): string | null => normalizarUnidad(limpiarTexto(v, 60))?.slice(0, 30) ?? null;

type LineaValida = {
  producto_id: string | null;
  texto_original: string | null;
  descripcion: string | null;
  cantidad: number;
  unidad: string | null;
  precio_estimado: number | null;
  confianza: number | null;
  nota: string | null;
  /** undefined = la línea no trae información de la IA (no se aprende nada). */
  ia_producto_id: string | null | undefined;
  ia_unidad: string | null | undefined;
};

/** Valida una línea que viene del navegador. Devuelve la línea limpia o el texto del error. */
function validarLinea(l: unknown): LineaValida | string {
  if (!l || typeof l !== "object") return "Hay una línea que no es válida";
  const x = l as Partial<LineaGuardar>;
  const producto_id = x.producto_id == null ? null : esUuid(x.producto_id) ? x.producto_id : undefined;
  if (producto_id === undefined) return "Hay un producto que no es válido";
  const texto_original = limpiarTexto(x.texto_original, 300);
  const descripcion = limpiarTexto(x.descripcion, 300);
  const quien = descripcion ?? texto_original ?? "un producto";
  const cantidad = cantidadValida(x.cantidad);
  if (cantidad === null) return `Revisa la cantidad de «${quien}» (mayor que 0 y como mucho ${MAX_CANTIDAD.toLocaleString("es-ES")})`;
  const precio = precioValido(x.precio_estimado);
  if (precio === "error") return `Revisa el precio de «${quien}»`;
  if (!producto_id && !descripcion && !texto_original) return "Hay una línea sin producto ni descripción";
  const confianza =
    typeof x.confianza === "number" && Number.isFinite(x.confianza) ? redondear(Math.min(1, Math.max(0, x.confianza)), 3) : null;
  return {
    producto_id,
    texto_original,
    descripcion: producto_id ? null : descripcion,
    cantidad,
    unidad: unidadValida(x.unidad),
    precio_estimado: precio,
    confianza,
    nota: limpiarTexto(x.nota, 300),
    ia_producto_id: x.ia_producto_id === undefined ? undefined : esUuid(x.ia_producto_id) ? x.ia_producto_id : null,
    ia_unidad: x.ia_unidad === undefined ? undefined : typeof x.ia_unidad === "string" ? x.ia_unidad : null,
  };
}

/** ¿Hay que aprender un alias de esta línea? (antes de fusionar, con la frase original). */
function debeAprender(l: LineaValida): boolean {
  if (!l.texto_original || !l.producto_id || l.ia_producto_id === undefined) return false;
  if (l.producto_id !== l.ia_producto_id) return true; // cambiado, o la IA no lo encontró y el usuario lo eligió
  if (normalizarUnidad(l.unidad) !== normalizarUnidad(l.ia_unidad)) return true;
  return l.confianza != null && l.confianza < 0.7; // el usuario confirmó una dudosa
}

type AliasPendiente = { frase: string; producto_id: string; unidad: string | null };

/** Alta/refuerzo de alias con concurrencia limitada. Los fallos no cortan nada. Devuelve cuántos salieron. */
async function aprender(
  ctx: CtxPedidos,
  pendientes: AliasPendiente[],
  centroId: string | null,
  idioma: IdiomaDictado | null,
): Promise<number> {
  const lista = pendientes.slice(0, MAX_ALIAS_POR_LLAMADA);
  let hechos = 0;
  let i = 0;
  const trabajador = async () => {
    while (i < lista.length) {
      const a = lista[i++];
      try {
        const { error } = await ctx.supabase.rpc("pedidos_aprender_alias", {
          p_frase: a.frase.slice(0, 200),
          p_producto: a.producto_id,
          p_unidad: a.unidad ?? undefined,
          p_centro: centroId ?? undefined,
          p_idioma: idioma ?? undefined,
        });
        if (!error) hechos += 1;
      } catch {
        /* no fatal */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, lista.length) }, trabajador));
  return hechos;
}

type ProductoBase = {
  id: string;
  nombre: string | null;
  ref_proveedor: string | null;
  proveedor_id: string | null;
  activo: boolean;
  ultimo_precio: number | null;
  precio_catalogo: number | null;
};

/** Productos de la cuenta por id (en trozos de 150). */
async function leerProductos(ctx: CtxPedidos, ids: string[]): Promise<Map<string, ProductoBase> | null> {
  const out = new Map<string, ProductoBase>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 150) {
    const { data, error } = await ctx.supabase
      .from("compras_producto")
      .select("id, nombre, ref_proveedor, proveedor_id, activo, ultimo_precio, precio_catalogo")
      .eq("cuenta_id", ctx.cuentaId)
      .in("id", unicos.slice(i, i + 150));
    if (error) return null;
    for (const p of data ?? []) out.set(p.id, p);
  }
  return out;
}

const nombreProducto = (p: ProductoBase) => p.nombre?.trim() || p.ref_proveedor || "Un producto";
const precioDe = (p: ProductoBase | undefined) => (p ? (p.ultimo_precio ?? p.precio_catalogo ?? null) : null);

type ProveedorBase = { id: string; nombre: string; pedible: boolean };

async function leerProveedor(ctx: CtxPedidos, id: string): Promise<ProveedorBase | null> {
  const { data } = await ctx.supabase
    .from("compras_proveedor")
    .select("id, nombre, pedible")
    .eq("id", id)
    .eq("cuenta_id", ctx.cuentaId)
    .maybeSingle();
  return data ?? null;
}

type BorradorBase = {
  id: string;
  numero: string;
  estado: string;
  centro_id: string;
  proveedor_id: string | null;
  idioma: string | null;
};

/** Pedido de la cuenta que tiene que estar en borrador. */
async function leerBorrador(ctx: CtxPedidos, pedidoId: unknown): Promise<BorradorBase | string> {
  if (!esUuid(pedidoId)) return ERROR_NO_PEDIDO;
  const { data, error } = await ctx.supabase
    .from("compras_pedido")
    .select("id, numero, estado, centro_id, proveedor_id, idioma")
    .eq("id", pedidoId)
    .eq("cuenta_id", ctx.cuentaId)
    .maybeSingle();
  if (error) return errorLegible(error, "No se ha podido leer el pedido. Prueba otra vez.");
  if (!data) return ERROR_NO_PEDIDO;
  if (data.estado === "cancelado") return ERROR_CANCELADO;
  if (data.estado !== "borrador") return ERROR_NO_BORRADOR;
  return data;
}

const idiomaDe = (v: unknown): IdiomaDictado | null => (v === "es" || v === "ca" ? v : null);

const numeroFinito = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * La interpretación viene del navegador (la devolvió interpretarTexto): se guarda SOLO lo conocido,
 * con los mismos topes que pone lib/pedidos-ia.ts, y como mucho MAX_INTERPRETACION. No es una
 * prueba de auditoría (no va firmada): es la ayuda para revisar y aprender. null si no vale.
 */
function sanearInterpretacion(v: unknown): InterpretacionCruda | null {
  const o = comoInterpretacion(v) as unknown as Record<string, unknown> | null;
  if (!o) return null;
  const uuidONull = (x: unknown) => (esUuid(x) ? x : null);
  const lineas: LineaInterpretacionCruda[] = [];
  for (const x of (o.lineas as unknown[]).slice(0, 200)) {
    if (!x || typeof x !== "object") continue;
    const l = x as Record<string, unknown>;
    const cantidad = numeroFinito(l.cantidad);
    const confianza = numeroFinito(l.confianza);
    lineas.push({
      producto_id: uuidONull(l.producto_id),
      alternativas: (Array.isArray(l.alternativas) ? l.alternativas : []).filter(esUuid).slice(0, 3),
      proveedor_id: uuidONull(l.proveedor_id),
      texto_original: limpiarTexto(l.texto_original, 300) ?? "",
      descripcion: limpiarTexto(l.descripcion, 300),
      cantidad: cantidad !== null && cantidad > 0 && cantidad <= MAX_CANTIDAD ? redondear(cantidad, 3) : 0,
      unidad: limpiarTexto(l.unidad, 30),
      confianza: confianza !== null ? redondear(Math.min(1, Math.max(0, confianza)), 3) : 0,
      nota: limpiarTexto(l.nota, 300),
    });
  }
  const textos = (a: unknown, n: number, max: number) =>
    (Array.isArray(a) ? a : [])
      .map((t) => limpiarTexto(t, max))
      .filter((t): t is string => !!t)
      .slice(0, n);
  const u = o.uso && typeof o.uso === "object" ? (o.uso as Record<string, unknown>) : null;
  const entero = (x: unknown) => Math.max(0, Math.round(numeroFinito(x) ?? 0));
  const limpia: InterpretacionCruda = {
    version: 1,
    modelo: limpiarTexto(o.modelo, 80) ?? "",
    idioma: idiomaDe(o.idioma) ?? "es",
    fecha_referencia: esFechaISO(o.fecha_referencia) ? o.fecha_referencia : "",
    centro_id: esUuid(o.centro_id) ? o.centro_id : "",
    texto: limpiarTextoLargo(o.texto, MAX_TEXTO_PEDIDO) ?? "",
    lineas,
    fecha_entrega: esFechaISO(o.fecha_entrega) ? o.fecha_entrega : null,
    notas: limpiarTextoLargo(o.notas, 1000),
    dudas: textos(o.dudas, 5, 200),
    descartados: textos(o.descartados, 50, 20),
    stop_reason: limpiarTexto(o.stop_reason, 40),
    ...(u
      ? {
          uso: {
            entrada: entero(u.entrada),
            salida: entero(u.salida),
            cache_lectura: entero(u.cache_lectura),
            cache_escritura: entero(u.cache_escritura),
          },
        }
      : {}),
  };
  try {
    return JSON.stringify(limpia).length <= MAX_INTERPRETACION ? limpia : null;
  } catch {
    return null;
  }
}

/** Frases que se aprenden de un texto_original: las líneas fusionadas lo unen con « + »
    («una caixa de pa + dues caixes de pa»); se aprende cada trozo, nunca la frase compuesta. */
function frasesDe(textoOriginal: string | null | undefined): string[] {
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const t of (textoOriginal ?? "").split(" + ")) {
    const f = limpiarTexto(t, 200);
    const n = normalizarTexto(f);
    if (!f || !n || vistas.has(n)) continue;
    vistas.add(n);
    out.push(f);
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Comprueba que un producto puede ir en el borrador y si hay que asignar su proveedor al pedido:
 *  - pedido con proveedor: el producto tiene que ser de ese proveedor;
 *  - pedido sin proveedor: se le asigna el del producto si ninguna otra línea es de otro y el
 *    proveedor está disponible para pedidos.
 */
async function proveedorParaProducto(
  ctx: CtxPedidos,
  pedido: BorradorBase,
  producto: ProductoBase,
  lineaExcluida?: string,
): Promise<{ asignar: string | null } | { error: string }> {
  if (!producto.proveedor_id || producto.proveedor_id === pedido.proveedor_id) return { asignar: null };
  if (pedido.proveedor_id) return { error: `«${nombreProducto(producto)}» es de otro proveedor` };
  const { data: otras, error } = await ctx.supabase
    .from("compras_pedido_linea")
    .select("id, compras_producto(proveedor_id)")
    .eq("pedido_id", pedido.id)
    .eq("cuenta_id", ctx.cuentaId)
    .not("producto_id", "is", null);
  if (error) return { error: errorLegible(error) };
  const conflicto = (otras ?? []).some(
    (o) => o.id !== lineaExcluida && o.compras_producto?.proveedor_id && o.compras_producto.proveedor_id !== producto.proveedor_id,
  );
  if (conflicto) return { error: ERROR_OTRO_PROVEEDOR_PEDIDO };
  const prov = await leerProveedor(ctx, producto.proveedor_id);
  if (!prov) return { error: "No se ha encontrado el proveedor del producto" };
  if (!prov.pedible) return { error: `${prov.nombre} no está disponible para pedidos (Ajustes)` };
  return { asignar: prov.id };
}

/** Pone el proveedor a un borrador (solo si sigue en borrador). */
async function asignarProveedor(ctx: CtxPedidos, pedidoId: string, proveedorId: string): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from("compras_pedido")
    .update({ proveedor_id: proveedorId })
    .eq("id", pedidoId)
    .eq("cuenta_id", ctx.cuentaId)
    .eq("estado", "borrador")
    .select("id");
  if (error) return errorLegible(error);
  if (!data?.length) return ERROR_NO_BORRADOR;
  return null;
}

async function leerLinea(ctx: CtxPedidos, lineaId: string): Promise<LineaPedido | null> {
  const { data } = await ctx.supabase
    .from("compras_pedido_linea")
    .select(SELECT_LINEA_PEDIDO)
    .eq("id", lineaId)
    .eq("cuenta_id", ctx.cuentaId)
    .maybeSingle();
  return data ? aLineaPedido(data) : null;
}

/* ═══════════════════════ Catálogo y búsqueda ═══════════════════════ */

/** Catálogo del centro (pedidos_catalogo_centro) ordenado por frecuencia. Con proveedor_id: todos
    los productos pedibles de ese proveedor (los nunca comprados aquí al final, veces = 0). */
export async function cargarCatalogo(entrada: {
  centro_id: string;
  proveedor_id?: string | null;
}): Promise<Resultado<{ productos: ProductoCatalogo[] }>> {
  const ctx = await exigirPedidos();
  try {
    if (!esUuid(entrada?.centro_id)) return { ok: false, error: "Elige un centro" };
    const proveedorId = entrada.proveedor_id ?? null;
    if (proveedorId !== null && !esUuid(proveedorId)) return { ok: false, error: "Elige un proveedor" };

    const [centro, prov] = await Promise.all([
      centroDeLaCuenta(ctx, entrada.centro_id),
      proveedorId ? leerProveedor(ctx, proveedorId) : Promise.resolve(null),
    ]);
    if (!centro) return { ok: false, error: "Elige un centro" };
    if (proveedorId && !prov) return { ok: false, error: "No se ha encontrado el proveedor" };

    const args = proveedorId ? { p_centro: centro.id, p_proveedor: proveedorId } : { p_centro: centro.id };
    const productos: ProductoCatalogo[] = [];
    const vistos = new Set<string>();
    for (let desde = 0; desde < 20_000; desde += 1000) {
      const { data, error } = await ctx.supabase.rpc("pedidos_catalogo_centro", args).range(desde, desde + 999);
      if (error) return { ok: false, error: "No se ha podido leer el catálogo. Prueba otra vez." };
      for (const f of data ?? []) {
        if (vistos.has(f.producto_id)) continue;
        vistos.add(f.producto_id);
        productos.push(aProductoCatalogo(f as FilaCatalogo));
      }
      if (!data || data.length < 1000) break;
    }
    return { ok: true, productos };
  } catch {
    return { ok: false, error: "No se ha podido leer el catálogo. Prueba otra vez." };
  }
}

const SELECT_BUSQUEDA =
  "id, proveedor_id, nombre, ref_proveedor, codigo_interno, codigo_barras, unidad, formato, unidades_formato, categoria, precio_catalogo, ultimo_precio, alias, compras_proveedor!inner(nombre, pedible)" as const;

/** Busca productos pedibles de la cuenta por nombre, referencia, código interno o alias (≥ 2
    letras). Primero los del catálogo del centro (con su frecuencia), luego el resto (veces = 0). */
export async function buscarProductos(entrada: {
  centro_id: string;
  texto: string;
  proveedor_id?: string | null;
  /** Por defecto 20, máximo 50. */
  limite?: number;
}): Promise<Resultado<{ productos: ProductoCatalogo[] }>> {
  const ctx = await exigirPedidos();
  try {
    const texto = limpiarTexto(entrada?.texto, 100);
    const norm = normalizarTexto(texto);
    if (!texto || !norm || norm.replace(/\s/g, "").length < 2) return { ok: true, productos: [] };
    if (!esUuid(entrada.centro_id)) return { ok: false, error: "Elige un centro" };
    const proveedorId = entrada.proveedor_id ?? null;
    if (proveedorId !== null && !esUuid(proveedorId)) return { ok: false, error: "Elige un proveedor" };
    const limite = Math.min(50, Math.max(1, Math.floor(Number(entrada.limite) || 20)));

    const palabras = norm.split(" ").filter(Boolean).slice(0, 6);
    const codigo = sanearFiltro(texto);

    // A) nombre: todas las palabras, al principio de palabra, con o sin acentos.
    let qNombre = ctx.supabase
      .from("compras_producto")
      .select(SELECT_BUSQUEDA)
      .eq("cuenta_id", ctx.cuentaId)
      .eq("activo", true)
      .eq("pedible", true)
      .eq("compras_proveedor.pedible", true);
    for (const p of palabras) qNombre = qNombre.filter("nombre", "imatch", patronPalabra(p));
    if (proveedorId) qNombre = qNombre.eq("proveedor_id", proveedorId);

    // B) referencia del proveedor, código interno o código de barras.
    let qCodigo = ctx.supabase
      .from("compras_producto")
      .select(SELECT_BUSQUEDA)
      .eq("cuenta_id", ctx.cuentaId)
      .eq("activo", true)
      .eq("pedible", true)
      .eq("compras_proveedor.pedible", true)
      .or(`ref_proveedor.ilike."%${codigo}%",codigo_interno.ilike."%${codigo}%",codigo_barras.eq."${codigo}"`);
    if (proveedorId) qCodigo = qCodigo.eq("proveedor_id", proveedorId);

    // C) alias aprendidos (frase normalizada).
    const qAlias = ctx.supabase
      .from("compras_pedido_alias")
      .select("producto_id, centro_id, frase_norm")
      .eq("cuenta_id", ctx.cuentaId)
      .ilike("frase_norm", `%${norm}%`)
      .order("usos", { ascending: false })
      .limit(50);

    const [centro, rNombre, rCodigo, rAlias] = await Promise.all([
      centroDeLaCuenta(ctx, entrada.centro_id),
      qNombre.limit(60),
      codigo ? qCodigo.limit(20) : Promise.resolve({ data: [], error: null }),
      qAlias,
    ]);
    if (!centro) return { ok: false, error: "Elige un centro" };
    if (rNombre.error && rCodigo.error && rAlias.error) return { ok: false, error: "No se ha podido buscar. Prueba otra vez." };

    type Fila = NonNullable<typeof rNombre.data>[number];
    const filas = new Map<string, Fila>();
    const puntos = new Map<string, number>();
    const puntuar = (id: string, p: number) => puntos.set(id, Math.max(puntos.get(id) ?? 0, p));
    const codigoMin = codigo.toLowerCase();

    for (const f of [...(rNombre.data ?? []), ...((rCodigo.data as Fila[] | null) ?? [])]) {
      filas.set(f.id, f);
      const n = normalizarTexto(f.nombre) ?? "";
      if (
        (f.ref_proveedor && f.ref_proveedor.toLowerCase() === codigoMin) ||
        (f.codigo_interno && f.codigo_interno.toLowerCase() === codigoMin) ||
        (f.codigo_barras && f.codigo_barras === codigo)
      )
        puntuar(f.id, 100);
      if (n === norm) puntuar(f.id, 95);
      else if (n.startsWith(norm)) puntuar(f.id, 80);
      else if (n.includes(norm)) puntuar(f.id, 60);
      else if (palabras.every((p) => n.includes(p))) puntuar(f.id, 40);
      if (f.ref_proveedor?.toLowerCase().includes(codigoMin)) puntuar(f.id, 50);
      puntuar(f.id, 10);
    }

    // Alias: los productos que falten se leen aparte (mismas condiciones).
    const porAlias = new Map<string, number>();
    for (const a of rAlias.data ?? []) {
      const p = (a.frase_norm === norm ? 90 : 70) + (a.centro_id === centro.id ? 3 : 0);
      porAlias.set(a.producto_id, Math.max(porAlias.get(a.producto_id) ?? 0, p));
    }
    const faltan = [...porAlias.keys()].filter((id) => !filas.has(id));
    if (faltan.length) {
      let q = ctx.supabase
        .from("compras_producto")
        .select(SELECT_BUSQUEDA)
        .eq("cuenta_id", ctx.cuentaId)
        .eq("activo", true)
        .eq("pedible", true)
        .eq("compras_proveedor.pedible", true)
        .in("id", faltan);
      if (proveedorId) q = q.eq("proveedor_id", proveedorId);
      const { data } = await q;
      for (const f of data ?? []) filas.set(f.id, f);
    }
    for (const [id, p] of porAlias) if (filas.has(id)) puntuar(id, p);

    const productos = [...filas.values()]
      .sort(
        (a, b) =>
          (puntos.get(b.id) ?? 0) - (puntos.get(a.id) ?? 0) || (a.nombre ?? "").localeCompare(b.nombre ?? "", "es"),
      )
      .slice(0, limite)
      .filter((f) => !!f.proveedor_id)
      .map((f) =>
        aProductoCatalogo({
          producto_id: f.id,
          proveedor_id: f.proveedor_id!,
          proveedor_nombre: f.compras_proveedor?.nombre ?? null,
          nombre: f.nombre,
          ref_proveedor: f.ref_proveedor,
          codigo_interno: f.codigo_interno,
          unidad: f.unidad,
          formato: f.formato,
          unidades_formato: f.unidades_formato,
          categoria: f.categoria,
          precio_catalogo: f.precio_catalogo,
          veces: 0,
          cantidad_total: 0,
          ultima_cantidad: null,
          ultimo_precio: f.ultimo_precio,
          ultima_fecha: null,
          alias: f.alias,
        }),
      );
    return { ok: true, productos };
  } catch {
    return { ok: false, error: "No se ha podido buscar. Prueba otra vez." };
  }
}

/* ═══════════════════════ Guardar borradores ═══════════════════════ */

/** Crea un borrador por grupo (proveedor) con sus líneas fusionadas; con unir_a_borrador, añade a
    un borrador existente del mismo centro y proveedor. Aprende alias de las líneas corregidas. */
export async function guardarBorradores(
  entrada: EntradaGuardarBorradores,
): Promise<Resultado<{ pedidos: PedidoCreado[]; aprendidos: number }>> {
  const ctx = await exigirPedidos();
  try {
    /* ─── Validación de la cabecera ─── */
    if (!entrada || typeof entrada !== "object") return { ok: false, error: "No hay nada que guardar" };
    if (!esUuid(entrada.centro_id)) return { ok: false, error: "Elige un centro" };
    if (!(ORIGENES_PEDIDO as readonly string[]).includes(entrada.origen)) return { ok: false, error: "Origen del pedido no válido" };
    const origen = entrada.origen as OrigenPedido;
    const idioma = idiomaDe(entrada.idioma);
    const grupos = Array.isArray(entrada.grupos) ? entrada.grupos : [];
    if (!grupos.length) return { ok: false, error: "No hay nada que guardar" };
    if (grupos.length > 20) return { ok: false, error: "Demasiados proveedores a la vez (máximo 20): guárdalo en dos veces" };
    const transcripcion = limpiarTextoLargo(entrada.transcripcion, 2 * MAX_TEXTO_PEDIDO);
    const interp = sanearInterpretacion(entrada.interpretacion);
    const interpretacion: Json | null = interp ? (interp as unknown as Json) : null;
    const hoy = hoyMadrid();

    const centro = await centroDeLaCuenta(ctx, entrada.centro_id);
    if (!centro) return { ok: false, error: "Elige un centro" };

    /* ─── Validación de grupos y líneas ─── */
    type GrupoValido = {
      proveedor_id: string | null;
      fecha_entrega: string | null;
      notas: string | null;
      lineas: LineaValida[];
    };
    const validos: GrupoValido[] = [];
    for (const g of grupos) {
      if (!g || typeof g !== "object") return { ok: false, error: "Hay un grupo de líneas que no es válido" };
      const proveedor_id = g.proveedor_id == null ? null : esUuid(g.proveedor_id) ? g.proveedor_id : undefined;
      if (proveedor_id === undefined) return { ok: false, error: "Hay un proveedor que no es válido" };
      let fecha_entrega: string | null = null;
      if (g.fecha_entrega != null && g.fecha_entrega !== "") {
        if (!esFechaISO(g.fecha_entrega)) return { ok: false, error: "La fecha de entrega no es válida" };
        if (g.fecha_entrega < hoy) return { ok: false, error: "La fecha de entrega ya ha pasado" };
        fecha_entrega = g.fecha_entrega;
      }
      const lineasIn = Array.isArray(g.lineas) ? g.lineas : [];
      if (!lineasIn.length) return { ok: false, error: "Hay un proveedor sin líneas" };
      if (lineasIn.length > 200) return { ok: false, error: "Demasiadas líneas para un proveedor (máximo 200)" };
      const lineas: LineaValida[] = [];
      for (const l of lineasIn) {
        const v = validarLinea(l);
        if (typeof v === "string") return { ok: false, error: v };
        lineas.push(v);
      }
      validos.push({ proveedor_id, fecha_entrega, notas: limpiarTextoLargo(g.notas, 1000), lineas });
    }

    // Proveedores: de la cuenta y disponibles para pedidos.
    const proveedores = new Map<string, ProveedorBase>();
    for (const id of new Set(validos.map((g) => g.proveedor_id).filter((x): x is string => !!x))) {
      const p = await leerProveedor(ctx, id);
      if (!p) return { ok: false, error: "No se ha encontrado uno de los proveedores" };
      if (!p.pedible) return { ok: false, error: `${p.nombre} no está disponible para pedidos (Ajustes)` };
      proveedores.set(id, p);
    }

    // Productos: de la cuenta, activos y del mismo proveedor que su grupo.
    const productos = await leerProductos(
      ctx,
      validos.flatMap((g) => g.lineas.map((l) => l.producto_id).filter((x): x is string => !!x)),
    );
    if (!productos) return { ok: false, error: "No se han podido comprobar los productos. Prueba otra vez." };
    for (const g of validos) {
      for (const l of g.lineas) {
        if (!l.producto_id) continue;
        const p = productos.get(l.producto_id);
        if (!p || !p.activo) return { ok: false, error: "Un producto ya no está disponible: quítalo o cámbialo" };
        if ((p.proveedor_id ?? null) !== g.proveedor_id) return { ok: false, error: `«${nombreProducto(p)}» es de otro proveedor` };
        if (l.precio_estimado === null) l.precio_estimado = precioDe(p);
      }
    }

    /* ─── Guardado, grupo a grupo ─── */
    const creados: PedidoCreado[] = [];
    const nuevosIds: string[] = [];
    const pendientesAlias: AliasPendiente[] = [];

    const fallo = async (error: string): Promise<{ ok: false; error: string }> => {
      // Deshace los pedidos creados en esta llamada; lo añadido a borradores que ya existían se queda.
      if (nuevosIds.length) {
        await ctx.supabase.from("compras_pedido").delete().in("id", nuevosIds).eq("cuenta_id", ctx.cuentaId).eq("estado", "borrador");
      }
      const unidos = creados.filter((c) => c.unido).map((c) => c.numero);
      return {
        ok: false,
        error: unidos.length ? `${error} Ya se añadieron líneas a ${unidos.join(", ")}: revísalos antes de repetir.` : error,
      };
    };

    for (const g of validos) {
      // Aprender ANTES de fusionar (frases originales, una por línea).
      // (si el navegador ya fusionó líneas, texto_original trae « + »: frasesDe las separa).
      const alias = g.lineas
        .filter(debeAprender)
        .flatMap((l) =>
          frasesDe(l.texto_original).map((frase) => ({ frase, producto_id: l.producto_id!, unidad: normalizarUnidad(l.unidad) })),
        );
      // Misma regla que fusionarLineasGuardar (producto + unidad normalizada), conservando el tipo.
      const fusionadas = fusionarLineas(g.lineas, (x) => x.producto_id);
      const proveedorNombre = g.proveedor_id ? (proveedores.get(g.proveedor_id)?.nombre ?? null) : null;

      // ¿Hay ya un borrador del mismo centro y proveedor?
      let existente: {
        id: string;
        numero: string;
        notas: string | null;
        fecha_entrega: string | null;
        origen: string;
        transcripcion: string | null;
        idioma: string | null;
        interpretacion: unknown;
      } | null = null;
      if (entrada.unir_a_borrador === true && g.proveedor_id) {
        const { data, error } = await ctx.supabase
          .from("compras_pedido")
          .select("id, numero, notas, fecha_entrega, origen, transcripcion, idioma, interpretacion")
          .eq("cuenta_id", ctx.cuentaId)
          .eq("centro_id", centro.id)
          .eq("proveedor_id", g.proveedor_id)
          .eq("estado", "borrador")
          .order("creado_en", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) return await fallo(errorLegible(error, "No se ha podido guardar. Prueba otra vez."));
        existente = data;
      }

      if (existente) {
        const { data: actuales, error: eAct } = await ctx.supabase
          .from("compras_pedido_linea")
          .select("id, producto_id, unidad, cantidad, orden, nota, texto_original")
          .eq("pedido_id", existente.id)
          .eq("cuenta_id", ctx.cuentaId)
          .order("orden")
          .order("creado_en");
        if (eAct) return await fallo(errorLegible(eAct));
        const lista = actuales ?? [];
        const porClave = new Map<string, (typeof lista)[number]>();
        for (const a of lista) {
          if (!a.producto_id) continue;
          const k = `${a.producto_id}|${normalizarUnidad(a.unidad) ?? ""}`;
          if (!porClave.has(k)) porClave.set(k, a);
        }
        const sumas: { id: string; cantidad: number; nota: string | null; texto_original: string | null }[] = [];
        const nuevas: LineaValida[] = [];
        for (const l of fusionadas) {
          const a = l.producto_id ? porClave.get(`${l.producto_id}|${normalizarUnidad(l.unidad) ?? ""}`) : undefined;
          if (!a) {
            nuevas.push(l);
            continue;
          }
          const unir = (x: string | null, y: string | null, sep: string) =>
            [...new Set([x, y].flatMap((t) => (t ?? "").split(sep)).map((t) => t.trim()).filter(Boolean))].join(sep) || null;
          sumas.push({
            id: a.id,
            cantidad: Math.min(MAX_CANTIDAD, redondear(Number(a.cantidad) + l.cantidad)),
            nota: unir(a.nota, l.nota, " · ")?.slice(0, 300) ?? null,
            texto_original: unir(a.texto_original, l.texto_original, " + ")?.slice(0, 600) ?? null,
          });
        }
        const maxOrden = lista.reduce((m, a) => Math.max(m, a.orden ?? 0), 0);
        if (nuevas.length) {
          const { error } = await ctx.supabase.from("compras_pedido_linea").insert(
            nuevas.map((l, i) => ({
              pedido_id: existente!.id,
              producto_id: l.producto_id,
              texto_original: l.texto_original,
              descripcion: l.descripcion,
              cantidad: l.cantidad,
              unidad: l.unidad,
              precio_estimado: l.precio_estimado,
              confianza: l.confianza,
              nota: l.nota,
              orden: maxOrden + 1 + i,
            })),
          );
          if (error) return await fallo(errorLegible(error));
        }
        for (const s of sumas) {
          const { error } = await ctx.supabase
            .from("compras_pedido_linea")
            .update({ cantidad: s.cantidad, nota: s.nota, texto_original: s.texto_original })
            .eq("id", s.id)
            .eq("cuenta_id", ctx.cuentaId);
          if (error) return await fallo(errorLegible(error));
        }
        const cambios: TablesUpdate<"compras_pedido"> = {};
        if (g.notas) {
          const prev = existente.notas?.trim();
          if (!prev) cambios.notas = g.notas;
          else if (!prev.includes(g.notas)) cambios.notas = `${prev} · ${g.notas}`.slice(0, 2000);
        }
        if (!existente.fecha_entrega && g.fecha_entrega) cambios.fecha_entrega = g.fecha_entrega;
        if (existente.origen !== origen) cambios.origen = "mixto";
        if (transcripcion) {
          cambios.transcripcion = existente.transcripcion?.trim()
            ? `${existente.transcripcion.trim()}\n\n${transcripcion}`.slice(0, 20_000)
            : transcripcion;
        }
        if (existente.interpretacion == null && interpretacion) cambios.interpretacion = interpretacion;
        if (!existente.idioma && idioma) cambios.idioma = idioma;
        if (Object.keys(cambios).length) {
          const { error } = await ctx.supabase
            .from("compras_pedido")
            .update(cambios)
            .eq("id", existente.id)
            .eq("cuenta_id", ctx.cuentaId)
            .eq("estado", "borrador");
          if (error) return await fallo(errorLegible(error));
        }
        creados.push({
          id: existente.id,
          numero: existente.numero,
          proveedor_id: g.proveedor_id,
          proveedor_nombre: proveedorNombre,
          n_lineas: lista.length + nuevas.length,
          unido: true,
        });
      } else {
        const { data: ped, error } = await ctx.supabase
          .from("compras_pedido")
          .insert({
            cuenta_id: ctx.cuentaId,
            centro_id: centro.id,
            proveedor_id: g.proveedor_id,
            estado: "borrador",
            fecha_entrega: g.fecha_entrega,
            notas: g.notas,
            origen,
            transcripcion,
            interpretacion,
            idioma,
          })
          .select("id, numero")
          .single();
        if (error || !ped) return await fallo(errorLegible(error, "No se ha podido crear el borrador. Prueba otra vez."));
        nuevosIds.push(ped.id);
        const { error: eLin } = await ctx.supabase.from("compras_pedido_linea").insert(
          fusionadas.map((l, i) => ({
            pedido_id: ped.id,
            producto_id: l.producto_id,
            texto_original: l.texto_original,
            descripcion: l.descripcion,
            cantidad: l.cantidad,
            unidad: l.unidad,
            precio_estimado: l.precio_estimado,
            confianza: l.confianza,
            nota: l.nota,
            orden: i + 1,
          })),
        );
        if (eLin) return await fallo(errorLegible(eLin, "No se han podido guardar las líneas. Prueba otra vez."));
        creados.push({
          id: ped.id,
          numero: ped.numero,
          proveedor_id: g.proveedor_id,
          proveedor_nombre: proveedorNombre,
          n_lineas: fusionadas.length,
          unido: false,
        });
      }
      pendientesAlias.push(...alias);
    }

    const aprendidos = pendientesAlias.length ? await aprender(ctx, pendientesAlias, centro.id, idioma) : 0;
    return { ok: true, pedidos: creados, aprendidos };
  } catch {
    return { ok: false, error: "No se ha podido guardar. Prueba otra vez." };
  }
}

/* ═══════════════════════ Editar un borrador ═══════════════════════ */

/** Cambia proveedor, fecha de entrega o notas de un borrador. */
export async function actualizarBorrador(pedidoId: string, cambios: CambiosBorrador): Promise<Resultado> {
  const ctx = await exigirPedidos();
  try {
    const pedido = await leerBorrador(ctx, pedidoId);
    if (typeof pedido === "string") return { ok: false, error: pedido };
    if (!cambios || typeof cambios !== "object") return { ok: true };
    const tiene = (k: keyof CambiosBorrador) => Object.prototype.hasOwnProperty.call(cambios, k) && cambios[k] !== undefined;
    const upd: TablesUpdate<"compras_pedido"> = {};

    if (tiene("proveedor_id")) {
      const nuevo = cambios.proveedor_id ?? null;
      if (nuevo !== null && !esUuid(nuevo)) return { ok: false, error: "Elige un proveedor" };
      if (nuevo !== pedido.proveedor_id) {
        if (nuevo) {
          const prov = await leerProveedor(ctx, nuevo);
          if (!prov) return { ok: false, error: "No se ha encontrado el proveedor" };
          if (!prov.pedible) return { ok: false, error: `${prov.nombre} no está disponible para pedidos (Ajustes)` };
        }
        const { data: lineas, error } = await ctx.supabase
          .from("compras_pedido_linea")
          .select("id, compras_producto(proveedor_id)")
          .eq("pedido_id", pedido.id)
          .eq("cuenta_id", ctx.cuentaId)
          .not("producto_id", "is", null);
        if (error) return { ok: false, error: errorLegible(error) };
        if ((lineas ?? []).some((l) => (l.compras_producto?.proveedor_id ?? null) !== nuevo)) {
          return { ok: false, error: ERROR_OTRO_PROVEEDOR_PEDIDO };
        }
        upd.proveedor_id = nuevo;
      }
    }
    if (tiene("fecha_entrega")) {
      const f = cambios.fecha_entrega || null;
      if (f !== null) {
        if (!esFechaISO(f)) return { ok: false, error: "La fecha de entrega no es válida" };
        if (f < hoyMadrid()) return { ok: false, error: "La fecha de entrega ya ha pasado" };
      }
      upd.fecha_entrega = f;
    }
    if (tiene("notas")) upd.notas = limpiarTextoLargo(cambios.notas, 1000);

    if (!Object.keys(upd).length) return { ok: true };
    const { data, error } = await ctx.supabase
      .from("compras_pedido")
      .update(upd)
      .eq("id", pedido.id)
      .eq("cuenta_id", ctx.cuentaId)
      .eq("estado", "borrador")
      .select("id");
    if (error) return { ok: false, error: errorLegible(error) };
    if (!data?.length) return { ok: false, error: ERROR_NO_BORRADOR };
    return { ok: true };
  } catch {
    return { ok: false, error: "No se ha podido guardar. Prueba otra vez." };
  }
}

/** Añade una línea a un borrador. Si ya hay una del mismo producto y unidad, suma la cantidad. */
export async function anadirLinea(
  pedidoId: string,
  linea: LineaGuardar,
): Promise<Resultado<{ linea: LineaPedido; fusionada: boolean }>> {
  const ctx = await exigirPedidos();
  try {
    const pedido = await leerBorrador(ctx, pedidoId);
    if (typeof pedido === "string") return { ok: false, error: pedido };
    const l = validarLinea(linea);
    if (typeof l === "string") return { ok: false, error: l };

    let producto: ProductoBase | undefined;
    if (l.producto_id) {
      const prods = await leerProductos(ctx, [l.producto_id]);
      producto = prods?.get(l.producto_id);
      if (!producto || !producto.activo) return { ok: false, error: "Ese producto ya no está disponible" };
      const r = await proveedorParaProducto(ctx, pedido, producto);
      if ("error" in r) return { ok: false, error: r.error };
      if (r.asignar) {
        const e = await asignarProveedor(ctx, pedido.id, r.asignar);
        if (e) return { ok: false, error: e };
      }
      if (l.precio_estimado === null) l.precio_estimado = precioDe(producto);
    }

    const { data: actuales, error: eAct } = await ctx.supabase
      .from("compras_pedido_linea")
      .select("id, producto_id, unidad, cantidad, orden, nota, texto_original")
      .eq("pedido_id", pedido.id)
      .eq("cuenta_id", ctx.cuentaId)
      .order("orden")
      .order("creado_en");
    if (eAct) return { ok: false, error: errorLegible(eAct) };
    const lista = actuales ?? [];

    const igual = l.producto_id
      ? lista.find((a) => a.producto_id === l.producto_id && normalizarUnidad(a.unidad) === normalizarUnidad(l.unidad))
      : undefined;

    let lineaId: string;
    if (igual) {
      const unir = (x: string | null, y: string | null, sep: string) =>
        [...new Set([x, y].flatMap((t) => (t ?? "").split(sep)).map((t) => t.trim()).filter(Boolean))].join(sep) || null;
      const { error } = await ctx.supabase
        .from("compras_pedido_linea")
        .update({
          cantidad: Math.min(MAX_CANTIDAD, redondear(Number(igual.cantidad) + l.cantidad)),
          nota: unir(igual.nota, l.nota, " · ")?.slice(0, 300) ?? null,
          texto_original: unir(igual.texto_original, l.texto_original, " + ")?.slice(0, 600) ?? null,
        })
        .eq("id", igual.id)
        .eq("cuenta_id", ctx.cuentaId);
      if (error) return { ok: false, error: errorLegible(error) };
      lineaId = igual.id;
    } else {
      const maxOrden = lista.reduce((m, a) => Math.max(m, a.orden ?? 0), 0);
      const { data, error } = await ctx.supabase
        .from("compras_pedido_linea")
        .insert({
          pedido_id: pedido.id,
          producto_id: l.producto_id,
          texto_original: l.texto_original,
          descripcion: l.descripcion,
          cantidad: l.cantidad,
          unidad: l.unidad,
          precio_estimado: l.precio_estimado,
          confianza: l.confianza,
          nota: l.nota,
          orden: maxOrden + 1,
        })
        .select("id")
        .single();
      if (error || !data) return { ok: false, error: errorLegible(error) };
      lineaId = data.id;
    }

    if (debeAprender(l)) {
      await aprender(
        ctx,
        frasesDe(l.texto_original).map((frase) => ({ frase, producto_id: l.producto_id!, unidad: normalizarUnidad(l.unidad) })),
        pedido.centro_id,
        idiomaDe(pedido.idioma),
      );
    }

    const guardada = await leerLinea(ctx, lineaId);
    if (!guardada) return { ok: false, error: "La línea se ha guardado, pero no se ha podido leer. Recarga el pedido." };
    return { ok: true, linea: guardada, fusionada: !!igual };
  } catch {
    return { ok: false, error: "No se ha podido guardar. Prueba otra vez." };
  }
}

/** Edita una línea de un borrador. Si cambia producto o unidad y hay texto_original, aprende alias. */
export async function actualizarLinea(lineaId: string, cambios: CambiosLinea): Promise<Resultado<{ linea: LineaPedido }>> {
  const ctx = await exigirPedidos();
  try {
    if (!esUuid(lineaId)) return { ok: false, error: "No se ha encontrado la línea" };
    const { data: actual, error: eL } = await ctx.supabase
      .from("compras_pedido_linea")
      .select("id, pedido_id, producto_id, texto_original, descripcion, unidad")
      .eq("id", lineaId)
      .eq("cuenta_id", ctx.cuentaId)
      .maybeSingle();
    if (eL) return { ok: false, error: errorLegible(eL) };
    if (!actual) return { ok: false, error: "No se ha encontrado la línea" };
    const pedido = await leerBorrador(ctx, actual.pedido_id);
    if (typeof pedido === "string") return { ok: false, error: pedido };
    if (!cambios || typeof cambios !== "object") {
      const l = await leerLinea(ctx, lineaId);
      return l ? { ok: true, linea: l } : { ok: false, error: "No se ha encontrado la línea" };
    }
    const tiene = (k: keyof CambiosLinea) => Object.prototype.hasOwnProperty.call(cambios, k) && cambios[k] !== undefined;
    const upd: TablesUpdate<"compras_pedido_linea"> = {};

    let productoFinal: string | null = actual.producto_id;
    if (tiene("producto_id")) {
      const nuevo = cambios.producto_id ?? null;
      if (nuevo !== null && !esUuid(nuevo)) return { ok: false, error: "Ese producto no es válido" };
      if (nuevo && nuevo !== actual.producto_id) {
        const prods = await leerProductos(ctx, [nuevo]);
        const producto = prods?.get(nuevo);
        if (!producto || !producto.activo) return { ok: false, error: "Ese producto ya no está disponible" };
        const r = await proveedorParaProducto(ctx, pedido, producto, actual.id);
        if ("error" in r) return { ok: false, error: r.error };
        if (r.asignar) {
          const e = await asignarProveedor(ctx, pedido.id, r.asignar);
          if (e) return { ok: false, error: e };
        }
        if (!tiene("precio_estimado")) upd.precio_estimado = precioDe(producto);
      }
      upd.producto_id = nuevo;
      productoFinal = nuevo;
    }
    if (tiene("descripcion")) upd.descripcion = limpiarTexto(cambios.descripcion, 300);
    if (tiene("cantidad")) {
      const c = cantidadValida(cambios.cantidad);
      if (c === null) return { ok: false, error: `La cantidad tiene que ser mayor que 0 y como mucho ${MAX_CANTIDAD.toLocaleString("es-ES")}` };
      upd.cantidad = c;
    }
    let unidadFinal: string | null = actual.unidad;
    if (tiene("unidad")) {
      upd.unidad = unidadValida(cambios.unidad);
      unidadFinal = upd.unidad;
    }
    if (tiene("precio_estimado")) {
      const p = precioValido(cambios.precio_estimado);
      if (p === "error") return { ok: false, error: "El precio no es válido" };
      upd.precio_estimado = p;
    }
    if (tiene("nota")) upd.nota = limpiarTexto(cambios.nota, 300);

    // Sin producto hace falta saber qué se pide.
    const descripcionFinal = "descripcion" in upd ? (upd.descripcion ?? null) : actual.descripcion;
    if (!productoFinal && !descripcionFinal?.trim() && !actual.texto_original?.trim()) {
      return { ok: false, error: "Escribe qué se pide o elige un producto" };
    }

    if (Object.keys(upd).length) {
      const { data, error } = await ctx.supabase
        .from("compras_pedido_linea")
        .update(upd)
        .eq("id", actual.id)
        .eq("cuenta_id", ctx.cuentaId)
        .select("id");
      if (error) return { ok: false, error: errorLegible(error) };
      if (!data?.length) return { ok: false, error: "No se ha encontrado la línea" };
    }

    // Aprender si cambió el producto o la unidad de una línea dicha (y queda con producto).
    // Una línea fusionada trae varias frases unidas con « + »: se aprende cada una por separado.
    const cambioProducto = productoFinal !== actual.producto_id;
    const cambioUnidad = normalizarUnidad(unidadFinal) !== normalizarUnidad(actual.unidad);
    const frases = frasesDe(actual.texto_original);
    if (productoFinal && frases.length && (cambioProducto || cambioUnidad)) {
      await aprender(
        ctx,
        frases.map((frase) => ({ frase, producto_id: productoFinal, unidad: normalizarUnidad(unidadFinal) })),
        pedido.centro_id,
        idiomaDe(pedido.idioma),
      );
    }

    const l = await leerLinea(ctx, actual.id);
    if (!l) return { ok: false, error: "La línea se ha guardado, pero no se ha podido leer. Recarga el pedido." };
    return { ok: true, linea: l };
  } catch {
    return { ok: false, error: "No se ha podido guardar. Prueba otra vez." };
  }
}

/** Quita una línea de un borrador. */
export async function quitarLinea(lineaId: string): Promise<Resultado> {
  const ctx = await exigirPedidos();
  try {
    if (!esUuid(lineaId)) return { ok: false, error: "No se ha encontrado la línea" };
    const { data: actual, error: eL } = await ctx.supabase
      .from("compras_pedido_linea")
      .select("id, pedido_id")
      .eq("id", lineaId)
      .eq("cuenta_id", ctx.cuentaId)
      .maybeSingle();
    if (eL) return { ok: false, error: errorLegible(eL) };
    if (!actual) return { ok: true }; // ya no está: idempotente
    const pedido = await leerBorrador(ctx, actual.pedido_id);
    if (typeof pedido === "string") return { ok: false, error: pedido };
    const { error } = await ctx.supabase.from("compras_pedido_linea").delete().eq("id", actual.id).eq("cuenta_id", ctx.cuentaId);
    if (error) return { ok: false, error: errorLegible(error, "No se ha podido quitar la línea. Prueba otra vez.") };
    return { ok: true };
  } catch {
    return { ok: false, error: "No se ha podido quitar la línea. Prueba otra vez." };
  }
}

/** Borra un borrador entero (solo estado «borrador»; las líneas caen en cascada). */
export async function borrarBorrador(pedidoId: string): Promise<Resultado> {
  const ctx = await exigirPedidos();
  try {
    const pedido = await leerBorrador(ctx, pedidoId);
    if (typeof pedido === "string") return { ok: false, error: pedido };
    const { data, error } = await ctx.supabase
      .from("compras_pedido")
      .delete()
      .eq("id", pedido.id)
      .eq("cuenta_id", ctx.cuentaId)
      .eq("estado", "borrador")
      .select("id");
    if (error) return { ok: false, error: errorLegible(error, "No se ha podido borrar. Prueba otra vez.") };
    if (!data?.length) return { ok: false, error: ERROR_NO_BORRADOR };
    return { ok: true };
  } catch {
    return { ok: false, error: "No se ha podido borrar. Prueba otra vez." };
  }
}

/** Alta o refuerzo de un alias (rpc pedidos_aprender_alias). */
export async function aprenderAlias(entrada: {
  frase: string;
  producto_id: string;
  unidad?: string | null;
  centro_id?: string | null;
  idioma?: IdiomaDictado | null;
}): Promise<Resultado<{ alias_id: string }>> {
  const ctx = await exigirPedidos();
  try {
    const frase = limpiarTexto(entrada?.frase, 200);
    if (!frase || !normalizarTexto(frase)) return { ok: false, error: "Escribe la frase" };
    if (!esUuid(entrada.producto_id)) return { ok: false, error: "Elige un producto" };
    const centroId = entrada.centro_id ?? null;
    if (centroId !== null && !esUuid(centroId)) return { ok: false, error: "Elige un centro" };
    const [prods, centro] = await Promise.all([
      leerProductos(ctx, [entrada.producto_id]),
      centroId ? centroDeLaCuenta(ctx, centroId) : Promise.resolve(null),
    ]);
    if (!prods?.get(entrada.producto_id)) return { ok: false, error: "No se ha encontrado el producto" };
    if (centroId && !centro) return { ok: false, error: "Elige un centro" };
    const { data, error } = await ctx.supabase.rpc("pedidos_aprender_alias", {
      p_frase: frase,
      p_producto: entrada.producto_id,
      p_unidad: unidadValida(entrada.unidad) ?? undefined,
      p_centro: centroId ?? undefined,
      p_idioma: idiomaDe(entrada.idioma) ?? undefined,
    });
    if (error || !data) return { ok: false, error: errorLegible(error, "No se ha podido guardar el alias. Prueba otra vez.") };
    return { ok: true, alias_id: data };
  } catch {
    return { ok: false, error: "No se ha podido guardar el alias. Prueba otra vez." };
  }
}
