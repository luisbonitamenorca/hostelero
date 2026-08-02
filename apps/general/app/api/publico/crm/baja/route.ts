import { NextResponse } from "next/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { ejecutarBajaEmail, verificarTokenBaja } from "@/lib/crm-publico";

export const dynamic = "force-dynamic";

/**
 * Baja pública de email: requiere el email y su firma HMAC (el enlace vendrá
 * en cada correo cuando exista el canal). Inserta la supresión (baja_usuario)
 * y el evento retirado. Idempotente.
 */
export async function POST(req: Request) {
  const sb = crearClienteServicio();
  if (!sb) return NextResponse.json({ error: "config_pendiente" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  const token = String(body?.token || "").trim();
  if (!email || !/.+@.+\..+/.test(email) || !token) {
    return NextResponse.json({ error: "datos" }, { status: 400 });
  }
  if (!verificarTokenBaja(email, token)) {
    return NextResponse.json({ error: "token" }, { status: 403 });
  }
  const r = await ejecutarBajaEmail(sb, email);
  if (!r.ok) return NextResponse.json({ error: "no_procesada" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
