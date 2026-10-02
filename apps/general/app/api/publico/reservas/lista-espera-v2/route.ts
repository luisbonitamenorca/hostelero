import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { cuerpo, entero, esEmail, esFecha, esHora, esSlug, esUuid, horaSql, idioma, limitar, localPublico, telefono, texto } from "../_comun";

export const dynamic = "force-dynamic";

/**
 * Alta en lista de espera v2 (RPC reservas_apuntar_lista_espera_v2): hora preferida, email, zona,
 * idioma. El email es obligatorio: hoy es el único canal por el que se avisa (SMS/WhatsApp pendientes).
 */
export async function POST(req: Request) {
  const bloqueo = limitar(req, "espera", 10, 10 * 60_000);
  if (bloqueo) return bloqueo;
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const b = await cuerpo(req);
  if (!b) return NextResponse.json({ error: "datos" }, { status: 400 });

  const slug = texto(b.slug, 64);
  const fecha = b.fecha;
  const nombre = texto(b.nombre, 120);
  const tel = telefono(b.telefono);
  const pax = entero(b.pax, 1, 200);
  const notas = texto(b.notas, 1000);
  const hora = typeof b.hora === "string" && b.hora ? b.hora : null;
  const email = texto(b.email, 254).toLowerCase();
  const zona = typeof b.zona_id === "string" && b.zona_id ? b.zona_id : null;

  if (!esSlug(slug) || !esFecha(fecha) || !nombre || pax === null || (hora && !esHora(hora)) || (zona && !esUuid(zona))) {
    return NextResponse.json({ error: "datos" }, { status: 400 });
  }
  if (!tel) return NextResponse.json({ error: "TELEFONO_INVALIDO" });
  if (!email || !esEmail(email)) return NextResponse.json({ error: "EMAIL_INVALIDO" });
  if (!(await localPublico(sb, slug))) return NextResponse.json({ error: "LOCAL_NO_DISPONIBLE" });

  const { data, error } = await sb.rpc("reservas_apuntar_lista_espera_v2", {
    p_slug: slug,
    p_fecha: fecha,
    p_nombre: nombre,
    p_telefono: tel,
    p_pax: pax,
    p_notas: notas,
    ...(hora ? { p_hora: horaSql(hora) } : {}),
    p_email: email,
    ...(zona ? { p_zona_id: zona } : {}),
    p_idioma: idioma(b.idioma),
  });
  if (error) return NextResponse.json({ error: "consulta" }, { status: 500 });
  const j = (data ?? {}) as Record<string, unknown>;
  // El token de la lista de espera solo viaja en el enlace que manda el restaurante al avisar.
  return NextResponse.json(j.error ? { error: j.error } : { ok: true });
}
