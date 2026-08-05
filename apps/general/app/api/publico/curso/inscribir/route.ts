import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/publico";

export const dynamic = "force-dynamic";

/**
 * Alta de inscripción al curso de Manipulador. El estado nace 'iniciado' y
 * SOLO el servidor lo cambia después (en /api/publico/curso/intento): el
 * cliente nunca escribe estado, nota ni certificado.
 */
export async function POST(req: Request) {
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "datos" }, { status: 400 });

  const nombre = String(body.nombre || "").trim();
  const apellidos = String(body.apellidos || "").trim();
  const dni = String(body.dni || "").trim().toUpperCase();
  const email = String(body.email || "").trim().toLowerCase();
  const telefono = String(body.telefono || "").trim();
  const centroId = String(body.centro_id || "");
  const puesto = String(body.puesto || "").trim();

  if (!nombre || !apellidos || !dni || !email || !telefono || !centroId || !puesto) {
    return NextResponse.json({ error: "datos" }, { status: 400 });
  }
  if (!/^[A-Z0-9]{8,9}[A-Z]$/i.test(dni)) {
    return NextResponse.json({ error: "dni" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "email" }, { status: 400 });
  }
  if (body.rgpd !== true) {
    return NextResponse.json({ error: "rgpd" }, { status: 400 });
  }

  // El centro debe ser de la cuenta pública: nunca se confía en un id del cliente.
  const { data: centro } = await sb
    .from("centros")
    .select("id")
    .eq("id", centroId)
    .eq("cuenta_id", CUENTA_PUBLICA)
    .maybeSingle();
  if (!centro) return NextResponse.json({ error: "centro" }, { status: 400 });

  const { data, error } = await sb
    .from("curso_inscripciones")
    .insert({
      cuenta_id: CUENTA_PUBLICA,
      centro_id: centro.id,
      nombre,
      apellidos,
      dni,
      email,
      telefono,
      puesto,
      rgpd_aceptado: true,
      estado: "iniciado",
    })
    .select("id")
    .single();

  if (error || !data) return NextResponse.json({ error: "no_creada" }, { status: 500 });
  return NextResponse.json({ inscripcion_id: data.id });
}
