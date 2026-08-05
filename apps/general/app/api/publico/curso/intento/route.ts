import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { CUENTA_PUBLICA } from "@/lib/publico";
import { BANCO } from "@/lib/curso-banco";

export const dynamic = "force-dynamic";

const PREGUNTAS_EXAMEN = 20;
const APROBADO_MIN = 15;
const MAX_INTENTOS = 3;

/**
 * Corrige un examen EN EL SERVIDOR. El front antiguo dejaba al cliente
 * ponerse 'aprobado' y generarse el certificado con la anon key; aquí el
 * cliente solo envía sus respuestas y el estado, la nota y el código de
 * certificado los fija este handler. El cliente jamás ve las soluciones.
 */
export async function POST(req: Request) {
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const inscripcionId = String(body?.inscripcion_id || "");
  const respuestas: unknown = body?.respuestas;
  const duracion = Number.isFinite(Number(body?.duracion_segundos))
    ? Math.max(0, Math.floor(Number(body?.duracion_segundos)))
    : null;

  if (!inscripcionId || !Array.isArray(respuestas) || respuestas.length !== PREGUNTAS_EXAMEN) {
    return NextResponse.json({ error: "datos" }, { status: 400 });
  }

  // 20 preguntas distintas, todas dentro del banco, todas respondidas.
  const limpias: { id: number; respuesta: string }[] = [];
  const vistos = new Set<number>();
  for (const r of respuestas as { id?: unknown; respuesta?: unknown }[]) {
    const id = Number(r?.id);
    const respuesta = String(r?.respuesta ?? "");
    if (!Number.isInteger(id) || id < 0 || id >= BANCO.length || vistos.has(id) || !respuesta) {
      return NextResponse.json({ error: "datos" }, { status: 400 });
    }
    vistos.add(id);
    limpias.push({ id, respuesta });
  }

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

  const { data: previos } = await sb
    .from("curso_intentos")
    .select("intento")
    .eq("inscripcion_id", inscripcionId)
    .order("intento", { ascending: false })
    .limit(1);
  const numIntento = (previos?.[0]?.intento ?? 0) + 1;
  if (numIntento > MAX_INTENTOS) {
    return NextResponse.json({ error: "sin_intentos" }, { status: 409 });
  }

  // Corrección: la respuesta es el texto de la opción elegida.
  let aciertos = 0;
  for (const { id, respuesta } of limpias) {
    if (BANCO[id].options[BANCO[id].correct] === respuesta) aciertos++;
  }
  const aprobado = aciertos >= APROBADO_MIN;

  // El unique (inscripcion_id, intento) del esquema corta cualquier carrera
  // de dos envíos simultáneos: solo uno de los dos entra.
  const { error: errIntento } = await sb.from("curso_intentos").insert({
    cuenta_id: CUENTA_PUBLICA,
    inscripcion_id: inscripcionId,
    intento: numIntento,
    aciertos,
    total: PREGUNTAS_EXAMEN,
    aprobado,
    respuestas: limpias,
    duracion_segundos: duracion,
  });
  if (errIntento) return NextResponse.json({ error: "no_guardado" }, { status: 409 });

  let codigo: string | null = null;
  if (aprobado) {
    codigo = `BM-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const { error } = await sb
      .from("curso_inscripciones")
      .update({
        estado: "aprobado",
        codigo_certificado: codigo,
        fecha_certificado: new Date().toISOString(),
        nota_final: aciertos,
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", inscripcionId);
    if (error) return NextResponse.json({ error: "no_guardado" }, { status: 500 });
  } else {
    await sb
      .from("curso_inscripciones")
      .update({
        estado: numIntento >= MAX_INTENTOS ? "suspenso_definitivo" : "suspenso_intento",
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", inscripcionId);
  }

  return NextResponse.json({
    aciertos,
    total: PREGUNTAS_EXAMEN,
    aprobado,
    codigo_certificado: codigo,
    puede_reintentar: !aprobado && numIntento < MAX_INTENTOS,
  });
}
