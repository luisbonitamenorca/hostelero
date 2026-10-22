#!/usr/bin/env node
// scripts/maestros/catalogo-a-json.mjs · Convierte el listado de productos de un proveedor (PDF de
// tarifa, Excel o CSV) al JSON normalizado que carga cargar-maestro.mjs en el maestro común (mae_*).
//
//   node scripts/maestros/catalogo-a-json.mjs --proveedor "AGUSTÍN TORRELLA, S.A." --nif A08XXXXXX \
//        --salida ~/Downloads/maestro-atsa.json "~/Downloads/PAG 09  MONTESIERRA - MARTIN MARTIN.pdf" ...
//   node scripts/maestros/catalogo-a-json.mjs --proveedor "MENORCA FRUIT" --nif A07111156 \
//        --col-ref "Código" --col-nombre "Descripción" --col-precio PVP --salida ~/Downloads/maestro-menorcafruit.json "~/Downloads/LISTA MENORCAFRUIT.xlsx"
//
// Opciones:
//   --proveedor / --nif        nombre y NIF del proveedor (el NIF es la clave del maestro)
//   --ean                      el «código» del proveedor es un EAN (Biona): se guarda también en ean
//   --vigente AAAA-MM-DD       fecha de la tarifa (si el PDF la trae, se lee de «EN VIGOR dd/mm/aaaa»)
//   --col-ref, --col-nombre, --col-precio, --col-ean, --col-formato, --col-marca, --col-categoria
//                              cabeceras de las columnas en Excel/CSV (si no se dan, se adivinan)
//   --salida fichero.json      dónde dejar el JSON (por defecto, junto al primer fichero de entrada)
//   --excel                    deja además un Excel de revisión junto al JSON
//
// PDF: se pasa por `pdftotext -layout` (poppler) y se interpreta por columnas a partir de la línea de
// cabecera de cada bloque (la que dice PRODUCTE / Producto / Referencia / NOM COMERCIAL): lo que hay
// antes son los códigos, lo que hay entre la descripción y el precio es el formato. Está probado con
// la tarifa de Agustín Torrella (14 páginas, 12 maquetaciones distintas, incluida la de dos columnas de
// Santa Rosalía). Si un proveedor manda otra cosa, lo normal es ajustar aquí la detección de cabeceras,
// no reescribir nada.
//
// El JSON de salida: { proveedor:{nombre,nif,codigos_son_ean}, fuente, archivo, vigente_desde,
//   productos:[{ref_proveedor, ref_fabricante, ean, nombre, marca, categoria, formato, unidad_venta,
//   unidades_caja, contenido, contenido_unidad, precio_tarifa, precio_tarifa_desde, caducidad, pagina}] }

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

/* ───────────────────────── argumentos ───────────────────────── */
const args = process.argv.slice(2);
const opt = {};
const ficheros = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    if (["ean", "excel"].includes(k)) opt[k] = true;
    else opt[k] = args[++i];
  } else ficheros.push(a.replace(/^~/, process.env.HOME));
}
if (!ficheros.length || !opt.proveedor) {
  console.error("Uso: catalogo-a-json.mjs --proveedor NOMBRE [--nif NIF] [--ean] [--vigente AAAA-MM-DD] [--salida x.json] fichero...");
  process.exit(1);
}

/* ───────────────────────── utilidades ───────────────────────── */
const num = (s) => {
  if (s == null) return null;
  let t = String(s).trim().replace(/€/g, "").trim();
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else if (/,/.test(t) && !/\.\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
};
const limpiar = (s) => String(s || "").replace(/\s+/g, " ").trim();
const fechaEs = (s) => {
  const m = String(s || "").match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (!m) return null;
  const y = m[3].length === 2 ? "20" + m[3] : m[3];
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

// Del texto de formato («UNI. 6u x 0,75l 4,5L», «KGS. 1 Pç. 7/8 Kg», «Bolsa 1 kg. 1 Ud.») se deduce
// lo que se pueda. Es heurístico: formato_fiable queda a false para que alguien lo revise.
function interpretarFormato(txt, nombre) {
  const r = { unidad_venta: null, unidades_caja: null, contenido: null, contenido_unidad: null };
  const t = " " + String(txt || "").replace(/×/g, "x") + " ";
  const n = " " + String(nombre || "").replace(/×/g, "x") + " ";
  if (/\s(KGS?\.?|KG\/U|€\/KGS?\.?)\s/i.test(t) || /€\/kg/i.test(t)) r.unidad_venta = "kg";
  else if (/\s(UNI?T?\.?|UN\.?|UNI\.|UND\.?|€\/und|€\/ud|Un\.)\s/i.test(t) || /€\/und/i.test(t)) r.unidad_venta = "ud";
  else if (/\s(L\.|LT\.?|LITRE)\s/i.test(t)) r.unidad_venta = "l";
  // unidades por caja: «6u x», «12 x 0,250», «Cajas 24 Ud.», «10 PZ.», «2 Pc.», «8 UN»
  let m = t.match(/(\d+)\s*(?:u|ud|uds|un|p|pç|pc|pz|pza|pcs|pzas)?\.?\s*x\s*\d/i) || t.match(/x\s*(\d+)\s*(?:u|ud|un|pz|pcs|uds)\b/i)
    || t.match(/(?:caixa|cajas?|caja)\s*(\d+)/i) || t.match(/(\d+)\s*(?:PZ|PÇ|Pc|Pç|UN|UD|Ud|u)\b\.?/)
    || t.match(/\s(\d+)\s*$/) /* columna «U×caja» suelta */;
  if (m) r.unidades_caja = num(m[1]);
  // contenido de una unidad: «0,75l», «250 gr», «1 kg», «2,2 L», «150 GR», «5 L.»
  const re = /(\d+(?:[.,]\d+)?)\s*(kg|kgs|gr|grs|g|ml|cl|l)\b\.?/i;
  m = t.match(re) || n.match(re);
  if (m) {
    const v = num(m[1]); const u = m[2].toLowerCase();
    if (u.startsWith("k")) { r.contenido = v; r.contenido_unidad = "kg"; }
    else if (u.startsWith("g")) { r.contenido = v / 1000; r.contenido_unidad = "kg"; }
    else if (u === "ml") { r.contenido = v / 1000; r.contenido_unidad = "l"; }
    else if (u === "cl") { r.contenido = v / 100; r.contenido_unidad = "l"; }
    else if (u === "l") { r.contenido = v; r.contenido_unidad = "l"; }
  }
  if (r.contenido != null) r.contenido = Math.round(r.contenido * 1000) / 1000;
  return r;
}

/* ───────────────────────── PDF de tarifa (por columnas) ───────────────────────── */
const RE_CAB_DESC = /\b(PRODUCTE|PRODUCTO|Producto|Producte|Referencia|NOM COMERCIAL)\b/;
const RE_PRECIO = /(\d{1,3}(?:\.\d{3})*,\d{2,4})\s*(€\/?\s*(?:kg|Kg|KG|und|Un|ud|Ud)?\.?|Un\.|Kg\.|S\/P)?\s*$/;
const RE_SIN_PRECIO = /\b(s\/e|S\/E|S\/Mercado|S\/MERCADO|Descatalog\.?)\s*$/;
const RE_MARCADOR = /^[\s↑*]*/;
const RE_CODIGO = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/i;

function textoPdf(f) {
  return execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// Una «hoja» = lista de líneas de una página o de media página (tarifas a dos columnas).
function hojasDe(texto) {
  const paginas = texto.split("\f");
  const hojas = [];
  for (let p = 0; p < paginas.length; p++) {
    const lineas = paginas[p].split("\n");
    if (!lineas.some((l) => l.trim())) continue;
    // ¿dos columnas? una cabecera con «ATSA» (o «Producto») dos veces → se parte en la segunda
    let corte = null;
    for (const l of lineas) {
      const idx = [...l.matchAll(/\bATSA\b|\bProducto\b/g)].map((m) => m.index);
      const a = [...l.matchAll(/\bATSA\b/g)].map((m) => m.index);
      if (a.length >= 2) { corte = a[1] - 1; break; }
      if (idx.length >= 2 && idx[1] - idx[0] > 60) { corte = Math.max(0, idx[1] - 40); break; }
    }
    if (corte) {
      hojas.push({ pagina: p + 1, lineas: lineas.map((l) => l.slice(0, corte)) });
      hojas.push({ pagina: p + 1, lineas: lineas.map((l) => l.slice(corte)) });
    } else hojas.push({ pagina: p + 1, lineas });
  }
  return hojas;
}

function parsearHoja(hoja, estado) {
  const out = [];
  const L = hoja.lineas;
  let col = null;          // {desc, descEsReferencia}: columna de la descripción según la cabecera del bloque
  let pendienteDesc = null; // descripción partida en varias líneas
  const celdas = (l) => { const r = []; for (const m of l.matchAll(/\S+(?: \S+)*/g)) r.push({ ini: m.index, txt: m[0] }); return r; };
  const esCodigo = (x) => x === "-" || (RE_CODIGO.test(x) && !/^(KG|KGS|UN|UNI|UNIT|L|GR|G|ML|CL|PZ|PC|PÇ|UD|UDS)\.?$/i.test(x));
  for (let i = 0; i < L.length; i++) {
    const l = L[i].replace(/\t/g, "    ");
    const t = l.trim();
    if (!t) { pendienteDesc = null; continue; }

    // vigencia / marca
    const mv = t.match(/EN\s+VIGOR(?:\s+EL)?\s*:?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/i);
    if (mv) {
      estado.vigente = fechaEs(mv[1]) || estado.vigente;
      const antes = limpiar(t.slice(0, mv.index)).replace(/\bBCN\b/g, "").trim();
      const despues = limpiar(t.slice(mv.index + mv[0].length)).replace(/\bBCN\b/g, "").trim();
      const cand = antes || despues;
      if (cand && !RE_CAB_DESC.test(cand) && !/TARIFA|ACTUALI/i.test(cand)) estado.marca = cand;
      else {
        for (const j of [i - 1, i + 1, i - 2]) {
          const s = limpiar((L[j] || "").replace(/\bBCN\b/g, ""));
          if (s && /[A-ZÀ-Ý]{3}/.test(s) && !/TARIFA|ACTUALI|EN VIGOR|PÁG|PAG\b|VALORACI/i.test(s) && !RE_CAB_DESC.test(s) && !RE_PRECIO.test(s)) { estado.marca = s; break; }
        }
      }
      estado.categoria = null;
      continue;
    }
    if (/TARIFA DE PRE|ACTUALI[TZ]ADA|^P[ÁA]G\.?\s*\d|VALORACI[OÓ]|^BCN$|^\.{3,}|^…+$|^S\/P\s+Els productes/i.test(t)) continue;

    // cabecera de bloque: dónde está la columna de la descripción
    const mc = l.match(RE_CAB_DESC);
    if (mc && !RE_PRECIO.test(t)) { col = { desc: mc.index, descEsReferencia: /Referencia/.test(mc[0]) }; pendienteDesc = null; continue; }
    if (/^(C[ÓO]D\.?|ATSA|FCA\.?|COD\.|F[ÁA]BRICA|U\/B|Kgs?\.|Peces|CAIXA|PREU|EUROS|PRECIO|TARIFA|Kg\/U|Peso|Pes\b|CADUC|MINIMA|U\s*[x×]|aprox|\(gr\.\)|PREFERENT|PER CAIXA|U\/KGS|FORMAT|A[45]$)/.test(t) && !RE_PRECIO.test(t)) continue;

    // celdas (separadas por 2+ espacios), sin el marcador ↑/* del principio
    const sinMarca = l.replace(/^(\s*)[↑*]+/, "$1 ");
    const cs = celdas(sinMarca);
    // marcador ↑/* de la columna de al lado (tarifas a dos columnas) colgado al final
    while (cs.length && /^[↑*]+$/.test(cs[cs.length - 1].txt)) cs.pop();
    if (!cs.length) continue;
    // precio: última celda si es un precio (o «s/e»)
    let precio = null, precioTxt = "", sinPrecio = false;
    let ult = cs[cs.length - 1];
    let mp = ult.txt.match(RE_PRECIO);
    if (!mp && cs.length >= 2 && /^(€\/?\s*\w*\.?|Un\.|Kg\.|S\/P)$/.test(ult.txt) && (mp = cs[cs.length - 2].txt.match(RE_PRECIO))) { precioTxt = ult.txt; cs.pop(); ult = cs[cs.length - 1]; }
    if (mp) { precio = num(mp[1]); precioTxt = (precioTxt || mp[2] || "").trim(); cs.pop(); }
    else if (RE_SIN_PRECIO.test(ult.txt)) { sinPrecio = true; cs.pop(); }
    // descripción: la celda con letras más cercana a la columna de la cabecera (o la primera con letras)
    const conLetras = cs.map((c, k) => ({ ...c, k })).filter((c) => /[A-Za-zÀ-ÿ]{3}/.test(c.txt) && !/^\d+\s*(DIES|DIAS|MESOS|MESES|ANYS|días|dies)$/i.test(c.txt));
    let descCel;
    if (!conLetras.length) {
      // línea de códigos sin descripción: la descripción iba en la línea de arriba (Arotz, Santa Rosalía)
      if (!pendienteDesc || cs.length < 2) continue;
      descCel = { ini: col ? col.desc : cs[0].ini, txt: "", k: 1 };
    } else descCel = col ? conLetras.reduce((a, c) => Math.abs(c.ini - col.desc) < Math.abs(a.ini - col.desc) ? c : a) : conLetras[0];
    // la descripción venía en la línea de arriba y la celda con letras más cercana es en realidad el formato
    if (col && pendienteDesc && descCel.txt && descCel.ini - col.desc > 25) {
      const k = Math.max(1, cs.findIndex((c) => c.ini >= col.desc - 2));
      descCel = { ini: col.desc, txt: "", k: k < 0 ? 1 : k };
    }
    // códigos pegados a la descripción con un solo espacio («20517 9020012AP TOMAQUET…»)
    if (cs.slice(0, descCel.k).flatMap((c) => c.txt.split(/\s+/)).length < 2) {
      const tk = descCel.txt.split(/\s+/); const pelados = [];
      while (tk.length > 1 && pelados.length < 3 && /\d/.test(tk[0]) && esCodigo(tk[0]) && tk.slice(1).join(" ").match(/[A-Za-zÀ-ÿ]{3}/)) pelados.push(tk.shift());
      if (pelados.length) { cs.splice(descCel.k, 0, ...pelados.map((x, q) => ({ ini: descCel.ini + q, txt: x }))); descCel = { ...descCel, txt: tk.join(" "), k: descCel.k + pelados.length }; }
    }
    // códigos: los tokens de las celdas anteriores a la descripción (Santa Teresa: solo las 2 primeras)
    const previas = cs.slice(0, descCel.k);
    const toks = previas.flatMap((c) => c.txt.split(/\s+/));
    let codToks = toks, fmtPrevio = "";
    if (col && col.descEsReferencia) { codToks = toks.slice(0, 2); fmtPrevio = toks.slice(2).join(" "); }
    const codigosOk = codToks.length >= 1 && codToks.length <= 3 && codToks.every(esCodigo) && codToks.some((x) => x !== "-");
    const resto = limpiar([fmtPrevio, ...cs.slice(descCel.k + 1).map((c) => c.txt)].join("  "));
    if (process.env.DEBUG) console.error("L", { precio, sinPrecio, codigosOk, codToks, desc: descCel.txt.slice(0, 40), resto });

    if ((precio != null || sinPrecio) && codigosOk) {
      let ref, refFca;
      if (estado.fcaPrimero) { refFca = codToks[0] === "-" ? null : codToks[0]; ref = codToks[1] || null; }
      else { ref = codToks[0]; refFca = codToks[1] && codToks[1] !== "-" ? codToks[1] : null; }
      if (!ref || ref === "-") continue;
      let nombre = limpiar(descCel.txt);
      if (pendienteDesc) { nombre = limpiar(pendienteDesc + " " + nombre); pendienteDesc = null; }
      if (!nombre) continue;
      // descripción que sigue en la línea de abajo (Arotz): solo letras, sin códigos ni precio, en la misma columna
      const sig = (L[i + 1] || "");
      const csS = celdas(sig.replace(/^(\s*)[↑*]+/, "$1 "));
      if (csS.length === 1 && Math.abs(csS[0].ini - descCel.ini) <= 3 && /[A-Za-zÀ-ÿ0-9]{2}/.test(csS[0].txt) && !RE_PRECIO.test(csS[0].txt) && (csS[0].txt.length < 15 || !/^[A-ZÀ-Ý0-9 .,'"&\/()\-]{3,40}$/.test(csS[0].txt))) {
        nombre = limpiar(nombre + " " + csS[0].txt); i++;
      }
      const fmt = interpretarFormato(resto + " " + precioTxt, nombre);
      if (/kg/i.test(precioTxt)) fmt.unidad_venta = "kg";
      if (/und|ud|Un\./i.test(precioTxt)) fmt.unidad_venta = "ud";
      out.push({
        ref_proveedor: ref, ref_fabricante: refFca, ean: null, nombre, marca: estado.marca || null,
        categoria: estado.categoria || null, formato: resto || null, ...fmt,
        precio_tarifa: precio, precio_tarifa_desde: estado.vigente || null,
        caducidad: (resto.match(/\d+\s*(?:DIES|DIAS|días|dies|MESOS|MESES|ANYS)/i) || [null])[0],
        pagina: hoja.pagina, sobre_pedido: precioTxt === "S/P" || null,
      });
      continue;
    }
    // sin precio ni códigos: categoría (CUITS, FORMATGES, SAFATES DE KG…) o trozo de descripción
    if (!codigosOk && precio == null && cs.length === 1) {
      const d = limpiar(cs[0].txt);
      const sigTieneCod = (() => { const n = celdas((L[i + 1] || "").replace(/^(\s*)[↑*]+/, "$1 ")); return n.length > 1 && /\d/.test(n[0].txt) && esCodigo(n[0].txt.split(/\s+/)[0]) && (RE_PRECIO.test(n[n.length - 1].txt) || (n.length > 2 && RE_PRECIO.test(n[n.length - 2].txt))); })();
      if (/^[A-ZÀ-Ý0-9 .,'"&\/()\-]+$/.test(d) && d.length < 48 && !/\d{2},\d{2}/.test(d) && !(sigTieneCod && !/^[A-Z ]+$/.test(d))) { estado.categoria = d; pendienteDesc = null; }
      else pendienteDesc = d;
      continue;
    }
  }
  return out;
}

function parsearPdf(f) {
  const texto = textoPdf(f);
  const estado = { marca: null, categoria: null, vigente: null, fcaPrimero: /C[ÓO]D\.\s*\n?\s*F[ÁA]BRICA\s+ATSA/i.test(texto) || /FÁBRICA\s+ATSA/.test(texto) };
  const productos = [];
  for (const h of hojasDe(texto)) {
    // en cada media hoja arrancamos la categoría pero conservamos marca y vigencia
    estado.categoria = null;
    productos.push(...parsearHoja(h, estado));
  }
  // marca por defecto: el nombre del fichero sin «PAG. NN»
  const marcaFichero = limpiar(basename(f, extname(f)).replace(/^PAG\.?\s*\d+\s*/i, "")).replace(/_A$/, "");
  for (const p of productos) if (!p.marca) p.marca = marcaFichero;
  return { productos, vigente: estado.vigente };
}

/* ───────────────────────── Excel / CSV ───────────────────────── */
function parsearTabla(f) {
  const XLSX = require("xlsx");
  const wb = XLSX.readFile(f);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  // cabecera: primera fila con ≥2 textos
  let ic = filas.findIndex((r) => r.filter((c) => typeof c === "string" && c.trim()).length >= 2);
  if (ic < 0) throw new Error("no encuentro la fila de cabeceras");
  const cab = filas[ic].map((c) => limpiar(c).toLowerCase());
  const busca = (nombreOpt, ...candidatos) => {
    if (opt[nombreOpt]) { const k = cab.indexOf(opt[nombreOpt].toLowerCase()); if (k < 0) throw new Error(`no existe la columna «${opt[nombreOpt]}»`); return k; }
    for (const c of candidatos) { const k = cab.findIndex((h) => h === c || h.startsWith(c)); if (k >= 0) return k; }
    return -1;
  };
  const kRef = busca("col-ref", "código", "codigo", "cód.", "cod.", "ref", "referencia", "articulo", "artículo", "ean");
  const kNom = busca("col-nombre", "descripción", "descripcion", "nombre", "producto", "artículo", "articulo", "denominación");
  const kPre = busca("col-precio", "pvp", "precio", "tarifa", "coste", "p.v.p");
  const kEan = busca("col-ean", "ean", "código de barras", "codigo de barras", "barras");
  const kFmt = busca("col-formato", "formato", "envase", "presentación", "presentacion", "unidad");
  const kMar = busca("col-marca", "marca");
  const kCat = busca("col-categoria", "categoría", "categoria", "familia", "grupo");
  if (kRef < 0 || kNom < 0) throw new Error(`no distingo las columnas de código y descripción en: ${cab.join(" | ")}`);
  const productos = [];
  for (const r of filas.slice(ic + 1)) {
    const ref = limpiar(r[kRef]); const nombre = limpiar(r[kNom]);
    if (!ref || !nombre) continue;
    const formato = kFmt >= 0 ? limpiar(r[kFmt]) : "";
    productos.push({
      ref_proveedor: ref, ref_fabricante: null, ean: kEan >= 0 ? limpiar(r[kEan]) || null : (opt.ean ? ref : null),
      nombre, marca: kMar >= 0 ? limpiar(r[kMar]) || null : null, categoria: kCat >= 0 ? limpiar(r[kCat]) || null : null,
      formato: formato || null, ...interpretarFormato(formato, nombre),
      precio_tarifa: kPre >= 0 ? num(r[kPre]) : null, precio_tarifa_desde: opt.vigente || null, caducidad: null, pagina: null,
    });
  }
  return { productos, vigente: opt.vigente || null };
}

/* ───────────────────────── principal ───────────────────────── */
const todos = [];
let vigente = opt.vigente || null;
for (const f of ficheros) {
  if (!existsSync(f)) { console.error("No existe:", f); process.exit(1); }
  const ext = extname(f).toLowerCase();
  const r = ext === ".pdf" ? parsearPdf(f) : parsearTabla(f);
  if (!vigente && r.vigente) vigente = r.vigente;
  console.error(`${basename(f)}: ${r.productos.length} productos`);
  todos.push(...r.productos.map((p) => ({ ...p, archivo: basename(f) })));
}
// repetidos dentro del mismo listado (Montesierra lista dos veces la 6508): se queda la última
const porRef = new Map();
for (const p of todos) {
  const k = p.ref_proveedor.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+(?=\d)/, "");
  if (porRef.has(k)) porRef.get(k)._repetido = true;
  porRef.set(k, p);
}
const productos = [...porRef.values()];
if (opt.ean) for (const p of productos) if (!p.ean) p.ean = p.ref_proveedor;
for (const p of productos) if (!p.precio_tarifa_desde) p.precio_tarifa_desde = vigente;

const salida = {
  proveedor: { nombre: opt.proveedor, nif: opt.nif || null, codigos_son_ean: !!opt.ean },
  fuente: "catalogo", archivo: ficheros.map((f) => basename(f)).join(" · "), vigente_desde: vigente,
  generado_en: new Date().toISOString(), productos,
};
const destino = opt.salida ? opt.salida.replace(/^~/, process.env.HOME) : resolve(dirname(ficheros[0]), `maestro-${limpiar(opt.proveedor).toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`);
writeFileSync(destino, JSON.stringify(salida, null, 1));
console.error(`→ ${productos.length} productos (${todos.length - productos.length} repetidos fundidos) en ${destino}`);
if (opt.excel) {
  const XLSX = require("xlsx");
  const ws = XLSX.utils.json_to_sheet(productos.map((p) => ({
    Ref: p.ref_proveedor, "Ref. fábrica": p.ref_fabricante, EAN: p.ean, Producto: p.nombre, Marca: p.marca, Categoría: p.categoria,
    Formato: p.formato, "Precio por": p.unidad_venta, "Uds/caja": p.unidades_caja, Contenido: p.contenido, "Ud. contenido": p.contenido_unidad,
    Tarifa: p.precio_tarifa, Vigente: p.precio_tarifa_desde, Caducidad: p.caducidad, "Sobre pedido": p.sobre_pedido ? "S/P" : "", Página: p.pagina, Fichero: p.archivo,
  })));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Catálogo");
  const xl = destino.replace(/\.json$/, ".xlsx"); XLSX.writeFile(wb, xl);
  console.error(`→ Excel de revisión: ${xl}`);
}
