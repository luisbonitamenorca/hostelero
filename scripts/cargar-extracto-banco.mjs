/**
 * Carga un extracto bancario (JSON generado en local desde el Excel de
 * CaixaNow — el Excel NUNCA entra en el repo: lleva nombres reales) en
 * fin_banco_movimientos. Reanudable: el UNIQUE (banco_cuenta_id, hash_mov)
 * hace que recargar el mismo extracto no duplique nada (ignore-duplicates).
 *
 * Uso: node scripts/cargar-extracto-banco.mjs <ruta.json> [banco_cuenta_id]
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const linea of readFileSync(resolve(raiz, ".env.local"), "utf8").split("\n")) {
  const m = linea.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const URL = process.env.HOSTELERO_URL, KEY = process.env.HOSTELERO_SERVICE_KEY;
if (!URL || !KEY) { console.error("faltan claves en .env.local"); process.exit(1); }

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd";   // Bonita Menorca
const SOCIEDAD_ID = "798cf9dc-0146-4a24-94e8-fdb04f93ab70";
const BANCO_DEFECTO = "db3de373-fbf3-4386-9661-c1034df6766f"; // CaixaBank ...5037

const ruta = process.argv[2];
if (!ruta) { console.error("falta la ruta del JSON"); process.exit(1); }
const bancoCuentaId = process.argv[3] || BANCO_DEFECTO;

const movs = JSON.parse(readFileSync(ruta, "utf8")).map((m) => ({
  ...m,
  cuenta_id: CUENTA_ID, sociedad_id: SOCIEDAD_ID, banco_cuenta_id: bancoCuentaId,
}));
console.log(`JSON: ${movs.length} movimientos`);

let ok = 0;
for (let i = 0; i < movs.length; i += 500) {
  const lote = movs.slice(i, i + 500);
  const r = await fetch(`${URL}/rest/v1/fin_banco_movimientos?on_conflict=banco_cuenta_id,hash_mov`, {
    method: "POST",
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(lote),
  });
  if (!r.ok) { console.error(`lote ${i}: ${r.status} ${(await r.text()).slice(0, 300)}`); process.exit(1); }
  ok += lote.length;
  console.log(`${ok}/${movs.length}`);
}
console.log("HECHO. Siguiente paso: cruce automático contra los apuntes de la 572.");
