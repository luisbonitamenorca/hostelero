// /api/agentes/meta-estado — radiografía de la conexión con Meta (09-10-2026).
// Sirve para comprobar, sin pasar tokens por el chat ni por el repo, que el
// token del usuario del sistema (META_ACCESS_TOKEN en Vercel) vale y llega a
// todo lo que necesita, y para dejar suscritas las páginas y la cuenta de
// WhatsApp a los campos del webhook.
//
//   GET ?clave=CRON_SECRET               → estado: token, páginas, Instagram, WhatsApp, suscripciones
//   GET ?clave=CRON_SECRET&suscribir=1   → además suscribe páginas y WABA a los campos (CAMPOS_PAGINA)
//   GET ?clave=CRON_SECRET&negocio=<id>  → fuerza el Business Portfolio donde buscar cuentas de WhatsApp
//   GET ?clave=CRON_SECRET&waba=<id,id>  → cuentas de WhatsApp concretas
//   También vale Authorization: Bearer <token de sesión del panel>.
//
// Guarda en agentes_credenciales (proveedor "meta", RLS sin políticas = solo
// service role) el mapa página → Instagram → local con los tokens de página,
// para que el buzón y las respuestas sepan de qué local es cada evento.
// La respuesta HTTP NUNCA incluye tokens.

const GRAPH = "https://graph.facebook.com/v26.0";
const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca

// Campos a los que suscribimos cada página. Meta solo entrega un campo si está
// marcado a la vez aquí (nivel página) y en el panel de Webhooks (nivel App).
const CAMPOS_PAGINA = ["messages", "messaging_postbacks", "message_reactions", "message_edits", "feed", "mention"];

// Local de cada página por su nombre (misma idea que google-resenas). El orden
// importa: «bar» antes que «tamarindos» para distinguir El bar de Tamarindos.
const VENUE_POR_NOMBRE = [["binifadet", "bini"], ["tirant", "tir"], ["bar", "btam"], ["tamarindos", "rtam"]];

function venueDe(nombre) {
  const n = (nombre || "").toLowerCase();
  for (const [pista, venue] of VENUE_POR_NOMBRE) if (n.includes(pista)) return venue;
  return null;
}

/** Llamada a la Graph API que nunca lanza: devuelve el JSON o { error }. */
async function graph(ruta, token, { method = "GET", query = {} } = {}) {
  const url = new URL(GRAPH + ruta);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  let r, j;
  try {
    r = await fetch(url, { method });
    j = await r.json();
  } catch (e) {
    return { error: "sin respuesta de Graph: " + (e && e.message ? e.message : String(e)) };
  }
  if (!r.ok || (j && j.error)) {
    const err = (j && j.error) || {};
    return { error: err.message || "HTTP " + r.status, codigo: err.code ?? null, subcodigo: err.error_subcode ?? null };
  }
  return j;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Método no permitido" });

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secreto = (process.env.CRON_SECRET || "").trim();

  // — Puerta: ?clave=CRON_SECRET, Bearer CRON_SECRET o sesión del panel.
  const clave = String(req.query.clave || "").trim();
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  let autorizado = Boolean(secreto) && (clave === secreto || bearer === secreto);
  if (!autorizado && bearer && SUPABASE_URL && ANON) {
    const u = await fetch(SUPABASE_URL + "/auth/v1/user", { headers: { apikey: ANON, Authorization: "Bearer " + bearer } });
    autorizado = u.ok;
  }
  if (!autorizado) return res.status(401).json({ error: "No autorizado" });

  const token = (process.env.META_ACCESS_TOKEN || "").trim();
  const appId = (process.env.META_APP_ID || "").trim();
  const appSecret = (process.env.META_APP_SECRET || "").trim();
  const env = {
    META_ACCESS_TOKEN: Boolean(token),
    META_VERIFY_TOKEN: Boolean((process.env.META_VERIFY_TOKEN || "").trim()),
    META_APP_SECRET: Boolean(appSecret),
    META_APP_ID: Boolean(appId),
  };
  if (!token) return res.status(500).json({ error: "Falta META_ACCESS_TOKEN en Vercel (y Redeploy después de añadirla)", env });

  const avisos = [];
  const suscribir = String(req.query.suscribir || "") === "1";

  // — 1. El token. debug_token con el token de App si tenemos META_APP_ID y
  //      META_APP_SECRET; si no, el propio token se depura a sí mismo.
  const tokenDepurador = appId && appSecret ? appId + "|" + appSecret : token;
  const dbg = await graph("/debug_token", tokenDepurador, { query: { input_token: token } });
  const d = (dbg && dbg.data) || {};
  const infoToken = dbg.error
    ? { error: dbg.error }
    : {
        valido: Boolean(d.is_valid),
        tipo: d.type || null,
        app_id: d.app_id || null,
        caduca: !d.expires_at ? "nunca" : new Date(d.expires_at * 1000).toISOString(),
        permisos: d.scopes || [],
        alcance: (d.granular_scopes || []).map((g) => ({ permiso: g.scope, ids: g.target_ids || [] })),
      };
  if (infoToken.valido === false) avisos.push("El token no es válido: genera otro en Configuración del negocio → Usuarios del sistema.");
  if (d.expires_at) avisos.push("El token caduca: regenéralo con caducidad «Nunca».");

  // — 2. Páginas, su Instagram y a qué está suscrita cada una.
  const cuentas = await graph("/me/accounts", token, {
    query: { fields: "id,name,access_token,tasks,instagram_business_account{id,username}", limit: "50" },
  });
  const paginas = [];
  if (cuentas.error) {
    avisos.push("No se pueden listar las páginas: " + cuentas.error + " (¿falta pages_show_list o las páginas no están asignadas al usuario del sistema?)");
  } else {
    for (const p of cuentas.data || []) {
      const fila = {
        id: p.id,
        nombre: p.name,
        venue: venueDe(p.name),
        tareas: p.tasks || [],
        instagram: p.instagram_business_account || null,
        apps_suscritas: [],
        token: p.access_token || null,
      };
      if (fila.token) {
        if (suscribir) {
          const r = await graph("/" + p.id + "/subscribed_apps", fila.token, { method: "POST", query: { subscribed_fields: CAMPOS_PAGINA.join(",") } });
          if (r.error) avisos.push("No se pudo suscribir la página " + p.name + ": " + r.error);
        }
        const s = await graph("/" + p.id + "/subscribed_apps", fila.token);
        fila.apps_suscritas = s.error ? [{ error: s.error }] : (s.data || []).map((a) => ({ app: a.name, id: a.id, campos: a.subscribed_fields || [] }));
      } else {
        avisos.push("La página " + p.name + " no devuelve token de página.");
      }
      paginas.push(fila);
    }
    if (!paginas.length) avisos.push("El token no ve ninguna página: asigna las 4 páginas al usuario del sistema y genera un token nuevo.");
    for (const p of paginas) {
      if (!p.instagram) avisos.push("La página " + p.nombre + " no tiene cuenta de Instagram vinculada visible (o falta instagram_basic).");
      if (!p.venue) avisos.push("No sé a qué local corresponde la página " + p.nombre + ": añadir pista en VENUE_POR_NOMBRE.");
      if (!p.apps_suscritas.length) avisos.push("La página " + p.nombre + " no está suscrita a ninguna App: usa &suscribir=1 o «Añadir suscripciones» en el panel.");
    }
  }

  // — 3. WhatsApp: cuentas (WABA) a las que llega el token y sus números.
  //      Fuentes: ids del alcance del token, ?waba=, y los negocios del token.
  const wabaIds = new Set();
  for (const g of d.granular_scopes || []) {
    if (g.scope === "whatsapp_business_management" || g.scope === "whatsapp_business_messaging") {
      for (const id of g.target_ids || []) wabaIds.add(String(id));
    }
  }
  String(req.query.waba || "").split(",").map((x) => x.trim()).filter(Boolean).forEach((x) => wabaIds.add(x));
  const negocioForzado = String(req.query.negocio || "").trim();
  if (negocioForzado || !wabaIds.size) {
    let negocios = [];
    if (negocioForzado) negocios = [{ id: negocioForzado }];
    else {
      const b = await graph("/me/businesses", token, { query: { fields: "id,name" } });
      negocios = b.error ? [] : b.data || [];
    }
    for (const n of negocios) {
      for (const borde of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
        const w = await graph("/" + n.id + "/" + borde, token, { query: { fields: "id" } });
        for (const x of (w && w.data) || []) wabaIds.add(String(x.id));
      }
    }
  }
  const whatsapp = [];
  for (const id of wabaIds) {
    const w = await graph("/" + id, token, { query: { fields: "id,name,phone_numbers{id,display_phone_number,verified_name,quality_rating}" } });
    if (w.error) {
      whatsapp.push({ waba_id: id, error: w.error });
      continue;
    }
    if (suscribir) {
      const r = await graph("/" + id + "/subscribed_apps", token, { method: "POST" });
      if (r.error) avisos.push("No se pudo suscribir la cuenta de WhatsApp " + id + ": " + r.error);
    }
    const s = await graph("/" + id + "/subscribed_apps", token);
    whatsapp.push({
      waba_id: id,
      nombre: w.name || null,
      numeros: ((w.phone_numbers && w.phone_numbers.data) || []).map((t) => ({
        phone_number_id: t.id,
        numero: t.display_phone_number,
        nombre_visible: t.verified_name,
        calidad: t.quality_rating,
      })),
      apps_suscritas: s.error ? [{ error: s.error }] : (s.data || []).map((a) => ({ app: a.name, id: a.id })),
    });
  }
  if (!whatsapp.length) avisos.push("No veo ninguna cuenta de WhatsApp Business: asigna la WABA al usuario del sistema y genera token nuevo, o pasa ?waba=<id>.");

  // — 4. Guardar el mapa (con tokens de página) para el buzón y las respuestas.
  let guardado = false;
  if (SERVICE_KEY && SUPABASE_URL && !cuentas.error) {
    const ahora = new Date().toISOString();
    const fila = {
      cuenta_id: CUENTA_ID,
      proveedor: "meta",
      datos: {
        app_id: infoToken.app_id || appId || null,
        paginas: paginas.map((p) => ({
          id: p.id,
          nombre: p.nombre,
          venue: p.venue,
          instagram_id: p.instagram ? p.instagram.id : null,
          instagram_usuario: p.instagram ? p.instagram.username : null,
          token: p.token,
        })),
        whatsapp: whatsapp.filter((w) => !w.error).map((w) => ({ waba_id: w.waba_id, nombre: w.nombre, numeros: w.numeros })),
        actualizado: ahora,
      },
      actualizado_en: ahora,
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
    guardado = r.ok;
    if (!r.ok) avisos.push("No se pudo guardar el mapa en agentes_credenciales: " + (await r.text()).slice(0, 200));
  }

  return res.status(200).json({
    env,
    token: infoToken,
    paginas: paginas.map(({ token: _t, ...p }) => p),
    whatsapp,
    campos_pagina: CAMPOS_PAGINA,
    suscrito_ahora: suscribir,
    mapa_guardado: guardado,
    avisos,
  });
}
