import { NextResponse } from "next/server";
import { clienteServicioMensajeria, enviarPendientes, type ClienteSb } from "@/lib/mensajeria";
import { instanteLocal } from "@/lib/mensajeria-plantillas";
import { cobrarNoShowsPendientes } from "@/lib/pagos-reservas";
import { configTpv } from "@/lib/redsys";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron de Reservas (Vercel, cada 5 minutos; ver vercel.json). Protegido por CRON_SECRET
 * (Vercel la manda como `Authorization: Bearer`). En cada pasada, por este orden:
 *   1. reservas_marcar_a_revisar        → confirmadas sin llegada tras liberar_tras_min.
 *   2. reservas_noshow_automatico       → no_show al cierre del turno; si devuelve cobrar=true
 *                                          y la reserva NO es de Cover, se cobra la garantía con
 *                                          la tarjeta guardada (lib/pagos-reservas → Redsys).
 *                                          Sin TPV configurado no se cobra: queda en la respuesta
 *                                          y la reserva sigue «garantizada» para cobrarla a mano.
 *   3. reservas_caducar_tarjeta_pendiente → tarjeta_pendiente vencida → cancelada por el sistema.
 *   4. reservas_aplicar_autotags        → etiquetas automáticas de clientes.
 *   5. recordatorios que falten en las próximas 48 h (reservas_programar_mensajes), nunca cover_id;
 *      solo en locales con plantilla «recordatorio» activa para algún canal.
 *   6. enviarPendientes                 → manda lo encolado cuya hora ha llegado.
 * Cada paso va en su try: un fallo no frena a los demás y se devuelve en la respuesta.
 *
 * REGLA MIENTRAS COVER SIGA VIVO: una reserva con cover_id solo se MARCA (a_revisar / no_show);
 * ni se le cobra ni se le reprograman avisos desde aquí: Cover sigue haciéndolo.
 */
export async function GET(req: Request) {
  const t0 = Date.now();
  const secreto = process.env.CRON_SECRET;
  if (secreto && req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  }
  if (!secreto && process.env.VERCEL_ENV === "production") {
    // A diferencia de purgar-dni, este cron cobra garantías y envía mensajes: sin secreto, cerrado.
    console.error("[cron reservas-mensajes] CRON_SECRET sin definir: el cron no se ejecuta");
    return NextResponse.json({ error: "config_pendiente" }, { status: 503 });
  }
  const sb = clienteServicioMensajeria();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const url = new URL(req.url);
  const limite = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limite") || "40", 10) || 40));
  const errores: Record<string, string> = {};
  const res: Record<string, unknown> = {};

  // 1) A revisar
  try {
    const { data, error } = await sb.rpc("reservas_marcar_a_revisar");
    if (error) throw error;
    res.a_revisar = data ?? 0;
  } catch (e) {
    errores.a_revisar = (e as Error).message;
  }

  // 2) No-show automático (+ cobro de garantía si procede)
  try {
    const { data, error } = await sb.rpc("reservas_noshow_automatico");
    if (error) throw error;
    const filas = data ?? [];
    res.no_show = filas.length;
    const cobros = await procesarCobrosNoShow(sb, filas);
    res.cobros = cobros;
    if (cobros.inciertos || cobros.fallidos) {
      // Un cargo incierto (Redsys no contestó) o fallido hay que revisarlo a mano: 207 y al log.
      errores.cobros = `${cobros.inciertos} incierto(s) y ${cobros.fallidos} fallido(s): revisar en Redsys y en la reserva`;
      console.error("[cron reservas-mensajes] cobros de no-show a revisar:", cobros.errores.join(" | ") || "(inciertos sin detalle)");
    }
  } catch (e) {
    errores.no_show = (e as Error).message;
  }

  // 3) Tarjeta pendiente caducada
  try {
    const { data, error } = await sb.rpc("reservas_caducar_tarjeta_pendiente");
    if (error) throw error;
    res.tarjeta_caducada = data ?? 0;
  } catch (e) {
    errores.tarjeta_caducada = (e as Error).message;
  }

  // 4) Autotags
  try {
    const { data, error } = await sb.rpc("reservas_aplicar_autotags");
    if (error) throw error;
    res.autotags = data ?? 0;
  } catch (e) {
    errores.autotags = (e as Error).message;
  }

  // 5) Recordatorios de mañana que falten
  try {
    res.recordatorios = await reprogramarRecordatorios(sb);
  } catch (e) {
    errores.recordatorios = (e as Error).message;
  }

  // 6) Envío
  try {
    // Margen para no pasarse del maxDuration (60 s) con lo que ya han tardado los pasos 1-5.
    const envio = await enviarPendientes(limite, { hasta: t0 + 50000 });
    if (envio.error) errores.envio = envio.error;
    const { detalle, ...resumen } = envio;
    res.envio = resumen;
    // Solo el detalle de lo que no ha ido bien (para leerlo en los logs de Vercel).
    // El texto del proveedor puede llevar el teléfono o el email del cliente: se tacha.
    const malos = detalle.filter((d) => d.estado !== "enviado");
    if (malos.length) res.envio_incidencias = malos.slice(0, 50).map((d) => ({ ...d, error: d.error ? tachar(d.error) : null }));
  } catch (e) {
    errores.envio = (e as Error).message;
  }

  const ok = Object.keys(errores).length === 0;
  if (!ok) console.error("[cron reservas-mensajes]", errores);
  return NextResponse.json({ ok, ...res, ...(ok ? {} : { errores }) }, { status: ok ? 200 : 207 });
}

/** Tacha teléfonos y emails de un texto de error del proveedor (la respuesta acaba en logs). */
function tachar(t: string): string {
  return t.replace(/\S+@\S+/g, "[email]").replace(/\+?\d[\d\s-]{7,16}\d/g, "[teléfono]");
}

type FilaNoShow = { reserva_id: string; cuenta_id: string; restaurante_id: string; tipo: string; estado_pago: string; importe: number; cobrar: boolean };

/**
 * Cobro de garantía de los no-shows que lo piden (cobrar = true: cobro automático activo en el
 * restaurante, reserva garantizada con importe). Las reservas de Cover NUNCA se cobran desde
 * aquí: solo quedan marcadas (las cobra Cover). El cobro real lo hace lib/pagos-reservas
 * (cobrarGarantia con la referencia COF guardada; no cobra dos veces).
 */
async function procesarCobrosNoShow(sb: ClienteSb, filas: FilaNoShow[]) {
  const aCobrar = filas.filter((f) => f.cobrar && Number(f.importe) > 0);
  const out = { pedidos: aCobrar.length, cobrados: 0, fallidos: 0, inciertos: 0, errores: [] as string[], cover: 0, sin_tpv: 0 };
  if (!aCobrar.length) return out;

  const { data: reservas } = await sb
    .from("reservas_reservas")
    .select("id, cover_id")
    .in(
      "id",
      aCobrar.map((f) => f.reserva_id),
    );
  const esCover = new Map((reservas ?? []).map((r) => [r.id, !!r.cover_id]));
  const nuestras = aCobrar.filter((f) => {
    if (esCover.get(f.reserva_id) ?? true) {
      // De Cover (o que no hemos podido comprobar): solo marcada, sin cobro.
      out.cover++;
      return false;
    }
    return true;
  });
  if (!nuestras.length) return out;

  const cfg = configTpv();
  if (!cfg) {
    out.sin_tpv = nuestras.length;
    console.warn("[cron reservas-mensajes] no-shows con cobro automático pero sin TPV configurado:", nuestras.map((f) => f.reserva_id).join(", "));
    return out;
  }
  const r = await cobrarNoShowsPendientes(sb, cfg, nuestras);
  out.cobrados = r.cobrados;
  out.fallidos = r.fallidos;
  out.inciertos = r.inciertos;
  out.errores = r.errores.slice(0, 20); // «<reserva_id>: <código>», sin datos del cliente
  return out;
}

/** Fecha AAAA-MM-DD de «hoy + n días» en una zona horaria. */
function fechaEn(tz: string, masDias = 0): string {
  const d = new Date(Date.now() + masDias * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); // en-CA = AAAA-MM-DD
}

/**
 * Red de seguridad: reservas vivas de hoy a pasado mañana, con aviso activado, cuyo recordatorio
 * aún está a tiempo (más de 15 min por delante, igual que el SQL) y que no tienen NINGÚN
 * recordatorio (ni en cola, ni enviado, ni cancelado: si alguien lo canceló a mano, no se
 * resucita). Casos: reservas creadas sin notificar y activadas después, o metidas a mano.
 * Se les pasa reservas_programar_mensajes(id), que encola lo que falte. Nunca reservas de Cover.
 */
async function reprogramarRecordatorios(sb: ClienteSb) {
  const out = { revisadas: 0, programadas: 0 };
  const { data: rests } = await sb
    .from("reservas_restaurantes")
    .select("id, cuenta_id, zona_horaria, recordatorio_horas, envio_email, envio_sms, envio_whatsapp")
    .eq("activo", true);
  const margen = Date.now() + 15 * 60000;
  for (const rest of rests ?? []) {
    if (!rest.envio_email && !rest.envio_sms && !rest.envio_whatsapp) continue;
    // Sin plantilla «recordatorio» activa para ningún canal del local, el RPC no encola nada:
    // no se le llama cada 5 minutos en vano.
    const canales = [rest.envio_email && "email", rest.envio_sms && "sms", rest.envio_whatsapp && "whatsapp"].filter((c): c is string => !!c);
    const { data: pls } = await sb
      .from("reservas_plantillas")
      .select("id")
      .eq("cuenta_id", rest.cuenta_id)
      .eq("activa", true)
      .eq("tipo", "recordatorio")
      .in("canal", canales)
      .or(`restaurante_id.eq.${rest.id},restaurante_id.is.null`)
      .limit(1);
    if (!pls?.length) continue;
    const tz = rest.zona_horaria || "Europe/Madrid";
    const { data: reservas } = await sb
      .from("reservas_reservas")
      .select("id, fecha, hora, reservas_clientes(email, telefono, telefono_norm)")
      .eq("restaurante_id", rest.id)
      .gte("fecha", fechaEn(tz, 0))
      .lte("fecha", fechaEn(tz, 2))
      .in("estado", ["pendiente", "confirmada", "reconfirmada"])
      .eq("notificar", true)
      .neq("origen", "walkin")
      .is("cover_id", null)
      .is("recordatorio_enviado_en", null)
      .limit(500);
    const aTiempo = (reservas ?? []).filter((r) => {
      // Sin destinatario para ningún canal activo no hay nada que programar (y no se insiste cada 5 min).
      const c = r.reservas_clientes;
      const tieneDestino = (rest.envio_email && !!c?.email) || ((rest.envio_sms || rest.envio_whatsapp) && !!(c?.telefono_norm || c?.telefono));
      return tieneDestino && instanteLocal(r.fecha, r.hora, tz).getTime() - rest.recordatorio_horas * 3600000 > margen;
    });
    if (!aTiempo.length) continue;
    const ids = aTiempo.map((r) => r.id);
    const { data: conAviso } = await sb.from("reservas_mensajes").select("reserva_id").eq("tipo", "recordatorio").in("reserva_id", ids);
    const ya = new Set((conAviso ?? []).map((m) => m.reserva_id));
    for (const id of ids) {
      if (ya.has(id)) continue;
      out.revisadas++;
      const { data } = await sb.rpc("reservas_programar_mensajes", { p_reserva_id: id });
      const j = data as unknown as { encolados?: number } | null;
      if (j && (j.encolados ?? 0) > 0) out.programadas++;
    }
  }
  return out;
}
