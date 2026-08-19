import { exigirModulo } from "@/lib/supabase/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { servirHtmlModulo } from "@/lib/html-modulo";

export const dynamic = "force-dynamic";

/**
 * Bonita · Agentes, con PUENTE DE SESIÓN (19-08-2026): la pantalla de
 * contraseña interna se quitó — con la sesión de Hostelero y los permisos
 * por usuario ya no aportaba nada. Los datos siguen en el Supabase del
 * proyecto agentes con su RLS de solo-autenticados, así que este handler,
 * DESPUÉS de validar sesión + módulo + veto del usuario real, inicia sesión
 * allí con un usuario de máquina (credencial en plataforma_secretos, tabla
 * solo-servicio) e inyecta el token en la página. Las llamadas
 * /api/agentes/* del Vercel original verifican ese mismo token.
 */
let tokenCacheado: { valor: string; caduca: number } | null = null;

async function tokenPuente(): Promise<string> {
  // El token de GoTrue dura 1 h: se reutiliza 50 min por instancia para no
  // iniciar sesión en cada visita.
  if (tokenCacheado && Date.now() < tokenCacheado.caduca) return tokenCacheado.valor;

  const servicio = crearClienteServicio();
  if (!servicio) return "";
  const { data } = await servicio
    .from("plataforma_secretos")
    .select("valor")
    .eq("clave", "agentes_puente")
    .maybeSingle();
  const s = data?.valor as { url: string; anon: string; email: string; password: string } | null;
  if (!s) return "";

  const r = await fetch(`${s.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: s.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: s.email, password: s.password }),
  });
  if (!r.ok) return "";
  const d = (await r.json()) as { access_token?: string };
  if (!d.access_token) return "";

  tokenCacheado = { valor: d.access_token, caduca: Date.now() + 50 * 60 * 1000 };
  return d.access_token;
}

export async function GET() {
  await exigirModulo("agentes");
  return servirHtmlModulo("agentes.html", { "__AGENTES_TOKEN__": await tokenPuente() });
}
