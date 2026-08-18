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
  },
  async rewrites() {
    return [
      { source: "/finanzas", destination: `${URL_FINANZAS}/finanzas` },
      { source: "/finanzas/:path*", destination: `${URL_FINANZAS}/finanzas/:path*` },
      // Panel de Agentes: sus funciones serverless (y la ANTHROPIC_API_KEY y los
      // crons) siguen en su Vercel original; esto solo hace de pasarela para que
      // el panel servido en /agentes las llame sin pelearse con CORS.
      { source: "/api/agentes/:path*", destination: "https://agentes-bonita.vercel.app/api/:path*" },
    ];
  },
};

export default nextConfig;
