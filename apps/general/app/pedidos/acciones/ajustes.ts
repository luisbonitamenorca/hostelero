"use server";

/* Ajustes de Pedidos (constructor C): datos de pedido de cada proveedor, importación de catálogo
   por trozos, alias aprendidos y «Pedir catálogo y albaranes por email».
   Contrato: docs/pedidos-contratos.md §3.5. SOLO direccion o responsable_area (la RLS de
   compras_proveedor/compras_producto deja escribir a cualquiera de la cuenta: el rol se mira aquí). */

import { enviarCorreo } from "@/lib/correo";
import { configPedidos, errorLegible, exigirGestionPedidos } from "../servidor";
import type { CtxPedidos } from "../servidor";
import {
  comoProveedor,
  enlaceMailto,
  esEmail,
  esCanalPedido,
  esUuid,
  horaCorta,
  limpiarTexto,
  limpiarTextoLargo,
  mapeoVacio,
  normalizarTexto,
  normalizarUnidad,
  normalizarWhatsApp,
  peticionProveedor,
  redondear,
  trozos,
} from "../lib-pedidos";
import { CAMPOS_CATALOGO, SELECT_PROVEEDOR, TAM_TROZO_IMPORT } from "../tipos";
import type {
  AliasAprendido,
  ConfigPedidos,
  DatosPedidoProveedor,
  DetalleImportacion,
  EntradaIniciarImportacion,
  ErrorConAlternativa,
  ErrorFilaCatalogo,
  FilaCatalogo,
  ImportacionCatalogo,
  Json,
  MapeoColumnas,
  PeticionProveedor,
  ProveedorAjustes,
  ProveedorPedido,
  Resultado,
  ResultadoTrozo,
} from "../tipos";

/* ═══════════════════════ Ayudas internas (sin export: fichero "use server") ═══════════════════════ */

type ErrorPg = { code?: string; message?: string } | null;

const NO_PROVEEDOR = "No se ha encontrado el proveedor";
const NO_IMPORTACION = "No se ha encontrado la importación";

/** Lee todas las páginas de 1.000 filas (PostgREST corta ahí). `pagina` debe ordenar de forma estable. */
async function todasLasFilas<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: ErrorPg }>,
): Promise<{ filas: T[]; error: ErrorPg }> {
  const filas: T[] = [];
  for (let desde = 0; desde < 200_000; desde += 1000) {
    const { data, error } = await pagina(desde, desde + 999);
    if (error) return { filas, error };
    const d = data ?? [];
    filas.push(...d);
    if (d.length < 1000) break;
  }
  return { filas, error: null };
}

/** Ejecuta `fn` sobre cada elemento con como mucho `n` a la vez; conserva el orden del resultado. */
async function enParalelo<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < items.length) {
      const k = siguiente++;
      out[k] = await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, trabajador));
  return out;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Texto de una celda que llega del navegador (string o número). */
const txt = (v: unknown, max: number): string | null => {
  if (typeof v === "number") return Number.isFinite(v) ? String(v).slice(0, max) : null;
  return limpiarTexto(v, max);
};

/** Quita lo que rompe la sintaxis de filtros de PostgREST (.or/.ilike) y los comodines. */
const sanear = (t: string): string => t.replace(/[,()%*_\\"]/g, " ").replace(/\s+/g, " ").trim();

const mismoNumero = (a: number, b: number | null): boolean => b != null && Math.abs(a - Number(b)) < 1e-9;

function detalleVacio(): DetalleImportacion {
  return {
    cabeceras: [],
    mapeo: mapeoVacio(),
    filas_archivo: 0,
    errores_filas: [],
    avisos: [],
    sin_cambios: 0,
    cerrada: false,
    cerrada_en: null,
  };
}

/** compras_catalogo_import.detalle → DetalleImportacion (lectura defensiva del jsonb). */
function comoDetalle(j: unknown): DetalleImportacion | null {
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  const mapeo = mapeoVacio();
  if (o.mapeo && typeof o.mapeo === "object" && !Array.isArray(o.mapeo)) {
    const m = o.mapeo as Record<string, unknown>;
    for (const c of CAMPOS_CATALOGO) {
      const v = m[c];
      mapeo[c] = typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
    }
  }
  const errores_filas: ErrorFilaCatalogo[] = Array.isArray(o.errores_filas)
    ? o.errores_filas
        .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && !Array.isArray(e))
        .map((e) => ({
          fila: num(e.fila) ?? 0,
          ref: typeof e.ref === "string" ? e.ref : null,
          error: typeof e.error === "string" ? e.error : String(e.error ?? ""),
        }))
    : [];
  return {
    cabeceras: Array.isArray(o.cabeceras) ? o.cabeceras.map((x) => (x == null ? "" : String(x))) : [],
    mapeo,
    filas_archivo: num(o.filas_archivo) ?? 0,
    errores_filas,
    avisos: Array.isArray(o.avisos) ? o.avisos.filter((x): x is string => typeof x === "string") : [],
    sin_cambios: num(o.sin_cambios) ?? 0,
    cerrada: o.cerrada === true,
    cerrada_en: typeof o.cerrada_en === "string" ? o.cerrada_en : null,
  };
}

const SELECT_IMPORT = "id, proveedor_id, archivo, filas, creados, actualizados, errores, detalle, creado_en" as const;

function aImportacion(f: {
  id: string;
  proveedor_id: string;
  archivo: string | null;
  filas: number;
  creados: number;
  actualizados: number;
  errores: number;
  detalle: unknown;
  creado_en: string;
}): ImportacionCatalogo {
  return {
    id: f.id,
    proveedor_id: f.proveedor_id,
    archivo: f.archivo,
    filas: f.filas ?? 0,
    creados: f.creados ?? 0,
    actualizados: f.actualizados ?? 0,
    errores: f.errores ?? 0,
    detalle: comoDetalle(f.detalle),
    creado_en: f.creado_en,
  };
}

/** Proveedor de la cuenta con sus datos de pedido (o null). */
async function proveedorDeLaCuenta(ctx: CtxPedidos, proveedorId: unknown): Promise<ProveedorPedido | null> {
  if (!esUuid(proveedorId)) return null;
  const { data } = await ctx.supabase
    .from("compras_proveedor")
    .select(SELECT_PROVEEDOR)
    .eq("id", proveedorId)
    .eq("cuenta_id", ctx.cuentaId)
    .maybeSingle();
  return data ? comoProveedor(data) : null;
}

/** Petición estándar al proveedor (peticionProveedor de lib-pedidos) con el punto 3: que confirmen
    a qué email/WhatsApp mandar los pedidos, diciendo adónde se mandan hoy. */
function componerPeticion(
  ctx: CtxPedidos,
  prov: ProveedorPedido,
  buzon: string | null,
): { asunto: string; texto: string; html: string } {
  const actual =
    prov.pedido_canal === "whatsapp" && prov.pedido_whatsapp
      ? `el WhatsApp +${prov.pedido_whatsapp}`
      : prov.pedido_email
        ? prov.pedido_email
        : prov.pedido_whatsapp
          ? `el WhatsApp +${prov.pedido_whatsapp}`
          : null;
  return peticionProveedor({
    cuenta_nombre: ctx.cuenta.nombre,
    proveedor_nombre: prov.nombre,
    buzon_albaranes: buzon,
    contacto: { nombre: ctx.perfil.nombre ?? null, correo: ctx.perfil.correo ?? null, telefono: null },
    confirmar_destino: { actual },
  });
}

/* ─── importación: tipos y normalización de filas ─── */

type ProductoImport = {
  id: string;
  ref_proveedor: string | null;
  nombre: string | null;
  alias: string[] | null;
  unidad: string | null;
  formato: string | null;
  unidades_formato: number | null;
  precio_catalogo: number | null;
  categoria: string | null;
  codigo_barras: string | null;
  activo: boolean;
};

type CambiosProducto = {
  unidad?: string;
  formato?: string;
  unidades_formato?: number;
  precio_catalogo?: number;
  categoria?: string;
  codigo_barras?: string;
  /** Solo para completar un producto que no tenía código (nunca se cambia uno que ya lo tiene). */
  ref_proveedor?: string;
  alias?: string[];
};

const refClave = (r: string | null | undefined): string | null => {
  const t = (r ?? "").trim().toLowerCase();
  return t || null;
};

/** Fila que llega del navegador → FilaCatalogo validada, o el error de la fila. */
function normalizarFila(f: unknown, i: number): { ok: true; fila: FilaCatalogo } | { ok: false; error: ErrorFilaCatalogo } {
  if (!f || typeof f !== "object" || Array.isArray(f)) {
    return { ok: false, error: { fila: i + 1, ref: null, error: "Fila no válida" } };
  }
  const o = f as Record<string, unknown>;
  const n = num(o.fila);
  const fila = n != null && Number.isInteger(n) && n > 0 && n < 10_000_000 ? n : i + 1;
  const ref = txt(o.ref, 60);
  const nombre = txt(o.nombre, 300);
  if (!ref && !nombre) return { ok: false, error: { fila, ref: null, error: "Fila sin código ni nombre" } };
  const unidadTxt = txt(o.unidad, 40);
  const unidad = unidadTxt ? (normalizarUnidad(unidadTxt)?.slice(0, 30) ?? null) : null;
  const uf = num(o.unidades_formato);
  const precio = num(o.precio);
  return {
    ok: true,
    fila: {
      fila,
      ref,
      nombre,
      formato: txt(o.formato, 80),
      unidad,
      unidades_formato: uf != null && uf > 0 && uf <= 1_000_000 ? redondear(uf, 3) : null,
      precio: precio != null && precio >= 0 && precio <= 1_000_000 ? redondear(precio, 4) : null,
      codigo_barras: txt(o.codigo_barras, 40),
      categoria: txt(o.categoria, 80),
    },
  };
}

/** Qué cambia en un producto existente con la fila del catálogo. NUNCA nombre ni proveedor (el
    trigger trg_propagar_nombre_producto reescribiría el histórico de compras), ni activo, pedible
    u origen (contrato §3.5). El código del proveedor solo se escribe con `completarRef`: producto
    que no tenía código y casa por nombre (misma regla que enlazar_producto_linea en Compras). */
function cambiosDe(f: FilaCatalogo, p: ProductoImport, completarRef: boolean): CambiosProducto {
  const c: CambiosProducto = {};
  if (completarRef && f.ref && !refClave(p.ref_proveedor)) c.ref_proveedor = f.ref;
  if (f.unidad != null && f.unidad !== p.unidad) c.unidad = f.unidad;
  if (f.formato != null && f.formato !== p.formato) c.formato = f.formato;
  if (f.unidades_formato != null && !mismoNumero(f.unidades_formato, p.unidades_formato)) c.unidades_formato = f.unidades_formato;
  if (f.precio != null && !mismoNumero(f.precio, p.precio_catalogo)) c.precio_catalogo = f.precio;
  if (f.categoria != null && f.categoria !== p.categoria) c.categoria = f.categoria;
  if (f.codigo_barras != null && f.codigo_barras !== p.codigo_barras) c.codigo_barras = f.codigo_barras;
  const nn = normalizarTexto(f.nombre);
  const alias = p.alias ?? [];
  if (
    f.nombre &&
    nn &&
    nn !== normalizarTexto(p.nombre) &&
    !alias.some((a) => normalizarTexto(a) === nn) &&
    alias.length < 20
  ) {
    c.alias = [...alias, f.nombre];
  }
  return c;
}

/* ═══════════════════════ Acciones ═══════════════════════ */

/** Todo lo de la pestaña: proveedores (también los no pedibles) con nº de productos, configuración
    de correo/IA y las últimas 20 importaciones. */
export async function cargarAjustes(): Promise<
  Resultado<{ proveedores: ProveedorAjustes[]; config: ConfigPedidos; importaciones: ImportacionCatalogo[] }>
> {
  const ctx = await exigirGestionPedidos();
  if (!ctx.ok) return ctx;
  try {
    const [provs, prods, imps] = await Promise.all([
      todasLasFilas((d, h) =>
        ctx.supabase
          .from("compras_proveedor")
          .select(SELECT_PROVEEDOR)
          .eq("cuenta_id", ctx.cuentaId)
          .order("nombre")
          .order("id")
          .range(d, h),
      ),
      todasLasFilas((d, h) =>
        ctx.supabase
          .from("compras_producto")
          .select("proveedor_id, catalogo_en")
          .eq("cuenta_id", ctx.cuentaId)
          .eq("activo", true)
          .order("id")
          .range(d, h),
      ),
      ctx.supabase
        .from("compras_catalogo_import")
        .select(SELECT_IMPORT)
        .eq("cuenta_id", ctx.cuentaId)
        .order("creado_en", { ascending: false })
        .limit(20),
    ]);
    if (provs.error) return { ok: false, error: errorLegible(provs.error, "No se han podido cargar los proveedores.") };
    if (prods.error) return { ok: false, error: errorLegible(prods.error, "No se han podido contar los productos.") };

    const cuenta = new Map<string, { n: number; cat: number }>();
    for (const p of prods.filas) {
      if (!p.proveedor_id) continue;
      const c = cuenta.get(p.proveedor_id) ?? { n: 0, cat: 0 };
      c.n += 1;
      if (p.catalogo_en) c.cat += 1;
      cuenta.set(p.proveedor_id, c);
    }

    const proveedores: ProveedorAjustes[] = provs.filas
      .map((f) => {
        const p = comoProveedor(f);
        const c = cuenta.get(p.id);
        return { ...p, n_productos: c?.n ?? 0, n_productos_catalogo: c?.cat ?? 0 };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    return {
      ok: true,
      proveedores,
      config: configPedidos(),
      importaciones: (imps.data ?? []).map(aImportacion),
    };
  } catch {
    return { ok: false, error: "No se han podido cargar los ajustes. Prueba otra vez." };
  }
}

/** Guarda los datos de pedido de un proveedor (validados y normalizados). */
export async function guardarDatosProveedor(
  proveedorId: string,
  datos: DatosPedidoProveedor,
): Promise<Resultado<{ proveedor: ProveedorPedido }>> {
  const ctx = await exigirGestionPedidos();
  if (!ctx.ok) return ctx;
  try {
    if (!esUuid(proveedorId)) return { ok: false, error: NO_PROVEEDOR };
    if (!datos || typeof datos !== "object") return { ok: false, error: "Faltan los datos del proveedor" };

    if (!esCanalPedido(datos.pedido_canal)) return { ok: false, error: "Elige cómo se envían los pedidos (email, WhatsApp, teléfono o web)" };

    const email = limpiarTexto(datos.pedido_email, 254);
    if (email && !esEmail(email)) return { ok: false, error: "El email no parece válido" };

    const waTxt = limpiarTexto(datos.pedido_whatsapp, 40);
    const whatsapp = waTxt ? normalizarWhatsApp(waTxt) : null;
    if (waTxt && !whatsapp) return { ok: false, error: "El WhatsApp no parece un número válido" };

    const telefono = limpiarTexto(datos.pedido_telefono, 30);

    let minimo: number | null = null;
    if (datos.pedido_minimo != null && (datos.pedido_minimo as unknown) !== "") {
      const m = num(datos.pedido_minimo);
      if (m == null || m < 0 || m > 1_000_000) return { ok: false, error: "El pedido mínimo no es válido" };
      minimo = redondear(m, 2);
    }

    let dias: number[] | null = null;
    if (datos.pedido_dias_reparto != null) {
      if (!Array.isArray(datos.pedido_dias_reparto)) return { ok: false, error: "Los días de reparto no son válidos" };
      const v = datos.pedido_dias_reparto.map((x) => num(x));
      if (v.some((x) => x == null || !Number.isInteger(x) || x < 1 || x > 7)) {
        return { ok: false, error: "Los días de reparto no son válidos" };
      }
      const unicos = [...new Set(v as number[])].sort((a, b) => a - b);
      dias = unicos.length ? unicos : null;
    }

    const horaTxt = limpiarTexto(datos.pedido_hora_corte, 10);
    const hora = horaTxt ? horaCorta(horaTxt) : "";
    if (horaTxt && !hora) return { ok: false, error: "La hora de corte no es válida (escríbela como 12:00)" };

    const notas = limpiarTextoLargo(datos.pedido_notas, 1000);

    const { data, error } = await ctx.supabase
      .from("compras_proveedor")
      .update({
        pedido_canal: datos.pedido_canal,
        pedido_email: email,
        pedido_whatsapp: whatsapp,
        pedido_telefono: telefono,
        pedido_minimo: minimo,
        pedido_dias_reparto: dias,
        pedido_hora_corte: hora || null,
        pedido_notas: notas,
        albaranes_por_email: datos.albaranes_por_email === true,
        pedible: datos.pedible === true,
      })
      .eq("id", proveedorId)
      .eq("cuenta_id", ctx.cuentaId)
      .select(SELECT_PROVEEDOR)
      .maybeSingle();
    if (error) return { ok: false, error: errorLegible(error) };
    if (!data) return { ok: false, error: NO_PROVEEDOR };
    return { ok: true, proveedor: comoProveedor(data) };
  } catch {
    return { ok: false, error: "No se ha podido guardar el proveedor. Prueba otra vez." };
  }
}

/** Abre una importación (fila en compras_catalogo_import con el mapeo) y devuelve su id. */
export async function iniciarImportacion(entrada: EntradaIniciarImportacion): Promise<Resultado<{ importacion_id: string }>> {
  const ctx = await exigirGestionPedidos();
  if (!ctx.ok) return ctx;
  try {
    if (!entrada || typeof entrada !== "object") return { ok: false, error: "Faltan los datos de la importación" };
    const prov = await proveedorDeLaCuenta(ctx, entrada.proveedor_id);
    if (!prov) return { ok: false, error: NO_PROVEEDOR };

    const archivo = limpiarTexto(entrada.archivo, 200) ?? "catálogo";
    const cabeceras = (Array.isArray(entrada.cabeceras) ? entrada.cabeceras : [])
      .slice(0, 100)
      .map((c) => (c == null ? "" : String(c).replace(/\s+/g, " ").trim().slice(0, 120)));

    if (!entrada.mapeo || typeof entrada.mapeo !== "object") return { ok: false, error: "Falta decir qué es cada columna" };
    const mapeo: MapeoColumnas = mapeoVacio();
    const maxCol = Math.max(cabeceras.length, 1);
    for (const c of CAMPOS_CATALOGO) {
      const v = (entrada.mapeo as Record<string, unknown>)[c];
      if (v == null) continue;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= maxCol) {
        return { ok: false, error: "Hay una columna asignada que no existe en el archivo" };
      }
      mapeo[c] = v;
    }
    if (mapeo.ref === null && mapeo.nombre === null) {
      return { ok: false, error: "Indica qué columna es el código o el nombre del producto" };
    }

    const filasArchivo = num(entrada.filas_archivo);
    if (filasArchivo == null || !Number.isInteger(filasArchivo) || filasArchivo < 0 || filasArchivo > 100_000) {
      return { ok: false, error: "El archivo tiene demasiadas filas (máximo 100.000)" };
    }

    const avisos: string[] = [];
    if (mapeo.ref === null) avisos.push("Sin columna de código: se casa por nombre y los productos nuevos se crean sin código del proveedor");
    if (mapeo.precio === null) avisos.push("Sin columna de precio");

    const detalle: DetalleImportacion = { ...detalleVacio(), cabeceras, mapeo, filas_archivo: filasArchivo, avisos };

    const { data, error } = await ctx.supabase
      .from("compras_catalogo_import")
      .insert({
        cuenta_id: ctx.cuentaId,
        proveedor_id: prov.id,
        archivo,
        filas: 0,
        creados: 0,
        actualizados: 0,
        errores: 0,
        detalle: detalle as unknown as Json,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: errorLegible(error, "No se ha podido empezar la importación.") };
    return { ok: true, importacion_id: data.id };
  } catch {
    return { ok: false, error: "No se ha podido empezar la importación. Prueba otra vez." };
  }
}

/** Importa un trozo (≤ TAM_TROZO_IMPORT filas) de una importación abierta. Trozos EN SERIE, no en
    paralelo (los contadores de la importación se acumulan fila a fila). */
export async function importarTrozoCatalogo(importacionId: string, filas: FilaCatalogo[]): Promise<Resultado<ResultadoTrozo>> {
  const ctx = await exigirGestionPedidos();
  if (!ctx.ok) return ctx;
  try {
    if (!esUuid(importacionId)) return { ok: false, error: NO_IMPORTACION };
    if (!Array.isArray(filas) || filas.length < 1 || filas.length > TAM_TROZO_IMPORT) {
      return { ok: false, error: `Cada envío tiene que llevar entre 1 y ${TAM_TROZO_IMPORT} filas` };
    }

    const { data: imp, error: errImp } = await ctx.supabase
      .from("compras_catalogo_import")
      .select(SELECT_IMPORT)
      .eq("id", importacionId)
      .eq("cuenta_id", ctx.cuentaId)
      .maybeSingle();
    if (errImp) return { ok: false, error: errorLegible(errImp, "No se ha podido leer la importación.") };
    if (!imp) return { ok: false, error: NO_IMPORTACION };
    const detalle = comoDetalle(imp.detalle) ?? detalleVacio();
    if (detalle.cerrada) return { ok: false, error: "La importación ya está cerrada: empieza otra" };
    const proveedorId = imp.proveedor_id;

    const errores: ErrorFilaCatalogo[] = [];
    const avisos = new Set(detalle.avisos);

    /* 1. Validar filas */
    const validas: FilaCatalogo[] = [];
    filas.forEach((f, i) => {
      const r = normalizarFila(f, i);
      if (r.ok) validas.push(r.fila);
      else errores.push(r.error);
    });

    /* 2. Repetidas dentro del trozo: vale la última (por código; sin código, por nombre) */
    const claveDe = (f: FilaCatalogo) => (f.ref ? `r:${refClave(f.ref)}` : `n:${normalizarTexto(f.nombre) ?? ""}`);
    const ultima = new Map<string, FilaCatalogo>();
    for (const f of validas) ultima.set(claveDe(f), f);
    const unicas: FilaCatalogo[] = [];
    for (const f of validas) {
      const u = ultima.get(claveDe(f))!;
      if (u === f) unicas.push(f);
      else {
        errores.push({
          fila: f.fila,
          ref: f.ref,
          error: `${f.ref ? "Código" : "Nombre"} repetido en el archivo: se usa la fila ${u.fila}`,
        });
      }
    }

    /* 3. Productos del proveedor (paginado) e índices para casar en código */
    const { filas: productos, error: errProd } = await todasLasFilas<ProductoImport>((d, h) =>
      ctx.supabase
        .from("compras_producto")
        .select("id, ref_proveedor, nombre, alias, unidad, formato, unidades_formato, precio_catalogo, categoria, codigo_barras, activo")
        .eq("cuenta_id", ctx.cuentaId)
        .eq("proveedor_id", proveedorId)
        .order("id")
        .range(d, h),
    );
    if (errProd) return { ok: false, error: errorLegible(errProd, "No se han podido leer los productos del proveedor.") };

    // Índices por código (lower/trim) y por nombre normalizado. Por nombre hay dos: todos los
    // productos (filas sin código) y solo los que NO tienen código (filas con código que no casan
    // por código: productos nacidos de facturas sin referencia). Nombre antes que alias.
    const porRef = new Map<string, ProductoImport[]>();
    const porNombre = new Map<string, ProductoImport[]>();
    const porAlias = new Map<string, ProductoImport[]>();
    const sinRefPorNombre = new Map<string, ProductoImport[]>();
    const sinRefPorAlias = new Map<string, ProductoImport[]>();
    const meter = (m: Map<string, ProductoImport[]>, k: string | null, p: ProductoImport) => {
      if (!k) return;
      const l = m.get(k);
      if (!l) m.set(k, [p]);
      else if (!l.includes(p)) l.push(p);
    };
    for (const p of productos) {
      const k = refClave(p.ref_proveedor);
      meter(porRef, k, p);
      const n = normalizarTexto(p.nombre);
      meter(porNombre, n, p);
      if (!k) meter(sinRefPorNombre, n, p);
      for (const a of p.alias ?? []) {
        const na = normalizarTexto(a);
        meter(porAlias, na, p);
        if (!k) meter(sinRefPorAlias, na, p);
      }
    }

    /* 4. Varios candidatos (códigos repetidos sin distinguir mayúsculas como «Si41487»/«SI41487»,
          o nombres repetidos): gana el producto con más líneas de compra; a igualdad, el primero.
          Solo se cuentan los que hacen falta, una vez por producto. */
    const lineas = new Map<string, Promise<number>>();
    const lineasDe = (id: string): Promise<number> => {
      let c = lineas.get(id);
      if (!c) {
        c = Promise.resolve(
          ctx.supabase
            .from("compras_linea")
            .select("id", { count: "exact", head: true })
            .eq("producto_id", id)
            .eq("cuenta_id", ctx.cuentaId),
        ).then(({ count }) => count ?? 0);
        lineas.set(id, c);
      }
      return c;
    };
    const elegir = async (candidatos: ProductoImport[] | undefined): Promise<ProductoImport | null> => {
      if (!candidatos || !candidatos.length) return null;
      if (candidatos.length === 1) return candidatos[0];
      const cuentas = await Promise.all(candidatos.map((p) => lineasDe(p.id)));
      let mejor = 0;
      cuentas.forEach((c, i) => {
        if (c > cuentas[mejor]) mejor = i;
      });
      return candidatos[mejor];
    };

    /* 5. Clasificar en existentes y nuevos.
          - Con código: por código. Si no casa, por nombre (y alias) contra los productos del
            proveedor SIN código; si casa, se le completa el código (como hace Compras al enlazar
            una línea de albarán) en vez de crear un duplicado. Cada producto sin código solo lo
            puede reclamar una fila (dos códigos distintos son dos artículos distintos).
          - Sin código: por nombre y alias contra todos los productos del proveedor. */
    const existentes: { f: FilaCatalogo; p: ProductoImport; completarRef: boolean }[] = [];
    const nuevas: FilaCatalogo[] = [];
    const reclamados = new Set<string>();
    for (const f of unicas) {
      const k = refClave(f.ref);
      const n = normalizarTexto(f.nombre) ?? "";
      if (k) {
        const porCodigo = await elegir(porRef.get(k));
        if (porCodigo) {
          existentes.push({ f, p: porCodigo, completarRef: false });
          continue;
        }
        const libres = (l: ProductoImport[] | undefined) => (l ?? []).filter((p) => !reclamados.has(p.id));
        const cand = n ? libres(sinRefPorNombre.get(n)) : [];
        const sinRef = await elegir(cand.length ? cand : n ? libres(sinRefPorAlias.get(n)) : []);
        if (sinRef) {
          reclamados.add(sinRef.id);
          existentes.push({ f, p: sinRef, completarRef: true });
        } else nuevas.push(f);
      } else {
        const l = porNombre.get(n);
        const p = await elegir(l && l.length ? l : porAlias.get(n));
        if (p) existentes.push({ f, p, completarRef: false });
        else nuevas.push(f);
      }
    }

    const ahora = new Date().toISOString();

    /* 6. Existentes: cambios fila a fila; sin cambios, solo el sello catalogo_en (por lotes) */
    let actualizados = 0;
    let sinCambios = 0;
    const conCambios: { f: FilaCatalogo; id: string; cambios: CambiosProducto }[] = [];
    const sinCambio: { f: FilaCatalogo; id: string }[] = [];
    for (const { f, p, completarRef } of existentes) {
      if (!p.activo) avisos.add("Algunos productos del catálogo están desactivados en Compras: se han actualizado, pero siguen desactivados");
      const cambios = cambiosDe(f, p, completarRef);
      if (Object.keys(cambios).length) conCambios.push({ f, id: p.id, cambios });
      else sinCambio.push({ f, id: p.id });
    }

    let refsCompletadas = 0;
    const resCambios = await enParalelo(conCambios, 10, async (c) => {
      const { error } = await ctx.supabase
        .from("compras_producto")
        .update({ ...c.cambios, catalogo_en: ahora })
        .eq("id", c.id)
        .eq("cuenta_id", ctx.cuentaId);
      if (!error) {
        if (c.cambios.ref_proveedor) refsCompletadas += 1;
        return null;
      }
      if (error.code === "23505" && c.cambios.ref_proveedor) return "Ya existe otro producto de este proveedor con ese código";
      return errorLegible(error, "No se ha podido actualizar");
    });
    if (refsCompletadas) {
      avisos.add(
        "Productos que ya estaban en Compras sin código del proveedor (nacidos de facturas) han recibido su código del catálogo, sin duplicarlos",
      );
    }
    resCambios.forEach((e, i) => {
      if (e) errores.push({ fila: conCambios[i].f.fila, ref: conCambios[i].f.ref, error: e });
      else actualizados += 1;
    });

    // Lotes de 100 ids: la lista va en la URL y no conviene que sea enorme.
    for (const lote of trozos(sinCambio, 100)) {
      const { error } = await ctx.supabase
        .from("compras_producto")
        .update({ catalogo_en: ahora })
        .in(
          "id",
          lote.map((x) => x.id),
        )
        .eq("cuenta_id", ctx.cuentaId);
      if (error) {
        const msg = errorLegible(error, "No se ha podido marcar como revisado");
        for (const x of lote) errores.push({ fila: x.f.fila, ref: x.f.ref, error: msg });
      } else sinCambios += lote.length;
    }

    /* 7. Nuevos: código interno con la regla de Compras (compras_next_codigo) e insert por lotes
          con claves idénticas; si el lote falla, fila a fila */
    let creados = 0;
    const aCrear: FilaCatalogo[] = [];
    for (const f of nuevas) {
      if (f.nombre) aCrear.push(f);
      else errores.push({ fila: f.fila, ref: f.ref, error: "Producto nuevo sin nombre: no se puede crear" });
    }

    const nuevoCodigo = async (): Promise<string | null> => {
      const { data, error } = await ctx.supabase.rpc("compras_next_codigo");
      return !error && typeof data === "string" && data ? data : null;
    };

    if (aCrear.length) {
      const codigos = await enParalelo(aCrear, 10, () => nuevoCodigo());
      if (codigos.some((c) => c === null)) avisos.add("Algunos productos nuevos se han creado sin código interno");
      const filaInsert = (f: FilaCatalogo, codigo: string | null) => ({
        cuenta_id: ctx.cuentaId,
        proveedor_id: proveedorId,
        ref_proveedor: f.ref,
        nombre: f.nombre,
        codigo_interno: codigo,
        unidad: f.unidad,
        formato: f.formato,
        unidades_formato: f.unidades_formato,
        precio_catalogo: f.precio,
        categoria: f.categoria,
        codigo_barras: f.codigo_barras,
        alias: [] as string[],
        origen: "catalogo",
        catalogo_en: ahora,
        activo: true,
        pedible: true,
      });

      const { data: insertados, error: errIns } = await ctx.supabase
        .from("compras_producto")
        .insert(aCrear.map((f, i) => filaInsert(f, codigos[i])))
        .select("id");
      if (!errIns) {
        creados += insertados?.length ?? aCrear.length;
      } else {
        // El lote es atómico: no se insertó nada. Fila a fila, anotando errores.
        const res = await enParalelo(aCrear, 10, async (f, i) => {
          let codigo = codigos[i];
          for (let intento = 0; intento < 3; intento++) {
            const { error } = await ctx.supabase.from("compras_producto").insert(filaInsert(f, codigo));
            if (!error) return null;
            const texto = `${error.message ?? ""} ${(error as { details?: string }).details ?? ""}`;
            if (error.code === "23505" && /codigo_interno/i.test(texto)) {
              codigo = await nuevoCodigo();
              continue;
            }
            if (error.code === "23505") return "Ya existe un producto de este proveedor con ese código";
            return errorLegible(error, "No se ha podido crear");
          }
          return "No se ha podido asignar un código interno libre";
        });
        res.forEach((e, i) => {
          if (e) errores.push({ fila: aCrear[i].fila, ref: aCrear[i].ref, error: e });
          else creados += 1;
        });
      }
    }

    /* 8. Acumular en la importación (un update) */
    errores.sort((a, b) => a.fila - b.fila);
    const nuevoDetalle: DetalleImportacion = {
      ...detalle,
      errores_filas: [...detalle.errores_filas, ...errores].slice(0, 200),
      avisos: [...avisos].slice(0, 20),
      sin_cambios: detalle.sin_cambios + sinCambios,
    };
    await ctx.supabase
      .from("compras_catalogo_import")
      .update({
        filas: (imp.filas ?? 0) + filas.length,
        creados: (imp.creados ?? 0) + creados,
        actualizados: (imp.actualizados ?? 0) + actualizados,
        errores: (imp.errores ?? 0) + errores.length,
        detalle: nuevoDetalle as unknown as Json,
      })
      .eq("id", imp.id)
      .eq("cuenta_id", ctx.cuentaId);
    // Si el registro no se actualiza no es grave: los productos ya están y el navegador lleva su
    // propia cuenta con lo que devuelve cada trozo.

    return { ok: true, creados, actualizados, sin_cambios: sinCambios, errores };
  } catch {
    return { ok: false, error: "Se ha cortado la importación de este trozo. Prueba otra vez." };
  }
}

/** Cierra la importación: marca catalogo_actualizado_en del proveedor y devuelve el resumen final. */
export async function cerrarImportacion(importacionId: string): Promise<Resultado<{ importacion: ImportacionCatalogo }>> {
  const ctx = await exigirGestionPedidos();
  if (!ctx.ok) return ctx;
  try {
    if (!esUuid(importacionId)) return { ok: false, error: NO_IMPORTACION };
    const { data: imp, error } = await ctx.supabase
      .from("compras_catalogo_import")
      .select(SELECT_IMPORT)
      .eq("id", importacionId)
      .eq("cuenta_id", ctx.cuentaId)
      .maybeSingle();
    if (error) return { ok: false, error: errorLegible(error, "No se ha podido leer la importación.") };
    if (!imp) return { ok: false, error: NO_IMPORTACION };
    const detalle = comoDetalle(imp.detalle) ?? detalleVacio();
    if (detalle.cerrada) return { ok: true, importacion: aImportacion(imp) };

    const ahora = new Date().toISOString();
    const cerrado: DetalleImportacion = { ...detalle, cerrada: true, cerrada_en: ahora };
    const { data: fila, error: errUpd } = await ctx.supabase
      .from("compras_catalogo_import")
      .update({ detalle: cerrado as unknown as Json })
      .eq("id", imp.id)
      .eq("cuenta_id", ctx.cuentaId)
      .select(SELECT_IMPORT)
      .maybeSingle();
    if (errUpd || !fila) return { ok: false, error: errorLegible(errUpd, "No se ha podido cerrar la importación.") };

    // Solo cuenta como catálogo actualizado si algo se procesó de verdad.
    if ((imp.creados ?? 0) + (imp.actualizados ?? 0) + detalle.sin_cambios > 0) {
      await ctx.supabase
        .from("compras_proveedor")
        .update({ catalogo_actualizado_en: ahora })
        .eq("id", imp.proveedor_id)
        .eq("cuenta_id", ctx.cuentaId);
    }
    return { ok: true, importacion: aImportacion(fila) };
  } catch {
    return { ok: false, error: "No se ha podido cerrar la importación. Prueba otra vez." };
  }
}

/** Alias aprendidos de la cuenta (por usos), con filtro opcional por centro o texto. Máx. 500. */
export async function listarAlias(filtro?: {
  centro_id?: string | null;
  texto?: string | null;
}): Promise<Resultado<{ alias: AliasAprendido[] }>> {
  const ctx = await exigirGestionPedidos();
  if (!ctx.ok) return ctx;
  try {
    const centro = filtro?.centro_id ?? null;
    if (centro && !esUuid(centro)) return { ok: false, error: "El centro no es válido" };
    const texto = sanear(limpiarTexto(filtro?.texto, 100) ?? "");

    let q = ctx.supabase
      .from("compras_pedido_alias")
      .select("id, frase, producto_id, unidad, idioma, usos, ultimo_uso, centro_id, compras_producto(nombre, ref_proveedor, proveedor_nombre), centros(nombre)")
      .eq("cuenta_id", ctx.cuentaId);
    if (centro) q = q.eq("centro_id", centro);
    if (texto) q = q.ilike("frase", `%${texto}%`);
    const { data, error } = await q.order("usos", { ascending: false }).order("ultimo_uso", { ascending: false }).limit(500);
    if (error) return { ok: false, error: errorLegible(error, "No se han podido cargar los alias.") };

    const alias: AliasAprendido[] = (data ?? []).map((a) => ({
      id: a.id,
      frase: a.frase,
      producto_id: a.producto_id,
      producto_nombre: a.compras_producto?.nombre?.trim() || a.compras_producto?.ref_proveedor || "(sin nombre)",
      proveedor_nombre: a.compras_producto?.proveedor_nombre ?? null,
      centro_id: a.centro_id,
      centro_nombre: a.centros?.nombre ?? null,
      unidad: a.unidad,
      idioma: a.idioma,
      usos: a.usos,
      ultimo_uso: a.ultimo_uso,
    }));
    return { ok: true, alias };
  } catch {
    return { ok: false, error: "No se han podido cargar los alias. Prueba otra vez." };
  }
}

/** Borra un alias aprendido (la IA deja de usarlo). */
export async function borrarAlias(aliasId: string): Promise<Resultado> {
  const ctx = await exigirGestionPedidos();
  if (!ctx.ok) return ctx;
  try {
    if (!esUuid(aliasId)) return { ok: false, error: "No se ha encontrado el alias" };
    const { data, error } = await ctx.supabase
      .from("compras_pedido_alias")
      .delete()
      .eq("id", aliasId)
      .eq("cuenta_id", ctx.cuentaId)
      .select("id");
    if (error) return { ok: false, error: errorLegible(error, "No se ha podido borrar el alias.") };
    if (!data || !data.length) return { ok: false, error: "No se ha encontrado el alias" };
    return { ok: true };
  } catch {
    return { ok: false, error: "No se ha podido borrar el alias. Prueba otra vez." };
  }
}

/** Vista previa de la petición estándar al proveedor (catálogo con códigos + albaranes en PDF). */
export async function prepararPeticionProveedor(proveedorId: string): Promise<Resultado<{ peticion: PeticionProveedor }>> {
  const ctx = await exigirGestionPedidos();
  if (!ctx.ok) return ctx;
  try {
    const prov = await proveedorDeLaCuenta(ctx, proveedorId);
    if (!prov) return { ok: false, error: NO_PROVEEDOR };
    const { asunto, texto, html } = componerPeticion(ctx, prov, configPedidos().buzon_albaranes);
    const para = prov.pedido_email && esEmail(prov.pedido_email) ? prov.pedido_email : null;
    return { ok: true, peticion: { para, asunto, texto, html, enlace_mailto: enlaceMailto(para, asunto, texto) } };
  } catch {
    return { ok: false, error: "No se ha podido preparar el correo. Prueba otra vez." };
  }
}

/** Envía la petición por email en nombre de quien pulsa (reply-to = su correo). Si no sale:
    { ok: false, error, alternativa } con el mailto para mandarlo desde su correo. */
export async function enviarPeticionProveedor(
  proveedorId: string,
  para: string,
): Promise<Resultado<{ enviado_a: string }> | ErrorConAlternativa> {
  const ctx = await exigirGestionPedidos();
  if (!ctx.ok) return ctx;
  try {
    const destino = limpiarTexto(para, 254);
    if (!destino || !esEmail(destino)) return { ok: false, error: "El email no parece válido" };
    const prov = await proveedorDeLaCuenta(ctx, proveedorId);
    if (!prov) return { ok: false, error: NO_PROVEEDOR };

    const config = configPedidos();
    const { asunto, texto, html } = componerPeticion(ctx, prov, config.buzon_albaranes);

    // Objeto aparte (no literal): compatible con la firma ampliada de enviarCorreo (texto,
    // responderA, remitente) y con la antigua, que ignora lo que no conoce.
    const correo = {
      para: destino,
      asunto,
      html,
      texto,
      responderA: ctx.perfil.correo || undefined,
      remitente: config.remitente ?? undefined,
    };
    const enviado = await enviarCorreo(correo);
    if (!enviado) {
      return {
        ok: false,
        error: "No se ha podido enviar el correo. Copia el texto o ábrelo en tu correo.",
        alternativa: { para: destino, asunto, texto, enlace_mailto: enlaceMailto(destino, asunto, texto) },
      };
    }

    if (!prov.pedido_email) {
      await ctx.supabase
        .from("compras_proveedor")
        .update({ pedido_email: destino })
        .eq("id", prov.id)
        .eq("cuenta_id", ctx.cuentaId)
        .is("pedido_email", null);
    }
    return { ok: true, enviado_a: destino };
  } catch {
    return { ok: false, error: "No se ha podido enviar el correo. Prueba otra vez." };
  }
}
