// PORTADA de agentes-bonita a Hostelero (19-08-2026) casi literal: solo
// cambian las constantes de conexión, que ahora apuntan al Supabase de la
// casa — las tablas agent_* viven aquí y el Bearer que valida es el token de
// sesión de HOSTELERO (el mismo que el route handler /agentes inyecta en el
// panel). Vive en pages/api (router clásico) a propósito: convive con app/ y
// permite portar el (req, res) original sin reescribirlo.
// /api/prospectar — prospección de distribuidores con búsqueda web nativa de la API.
// Los runs tardan 1-3 minutos: maxDuration alto y alcance limitado por run.

export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sin sesión" });

  const userRes = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token }
  });
  if (!userRes.ok) return res.status(401).json({ error: "Sesión no válida" });

  const { zona, existentes } = req.body || {};
  if (!zona || typeof zona !== "string" || zona.length > 80)
    return res.status(400).json({ error: "Indica una zona válida" });
  const yaFichados = Array.isArray(existentes) ? existentes.slice(0, 200).join(", ") : "";

  const prompt = [
    "Eres el investigador comercial de Bodegas Binifadet (Menorca), bodega premium de variedades autoctonas (Giro Ros, Giro Negre). Su vino Foraster tiene 93 puntos Penin. Busca canales de venta en la zona indicada de Espana.",
    "",
    "ZONA A PROSPECTAR: " + zona,
    "",
    "QUE BUSCAR (en este orden de interes):",
    "1. Distribuidores de vino regionales con cartera premium o de bodegas pequenas.",
    "2. Tiendas especializadas / vinotecas con seleccion cuidada.",
    "3. Importadores-distribuidores que trabajen vinos de islas o mediterraneos.",
    "",
    "CRITERIOS DE ENCAJE (score 1-10):",
    "+ Trabaja variedades autoctonas, vinos de Baleares/Canarias, o bodegas boutique.",
    "+ Posicionamiento premium (no volumen/descuento).",
    "+ Vende a hosteleria ademas de tienda.",
    "- Descarta: grandes superficies, marketplaces genericos, distribuidores de gran volumen low-cost.",
    "",
    yaFichados ? "YA FICHADOS (no los repitas): " + yaFichados : "",
    "",
    "METODO: haz entre 4 y 6 busquedas web, visita las webs de los candidatos mas prometedores, y devuelve entre 3 y 6 fichas SOLO de candidatos verificados con web real. Prefiere calidad a cantidad. No inventes emails ni telefonos: si no aparecen publicados, deja el campo vacio.",
    "",
    "Devuelve SOLO un array JSON valido, sin markdown ni texto adicional:",
    '[{"name":"...","city":"...","web":"https://...","email":"","phone":"","perfil":"que trabaja y como se posiciona (2-3 frases)","score":7,"razon":"por que encaja o no (1-2 frases)","angulo":"angulo de entrada sugerido para Binifadet (1 frase)"}]'
  ].join("\n");

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
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }]
      })
    });
    const data = await apiRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message || "Error de la API de Claude" });

    const text = (data.content || []).filter(function(b){ return b.type === "text"; })
      .map(function(b){ return b.text; }).join("\n");

    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1) return res.status(502).json({ error: "El agente no devolvio fichas. Prueba con otra zona o reintenta." });
    const fichas = JSON.parse(text.slice(start, end + 1));

    const searches = (data.usage && data.usage.server_tool_use && data.usage.server_tool_use.web_search_requests) || 0;

    return res.status(200).json({
      fichas: Array.isArray(fichas) ? fichas.slice(0, 8) : [],
      usage: {
        input_tokens: (data.usage && data.usage.input_tokens) || 0,
        output_tokens: (data.usage && data.usage.output_tokens) || 0,
        searches: searches
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Fallo en la prospeccion. Reintenta en un minuto." });
  }
}
