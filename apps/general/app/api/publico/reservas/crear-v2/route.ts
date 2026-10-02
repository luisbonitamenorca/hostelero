import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { registrarConsentimientoPublico } from "@/lib/crm-publico";
import { cuerpo, entero, esEmail, esFecha, esHora, esSlug, esToken, esUuid, horaSql, idioma, limitar, localPublico, telefono, texto } from "../_comun";

export const dynamic = "force-dynamic";

/**
 * Alta online v2 (RPC reservas_crear_online_v2): todos los campos del widget. Devuelve solo los
 * campos que pinta la confirmación (lista blanca: nada de ids internos) más `ics` (enlace al .ics
 * de la reserva), o {error}.
 * Si `requiere_pago` viene informado, el widget redirige a /reserva/<token>/pago.
 */
export async function POST(req: Request) {
  const bloqueo = limitar(req, "crear", 10, 10 * 60_000);
  if (bloqueo) return bloqueo;
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const b = await cuerpo(req);
  if (!b) return NextResponse.json({ error: "datos" }, { status: 400 });

  const slug = texto(b.slug, 64);
  const fecha = b.fecha;
  const hora = b.hora;
  const pax = entero(b.pax, 1, 200);
  const nombre = texto(b.nombre, 120);
  const apellidos = texto(b.apellidos, 120);
  const tel = telefono(b.telefono);
  const email = texto(b.email, 254).toLowerCase();
  const notas = texto(b.notas, 2000);
  const alergias = texto(b.alergias, 1000);
  const lang = idioma(b.idioma);
  const pais = texto(b.pais, 2).toUpperCase() || "ES";
  const zona = typeof b.zona_id === "string" && b.zona_id ? b.zona_id : null;
  const experiencia = typeof b.experiencia_id === "string" && b.experiencia_id ? b.experiencia_id : null;
  const prescriptor = texto(b.prescriptor, 120);
  const codigo = texto(b.codigo_promo, 40).toUpperCase();
  const solicitud = b.solicitud === true;
  const esperaToken = typeof b.espera_token === "string" && b.espera_token ? b.espera_token : null;
  const marketing = b.marketing === true;
  const condiciones = b.condiciones === true;

  if (!esSlug(slug) || !esFecha(fecha) || !esHora(hora) || pax === null || !nombre) {
    return NextResponse.json({ error: "datos" }, { status: 400 });
  }
  if (!tel) return NextResponse.json({ error: "TELEFONO_INVALIDO" });
  if (email && !esEmail(email)) return NextResponse.json({ error: "EMAIL_INVALIDO" });
  if (!condiciones) return NextResponse.json({ error: "CONDICIONES_REQUERIDAS" });
  if ((zona && !esUuid(zona)) || (experiencia && !esUuid(experiencia)) || (esperaToken && !esToken(esperaToken))) {
    return NextResponse.json({ error: "datos" }, { status: 400 });
  }
  if (!/^[A-Z]{2}$/.test(pais)) return NextResponse.json({ error: "datos" }, { status: 400 });
  if (!(await localPublico(sb, slug))) return NextResponse.json({ error: "LOCAL_NO_DISPONIBLE" });

  // Respuestas a las preguntas personalizadas: {pregunta_id: valor}; solo tipos simples y acotado.
  const respuestas: Record<string, boolean | string | string[]> = {};
  if (b.respuestas && typeof b.respuestas === "object" && !Array.isArray(b.respuestas)) {
    for (const [k, v] of Object.entries(b.respuestas as Record<string, unknown>).slice(0, 30)) {
      if (!esUuid(k)) continue;
      if (typeof v === "boolean") respuestas[k] = v;
      else if (typeof v === "string") respuestas[k] = v.trim().slice(0, 500);
      else if (Array.isArray(v)) respuestas[k] = v.filter((x) => typeof x === "string").map((x) => String(x).slice(0, 120)).slice(0, 20);
    }
  }

  const { data, error } = await sb.rpc("reservas_crear_online_v2", {
    p_slug: slug,
    p_fecha: fecha,
    p_hora: horaSql(hora),
    p_pax: pax,
    p_nombre: nombre,
    p_telefono: tel,
    p_email: email,
    p_notas: notas,
    p_apellidos: apellidos,
    p_idioma: lang,
    p_pais: pais,
    ...(zona ? { p_zona_id: zona } : {}),
    p_alergias: alergias,
    ...(experiencia ? { p_experiencia_id: experiencia } : {}),
    p_consentimiento_marketing: marketing,
    p_prescriptor: prescriptor,
    p_respuestas: respuestas,
    p_codigo_promo: codigo,
    p_canal: "moduloweb",
    p_solicitud: solicitud,
    ...(esperaToken ? { p_lista_espera_token: esperaToken } : {}),
  });
  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });

  const j = (data ?? {}) as Record<string, unknown>;
  if (j.error) return NextResponse.json({ error: j.error });

  // Casilla de marketing (T2 CRM): solo con reserva creada y casilla marcada.
  if (marketing) {
    await registrarConsentimientoPublico(sb, { nombre: [nombre, apellidos].filter(Boolean).join(" "), email: email || null, telefono: tel, front: "front_reservas" });
  }

  const token = typeof j.token === "string" ? j.token : "";
  const campos = ["ok", "localizador", "token", "estado", "tipo", "solicitud", "requiere_pago", "importe", "restaurante", "fecha", "hora", "pax", "duracion_min", "mensaje", "direccion", "telefono", "politica_cancelacion_horas"];
  const salida: Record<string, unknown> = {};
  for (const k of campos) if (k in j) salida[k] = j[k];
  salida.ics = token ? `/api/publico/reservas/gestion/calendario?token=${token}` : null;
  return NextResponse.json(salida);
}
