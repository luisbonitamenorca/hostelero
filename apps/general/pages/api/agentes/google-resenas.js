// /api/agentes/google-resenas — trae las reseñas de Google Business Profile
// de las 4 fichas y las mete en agent_reviews (la tabla que pinta el panel).
//   GET  = cron de Vercel o llamada manual con Bearer CRON_SECRET.
// Usa el refresh_token guardado por /api/agentes/google-oauth. Las reseñas
// llegan por la Google My Business API clásica (v4), la única que las expone.

export const maxDuration = 300;

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

// Ficha de Google → venue del panel (mismo slug que agent_tones).
function venueDe(titulo) {
  const t = (titulo || "").toLowerCase();
  if (t.includes("binifadet")) return "bini";
  if (t.includes("tirant")) return "tir";
  if (t.includes("bar")) return "btam";
  if (t.includes("tamarindos")) return "rtam";
  return null;
}

const ESTRELLAS = { STAR_RATING_UNSPECIFIED: null, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

function sbHeaders(key) {
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== "Bearer " + secret)
    return res.status(401).json({ error: "No autorizado" });

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!SERVICE_KEY || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
    return res.status(500).json({ error: "Faltan claves en Vercel" });

  try {
    // 1) Refresh token guardado → access token fresco.
    const credRes = await fetch(
      SUPABASE_URL + "/rest/v1/agentes_credenciales?cuenta_id=eq." + CUENTA_ID + "&proveedor=eq.google_business&select=datos",
      { headers: sbHeaders(SERVICE_KEY) },
    );
    const cred = (await credRes.json())[0];
    if (!cred) return res.status(400).json({ error: "Sin credencial: autoriza primero en /api/agentes/google-oauth" });

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
    if (!tok.access_token) return res.status(500).json({ error: "No se pudo refrescar el token", detalle: tok.error || null });
    const gHeaders = { Authorization: "Bearer " + tok.access_token };

    // 2) Cuenta y fichas.
    const accRes = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", { headers: gHeaders });
    const accs = (await accRes.json()).accounts || [];
    if (!accs.length) return res.status(500).json({ error: "Google no devolvió cuentas" });

    const filas = [];
    let fichas = 0;
    for (const acc of accs) {
      let pageToken = "";
      const locs = [];
      do {
        const u =
          "https://mybusinessbusinessinformation.googleapis.com/v1/" + acc.name +
          "/locations?readMask=name,title&pageSize=100" + (pageToken ? "&pageToken=" + pageToken : "");
        const lr = await fetch(u, { headers: gHeaders });
        const lj = await lr.json();
        locs.push(...(lj.locations || []));
        pageToken = lj.nextPageToken || "";
      } while (pageToken);

      // 3) Reseñas de cada ficha (v4, paginado).
      for (const loc of locs) {
        const venue = venueDe(loc.title);
        if (!venue) continue;
        fichas++;
        let pt = "";
        do {
          const u =
            "https://mybusiness.googleapis.com/v4/" + acc.name + "/" + loc.name +
            "/reviews?pageSize=50" + (pt ? "&pageToken=" + pt : "");
          const rr = await fetch(u, { headers: gHeaders });
          if (!rr.ok) break; // ficha sin reseñas o sin permiso: seguimos
          const rj = await rr.json();
          for (const rev of rj.reviews || []) {
            filas.push({
              id: rev.reviewId || rev.name,
              cuenta_id: CUENTA_ID,
              venue,
              platform: "google",
              author: rev.reviewer?.displayName || "Anónimo",
              rating: ESTRELLAS[rev.starRating] ?? null,
              review_date: (rev.createTime || "").slice(0, 10) || null,
              text: rev.comment || "",
              status: "pendiente",
              source: "google",
            });
          }
          pt = rj.nextPageToken || "";
        } while (pt);
      }
    }

    // 4) Upsert sin machacar el trabajo del panel: las que ya existen no se tocan.
    let nuevas = 0;
    if (filas.length) {
      const r = await fetch(SUPABASE_URL + "/rest/v1/agent_reviews?on_conflict=id", {
        method: "POST",
        headers: { ...sbHeaders(SERVICE_KEY), Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify(filas),
      });
      if (!r.ok) return res.status(500).json({ error: "No se pudieron guardar", detalle: await r.text() });
      nuevas = (await r.json()).length;
    }

    return res.status(200).json({ ok: true, fichas, resenas_vistas: filas.length, nuevas });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
