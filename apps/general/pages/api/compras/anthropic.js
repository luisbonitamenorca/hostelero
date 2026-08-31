// Proxy serverless para la API de Anthropic, portado tal cual de la app
// compras-bonita (api/anthropic.js). El front de Compras (datos/compras.html)
// lo llama en ruta relativa /api/compras/anthropic; la API key vive solo en
// las variables de entorno de Vercel (la misma ANTHROPIC_API_KEY que ya usan
// los agentes).

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Method not allowed" } });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: { message: "Falta ANTHROPIC_API_KEY en las variables de entorno de Vercel" }
    });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(req.body)
    });
    const data = await upstream.json();
    // Las cabeceras de rate-limit las usa el front para pausar el proceso en lote
    for (const h of [
      "anthropic-ratelimit-requests-remaining",
      "anthropic-ratelimit-input-tokens-remaining",
      "anthropic-ratelimit-input-tokens-reset",
      "anthropic-ratelimit-requests-reset",
    ]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    return res.status(upstream.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: { message: String(e) } });
  }
}

// maxDuration: con max_tokens 16384 (albaranes muy largos, escalada a Opus) la
// generación puede pasar del minuto; sin esto Vercel corta la función a mitad.
export const config = { api: { bodyParser: { sizeLimit: "4mb" } }, maxDuration: 300 };
