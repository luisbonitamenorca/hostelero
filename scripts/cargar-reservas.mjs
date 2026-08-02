/**
 * T1 · Módulo Reservas — carga de las tres tablas gordas desde el Supabase
 * legado (reservas-bonita, SOLO LECTURA) al Supabase hostelero.
 *
 * Orden: clientes → reservas → reserva_mesas (§4-T1 de docs/migracion-reservas.md).
 * Triggers del destino ACTIVOS y gestionados:
 *   - cola de emails: se vacía al terminar (aquí no hay nada legítimo aún).
 *   - sincronía de mesa principal: reserva_mesas se inserta con
 *     on_conflict=(reserva_id,mesa_id) + Prefer: resolution=ignore-duplicates.
 *
 * Claves: SOLO desde .env.local (en .gitignore). Nada de PII a ficheros: todo en memoria.
 * Uso:  node scripts/cargar-reservas.mjs
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca
const LOTE = 1000;

// ---------- .env.local ----------
const env = {};
for (const linea of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const l = linea.trim();
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const [k, ...v] = l.split("=");
  env[k.trim()] = v.join("=").trim();
}
const LEGADO_URL = env.RESERVAS_LEGADO_URL;
const LEGADO_KEY = env.RESERVAS_LEGADO_SERVICE_KEY;
const HOSTELERO_URL = env.HOSTELERO_URL;
const HOSTELERO_KEY = env.HOSTELERO_SERVICE_KEY;
if (!LEGADO_URL || !LEGADO_KEY || !HOSTELERO_URL || !HOSTELERO_KEY) {
  console.error("Faltan claves en .env.local — revisa las 4 variables.");
  process.exit(1);
}

const cab = (key, extra = {}) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  ...extra,
});

async function conReintentos(fn, intentos = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= intentos) throw e;
      console.warn(`  reintento ${i} tras error: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

/** Lee una tabla entera del legado, paginada y con orden estable. */
async function leerLegado(tabla, orden) {
  const filas = [];
  for (let offset = 0; ; offset += LOTE) {
    const url = `${LEGADO_URL}/rest/v1/${tabla}?select=*&order=${orden}&limit=${LOTE}&offset=${offset}`;
    const lote = await conReintentos(async () => {
      const res = await fetch(url, { headers: cab(LEGADO_KEY) });
      if (!res.ok) throw new Error(`GET ${tabla} ${res.status}: ${await res.text()}`);
      return res.json();
    });
    filas.push(...lote);
    process.stdout.write(`\r  leyendo ${tabla}: ${filas.length}`);
    if (lote.length < LOTE) break;
  }
  console.log();
  return filas;
}

/** Inserta en hostelero por lotes, añadiendo cuenta_id a cada fila. */
async function escribirHostelero(tabla, filas, { ignorarDuplicados = false, onConflict = "" } = {}) {
  const prefer = ignorarDuplicados
    ? "resolution=ignore-duplicates,return=minimal"
    : "return=minimal";
  const qs = onConflict ? `?on_conflict=${onConflict}` : "";
  let hechas = 0;
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE).map((f) => ({ ...f, cuenta_id: CUENTA_ID }));
    await conReintentos(async () => {
      const res = await fetch(`${HOSTELERO_URL}/rest/v1/${tabla}${qs}`, {
        method: "POST",
        headers: cab(HOSTELERO_KEY, { Prefer: prefer }),
        body: JSON.stringify(lote),
      });
      if (!res.ok) throw new Error(`POST ${tabla} ${res.status}: ${await res.text()}`);
    });
    hechas += lote.length;
    process.stdout.write(`\r  escribiendo ${tabla}: ${hechas}/${filas.length}`);
  }
  console.log();
}

async function contarHostelero(tabla) {
  const res = await fetch(`${HOSTELERO_URL}/rest/v1/${tabla}?select=*`, {
    method: "HEAD",
    headers: cab(HOSTELERO_KEY, { Prefer: "count=exact", Range: "0-0" }),
  });
  const cr = res.headers.get("content-range") || "";
  return parseInt(cr.split("/")[1] || "0", 10);
}

// ---------- carga ----------
console.log("T1 · Carga Reservas — legado → hostelero\n");

// 1. clientes
console.log("1/3 clientes");
const clientes = await leerLegado("clientes", "id");
await escribirHostelero("reservas_clientes", clientes);

// 2. reservas (dispara triggers de emails y de mesa principal: previsto)
console.log("2/3 reservas");
const reservas = await leerLegado("reservas", "id");
await escribirHostelero("reservas_reservas", reservas);

// 3. reserva_mesas (choca con lo auto-insertado por el trigger → se ignora el duplicado)
console.log("3/3 reserva_mesas");
const reservaMesas = await leerLegado("reserva_mesas", "reserva_id,mesa_id");
await escribirHostelero("reservas_reserva_mesas", reservaMesas, {
  ignorarDuplicados: true,
  onConflict: "reserva_id,mesa_id",
});

// 4. vaciar la cola de emails fantasma que encoló el trigger
console.log("4/4 vaciando cola de emails…");
{
  const res = await fetch(`${HOSTELERO_URL}/rest/v1/reservas_emails_salientes?id=not.is.null`, {
    method: "DELETE",
    headers: cab(HOSTELERO_KEY, { Prefer: "return=minimal" }),
  });
  if (!res.ok) throw new Error(`DELETE emails ${res.status}: ${await res.text()}`);
}

// ---------- resumen ----------
console.log("\nCounts en hostelero tras la carga:");
for (const [tabla, esperado] of [
  ["reservas_clientes", clientes.length],
  ["reservas_reservas", reservas.length],
  ["reservas_reserva_mesas", reservaMesas.length],
  ["reservas_emails_salientes", 0],
]) {
  const n = await contarHostelero(tabla);
  const ok = n === esperado ? "✓" : `✗ (esperaba ${esperado})`;
  console.log(`  ${tabla}: ${n} ${ok}`);
}
console.log("\nHecho. Verifica la aceptación del §4-T1 antes de seguir.");
