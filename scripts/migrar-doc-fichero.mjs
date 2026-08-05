/**
 * Módulo Documentos — traslado del único fichero del bucket público `documentos`
 * del proyecto legado (ratios-bonita, SOLO LECTURA) al bucket privado `docs`
 * de hostelero, más la fila en docs_documentos (§2 de docs/migracion-curso-docs.md).
 *
 * Ruta destino: <cuenta_id>/<categoria>/<fichero> — el primer segmento DEBE ser
 * el cuenta_id: la política de storage.objects lo usa para aislar inquilinos.
 * archivo_url del legado NO se migra: la URL se firma bajo demanda en el server.
 *
 * Claves: SOLO desde .env.local (en .gitignore). El fichero viaja en memoria.
 * Uso:  node scripts/migrar-doc-fichero.mjs
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca

// ---------- .env.local ----------
const env = {};
for (const linea of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const l = linea.trim();
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const [k, ...v] = l.split("=");
  env[k.trim()] = v.join("=").trim();
}
const ORIGEN_URL = env.RATIOS_URL;
const ORIGEN_KEY = env.RATIOS_SECRET_KEY;
const HOSTELERO_URL = env.HOSTELERO_URL;
const HOSTELERO_KEY = env.HOSTELERO_SECRET_KEY;
if (!ORIGEN_URL || !ORIGEN_KEY || !HOSTELERO_URL || !HOSTELERO_KEY) {
  console.error("Faltan claves en .env.local — revisa RATIOS_* y HOSTELERO_*.");
  process.exit(1);
}

const cab = (key, extra = {}) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  ...extra,
});
const json = { "Content-Type": "application/json" };

async function pedir(url, opts, que) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${que} ${res.status}: ${await res.text()}`);
  return res;
}

// 1. Fila y taxonomía del legado
const [doc] = await (
  await pedir(`${ORIGEN_URL}/rest/v1/doc_documentos?select=*`, { headers: cab(ORIGEN_KEY) }, "GET doc_documentos")
).json();
if (!doc) throw new Error("doc_documentos vacío en origen");
const [dep] = await (
  await pedir(`${ORIGEN_URL}/rest/v1/doc_departamentos?id=eq.${doc.departamento_id}&select=nombre`, { headers: cab(ORIGEN_KEY) }, "GET doc_departamentos")
).json();
const [sub] = doc.subcategoria_id
  ? await (
      await pedir(`${ORIGEN_URL}/rest/v1/doc_subcategorias?id=eq.${doc.subcategoria_id}&select=nombre`, { headers: cab(ORIGEN_KEY) }, "GET doc_subcategorias")
    ).json()
  : [null];
console.log(`Origen: "${doc.nombre}" · ${dep.nombre}${sub ? " / " + sub.nombre : ""} · ${doc.archivo_tamano} bytes`);

// 2. Resolver taxonomía por NOMBRE contra hostelero
const [cat] = await (
  await pedir(
    `${HOSTELERO_URL}/rest/v1/docs_categorias?cuenta_id=eq.${CUENTA_ID}&nombre=eq.${encodeURIComponent(dep.nombre)}&select=id`,
    { headers: cab(HOSTELERO_KEY) },
    "GET docs_categorias"
  )
).json();
if (!cat) throw new Error(`Categoría "${dep.nombre}" no existe en hostelero — abortar`);
let subcategoriaId = null;
if (sub) {
  const [s] = await (
    await pedir(
      `${HOSTELERO_URL}/rest/v1/docs_subcategorias?cuenta_id=eq.${CUENTA_ID}&categoria_id=eq.${cat.id}&nombre=eq.${encodeURIComponent(sub.nombre)}&select=id`,
      { headers: cab(HOSTELERO_KEY) },
      "GET docs_subcategorias"
    )
  ).json();
  if (!s) throw new Error(`Subcategoría "${sub.nombre}" no existe en hostelero — abortar`);
  subcategoriaId = s.id;
}

// centro (texto) → centro_id; vacío = documento de grupo
let centroId = null;
if (doc.centro) {
  const [c] = await (
    await pedir(
      `${HOSTELERO_URL}/rest/v1/centros?cuenta_id=eq.${CUENTA_ID}&nombre=eq.${encodeURIComponent(doc.centro)}&select=id`,
      { headers: cab(HOSTELERO_KEY) },
      "GET centros"
    )
  ).json();
  if (!c) throw new Error(`Centro "${doc.centro}" no existe en hostelero — abortar`);
  centroId = c.id;
}

// 3. Descargar del bucket legado
const fichero = await (
  await pedir(`${ORIGEN_URL}/storage/v1/object/documentos/${doc.archivo_path}`, { headers: cab(ORIGEN_KEY) }, "GET fichero")
).arrayBuffer();
if (fichero.byteLength !== doc.archivo_tamano) {
  throw new Error(`Tamaño descargado ${fichero.byteLength} ≠ ${doc.archivo_tamano} declarado — abortar`);
}
console.log(`Descargado: ${fichero.byteLength} bytes`);

// 4. Subir al bucket privado `docs`: <cuenta_id>/<categoria>/<fichero>
const segmentos = doc.archivo_path.split("/");
const rutaDestino = `${CUENTA_ID}/${segmentos[0]}/${segmentos[segmentos.length - 1]}`;
await pedir(
  `${HOSTELERO_URL}/storage/v1/object/docs/${rutaDestino}`,
  {
    method: "POST",
    headers: cab(HOSTELERO_KEY, { "Content-Type": "application/msword" }),
    body: fichero,
  },
  "PUT fichero"
);
console.log(`Subido a docs/${rutaDestino}`);

// 5. Fila en docs_documentos (sin archivo_url: la firma es bajo demanda)
await pedir(
  `${HOSTELERO_URL}/rest/v1/docs_documentos`,
  {
    method: "POST",
    headers: cab(HOSTELERO_KEY, { ...json, Prefer: "return=minimal" }),
    body: JSON.stringify({
      cuenta_id: CUENTA_ID,
      categoria_id: cat.id,
      subcategoria_id: subcategoriaId,
      centro_id: centroId,
      nombre: doc.nombre,
      descripcion: doc.descripcion,
      archivo_path: rutaDestino,
      archivo_nombre: doc.archivo_nombre,
      archivo_tipo: doc.archivo_tipo,
      archivo_tamano: doc.archivo_tamano,
      subido_por: null,
      subido_por_legado: doc.subido_por,
      creado_en: doc.creado_en,
      actualizado_en: doc.actualizado_en,
    }),
  },
  "POST docs_documentos"
);
console.log("Fila insertada en docs_documentos.\n\nHecho.");
