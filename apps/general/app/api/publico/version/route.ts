import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * La versión desplegada ahora mismo, para el vigilante de las páginas (los
 * HTML de módulo y los fronts públicos). Vercel rellena el sha del commit en
 * cada despliegue; en local vale "dev". Público y minúsculo a propósito.
 */
export async function GET() {
  return NextResponse.json(
    { v: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? "dev" },
    { headers: { "cache-control": "no-store" } },
  );
}
