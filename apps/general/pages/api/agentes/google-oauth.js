// /api/agentes/google-oauth — autorización de Google Business Profile.
// Un solo endpoint hace de inicio y de retorno (es la URI registrada en el
// cliente OAuth "hostelero-agentes" del proyecto bonita-agentes):
//   GET ?clave=CRON_SECRET      → redirige a Google para autorizar
//   GET ?code=...&state=...     → vuelta de Google: cambia el código por
//                                 tokens y guarda el refresh_token en
//                                 agentes_credenciales (solo service role).
// La cuenta que debe autorizar es la que administra las fichas
// (luis.binifadet@gmail.com). El secreto del cliente vive en Vercel.

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca
const REDIRECT = "https://hostelero-app.vercel.app/api/agentes/google-oauth";
const SCOPE = "https://www.googleapis.com/auth/business.manage";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

  const { CRON_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET)
    return res.status(500).json({ error: "Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en Vercel" });

  const { code, state, clave } = req.query;
  // Al pegar la clave en Vercel a veces se cuela un espacio o salto de línea.
  const secreto = (CRON_SECRET || "").trim();
  const claveLimpia = (clave || "").trim();

  // Paso 1: arrancar la autorización (protegido para que no lo dispare cualquiera).
  if (!code) {
    if (!secreto || claveLimpia !== secreto)
      return res.status(401).json({
        error: "No autorizado",
        pista: { hay_cron_secret: Boolean(secreto), longitud_cron_secret: secreto.length, longitud_clave_url: claveLimpia.length },
      });
    const url =
      "https://accounts.google.com/o/oauth2/v2/auth" +
      "?client_id=" + encodeURIComponent(GOOGLE_CLIENT_ID) +
      "&redirect_uri=" + encodeURIComponent(REDIRECT) +
      "&response_type=code" +
      "&scope=" + encodeURIComponent(SCOPE) +
      "&access_type=offline&prompt=consent" +
      "&state=" + encodeURIComponent(claveLimpia);
    return res.redirect(302, url);
  }

  // Paso 2: vuelta de Google.
  if (!secreto || (state || "").trim() !== secreto) return res.status(401).json({ error: "Estado no válido" });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.refresh_token)
    return res.status(500).json({ error: "Google no devolvió refresh_token", detalle: tokens.error || null });

  const fila = {
    cuenta_id: CUENTA_ID,
    proveedor: "google_business",
    datos: { refresh_token: tokens.refresh_token, scope: tokens.scope },
    actualizado_en: new Date().toISOString(),
  };
  const r = await fetch(SUPABASE_URL + "/rest/v1/agentes_credenciales", {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: "Bearer " + SERVICE_KEY,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([fila]),
  });
  if (!r.ok) return res.status(500).json({ error: "No se pudo guardar la credencial", detalle: await r.text() });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send("<h2>Google Business conectado ✓</h2><p>Ya puedes cerrar esta pestaña.</p>");
}
