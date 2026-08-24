// Pasada DELTA del flujo de CORREO: lo que la base vieja acumuló entre la
// migración (24-08 madrugada) y el corte del IMAP. Quirúrgica a propósito:
//  - correos y facturas: upsert (los estados que revisó Lucía estos días mandan;
//    en hostelero nadie tocó facturas, era la regla del puente)
//  - adjuntos, proveedores y productos: SOLO los que falten (ignore-duplicates);
//    jamás se pisan las fusiones/pautas/estados hechos en hostelero
//  - albaranes: NI TOCARLOS (viven solo en hostelero desde el port)
//
// Uso:  ORIGEN_ANON="eyJ..." node scripts/delta-compras-correo.mjs

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
if (!ORIGEN_ANON || !DESTINO_URL || !DESTINO_KEY) { console.error("faltan claves"); process.exit(1); }

async function leer(ruta) {
  const filas = [];
  for (let off = 0; ; off += 500) {
    const r = await fetch(`${ORIGEN_URL}/rest/v1/${ruta}${ruta.includes("?") ? "&" : "?"}limit=500&offset=${off}`,
      { headers: { apikey: ORIGEN_ANON, Authorization: `Bearer ${ORIGEN_ANON}` } });
    if (!r.ok) throw new Error(`${ruta}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const p = await r.json(); filas.push(...p); if (p.length < 500) break;
  }
  return filas;
}

async function escribir(tabla, filas, pk, modo) {
  if (!filas.length) return 0;
  let ok = 0, saltadas = 0;
  const post = (cuerpo) => fetch(`${DESTINO_URL}/rest/v1/${tabla}?on_conflict=${pk}`, {
    method: "POST",
    headers: {
      apikey: DESTINO_KEY, Authorization: `Bearer ${DESTINO_KEY}`,
      "Content-Type": "application/json",
      Prefer: `resolution=${modo},return=minimal`,
    },
    body: JSON.stringify(cuerpo),
  });
  for (let i = 0; i < filas.length; i += 300) {
    const lote = filas.slice(i, i + 300);
    const r = await post(lote);
    if (r.ok) { ok += lote.length; continue; }
    if (r.status !== 409) throw new Error(`${tabla}: ${r.status} ${(await r.text()).slice(0, 300)}`);
    // choque con OTRO único (p.ej. proveedor+ref tras una fusión en hostelero):
    // fila a fila, y la que choque se salta — la versión de hostelero manda
    for (const fila of lote) {
      const r1 = await post([fila]);
      if (r1.ok) ok++;
      else if (r1.status === 409) saltadas++;
      else throw new Error(`${tabla}: ${r1.status} ${(await r1.text()).slice(0, 300)}`);
    }
  }
  return saltadas ? `${ok} (+${saltadas} saltadas por choque)` : ok;
}

const R = {};
R.proveedores = await escribir("compras_proveedor", await leer("compras_proveedor?select=*"), "id", "ignore-duplicates");
R.productos   = await escribir("compras_producto", await leer("compras_producto?select=*&created_at=gte.2026-08-24T01:00:00"), "id", "ignore-duplicates");
R.correos     = await escribir("compras_correo", await leer("compras_correo?select=*"), "id", "merge-duplicates");
R.adjuntos    = await escribir("compras_correo_adjunto", await leer("compras_correo_adjunto?select=*&id=gt.1333"), "id", "ignore-duplicates");
R.facturas    = await escribir("compras_doc", await leer("compras_doc?select=*&tipo=eq.factura"), "id", "merge-duplicates");
R.lineas_fac  = await escribir("compras_linea",
  await leer("compras_linea?select=*,compras_doc!inner(tipo)&compras_doc.tipo=eq.factura")
    .then(fs => fs.map(({ compras_doc, ...l }) => l)), "id", "merge-duplicates");
R.repartos    = await escribir("compras_doc_reparto", await leer("compras_doc_reparto?select=*"), "id", "merge-duplicates");

console.log("DELTA HECHA", JSON.stringify(R));
