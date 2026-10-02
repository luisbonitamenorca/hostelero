import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/publico";
import { limitar } from "../_comun";

export const dynamic = "force-dynamic";

/**
 * Restaurantes activos de la cuenta pública (solo campos públicos). Además de los datos de
 * siempre, el widget v2 necesita la configuración visible: idiomas, color y logo, condiciones,
 * WhatsApp, mensaje del widget, tope de pax online, teléfono de grupos y política.
 * Importes de garantía/prepago no se exponen aquí: los calcula disponibilidad-v2 por fecha y pax.
 */
export async function GET(req: Request) {
  const bloqueo = limitar(req, "restaurantes", 60);
  if (bloqueo) return bloqueo;
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const { data, error } = await sb
    .from("reservas_restaurantes")
    .select(
      "slug, nombre, ubicacion, direccion, descripcion, telefono, telefono_whatsapp, antelacion_max_dias, antelacion_min_horas, online_activo, idiomas, color_marca, logo_url, url_condiciones, mensaje_widget, max_pax_online, grupos_telefono, politica_cancelacion_horas, tarjeta_desde_pax",
    )
    .eq("cuenta_id", CUENTA_PUBLICA)
    .eq("activo", true)
    .order("orden");

  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });
  return NextResponse.json({ restaurantes: data ?? [] });
}
