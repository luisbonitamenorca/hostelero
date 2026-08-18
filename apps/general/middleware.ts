import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // Rutas públicas (fronts de reserva y baja de comunicaciones): sin guard de login.
  const ruta = request.nextUrl.pathname;
  if (ruta.startsWith("/reservar") || ruta.startsWith("/baja") || ruta.startsWith("/kiosco") || ruta.startsWith("/formacion") || ruta.startsWith("/api/publico") || ruta.startsWith("/api/cron") || ruta.startsWith("/api/rrhh/fichar") || ruta.startsWith("/empleado-manifest") || ruta.startsWith("/subir-facturas") || ruta.startsWith("/parte")) {
    return NextResponse.next({ request });
  }

  // La zona de finanzas trae su propio guard (apps/finanzas/middleware.ts) y
  // comparte estas mismas cookies. Si la comprobásemos también aquí, cada
  // fichero estático suyo (/finanzas/_next/...) haría una llamada a Supabase.
  if (ruta === "/finanzas" || ruta.startsWith("/finanzas/")) {
    return NextResponse.next({ request });
  }

  let respuesta = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesAEscribir) {
          cookiesAEscribir.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          respuesta = NextResponse.next({ request });
          cookiesAEscribir.forEach(({ name, value, options }) =>
            respuesta.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // No usar getSession() aquí: getUser() revalida el token contra Supabase.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const esLogin = request.nextUrl.pathname.startsWith("/login");

  if (!user && !esLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && esLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return respuesta;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
