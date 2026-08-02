import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/publico";

export const dynamic = "force-dynamic";

/** Restaurantes activos de la cuenta pública (solo campos públicos). */
export async function GET() {
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const { data, error } = await sb
    .from("reservas_restaurantes")
    .select("slug, nombre, ubicacion, descripcion, telefono, antelacion_max_dias, online_activo")
    .eq("cuenta_id", CUENTA_PUBLICA)
    .eq("activo", true)
    .order("orden");

  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });
  return NextResponse.json({ restaurantes: data ?? [] });
}
