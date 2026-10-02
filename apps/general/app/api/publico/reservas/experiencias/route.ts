import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/publico";
import { entero, esFecha, esSlug, limitar } from "../_comun";

export const dynamic = "force-dynamic";

/**
 * Catálogo del widget para un restaurante: experiencias reservables (filtradas por fecha y pax si
 * vienen) y preguntas personalizadas activas. Solo campos públicos.
 */
export async function GET(req: Request) {
  const bloqueo = limitar(req, "experiencias", 60);
  if (bloqueo) return bloqueo;
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const p = new URL(req.url).searchParams;
  const slug = p.get("slug") || "";
  const fecha = p.get("fecha");
  const pax = p.get("pax") ? entero(p.get("pax"), 1, 200) : null;
  if (!esSlug(slug) || (fecha && !esFecha(fecha))) return NextResponse.json({ error: "datos" }, { status: 400 });

  const { data: rest } = await sb.from("reservas_restaurantes").select("id").eq("cuenta_id", CUENTA_PUBLICA).eq("slug", slug).eq("activo", true).maybeSingle();
  if (!rest) return NextResponse.json({ error: "LOCAL_NO_DISPONIBLE" });

  const [{ data: exps }, { data: pregs }] = await Promise.all([
    sb
      .from("reservas_experiencias")
      .select("id, nombre, descripcion, precio_pax, requiere_prepago, pax_min, pax_max, dias_semana, fecha_desde, fecha_hasta, imagen_url, turnos")
      .eq("restaurante_id", rest.id)
      .eq("activa", true)
      .order("orden"),
    sb
      .from("reservas_preguntas")
      .select("id, texto, texto_en, tipo, opciones, obligatoria")
      .eq("restaurante_id", rest.id)
      .eq("activa", true)
      .order("orden"),
  ]);

  const isodow = fecha ? ((new Date(fecha + "T12:00:00Z").getUTCDay() + 6) % 7) + 1 : null;
  const experiencias = (exps ?? [])
    .filter((e) => {
      if (fecha) {
        if (e.fecha_desde && e.fecha_desde > fecha) return false;
        if (e.fecha_hasta && e.fecha_hasta < fecha) return false;
        if (e.dias_semana && isodow !== null && !e.dias_semana.includes(isodow)) return false;
      }
      if (pax !== null) {
        if (pax < e.pax_min) return false;
        if (e.pax_max !== null && pax > e.pax_max) return false;
      }
      return true;
    })
    .map((e) => ({
      id: e.id,
      nombre: e.nombre,
      descripcion: e.descripcion,
      precio_pax: e.precio_pax,
      requiere_prepago: e.requiere_prepago,
      pax_min: e.pax_min,
      pax_max: e.pax_max,
      imagen_url: e.imagen_url,
      turnos: e.turnos,
    }));

  return NextResponse.json({ experiencias, preguntas: pregs ?? [] });
}
