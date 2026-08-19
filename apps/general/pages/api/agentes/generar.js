// PORTADA de agentes-bonita a Hostelero (19-08-2026) casi literal: solo
// cambian las constantes de conexión, que ahora apuntan al Supabase de la
// casa — las tablas agent_* viven aquí y el Bearer que valida es el token de
// sesión de HOSTELERO (el mismo que el route handler /agentes inyecta en el
// panel). Vive en pages/api (router clásico) a propósito: convive con app/ y
// permite portar el (req, res) original sin reescribirlo.
// /api/generar — único punto de contacto con la API de Claude.
// La ANTHROPIC_API_KEY vive en las variables de entorno de Vercel, nunca en el cliente.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  // 1) Verificar que quien llama tiene sesión válida de Supabase
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sin sesión" });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` }
  });
  if (!userRes.ok) return res.status(401).json({ error: "Sesión no válida" });

  // 2) Validar el payload
  const { reviews } = req.body || {};
  if (!Array.isArray(reviews) || reviews.length === 0 || reviews.length > 30)
    return res.status(400).json({ error: "Payload no válido (1-30 reseñas)" });

  const prompt = `Eres el agente de comunicación de Bonita Menorca, un grupo de restauración de Menorca. Redacta la respuesta pública a cada reseña o comentario siguiente.

Reglas estrictas:
- Responde SIEMPRE en el idioma de la reseña (campo "idioma": es=español, ca=catalán, en=inglés, fr=francés, de=alemán, it=italiano).
- Sigue el tono indicado para cada local y usa su firma.
- Máximo 70 palabras por respuesta. Menciona algún detalle concreto de la reseña.
- En quejas: disculpa sincera y específica, sin excusas ni justificaciones, sin ofrecer compensaciones económicas ni invitaciones gratuitas, e invita a contactar directamente con el local.
- En comentarios con pregunta (Instagram/Facebook): responde de forma útil y breve; si no tienes el dato, indica cómo obtenerlo (teléfono o web del local) sin inventar información.
- Nunca inventes datos: ni horarios, ni platos, ni políticas.

Devuelve SOLO un JSON válido, sin markdown ni texto adicional, con este formato:
[{"id":"...","respuesta":"..."}]

Reseñas:
${JSON.stringify(reviews, null, 1)}`;

  // 3) Llamar a la API de Claude
  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await apiRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message || "Error de la API de Claude" });

    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    const drafts = JSON.parse(text.replace(/```json|```/g, "").trim());

    return res.status(200).json({
      drafts,
      usage: { input_tokens: data.usage?.input_tokens || 0, output_tokens: data.usage?.output_tokens || 0 }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "No se pudieron generar los borradores" });
  }
}
