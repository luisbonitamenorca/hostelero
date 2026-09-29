import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // Rutas sin guard: login y el circuito de recuperación de contraseña, que
  // llega desde el correo con el token en la URL y aún no tiene sesión.
  const ruta = request.nextUrl.pathname;
  if (ruta.startsWith("/recuperar") || ruta.startsWith("/nueva-clave")) {
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

  // No usar getSession() aquí: no verifica nada. getClaims() refresca la sesión
  // si hace falta y VERIFICA la firma del JWT: en local con la clave pública
  // del proyecto (claves asimétricas, sin ida a Supabase en cada petición ni en
  // cada prefetch) o, si el proyecto aún firma con secreto simétrico, cayendo
  // a getUser() contra Supabase. En ningún caso se fía de un token sin validar.
  // El guard fino (perfil, módulo, rol) sigue en exigirPerfil() con getUser().
  const { data: datosClaims } = await supabase.auth.getClaims();
  const user = datosClaims?.claims?.sub ? datosClaims.claims : null;

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
