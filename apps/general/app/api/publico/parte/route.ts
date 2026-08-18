import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";

export const dynamic = "force-dynamic";

/**
 * Alta de un parte de mantenimiento desde el front público /parte. Patrón de
 * la casa para fronts sin sesión (como api/publico de reservas): el navegador
 * no toca la base — este handler valida y escribe con la service key, porque
 * mant_partes no tiene política para anon a propósito.
 *
 * La cuenta va fija a Bonita mientras el front público sea suyo; el día que
 * haya más inquilinos, el front llevará un identificador por cuenta.
 */
const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd";

const CENTROS = ["Bodega Binifadet", "Restaurante Binifadet", "Tienda Binifadet",
  "Restaurante Tamarindos", "Bar Tamarindos", "Casa Tirant", "Producción", "Estructura / General"];
const TIPOS = ["Mantenimiento general", "Jardinería / Campo", "Fontanería", "Electricidad",
  "Climatización", "Limpieza especial", "Instalaciones", "Otro"];
const URGENCIAS = ["Normal", "Urgente", "Crítico"];

export async function POST(peticion: Request) {
  let cuerpo: unknown;
  try {
    cuerpo = await peticion.json();
  } catch {
    return NextResponse.json({ error: "cuerpo no válido" }, { status: 400 });
  }
  const p = cuerpo as Record<string, unknown>;

  const responsable = String(p.responsable ?? "").trim().slice(0, 60);
  const centro = String(p.centro ?? "");
  const tipo = String(p.tipo ?? "");
  const urgencia = String(p.urgencia ?? "");
  const fecha = String(p.fecha ?? "").slice(0, 10);
  const descripcion = String(p.descripcion ?? "").trim().slice(0, 2000);
  const medios = Array.isArray(p.medios) ? p.medios : [];

  if (!responsable || !descripcion || !CENTROS.includes(centro) || !TIPOS.includes(tipo)
    || !URGENCIAS.includes(urgencia) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "faltan campos o no son válidos" }, { status: 400 });
  }

  // Los medios son dataURLs (fotos comprimidas / vídeo corto). El tope total
  // queda por debajo del límite de cuerpo de Vercel (4,5 MB): mejor un error
  // claro aquí que un corte mudo de la plataforma.
  const medioValido = (m: unknown): m is { dataUrl: string; isVideo: boolean; name: string } =>
    typeof m === "object" && m !== null
    && typeof (m as { dataUrl?: unknown }).dataUrl === "string"
    && (m as { dataUrl: string }).dataUrl.startsWith("data:");
  if (!medios.every(medioValido) || medios.length > 6) {
    return NextResponse.json({ error: "adjuntos no válidos (máx. 6)" }, { status: 400 });
  }
  const pesoTotal = medios.reduce((s, m) => s + m.dataUrl.length, 0);
  if (pesoTotal > 3_800_000) {
    return NextResponse.json(
      { error: "los adjuntos pesan demasiado: quita alguno o usa fotos en vez de vídeo" },
      { status: 413 },
    );
  }

  const servicio = crearClienteServicio();
  if (!servicio) return NextResponse.json({ error: "servicio no configurado" }, { status: 503 });

  const { error } = await servicio.from("mant_partes").insert({
    cuenta_id: CUENTA_ID,
    responsable, centro, tipo, fecha, urgencia, descripcion,
    estado: "Pendiente", asignado: "",
    medios,
    ts: Date.now(),
  });
  if (error) return NextResponse.json({ error: "no se pudo guardar" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
