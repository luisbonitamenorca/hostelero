// Ayudas de SERVIDOR compartidas por las acciones de /pedidos.
// Sin directiva a propósito: NO es un fichero de acciones (lo exportado aquí no debe ser llamable
// desde el navegador). Importa next/headers vía lib/supabase/server: si un componente de cliente
// lo importa por error, el build falla, que es lo que queremos.
import { exigirModulo } from "@/lib/supabase/server";
import { comoEstadoCotejo, esCanalPedido, esEstadoPedido, puedeGestionar } from "./lib-pedidos";
import { ESTADOS_COTEJO_LINEA, ORIGENES_PEDIDO } from "./tipos";
import type {
  ConfigPedidos,
  ErrorAccion,
  EstadoCotejoLinea,
  FilaLineaPedido,
  FilaPedido,
  LineaPedido,
  OrigenPedido,
  PedidoResumen,
} from "./tipos";

export type CtxPedidos = Awaited<ReturnType<typeof exigirModulo>> & {
  /** Cuenta del perfil: filtra SIEMPRE las lecturas con .eq("cuenta_id", cuentaId) (la RLS deja
      ver todas las cuentas a los operadores) y va EXPLÍCITA en todo insert. */
  cuentaId: string;
  /** direccion o responsable_area. */
  gestiona: boolean;
};

/** Primera línea de TODA acción de /pedidos. Sin sesión → /login; sin módulo → notFound (como el resto de módulos). */
export async function exigirPedidos(): Promise<CtxPedidos> {
  const ctx = await exigirModulo("pedidos");
  return { ...ctx, cuentaId: ctx.perfil.cuenta_id, gestiona: puedeGestionar(ctx.perfil.rol) };
}

export const ERROR_SOLO_GESTION = "Solo dirección o responsables de área pueden cambiar esto.";

/** Para Ajustes, importación y alias: además del módulo, rol direccion o responsable_area.
    Uso: `const ctx = await exigirGestionPedidos(); if (!ctx.ok) return ctx;` */
export async function exigirGestionPedidos(): Promise<({ ok: true } & CtxPedidos) | ErrorAccion> {
  const ctx = await exigirPedidos();
  if (!ctx.gestiona) return { ok: false, error: ERROR_SOLO_GESTION };
  return { ok: true, ...ctx };
}

/** Error de Postgres/PostgREST → texto para el usuario. */
export function errorLegible(
  e: { code?: string; message?: string } | null | undefined,
  porDefecto = "No se ha podido guardar. Prueba otra vez.",
): string {
  if (!e) return porDefecto;
  switch (e.code) {
    case "42501":
      return "No tienes permiso para hacer esto.";
    case "23505":
      return "Ya existe un registro igual.";
    case "23514":
      return "Algún dato no es válido (cantidad, estado o unidad).";
    case "23503":
      return "Falta un dato relacionado (producto, proveedor o centro) o es de otra cuenta.";
    case "P0002":
    case "PGRST116":
      return "No se ha encontrado.";
    default:
      return e.message?.trim() || porDefecto;
  }
}

/** Configuración de correo e IA desde el entorno (direcciones, nunca claves). */
export function configPedidos(): ConfigPedidos {
  return {
    buzon_albaranes: process.env.PEDIDOS_BUZON_ALBARANES?.trim() || null,
    remitente: process.env.PEDIDOS_REMITENTE?.trim() || process.env.RESEND_REMITENTE?.trim() || null,
    correo_configurado: !!process.env.RESEND_API_KEY,
    ia_configurada: !!process.env.ANTHROPIC_API_KEY,
  };
}

/** Columnas para leer un PedidoResumen (lista, ficha, resultado de envío). Pasar por aPedidoResumen. */
export const SELECT_PEDIDO_RESUMEN =
  "id, numero, estado, centro_id, proveedor_id, fecha_entrega, creado_en, enviado_en, canal_envio, origen, total_estimado, cotejo_estado, albaran_doc_id, factura_doc_id, centros(nombre), compras_proveedor(nombre), compras_pedido_linea(count)" as const;

type FilaPedidoResumen = Pick<
  FilaPedido,
  | "id"
  | "numero"
  | "estado"
  | "centro_id"
  | "proveedor_id"
  | "fecha_entrega"
  | "creado_en"
  | "enviado_en"
  | "canal_envio"
  | "origen"
  | "total_estimado"
  | "cotejo_estado"
  | "albaran_doc_id"
  | "factura_doc_id"
> & {
  centros: { nombre: string } | null;
  compras_proveedor: { nombre: string } | null;
  compras_pedido_linea: { count: number }[];
};

export function aPedidoResumen(f: FilaPedidoResumen): PedidoResumen {
  return {
    id: f.id,
    numero: f.numero,
    estado: esEstadoPedido(f.estado) ? f.estado : "borrador",
    centro_id: f.centro_id,
    centro_nombre: f.centros?.nombre ?? "",
    proveedor_id: f.proveedor_id,
    proveedor_nombre: f.compras_proveedor?.nombre ?? null,
    fecha_entrega: f.fecha_entrega,
    creado_en: f.creado_en,
    enviado_en: f.enviado_en,
    canal_envio: esCanalPedido(f.canal_envio) ? f.canal_envio : null,
    origen: (ORIGENES_PEDIDO as readonly string[]).includes(f.origen) ? (f.origen as OrigenPedido) : "texto",
    total_estimado: f.total_estimado,
    n_lineas: f.compras_pedido_linea?.[0]?.count ?? 0,
    cotejo_estado: comoEstadoCotejo(f.cotejo_estado),
    albaran_doc_id: f.albaran_doc_id,
    factura_doc_id: f.factura_doc_id,
  };
}

/** Lee un pedido de la cuenta como PedidoResumen (null si no existe o no es de la cuenta). */
export async function leerPedidoResumen(ctx: CtxPedidos, pedidoId: string): Promise<PedidoResumen | null> {
  const { data } = await ctx.supabase
    .from("compras_pedido")
    .select(SELECT_PEDIDO_RESUMEN)
    .eq("id", pedidoId)
    .eq("cuenta_id", ctx.cuentaId)
    .maybeSingle();
  return data ? aPedidoResumen(data) : null;
}

/** ¿El centro es de la cuenta? Devuelve sus datos o null. */
export async function centroDeLaCuenta(
  ctx: CtxPedidos,
  centroId: string,
): Promise<{ id: string; nombre: string; direccion: string | null } | null> {
  const { data } = await ctx.supabase
    .from("centros")
    .select("id, nombre, direccion")
    .eq("id", centroId)
    .eq("cuenta_id", ctx.cuentaId)
    .maybeSingle();
  return data ?? null;
}

/** Columnas para leer una LineaPedido (con su producto). Pasar por aLineaPedido. Ordenar por orden, creado_en. */
export const SELECT_LINEA_PEDIDO =
  "id, pedido_id, orden, producto_id, texto_original, descripcion, cantidad, unidad, precio_estimado, confianza, nota, cantidad_albaran, precio_albaran, cantidad_factura, precio_factura, estado_cotejo, creado_en, compras_producto(id, nombre, ref_proveedor, codigo_interno, unidad, formato, proveedor_id)" as const;

type FilaLineaConProducto = Pick<
  FilaLineaPedido,
  | "id"
  | "pedido_id"
  | "orden"
  | "producto_id"
  | "texto_original"
  | "descripcion"
  | "cantidad"
  | "unidad"
  | "precio_estimado"
  | "confianza"
  | "nota"
  | "cantidad_albaran"
  | "precio_albaran"
  | "cantidad_factura"
  | "precio_factura"
  | "estado_cotejo"
> & {
  compras_producto: {
    id: string;
    nombre: string | null;
    ref_proveedor: string | null;
    codigo_interno: string | null;
    unidad: string | null;
    formato: string | null;
    proveedor_id: string | null;
  } | null;
};

export function aLineaPedido(f: FilaLineaConProducto): LineaPedido {
  const p = f.compras_producto;
  return {
    id: f.id,
    pedido_id: f.pedido_id,
    orden: f.orden,
    producto_id: f.producto_id,
    producto: p
      ? {
          id: p.id,
          nombre: p.nombre?.trim() || p.ref_proveedor || "(sin nombre)",
          ref_proveedor: p.ref_proveedor,
          codigo_interno: p.codigo_interno,
          unidad: p.unidad,
          formato: p.formato,
          proveedor_id: p.proveedor_id,
        }
      : null,
    texto_original: f.texto_original,
    descripcion: f.descripcion,
    cantidad: f.cantidad,
    unidad: f.unidad,
    precio_estimado: f.precio_estimado,
    confianza: f.confianza,
    nota: f.nota,
    cantidad_albaran: f.cantidad_albaran,
    precio_albaran: f.precio_albaran,
    cantidad_factura: f.cantidad_factura,
    precio_factura: f.precio_factura,
    estado_cotejo: (ESTADOS_COTEJO_LINEA as readonly string[]).includes(f.estado_cotejo ?? "")
      ? (f.estado_cotejo as EstadoCotejoLinea)
      : null,
  };
}

/** Líneas de un pedido de la cuenta, en orden. null si la lectura falla. */
export async function leerLineasPedido(ctx: CtxPedidos, pedidoId: string): Promise<LineaPedido[] | null> {
  const { data, error } = await ctx.supabase
    .from("compras_pedido_linea")
    .select(SELECT_LINEA_PEDIDO)
    .eq("pedido_id", pedidoId)
    .eq("cuenta_id", ctx.cuentaId)
    .order("orden")
    .order("creado_en");
  if (error) return null;
  return (data ?? []).map(aLineaPedido);
}
