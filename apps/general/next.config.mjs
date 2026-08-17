/** @type {import('next').NextConfig} */

// Zona de finanzas: se sirve desde su propio despliegue, pero bajo este
// dominio, para que la sesión sea única. Se puede apuntar a otro despliegue
// con URL_FINANZAS (útil para probar una vista previa).
const URL_FINANZAS = process.env.URL_FINANZAS ?? "https://hostelero-finanzas.vercel.app";

const nextConfig = {
  transpilePackages: ["@hostelero/db", "@hostelero/ui"],
  // El HTML de PyG Socios se lee del disco en tiempo de ejecución: hay que
  // decirle a Vercel que lo empaquete junto a la función de la ruta.
  outputFileTracingIncludes: {
    "/pyg": ["./datos/pyg.html"],
  },
  async rewrites() {
    return [
      { source: "/finanzas", destination: `${URL_FINANZAS}/finanzas` },
      { source: "/finanzas/:path*", destination: `${URL_FINANZAS}/finanzas/:path*` },
    ];
  },
};

export default nextConfig;
