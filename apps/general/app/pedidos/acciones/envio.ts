"use server";

/* Envío de pedidos al proveedor: vista previa, email (Resend), marcar enviado por WhatsApp /
   teléfono / web, cancelar (constructor A). Contrato: docs/pedidos-contratos.md §3.3.
   Cualquiera con el módulo. El texto y el HTML los componen textoPedido/htmlPedido de lib-pedidos. */

import { enviarCorreo } from "@/lib/correo";
import {
  asuntoPedido,
  comoProveedor,
  enlaceMailto,
  enlaceTelefono,
  enlaceWhatsApp,
  esCanalPedido,
  esEmail,
  esEstadoPedido,
  esUuid,
  estadoMinimo,
  formatoEuros,
  hoyMadrid,
  htmlPedido,
  isoDiaSemana,
  limpiarTexto,
  textoDiasReparto,
  textoPedido,
  totalEstimado,
} from "../lib-pedidos";
import { configPedidos, errorLegible, exigirPedidos, leerLineasPedido, leerPedidoResumen, type CtxPedidos } from "../servidor";
import { SELECT_PROVEEDOR } from "../tipos";
import type {
  AlternativaEnvio,
  CanalPedido,
  DatosTextoPedido,
  ErrorConAlternativa,
  ErrorYaEnviado,
  EstadoPedido,
  LineaPedido,
  PedidoResumen,
  ProveedorPedido,
  Resultado,
  VistaEnvio,
} from "../tipos";

/* ═══════════════════════ Ayudas internas (sin export: fichero "use server") ═══════════════════════ */

const ERROR_NO_PEDIDO = "No se ha encontrado el pedido";
const ERROR_YA_ENVIADO = "El pedido ya está enviado";
/** Tope de pedidos por email por persona y hora (protege el cupo diario de Resend). */
const MAX_EMAILS_HORA = 30;

type PedidoEnvio = {
  id: string;
  numero: string;
  estado: EstadoPedido;
  fecha_entrega: string | null;
  notas: string | null;
  total_estimado: number | null;
  centro: { nombre: string; direccion: string | null };
  proveedor: ProveedorPedido | null;
  lineas: LineaPedido[];
};

/** Pedido de la cuenta con centro, proveedor (datos de pedido) y líneas en orden. */
async function leerPedidoEnvio(ctx: CtxPedidos, pedidoId: unknown): Promise<PedidoEnvio | string> {
  if (!esUuid(pedidoId)) return ERROR_NO_PEDIDO;
  const [{ data: p, error }, lineas] = await Promise.all([
    ctx.supabase
      .from("compras_pedido")
      .select("id, numero, estado, proveedor_id, fecha_entrega, notas, total_estimado, centros(nombre, direccion)")
      .eq("id", pedidoId)
      .eq("cuenta_id", ctx.cuentaId)
      .maybeSingle(),
    leerLineasPedido(ctx, pedidoId),
  ]);
  if (error) return errorLegible(error, "No se ha podido leer el pedido. Prueba otra vez.");
  if (!p) return ERROR_NO_PEDIDO;
  if (!lineas) return "No se han podido leer las líneas del pedido. Prueba otra vez.";
  let proveedor: ProveedorPedido | null = null;
  if (p.proveedor_id) {
    const { data: prov } = await ctx.supabase
      .from("compras_proveedor")
      .select(SELECT_PROVEEDOR)
      .eq("id", p.proveedor_id)
      .eq("cuenta_id", ctx.cuentaId)
      .maybeSingle();
    proveedor = prov ? comoProveedor(prov) : null;
  }
  return {
    id: p.id,
    numero: p.numero,
    estado: esEstadoPedido(p.estado) ? p.estado : "borrador",
    fecha_entrega: p.fecha_entrega,
    notas: p.notas,
    total_estimado: p.total_estimado,
    centro: { nombre: p.centros?.nombre ?? "", direccion: p.centros?.direccion?.trim() || null },
    proveedor,
    lineas,
  };
}

/** Datos con los que lib-pedidos compone asunto, texto y HTML. */
function datosTexto(ctx: CtxPedidos, p: PedidoEnvio): DatosTextoPedido {
  return {
    numero: p.numero,
    cuenta_nombre: ctx.cuenta.nombre,
    centro_nombre: p.centro.nombre,
    centro_direccion: p.centro.direccion,
    proveedor_nombre: p.proveedor?.nombre ?? "",
    fecha_entrega: p.fecha_entrega,
    notas: p.notas,
    lineas: p.lineas.map((l) => ({
      ref: l.producto?.ref_proveedor ?? null,
      nombre: l.producto?.nombre ?? l.descripcion ?? l.texto_original ?? "(sin descripción)",
      cantidad: l.cantidad,
      unidad: l.unidad,
      nota: l.nota,
    })),
    contacto: { nombre: ctx.perfil.nombre ?? null, correo: ctx.perfil.correo ?? null, telefono: null },
    buzon_albaranes: configPedidos().buzon_albaranes,
  };
}

/** Por qué no se puede enviar (solo por estado, proveedor y líneas); null = se puede. */
function motivoBloqueo(p: PedidoEnvio): string | null {
  if (p.estado === "cancelado") return "El pedido está cancelado";
  if (p.estado !== "borrador") return ERROR_YA_ENVIADO;
  if (!p.proveedor) return "Elige el proveedor";
  if (!p.lineas.length) return "El pedido no tiene líneas";
  return null;
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

/** Marca enviado un borrador (update condicionado a estado = 'borrador'). */
async function marcar(ctx: CtxPedidos, pedidoId: string, canal: CanalPedido): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from("compras_pedido")
    .update({ estado: "enviado", canal_envio: canal })
    .eq("id", pedidoId)
    .eq("cuenta_id", ctx.cuentaId)
    .eq("estado", "borrador")
    .select("id");
  if (error) return errorLegible(error, "No se ha podido marcar como enviado. Prueba otra vez.");
  if (!data?.length) return ERROR_YA_ENVIADO;
  return null;
}

/** Email guardado del proveedor (válido) o null. */
const emailProveedor = (p: PedidoEnvio): string | null =>
  esEmail(p.proveedor?.pedido_email) ? p.proveedor!.pedido_email!.trim() : null;

/** Solo quien gestiona puede mandar a otra dirección; los demás, solo si el proveedor no tiene email. */
const puedeCambiarEmail = (ctx: CtxPedidos, p: PedidoEnvio) => ctx.gestiona || !emailProveedor(p);

/** Pedidos que esta persona ha mandado por email en la última hora. */
async function emailsUltimaHora(ctx: CtxPedidos): Promise<number> {
  const { count, error } = await ctx.supabase
    .from("compras_pedido")
    .select("id", { count: "exact", head: true })
    .eq("cuenta_id", ctx.cuentaId)
    .eq("enviado_por", ctx.perfil.id)
    .eq("canal_envio", "email")
    .gte("enviado_en", new Date(Date.now() - 3_600_000).toISOString());
  return error ? 0 : (count ?? 0);
}

/* ═══════════════════════ Acciones ═══════════════════════ */

/** Vista previa del envío según el canal del proveedor: destino, asunto, texto, HTML, enlaces
    (wa.me, mailto, tel), aviso de mínimo y si se puede enviar. No escribe. */
export async function prepararEnvio(pedidoId: string): Promise<Resultado<{ envio: VistaEnvio }>> {
  const ctx = await exigirPedidos();
  try {
    const p = await leerPedidoEnvio(ctx, pedidoId);
    if (typeof p === "string") return { ok: false, error: p };
    const config = configPedidos();
    const prov = p.proveedor;
    const canal: CanalPedido = prov?.pedido_canal ?? "email";
    const datos = datosTexto(ctx, p);
    const asunto = asuntoPedido(datos);
    const texto = textoPedido(datos);
    const html = htmlPedido(datos);

    const destino =
      canal === "email"
        ? (prov?.pedido_email ?? null)
        : canal === "whatsapp"
          ? (prov?.pedido_whatsapp ?? null)
          : canal === "telefono"
            ? (prov?.pedido_telefono ?? null)
            : null;

    const total = p.total_estimado ?? totalEstimado(p.lineas);
    const minimo = estadoMinimo(prov, total);

    const avisos: string[] = [];
    if (minimo && !minimo.cumple) {
      avisos.push(
        `Pedido mínimo ${formatoEuros(minimo.minimo)}: ${total != null ? `llevas ${formatoEuros(total)}` : "no se sabe el total (faltan precios)"}`,
      );
    }
    const sinIdentificar = p.lineas.filter((l) => !l.producto_id).length;
    if (sinIdentificar) {
      avisos.push(
        `${sinIdentificar} ${plural(sinIdentificar, "línea sin identificar: se envía", "líneas sin identificar: se envían")} con su descripción`,
      );
    }
    if (p.lineas.some((l) => l.precio_estimado == null)) avisos.push("Hay líneas sin precio: el total es aproximado");
    const hoy = hoyMadrid();
    if (!p.fecha_entrega) avisos.push("Sin fecha de entrega");
    else if (p.fecha_entrega < hoy) avisos.push("La fecha de entrega ya ha pasado");
    else if (prov?.pedido_dias_reparto?.length && !prov.pedido_dias_reparto.includes(isoDiaSemana(p.fecha_entrega))) {
      avisos.push(`El proveedor reparte ${textoDiasReparto(prov.pedido_dias_reparto)}`);
    }
    // Configuración del servidor: solo a quien puede arreglarla (los demás no pueden hacer nada).
    if (ctx.gestiona && !config.buzon_albaranes) {
      avisos.push("No hay buzón de albaranes configurado: el pie no pide el albarán en PDF");
    }

    // Avisos de cada canal: la ficha pinta los del canal que el usuario tenga elegido.
    const avisos_canal: Record<CanalPedido, string[]> = { email: [], whatsapp: [], telefono: [], portal: [] };
    if (prov) {
      if (!esEmail(prov.pedido_email)) avisos_canal.email.push("Escribe el email del proveedor para enviarlo");
      if (!config.correo_configurado) {
        avisos_canal.email.push(
          ctx.gestiona
            ? "El correo no está configurado en el servidor: ábrelo en tu correo y después pulsa «Ya lo he enviado»"
            : "Hoy no se puede enviar el correo desde aquí: ábrelo en tu correo y después pulsa «Ya lo he enviado»",
        );
      }
      if (!prov.pedido_whatsapp) avisos_canal.whatsapp.push("No hay WhatsApp del proveedor: elige el chat al abrirlo");
      if (!enlaceTelefono(prov.pedido_telefono)) {
        avisos_canal.telefono.push(
          ctx.gestiona ? "No hay teléfono del proveedor en Ajustes" : "No hay teléfono del proveedor guardado",
        );
      }
    }

    const motivo = motivoBloqueo(p);
    return {
      ok: true,
      envio: {
        canal,
        destino,
        asunto,
        texto,
        html,
        enlace_whatsapp: enlaceWhatsApp(prov?.pedido_whatsapp, texto),
        enlace_mailto: enlaceMailto(prov?.pedido_email, asunto, texto),
        enlace_telefono: enlaceTelefono(prov?.pedido_telefono),
        minimo,
        avisos,
        avisos_canal,
        email_editable: puedeCambiarEmail(ctx, p),
        puede_enviar: motivo === null,
        motivo_bloqueo: motivo,
      },
    };
  } catch {
    return { ok: false, error: "No se ha podido preparar el envío. Prueba otra vez." };
  }
}

/** Envía el borrador por email y, SOLO si el correo sale, lo marca enviado (canal email).
    Destino: el email del proveedor guardado en Ajustes. `para` (otra dirección) solo lo acepta de
    quien gestiona, o de cualquiera si el proveedor no tiene email guardado.
    Si no sale: { ok: false, error, alternativa } para copiar el texto o abrir el mailto.
    Si sale pero no se puede marcar: { ok: false, error, ya_enviado: true } (no hay que reenviarlo). */
export async function enviarPorEmail(
  pedidoId: string,
  opciones?: { para?: string | null },
): Promise<Resultado<{ pedido: PedidoResumen }> | ErrorConAlternativa | ErrorYaEnviado> {
  const ctx = await exigirPedidos();
  try {
    const p = await leerPedidoEnvio(ctx, pedidoId);
    if (typeof p === "string") return { ok: false, error: p };
    const motivo = motivoBloqueo(p);
    if (motivo) return { ok: false, error: motivo };

    const guardado = emailProveedor(p);
    const escrito = limpiarTexto(opciones?.para, 254);
    if (escrito && !esEmail(escrito)) return { ok: false, error: "Ese email no parece válido" };
    let para = guardado;
    if (escrito && escrito.toLowerCase() !== guardado?.toLowerCase()) {
      if (!puedeCambiarEmail(ctx, p)) {
        return {
          ok: false,
          error: "El pedido se envía al email del proveedor guardado en Ajustes. Si hay que cambiarlo, avisa a dirección o a tu responsable.",
        };
      }
      para = escrito;
    }

    const datos = datosTexto(ctx, p);
    const asunto = asuntoPedido(datos);
    const texto = textoPedido(datos);
    const alternativa = (destino: string | null): AlternativaEnvio => ({
      para: destino,
      asunto,
      texto,
      enlace_mailto: enlaceMailto(destino, asunto, texto),
    });

    if (!para) return { ok: false, error: "Falta el email del proveedor", alternativa: alternativa(null) };

    // Tope por persona y hora: un pedido solo se envía una vez, pero se pueden crear muchos borradores.
    if ((await emailsUltimaHora(ctx)) >= MAX_EMAILS_HORA) {
      return {
        ok: false,
        error: "Has enviado muchos pedidos por email en la última hora. Mándalo desde tu correo y después pulsa «Ya lo he enviado».",
        alternativa: alternativa(para),
      };
    }

    const enviado = await enviarCorreo({
      para,
      asunto,
      html: htmlPedido(datos),
      texto,
      responderA: esEmail(ctx.perfil.correo) ? ctx.perfil.correo : undefined,
      remitente: configPedidos().remitente ?? undefined,
    });
    if (!enviado) {
      return {
        ok: false,
        error: "No se ha podido enviar el correo. Copia el texto o ábrelo en tu correo y después pulsa «Ya lo he enviado».",
        alternativa: alternativa(para),
      };
    }
    // Rastro del destino en los registros del servidor (la tabla solo guarda canal_envio). Solo el
    // dominio: plan §4, nada de datos personales en logs (una dirección escrita a mano puede serlo).
    const dominio = para.slice(para.lastIndexOf("@") + 1);
    console.info(
      `[pedidos] ${p.numero} enviado por email a …@${dominio}${para !== guardado ? " (dirección escrita a mano)" : ""} por ${ctx.perfil.id}`,
    );

    // Primero enviar y después marcar: si se marcara antes y hubiera que deshacerlo, enviado_en
    // se quedaría puesto (el trigger no lo borra nunca). Un reintento ante un fallo pasajero.
    let e = await marcar(ctx, p.id, "email");
    if (e && e !== ERROR_YA_ENVIADO) e = await marcar(ctx, p.id, "email");
    if (e && e !== ERROR_YA_ENVIADO) {
      return {
        ok: false,
        error: "El correo ha salido, pero no se ha podido marcar como enviado. No lo reenvíes: pulsa «Ya lo he enviado».",
        ya_enviado: true,
      };
    }
    // ERROR_YA_ENVIADO: otra persona lo marcó a la vez; el pedido ya está enviado igualmente.
    const pedido = await leerPedidoResumen(ctx, p.id);
    if (!pedido) return { ok: false, error: "El correo ha salido y el pedido está marcado como enviado. Recarga la lista." };
    return { ok: true, pedido };
  } catch {
    return { ok: false, error: "No se ha podido enviar. Prueba otra vez." };
  }
}

/** Marca el borrador como enviado por el canal indicado (WhatsApp ya abierto, llamada hecha,
    web del proveedor o email mandado a mano desde el mailto). */
export async function marcarEnviado(pedidoId: string, canal: CanalPedido): Promise<Resultado<{ pedido: PedidoResumen }>> {
  const ctx = await exigirPedidos();
  try {
    if (!esCanalPedido(canal)) return { ok: false, error: "Elige cómo lo has enviado" };
    const p = await leerPedidoEnvio(ctx, pedidoId);
    if (typeof p === "string") return { ok: false, error: p };
    const motivo = motivoBloqueo(p);
    if (motivo) return { ok: false, error: motivo };
    const e = await marcar(ctx, p.id, canal);
    if (e) return { ok: false, error: e };
    const pedido = await leerPedidoResumen(ctx, p.id);
    if (!pedido) return { ok: false, error: "El pedido está marcado como enviado. Recarga la lista." };
    return { ok: true, pedido };
  } catch {
    return { ok: false, error: "No se ha podido marcar como enviado. Prueba otra vez." };
  }
}

/** Cancela un pedido en borrador, enviado o confirmado (no uno ya recibido). */
export async function cancelarPedido(pedidoId: string): Promise<Resultado<{ pedido: PedidoResumen }>> {
  const ctx = await exigirPedidos();
  try {
    if (!esUuid(pedidoId)) return { ok: false, error: ERROR_NO_PEDIDO };
    const actual = await leerPedidoResumen(ctx, pedidoId);
    if (!actual) return { ok: false, error: ERROR_NO_PEDIDO };
    if (actual.estado === "cancelado") return { ok: true, pedido: actual };
    if (actual.estado === "recibido" || actual.estado === "recibido_parcial") {
      return { ok: false, error: "Ya está recibido: no se puede cancelar" };
    }
    const { data, error } = await ctx.supabase
      .from("compras_pedido")
      .update({ estado: "cancelado" })
      .eq("id", actual.id)
      .eq("cuenta_id", ctx.cuentaId)
      .in("estado", ["borrador", "enviado", "confirmado"])
      .select("id");
    if (error) return { ok: false, error: errorLegible(error, "No se ha podido cancelar. Prueba otra vez.") };
    if (!data?.length) return { ok: false, error: "El pedido ha cambiado mientras tanto: recárgalo" };
    const pedido = await leerPedidoResumen(ctx, actual.id);
    if (!pedido) return { ok: false, error: "El pedido está cancelado. Recarga la lista." };
    return { ok: true, pedido };
  } catch {
    return { ok: false, error: "No se ha podido cancelar. Prueba otra vez." };
  }
}
