import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/visitas-publico";

export const dynamic = "force-dynamic";

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Sesiones disponibles de un mes para la cuenta pública:
 * activa + visible_web + fecha futura (hoy o posterior) + con plazas libres.
 * Devuelve solo lo mínimo para pintar el calendario público.
 */
export async function GET(req: Request) {
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const { searchParams } = new URL(req.url);
  const mes = searchParams.get("mes"); // "YYYY-MM"
  let anio: number;
  let mesNum: number; // 1-12
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [y, m] = mes.split("-").map(Number);
    anio = y;
    mesNum = m;
  } else {
    const now = new Date();
    anio = now.getFullYear();
    mesNum = now.getMonth() + 1;
  }
  const primero = `${anio}-${String(mesNum).padStart(2, "0")}-01`;
  const ultimo = new Date(anio, mesNum, 0).toISOString().slice(0, 10);
  const hoy = hoyISO();
  const desde = primero < hoy ? hoy : primero; // nunca pasado

  const { data: ses, error } = await sb
    .from("visitas_sesiones")
    .select(
      "id, fecha, hora_inicio, aforo, visitas_productos(nombre_es, nombre_en, nombre_fr, precio, duracion_min)",
    )
    .eq("cuenta_id", CUENTA_PUBLICA)
    .eq("estado", "activa")
    .eq("visible_web", true)
    .gte("fecha", desde)
    .lte("fecha", ultimo)
    .order("fecha")
    .order("hora_inicio");

  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });

  const ids = (ses ?? []).map((s) => s.id);
  const ocup: Record<string, number> = {};
  if (ids.length) {
    const { data: rs } = await sb
      .from("visitas_reservas")
      .select("sesion_id, num_personas, estado")
      .in("sesion_id", ids);
    (rs ?? []).forEach((r) => {
      if (r.estado === "pendiente_pago" || r.estado === "pagada") {
        ocup[r.sesion_id] = (ocup[r.sesion_id] || 0) + r.num_personas;
      }
    });
  }

  const sesiones = (ses ?? [])
    .map((s) => {
      const p = s.visitas_productos;
      return {
        id: s.id,
        fecha: s.fecha,
        hora: (s.hora_inicio || "").slice(0, 5),
        free: s.aforo - (ocup[s.id] || 0),
        producto: {
          nombre_es: p?.nombre_es ?? "",
          nombre_en: p?.nombre_en ?? null,
          nombre_fr: p?.nombre_fr ?? null,
          precio: Number(p?.precio || 0),
          duracion_min: p?.duracion_min ?? null,
        },
      };
    })
    .filter((s) => s.free > 0);

  return NextResponse.json({ sesiones });
}
