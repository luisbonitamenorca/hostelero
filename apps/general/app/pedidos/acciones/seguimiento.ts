"use server";

/* Lista y ficha de pedidos, sugerencias de albarán/factura, vincular documento, cotejo, estados de
   recepción y marca «sustituido» (constructor C). Contrato: docs/pedidos-contratos.md §3.4.
   Cualquiera con el módulo. Los campos cotejo_* SOLO los escribe la rpc pedidos_cotejar. */

import {
  aPedidoResumen,
  centroDeLaCuenta,
  errorLegible,
  exigirPedidos,
  leerLineasPedido,
  leerPedidoResumen,
  SELECT_PEDIDO_RESUMEN,
} from "../servidor";
import type { CtxPedidos } from "../servidor";
import {
  comoCotejo,
  comoEstadoCotejo,
  comoInterpretacion,
  comoProveedor,
  esEstadoPedido,
  esFechaISO,
  esUuid,
  instanteMadrid,
  sumarDias,
} from "../lib-pedidos";
import { ESTADOS_ENVIADOS, SELECT_PROVEEDOR } from "../tipos";
import type {
  CotejoDetalle,
  DocumentoResumen,
  EstadoCotejoPedido,
  EstadoPedido,
  EstadoSeguimiento,
  FiltroPedidos,
  PedidoCompleto,
  PedidoResumen,
  Resultado,
  SugerenciaDocumento,
} from "../tipos";

/* ─── ayudas internas (sin export: fichero "use server") ─── */

const NO_ENCONTRADO = "No se ha encontrado el pedido";
const PRIMERO_ENVIA = "Primero envía el pedido";
const CANCELADO = "El pedido está cancelado";
const ESTADOS_SEGUIMIENTO: readonly EstadoSeguimiento[] = ["confirmado", "recibido_parcial", "recibido"];

const SELECT_PEDIDO_COMPLETO =
  `${SELECT_PEDIDO_RESUMEN}, notas, transcripcion, idioma, interpretacion, cotejo_detalle, cotejado_en` as const;

const SELECT_DOC = "id, tipo, num_documento, fecha, base, total, canal, imagen_url" as const;

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const esTipoDoc = (v: unknown): v is "albaran" | "factura" => v === "albaran" || v === "factura";

/** Relee el estado del cotejo del pedido (la rpc no lo devuelve dentro del jsonb). */
async function leerCotejoEstado(ctx: CtxPedidos, pedidoId: string): Promise<EstadoCotejoPedido> {
  const { data } = await ctx.supabase
    .from("compras_pedido")
    .select("cotejo_estado")
    .eq("id", pedidoId)
    .eq("cuenta_id", ctx.cuentaId)
    .maybeSingle();
  return comoEstadoCotejo(data?.cotejo_estado);
}

/** Ejecuta pedidos_cotejar y devuelve el detalle tipado (null si el formato no es el esperado). */
async function ejecutarCotejo(
  ctx: CtxPedidos,
  pedidoId: string,
): Promise<{ ok: true; cotejo: CotejoDetalle | null; cotejo_estado: EstadoCotejoPedido } | { ok: false; error: string }> {
  const { data, error } = await ctx.supabase.rpc("pedidos_cotejar", { p_pedido: pedidoId });
  if (error) return { ok: false, error: errorLegible(error, "No se ha podido cotejar. Prueba otra vez.") };
  const cotejo = comoCotejo(data);
  const cotejo_estado = await leerCotejoEstado(ctx, pedidoId);
  return { ok: true, cotejo, cotejo_estado };
}

/** Pedido de la cuenta que ya salió (no borrador ni cancelado), o el error para el usuario. */
async function pedidoEnSeguimiento(
  ctx: CtxPedidos,
  pedidoId: unknown,
): Promise<{ ok: true; pedido: PedidoResumen } | { ok: false; error: string }> {
  if (!esUuid(pedidoId)) return { ok: false, error: NO_ENCONTRADO };
  const pedido = await leerPedidoResumen(ctx, pedidoId);
  if (!pedido) return { ok: false, error: NO_ENCONTRADO };
  if (pedido.estado === "borrador") return { ok: false, error: PRIMERO_ENVIA };
  if (pedido.estado === "cancelado") return { ok: false, error: CANCELADO };
  return { ok: true, pedido };
}

function aDocumento(f: {
  id: string;
  tipo: string;
  num_documento: string | null;
  fecha: string | null;
  base: number | null;
  total: number | null;
  canal: string | null;
  imagen_url: string | null;
}): DocumentoResumen {
  return {
    id: f.id,
    tipo: f.tipo === "factura" ? "factura" : "albaran",
    num_documento: f.num_documento,
    fecha: f.fecha,
    base: num(f.base),
    total: num(f.total),
    canal: f.canal,
    // Solo enlaces web (Compras guarda la URL pública del archivo).
    imagen_url: f.imagen_url && /^https:\/\//i.test(f.imagen_url) ? f.imagen_url : null,
  };
}

/* ═══════════════════════ Acciones ═══════════════════════ */

/** Pedidos de la cuenta con filtros (por defecto: todos menos cancelados, los 100 más recientes). */
export async function listarPedidos(filtro: FiltroPedidos): Promise<Resultado<{ pedidos: PedidoResumen[] }>> {
  const ctx = await exigirPedidos();
  try {
    const f: FiltroPedidos = filtro && typeof filtro === "object" ? filtro : {};

    const limite =
      typeof f.limite === "number" && Number.isFinite(f.limite) ? Math.min(300, Math.max(1, Math.round(f.limite))) : 100;

    if (f.centro_id != null && f.centro_id !== "" && !esUuid(f.centro_id)) return { ok: false, error: "El centro no es válido" };
    if (f.proveedor_id != null && f.proveedor_id !== "" && !esUuid(f.proveedor_id)) {
      return { ok: false, error: "El proveedor no es válido" };
    }
    if (f.desde != null && f.desde !== "" && !esFechaISO(f.desde)) return { ok: false, error: "La fecha «desde» no es válida" };
    if (f.hasta != null && f.hasta !== "" && !esFechaISO(f.hasta)) return { ok: false, error: "La fecha «hasta» no es válida" };

    const estados = Array.isArray(f.estados) ? [...new Set(f.estados.filter(esEstadoPedido))] : [];

    let q = ctx.supabase.from("compras_pedido").select(SELECT_PEDIDO_RESUMEN).eq("cuenta_id", ctx.cuentaId);
    if (estados.length) q = q.in("estado", estados);
    else q = q.neq("estado", "cancelado");
    if (f.centro_id) q = q.eq("centro_id", f.centro_id);
    if (f.proveedor_id) q = q.eq("proveedor_id", f.proveedor_id);
    if (f.desde) q = q.gte("creado_en", instanteMadrid(f.desde));
    if (f.hasta) q = q.lt("creado_en", instanteMadrid(sumarDias(f.hasta, 1)));

    const { data, error } = await q.order("creado_en", { ascending: false }).limit(limite);
    if (error) return { ok: false, error: errorLegible(error, "No se han podido cargar los pedidos.") };
    return { ok: true, pedidos: (data ?? []).map(aPedidoResumen) };
  } catch {
    return { ok: false, error: "No se han podido cargar los pedidos. Prueba otra vez." };
  }
}

/** Un pedido con líneas (y su producto), proveedor, centro, documentos vinculados y cotejo guardado. */
export async function cargarPedido(pedidoId: string): Promise<Resultado<{ pedido: PedidoCompleto }>> {
  const ctx = await exigirPedidos();
  try {
    if (!esUuid(pedidoId)) return { ok: false, error: NO_ENCONTRADO };
    const { data: fila, error } = await ctx.supabase
      .from("compras_pedido")
      .select(SELECT_PEDIDO_COMPLETO)
      .eq("id", pedidoId)
      .eq("cuenta_id", ctx.cuentaId)
      .maybeSingle();
    if (error) return { ok: false, error: errorLegible(error, "No se ha podido cargar el pedido.") };
    if (!fila) return { ok: false, error: NO_ENCONTRADO };

    const resumen = aPedidoResumen(fila);
    const idsDocs = [fila.albaran_doc_id, fila.factura_doc_id].filter((x): x is string => !!x);

    const [centro, proveedorRes, lineas, docsRes] = await Promise.all([
      centroDeLaCuenta(ctx, fila.centro_id),
      fila.proveedor_id
        ? ctx.supabase
            .from("compras_proveedor")
            .select(SELECT_PROVEEDOR)
            .eq("id", fila.proveedor_id)
            .eq("cuenta_id", ctx.cuentaId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      leerLineasPedido(ctx, pedidoId),
      idsDocs.length
        ? ctx.supabase.from("compras_doc").select(SELECT_DOC).in("id", idsDocs).eq("cuenta_id", ctx.cuentaId)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (lineas === null) return { ok: false, error: "No se han podido cargar las líneas del pedido." };

    const docs = (docsRes.data ?? []).map(aDocumento);
    const albaran = docs.find((d) => d.id === fila.albaran_doc_id) ?? null;
    const factura = docs.find((d) => d.id === fila.factura_doc_id) ?? null;

    const pedido: PedidoCompleto = {
      ...resumen,
      notas: fila.notas,
      transcripcion: fila.transcripcion,
      idioma: fila.idioma === "es" || fila.idioma === "ca" ? fila.idioma : null,
      interpretacion: comoInterpretacion(fila.interpretacion),
      proveedor: proveedorRes.data ? comoProveedor(proveedorRes.data) : null,
      centro: centro ?? { id: fila.centro_id, nombre: resumen.centro_nombre, direccion: null },
      lineas,
      cotejo: comoCotejo(fila.cotejo_detalle),
      cotejado_en: fila.cotejado_en,
      documentos: { albaran, factura },
    };
    return { ok: true, pedido };
  } catch {
    return { ok: false, error: "No se ha podido cargar el pedido. Prueba otra vez." };
  }
}

/** Albaranes y facturas candidatos (rpc pedidos_sugerir_documentos), mejor puntuación primero. */
export async function sugerirDocumentos(pedidoId: string): Promise<Resultado<{ sugerencias: SugerenciaDocumento[] }>> {
  const ctx = await exigirPedidos();
  try {
    const p = await pedidoEnSeguimiento(ctx, pedidoId);
    if (!p.ok) return p;
    if (!p.pedido.proveedor_id) return { ok: false, error: "El pedido no tiene proveedor" };

    const { data, error } = await ctx.supabase.rpc("pedidos_sugerir_documentos", { p_pedido: p.pedido.id });
    if (error) return { ok: false, error: errorLegible(error, "No se han podido buscar albaranes y facturas.") };

    const sugerencias: SugerenciaDocumento[] = [];
    for (const r of data ?? []) {
      if (!r || !esUuid(r.doc_id) || !esTipoDoc(r.tipo)) continue;
      sugerencias.push({
        doc_id: r.doc_id,
        tipo: r.tipo,
        fecha: r.fecha ?? null,
        num_documento: r.num_documento ?? null,
        total: num(r.total),
        canal: r.canal ?? null,
        mismo_centro: r.mismo_centro === true,
        n_lineas: num(r.n_lineas) ?? 0,
        n_coinciden: num(r.n_coinciden) ?? 0,
        incluye_albaran: r.incluye_albaran === true,
        puntuacion: Math.max(0, Math.min(100, num(r.puntuacion) ?? 0)),
        motivo: r.motivo ?? "",
        vinculado_a: r.vinculado_a ?? null,
      });
    }
    return { ok: true, sugerencias };
  } catch {
    return { ok: false, error: "No se han podido buscar albaranes y facturas. Prueba otra vez." };
  }
}

/** Vincula (docId) o desvincula (null) el albarán o la factura y vuelve a cotejar. */
export async function vincularDocumento(
  pedidoId: string,
  tipo: "albaran" | "factura",
  docId: string | null,
): Promise<Resultado<{ cotejo: CotejoDetalle | null; cotejo_estado: EstadoCotejoPedido }>> {
  const ctx = await exigirPedidos();
  try {
    if (!esTipoDoc(tipo)) return { ok: false, error: "Tipo de documento no válido" };
    if (docId !== null && !esUuid(docId)) return { ok: false, error: "No se ha encontrado el documento" };
    const p = await pedidoEnSeguimiento(ctx, pedidoId);
    if (!p.ok) return p;
    const pedido = p.pedido;
    const nombreTipo = tipo === "albaran" ? "albarán" : "factura";

    if (docId) {
      const { data: doc, error: errDoc } = await ctx.supabase
        .from("compras_doc")
        .select("id, tipo, proveedor_id")
        .eq("id", docId)
        .eq("cuenta_id", ctx.cuentaId)
        .maybeSingle();
      if (errDoc) return { ok: false, error: errorLegible(errDoc, "No se ha podido leer el documento.") };
      if (!doc) return { ok: false, error: "No se ha encontrado el documento" };
      if (doc.tipo !== tipo) return { ok: false, error: tipo === "albaran" ? "Ese documento no es un albarán" : "Ese documento no es una factura" };
      if (doc.proveedor_id !== pedido.proveedor_id) return { ok: false, error: "El documento es de otro proveedor" };

      if (tipo === "albaran") {
        const { data: otros, error: errOtros } = await ctx.supabase
          .from("compras_pedido")
          .select("numero")
          .eq("cuenta_id", ctx.cuentaId)
          .eq("albaran_doc_id", docId)
          .neq("id", pedido.id)
          .limit(1);
        if (errOtros) return { ok: false, error: errorLegible(errOtros) };
        if (otros && otros.length) return { ok: false, error: `Ese albarán ya está en el pedido ${otros[0].numero}` };
      }
    }

    const actual = tipo === "albaran" ? pedido.albaran_doc_id : pedido.factura_doc_id;
    if (actual !== docId) {
      const cambio = tipo === "albaran" ? { albaran_doc_id: docId } : { factura_doc_id: docId };
      const { data: upd, error: errUpd } = await ctx.supabase
        .from("compras_pedido")
        .update(cambio)
        .eq("id", pedido.id)
        .eq("cuenta_id", ctx.cuentaId)
        .neq("estado", "borrador")
        .neq("estado", "cancelado")
        .select("id");
      if (errUpd) return { ok: false, error: errorLegible(errUpd, `No se ha podido guardar el cambio de ${nombreTipo}.`) };
      if (!upd || !upd.length) return { ok: false, error: "El pedido ha cambiado de estado: vuelve a abrirlo" };
    }

    const r = await ejecutarCotejo(ctx, pedido.id);
    if (!r.ok) {
      return {
        ok: false,
        error: docId
          ? `${tipo === "albaran" ? "Albarán vinculado" : "Factura vinculada"}, pero el cotejo ha fallado: pulsa «Cotejar».`
          : `${tipo === "albaran" ? "Albarán quitado" : "Factura quitada"}, pero el cotejo ha fallado: pulsa «Cotejar».`,
      };
    }
    return { ok: true, cotejo: r.cotejo, cotejo_estado: r.cotejo_estado };
  } catch {
    return { ok: false, error: "No se ha podido vincular el documento. Prueba otra vez." };
  }
}

/** Ejecuta pedidos_cotejar y devuelve el detalle tipado. */
export async function cotejar(pedidoId: string): Promise<Resultado<{ cotejo: CotejoDetalle; cotejo_estado: EstadoCotejoPedido }>> {
  const ctx = await exigirPedidos();
  try {
    const p = await pedidoEnSeguimiento(ctx, pedidoId);
    if (!p.ok) return p;
    const r = await ejecutarCotejo(ctx, p.pedido.id);
    if (!r.ok) return r;
    if (!r.cotejo) return { ok: false, error: "El cotejo ha devuelto un formato desconocido" };
    return { ok: true, cotejo: r.cotejo, cotejo_estado: r.cotejo_estado };
  } catch {
    return { ok: false, error: "No se ha podido cotejar. Prueba otra vez." };
  }
}

/** Marca confirmado / recibido en parte / recibido (desde enviado, confirmado o recibido_parcial;
    también se puede corregir entre ellos). */
export async function cambiarEstadoSeguimiento(
  pedidoId: string,
  estado: EstadoSeguimiento,
): Promise<Resultado<{ pedido: PedidoResumen }>> {
  const ctx = await exigirPedidos();
  try {
    if (!ESTADOS_SEGUIMIENTO.includes(estado)) return { ok: false, error: "Estado no válido" };
    const p = await pedidoEnSeguimiento(ctx, pedidoId);
    if (!p.ok) return p;
    if (!ESTADOS_ENVIADOS.includes(p.pedido.estado)) return { ok: false, error: PRIMERO_ENVIA };
    if (p.pedido.estado === estado) return { ok: true, pedido: p.pedido };

    const { data: upd, error } = await ctx.supabase
      .from("compras_pedido")
      .update({ estado })
      .eq("id", p.pedido.id)
      .eq("cuenta_id", ctx.cuentaId)
      .in("estado", ESTADOS_ENVIADOS as EstadoPedido[])
      .select("id");
    if (error) return { ok: false, error: errorLegible(error, "No se ha podido cambiar el estado.") };
    if (!upd || !upd.length) return { ok: false, error: "El pedido ha cambiado de estado: vuelve a abrirlo" };

    const pedido = await leerPedidoResumen(ctx, p.pedido.id);
    if (!pedido) return { ok: false, error: NO_ENCONTRADO };
    return { ok: true, pedido };
  } catch {
    return { ok: false, error: "No se ha podido cambiar el estado. Prueba otra vez." };
  }
}

/** Pone o quita la marca manual «sustituido» de una línea y, si hay documentos, vuelve a cotejar. */
export async function marcarSustituido(
  lineaId: string,
  sustituido: boolean,
): Promise<Resultado<{ cotejo: CotejoDetalle | null; cotejo_estado: EstadoCotejoPedido }>> {
  const ctx = await exigirPedidos();
  try {
    if (!esUuid(lineaId)) return { ok: false, error: "No se ha encontrado la línea" };
    const marcar = sustituido === true;

    const { data: linea, error: errLinea } = await ctx.supabase
      .from("compras_pedido_linea")
      .select("id, pedido_id, estado_cotejo")
      .eq("id", lineaId)
      .eq("cuenta_id", ctx.cuentaId)
      .maybeSingle();
    if (errLinea) return { ok: false, error: errorLegible(errLinea, "No se ha podido leer la línea.") };
    if (!linea) return { ok: false, error: "No se ha encontrado la línea" };

    const pedido = await leerPedidoResumen(ctx, linea.pedido_id);
    if (!pedido) return { ok: false, error: NO_ENCONTRADO };
    if (pedido.estado === "borrador") return { ok: false, error: PRIMERO_ENVIA };

    const yaEsta = linea.estado_cotejo === "sustituido";
    if (marcar !== yaEsta) {
      const { error } = await ctx.supabase
        .from("compras_pedido_linea")
        .update({ estado_cotejo: marcar ? "sustituido" : null })
        .eq("id", lineaId)
        .eq("cuenta_id", ctx.cuentaId);
      if (error) return { ok: false, error: errorLegible(error, "No se ha podido guardar la marca.") };
    }

    if (pedido.albaran_doc_id || pedido.factura_doc_id) {
      const r = await ejecutarCotejo(ctx, pedido.id);
      if (!r.ok) return { ok: false, error: "Marca guardada, pero el cotejo ha fallado: pulsa «Cotejar»." };
      return { ok: true, cotejo: r.cotejo, cotejo_estado: r.cotejo_estado };
    }
    return { ok: true, cotejo: null, cotejo_estado: await leerCotejoEstado(ctx, pedido.id) };
  } catch {
    return { ok: false, error: "No se ha podido guardar la marca. Prueba otra vez." };
  }
}
