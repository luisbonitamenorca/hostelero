import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";

export const dynamic = "force-dynamic";

/**
 * Cron de Vercel (mensual, ver vercel.json): ejecuta curso_purgar_dni().
 * Política de conservación del DNI: 3 años desde fecha_certificado (o alta),
 * pasado el plazo se borra el DNI y se conserva la inscripción como prueba
 * de la formación. pg_cron no está en el proyecto, por eso se dispara aquí.
 *
 * Si CRON_SECRET existe en el entorno, Vercel la envía como Bearer y aquí se
 * exige. Sin secreto el endpoint queda abierto, pero solo aplica la política
 * ya decidida (no purga nada que no esté vencido), así que el riesgo es bajo.
 */
export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (secreto && req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  }

  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const { data, error } = await sb.rpc("curso_purgar_dni", { p_anios: 3 });
  if (error) return NextResponse.json({ error: "fallo_purga" }, { status: 500 });

  const purgadas = Array.isArray(data) ? (data[0]?.purgadas ?? 0) : (data ?? 0);
  return NextResponse.json({ purgadas: Number(purgadas) });
}
