// api/compras/procesar-cola.js · OCR de la bandeja de correo desde el servidor
// ============================================================================
// 22-10-2026. La ingesta IMAP (ingesta-correo.js) deja los adjuntos en
// compras_correo_adjunto como PENDIENTE, pero el OCR lo hacía solo el navegador
// de quien tuviera abierta la pantalla de Compras. Por las tardes y los fines
// de semana la bandeja esperaba hasta la mañana siguiente (12-39 h medidas).
//
// Este endpoint ejecuta el MISMO pipeline (lib/compras/ocr-servidor.js) con la
// service key y la ANTHROPIC_API_KEY del servidor. Lo llama el cron de Vercel
// (apps/general/vercel.json, a y 5 y a y 35, justo después de la ingesta) y el
// workflow de GitHub Actions cada 15 min, detrás de la ingesta. También se
// puede lanzar a mano:
//   curl -H "Authorization: Bearer <CRON_SECRET o service key>" \
//        https://hostelero-app.vercel.app/api/compras/procesar-cola
//
// El navegador sigue procesando igual que antes: el reclamo de filas es el
// mismo PATCH atómico, así que el que llega segundo no encuentra la fila.
// ============================================================================
import { procesarColaServidor } from "../../../lib/compras/ocr-servidor.js";

// OJO: maxDuration tiene que ser un NÚMERO LITERAL (Vercel lo lee del código en
// crudo). Igual que anthropic.js y los agentes: 300 s.
export const config = { maxDuration: 300 };

// No se EMPIEZA un documento nuevo pasados estos ms. Un documento puede
// necesitar hasta tres llamadas al modelo (partición, OCR, escalada a Opus),
// cada una con tope de 150 s, así que el margen hasta los 300 s es necesario.
// Lo que no dé tiempo queda PENDIENTE y lo coge la siguiente pasada.
const PRESUPUESTO_MS = 120000;

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Misma guarda que ingesta-correo.js: CRON_SECRET, service key o token de
// sesión de un usuario de la plataforma.
async function esUsuarioDeLaPlataforma(auth) {
  const token = (auth || "").replace(/^Bearer\s+/i, "").trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !anon || !SB_URL || token === anon) return false;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
    if (!r.ok) return false;
    const u = await r.json();
    return !!(u && u.id);
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const okCron = process.env.CRON_SECRET && auth === "Bearer " + process.env.CRON_SECRET;
  const okServicio = SB_KEY && auth === "Bearer " + SB_KEY;
  const okUsuario = !okCron && !okServicio && (await esUsuarioDeLaPlataforma(auth));
  if (!okCron && !okServicio && !okUsuario) return res.status(401).json({ error: "No autorizado" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ ok: false, error: "Falta ANTHROPIC_API_KEY en las variables de entorno de Vercel" });
  }

  // ?presupuesto=segundos para pruebas a mano (nunca por encima del tope).
  const seg = parseInt(String(req.query.presupuesto || ""), 10);
  const presupuestoMs = seg > 0 ? Math.min(seg * 1000, PRESUPUESTO_MS) : PRESUPUESTO_MS;

  try {
    const resumen = await procesarColaServidor({ presupuestoMs });
    return res.status(200).json({ ok: true, ...resumen });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
