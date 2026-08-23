/** @type {import('next').NextConfig} */

// Zona de finanzas: se sirve desde su propio despliegue, pero bajo este
// dominio, para que la sesión sea única. Se puede apuntar a otro despliegue
// con URL_FINANZAS (útil para probar una vista previa).
const URL_FINANZAS = process.env.URL_FINANZAS ?? "https://hostelero-finanzas.vercel.app";

const nextConfig = {
  transpilePackages: ["@hostelero/db", "@hostelero/ui"],
  // Los HTML de PyG Socios y Ratios se leen del disco en tiempo de ejecución:
  // hay que decirle a Vercel que los empaquete junto a la función de su ruta.
  outputFileTracingIncludes: {
    "/pyg": ["./datos/pyg.html"],
    "/ratios": ["./datos/ratios.html"],
    "/agentes": ["./datos/agentes.html"],
    "/compras": ["./datos/compras.html"],
    "/mantenimiento": ["./datos/mantenimiento.html"],
  },
  async rewrites() {
    return [
      { source: "/finanzas", destination: `${URL_FINANZAS}/finanzas` },
      { source: "/finanzas/:path*", destination: `${URL_FINANZAS}/finanzas/:path*` },
      // El proxy de Anthropic ya vive aquí (pages/api/compras/anthropic.js).
      // La ingesta de CORREO sigue en el Vercel viejo con su IMAP hasta que
      // Infotelecom pase las claves; este rewrite solo cubre esa ruta.
      { source: "/api/compras/ingesta-correo", destination: "https://compras-bonita.vercel.app/api/ingesta-correo" },
    ];
  },
};

export default nextConfig;
