import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/visitas-publico";

export const dynamic = "force-dynamic";

/** Plazas libres de una sesión concreta (solo si es reservable públicamente). */
export async function GET(req: Request) {
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const sesion = new URL(req.url).searchParams.get("sesion");
  if (!sesion) return NextResponse.json({ error: "falta_sesion" }, { status: 400 });

  const { data: s } = await sb
    .from("visitas_sesiones")
    .select("id")
    .eq("id", sesion)
    .eq("cuenta_id", CUENTA_PUBLICA)
    .eq("estado", "activa")
    .eq("visible_web", true)
    .gte("fecha", new Date().toISOString().slice(0, 10))
    .maybeSingle();
  if (!s) return NextResponse.json({ error: "no_disponible" }, { status: 404 });

  const { data: plazas } = await sb.rpc("visitas_plazas_disponibles", { p_sesion_id: sesion });
  return NextResponse.json({ plazas: Number(plazas ?? 0) });
}
