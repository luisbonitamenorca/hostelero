// /api/agentes/google-responder — publica DE VERDAD una respuesta a una
// reseña de Google (v4 reply) y marca la reseña como publicada.
//   POST { id, texto }  — auth: sesión de Supabase del panel de Agentes.
// La ficha se localiza en el momento por el título (mismo mapeo que el sync),
// así no hace falta guardar rutas de Google en la tabla.

export const maxDuration = 60;

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function venueDe(titulo) {
  const t = (titulo || "").toLowerCase();
  if (t.includes("binifadet")) return "bini";
  if (t.includes("tirant")) return "tir";
  if (t.includes("bar")) return "btam";
  if (t.includes("tamarindos")) return "rtam";
  return null;
}

function sbHeaders(key) {
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!SERVICE_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
    return res.status(500).json({ error: "Faltan claves en Vercel" });

  // Sesión del panel (mismo control que el resto de endpoints de agentes)
  // o el CRON_SECRET para automatizaciones del servidor.
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Sin sesión" });
  const esCron = process.env.CRON_SECRET && token === (process.env.CRON_SECRET || "").trim();
  if (!esCron) {
    const userRes = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token },
    });
    if (!userRes.ok) return res.status(401).json({ error: "Sesión no válida" });
  }

  const { id, texto } = req.body || {};
  if (!id || !texto || !String(texto).trim()) return res.status(400).json({ error: "Faltan id o texto" });

  try {
    // 1) La reseña: su venue dice en qué ficha hay que responder.
    const revRes = await fetch(
      SUPABASE_URL + "/rest/v1/agent_reviews?id=eq." + encodeURIComponent(id) + "&select=id,venue,source",
      { headers: sbHeaders(SERVICE_KEY) },
    );
    const review = (await revRes.json())[0];
    if (!review) return res.status(404).json({ error: "Reseña no encontrada" });
    if (review.source !== "google") return res.status(400).json({ error: "Esta reseña no es de Google" });

    // 2) Token de Google.
    const credRes = await fetch(
      SUPABASE_URL + "/rest/v1/agentes_credenciales?cuenta_id=eq." + CUENTA_ID + "&proveedor=eq.google_business&select=datos",
      { headers: sbHeaders(SERVICE_KEY) },
    );
    const cred = (await credRes.json())[0];
    if (!cred) return res.status(400).json({ error: "Google no está conectado" });
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: cred.datos.refresh_token,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
      }),
    });
    const tok = await tokenRes.json();
    if (!tok.access_token) return res.status(500).json({ error: "No se pudo refrescar el token de Google" });
    const gHeaders = { Authorization: "Bearer " + tok.access_token, "Content-Type": "application/json" };

    // 3) La ficha de ese venue.
    const accRes = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", { headers: gHeaders });
    const accs = (await accRes.json()).accounts || [];
    let ruta = null;
    for (const acc of accs) {
      const lr = await fetch(
        "https://mybusinessbusinessinformation.googleapis.com/v1/" + acc.name + "/locations?readMask=name,title&pageSize=100",
        { headers: gHeaders },
      );
      for (const loc of (await lr.json()).locations || []) {
        if (venueDe(loc.title) === review.venue) ruta = acc.name + "/" + loc.name;
      }
    }
    if (!ruta) return res.status(500).json({ error: "No se encontró la ficha de Google de este local" });

    // 4) Publicar la respuesta (PUT crea o sustituye).
    const pubRes = await fetch("https://mybusiness.googleapis.com/v4/" + ruta + "/reviews/" + review.id + "/reply", {
      method: "PUT",
      headers: gHeaders,
      body: JSON.stringify({ comment: String(texto).trim() }),
    });
    if (!pubRes.ok) {
      const detalle = await pubRes.text();
      return res.status(500).json({ error: "Google rechazó la respuesta", detalle: detalle.slice(0, 400) });
    }

    // 5) Marcarla en la tabla.
    await fetch(SUPABASE_URL + "/rest/v1/agent_reviews?id=eq." + encodeURIComponent(id), {
      method: "PATCH",
      headers: sbHeaders(SERVICE_KEY),
      body: JSON.stringify({ status: "publicada", draft: String(texto).trim(), updated_at: new Date().toISOString() }),
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
