/**
 * Carga el JSON del extracto CaixaBank «con referencias SEPA» (generado con
 * scripts/generar-extracto-caixa-sepa.py) en fin_n43_staging y ejecuta
 * fin_n43_absorber: enriquece los movimientos existentes (match exacto
 * fecha+importe+saldo) e inserta los que falten (solo 2026).
 * Re-lanzable: el guard n43_comun IS NULL evita enriquecer dos veces.
 *
 * Uso: node scripts/cargar-extracto-caixa-sepa.mjs <ruta.json> [banco_cuenta_id]
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

const BANCO_DEFECTO = "db3de373-fbf3-4386-9661-c1034df6766f"; // CaixaBank ...5037

const ruta = process.argv[2];
if (!ruta) { console.error("falta la ruta del JSON"); process.exit(1); }
const bancoCuentaId = process.argv[3] || BANCO_DEFECTO;

const cab = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const movs = JSON.parse(readFileSync(ruta, "utf8"));
console.log(`JSON: ${movs.length} movimientos`);

// staging limpio en cada carga
let r = await fetch(`${URL}/rest/v1/fin_n43_staging?id=gte.0`, { method: "DELETE", headers: cab });
if (!r.ok) { console.error(`vaciar staging: ${r.status} ${(await r.text()).slice(0, 300)}`); process.exit(1); }

let ok = 0;
for (let i = 0; i < movs.length; i += 500) {
  const lote = movs.slice(i, i + 500);
  r = await fetch(`${URL}/rest/v1/fin_n43_staging`, {
    method: "POST",
    headers: { ...cab, Prefer: "return=minimal" },
    body: JSON.stringify(lote),
  });
  if (!r.ok) { console.error(`lote ${i}: ${r.status} ${(await r.text()).slice(0, 300)}`); process.exit(1); }
  ok += lote.length;
  console.log(`staging ${ok}/${movs.length}`);
}

r = await fetch(`${URL}/rest/v1/rpc/fin_n43_absorber`, {
  method: "POST", headers: cab, body: JSON.stringify({ p_banco: bancoCuentaId }),
});
if (!r.ok) { console.error(`absorber: ${r.status} ${(await r.text()).slice(0, 300)}`); process.exit(1); }
console.log("Absorber:", JSON.stringify(await r.json()));

// Motor de reglas del cruce, por lotes (keyset) hasta agotar los pendientes
const total = { liquidados: 0, clasificados: 0, ignorados: 0, errores: 0 };
let desde = null;
for (;;) {
  r = await fetch(`${URL}/rest/v1/rpc/fin_cruce_aplicar`, {
    method: "POST", headers: cab,
    body: JSON.stringify({ p_banco: bancoCuentaId, p_desde: desde, p_lote: 10 }),
  });
  if (!r.ok) { console.error(`cruce: ${r.status} ${(await r.text()).slice(0, 300)}`); process.exit(1); }
  const paso = await r.json();
  for (const k of Object.keys(total)) total[k] += paso[k];
  if (paso.procesados < 10) break;
  desde = paso.ultimo;
}
console.log("Cruce:", JSON.stringify(total));
console.log("HECHO.");
