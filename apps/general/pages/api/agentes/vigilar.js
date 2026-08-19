// PORTADA de agentes-bonita a Hostelero (19-08-2026) casi literal: solo
// cambian las constantes de conexión, que ahora apuntan al Supabase de la
// casa — las tablas agent_* viven aquí y el Bearer que valida es el token de
// sesión de HOSTELERO (el mismo que el route handler /agentes inyecta en el
// panel). Vive en pages/api (router clásico) a propósito: convive con app/ y
// permite portar el (req, res) original sin reescribirlo.
// /api/vigilar — vigilante de competencia con busqueda web.
// GET  = cron semanal de Vercel: vigila los 3 competidores activos menos recientes.
// POST = vigilancia manual de un competidor concreto desde el panel.

export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function sbHeaders(key) {
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
}

export default async function handler(req, res) {
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) return res.status(500).json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en Vercel" });

  let targets = [];

  if (req.method === "GET") {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== "Bearer " + secret)
      return res.status(401).json({ error: "No autorizado" });
    const r = await fetch(SUPABASE_URL + "/rest/v1/agent_competitors?active=eq.true&select=*&order=last_checked_at.asc.nullsfirst&limit=3", { headers: sbHeaders(SERVICE_KEY) });
    targets = await r.json();
  } else if (req.method === "POST") {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Sin sesión" });
    const userRes = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token }
    });
    if (!userRes.ok) return res.status(401).json({ error: "Sesión no válida" });
    const id = (req.body || {}).competitor_id;
    if (!id) return res.status(400).json({ error: "Falta competitor_id" });
    const r = await fetch(SUPABASE_URL + "/rest/v1/agent_competitors?id=eq." + id + "&select=*", { headers: sbHeaders(SERVICE_KEY) });
    targets = await r.json();
  } else {
    return res.status(405).json({ error: "Método no permitido" });
  }

  if (!targets.length) return res.status(200).json({ vigilados: 0, hallazgos: 0, motivo: "Sin competidores activos que vigilar" });

  const lista = targets.map(function(t){
    return "- " + t.name + " (ámbito: " + t.ambito + (t.web ? ", web: " + t.web : "") + (t.notas ? ", notas: " + t.notas : "") + ")";
  }).join("\n");
  const maxSearches = Math.min(4 + targets.length * 3, 12);

  const prompt = [
    "Eres el vigilante de competencia de Bonita Menorca (grupo de restauracion y bodega en Menorca: Binifadet, Tamarindos, Casa Tirant).",
    "",
    "COMPETIDORES A VIGILAR HOY:",
    lista,
    "",
    "TAREA: para cada competidor, busca NOVEDADES de los ultimos 45 dias: cambios de carta o de precios, eventos y actividades nuevas, apariciones en prensa o guias, tendencia clara en resenas recientes (no resenas sueltas), aperturas, reformas o cambios relevantes. Usa " + maxSearches + " busquedas como maximo en total.",
    "",
    "REGLAS:",
    "- Solo novedades reales y verificables con fuente. Si para un competidor no hay nada nuevo, devuelvelo con hallazgos vacios. NO rellenes por rellenar.",
    "- Cada hallazgo con su URL de fuente.",
    "- relevancia 1-5: 5 = afecta directamente a Bonita (precio, producto o cliente compartido); 1 = contexto menor.",
    "",
    "Devuelve SOLO un array JSON valido, sin markdown:",
    '[{"competidor":"nombre exacto de la lista","hallazgos":[{"tipo":"carta|precios|prensa|resenas|eventos|otro","titulo":"titular corto","detalle":"2-3 frases","url":"https://...","relevancia":3}]}]'
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
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }]
      })
    });
    const data = await apiRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message || "Error de la API de Claude" });

    const text = (data.content || []).filter(function(b){ return b.type === "text"; })
      .map(function(b){ return b.text; }).join("\n");
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    const resultados = (start !== -1 && end !== -1) ? JSON.parse(text.slice(start, end + 1)) : [];

    let insertados = 0;
    for (const r of resultados) {
      const comp = targets.find(function(t){ return t.name.toLowerCase() === (r.competidor || "").toLowerCase(); });
      if (!comp) continue;
      for (const h of (r.hallazgos || [])) {
        if (!h.titulo) continue;
        const ins = await fetch(SUPABASE_URL + "/rest/v1/agent_watch_findings", {
          method: "POST",
          headers: sbHeaders(SERVICE_KEY),
          body: JSON.stringify({
            competitor_id: comp.id,
            tipo: ["carta","precios","prensa","resenas","eventos","otro"].includes(h.tipo) ? h.tipo : "otro",
            titulo: String(h.titulo).slice(0, 200),
            detalle: String(h.detalle || "").slice(0, 1000),
            url: h.url || null,
            relevancia: (h.relevancia >= 1 && h.relevancia <= 5) ? h.relevancia : null
          })
        });
        if (ins.ok) insertados++;
      }
    }

    // Marcar vigilados y registrar el run
    const now = new Date().toISOString();
    for (const t of targets) {
      await fetch(SUPABASE_URL + "/rest/v1/agent_competitors?id=eq." + t.id, {
        method: "PATCH", headers: sbHeaders(SERVICE_KEY), body: JSON.stringify({ last_checked_at: now })
      });
    }
    const inTok = (data.usage && data.usage.input_tokens) || 0;
    const outTok = (data.usage && data.usage.output_tokens) || 0;
    const searches = (data.usage && data.usage.server_tool_use && data.usage.server_tool_use.web_search_requests) || 0;
    const cost = inTok * 3 / 1e6 + outTok * 15 / 1e6 + searches * 0.01;
    await fetch(SUPABASE_URL + "/rest/v1/agent_runs", {
      method: "POST", headers: sbHeaders(SERVICE_KEY),
      body: JSON.stringify({ agent: "Vigilante competencia", items: insertados, tokens_in: inTok, tokens_out: outTok, cost: cost })
    });

    return res.status(200).json({ vigilados: targets.length, hallazgos: insertados });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Fallo en la vigilancia. Reintenta." });
  }
}
