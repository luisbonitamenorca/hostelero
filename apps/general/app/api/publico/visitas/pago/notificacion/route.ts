import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/visitas-publico";
import { configTpv, validarNotificacion } from "@/lib/redsys";
import { correoConfirmacionVisita } from "@/lib/correo-visitas";

export const dynamic = "force-dynamic";

/**
 * Notificación servidor-a-servidor del TPV: ESTA es la verdad del pago (la
 * pantalla de vuelta del cliente puede no llegar nunca). El banco manda un
 * POST form-urlencoded con los parámetros y la firma; si la firma no casa,
 * la petición no existe. Siempre respondemos 200 para que el banco no
 * reintente contra un error nuestro ya registrado.
 */
export async function POST(req: Request) {
  const cfg = configTpv();
  const sb = crearClienteServicio();
  if (!cfg || !sb) return new NextResponse("config", { status: 503 });

  const cuerpo = await req.formData().catch(() => null);
  const parametros = String(cuerpo?.get("Ds_MerchantParameters") || "");
  const firma = String(cuerpo?.get("Ds_Signature") || "");
  if (!parametros || !firma) return new NextResponse("datos", { status: 400 });

  const noti = validarNotificacion(cfg, parametros, firma);
  if (!noti) return new NextResponse("firma", { status: 400 });

  const { data: pago } = await sb
    .from("visitas_pagos")
    .select("id, reserva_id, estado")
    .eq("cuenta_id", CUENTA_PUBLICA)
    .eq("ds_order", noti.pedido)
    .maybeSingle();
  if (!pago) return new NextResponse("pedido", { status: 404 });

  // Reintentos del banco sobre un pago ya resuelto: no se pisa nada.
  if (pago.estado !== "iniciado") return new NextResponse("OK");

  const autorizado = noti.respuesta >= 0 && noti.respuesta <= 99;

  await sb
    .from("visitas_pagos")
    .update({
      estado: autorizado ? "pagado" : "rechazado",
      ds_respuesta: noti.parametros,
      autorizacion: noti.autorizacion,
      pagado_at: autorizado ? new Date().toISOString() : null,
    })
    .eq("id", pago.id);

  if (autorizado) {
    await sb
      .from("visitas_reservas")
      .update({ estado: "pagada" })
      .eq("id", pago.reserva_id)
      .eq("estado", "pendiente_pago");

    // Email de confirmación (Resend). Después de responder nada: el banco
    // espera su OK, así que el envío ocurre aquí pero sin condicionar la
    // respuesta — si falla o Resend no está configurado, el pago ya es pago.
    const { data: r } = await sb
      .from("visitas_reservas")
      .select(
        "codigo_reserva, cliente_nombre, cliente_email, num_personas, importe_total, idioma_preferido, visitas_sesiones(fecha, hora_inicio, visitas_productos(nombre_es, nombre_en, nombre_fr))",
      )
      .eq("id", pago.reserva_id)
      .maybeSingle();
    if (r?.cliente_email) {
      const ses = r.visitas_sesiones;
      const prod = ses?.visitas_productos;
      const idioma = (r.idioma_preferido ?? "es") as "es" | "en" | "fr";
      const producto =
        (idioma === "en" ? prod?.nombre_en : idioma === "fr" ? prod?.nombre_fr : prod?.nombre_es) ||
        prod?.nombre_es ||
        "Visita";
      await correoConfirmacionVisita({
        para: r.cliente_email,
        nombre: r.cliente_nombre || "",
        codigo: r.codigo_reserva,
        producto,
        fecha: ses?.fecha || "",
        hora: (ses?.hora_inicio || "").slice(0, 5),
        personas: r.num_personas,
        importe: Number(r.importe_total || 0),
        idioma,
      });
    }
  }

  return new NextResponse("OK");
}
