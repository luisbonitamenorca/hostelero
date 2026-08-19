// PORTADA de agentes-bonita a Hostelero (19-08-2026) casi literal: solo
// cambian las constantes de conexión, que ahora apuntan al Supabase de la
// casa — las tablas agent_* viven aquí y el Bearer que valida es el token de
// sesión de HOSTELERO (el mismo que el route handler /agentes inyecta en el
// panel). Vive en pages/api (router clásico) a propósito: convive con app/ y
// permite portar el (req, res) original sin reescribirlo.
// /api/sincronizar — verificador de horarios publicados vs base de conocimiento.
// GET  = cron de Vercel (un local al dia, rotando). Protegido con CRON_SECRET.
// POST = comprobacion manual desde el panel (requiere sesion de Supabase).
// Escribe en Supabase con SUPABASE_SERVICE_ROLE_KEY (solo servidor).

export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const VENUE_ROTATION = ["bini", "rtam", "btam", "tir"];

function sbHeaders(key) {
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
}

export default async function handler(req, res) {
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) return res.status(500).json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en Vercel" });

  let venue = null;

  if (req.method === "GET") {
    // Llamada del cron
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== "Bearer " + secret)
      return res.status(401).json({ error: "No autorizado" });
    venue = VENUE_ROTATION[new Date().getDay() % VENUE_ROTATION.length];
  } else if (req.method === "POST") {
    // Llamada manual desde el panel
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Sin sesión" });
    const userRes = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token }
    });
    if (!userRes.ok) return res.status(401).json({ error: "Sesión no válida" });
    venue = (req.body || {}).venue;
  } else {
    return res.status(405).json({ error: "Método no permitido" });
  }

  if (!venue || !VENUE_ROTATION.includes(venue))
    return res.status(400).json({ error: "Local no válido" });

  try {
    // 1) Nombre del local y documento canonico de horarios (activo, con "horari" en el titulo)
    const [toneRes, knRes] = await Promise.all([
      fetch(SUPABASE_URL + "/rest/v1/agent_tones?venue=eq." + venue + "&select=name", { headers: sbHeaders(SERVICE_KEY) }),
      fetch(SUPABASE_URL + "/rest/v1/agent_knowledge?venue=eq." + venue + "&active=eq.true&select=title,content", { headers: sbHeaders(SERVICE_KEY) })
    ]);
    const tones = await toneRes.json();
    const docs = await knRes.json();
    const venueName = (tones[0] && tones[0].name) || venue;
    const horariosDocs = (docs || []).filter(function(d){ return /horari/i.test(d.title || ""); });

    if (!horariosDocs.length)
      return res.status(200).json({ venue: venue, skipped: true, motivo: "Sin documento de horarios activo en la base de conocimiento. Crea y activa uno (con 'Horarios' en el título) para que el sincronizador tenga fuente de verdad." });

    const canonico = horariosDocs.map(function(d){ return d.content; }).join("\n").slice(0, 3000);

    // 2) Comparar con lo publicado
    const prompt = [
      "Eres el verificador de horarios de " + venueName + " (Menorca).",
      "",
      "HORARIO CANONICO (la verdad interna del negocio):",
      canonico,
      "",
      "TAREA: busca en la web el horario que aparece publicado HOY para " + venueName + " en: (1) la ficha de Google (busca '" + venueName + " horario'), (2) TripAdvisor, (3) TheFork si existe, (4) la web oficial. Maximo 5 busquedas.",
      "",
      "Para cada plataforma donde encuentres un horario publicado, compara con el canonico.",
      "IMPORTANTE: ten en cuenta sinonimos y formatos (12:00-17:00 = 'de 12 a 17h'). Solo marca discrepancia si el contenido REALMENTE difiere (dias distintos, horas distintas, cerrado vs abierto). Si una plataforma no publica horario o no tiene ficha, no es discrepancia: omitela.",
      "",
      "Devuelve SOLO un array JSON valido, sin markdown, con una entrada POR PLATAFORMA COMPROBADA:",
      '[{"plataforma":"Google","encontrado":"horario tal como aparece publicado","coincide":true,"detalle":"vacio si coincide; si no, explica la diferencia en 1 frase"}]'
    ].join("\n");

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]
      })
    });
    const data = await apiRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message || "Error de la API de Claude" });

    const text = (data.content || []).filter(function(b){ return b.type === "text"; })
      .map(function(b){ return b.text; }).join("\n");
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    const checks = (start !== -1 && end !== -1) ? JSON.parse(text.slice(start, end + 1)) : [];

    // 3) Crear alertas por discrepancia (evitando duplicar abiertas del mismo local+plataforma)
    const openRes = await fetch(SUPABASE_URL + "/rest/v1/agent_sync_alerts?venue=eq." + venue + "&estado=eq.abierta&select=plataforma", { headers: sbHeaders(SERVICE_KEY) });
    const abiertas = (await openRes.json()).map(function(a){ return a.plataforma; });

    let creadas = 0;
    for (const c of checks) {
      if (c.coincide || !c.plataforma) continue;
      if (abiertas.includes(c.plataforma)) continue;
      const ins = await fetch(SUPABASE_URL + "/rest/v1/agent_sync_alerts", {
        method: "POST",
        headers: sbHeaders(SERVICE_KEY),
        body: JSON.stringify({ venue: venue, plataforma: c.plataforma, esperado: canonico.slice(0, 500), encontrado: c.encontrado || "", detalle: c.detalle || "" })
      });
      if (ins.ok) creadas++;
    }

    // 4) Registrar la comprobación y el run
    const resumen = checks.map(function(c){ return c.plataforma + ": " + (c.coincide ? "OK" : "DISCREPANCIA — " + (c.detalle||"")); }).join(" · ");
    await fetch(SUPABASE_URL + "/rest/v1/agent_sync_checks", {
      method: "POST",
      headers: sbHeaders(SERVICE_KEY),
      body: JSON.stringify({ venue: venue, ok: creadas === 0, comprobadas: checks.length, discrepancias: creadas, resumen: resumen.slice(0, 800) })
    });

    const inTok = (data.usage && data.usage.input_tokens) || 0;
    const outTok = (data.usage && data.usage.output_tokens) || 0;
    const searches = (data.usage && data.usage.server_tool_use && data.usage.server_tool_use.web_search_requests) || 0;
    const cost = inTok * 3 / 1e6 + outTok * 15 / 1e6 + searches * 0.01;
    await fetch(SUPABASE_URL + "/rest/v1/agent_runs", {
      method: "POST",
      headers: sbHeaders(SERVICE_KEY),
      body: JSON.stringify({ agent: "Sincronizador horarios", items: creadas, tokens_in: inTok, tokens_out: outTok, cost: cost })
    });

    return res.status(200).json({ venue: venue, comprobadas: checks.length, discrepancias: creadas });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Fallo en la sincronización. Reintenta." });
  }
}
