// lib/compras/ocr-servidor.js · OCR de la bandeja de correo EN EL SERVIDOR
// ============================================================================
// Hasta el 22-10-2026 el OCR de los adjuntos que deja la ingesta IMAP
// (compras_correo_adjunto en PENDIENTE) lo hacía SOLO el navegador: la función
// procesarCola() de datos/compras.html, cuando alguien tenía abierta la pantalla
// de Compras. Resultado: una factura enviada a facturas@ por la tarde o el fin de
// semana esperaba 12-39 h hasta la mañana siguiente, y Lucía lo percibía como
// «no es automático, aparece al día siguiente».
//
// Este módulo es el MISMO pipeline, portado a Node, para que lo ejecute un cron
// (pages/api/compras/procesar-cola.js). Reglas de la casa:
//
//  · Las funciones de negocio (normalizadores, huella de duplicado, validación
//    de CIF, casado de proveedor, prompt de OCR, autocorrección del cuadro de
//    IVA, renting por contratos, reparto de IVA, fusión de folios, líneas) están
//    COPIADAS LITERALMENTE de compras.html (los bloques A-G de abajo indican de
//    qué líneas). Si se toca una regla en el navegador hay que tocarla aquí, y al
//    revés. Los únicos cambios son: reciben `ctx` (maestros de la cuenta) en vez
//    de leer variables globales de la página, y los INSERT llevan cuenta_id.
//  · procesarUno() es una transcripción paso a paso de la del navegador: mismo
//    orden, mismos descartes, mismos textos de cierre del adjunto. Donde el
//    navegador hacía toast() aquí se apunta en el resumen.
//  · El reclamo es el mismo PATCH atómico (estado=eq.PENDIENTE → PROCESANDO)
//    que usa el navegador, así que navegador y servidor pueden trabajar a la vez
//    sin procesar dos veces la misma fila: el que llega segundo recibe la
//    respuesta vacía y pasa al siguiente.
//  · Se escribe con la service key (bypass de RLS), así que todo lo que el
//    navegador obtenía «gratis» de la RLS (ver solo su cuenta) aquí se filtra a
//    mano con cuenta_id=eq. y se escribe cuenta_id en cada INSERT.
//  · pdf-lib parte los PDF con varias facturas (igual que el navegador);
//    pdfjs-dist (build legacy, sin worker) lee el texto para detectar el
//    «ALB.-POST-FAC.» de Coca-Cola, que en el navegador hacía pdf.js; sharp
//    (ya instalado por Next) comprime las fotos como hacía el <canvas>.
// ============================================================================
import { PDFDocument } from "pdf-lib";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "documentos";

// Mismos modelos que el navegador (callAI y la escalada de procesarUno).
const MODELO_OCR = "claude-sonnet-4-6";
const MODELO_ESCALADA = "claude-opus-5";
const MAX_TOKENS = 16384;
// Una llamada al modelo no puede colgar la función entera: se aborta a los 150 s.
const TIMEOUT_IA_MS = 150000;
// Hueco entre documentos. En el navegador son 4 s (gapOCR) para no pisar el
// límite de peticiones; aquí la pasada es corta y vigilada por las cabeceras de
// cuota, así que basta con 1,5 s.
const GAP_MS = 1500;

/* ---------------------------------------------------------------- Supabase */

async function sb(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Supabase ${r.status}: ${t.slice(0, 300)}`);
  }
  const txt = await r.text();
  return txt ? JSON.parse(txt) : [];
}

// Todas las filas, de mil en mil (PostgREST corta en 1.000 sin avisar).
async function sbAll(path, tam = 1000) {
  const filas = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let i = 0; i < 100; i++) {
    const lote = await sb(`${path}${sep}limit=${tam}&offset=${i * tam}`);
    filas.push(...lote);
    if (lote.length < tam) break;
  }
  return filas;
}

// Sube un fichero al bucket público y devuelve su URL, con el mismo patrón de
// nombre que sbUpload() del navegador (timestamp_aleatorio.ext).
async function sbUpload(buffer, nombre, mime) {
  const ext = (String(nombre || "").split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": mime || "application/octet-stream" },
    body: buffer,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Storage ${r.status}: ${t.slice(0, 200)}`);
  }
  return `${SB_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

// Descarga un adjunto del bucket. Primero por su URL pública; si falla (bucket
// privado algún día, URL vieja), por la API de storage con la service key.
async function descargarAdjunto(a) {
  if (a.url) {
    const r = await fetch(a.url);
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (!a.storage_path) throw new Error("descarga " + r.status);
  }
  if (!a.storage_path) throw new Error("el adjunto no tiene URL ni ruta en el bucket");
  const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${a.storage_path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error("descarga " + r.status);
  return Buffer.from(await r.arrayBuffer());
}

// PDF con basura delante de "%PDF-" (cabeceras HTTP de Holded, marca BOM…): la
// API de lectura los rechaza. Se corta lo anterior si aparece en los primeros 4 KB.
// Réplica de limpiarPdfBlob() del navegador.
function limpiarPdf(buffer) {
  const i = buffer.subarray(0, 4096).indexOf("%PDF-");
  return i > 0 ? buffer.subarray(i) : buffer;
}

// Fotos: lado mayor a 2.000 px y JPEG al 0,82, como comprimirImagen() del
// navegador. sharp lo instala Next; si no estuviera, se manda la foto tal cual.
async function comprimirImagen(buffer, nombre) {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(buffer)
      .rotate()
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { buffer: out, mime: "image/jpeg", nombre: (String(nombre || "foto").replace(/\.\w+$/, "") || "foto") + ".jpg" };
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------- IA */

// Última foto de la cuota que nos queda, leída de las cabeceras de la API.
const _cuota = { peticiones: null, tokensEntrada: null, reinicio: null, visto: 0 };

// Misma petición que hace el navegador a través del proxy /api/compras/anthropic,
// pero directa: la clave vive en el servidor. Devuelve el texto de la respuesta.
async function callAI(content, modelo) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Falta ANTHROPIC_API_KEY en las variables de entorno");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_IA_MS);
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: modelo || MODELO_OCR, max_tokens: MAX_TOKENS, messages: [{ role: "user", content }] }),
    });
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("timeout: la IA no respondió en " + TIMEOUT_IA_MS / 1000 + " s");
    throw new Error("failed to fetch: " + (e.message || e));
  } finally {
    clearTimeout(t);
  }
  try {
    const pet = r.headers.get("anthropic-ratelimit-requests-remaining");
    const tin = r.headers.get("anthropic-ratelimit-input-tokens-remaining");
    const res = r.headers.get("anthropic-ratelimit-input-tokens-reset") || r.headers.get("anthropic-ratelimit-requests-reset");
    if (pet !== null || tin !== null) {
      _cuota.peticiones = pet === null ? null : Number(pet);
      _cuota.tokensEntrada = tin === null ? null : Number(tin);
      _cuota.reinicio = res || null;
      _cuota.visto = Date.now();
    }
  } catch (e) { /* sin cabeceras seguimos con el ritmo fijo */ }
  const txt = await r.text();
  let data;
  try { data = JSON.parse(txt); }
  catch (e) { throw new Error(`Respuesta no válida (HTTP ${r.status}). ${txt.slice(0, 120)}`); }
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 120)}`);
  // Si la respuesta se cortó por longitud, el JSON llega a medias. Hay que
  // saberlo aquí: una factura truncada NO es "no es una factura".
  if (data.stop_reason === "max_tokens") {
    throw new Error("JSON_TRUNCADO: la respuesta se cortó por longitud (documento con muchas líneas)");
  }
  // Contador de IA (módulo compras), igual que el navegador. Nunca frena el OCR.
  try {
    const u = data.usage || {}, tin = u.input_tokens || 0, tout = u.output_tokens || 0;
    const m = (modelo || "").toLowerCase();
    const [pin, pout] = m.includes("opus") ? [5, 25] : [3, 15];
    const coste = (tin * pin + tout * pout) / 1e6;
    if (tin || tout) sb("rpc/ia_registrar", { method: "POST", body: JSON.stringify({
      p_modulo: "compras", p_proceso: "OCR documento", p_modelo: modelo || MODELO_OCR,
      p_tin: tin, p_tout: tout, p_coste: coste, p_nota: "servidor" }) }).catch(() => {});
  } catch (e) { /* el contador nunca frena el OCR */ }
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

// Cuánto esperar antes de la siguiente llamada, según la cuota que la API dice
// que queda (réplica de esperaSegunCuota del navegador).
function esperaSegunCuota(gapBase) {
  const c = _cuota;
  if (!c.visto || Date.now() - c.visto > 120000) return gapBase;
  const pocasPeticiones = c.peticiones !== null && c.peticiones <= 2;
  const pocosTokens = c.tokensEntrada !== null && c.tokensEntrada <= 6000;
  if (pocasPeticiones || pocosTokens) {
    let hasta = 0;
    if (c.reinicio) { const t = Date.parse(c.reinicio); if (!isNaN(t)) hasta = t - Date.now(); }
    return Math.min(60000, Math.max(gapBase, hasta > 0 ? hasta + 1000 : 15000));
  }
  return gapBase;
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function fmt(n) { if (n == null || n === "") return ""; return Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €"; }
function fmtF(f) { const s = String(f || "").slice(0, 10); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : s; }

/* ======================================================================
   BLOQUES COPIADOS LITERALMENTE DE datos/compras.html (ver cabecera)
   ====================================================================== */
/* ===== A: normalizadores de NIF/nombre propio y centros (compras.html 702-771) ===== */
// NIF de la propia empresa. NUNCA puede ser el proveedor de un documento: si
// aparece ahí es que el modelo ha cogido el NIF del cliente. Los sufijos -01 y
// -02 sí son proveedores internos legítimos (Bodega y Producción) y se respetan.
const NIF_PROPIO = 'B01996826';
function norm_nif_js(t){
  if(!t||!String(t).trim())return null;
  return String(t).toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^ES(?=[A-Z0-9]{9})/,'').slice(0,9)||null;
}
function esNifPropioSinSufijo(nif){
  const k=String(nif||'').toUpperCase().replace(/[^A-Z0-9-]/g,'');
  return k===NIF_PROPIO;
}
function nombreEsPropio(t){
  return String(t||'').toUpperCase().replace(/[^A-Z0-9]/g,'').includes('BONITAMENORCA');
}
function limpiarProveedorPropio(nombre){
  let n=String(nombre||'');
  // fuera los paréntesis cuyo contenido es nuestro propio nombre
  n=n.replace(/\(([^)]*)\)/g,function(m,dentro){return nombreEsPropio(dentro)?'':m;})
     .replace(/\s{2,}/g,' ').trim();
  if(!n||nombreEsPropio(n))return '';
  return n;
}
const CENTROS = ["ESTRUCTURA","BINIFADET BODEGA","BINIFADET RESTAURANTE","BINIFADET TIENDA","TAMARINDOS RESTAURANTE","TAMARINDOS BAR","CASA TIRANT","COCINA PRODUCCION"];
// Nomenclatura antigua -> nueva. Los proveedores están pasando a rotular los
// documentos con los nombres de A3, pero no todos a la vez, así que durante la
// transición hay que seguir entendiendo los nombres cortos. Debe coincidir con
// la función canal_canonico() de Postgres.
const CENTROS_ALIAS = {
  'BODEGA':'BINIFADET BODEGA',
  'BINIFADET':'BINIFADET RESTAURANTE',
  'TIENDA':'BINIFADET TIENDA',
  'TAMARINDOS':'TAMARINDOS RESTAURANTE',
  'TIRANT':'CASA TIRANT',
  'PRODUCCION':'COCINA PRODUCCION',
  'PRODUCCIÓN':'COCINA PRODUCCION',
  'BINIFADET COCINA':'COCINA PRODUCCION',
  'COCINA':'COCINA PRODUCCION'
};
// Busca un centro DENTRO de un texto libre ("Alquiler Datafono RTE TAMARINDOS").
// canalCanonico exige coincidencia exacta; esto no. El orden de las reglas
// importa: lo más específico primero, porque "BINIFADET TIENDA" contiene
// "BINIFADET" y se iría al restaurante si preguntáramos por él antes.
const REGLAS_CENTRO = [
  [/COCINA|PRODUCCION/, 'COCINA PRODUCCION'],
  [/TIENDA/,            'BINIFADET TIENDA'],
  [/BODEGA/,            'BINIFADET BODEGA'],
  [/TIRANT/,            'CASA TIRANT'],
  [/TAMARINDOS.*\bBAR\b|\bBAR\b.*TAMARINDOS/, 'TAMARINDOS BAR'],
  [/TAMARINDOS/,        'TAMARINDOS RESTAURANTE'],
  [/BINIFADET/,         'BINIFADET RESTAURANTE'],
  [/CENTRAL|ESTRUCTURA|OFICINA/, 'ESTRUCTURA'],
];
function centroDesdeTexto(txt){
  if(!txt)return null;
  const t=String(txt).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const exacto=canalCanonico(t);
  if(exacto)return exacto;
  for(const [re,centro] of REGLAS_CENTRO) if(re.test(t))return centro;
  return null;
}
// Devuelve el nombre canónico del centro, o null si no se reconoce.
// Nunca inventa: si no está en la lista ni en los alias, devuelve null para que
// el documento salga marcado sin centro en vez de caer en uno equivocado.
function canalCanonico(v){
  if(!v)return null;
  const k=String(v).trim().toUpperCase();
  if(CENTROS.includes(k))return k;
  return CENTROS_ALIAS[k]||null;
}

/* ===== B: huella de duplicado, CIF, nombre normalizado, casado de proveedor (1034-1113) ===== */
function normNif(s){return s?String(s).toUpperCase().replace(/[^A-Z0-9]/g,''):'';}
// huella de duplicado: nº documento (solo letras/números) + fecha (YYYY-MM-DD) + importe (2 decimales).
// Devuelve null si falta el nº o el importe (sin ellos no podemos afirmar que sea duplicado).
function firmaDup(numDoc,fecha,total){
  // Sin ceros a la izquierda (30-09-2026): el correo trae «0073613» y la carga
  // de A3 «73613» (Gelmarfred, Grenke «0000384837/2026»…) y la huella no casaba.
  const n=String(numDoc||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^0+(?=.)/,'');
  const t=(total!=null&&!isNaN(num(total)))?num(total).toFixed(2):'';
  const f=(fecha||'').slice(0,10);
  if(!n||!t)return null;
  return n+'|'+f+'|'+t;
}
// Replica exacta de norm_nom() en Postgres. ORDEN CRITICO: primero se quitan
// puntos y apostrofos, LUEGO el resto de puntuacion, y solo entonces las formas
// societarias. Al reves, "S.L." con puntos nunca casaba con \bSL\b y sobrevivia
// como "S L": por eso "PEIXOS EMILIO, S.L." no reconocia a "PEIXOS EMILIO" y se
// creaba una ficha nueva. De ahi salieron casi todos los proveedores duplicados.
/* ========== VALIDACION DE CIF ==========
   El CIF español lleva dígito de control. Los CIF que el OCR lee mal fallan el
   checksum: hoy han aparecido B01996326 (Illa Fruits), B07010134 (Hijos de
   Ramón Oliver) y dos variantes de JJ Carreras, y los cuatro son inválidos
   mientras los once correctos pasan. Verificar aquí evita crear la ficha
   envenenada, que es mucho mejor que detectarla y fusionarla después.
   Réplica exacta de cif_valido() en Postgres. Devuelve null cuando NO se puede
   juzgar (NIF de persona física o NIE, que usan otro algoritmo): null significa
   "no lo sé", nunca "está mal".                                              */
function cifValido(cif){
  if(cif==null||!String(cif).trim())return null;
  let c=String(cif).trim().toUpperCase();
  // sub-CIF interno (B01996826-01): se juzga la matriz
  if(/^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]-[0-9]+$/.test(c))c=c.split('-')[0];
  c=c.replace(/[^A-Z0-9]/g,'');
  // prefijo ES de IVA intracomunitario
  if(/^ES[A-Z0-9]{9}$/.test(c))c=c.slice(2);
  // VAT de otro pais: no se juzga
  if(/^[A-Z]{2}[0-9]/.test(c)&&!/^ES/.test(c))return null;
  // persona fisica (NIF o NIE): otro algoritmo
  if(/^[0-9]{8}[A-Z]$/.test(c)||/^[XYZ][0-9]{7}[A-Z]$/.test(c))return null;
  if(!/^[ABCDEFGHJNPQRSUVW][0-9]{7}[0-9A-J]$/.test(c))return false;
  const d=c.slice(1,8);
  let suma=0;
  for(let i=0;i<7;i++){
    const n=Number(d[i]);
    if(i%2===0){const x=n*2;suma+=Math.floor(x/10)+(x%10);}
    else suma+=n;
  }
  const ctrl=(10-(suma%10))%10;
  const letra='JABCDEFGHI'[ctrl];
  const dado=c[8];
  return dado===String(ctrl)||dado===letra;
}

function normName(s){
  if(!s)return '';
  s=String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  s=s.replace(/[.\u00B7'\u2019]/g,'');
  s=s.replace(/[^A-Z0-9 ]/g,' ');
  s=s.replace(/\b(SLU|SLNE|SRM|SCP|SAU|SCA|SL|SA|SC|UTE|AIE|LTD|SOCIEDAD|LIMITADA)\b/g,' ');
  return s.replace(/\s+/g,' ').trim();
}
// Clave compacta, sin espacios: hace equivalentes "MENORCA FRUIT" y "MENORCAFRUIT".
// No fusiona nada por si sola; solo se usa para reconocer al crear.
function claveProv(s){return normName(s).replace(/ /g,'');}
// busca un proveedor existente que case por CIF (norm) y si no por nombre (norm)
function matchProveedor(nif,nombre,ctx){
  const nn=normNif(nif), na=normName(nombre);
  if(nn){const x=ctx.proveedores.find(p=>p.nif&&normNif(p.nif)===nn);if(x)return x;}
  if(na){const x=ctx.proveedores.find(p=>normName(p.nombre)===na);if(x)return x;}
  // clave compacta: recupera los casos que solo se diferencian en espacios
  const kc=claveProv(nombre);
  if(kc){const x=ctx.proveedores.find(p=>claveProv(p.nombre)===kc);if(x)return x;}
  // casar por alias / nombre comercial (ej: "CATCHOT" -> Distribuciones Catchot SL)
  if(na){
    const x=ctx.proveedores.find(p=>{
      if(!p.alias)return false;
      return p.alias.split(/[,;\n]/).map(a=>normName(a)).filter(Boolean).some(a=>a&&(na.includes(a)||a.includes(na)));
    });
    if(x)return x;
  }
  return null;
}

/* ===== C: fallos transitorios (1304-1320) ===== */
function esRecuperablePorUrl(msg){
  const m=String(msg||'').toLowerCase();
  return m.includes('payload_too_large')||m.includes('413')||m.includes('entity too large')
      || m.includes('via url')||m.includes('vía url');   // marca puesta a mano al reencolar
}
function esFalloTransitorio(msg){
  if(esRecuperablePorUrl(msg))return true;
  if(/JSON_TRUNCADO|JSON_ROTO/.test(String(msg||'')))return true;
  const m=String(msg||'').toLowerCase();
  return m.includes('credit balance')      // saldo de API agotado
      || m.includes('rate_limit')||m.includes('rate limit')
      || m.includes('overloaded')||m.includes('529')
      || m.includes('too many requests')||m.includes('429')
      || m.includes('timeout')||m.includes('timed out')
      || m.includes('failed to fetch')||m.includes('networkerror')
      || m.includes('502')||m.includes('503')||m.includes('504');
}

/* ===== D: JSON del modelo y cuadre de factura (1477-1538) ===== */
function extraerJson(txt){
  const limpio=String(txt||'').replace(/```json/gi,'').replace(/```/g,'');
  const ini=limpio.indexOf('{');
  if(ini<0)return null;
  let prof=0,enStr=false,esc=false;
  for(let i=ini;i<limpio.length;i++){
    const ch=limpio[i];
    if(esc){esc=false;continue;}
    if(ch==='\\'){if(enStr)esc=true;continue;}
    if(ch==='"'){enStr=!enStr;continue;}
    if(enStr)continue;
    if(ch==='{')prof++;
    else if(ch==='}'){prof--;if(prof===0)return limpio.slice(ini,i+1);}
  }
  return null; // objeto sin cerrar: respuesta truncada
}
// Arreglos de lo que el modelo estropea a menudo y no cambia el significado.
function repararJson(j){
  return j.replace(/,\s*([}\]])/g,'$1');   // comas colgando antes de } o ]
}
// Comprueba la coherencia interna de una factura. Devuelve {ok, motivo}.
// Tolerancia de 2 céntimos: los proveedores redondean línea a línea y exigir
// exactitud absoluta marcaría media base como incorrecta.
function cuadreFactura(base,iva,retencion,total,desglose){
  const T=0.02;
  if(base==null||total==null)return {ok:true};        // sin datos no se juzga
  const calc=base+(iva||0)-(retencion||0);
  if(Math.abs(calc-total)>T)
    return {ok:false,motivo:`base ${base} + IVA ${iva||0} - retención ${retencion||0} = ${calc.toFixed(2)}, pero el total es ${total}`};
  if(Array.isArray(desglose)&&desglose.length){
    const sb=desglose.reduce((a,x)=>a+(num(x.base)||0),0);
    const sc=desglose.reduce((a,x)=>a+(num(x.cuota)||0),0);
    if(Math.abs(sb-base)>T)
      return {ok:false,motivo:`el desglose suma ${sb.toFixed(2)} de base y la base declarada es ${base}`};
    if(iva!=null&&Math.abs(sc-iva)>T)
      return {ok:false,motivo:`el desglose suma ${sc.toFixed(2)} de cuota y el IVA declarado es ${iva}`};
  }
  return {ok:true};
}
function parseJson(txt){
  const bruto=extraerJson(txt);
  if(bruto===null){
    // Dos fallos MUY distintos que antes trataba igual:
    //  · hay una llave abierta que nunca cierra -> la respuesta se cortó y esto
    //    SÍ era un documento válido: nunca se puede descartar.
    //  · no hay ninguna llave -> el modelo contestó en prosa, normalmente para
    //    decir que no es una factura: ahí el descarte sí tiene sentido.
    const hayLlave=String(txt||'').includes('{');
    const etiqueta=hayLlave?'JSON_TRUNCADO':'SIN_JSON';
    throw new Error(etiqueta+': '+(hayLlave?'la respuesta se cortó a medias':'el modelo no devolvió JSON')
      +' \u00b7 '+String(txt||'').trim().slice(0,200));
  }
  try{return JSON.parse(bruto);}
  catch(e){
    try{return JSON.parse(repararJson(bruto));}
    // Mal formado pero con llaves: el modelo SÍ intentó describir un documento.
    // Descartarlo sería tirar una factura buena, así que se trata como error
    // reintentable, no como "esto no era una factura".
    catch(e2){throw new Error('JSON_ROTO: JSON mal formado ('+e2.message+') \u00b7 '+bruto.slice(0,200));}
  }
}


/* ===== E: evaluación de la lectura, escalada y PROMPT (1742-1921) ===== */
// ¿La lectura cuadra por sí sola? null = cuadra; texto = qué falla. Se usa
// para decidir la ESCALADA: una segunda pasada con un modelo superior antes
// de dar el documento por malo. Reutiliza los cuadres de la app.
function lecturaEvaluable(d,docTipo){
  // Una fecha de un año pasado casi siempre es el año mal leído por el OCR
  // (2025/2024 en vez de 2026): se escala a Opus. El margen de 60 días evita
  // falsos avisos en enero con documentos legítimos de diciembre.
  const f=Date.parse(String(d.fecha||''));
  if(!isNaN(f)&&new Date(f).getFullYear()<new Date().getFullYear()&&(Date.now()-f)>60*24*3600*1000)
    return 'la fecha leída ('+d.fecha+') es de un año anterior: probable error de lectura del año';
  if(docTipo==='factura'){
    const total=num(d.total);
    if(total==null) return 'falta el total';
    autocorregirDesglose(d); // los arreglos baratos primero: no escalar en vano
    const c=cuadreFactura(num(d.base),num(d.iva),Math.abs(num(d.retencion)||0),total,d.desglose_iva);
    return c.ok?null:(c.motivo||'los importes no cuadran');
  }
  if(!(d.lineas||[]).length) return 'no se han leído líneas';
  const suma=(d.lineas||[]).reduce((s,l)=>s+(num(l.importe)||0),0);
  const desc=num(d.descuento)||0;
  const c=cuadreAlbaranes(suma-desc,num(d.base),num(d.total));
  return c.ok===true?null:'la suma de líneas ('+suma.toFixed(2)+') no cuadra con la base/total del pie';
}

const AVISO_ESCALADA="\n\nSEGUNDA PASADA CON MÁXIMA ATENCIÓN: una lectura anterior de este documento no cuadró (%%). Revisa con especial cuidado los DESCUENTOS — por línea y los GLOBALES del pie (rappels, dto. fijo, pronto pago) —, recargos, portes y el desglose de IVA del pie. Si el pie tiene varias filas de IVA, la base del documento es la SUMA de todas. Extrae los importes exactamente como aparecen impresos.";

function construirPromptOCR(t,esCorreo,ctx){
  const reglasTxt=ctx.reglas.length?ctx.reglas.map(r=>'- '+r.texto).join('\n'):'(todavía sin reglas)';
  const conPautas=ctx.proveedores.filter(p=>p.pautas&&p.pautas.trim());
  const pautasTxt=conPautas.length
    ? conPautas.map(p=>`- ${p.nombre}${p.nif?' (CIF '+p.nif+')':''}: ${p.pautas}`).join('\n')
    : '(sin pautas específicas)';
  const conPautaFac=ctx.proveedores.filter(p=>p.pauta_factura&&p.pauta_factura.trim());
  const pautaFacTxt=conPautaFac.length
    ? conPautaFac.map(p=>`- ${p.nombre}${p.nif?' (CIF '+p.nif+')':''}: ${p.pauta_factura}`).join('\n')
    : '(sin pautas de factura específicas)';
  const conDepto=ctx.proveedores.filter(p=>p.departamento&&p.departamento.trim());
  const deptoTxt=conDepto.length
    ? conDepto.map(p=>`- ${p.nombre}${p.nif?' (CIF '+p.nif+')':''} → ${p.departamento}`).join('\n')
    : '(ningún proveedor tiene departamento fijo)';
  const conAlias=ctx.proveedores.filter(p=>p.alias&&p.alias.trim());
  const aliasTxt=conAlias.length
    ? conAlias.map(p=>`- Si ves "${p.alias}" (logo o nombre comercial) → es ${p.nombre}${p.nif?', CIF '+p.nif:''}.`).join('\n')
    : '(sin alias registrados)';
  const comun=`Eres un OCR contable para un grupo de hostelería. Extrae los datos del documento adjunto.

CENTROS DE COSTE válidos (canal), devuélvelos EXACTAMENTE así: ${CENTROS.join(', ')}.

Los proveedores están rotulando los documentos con esos nombres, así que normalmente lo verás escrito tal cual. Dos avisos:
- CUIDADO con los que comparten prefijo. "BINIFADET" a secas puede ser la bodega, el restaurante o la tienda; "TAMARINDOS" a secas puede ser el restaurante o el bar. Si solo ves el nombre corto, decide por el contenido del documento (qué se compra y a quién): vino a granel o material de bodega apunta a BINIFADET BODEGA, corcho y embalaje también; producto de tienda a BINIFADET TIENDA; comida y bebida de servicio al restaurante correspondiente. Si no hay pista suficiente, devuelve canal:null. NO adivines: un centro equivocado ensucia el coste analítico y cuesta más de corregir que un hueco.
- Nomenclatura antigua que algunos seguirán usando un tiempo, tradúcela: BODEGA→BINIFADET BODEGA, TIENDA→BINIFADET TIENDA, TIRANT→CASA TIRANT, PRODUCCION→COCINA PRODUCCION.

REGLAS de clasificación que debes aplicar:
${reglasTxt}

PAUTAS POR PROVEEDOR (aplica la del proveedor que detectes en este documento, si coincide):
${pautasTxt}

EQUIVALENCIAS DE PROVEEDOR (algunos documentos llegan solo con logo o nombre comercial, sin CIF ni nombre fiscal; usa esta tabla para identificar al proveedor y rellenar su nombre fiscal y CIF correctos):
${aliasTxt}

DEPARTAMENTO HABITUAL POR PROVEEDOR (estos proveedores suministran casi siempre al mismo centro de coste; si el documento es de uno de ellos y nada en el propio documento indica otra cosa, usa ese centro en "canal"):
${deptoTxt}

Asigna "canal" SOLO si una regla, el departamento habitual del proveedor o el propio documento lo permite con seguridad. Si no estás seguro, deja canal:null.
El proveedor_nif es el CIF/NIF del proveedor que EMITE el documento (no el del cliente Bonita Menorca / Binifadet). Si el documento no muestra el CIF pero reconoces el proveedor por la tabla de equivalencias, usa el CIF de esa tabla.
"base" es la base imponible total (sin IVA). "descuento" es cualquier descuento global al pie (positivo; 0 si no hay o ya está repartido).

EL CUADRO DE IVA DEL PIE CUANDO TIENE VARIAS FILAS. Este es el error más frecuente y más caro, léelo despacio. Muchos proveedores imprimen al pie una tabla con UNA FILA POR TIPO DE IVA, y las etiquetas de columna salen UNA SOLA VEZ, arriba:
   Base Imp.     IVA %      Imp. IVA
     120,71     10,00%        12,07
     298,99      4,00%        11,96
Aquí hay DOS bases (120,71 y 298,99) y DOS cuotas (12,07 y 11,96).
- "base" es la SUMA de todas las filas de la columna de bases: 419,70. NUNCA una sola fila. Si devuelves 120,71 o 298,99 como base, está MAL.
- "iva" es la SUMA de todas las cuotas: 24,03.
- El "total" es base + iva = 443,73, y coincide con la casilla rotulada TOTAL. NUNCA cojas el total de la columna de bases: 298,99 es una base, no un total. Si el número que ibas a dar como total aparece también dentro del cuadro de IVA, es que te has equivocado de casilla.
- Comprobación obligatoria antes de responder: suma de bases + suma de cuotas = total. Si no cuadra, has leído mal alguna casilla; vuelve a mirar el cuadro antes de contestar.
- Esa misma tabla es la que va en "desglose_iva", una entrada por fila.

CANTIDAD DE LAS LÍNEAS. En las tablas de producto, la cantidad que hay que devolver es la que MULTIPLICADA POR EL PRECIO UNITARIO DA EL IMPORTE de la línea. Muchos albaranes traen dos columnas de cantidad (por ejemplo CAJAS y UND/KG, o BULTOS y UNIDADES): la buena es casi siempre la de unidades reales, no la de cajas. Antes de devolver cada línea, comprueba cantidad x precio_unit = importe con un margen de un céntimo; si no cuadra, has cogido la columna equivocada.
- Si una línea deja alguna columna EN BLANCO, no desplaces las demás para rellenar el hueco, y no cojas valores de la fila de arriba o de abajo. Es preferible devolver null en un campo que un número de otra fila.
- Las cabeceras de sección (por ejemplo "02 - REFRIGERADO", "<SECO>", "CONGELADO") no son productos: no las devuelvas como líneas.

NUESTRO NIF NO ES EL DEL PROVEEDOR. El NIF B01996826 es el de BONITA MENORCA, S.L., que es el CLIENTE en todos estos documentos. No lo devuelvas nunca como "proveedor_nif": si es el único NIF que ves, deja "proveedor_nif" en null antes que poner ese. Sí son válidos los NIF con sufijo B01996826-01 (Bodega) y B01996826-02 (Producción), que son almacenes internos que nos hacen albaranes de traspaso.

CUPS (facturas de luz). Las facturas eléctricas identifican el punto de suministro con un CUPS: 20 o 22 caracteres que empiezan por ES seguidos de 16 dígitos y una o dos letras, por ejemplo ES0031500018635001XV0F. Suele venir etiquetado como "CUPS", "Código Universal de Punto de Suministro" o "Nº de suministro". Devuélvelo en "codigo_cups" tal cual, sin espacios ni guiones. Si la factura no lo trae, pon null. Si hubiera varios CUPS en un mismo documento, devuelve el del punto que factura esa página.

CÓDIGO DE TERMINAL. Las facturas de comisiones de datáfono identifican el local con un código de comercio, que puede aparecer como "Código Cliente", "Nº de comercio", "Merchant ID" o "TID". Si lo ves, devuélvelo en "codigo_terminal" tal cual, sin inventar nada. Si no hay ninguno, pon null.

CENTRO DE COSTE DENTRO DE LA FACTURA. Algunos proveedores facturan a varios de nuestros locales en un mismo documento y marcan a cuál corresponde cada parte. Ese marcador puede ir de dos formas:
 (a) en la misma línea del concepto, o
 (b) EN UNA LÍNEA APARTE, DEBAJO de un grupo de conceptos, sin importe propio.
En el caso (b) el marcador afecta a TODAS las líneas que hay por encima desde el marcador anterior, no solo a la inmediatamente superior. Ejemplo real:
   1  Cuota AGORA Enterprise      139,00
   1  Alquiler Datafono            25,00
        RTE BINIFADET
   1  Cuota AGORA Starter Plus     62,00
   3  Alquiler Datafono            75,00
        RTE TAMARINDOS
Aquí RTE BINIFADET vale 139+25 = 164, y RTE TAMARINDOS vale 62+75 = 137. Sería un ERROR asignar solo la línea de justo encima.
Devuelve esa lectura en "reparto_centros": una entrada por marcador, con el texto del marcador TAL COMO APARECE y la SUMA de los importes de su grupo. Los importes deben sumar la base imponible. Si el documento no marca centros, devuelve [].
No confundas estos marcadores con nombres de producto: un marcador va solo en su línea y no tiene precio ni cantidad propios.

CONTRATOS DE RENTING. Las facturas de arrendamiento (CaixaBank Equipment Finance y similares) traen una cuota por CONTRATO, cada una con su número de contrato (por ejemplo "Cuota: 052/060 del contrato 6800-72-0107200-33") y sus importes de ALQUILER Y SERVICIOS y de SEGURO. Si la factura trae ese desglose (a veces en una página de "DESGLOSE POR UNIDAD" aparte del resumen), devuelve en "contratos" una entrada por contrato: {"contrato":"6800-72-0107200-33","alquiler":1087.67,"seguro":27.30}. Toma el detalle por contrato, no la línea resumen de "N contratos". Si la factura no tiene contratos, devuelve [].

ABONOS Y FACTURAS RECTIFICATIVAS. Si el documento entero es un abono —lo dice su título o su cabecera: "Abono", "Factura de abono", "Factura rectificativa", "Rectificativa", "Nota de crédito", "Credit note", "Devolución"—, pon "es_abono":true y devuelve base, iva, total y el desglose_iva EN NEGATIVO, aunque el documento los imprima en positivo. Muchos proveedores (Dismenorca, por ejemplo) imprimen el abono con importes positivos y solo lo indica la palabra "Abono" arriba. NO es abono una factura normal que lleve alguna línea de abono o devolución dentro, ni la que habla de "abono bancario" como forma de pago: en esos casos "es_abono":false y los importes tal cual.

RETENCIÓN DE IRPF. Algunos proveedores autónomos (profesionales como gestorías, abogados, arquitectos, o arrendadores de locales) aplican una retención de IRPF que se RESTA del total. Aparece al pie con textos como "Retención IRPF 15%", "IRPF -15%", "Ret. 7%" o "Retención a cuenta", y su importe suele ir con signo negativo o entre paréntesis.
- "retencion": el IMPORTE retenido SIEMPRE EN POSITIVO, aunque en el documento figure en negativo. Si no hay retención, pon 0.
- "retencion_pct": el porcentaje aplicado (15, 7, 19, 2...). Si no viene el porcentaje impreso, pon null; NO lo calcules dividiendo.
- "retencion_base": la base sobre la que se calcula la retención. ATENCIÓN: NO tiene por qué ser la base total de la factura. El cuadro del pie suele traer su propia fila de retención con su BASE, su % y su importe; usa ESA base. Es frecuente que la retención se aplique solo a una parte: por ejemplo en un agricultor, el 2% grava el producto al 4% de IVA pero NO el transporte al 21%. Si el cuadro no indica base de retención, pon null; no la deduzcas.
- Comprobación: con retención, total = base + iva - retencion. Si esa resta no te cuadra con el total impreso, devuelve los importes TAL COMO ESTÁN impresos y no los ajustes.
- No confundas la retención con un descuento comercial ni con el IVA. Si no ves ninguna mención explícita a IRPF o retención, pon retencion:0 y retencion_pct:null.`;

  let prompt;
  const formaFactura=`{"tipo":"factura","fecha":"YYYY-MM-DD","proveedor":"","proveedor_nif":"","num_documento":"","canal":null,"base":0,"iva":0,"retencion":0,"retencion_pct":null,"retencion_base":null,"total":0,"reparto_centros":[],"codigo_terminal":null,"codigo_cups":null,"descuento":0,"es_abono":false,"contratos":[],
"desglose_iva":[{"pct":0,"base":0,"cuota":0}],
"albaranes":[{"num_albaran":"","fecha":"YYYY-MM-DD","importe":0}]}`;
  const formaAlbaran=`{"tipo":"albaran","fecha":"YYYY-MM-DD","proveedor":"","proveedor_nif":"","num_documento":"","canal":null,"base":null,"iva":null,"retencion":0,"retencion_pct":null,"retencion_base":null,"total":null,"descuento":0,
"pagina":null,"paginas":null,
"desglose_iva":[{"pct":0,"base":0,"cuota":0}],
"lineas":[{"id_producto":"","producto":"","cantidad":0,"precio_unit":0,"importe":0}]}`;
  const instrFactura=`Una FACTURA agrupa varios ALBARANES (notas de entrega). NO extraigas productos como tales: tu salida es UNA fila por albarán.

Cómo leer los albaranes:
- Cada albarán empieza con una línea de CABECERA tipo "Albarán nº: XXXX  Fecha: DD/MM/AAAA" o "Albarán..: 33061 de fecha: 27/04/2026". Ese XXXX es el número de albarán.
- DEBAJO de esa cabecera puede haber una o varias líneas de PRODUCTO (con su código de artículo, descripción, lote, caducidad, cantidad, precio e importe). Esas líneas pertenecen al albarán de la cabecera anterior.
- CUIDADO: la primera columna de las líneas de producto es el CÓDIGO DE ARTÍCULO (ej. 013782, 015048), NO es un número de albarán. No lo confundas. El número de albarán SOLO aparece en las líneas de cabecera "Albarán nº...".
- Para cada albarán, SUMA los importes de todas sus líneas de producto y da ese total como "importe" del albarán. Si la cabecera ya trae un importe total, úsalo.

Resultado: una fila por número de albarán distinto, con su fecha y su importe total (suma de su desglose). Extrae TODOS los albaranes. Si alguno no tiene importe, pon importe:null.

DESGLOSE DE IVA — esto es importante para la contabilidad. Casi todas las facturas imprimen al pie un cuadro de IVA con una fila por tipo, del estilo "Base 10,00% 120,00 Cuota 12,00" y "Base 21,00% 80,00 Cuota 16,80". Extrae ese cuadro en "desglose_iva": una entrada por cada tipo, con "pct" (el porcentaje: 21, 10, 4 o 0), "base" (la base imponible de ese tipo) y "cuota" (el IVA de ese tipo).
- Si la factura solo aplica un tipo de IVA, devuelve una sola entrada.
- Si NO encuentras ese cuadro, devuelve "desglose_iva":[]. NO lo inventes y NO lo deduzcas dividiendo el IVA total: un desglose inventado corrompe el asiento contable, y vacío es preferible.
- La suma de las bases del desglose debe coincidir con "base". Si no te cuadra, devuelve el desglose tal como está impreso y no lo ajustes tú.

PAUTAS DE FACTURA POR PROVEEDOR (si el proveedor de este documento coincide, sigue su pauta para localizar los albaranes):
${pautaFacTxt}`;
  const instrAlbaran=`Un ALBARÁN lleva detalle de productos. Extrae en "lineas" cada producto: código, nombre, cantidad, precio_unit e importe.

EL NÚMERO DE ALBARÁN. Búscalo SIEMPRE en un campo etiquetado: "Núm.Albarán", "Nº albarán", "Albarán nº", "Nota de entrega nº", "NOTA ENTR." o la columna "NÚMERO" de la cabecera. Suele estar repetido al pie del documento.
- NUNCA lo tomes de la columna de códigos de barras. Esa columna viene rotulada "CODI EAN", "CÓDIGO EAN" o "EAN" y contiene códigos de PRODUCTO de 12 a 14 dígitos, uno por línea. Un número que empieza por 5449, 0000 o 84 y tiene 13 dígitos es un código de barras, no un albarán.
- Si dudas entre dos números, elige el que aparece UNA sola vez en cabecera o pie, no el que se repite línea a línea.

LA FECHA. Coge la fecha del documento, el campo "DATA / FECHA" o "Fecha". NO cojas el vencimiento: "DATA VENT", "Fecha vto.", "Vencimiento" o "Fecha de pago" son otra cosa y suelen estar semanas después. Si ves dos fechas, la del documento es la más antigua.

PÁGINAS. Muchos albaranes vienen en varios folios y lo indican con "PÀG/PÁG 1/2", "Pág. 2 de 3" o "Hoja 1/2". Si lo ves, devuelve "pagina" (el folio que estás mirando) y "paginas" (el total). Si no hay indicación de página, devuelve pagina:1 y paginas:1.
- Si esta página NO trae el cuadro de totales, o el cuadro está vacío, o dice "Sigue...", "Continúa" o similar, devuelve base:null, iva:null y total:null. NO devuelvas 0: un cero es un dato falso y estropea la contabilidad. El nulo dice "en esta página no está" y se completa con la otra página.
- Extrae las líneas de producto de ESTA página solamente. No inventes las de la otra.

DESGLOSE DE IVA. Si esta página trae el cuadro de tipos ("IVA 10 %", "IVA 21 %" con su base y su cuota), extráelo en "desglose_iva" con "pct", "base" y "cuota", una entrada por tipo. Si no lo trae, devuelve "desglose_iva":[]. No lo inventes ni lo deduzcas dividiendo.`;

  if(t==='factura'){
    prompt=`${comun}\n\nEste documento es una FACTURA.\n${instrFactura}\n\nDevuelve ÚNICAMENTE un JSON válido, sin texto alrededor, con esta forma:\n${formaFactura}`;
  }else if(t==='albaran'){
    prompt=`${comun}\n\nEste documento es un ALBARÁN.\n${instrAlbaran}\n\nDevuelve ÚNICAMENTE un JSON válido, sin texto alrededor, con esta forma:\n${formaAlbaran}`;
  }else{
    // AUTO: clasificar primero, y según el tipo colocar los datos en el campo correcto
    const paso0=esCorreo?`
PASO 0 — FILTRO (documento recibido por correo electrónico): en este buzón SOLO nos interesan FACTURAS y ALBARANES emitidos POR UN PROVEEDOR a Bonita Menorca / Binifadet. Si el documento es cualquier otra cosa — un listado o resumen de facturas, un extracto o estado de cuentas, publicidad, un presupuesto, un contrato, una carta, un justificante de pago, una imagen sin contenido comercial — NO extraigas nada y devuelve ÚNICAMENTE: {"tipo":"otro","motivo":"qué es, en pocas palabras"}. Si SÍ es una factura o albarán de proveedor, continúa con los pasos siguientes.
`:'';
    prompt=`${comun}
${paso0}
PASO 1 — CLASIFICA el documento:
- Es una FACTURA si su encabezado dice "FACTURA", tiene "Nº Factura", o si su cuerpo es una lista de albaranes (filas tipo "Albarán nº: XXXX Fecha: ...").
- Es un ALBARÁN si es una nota de entrega con detalle de productos (artículos, cantidades, precios). También lo es el "ALB.-POST-FAC." (albarán post-factura) de Coca-Cola, aunque lleve fecha de vencimiento.

PASO 2 — EXTRAE según lo que sea:
- Si es FACTURA: ${instrFactura}
- Si es ALBARÁN: ${instrAlbaran}

Devuelve ÚNICAMENTE un JSON válido, sin texto alrededor.
- Si es factura, con esta forma EXACTA (campo "albaranes", SIN "lineas"):
${formaFactura}
- Si es albarán, con esta forma EXACTA (campo "lineas", SIN "albaranes"):
${formaAlbaran}`;
  }
  return prompt;
}

/* ===== F: IVA, autocorrección, renting, reparto, fusión de folios, líneas (1922-2145) ===== */
// Código de IVA de A3 a partir del porcentaje impreso en la factura.
// Devuelve null si el porcentaje no es ninguno de los tipos españoles vigentes.
// Replica exacta de cod_iva_de_pct() en Postgres. Antes le faltaban los
// regimenes agrarios y, peor, con 10,5 % la tolerancia de +-0,5 lo capturaba
// como RED10: una factura de ganadero se contabilizaba al 10 %.
// EPS: en el borde justo de la tolerancia, JS y Postgres discrepaban. numeric
// calcula 12,3-12 = 0,3 exacto y el double de JS da 0,30000000000000071, asi
// que el mismo porcentaje caia en tipos distintos segun quien lo mirase.
const EPS_IVA=1e-9;
function codIvaDePct(p){
  const n=num(p); if(n==null)return null;
  if(Math.abs(n-21)  <=0.5 +EPS_IVA) return 'ORD21';
  if(Math.abs(n-12)  <=0.3 +EPS_IVA) return 'REGESP12';
  if(Math.abs(n-10.5)<=0.2 +EPS_IVA) return 'GANPE105';
  if(Math.abs(n-10)  <=0.2 +EPS_IVA) return 'RED10';
  if(Math.abs(n-4)   <=0.5 +EPS_IVA) return 'SRE';
  if(Math.abs(n)     <=0.30+EPS_IVA) return 'EXE';
  return null;
}
// Guarda el reparto contable de una factura (una línea por tipo de IVA).
// Solo escribe cuando hay MÁS DE UN tipo: con uno solo no hace falta, porque la
// vista de exportación sintetiza la línea única a partir de los totales.
// centro_coste y cuenta_gasto se dejan a null a propósito: la vista los rellena
// con el canal de la factura y la cuenta del proveedor. Solo se fijan aquí si
// alguien reparte a mano por centro de coste.
async function tieneRepartoManual(docId){
  try{
    const r=await sb(`compras_doc_reparto?doc_id=eq.${docId}&manual=is.true&select=id&limit=1`);
    return r.length>0;
  }catch(e){return false;}
}
// Corrige el error clasico del OCR con los pies de IVA de varias filas: coger UNA
// fila del cuadro como base (o como total) del documento entero. Solo actua cuando
// la alternativa cuadra al centimo, asi que no puede inventarse nada: si hay la mas
// minima duda, deja el documento como esta y que lo vea una persona.
// Devuelve la lista de arreglos aplicados (vacia si no toco nada).
function autocorregirDesglose(d){
  const arreglos=[];
  const dg=Array.isArray(d.desglose_iva)?d.desglose_iva:[];
  if(dg.length<2)return arreglos;
  const bases=dg.map(x=>num(x.base)).filter(x=>x!=null);
  const cuotas=dg.map(x=>num(x.cuota)).filter(x=>x!=null);
  if(bases.length!==dg.length||cuotas.length!==dg.length)return arreglos;
  const sb=+bases.reduce((a,x)=>a+x,0).toFixed(2);
  const sc=+cuotas.reduce((a,x)=>a+x,0).toFixed(2);
  const cerca=(a,b)=>a!=null&&b!=null&&Math.abs(a-b)<=0.02;
  const b=num(d.base), i=num(d.iva), t=num(d.total);
  const ret=Math.abs(num(d.retencion)||0);
  // El total bueno segun el propio cuadro del pie.
  const tCuadro=+(sb+sc-ret).toFixed(2);

  // (a) El total es en realidad una de las bases del cuadro (leyo la casilla de al lado).
  if(!cerca(t,tCuadro) && bases.some(x=>cerca(x,t)) && sb>0){
    arreglos.push(`total ${t} → ${tCuadro} (era una de las bases del cuadro de IVA)`);
    d.total=tCuadro;
  }
  // (b) La base declarada es UNA fila del cuadro en vez de la suma de todas.
  if(!cerca(b,sb) && bases.some(x=>cerca(x,b)) && cerca(num(d.total),tCuadro)){
    arreglos.push(`base ${b} → ${sb} (era solo una fila del cuadro de IVA)`);
    d.base=sb;
    if(!cerca(i,sc)){ arreglos.push(`IVA ${i} → ${sc}`); d.iva=sc; }
  }
  // (c) La base ya cuadra pero el IVA se quedo con una sola cuota.
  else if(cerca(num(d.base),sb) && !cerca(i,sc) && cuotas.some(x=>cerca(x,i))
          && cerca(+(sb+sc-ret).toFixed(2),num(d.total))){
    arreglos.push(`IVA ${i} → ${sc} (era solo una fila del cuadro de IVA)`);
    d.iva=sc;
  }
  return arreglos;
}

// Lineas cuya cantidad x precio no da el importe. No bloquea nada: es un aviso para
// que se vea a simple vista, porque estas lineas cuadran de total y envenenan Ratios
// en silencio (cantidad de cajas en vez de unidades, columnas desplazadas...).
function lineasDescuadradas(lineas){
  return (lineas||[]).filter(l=>{
    const c=num(l.cantidad), p=num(l.precio_unit), im=num(l.importe);
    if(c==null||p==null||im==null||c===0||p===0)return false;
    return Math.abs(c*p-im)>0.02;
  });
}

// RENTING (28-09-2026): una factura de CaixaBank Equipment trae una cuota por
// contrato y cada contrato es un equipo de un centro (tabla compras_contrato_centro).
// Se reparte por centro: alquiler a la cuenta de renting y seguro a la de seguros,
// como lo contabiliza Lucía en A3. Si falta algún contrato en la tabla, o no
// cuadra con la base, no se inventa nada: la factura queda sin reparto y avisa.
function repartoPorContratos(d,ctx){
  let cs=Array.isArray(d.contratos)?d.contratos:[];
  // Contrato único que la lectura apunta en otro sitio (30-09-2026): Grenke pone
  // el nº de contrato (186019828) y el OCR lo devuelve como nº de albarán. Si
  // alguno de esos números es un contrato dado de alta, la factura entera es de
  // ese contrato (una cuota, sin seguro aparte).
  if(!cs.length){
    const cand=new Set();
    (Array.isArray(d.albaranes)?d.albaranes:[]).forEach(a=>cand.add(String(a&&a.num_albaran||'').replace(/\D/g,'')));
    const hits=[...cand].filter(k=>k&&ctx.mContratos[k]);
    if(hits.length===1)cs=[{contrato:hits[0],alquiler:num(d.base),seguro:0}];
  }
  if(!cs.length)return null;
  const sin=[], acc=new Map();
  for(const x of cs){
    const m=ctx.mContratos[String(x.contrato||'').replace(/\D/g,'')];
    if(!m){sin.push(x.contrato||'?');continue;}
    const add=(cta,imp)=>{const v=num(imp)||0; if(!v)return; const k=m.cc+'|'+cta; acc.set(k,(acc.get(k)||0)+v);};
    add(m.alq,x.alquiler); add(m.seg,x.seguro);
  }
  if(sin.length)return {aviso:'contrato sin centro asignado: '+sin.join(', ')};
  const filas=[...acc.entries()].map(([k,b])=>{const [cc,cta]=k.split('|');return {centro_coste:+cc,cuenta_gasto:cta,base:Math.round(b*100)/100};});
  if(!filas.length)return null;
  const base=num(d.base), suma=filas.reduce((a,f)=>a+f.base,0);
  if(base==null||Math.abs(suma-base)>0.05)return {aviso:`los contratos suman ${suma.toFixed(2)} y la base es ${base}`};
  const dg=(d.desglose_iva||[]).filter(x=>num(x.base));
  if(dg.length>1)return {aviso:'varios tipos de IVA: hay que repartirla a mano'};
  const pct=dg.length?num(dg[0].pct):(base?Math.round((num(d.iva)||0)/base*1000)/10:null);
  const cod=codIvaDePct(pct);
  if(!cod)return {aviso:'no se reconoce el tipo de IVA'};
  const mayor=filas.reduce((a,f)=>Math.abs(f.base)>Math.abs(a.base)?f:a,filas[0]);
  mayor.base=Math.round((mayor.base+(base-suma))*100)/100;
  let sc=0; filas.forEach(f=>{f.tipo_iva=cod; f.cuota=Math.round(f.base*pct)/100; sc+=f.cuota;});
  mayor.cuota=Math.round((mayor.cuota+((num(d.iva)||0)-sc))*100)/100;
  const porCentro={}; filas.forEach(f=>{porCentro[f.centro_coste]=(porCentro[f.centro_coste]||0)+Math.abs(f.base);});
  const ccMayor=+Object.entries(porCentro).sort((a,b)=>b[1]-a[1])[0][0];
  const cm=ctx.mCentros.find(c=>c.codigo===ccMayor);
  return {filas,canal:cm?cm.canal:null};
}
async function guardarRepartoContratos(docId,rc,ctx){
  try{
    await sb('compras_doc_reparto',{method:'POST',body:JSON.stringify(rc.filas.map((f,i)=>({
      cuenta_id:ctx.cuentaId,doc_id:docId,orden:i+1,base:f.base,cuota:f.cuota,tipo_iva:f.tipo_iva,
      centro_coste:f.centro_coste,cuenta_gasto:f.cuenta_gasto,descripcion:'renting por contrato',manual:false})))});
    return true;
  }catch(e){console.warn('No pude guardar el reparto por contratos:',e.message);return false;}
}

async function guardarRepartoIva(docId,desglose,baseFactura,ctx){
  const filas=(desglose||[])
    .map(x=>({cod:codIvaDePct(x.pct),base:num(x.base),cuota:num(x.cuota)}))
    .filter(x=>x.cod&&x.base!=null&&x.base!==0);
  if(filas.length<2)return null;
  if(new Set(filas.map(f=>f.cod)).size<2)return null;
  const suma=filas.reduce((a,f)=>a+f.base,0);
  if(baseFactura==null||Math.abs(suma-baseFactura)>0.02){
    console.warn(`Desglose de IVA descartado en ${docId}: las bases suman ${suma} y la factura dice ${baseFactura}`);
    return 'descuadre';
  }
  try{
    await sb('compras_doc_reparto',{method:'POST',body:JSON.stringify(
      filas.map((f,i)=>({cuenta_id:ctx.cuentaId,doc_id:docId,orden:i+1,base:f.base,cuota:f.cuota,tipo_iva:f.cod})))});
    return 'ok';
  }catch(e){console.warn('No pude guardar el reparto de IVA:',e.message);return 'error';}
}
// Normaliza un número de documento para comparar (igual que en Postgres).
function normNumDoc(v){ return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }

// Un albarán físico puede llegar en varios folios. Si ya existe un albarán del
// mismo proveedor con el mismo número, esta página se fusiona con él en lugar de
// crear un documento nuevo. La fecha NO entra en la clave de agrupación porque
// es justo el campo que el OCR confunde con el vencimiento.
// Devuelve: {accion:'fusionado'|'duplicado'|'nuevo', docId, aviso}
async function fusionarPaginaAlbaran(d,proveedor_id,pagina,imagen_url){
  const nn=normNumDoc(d.num_documento);
  if(!proveedor_id||!nn) return {accion:'nuevo'};
  let hermanos;
  try{
    hermanos=await sb(`compras_doc?tipo=eq.albaran&proveedor_id=eq.${proveedor_id}`
      +`&select=id,num_documento,fecha,base,iva,total,pagina,paginas,paginas_vistas,imagenes,imagen_url&order=created_at.asc`);
  }catch(e){ console.warn('No pude buscar páginas hermanas:',e.message); return {accion:'nuevo'}; }
  const h=(hermanos||[]).find(x=>normNumDoc(x.num_documento)===nn);
  if(!h) return {accion:'nuevo'};

  const vistas=Array.isArray(h.paginas_vistas)&&h.paginas_vistas.length
    ? h.paginas_vistas : [h.pagina||1];
  if(vistas.includes(pagina)){
    // esa página ya está absorbida: es una copia, no un folio nuevo
    return {accion:'duplicado', docId:h.id};
  }

  // completar los totales SOLO donde falten: nunca sobrescribir un dato bueno con un nulo
  const parche={paginas_vistas:[...vistas,pagina].sort((a,b)=>a-b)};
  if(num(h.base) ==null && num(d.base) !=null) parche.base =num(d.base);
  if(num(h.iva)  ==null && num(d.iva)  !=null) parche.iva  =num(d.iva);
  if(num(h.total)==null && num(d.total)!=null) parche.total=num(d.total);
  if(!h.paginas && num(d.paginas)) parche.paginas=num(d.paginas);
  // La foto del folio entrante se anade a la lista del documento que se queda.
  // Antes se subia al bucket y se perdia: el albaran solo ensenaba la pagina 1
  // y el reproceso no tenia con que releer el resto.
  if(imagen_url){
    const yaHay=Array.isArray(h.imagenes)&&h.imagenes.length
      ? h.imagenes.slice()
      : (h.imagen_url?[{url:h.imagen_url,pagina:h.pagina||1}]:[]);
    if(!yaHay.some(f=>f&&f.url===imagen_url)){
      yaHay.push({url:imagen_url,pagina});
      yaHay.sort((x,y)=>(x.pagina||0)-(y.pagina||0));
      parche.imagenes=yaHay;
    }
  }

  let aviso=null;
  if(h.fecha && d.fecha){
    const dias=Math.abs((new Date(h.fecha)-new Date(d.fecha))/86400000);
    if(dias>7) aviso=`las dos páginas del albarán ${d.num_documento} llevan fechas separadas ${Math.round(dias)} días (${h.fecha} y ${d.fecha}); revisa cuál es la correcta`;
  }
  await sb(`compras_doc?id=eq.${h.id}`,{method:'PATCH',body:JSON.stringify(parche)});
  return {accion:'fusionado', docId:h.id, aviso};
}
// El enlace con el catálogo ya NO se hace aquí. Lo resuelve el trigger
// trg_linea_enlaza_producto en Postgres: busca el producto por referencia del
// proveedor y, si el albarán no trae códigos, por nombre normalizado
// (clave_producto) dentro del mismo proveedor; si no existe, lo da de alta y
// actualiza su último precio.
//
// Estaba en JavaScript y solo enlazaba cuando el OCR había leído una referencia,
// así que los proveedores que no imprimen código (Producción, Bodega, Santo
// Domingo, Pain Pigalle...) se quedaban sin enlazar para siempre, y las líneas
// creadas a mano en el modal de revisión tampoco enlazaban nunca. Con la lógica
// en la base de datos hay un único criterio para todos los caminos de entrada,
// y se pasa de dos llamadas por línea a una sola por documento.
async function guardarLineasDoc(docId,dLineas,canal,proveedor_id,proveedorNombre,ctx){
  const lineas=(dLineas||[]).map(l=>({
    cuenta_id:ctx.cuentaId,doc_id:docId,id_producto:(l.id_producto||'').trim()||null,producto:l.producto||null,
    cantidad:num(l.cantidad),precio_unit:num(l.precio_unit),importe:num(l.importe),canal}));
  if(lineas.length)await sb('compras_linea',{method:'POST',body:JSON.stringify(lineas)});
}

/* ===== G: num (2629) y cuadre laxo de albaranes (6806-6818) ===== */
function num(x){if(x==null||x==='')return null;const n=parseFloat(String(x).replace(',','.'));return isNaN(n)?null:n;}
// Cuadre LAXO de la suma de albaranes: orientativo, no al céntimo.
// Lo importante no es el céntimo, sino no haberse dejado ningún albarán.
// Cuadra si la suma se acerca a la BASE o al TOTAL dentro de un margen amplio.
function cuadreAlbaranes(suma,base,total){
  const refs=[base,total].map(num).filter(v=>v!=null&&v>0);
  if(!refs.length)return {ok:null,html:`Suma de albaranes: ${fmt(suma)}`};
  // margen: 3% de la referencia o 3 €, lo que sea mayor (absorbe IVA pequeño, descuentos, redondeos)
  const cuadra=refs.some(ref=>{const margen=Math.max(ref*0.03,3);return Math.abs(suma-ref)<=margen;});
  if(cuadra)return {ok:true,html:`✓ Suma de albaranes ${fmt(suma)} · cuadra (orientativo)`};
  const masCercana=refs.reduce((a,b)=>Math.abs(suma-a)<Math.abs(suma-b)?a:b);
  return {ok:false,html:`Suma de albaranes ${fmt(suma)} · se aleja de la referencia (${fmt(masCercana)}). Revisa que no falte ningún albarán.`};
}
let toastT;

/* ======================================================================
   A PARTIR DE AQUÍ: transcripción del pipeline del navegador a Node
   ====================================================================== */

/* ------------------------------------------------ maestros por cuenta */

// Lo que el navegador tenía en variables globales (reglas, proveedores,
// mCentros, mTiposIva, mContratos, mTerminales) aquí va en un contexto por
// cuenta, cargado una vez por pasada. Mismos SELECT que loadReglas(),
// loadProveedores() y cargarMaestrosReparto(), con el filtro de cuenta que allí
// ponía la RLS.
const _ctxs = new Map();
async function contextoCuenta(cuentaId) {
  if (_ctxs.has(cuentaId)) return _ctxs.get(cuentaId);
  const q = `cuenta_id=eq.${cuentaId}`;
  const ctx = { cuentaId, reglas: [], proveedores: [], mCentros: [], mTiposIva: [], mContratos: {}, mTerminales: {} };
  ctx.reglas = await sb(`compras_regla?activa=eq.true&${q}&select=id,texto&order=created_at.asc`);
  await recargarProveedores(ctx);
  try {
    ctx.mCentros = await sb(`compras_centro_coste?${q}&select=codigo,canal&order=codigo.asc`);
    ctx.mTiposIva = await sb(`compras_tipo_iva?${q}&select=codigo,descripcion&order=codigo.asc`);
    const contr = await sb(`compras_contrato_centro?activo=is.true&${q}&select=contrato,centro_coste,cuenta_alquiler,cuenta_seguro`).catch(() => []);
    (contr || []).forEach((x) => { ctx.mContratos[String(x.contrato).replace(/\D/g, "")] = { cc: x.centro_coste, alq: x.cuenta_alquiler, seg: x.cuenta_seguro }; });
    const term = await sb(`compras_terminal?${q}&select=codigo,canal`);
    term.forEach((t) => {
      const k = String(t.codigo).toUpperCase().replace(/[^A-Z0-9]/g, "");
      ctx.mTerminales[k] = t.canal; ctx.mTerminales[k.replace(/^M/, "")] = t.canal;
    });
  } catch (e) { console.warn("No pude cargar maestros de reparto:", e.message); }
  _ctxs.set(cuentaId, ctx);
  return ctx;
}
async function recargarProveedores(ctx) {
  ctx.proveedores = await sbAll(`compras_proveedor?cuenta_id=eq.${ctx.cuentaId}&select=id,nombre,nif,departamento,cuenta_contable,cuenta_proveedor,codigo_a3,critico,pautas,pauta_factura,alias,autorizado,retencion_modelo,retencion_pct,regimen_iva,tipo_iva_autorep,albaranes_por_email&order=nombre.asc,id.asc`);
}
// Traduce el código impreso del datáfono al centro (réplica de canalDeTerminal).
function canalDeTerminal(cod, ctx) {
  const k = String(cod || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!k) return null;
  return ctx.mTerminales[k] || ctx.mTerminales["M" + k] || ctx.mTerminales[k.replace(/^M/, "")] || null;
}
// ¿lo conoce A3? (misma RPC que el navegador)
async function cuentaA3(nif, nombre) {
  try {
    const r = await sb("rpc/buscar_cuenta_a3", { method: "POST", body: JSON.stringify({ p_nif: nif || null, p_nombre: nombre || null }) });
    return (r && r.length) ? r[0] : null;
  } catch (err) { console.warn("buscar_cuenta_a3:", err.message); return null; }
}

/* --------------------------------------------- PDF: texto y partición */

// Texto de las 3 primeras páginas, para detectar el ALB.-POST-FAC. de Coca-Cola
// (en el navegador lo hacía pdf.js). pdfjs-dist en Node, sin worker. Si no se
// puede leer, se devuelve '' y el documento sigue su camino normal, igual que
// hacía el navegador cuando pdf.js no estaba cargado.
async function textoPdf(c) {
  if (c.mime !== "application/pdf" || !c.buffer) return "";
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const tarea = pdfjs.getDocument({ data: new Uint8Array(c.buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
    const doc = await tarea.promise;
    let t = "";
    for (let i = 1; i <= Math.min(doc.numPages, 3); i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      t += tc.items.map((x) => x.str).join(" ") + "\n";
    }
    try { await tarea.destroy(); } catch (_) {}
    return t;
  } catch (e) {
    console.warn("No se pudo leer el texto del PDF:", e.message);
    return "";
  }
}

const RE_ALB_POST_FAC = /ALB\.?\s*-?\s*POST\s*-?\s*FAC/i;

// Un PDF con varias facturas (Dismenorca…) se parte con pdf-lib en un PDF por
// documento; cada trozo entra en la cola con su fila de adjunto. Transcripción
// de dividirPdfSiVarias() del navegador.
async function dividirPdfSiVarias(c, ctx) {
  if (c.mime !== "application/pdf" || c._hijo || !c.buffer) return null;
  let pdf;
  try { pdf = await PDFDocument.load(c.buffer, { ignoreEncryption: true }); }
  catch (e) { console.warn("pdf-lib no pudo abrir el PDF:", e.message); return null; }
  const n = pdf.getPageCount();
  if (n < 2) return null;
  const block = c.b64 ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: c.b64 } }
                      : { type: "document", source: { type: "url", url: c.urlPublica } };
  const pregunta = `Este PDF tiene ${n} páginas. Puede ser UN solo documento de varias páginas, o VARIOS documentos independientes pegados (facturas, abonos, albaranes), cada uno con su propio número y su propio total. Un documento nuevo empieza donde vuelve a aparecer una cabecera completa con un número de documento distinto; una página de continuación NO es un documento nuevo.
Responde ÚNICAMENTE con JSON, sin texto alrededor:
{"documentos":[{"desde":1,"hasta":1,"tipo":"factura|abono|albaran|otro","num_documento":"","fecha":"YYYY-MM-DD","total":0}]}
Los rangos deben cubrir todas las páginas de la 1 a la ${n}, en orden y sin solaparse. Si todo el PDF es un único documento, devuelve un solo rango 1-${n}.`;
  let d;
  try { d = parseJson(await callAI([block, { type: "text", text: pregunta }])); }
  catch (e) { console.warn("no se pudo saber si el PDF trae varias facturas:", e.message); return null; }
  const docs = Array.isArray(d && d.documentos) ? d.documentos : [];
  if (docs.length < 2) return null;
  let esperado = 1;
  for (const r of docs) {
    const a = Number(r.desde), b = Number(r.hasta);
    if (!(a === esperado && b >= a && b <= n)) { console.warn("rangos de páginas no válidos, se procesa entero:", JSON.stringify(docs)); return null; }
    esperado = b + 1;
  }
  if (esperado !== n + 1) { console.warn("los rangos no cubren todas las páginas, se procesa entero"); return null; }
  const base = (c.nombre || "documento.pdf").replace(/\.pdf$/i, "");
  const hijos = [];
  for (let k = 0; k < docs.length; k++) {
    const r = docs[k];
    const nuevo = await PDFDocument.create();
    const idx = []; for (let p = Number(r.desde); p <= Number(r.hasta); p++) idx.push(p - 1);
    const pags = await nuevo.copyPages(pdf, idx); pags.forEach((p) => nuevo.addPage(p));
    const out = Buffer.from(await nuevo.save());
    const etiqueta = String(r.num_documento || "").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "") || `${k + 1}`;
    const nombre = `${base}_${k + 1}de${docs.length}_${etiqueta}.pdf`;
    const url = await sbUpload(out, nombre, "application/pdf");
    const hijo = {
      nombre, buffer: out, b64: out.length < 3 * 1024 * 1024 ? out.toString("base64") : null, mime: "application/pdf",
      urlPublica: url, _hijo: true, esMovil: c.esMovil, cuentaId: c.cuentaId,
      esAbono: String(r.tipo || "").toLowerCase() === "abono",
    };
    if (c.correoAdjId) {
      // fila propia en la cola de correo, ya reclamada por esta pasada
      const filas = await sb("compras_correo_adjunto", { method: "POST", body: JSON.stringify([{
        cuenta_id: c.cuentaId, correo_id: c.correoId, nombre_archivo: nombre, mime: "application/pdf",
        url, storage_path: url.split("/public/" + BUCKET + "/")[1] || null, estado: "PROCESANDO", claimed_at: new Date().toISOString(), error: null }]) });
      if (filas && filas[0]) { hijo.correoAdjId = filas[0].id; hijo.correoId = c.correoId; }
    }
    hijos.push(hijo);
  }
  if (c.correoAdjId) {
    await sb(`compras_correo_adjunto?id=eq.${c.correoAdjId}`, { method: "PATCH", body: JSON.stringify({ estado: "DESCARTADO", error: `PDF con ${docs.length} documentos: dividido en ${docs.length} adjuntos (${docs.map((x) => x.num_documento || "?").join(", ")})` }) }).catch(() => {});
  }
  return hijos;
}

/* -------------------------------------------------------- procesarUno */

async function cerrarAdjunto(c, cambio) {
  if (!c.correoAdjId) return;
  await sb(`compras_correo_adjunto?id=eq.${c.correoAdjId}`, { method: "PATCH", body: JSON.stringify(cambio) });
}
// Cierre con doc_id y, si el enlace falla, sin él: cerrarlo sin enlace es peor
// que no cerrarlo, pero mucho mejor que dejarlo atascado (ver navegador).
async function cerrarAdjuntoConDoc(c, cierre) {
  if (!c.correoAdjId) return;
  try { await cerrarAdjunto(c, cierre); }
  catch (e) {
    console.error("No pude enlazar el adjunto " + c.correoAdjId + ":", e.message);
    const sinDoc = { ...cierre }; delete sinDoc.doc_id;
    await cerrarAdjunto(c, sinDoc).catch(() => {});
  }
}

// Transcripción de procesarUno(c) del navegador. `c` es el documento en cola:
// {nombre, buffer, b64, mime, urlPublica, correoAdjId, correoId, cuentaId,
//  tipoForzado, forzadoAMano, esMovil, esAbono, _hijo}. Deja en c: descartado,
// duplicado, dividido/_hijos, docId, avisos[].
async function procesarUno(c, ctx, quedaMs) {
  c.avisos = c.avisos || [];
  // PDF con varias facturas: se parte y se procesa por trozos
  const hijos = await dividirPdfSiVarias(c, ctx);
  if (hijos) { c._hijos = hijos; c.dividido = hijos.length; return; }
  if (c.mime === "application/pdf" && !c.tipoForzado) {
    const tx = await textoPdf(c);
    if (RE_ALB_POST_FAC.test(tx)) {
      c.tipoForzado = "albaran"; c.albPostFac = true;
      const m = tx.match(/Sustituye\s+al\s+doc\.?\s*n\S*\s*:?\s*(\d{6,})/i);
      c.sustituyeA = m ? m[1] : null;
    }
  }
  // los documentos de correo se clasifican siempre en modo auto y con el filtro anti-ruido
  const tipoUsado = c.tipoForzado || "auto";
  let prompt = construirPromptOCR(tipoUsado, !!c.correoAdjId, ctx);
  if (c.albPostFac) prompt += "\n\nEste documento es un ALBARÁN POST-FACTURA (rotulado \"ALB.-POST-FAC.\"): trátalo como ALBARÁN aunque lleve fecha de vencimiento o forma de pago. Su \"num_documento\" es el NÚMERO del propio documento (el que aparece como \"Núm.Albarán\"), no el de \"Sustituye al doc.nº\". Devuelve todas las líneas tal como aparecen, incluidas las de envases (cajas, botellas) y las devoluciones de envases, que van en negativo.";
  const porUrl = !c.b64 && c.urlPublica;
  const block = c.mime === "application/pdf"
    ? (porUrl ? { type: "document", source: { type: "url", url: c.urlPublica } }
              : { type: "document", source: { type: "base64", media_type: "application/pdf", data: c.b64 } })
    : (porUrl ? { type: "image", source: { type: "url", url: c.urlPublica } }
              : { type: "image", source: { type: "base64", media_type: c.mime, data: c.b64 } });
  if (!c.b64 && !c.urlPublica) throw new Error("el documento no tiene ni contenido ni URL de descarga");
  const respuestaCruda = await callAI([block, { type: "text", text: prompt }]);
  let d;
  try { d = parseJson(respuestaCruda); }
  catch (err) {
    // Un truncado se propaga como error (reintentable): jamás se descarta.
    if (!/^SIN_JSON/.test(err.message)) throw err;
    const prompt2 = prompt + "\n\nIMPORTANTE: responde ÚNICAMENTE con el objeto JSON, sin texto antes ni después, sin ``` y sin explicaciones. Si el documento no es una factura ni un albarán, devuelve {\"tipo\":\"otro\",\"motivo\":\"...\"}.";
    const cruda2 = await callAI([block, { type: "text", text: prompt2 }]);
    try { d = parseJson(cruda2); }
    catch (err2) {
      if (/^(JSON_TRUNCADO|JSON_ROTO)/.test(err2.message)) throw err2;
      if (!c.correoAdjId) throw err2;
      c.descartado = ("el modelo no devolvió JSON: " + String(respuestaCruda || "").trim().replace(/\s+/g, " ")).slice(0, 200);
      await cerrarAdjunto(c, { estado: "DESCARTADO", error: c.descartado }).catch(() => {});
      return;
    }
  }
  // documento de correo que NO es factura ni albarán: descartar sin guardar nada
  if (c.correoAdjId && d.tipo === "otro") {
    c.descartado = (d.motivo || "no es factura ni albarán").slice(0, 200);
    await cerrarAdjunto(c, { estado: "DESCARTADO", error: c.descartado }).catch(() => {});
    return;
  }
  const _fix = autocorregirDesglose(d);
  if (_fix.length) { console.warn("Autocorregido " + (d.num_documento || "") + ": " + _fix.join(" · ")); d._autocorregido = _fix; }
  if (esNifPropioSinSufijo(d.proveedor_nif)) {
    console.warn("NIF propio devuelto como proveedor; se descarta:", d.proveedor);
    d.proveedor_nif = null;
  }
  {
    const limpio = limpiarProveedorPropio(d.proveedor);
    if (limpio !== d.proveedor) {
      console.warn("Nombre propio en el proveedor; se limpia:", d.proveedor, "->", limpio || "(vacío)");
      d.proveedor = limpio;
    }
  }
  let canal = canalDeTerminal(d.codigo_terminal, ctx) || canalCanonico(d.canal);
  let docTipo = (tipoUsado === "auto") ? (d.tipo || "factura") : tipoUsado;

  // ESCALADA: si la lectura no cuadra, segunda pasada con un modelo superior.
  // Si no queda tiempo en esta pasada para hacerla, el documento vuelve a la
  // cola (reintentable) en vez de guardarse con una lectura peor que la que
  // habría dado el navegador.
  {
    const problema = lecturaEvaluable(d, docTipo);
    if (problema && d.tipo !== "otro") {
      if (typeof quedaMs === "function" && quedaMs() < TIMEOUT_IA_MS) {
        throw new Error("timeout: sin tiempo en esta pasada para la escalada a Opus (" + problema + ")");
      }
      try {
        console.warn("Escalada: la lectura no cuadra (" + problema + "), segunda pasada con Opus…");
        const cruda2 = await callAI([block, { type: "text", text: prompt + AVISO_ESCALADA.replace("%%", problema) }], MODELO_ESCALADA);
        const d2 = parseJson(cruda2);
        const tipo2 = (tipoUsado === "auto") ? (d2.tipo || "factura") : tipoUsado;
        if (!lecturaEvaluable(d2, tipo2)) {
          d = d2; d._escalado = true;
          canal = canalDeTerminal(d.codigo_terminal, ctx) || canalCanonico(d.canal);
          docTipo = tipo2;
          console.warn("Escalada: la segunda pasada cuadra, se usa esa lectura.");
        } else {
          console.warn("Escalada: la segunda tampoco cuadra, se conserva la primera.");
        }
      } catch (e) { console.warn("Escalada fallida, se mantiene la primera lectura:", e.message); }
    }
  }

  // ABONOS: signo negativo en base, IVA, total y desglose.
  {
    const esAbono = d.es_abono === true || d.tipo === "abono" || docTipo === "abono" || c.esAbono === true;
    if (d.tipo === "abono") d.tipo = "factura";
    if (docTipo === "abono") docTipo = "factura";
    if (esAbono && docTipo === "factura") {
      const neg = (v) => { const n = num(v); return n == null ? v : -Math.abs(n); };
      d.base = neg(d.base); d.iva = neg(d.iva); d.total = neg(d.total);
      (d.desglose_iva || []).forEach((x) => { x.base = neg(x.base); x.cuota = neg(x.cuota); });
      d.es_abono = true;
    }
  }

  // Por correo SOLO entran facturas (salvo móvil, post-factura, reencolado a
  // mano o proveedor con «Envía albaranes por email»).
  const provMatchCorreo = c.correoAdjId ? matchProveedor(d.proveedor_nif, d.proveedor, ctx) : null;
  const albaranesPorEmail = !!(provMatchCorreo && provMatchCorreo.albaranes_por_email === true);
  if (c.correoAdjId && !c.esMovil && docTipo !== "factura" && !c.albPostFac && !c.forzadoAMano && !albaranesPorEmail) {
    c.descartado = `albarán recibido por correo: no se carga (los albaranes entran solo por carga manual). Proveedor: ${d.proveedor || "?"}, nº ${d.num_documento || "?"}`;
    await cerrarAdjunto(c, { estado: "DESCARTADO", error: c.descartado }).catch(() => {});
    return;
  }

  // RED DE SEGURIDAD: factura con los albaranes metidos en "lineas"
  if (docTipo === "factura" && (!d.albaranes || !d.albaranes.length) && Array.isArray(d.lineas) && d.lineas.length) {
    const rescatados = d.lineas
      .filter((l) => /albar[áa]n/i.test(l.producto || "") || /^[A-Z]{1,3}[-\s]?\d{4,}/.test((l.producto || "").trim()))
      .map((l) => {
        const txt = l.producto || "";
        const mNum = txt.match(/([A-Z]{1,3}[-\s]?\d{4,})/i);
        const mFecha = txt.match(/(\d{2}[\/.-]\d{2}[\/.-]\d{2,4})/);
        return { num_albaran: l.id_producto || (mNum ? mNum[1] : "") || "", fecha: mFecha ? mFecha[1] : null, importe: num(l.importe) };
      });
    if (rescatados.length) { d.albaranes = rescatados; d.lineas = []; }
  }

  // 1) imagen a Storage
  let imagen_url = null;
  try { imagen_url = await sbUpload(c.buffer, c.nombre, c.mime); } catch (e) { console.warn("Storage falló:", e.message); }

  // 2) maestro de proveedores: casar por CIF y si falla por nombre
  let proveedor_id = null;
  const match = matchProveedor(d.proveedor_nif, d.proveedor, ctx);
  if (match) {
    proveedor_id = match.id;
  } else if (d.proveedor || d.proveedor_nif) {
    const nifOK = cifValido(d.proveedor_nif) === false ? null : (d.proveedor_nif || null);
    if (d.proveedor_nif && nifOK === null) console.warn("CIF inválido descartado al crear proveedor:", d.proveedor_nif, "·", d.proveedor);
    const a3 = await cuentaA3(nifOK, d.proveedor);
    const np = await sb("compras_proveedor", { method: "POST", body: JSON.stringify({
      cuenta_id: ctx.cuentaId,
      nombre: d.proveedor || "(sin nombre)", nif: nifOK,
      codigo_a3: a3 ? a3.codigo : null,
      cuenta_proveedor: a3 ? a3.cuenta : null,
      cuenta_contable: a3 ? a3.contrapartida : null,
      autorizado: false }) });
    proveedor_id = np[0].id;
    ctx.proveedores.push({ id: np[0].id, nombre: d.proveedor || "(sin nombre)", nif: nifOK,
      codigo_a3: a3 ? a3.codigo : null, cuenta_proveedor: a3 ? a3.cuenta : null, cuenta_contable: a3 ? a3.contrapartida : null, autorizado: false });
    c.avisos.push(`proveedor nuevo sin autorizar: ${d.proveedor || nifOK}`);
  }

  // 2b) departamento fijo del proveedor como respaldo del centro
  if (!canal && match && match.departamento) canal = canalCanonico(match.departamento);

  // 2c) ¿es un folio de un albarán que ya tenemos?
  if (docTipo === "albaran") {
    const pag = num(d.pagina) || 1;
    const fus = await fusionarPaginaAlbaran(d, proveedor_id, pag, imagen_url);
    if (fus.accion === "fusionado") {
      await guardarLineasDoc(fus.docId, d.lineas, canal, proveedor_id, d.proveedor, ctx);
      await cerrarAdjuntoConDoc(c, { estado: "PROCESADO", doc_id: fus.docId, error: `página ${pag} unida al albarán ${d.num_documento}` });
      c.docId = fus.docId; c.fusionado = true;
      if (fus.aviso) c.avisos.push(fus.aviso);
      return;
    }
    if (fus.accion === "duplicado") {
      await cerrarAdjuntoConDoc(c, { estado: "PROCESADO", doc_id: fus.docId, error: `página ${pag} ya registrada del albarán ${d.num_documento}` });
      c.duplicado = `página ${pag} del albarán ${d.num_documento} ya registrada`;
      return;
    }
  }

  // 3) AUDITORÍA del documento
  const total = num(d.total);
  const hashDoc = firmaDup(d.num_documento, d.fecha, total);
  let estadoDet = "CORRECTO";
  if (hashDoc) {
    const dup = await sb(`compras_doc?hash_doc=eq.${encodeURIComponent(hashDoc)}&cuenta_id=eq.${ctx.cuentaId}`
      + `&select=id,proveedor,num_documento,fecha,total,tipo,created_at&limit=1`);
    if (dup.length) {
      const y = dup[0];
      const cuando = (y.created_at || "").slice(0, 16).replace("T", " ");
      c.duplicado = `ya registrado: ${y.proveedor || "(sin proveedor)"} · nº ${y.num_documento || "?"}`
        + ` · ${fmtF(y.fecha) || "sin fecha"} · ${fmt(y.total)} · cargado el ${cuando}`;
      // documento YA registrado antes: no crear otro doc, cerrar el adjunto y enlazarlo.
      await cerrarAdjuntoConDoc(c, { estado: "PROCESADO", doc_id: dup[0].id, error: "ya registrado (mismo nº doc + fecha + importe)" });
      c.docId = dup[0].id;
      return;
    }
  }
  const esFactura = (docTipo === "factura");
  // consolidar albaranes repetidos (mismo nº) sumando sus importes
  if (esFactura && Array.isArray(d.albaranes) && d.albaranes.length) {
    const mapa = new Map();
    for (const a of d.albaranes) {
      const k = String(a.num_albaran || "").trim().toUpperCase() || ("__" + Math.random());
      if (mapa.has(k)) {
        const prev = mapa.get(k);
        prev.importe = (num(prev.importe) || 0) + (num(a.importe) || 0);
        if (!prev.fecha && a.fecha) prev.fecha = a.fecha;
      } else {
        mapa.set(k, { num_albaran: a.num_albaran || "", fecha: a.fecha || null, importe: num(a.importe) });
      }
    }
    d.albaranes = [...mapa.values()];
  }
  if (estadoDet === "CORRECTO") {
    if (esFactura) {
      if (total == null) {
        estadoDet = "REVISAR";
      } else {
        const cu = cuadreFactura(num(d.base), num(d.iva), Math.abs(num(d.retencion) || 0), total, d.desglose_iva);
        if (!cu.ok) { estadoDet = "NO_CUADRA"; cu.motivo && console.warn("Factura no cuadra:", d.num_documento, cu.motivo); }
      }
    } else {
      if (!(d.lineas || []).length) {
        estadoDet = "REVISAR";
      } else {
        const sumaLineas = (d.lineas || []).reduce((s, l) => s + (num(l.importe) || 0), 0);
        const desc = num(d.descuento) || 0;
        const cu = cuadreAlbaranes(sumaLineas - desc, num(d.base), total);
        estadoDet = (cu.ok === true) ? "CORRECTO" : (cu.ok === false) ? "NO_CUADRA" : "REVISAR";
      }
    }
  }
  const rc = esFactura ? repartoPorContratos(d, ctx) : null;
  if (rc && rc.filas) { if (!canal) canal = rc.canal; }
  else if (rc && rc.aviso) { c.avisos.push(`${d.proveedor || "Factura"} ${d.num_documento || ""}: ${rc.aviso}`); }
  const estadoSimple = (estadoDet === "CORRECTO") ? (canal ? "OK" : "REVISAR") : "REVISAR";

  // 4) documento (mismos campos que el navegador, más cuenta_id explícito)
  const doc = await sb("compras_doc", { method: "POST", body: JSON.stringify({
    cuenta_id: ctx.cuentaId,
    tipo: docTipo, fecha: d.fecha || null, proveedor: d.proveedor || null, proveedor_nif: d.proveedor_nif || null,
    proveedor_id, num_documento: d.num_documento || null, canal, base: num(d.base), iva: num(d.iva), total, descuento: num(d.descuento),
    retencion: Math.abs(num(d.retencion) || 0) || null, retencion_pct: num(d.retencion_pct),
    retencion_base: num(d.retencion_base),
    reparto_sugerido: (Array.isArray(d.reparto_centros) && d.reparto_centros.length) ? d.reparto_centros : null,
    codigo_terminal: d.codigo_terminal || null,
    codigo_cups: (d.codigo_cups || "").replace(/[^A-Za-z0-9]/g, "") || null,
    estado: estadoSimple, estado_detalle: estadoDet, hash_doc: hashDoc, imagen_url, origen: c.correoAdjId ? "correo" : "manual",
    imagenes: imagen_url ? [{ url: imagen_url, pagina: !esFactura ? (num(d.pagina) || 1) : 1 }] : null,
    pagina: !esFactura ? (num(d.pagina) || 1) : null,
    paginas: !esFactura ? (num(d.paginas) || 1) : null,
    paginas_vistas: !esFactura ? [num(d.pagina) || 1] : null,
    albaranes_detectados: esFactura ? (d.albaranes || []) : null,
    raw: c.albPostFac ? { ...d, alb_post_fac: true, sustituye_a: c.sustituyeA || null } : d }) });
  const docId = doc[0].id;
  c.docId = docId; c.estado = estadoSimple; c.estadoDet = estadoDet;
  // Albarán post-factura: el albarán de entrega original (foto) queda sustituido.
  if (c.albPostFac && c.sustituyeA && proveedor_id) {
    try {
      const viejos = await sb(`compras_doc?tipo=eq.albaran&proveedor_id=eq.${proveedor_id}&num_documento=eq.${encodeURIComponent(c.sustituyeA)}&id=neq.${docId}&select=id,estado_detalle`);
      for (const v of (viejos || []).filter((v) => v.estado_detalle !== "DUPLICADO"))
        await sb(`compras_doc?id=eq.${v.id}`, { method: "PATCH", body: JSON.stringify({ estado_detalle: "DUPLICADO", estado: "REVISAR" }) });
    } catch (e) { console.warn("No se pudo marcar el albarán sustituido " + c.sustituyeA + ":", e.message); }
  }
  // adjunto → PROCESADO (con reintento sin doc_id si el enlace falla)
  if (c.correoAdjId) {
    try { await cerrarAdjunto(c, { estado: "PROCESADO", doc_id: docId }); }
    catch (e) {
      console.error("No se pudo marcar el adjunto " + c.correoAdjId + " como PROCESADO:", e.message);
      try { await cerrarAdjunto(c, { estado: "PROCESADO" }); }
      catch (e2) { c.avisos.push("el adjunto " + c.correoAdjId + " no se pudo marcar como procesado"); }
    }
  }

  // 5) líneas (albaranes) o reparto (facturas)
  if (!esFactura) {
    await guardarLineasDoc(docId, d.lineas, canal, proveedor_id, d.proveedor, ctx);
  } else {
    if (rc && rc.filas) { await guardarRepartoContratos(docId, rc, ctx); return; }
    const r = await guardarRepartoIva(docId, d.desglose_iva, num(d.base), ctx);
    if (r === "descuadre") c.avisos.push(`${d.proveedor || "Factura"} ${d.num_documento || ""}: el desglose de IVA no cuadra con la base, hay que repartirlo a mano`);
  }
}

/* -------------------------------------------------------- la pasada */

// ¿El fallo es culpa del documento o del entorno? Los transitorios vuelven a
// PENDIENTE (y los coge la siguiente pasada o el navegador); el resto, ERROR.
async function marcarAdjuntoError(c, msg) {
  if (!c.correoAdjId) return false;
  msg = String(msg || "").slice(0, 300);
  const transitorio = esFalloTransitorio(msg);
  const cambio = transitorio
    ? { estado: "PENDIENTE", claimed_at: null, error: "reintentable: " + msg }
    : { estado: "ERROR", error: msg };
  await sb(`compras_correo_adjunto?id=eq.${c.correoAdjId}`, { method: "PATCH", body: JSON.stringify(cambio) }).catch(() => {});
  return transitorio;
}

// Tipo por los primeros bytes, para adjuntos sin mime (el navegador usaba blob.type).
function tipoPorCabecera(buffer) {
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer.subarray(0, 4).toString("latin1") === "\x89PNG") return "image/png";
  if (buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
// Prepara un adjunto reclamado: descarga, limpieza de PDF, compresión de foto y
// base64 (o vía URL si pesa). Transcripción de cargarLoteCorreo() del navegador.
async function prepararAdjunto(a) {
  let buffer = await descargarAdjunto(a);
  let mime = a.mime || tipoPorCabecera(buffer) || "application/pdf";
  let nombre = a.nombre_archivo || "documento.pdf";
  if (!mime.startsWith("image/")) { buffer = limpiarPdf(buffer); if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") mime = "application/pdf"; }
  else {
    const cmp = await comprimirImagen(buffer, nombre);
    if (cmp) { buffer = cmp.buffer; mime = cmp.mime; nombre = cmp.nombre; }
  }
  const b64 = buffer.toString("base64");
  // Mismo criterio que el navegador: por encima de ~3 MB de base64 (o si ya
  // falló por tamaño) se manda la URL pública y el modelo lo descarga él.
  const yaFalloPorTamano = esRecuperablePorUrl(a.error || "");
  const pesado = b64.length > 3 * 1024 * 1024 || yaFalloPorTamano;
  if (pesado && !a.url) throw new Error("demasiado grande y sin URL de descarga");
  return {
    nombre, buffer, b64: pesado ? null : b64, mime, urlPublica: a.url,
    correoAdjId: a.id, correoId: a.correo_id, cuentaId: a.cuenta_id,
    tipoForzado: /^FORZAR FACTURA/i.test(a.error || "") ? "factura" : (/^FORZAR ALBAR/i.test(a.error || "") ? "albaran" : null),
    forzadoAMano: /^FORZAR /i.test(a.error || ""),
    esMovil: a.correo_id == null,
  };
}

/**
 * Procesa la bandeja de adjuntos PENDIENTE desde el servidor.
 *  presupuestoMs: tiempo total de la pasada. No se EMPIEZA ningún documento
 *    nuevo pasado ese tiempo; lo que quede sigue PENDIENTE para la siguiente.
 *  tamLote / maxLotes: igual que el navegador (20 por lote, 10 lotes).
 */
export async function procesarColaServidor({ presupuestoMs = 200000, tamLote = 20, maxLotes = 10 } = {}) {
  if (!SB_URL || !SB_KEY) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const arranque = Date.now();
  const quedaMs = () => presupuestoMs - (Date.now() - arranque);
  const resumen = {
    rescatados: 0, reclamados: 0, procesados: 0, guardados: 0, fusionados: 0, duplicados: 0, descartados: 0,
    divididos: 0, reintentables: 0, errores: 0, corte_por_tiempo: false, documentos: [], avisos: [], pendientes_ahora: null, segundos: 0,
  };
  _ctxs.clear();

  // Rescate de PROCESANDO abandonados (navegador cerrado a media tanda, pasada
  // anterior cortada por Vercel): mismo criterio que el navegador en automático,
  // 15 minutos sin cerrar, o reclamos de la época sin claimed_at.
  const corte = new Date(Date.now() - 900e3).toISOString();
  const rescatados = await sb(`compras_correo_adjunto?estado=eq.PROCESANDO&or=(claimed_at.lt.${corte},claimed_at.is.null)`, {
    method: "PATCH", body: JSON.stringify({ estado: "PENDIENTE", claimed_at: null }) }).catch(() => []);
  resumen.rescatados = rescatados.length;

  const intentados = new Set();   // lo que ya se tocó en esta pasada no se vuelve a reclamar
  const anotar = (c, estado, texto) => resumen.documentos.push({ adjunto: c.correoAdjId, nombre: c.nombre, estado, texto: texto || null, doc_id: c.docId || null });

  bucle:
  for (let ciclo = 0; ciclo < maxLotes; ciclo++) {
    if (quedaMs() <= 0) { resumen.corte_por_tiempo = true; break; }
    const pend = await sb(`compras_correo_adjunto?estado=eq.PENDIENTE&select=id,cuenta_id,correo_id,nombre_archivo,mime,url,storage_path,error&order=created_at.asc&limit=${tamLote}`);
    const nuevos = pend.filter((a) => !intentados.has(a.id));
    if (!nuevos.length) break;

    const cola = [];
    for (const a of nuevos) {
      intentados.add(a.id);
      // Reclamo optimista: si el navegador (u otra pasada) lo cogió antes, la respuesta viene vacía.
      const claim = await sb(`compras_correo_adjunto?id=eq.${a.id}&estado=eq.PENDIENTE`, {
        method: "PATCH", body: JSON.stringify({ estado: "PROCESANDO", claimed_at: new Date().toISOString() }) });
      if (!claim.length) continue;
      resumen.reclamados++;
      try { cola.push(await prepararAdjunto(a)); }
      catch (err) {
        const c = { correoAdjId: a.id, nombre: a.nombre_archivo };
        const trans = await marcarAdjuntoError(c, err.message || String(err));
        if (trans) resumen.reintentables++; else resumen.errores++;
        anotar(c, trans ? "reintentable" : "error", err.message);
      }
    }

    for (let i = 0; i < cola.length; i++) {
      const c = cola[i];
      if (quedaMs() <= 0) {
        // Sin tiempo: lo reclamado y no empezado vuelve a PENDIENTE ahora mismo,
        // sin esperar los 15 min del rescate.
        for (const r of cola.slice(i)) await marcarAdjuntoError(r, "timeout: la pasada se quedó sin tiempo antes de empezar este documento");
        resumen.corte_por_tiempo = true;
        break bucle;
      }
      const ctx = await contextoCuenta(c.cuentaId);
      try {
        try { await procesarUno(c, ctx, quedaMs); }
        catch (err) {
          const msg = err.message || String(err);
          // Proveedor borrado o fusionado desde otro sitio: recargar el maestro y reintentar una vez.
          if (/23503/.test(msg) && /compras_proveedor/.test(msg)) {
            await recargarProveedores(ctx);
            await procesarUno(c, ctx, quedaMs);
          }
          // Límite de ritmo: si hay tiempo, esperar 60 s y reintentar una vez (como el navegador).
          else if (/rate limit|429/i.test(msg) && quedaMs() > 60000 + TIMEOUT_IA_MS) {
            await espera(60000);
            await procesarUno(c, ctx, quedaMs);
          } else throw err;
        }
        resumen.procesados++;
        if (c._hijos && c._hijos.length) {
          resumen.divididos++;
          anotar(c, "dividido", `dividido en ${c._hijos.length} documentos`);
          cola.splice(i + 1, 0, ...c._hijos);
          c._hijos = null;
        } else if (c.descartado) { resumen.descartados++; anotar(c, "descartado", c.descartado); }
        else if (c.duplicado) { resumen.duplicados++; anotar(c, "duplicado", c.duplicado); }
        else if (c.fusionado) { resumen.fusionados++; anotar(c, "fusionado", "folio unido a un albarán existente"); }
        else { resumen.guardados++; anotar(c, "guardado", `${c.estado || ""} ${c.estadoDet || ""}`.trim()); }
        for (const av of (c.avisos || [])) resumen.avisos.push(`${c.nombre}: ${av}`);
      } catch (err) {
        const msg = err.message || String(err);
        console.error("OCR servidor, adjunto " + c.correoAdjId + ":", msg);
        const trans = await marcarAdjuntoError(c, msg);
        if (trans) resumen.reintentables++; else resumen.errores++;
        anotar(c, trans ? "reintentable" : "error", msg);
      }
      if (i < cola.length - 1) await espera(esperaSegunCuota(GAP_MS));
    }
  }

  // Como el navegador al acabar la cola: repartos automáticos y estados.
  if (resumen.guardados || resumen.fusionados) {
    for (const fn of ["regenerar_reparto_iva", "aplicar_reparto_cups", "recalcular_estado_facturas"]) {
      try { await sb(`rpc/${fn}`, { method: "POST", body: "{}" }); } catch (e) { console.warn(fn + ":", e.message); }
    }
  }
  try {
    const r = await fetch(`${SB_URL}/rest/v1/compras_correo_adjunto?estado=eq.PENDIENTE&select=id`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "count=exact", Range: "0-0" } });
    resumen.pendientes_ahora = parseInt((r.headers.get("content-range") || "/0").split("/")[1], 10);
  } catch (_) {}
  resumen.segundos = Math.round((Date.now() - arranque) / 100) / 10;
  return resumen;
}
