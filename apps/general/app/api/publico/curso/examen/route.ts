import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/publico";
import { BANCO } from "@/lib/curso-banco";

export const dynamic = "force-dynamic";

const PREGUNTAS_EXAMEN = 20;
const MAX_INTENTOS = 3;

/**
 * Genera un examen: 20 preguntas al azar del banco, con las opciones
 * barajadas, SIN la respuesta correcta. La corrección es de /intento:
 * el cliente identifica cada pregunta por su índice en el banco y
 * responde con el texto de la opción elegida.
 */
export async function POST(req: Request) {
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const inscripcionId = String(body?.inscripcion_id || "");
  if (!inscripcionId) return NextResponse.json({ error: "datos" }, { status: 400 });

  const { data: insc } = await sb
    .from("curso_inscripciones")
    .select("id, estado")
    .eq("id", inscripcionId)
    .eq("cuenta_id", CUENTA_PUBLICA)
    .maybeSingle();
  if (!insc) return NextResponse.json({ error: "inscripcion" }, { status: 404 });
  if (insc.estado === "aprobado" || insc.estado === "suspenso_definitivo") {
    return NextResponse.json({ error: "estado_final" }, { status: 409 });
  }

  const { count } = await sb
    .from("curso_intentos")
    .select("id", { count: "exact", head: true })
    .eq("inscripcion_id", inscripcionId);
  const intentosHechos = count ?? 0;
  if (intentosHechos >= MAX_INTENTOS) {
    return NextResponse.json({ error: "sin_intentos" }, { status: 409 });
  }

  const barajadas = BANCO.map((q, id) => ({ id, q }))
    .sort(() => Math.random() - 0.5)
    .slice(0, PREGUNTAS_EXAMEN)
    .map(({ id, q }) => ({
      id,
      q: q.q,
      options: [...q.options].sort(() => Math.random() - 0.5),
    }));

  return NextResponse.json({
    intento: intentosHechos + 1,
    max_intentos: MAX_INTENTOS,
    preguntas: barajadas,
  });
}
