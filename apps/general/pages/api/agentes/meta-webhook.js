// /api/agentes/meta-webhook — la puerta por donde Meta nos trae los mensajes
// (28-08-2026). Instagram, Messenger, comentarios, menciones y WhatsApp Cloud
// API llaman aquí; todo aterriza en agentes_buzon con el crudo guardado.
//
//  · GET: verificación de Meta al dar de alta el webhook (hub.challenge).
//    META_VERIFY_TOKEN debe coincidir con el que se ponga en la consola de
//    developers.facebook.com — lo inventa Luis y lo pega en los dos sitios.
//  · POST: eventos. Si META_APP_SECRET está en Vercel, se exige la firma
//    X-Hub-Signature-256 (HMAC del cuerpo crudo) — por eso bodyParser: false.
//  · Siempre 200 rápido: si Meta no recibe 200, reintenta y acaba
//    desactivando el webhook.

import crypto from "node:crypto";

export const config = { api: { bodyParser: false } };

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca

function leerCrudo(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    req.on("data", (t) => trozos.push(t));
    req.on("end", () => resolve(Buffer.concat(trozos)));
    req.on("error", reject);
  });
}

/** Normaliza un lote de eventos de Meta a filas del buzón. */
function extraerEventos(cuerpo) {
  const filas = [];
  const objeto = cuerpo.object || "";
  for (const entrada of cuerpo.entry ?? []) {
    const pagina = String(entrada.id ?? "");
    // Mensajería (Messenger e Instagram comparten forma)
    for (const ev of entrada.messaging ?? []) {
      if (!ev.message || ev.message.is_echo) continue;
      filas.push({
        canal: objeto === "instagram" ? "instagram" : "facebook",
        tipo: "mensaje",
        pagina_ref: pagina,
        remitente_id: String(ev.sender?.id ?? ""),
        texto: ev.message.text ?? (ev.message.attachments ? "[adjunto]" : ""),
        evento_en: ev.timestamp ? new Date(ev.timestamp).toISOString() : null,
        raw: ev,
      });
    }
    // Cambios (comentarios, menciones, WhatsApp)
    for (const cambio of entrada.changes ?? []) {
      const campo = cambio.field || "";
      const valor = cambio.value ?? {};
      if (objeto === "whatsapp_business_account" && campo === "messages") {
        const contactos = new Map((valor.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
        for (const msj of valor.messages ?? []) {
          filas.push({
            canal: "whatsapp",
            tipo: "mensaje",
            pagina_ref: String(valor.metadata?.display_phone_number ?? pagina),
            remitente_id: String(msj.from ?? ""),
            remitente_nombre: contactos.get(msj.from) ?? null,
            texto: msj.text?.body ?? `[${msj.type ?? "adjunto"}]`,
            evento_en: msj.timestamp ? new Date(Number(msj.timestamp) * 1000).toISOString() : null,
            raw: msj,
          });
        }
      } else if (campo === "comments" || campo === "feed" || campo === "mentions" || campo === "mention") {
        const esComentario = campo !== "mentions" && campo !== "mention";
        filas.push({
          canal: objeto === "instagram" ? "instagram" : "facebook",
          tipo: esComentario ? "comentario" : "mencion",
          pagina_ref: pagina,
          remitente_id: String(valor.from?.id ?? ""),
          remitente_nombre: valor.from?.name ?? valor.from?.username ?? null,
          texto: valor.text ?? valor.message ?? "",
          evento_en: entrada.time ? new Date(entrada.time * 1000).toISOString() : null,
          raw: cambio,
        });
      } else {
        filas.push({
          canal: objeto === "instagram" ? "instagram" : objeto === "whatsapp_business_account" ? "whatsapp" : "facebook",
          tipo: "otro",
          pagina_ref: pagina,
          texto: campo,
          raw: cambio,
        });
      }
    }
  }
  return filas;
}

export default async function handler(req, res) {
  // — Verificación del alta del webhook
  if (req.method === "GET") {
    const q = req.query || {};
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === process.env.META_VERIFY_TOKEN && process.env.META_VERIFY_TOKEN) {
      return res.status(200).send(q["hub.challenge"]);
    }
    return res.status(403).send("token de verificación incorrecto");
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const crudo = await leerCrudo(req);

  // — Firma: obligatoria si el secreto está configurado
  const secreto = process.env.META_APP_SECRET;
  if (secreto) {
    const firma = req.headers["x-hub-signature-256"] || "";
    const esperada = "sha256=" + crypto.createHmac("sha256", secreto).update(crudo).digest("hex");
    const a = Buffer.from(String(firma));
    const b = Buffer.from(esperada);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: "firma no válida" });
    }
  }

  let cuerpo;
  try {
    cuerpo = JSON.parse(crudo.toString("utf8"));
  } catch {
    return res.status(200).json({ ok: true }); // cuerpo raro: 200 igualmente
  }

  const filas = extraerEventos(cuerpo).map((f) => ({ ...f, cuenta_id: CUENTA_ID }));

  if (filas.length > 0) {
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (SERVICE_KEY && SUPABASE_URL) {
      // El 200 a Meta no espera a Supabase más de lo imprescindible; si el
      // insert falla, queda en el log de Vercel (Meta reintentará el lote).
      const r = await fetch(SUPABASE_URL + "/rest/v1/agentes_buzon", {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: "Bearer " + SERVICE_KEY,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(filas),
      });
      if (!r.ok) {
        console.error("agentes_buzon insert", r.status, (await r.text()).slice(0, 300));
        return res.status(500).json({ error: "no guardado" });
      }
    }
  }

  return res.status(200).json({ ok: true, recibidos: filas.length });
}
