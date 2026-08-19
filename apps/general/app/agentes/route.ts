import { exigirModulo } from "@/lib/supabase/server";
import { servirHtmlModulo } from "@/lib/html-modulo";

export const dynamic = "force-dynamic";

/**
 * Bonita · Agentes, PORTADO del todo al esqueleto (19-08-2026): las 13
 * tablas agent_* viven en el Supabase de la casa con RLS multi-tenant, y el
 * panel habla con PostgREST, con realtime y con las funciones
 * /api/agentes/* (portadas a pages/api) usando el TOKEN DE SESIÓN del
 * usuario real, que se inyecta aquí al servir la página. El puente con
 * usuario de máquina de esta mañana quedó obsoleto en horas — así de rápido
 * va esto. El Supabase y el Vercel antiguos ya no pintan nada.
 */
export async function GET() {
  const { supabase } = await exigirModulo("agentes");

  const {
    data: { session },
  } = await supabase.auth.getSession();

  return servirHtmlModulo("agentes.html", {
    "__SUPABASE_URL__": process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    "__SUPABASE_ANON__": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    "__SB_TOKEN__": session?.access_token ?? "",
  });
}
