// Mudanza de DATOS de Compras: compras-bonita (qjfraquadsvtfwolfbkb) → hostelero.
// Se lee de origen con la clave anon (la app vieja es anon: los datos son legibles
// así desde siempre) y se escribe en hostelero con la service key. Upsert por PK:
// el script es reanudable y sirve también para pasadas delta antes del corte.
//
// Uso:  ORIGEN_ANON="eyJ..." node scripts/migrar-compras-datos.mjs [tabla]
// Los triggers de destino deben estar desactivados antes (y reactivados después):
// eso lo hace quien lanza el script vía SQL (alter table ... disable trigger user).

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

// Orden de FKs: primero los padres.
const TABLAS = [
  { t: "compras_centro_coste", pk: "codigo" },
  { t: "compras_cuenta_a3", pk: "cuenta" },
  { t: "compras_cups", pk: "id" },
  { t: "compras_regla", pk: "id" },
  { t: "compras_terminal", pk: "codigo" },
  { t: "compras_tipo_iva", pk: "codigo" },
  { t: "compras_proveedor", pk: "id" },
  { t: "compras_producto", pk: "id" },
  { t: "compras_correo", pk: "id" },
  { t: "compras_doc", pk: "id" },
  { t: "compras_linea", pk: "id" },
  { t: "compras_doc_reparto", pk: "id" },
  { t: "compras_correo_adjunto", pk: "id" },
];

const LOTE = 500;

async function conReintentos(fn, veces = 4) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= veces) throw e;
      console.log(`   reintento ${i + 1}: ${e.message}`);
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

async function copiarTabla({ t, pk }) {
  let offset = 0, total = 0;
  for (;;) {
    const filas = await conReintentos(async () => {
      const r = await fetch(
        `${ORIGEN_URL}/rest/v1/${t}?select=*&order=${pk}.asc&limit=${LOTE}&offset=${offset}`,
        { headers: { apikey: ORIGEN_ANON, Authorization: `Bearer ${ORIGEN_ANON}` } },
      );
      if (!r.ok) throw new Error(`${t} lectura ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r.json();
    });
    if (!filas.length) break;

    await conReintentos(async () => {
      const r = await fetch(`${DESTINO_URL}/rest/v1/${t}?on_conflict=${pk}`, {
        method: "POST",
        headers: {
          apikey: DESTINO_KEY,
          Authorization: `Bearer ${DESTINO_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(filas),
      });
      if (!r.ok) throw new Error(`${t} escritura ${r.status}: ${(await r.text()).slice(0, 300)}`);
    });

    total += filas.length;
    offset += LOTE;
    console.log(`   ${t}: ${total}`);
    if (filas.length < LOTE) break;
  }
  return total;
}

const soloTabla = process.argv[2];
let resumen = [];
for (const def of TABLAS) {
  if (soloTabla && def.t !== soloTabla) continue;
  console.log(`→ ${def.t}`);
  const n = await copiarTabla(def);
  resumen.push(`${def.t}: ${n}`);
}
console.log("\nHECHO\n" + resumen.join("\n"));
