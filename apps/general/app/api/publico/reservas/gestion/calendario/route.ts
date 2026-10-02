import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { esToken, generarIcs, limitar } from "../../_comun";

export const dynamic = "force-dynamic";

/** Fichero .ics de la reserva («añadir al calendario»), generado a partir de reservas_gestion. */
export async function GET(req: Request) {
  const bloqueo = limitar(req, "gestion-ics", 30);
  if (bloqueo) return bloqueo;
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const token = new URL(req.url).searchParams.get("token") || "";
  if (!esToken(token)) return new NextResponse("No encontrada", { status: 404 });

  const { data, error } = await sb.rpc("reservas_gestion", { p_token: token });
  if (error) return new NextResponse("Error", { status: 500 });
  const j = (data ?? {}) as {
    error?: string;
    estado?: string;
    localizador?: string;
    fecha_iso?: string;
    hora?: string;
    duracion_min?: number;
    pax?: number;
    restaurante?: { nombre?: string; direccion?: string | null; telefono?: string | null };
  };
  if (j.error || !j.fecha_iso || !j.hora) return new NextResponse("No encontrada", { status: 404 });
  if (j.estado === "cancelada" || j.estado === "no_show") return new NextResponse("Reserva cancelada", { status: 410 });

  const nombre = j.restaurante?.nombre || "Restaurante";
  const origen = new URL(req.url).origin;
  const ics = generarIcs({
    uid: `reserva-${token}`,
    titulo: `Reserva en ${nombre} · ${j.pax} pers.`,
    fechaIso: j.fecha_iso,
    hora: j.hora,
    duracionMin: j.duracion_min || 120,
    lugar: j.restaurante?.direccion || nombre,
    descripcion: [`Localizador ${j.localizador}`, j.restaurante?.telefono ? `Tel. ${j.restaurante.telefono}` : "", `Gestionar: ${origen}/reserva/${token}`].filter(Boolean).join("\n"),
    url: `${origen}/reserva/${token}`,
  });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="reserva-${j.localizador || "mesa"}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
