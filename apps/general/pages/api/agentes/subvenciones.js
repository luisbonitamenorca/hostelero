// PORTADA de agentes-bonita a Hostelero (19-08-2026) casi literal: solo
// cambian las constantes de conexión, que ahora apuntan al Supabase de la
// casa — las tablas agent_* viven aquí y el Bearer que valida es el token de
// sesión de HOSTELERO (el mismo que el route handler /agentes inyecta en el
// panel). Vive en pages/api (router clásico) a propósito: convive con app/ y
// permite portar el (req, res) original sin reescribirlo.
// /api/subvenciones — rastreador de subvenciones y ayudas.
// GET  = cron semanal de Vercel (lunes 6:30): BDNS + enriquecimiento + barrido web.
// POST = ejecución manual desde el panel. Body: { modo: "bdns" | "web", dias?: number }
//
// Fuente principal: API REST pública de la Base de Datos Nacional de Subvenciones (BDNS).
// Toda convocatoria cuyo extracto se publica en el BOIB, el BOE o el boletín del Consell
// pasa antes por la BDNS, así que rastreamos el origen en vez de los boletines.

export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Mismo modelo que el resto de agentes del panel.
const MODEL = "claude-sonnet-4-6";

const BDNS_API = "https://www.infosubvenciones.es/bdnstrans/api/convocatorias/busqueda";
const BDNS_WEB = "https://www.infosubvenciones.es/bdnstrans/GE/es/convocatoria/";

// Órganos o textos que delatan territorio propio (Balears / Menorca / nuestros municipios).
const RE_TERR = /(BALEAR|MENORCA|MALLORCA|EIVISSA|IBIZA|FORMENTERA|\bMA[OÓ]\b|MAH[OÓ]N|SANT LLU[IÍ]S|ES MERCADAL|ES CASTELL|CIUTADELLA|ALAIOR|FERRERIES|FOGAIBA|CAIB)/i;

// Materias que nos pueden aplicar (se usa para cribar el ruido estatal antes de gastar tokens).
const RE_TEMA = /(vi[nñ]|vitiv|viticult|bodega|uva|enotur|agrari|agr[ií]col|agroaliment|aliment|rural|hosteler|restaura|turism|comerci|export|internacionaliz|promoci[oó]n|digitaliz|tecnolog|innovaci|i\+d|intelig|energ|eficien|renovab|fotovolt|autoconsum|sostenib|ambient|residu|circular|calidad|certificac|formaci[oó]n|emple|contrataci|pyme|emprend|invers|modernizaci|maquinaria|equipamiento|relevo generacional)/i;

function sbHeaders(key) {
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
}

function ddmmyyyy(d) {
  const p = n => String(n).padStart(2, "0");
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
}

function hoyISO() { return new Date().toISOString().slice(0, 10); }

function textOf(data) {
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

function parseArray(txt) {
  const s = txt.indexOf("["), e = txt.lastIndexOf("]");
  if (s < 0 || e < 0 || e < s) return [];
  try { return JSON.parse(txt.slice(s, e + 1)); } catch (_) { return []; }
}

function fechaValida(v) {
  return (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null;
}

async function claude(apiKey, body) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || "Error de la API de Claude");
  return d;
}

function acumular(usage, data) {
  const u = data.usage || {};
  usage.in += u.input_tokens || 0;
  usage.out += u.output_tokens || 0;
  usage.searches += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
}

// ---------- Paso 1: barrido de la BDNS ----------
async function barridoBDNS(dias) {
  const hasta = new Date();
  const desde = new Date(Date.now() - dias * 864e5);
  const out = [];
  const t0 = Date.now();
  for (let page = 0; page < 40; page++) {
    if (Date.now() - t0 > 90000) break;
    const url = BDNS_API +
      "?fechaDesde=" + encodeURIComponent(ddmmyyyy(desde)) +
      "&fechaHasta=" + encodeURIComponent(ddmmyyyy(hasta)) +
      "&pageSize=200&page=" + page;
    let d;
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) break;
      d = await r.json();
    } catch (_) { break; }
    const items = d.content || [];
    if (!items.length) break;
    out.push(...items);
    if (d.last === true) break;
  }
  return out;
}

function ambitoDe(nivel1) {
  const n = (nivel1 || "").toUpperCase();
  if (n.includes("ESTATAL")) return "estatal";
  if (n.includes("AUTON")) return "autonomica";
  if (n.includes("LOCAL")) return "local";
  return "autonomica";
}

// Nos quedamos con: todo lo balear (poco volumen, que lo juzgue el modelo)
// y lo estatal que además toque alguna de nuestras materias.
function preFiltrar(items) {
  const vistos = new Set();
  const out = [];
  for (const it of items) {
    const cod = String(it.numeroConvocatoria || it.id || "");
    if (!cod || vistos.has(cod)) continue;
    const organo = [it.nivel1, it.nivel2, it.nivel3].filter(Boolean).join(" · ");
    const desc = it.descripcion || "";
    const esBalear = RE_TERR.test(organo) || RE_TERR.test(desc);
    const esEstatal = /ESTATAL/i.test(it.nivel1 || "");
    if (esBalear || (esEstatal && RE_TEMA.test(desc + " " + organo))) {
      vistos.add(cod);
      out.push({ cod, organo, desc, ambito: ambitoDe(it.nivel1), fecha: it.fechaRecepcion || null });
    }
  }
  return out.slice(0, 350);
}

// ---------- Paso 2: cribado contra el perfil de Bonita ----------
async function cribar(apiKey, perfil, candidatas, usage) {
  const lista = candidatas.map(c =>
    "[" + c.cod + "] (" + c.ambito + " · " + c.organo + ") " + c.desc.slice(0, 260)
  ).join("\n");

  const prompt =
"Eres el rastreador de subvenciones de Bonita Menorca. Tu trabajo es que no se nos escape ninguna ayuda pública que podamos solicitar, sin inundar al equipo de convocatorias que no nos aplican.\n\n" +
"PERFIL DE LA EMPRESA:\n" + perfil + "\n\n" +
"CONVOCATORIAS REGISTRADAS ESTOS DÍAS EN LA BDNS:\n" + lista + "\n\n" +
"Devuelve SOLO un array JSON (sin texto alrededor, sin markdown) con las convocatorias que Bonita Menorca SL podría solicitar como empresa. Cada objeto:\n" +
'{"bdns":"código entre corchetes","materia":"viña y bodega|comercialización|hostelería y turismo|calidad y medioambiente|energía|innovación y digitalización|empleo y formación|otra","encaje":1-5,"razon":"en una frase, qué línea nuestra encaja y con qué inversión o gasto"}\n\n' +
"Criterios de encaje: 5 = hecha a nuestra medida, la pediríamos seguro. 4 = encaja claramente. 3 = podríamos encajar con matices. No devuelvas nada por debajo de 3.\n" +
"Descarta sin piedad: ayudas a particulares, ONG, asociaciones, fundaciones, ayuntamientos y otras administraciones, deporte, cultura, cooperación, becas, y sectores agrarios que no sean viña ni producto que podamos elaborar o vender.\n" +
"Ojo con los extractos ambiguos: si por la descripción no puedes saber si una empresa privada puede ser beneficiaria, dale encaje 3 y dilo en la razón.\n" +
"Más vale devolver 4 buenas que 30 dudosas. Si no encaja ninguna, devuelve [].";

  const data = await claude(apiKey, { model: MODEL, max_tokens: 4000, messages: [{ role: "user", content: prompt }] });
  acumular(usage, data);
  return parseArray(textOf(data));
}

// ---------- Paso 3: enriquecer las mejores con búsqueda web ----------
async function enriquecer(apiKey, filas, usage) {
  const lista = filas.map(f => "[" + f.bdns + "] " + f.titulo.slice(0, 180) + " (" + (f.organo || "") + ")").join("\n");
  const prompt =
"Eres el rastreador de subvenciones de Bonita Menorca (bodega y restauración en Menorca). Busca en la web información práctica de estas convocatorias para que el equipo decida si presentarse:\n\n" + lista + "\n\n" +
"Para cada una busca la fecha límite de solicitud, la cuantía o intensidad de la ayuda, y los requisitos principales. Fuentes preferentes: infosubvenciones.es, BOIB, caib.es, cime.es, BOE.\n\n" +
"Devuelve SOLO un array JSON (sin markdown) con un objeto por convocatoria:\n" +
'{"bdns":"código","plazo":"AAAA-MM-DD o null si no lo encuentras","importe":"texto breve o null","detalle":"5-8 líneas: quién puede pedirlo, qué financia, porcentaje o cuantía, documentación clave y si merece la pena el papeleo para una PYME como nosotros"}\n' +
"No inventes fechas ni importes: si no lo encuentras, null. Si la convocatoria ya está cerrada, dilo en el detalle.";

  const data = await claude(apiKey, {
    model: MODEL, max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
    tools: [{ type: "web_search_20250305", name: "web_search" }]
  });
  acumular(usage, data);
  return parseArray(textOf(data));
}

// ---------- Paso 4: barrido web de lo que la BDNS cubre tarde o mal ----------
async function barridoWeb(apiKey, perfil, conocidas, usage) {
  const prompt =
"Eres el rastreador de subvenciones de Bonita Menorca. Hoy es " + hoyISO() + ".\n\n" +
"PERFIL DE LA EMPRESA:\n" + perfil + "\n\n" +
"Busca en la web convocatorias de ayudas ABIERTAS o de apertura inminente que apliquen a esta empresa y que no estén en esta lista de las que ya tenemos fichadas:\n" +
(conocidas.slice(0, 60).join("\n") || "(ninguna todavía)") + "\n\n" +
"Rastrea especialmente: FOGAIBA y Conselleria d'Agricultura del Govern Balear, ayudas de la CAIB a empresa, industria, comercio y turismo, el Consell Insular de Menorca, el Impost de Turisme Sostenible, la OCM del vino del MAPA (promoción en terceros países, inversiones, reestructuración de viñedo), ICEX, ayudas estatales a digitalización e inteligencia artificial, eficiencia energética del IDAE, y fondos europeos accesibles a PYME agroalimentaria y hostelera.\n\n" +
"Devuelve SOLO un array JSON (sin markdown), máximo 8 objetos, solo convocatorias reales y verificadas con su fuente:\n" +
'{"titulo":"...","organo":"quién convoca","ambito":"local|autonomica|estatal|europea","materia":"...","encaje":3-5,"razon":"por qué nos encaja","importe":"texto o null","plazo":"AAAA-MM-DD o null","url":"enlace a la convocatoria"}\n' +
"No inventes nada. Si no encuentras convocatorias abiertas nuevas, devuelve []. El silencio es una respuesta válida y preferible al ruido.";

  const data = await claude(apiKey, {
    model: MODEL, max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
    tools: [{ type: "web_search_20250305", name: "web_search" }]
  });
  acumular(usage, data);
  return parseArray(textOf(data));
}

// ============================================================
export default async function handler(req, res) {
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!SERVICE_KEY) return res.status(500).json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en Vercel" });
  if (!API_KEY) return res.status(500).json({ error: "Falta ANTHROPIC_API_KEY en Vercel" });

  let modo = "todo", dias = 10;

  if (req.method === "GET") {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== "Bearer " + secret)
      return res.status(401).json({ error: "No autorizado" });
  } else if (req.method === "POST") {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Sin sesión" });
    const userRes = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token }
    });
    if (!userRes.ok) return res.status(401).json({ error: "Sesión no válida" });
    const body = req.body || {};
    modo = body.modo === "web" ? "web" : "bdns";
    dias = Math.min(Math.max(parseInt(body.dias, 10) || 10, 1), 60);
  } else {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const usage = { in: 0, out: 0, searches: 0 };
  let nuevas = 0, enriquecidas = 0, viaWeb = 0, revisadas = 0;

  try {
    // Perfil de elegibilidad
    const pr = await fetch(SUPABASE_URL + "/rest/v1/agent_grant_profile?id=eq.1&select=perfil", { headers: sbHeaders(SERVICE_KEY) });
    const prJson = await pr.json();
    const perfil = (prJson[0] && prJson[0].perfil) || "Bodega y restauración en Menorca.";

    // Lo que ya tenemos fichado
    const ex = await fetch(SUPABASE_URL + "/rest/v1/agent_grants?select=bdns,titulo&limit=5000", { headers: sbHeaders(SERVICE_KEY) });
    const exJson = await ex.json();
    const codigosConocidos = new Set(exJson.filter(x => x.bdns).map(x => String(x.bdns)));
    const titulosConocidos = exJson.map(x => (x.titulo || "").toLowerCase().trim());

    // ---- BDNS ----
    if (modo !== "web") {
      const crudas = await barridoBDNS(dias);
      revisadas = crudas.length;
      const candidatas = preFiltrar(crudas).filter(c => !codigosConocidos.has(c.cod));

      if (candidatas.length) {
        const veredictos = await cribar(API_KEY, perfil, candidatas, usage);
        const insertadas = [];

        for (const v of veredictos) {
          const cod = String(v.bdns || "").trim();
          const base = candidatas.find(c => c.cod === cod);
          if (!base || !v.encaje || v.encaje < 3) continue;
          if (codigosConocidos.has(cod)) continue;

          const fila = {
            fuente: "BDNS",
            bdns: cod,
            titulo: base.desc.slice(0, 400),
            organo: base.organo.slice(0, 200),
            ambito: base.ambito,
            materia: String(v.materia || "otra").slice(0, 60),
            encaje: Math.min(Math.max(parseInt(v.encaje, 10), 1), 5),
            razon: String(v.razon || "").slice(0, 600),
            fecha_pub: base.fecha,
            url: BDNS_WEB + cod,
            estado: "nueva"
          };
          const ins = await fetch(SUPABASE_URL + "/rest/v1/agent_grants", {
            method: "POST",
            headers: Object.assign({ Prefer: "return=representation" }, sbHeaders(SERVICE_KEY)),
            body: JSON.stringify(fila)
          });
          if (ins.ok) {
            nuevas++;
            codigosConocidos.add(cod);
            const row = await ins.json();
            if (fila.encaje >= 4 && row[0]) insertadas.push({ bdns: cod, titulo: fila.titulo, organo: fila.organo });
          }
        }

        // Enriquecimiento con búsqueda web de las más prometedoras
        if (insertadas.length) {
          try {
            const fichas = await enriquecer(API_KEY, insertadas.slice(0, 6), usage);
            for (const f of fichas) {
              const cod = String(f.bdns || "").trim();
              if (!cod) continue;
              const patch = {
                plazo: fechaValida(f.plazo),
                importe: f.importe ? String(f.importe).slice(0, 200) : null,
                detalle: f.detalle ? String(f.detalle).slice(0, 3000) : null,
                updated_at: new Date().toISOString()
              };
              const up = await fetch(SUPABASE_URL + "/rest/v1/agent_grants?bdns=eq." + encodeURIComponent(cod), {
                method: "PATCH", headers: sbHeaders(SERVICE_KEY), body: JSON.stringify(patch)
              });
              if (up.ok) enriquecidas++;
            }
          } catch (e) { console.error("Enriquecimiento fallido:", e.message); }
        }
      }
    }

    // ---- Barrido web (fuentes que la BDNS cubre tarde o mal) ----
    if (modo === "web" || modo === "todo") {
      try {
        const hallazgos = await barridoWeb(API_KEY, perfil, titulosConocidos, usage);
        for (const h of hallazgos) {
          if (!h.titulo || !h.encaje || h.encaje < 3) continue;
          const t = String(h.titulo).toLowerCase().trim();
          if (titulosConocidos.some(x => x && (x.includes(t.slice(0, 40)) || t.includes(x.slice(0, 40))))) continue;
          const amb = ["local", "autonomica", "estatal", "europea"].includes(h.ambito) ? h.ambito : "autonomica";
          const ins = await fetch(SUPABASE_URL + "/rest/v1/agent_grants", {
            method: "POST", headers: sbHeaders(SERVICE_KEY),
            body: JSON.stringify({
              fuente: "web", bdns: null,
              titulo: String(h.titulo).slice(0, 400),
              organo: h.organo ? String(h.organo).slice(0, 200) : null,
              ambito: amb,
              materia: String(h.materia || "otra").slice(0, 60),
              encaje: Math.min(Math.max(parseInt(h.encaje, 10), 1), 5),
              razon: String(h.razon || "").slice(0, 600),
              importe: h.importe ? String(h.importe).slice(0, 200) : null,
              plazo: fechaValida(h.plazo),
              url: h.url || null,
              estado: "nueva"
            })
          });
          if (ins.ok) { viaWeb++; nuevas++; titulosConocidos.push(t); }
        }
      } catch (e) { console.error("Barrido web fallido:", e.message); }
    }

    // ---- Caducar lo que se nos ha pasado ----
    await fetch(SUPABASE_URL + "/rest/v1/agent_grants?plazo=lt." + hoyISO() + "&estado=in.(nueva,interesa)", {
      method: "PATCH", headers: sbHeaders(SERVICE_KEY),
      body: JSON.stringify({ estado: "caducada", updated_at: new Date().toISOString() })
    });

    // ---- Registro del run ----
    const cost = usage.in * 3 / 1e6 + usage.out * 15 / 1e6 + usage.searches * 0.01;
    await fetch(SUPABASE_URL + "/rest/v1/agent_runs", {
      method: "POST", headers: sbHeaders(SERVICE_KEY),
      body: JSON.stringify({
        agent: "Rastreador subvenciones", items: nuevas,
        tokens_in: usage.in, tokens_out: usage.out, cost: cost
      })
    });

    return res.status(200).json({ revisadas, nuevas, enriquecidas, viaWeb });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Fallo en el rastreo. Reintenta." });
  }
}
