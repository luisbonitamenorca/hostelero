"use server";

/* Interpretación por IA de un pedido dictado o escrito (constructor A).
   Contrato: docs/pedidos-contratos.md §3.1 · plan §2.
   La ruta /pedidos exporta maxDuration = 60 (page.tsx): estas acciones heredan ese límite. */

import { interpretarPedido, reservarUsoIA, type MotivoErrorIA } from "@/lib/pedidos-ia";
import { comoProveedor, esUuid, hoyMadrid, limpiarTextoLargo } from "../lib-pedidos";
import { centroDeLaCuenta, exigirPedidos, type CtxPedidos } from "../servidor";
import { MAX_ALIAS_IA, MAX_CATALOGO_IA, MAX_TEXTO_PEDIDO, SELECT_PROVEEDOR } from "../tipos";
import type {
  AliasContexto,
  EntradaInterpretar,
  IdiomaDictado,
  LineaInterpretada,
  ProductoCatalogo,
  ProveedorPedido,
  Resultado,
  ResultadoInterpretacion,
} from "../tipos";

const TEXTO_ERROR_IA: Record<MotivoErrorIA, string> = {
  sin_clave: "La IA no está configurada en el servidor. Añade los productos con el buscador o por catálogo.",
  configuracion:
    "La IA no está bien configurada en el servidor. Añade los productos con el buscador o por catálogo y avisa a dirección.",
  tiempo: "La IA ha tardado demasiado. Si el pedido es largo, pártelo en dos; si no, prueba otra vez.",
  rechazo: "No se ha podido interpretar. Escríbelo de otra forma o añade los productos a mano.",
  demasiado_largo: "El pedido es demasiado largo: pártelo en dos.",
  formato: "La IA ha devuelto algo raro. Prueba otra vez.",
  red: "La IA no responde ahora mismo. Prueba otra vez en un momento.",
};

/** Margen dentro de los 60 s de la función (respuesta y serialización incluidas). */
const LIMITE_ACCION_MS = 54_000;

/** Fila de pedidos_catalogo_centro → ProductoCatalogo (nulos normalizados). */
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

/** Columnas de compras_pedido_alias para el contexto. */
const SELECT_ALIAS = "frase, frase_norm, producto_id, unidad, usos, centro_id, ultimo_uso" as const;
type FilaAlias = AliasContexto & { frase_norm: string; ultimo_uso: string };

const instante = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/** Productos (activos, pedibles y de proveedor pedible) por id, fuera del top del catálogo. */
async function leerProductosExtra(ctx: CtxPedidos, ids: string[]): Promise<Map<string, ProductoCatalogo>> {
  const extra = new Map<string, ProductoCatalogo>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await ctx.supabase
      .from("compras_producto")
      .select(
        "id, proveedor_id, nombre, ref_proveedor, codigo_interno, unidad, formato, unidades_formato, categoria, precio_catalogo, ultimo_precio, alias, compras_proveedor!inner(nombre, pedible)",
      )
      .eq("cuenta_id", ctx.cuentaId)
      .eq("activo", true)
      .eq("pedible", true)
      .eq("compras_proveedor.pedible", true)
      .in("id", ids.slice(i, i + 100));
    for (const p of data ?? []) {
      if (!p.proveedor_id) continue;
      extra.set(
        p.id,
        aProductoCatalogo({
          producto_id: p.id,
          proveedor_id: p.proveedor_id,
          proveedor_nombre: p.compras_proveedor?.nombre ?? null,
          nombre: p.nombre,
          ref_proveedor: p.ref_proveedor,
          codigo_interno: p.codigo_interno,
          unidad: p.unidad,
          formato: p.formato,
          unidades_formato: p.unidades_formato,
          categoria: p.categoria,
          precio_catalogo: p.precio_catalogo,
          veces: 0,
          cantidad_total: 0,
          ultima_cantidad: null,
          ultimo_precio: p.ultimo_precio,
          ultima_fecha: null,
          alias: p.alias,
        }),
      );
    }
  }
  return extra;
}

/** Contexto de la IA: top del catálogo del centro, alias (los del centro primero) y proveedores. */
async function cargarContexto(
  ctx: CtxPedidos,
  centroId: string,
): Promise<{ catalogo: ProductoCatalogo[]; alias: AliasContexto[]; proveedores: ProveedorPedido[] } | { error: string }> {
  // centroId ya es un uuid de la cuenta (validado antes): se puede poner en el filtro .or().
  const [cat, alCentro, alResto, prov] = await Promise.all([
    ctx.supabase.rpc("pedidos_catalogo_centro", { p_centro: centroId }).limit(MAX_CATALOGO_IA),
    // Dos lecturas para que los alias muy usados de otros centros no dejen fuera los del centro.
    ctx.supabase
      .from("compras_pedido_alias")
      .select(SELECT_ALIAS)
      .eq("cuenta_id", ctx.cuentaId)
      .eq("centro_id", centroId)
      .order("usos", { ascending: false })
      .order("ultimo_uso", { ascending: false })
      .limit(MAX_ALIAS_IA),
    ctx.supabase
      .from("compras_pedido_alias")
      .select(SELECT_ALIAS)
      .eq("cuenta_id", ctx.cuentaId)
      .or(`centro_id.is.null,centro_id.neq.${centroId}`)
      .order("usos", { ascending: false })
      .order("ultimo_uso", { ascending: false })
      .limit(MAX_ALIAS_IA),
    // Todos los proveedores pedibles (no solo los del top): la IA puede asignar el que se nombre
    // a lo que no está en el catálogo. Orden por nombre: estable para la caché del contexto.
    ctx.supabase
      .from("compras_proveedor")
      .select(SELECT_PROVEEDOR)
      .eq("cuenta_id", ctx.cuentaId)
      .eq("pedible", true)
      .order("nombre")
      .limit(1000),
  ]);
  if (cat.error) return { error: "No se ha podido leer el catálogo del centro. Prueba otra vez." };

  const catalogo = (cat.data ?? []).map((f) => aProductoCatalogo(f as FilaCatalogo));
  const enTop = new Set(catalogo.map((p) => p.producto_id));

  // Alias candidatos: los del centro, después los de toda la cuenta y después los de otros
  // centros (dentro de cada grupo, por usos; sort es estable). Si una lectura falla, sin esos alias.
  const peso = (c: string | null) => (c === centroId ? 0 : c === null ? 1 : 2);
  const candidatos: FilaAlias[] = [
    ...(alCentro.error ? [] : (alCentro.data ?? [])),
    ...(alResto.error ? [] : (alResto.data ?? [])).sort((a, b) => peso(a.centro_id) - peso(b.centro_id)),
  ];

  // Productos de alias que no están en el top: se leen aparte (activos, pedibles y de proveedor
  // pedible). Los alias de productos que ya no se pueden pedir, fuera.
  const extra = await leerProductosExtra(ctx, [
    ...new Set(candidatos.map((a) => a.producto_id).filter((id) => !enTop.has(id))),
  ]);
  const validos = candidatos.filter((a) => enTop.has(a.producto_id) || extra.has(a.producto_id));

  // Una sola entrada por frase: si la misma frase apunta a varios productos (p. ej. tras corregir
  // un alias equivocado, que se queda con más usos), manda la última aprendida o reforzada
  // (ultimo_uso), dando preferencia a las que tocan a este centro (alias del centro o de toda la
  // cuenta, o producto que se compra aquí) para que otro centro no imponga la suya.
  const toca = (a: FilaAlias) => a.centro_id === centroId || a.centro_id === null || enTop.has(a.producto_id);
  const elegido = new Map<string, FilaAlias>();
  for (const a of validos) {
    const actual = elegido.get(a.frase_norm);
    if (
      !actual ||
      (toca(a) !== toca(actual) ? toca(a) : instante(a.ultimo_uso) > instante(actual.ultimo_uso))
    ) {
      elegido.set(a.frase_norm, a);
    }
  }
  const alias: AliasContexto[] = validos
    .filter((a) => elegido.get(a.frase_norm) === a)
    .slice(0, MAX_ALIAS_IA)
    .map((a) => ({ frase: a.frase, producto_id: a.producto_id, unidad: a.unidad, usos: a.usos, centro_id: a.centro_id }));

  // Al catálogo solo los productos extra que usan los alias que quedan (con veces = 0).
  for (const a of alias) {
    const p = extra.get(a.producto_id);
    if (p && !enTop.has(p.producto_id)) {
      catalogo.push(p);
      enTop.add(p.producto_id);
    }
  }

  // Proveedores: los pedibles y, por si acaso, los del catálogo que no hayan salido.
  const proveedores: ProveedorPedido[] = (prov.error ? [] : (prov.data ?? [])).map(comoProveedor);
  const conDatos = new Set(proveedores.map((p) => p.id));
  const faltanProv = [...new Set(catalogo.map((p) => p.proveedor_id))].filter((id) => !conDatos.has(id));
  for (let i = 0; i < faltanProv.length; i += 100) {
    const { data } = await ctx.supabase
      .from("compras_proveedor")
      .select(SELECT_PROVEEDOR)
      .eq("cuenta_id", ctx.cuentaId)
      .in("id", faltanProv.slice(i, i + 100));
    for (const p of data ?? []) proveedores.push(comoProveedor(p));
  }

  return { catalogo, alias, proveedores };
}

/**
 * Texto (dictado o escrito) → líneas de pedido propuestas para revisar.
 * Pasos: validar (centro de la cuenta, texto 1..MAX_TEXTO_PEDIDO, idioma es|ca) → cargar contexto con
 * el cliente de SESIÓN (pedidos_catalogo_centro top MAX_CATALOGO_IA, alias de la cuenta con los del
 * centro primero, proveedores pedibles con días de reparto) → interpretarPedido() de
 * lib/pedidos-ia.ts → mapear uuids a ProductoCatalogo para la UI.
 * Cualquiera con el módulo. No escribe en la base.
 */
export async function interpretarTexto(entrada: EntradaInterpretar): Promise<Resultado<{ resultado: ResultadoInterpretacion }>> {
  // La función tiene maxDuration = 60 s desde aquí: la IA tiene que responder antes de este límite.
  const limite = Date.now() + LIMITE_ACCION_MS;
  const ctx = await exigirPedidos();
  try {
    if (!esUuid(entrada?.centro_id)) return { ok: false, error: "Elige un centro" };
    if (typeof entrada.texto === "string" && entrada.texto.trim().length > MAX_TEXTO_PEDIDO) {
      return { ok: false, error: TEXTO_ERROR_IA.demasiado_largo };
    }
    const texto = limpiarTextoLargo(entrada.texto, MAX_TEXTO_PEDIDO);
    if (!texto) return { ok: false, error: "Escribe o dicta el pedido" };
    const idioma: IdiomaDictado = entrada.idioma === "ca" ? "ca" : "es";

    // Sin clave no merece la pena leer el catálogo (solo existe en Vercel).
    if (!process.env.ANTHROPIC_API_KEY?.trim()) return { ok: false, error: TEXTO_ERROR_IA.sin_clave };

    const centro = await centroDeLaCuenta(ctx, entrada.centro_id);
    if (!centro) return { ok: false, error: "Elige un centro" };

    // Freno al gasto: pocas interpretaciones seguidas por persona y por cuenta.
    const cupo = reservarUsoIA(ctx.perfil.id, ctx.cuentaId);
    if (!cupo.ok) {
      const espera = cupo.esperaS < 60 ? `${cupo.esperaS} segundos` : `${Math.ceil(cupo.esperaS / 60)} minutos`;
      return {
        ok: false,
        error: `Se han interpretado muchos pedidos seguidos. Espera ${espera} y prueba otra vez, o añade los productos con el buscador.`,
      };
    }

    const contexto = await cargarContexto(ctx, centro.id);
    if ("error" in contexto) return { ok: false, error: contexto.error };

    const r = await interpretarPedido({
      texto,
      idioma,
      hoy: hoyMadrid(),
      centro: { id: centro.id, nombre: centro.nombre },
      catalogo: contexto.catalogo,
      alias: contexto.alias,
      proveedores: contexto.proveedores,
      limite,
    });
    if (!r.ok) {
      // 401/403: la clave existe pero no vale; el texto de la librería lo dice mejor.
      if (r.motivo === "sin_clave" && process.env.ANTHROPIC_API_KEY?.trim()) {
        return { ok: false, error: `${r.error} Añade los productos con el buscador o por catálogo.` };
      }
      return { ok: false, error: TEXTO_ERROR_IA[r.motivo] };
    }

    const porId = new Map(contexto.catalogo.map((p) => [p.producto_id, p]));
    const nombreProv = new Map<string, string>(contexto.proveedores.map((p) => [p.id, p.nombre]));
    for (const p of contexto.catalogo) if (!nombreProv.has(p.proveedor_id)) nombreProv.set(p.proveedor_id, p.proveedor_nombre);

    const lineas: LineaInterpretada[] = r.interpretacion.lineas.map((l) => {
      const producto = l.producto_id ? (porId.get(l.producto_id) ?? null) : null;
      const proveedor_id = producto?.proveedor_id ?? l.proveedor_id;
      return {
        producto,
        alternativas: l.alternativas.map((id) => porId.get(id)).filter((p): p is ProductoCatalogo => !!p),
        proveedor_id,
        proveedor_nombre: proveedor_id ? (nombreProv.get(proveedor_id) ?? null) : null,
        texto_original: l.texto_original,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        // La librería ya pone la unidad del producto si la IA no dijo ninguna.
        unidad: l.unidad,
        confianza: l.confianza,
        nota: l.nota,
      };
    });

    return {
      ok: true,
      resultado: {
        lineas,
        fecha_entrega: r.interpretacion.fecha_entrega,
        notas: r.interpretacion.notas,
        dudas: r.interpretacion.dudas,
        idioma,
        interpretacion: r.interpretacion,
      },
    };
  } catch {
    return { ok: false, error: "No se ha podido interpretar. Prueba otra vez o añade los productos a mano." };
  }
}
