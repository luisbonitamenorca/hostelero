// Mudanza del STORAGE de Compras: bucket 'documentos' completo (fotos de
// albaranes, PDFs de correo) de compras-bonita a hostelero. El listado sale
// de la vista _storage_export del origen (anon), la descarga es por URL
// pública y la subida con la service key. Reanudable: si el fichero ya está
// en destino (HEAD 200 por URL pública), se salta.
//
// Uso:  ORIGEN_ANON="eyJ..." node scripts/migrar-compras-storage.mjs

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const linea of readFileSync(resolve(raiz, ".env.local"), "utf8").split("\n")) {
  const m = linea.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const ORIGEN_URL = "https://qjfraquadsvtfwolfbkb.supabase.co";
const ORIGEN_ANON = process.env.ORIGEN_ANON;
const DESTINO_URL = process.env.HOSTELERO_URL;
const DESTINO_KEY = process.env.HOSTELERO_SERVICE_KEY;
if (!ORIGEN_ANON || !DESTINO_URL || !DESTINO_KEY) {
  console.error("Faltan ORIGEN_ANON / HOSTELERO_URL / HOSTELERO_SERVICE_KEY");
  process.exit(1);
}

// listado completo, paginado
const ficheros = [];
for (let offset = 0; ; offset += 1000) {
  const r = await fetch(
    `${ORIGEN_URL}/rest/v1/_storage_export?select=*&order=name.asc&limit=1000&offset=${offset}`,
    { headers: { apikey: ORIGEN_ANON, Authorization: `Bearer ${ORIGEN_ANON}` } },
  );
  if (!r.ok) { console.error("listado", r.status, await r.text()); process.exit(1); }
  const pagina = await r.json();
  ficheros.push(...pagina);
  if (pagina.length < 1000) break;
}
console.log(`Ficheros en origen: ${ficheros.length}`);

let copiados = 0, saltados = 0, fallos = [];

async function copiar(f) {
  const nombre = encodeURIComponent(f.name).replace(/%2F/g, "/");
  const urlDestino = `${DESTINO_URL}/storage/v1/object/public/documentos/${nombre}`;
  // ¿ya está?
  const head = await fetch(urlDestino, { method: "HEAD" });
  if (head.ok) { saltados++; return; }

  for (let intento = 0; intento < 3; intento++) {
    try {
      const desc = await fetch(`${ORIGEN_URL}/storage/v1/object/public/documentos/${nombre}`);
      if (!desc.ok) throw new Error(`descarga ${desc.status}`);
      const cuerpo = Buffer.from(await desc.arrayBuffer());
      const sub = await fetch(`${DESTINO_URL}/storage/v1/object/documentos/${nombre}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DESTINO_KEY}`,
          "Content-Type": f.mime || "application/octet-stream",
          "x-upsert": "true",
        },
        body: cuerpo,
      });
      if (!sub.ok) throw new Error(`subida ${sub.status}: ${(await sub.text()).slice(0, 120)}`);
      copiados++;
      return;
    } catch (e) {
      if (intento === 2) { fallos.push(`${f.name}: ${e.message}`); return; }
      await new Promise(r => setTimeout(r, 2000 * (intento + 1)));
    }
  }
}

const PARALELO = 6;
for (let i = 0; i < ficheros.length; i += PARALELO) {
  await Promise.all(ficheros.slice(i, i + PARALELO).map(copiar));
  if ((i / PARALELO) % 20 === 0 || i + PARALELO >= ficheros.length)
    console.log(`   ${Math.min(i + PARALELO, ficheros.length)}/${ficheros.length} (copiados ${copiados}, ya estaban ${saltados}, fallos ${fallos.length})`);
}

console.log(`\nHECHO: copiados ${copiados}, ya estaban ${saltados}, fallos ${fallos.length}`);
if (fallos.length) { console.log("FALLOS:"); fallos.forEach(f => console.log(" - " + f)); process.exitCode = 1; }
