import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El módulo se sirve bajo el dominio de hostelero-app, en /finanzas
  // (multizona). El motivo es la sesión: las cookies son por dominio, así que
  // con dos dominios habría que entrar dos veces. Con esto, se entra una.
  //
  // Efecto secundario: en su dominio propio la app ya solo responde bajo
  // /finanzas — hostelero-finanzas.vercel.app/finanzas/login, no /login.
  basePath: "/finanzas",

  experimental: {
    // Detrás del proxy, la cabecera Host que llega es la de hostelero-app.
    // Next compara origen y host al recibir una acción de servidor y, sin
    // esto, las rechazaría todas: no se podría guardar ni un cliente.
    serverActions: {
      allowedOrigins: ["hostelero-app.vercel.app", "hostelero-finanzas.vercel.app"],
    },
  },
};

export default nextConfig;
