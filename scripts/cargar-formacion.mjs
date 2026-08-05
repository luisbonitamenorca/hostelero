/**
 * Módulo Formación — carga de inscripciones e intentos desde el Supabase
 * legado (bonita-formacion-manipulador-alimentos, SOLO LECTURA) al Supabase hostelero.
 *
 * Orden: inscripciones → intentos (FK). Cada tabla va en un único POST,
 * que PostgREST ejecuta en una transacción: o entra todo o no entra nada.
 * Si una restricción del destino rechaza el lote, el script para y lo dice;
 * las restricciones no se tocan (§1 de docs/migracion-curso-docs.md).
 *
 * Claves: SOLO desde .env.local (en .gitignore). Nada de PII a ficheros ni a consola.
 * Uso:  node scripts/cargar-formacion.mjs
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca

// centro_trabajo (texto libre del legado) → centros.id en hostelero
const CENTROS = {
  "Restaurante Binifadet": "2c3b1092-bf98-4a59-bdc4-8df06c067a0a",
  "Bar Tamarindos": "e89c055e-956d-4eba-a1f3-581dd7740a6f",
  "Casa Tirant": "c974f3b0-ffbf-45f2-90ae-26745bb2f8f1",
  "Restaurante Tamarindos": "fb9e4af7-e50d-4617-b5e7-2de795faa894",
  "Cocina Central": "b62bee30-03d3-4f61-9cc7-1c0f5492873b",
  "Bodega Binifadet": "a2c6e3e1-c8e0-4c0a-a70f-8c612a3a2d77",
  "Estructura / Oficina": "0e5c90bd-62e9-4f6f-877e-bb2228f10325",
};

// ---------- .env.local ----------
const env = {};
for (const linea of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const l = linea.trim();
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const [k, ...v] = l.split("=");
  env[k.trim()] = v.join("=").trim();
}
const ORIGEN_URL = env.FORMACION_URL;
const ORIGEN_KEY = env.FORMACION_SECRET_KEY;
const HOSTELERO_URL = env.HOSTELERO_URL;
const HOSTELERO_KEY = env.HOSTELERO_SECRET_KEY;
if (!ORIGEN_URL || !ORIGEN_KEY || !HOSTELERO_URL || !HOSTELERO_KEY) {
  console.error("Faltan claves en .env.local — revisa FORMACION_* y HOSTELERO_*.");
  process.exit(1);
}

const cab = (key, extra = {}) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  ...extra,
});

async function leerOrigen(tabla) {
  const res = await fetch(`${ORIGEN_URL}/rest/v1/${tabla}?select=*&order=id&limit=1000`, {
    headers: cab(ORIGEN_KEY),
  });
  if (!res.ok) throw new Error(`GET ${tabla} ${res.status}: ${await res.text()}`);
  const filas = await res.json();
  if (filas.length >= 1000) throw new Error(`${tabla}: 1000+ filas, esperaba <100 — revisar`);
  console.log(`  leídas ${tabla}: ${filas.length}`);
  return filas;
}

/** Un único POST = una transacción en el destino. */
async function escribirHostelero(tabla, filas) {
  const res = await fetch(`${HOSTELERO_URL}/rest/v1/${tabla}`, {
    method: "POST",
    headers: cab(HOSTELERO_KEY, { Prefer: "return=minimal" }),
    body: JSON.stringify(filas),
  });
  if (!res.ok) {
    console.error(`\nRECHAZO en ${tabla} (${res.status}) — no se ha insertado nada de esta tabla.`);
    console.error(await res.text());
    console.error("\nParada según la regla: mirar el dato, no relajar la restricción.");
    process.exit(1);
  }
  console.log(`  insertadas ${tabla}: ${filas.length}`);
}

// ---------- carga ----------
console.log("Carga Formación — legado → hostelero\n");

console.log("1/2 inscripciones");
const inscripciones = await leerOrigen("inscripciones");

// Mapeo de centros: si aparece un valor no contemplado, abortar sin escribir nada.
const desconocidos = [...new Set(inscripciones.map((i) => i.centro_trabajo))].filter(
  (c) => !CENTROS[c]
);
if (desconocidos.length) {
  console.error(`ABORTADO: centro_trabajo sin mapeo: ${JSON.stringify(desconocidos)}`);
  process.exit(1);
}

const filasInscripciones = inscripciones.map(
  ({ centro_trabajo, fecha_inscripcion, fecha_actualizacion, ...resto }) => ({
    ...resto,
    cuenta_id: CUENTA_ID,
    centro_id: CENTROS[centro_trabajo],
    centro_trabajo_legado: centro_trabajo,
    empleado_id: null, // sin código de empleado estable aún (bandera 3 del .md)
    creado_en: fecha_inscripcion,
    actualizado_en: fecha_actualizacion,
  })
);
await escribirHostelero("curso_inscripciones", filasInscripciones);

console.log("2/2 intentos");
const intentos = await leerOrigen("intentos_examen");
await escribirHostelero(
  "curso_intentos",
  intentos.map((f) => ({ ...f, cuenta_id: CUENTA_ID }))
);

console.log("\nHecho. Ejecuta las consultas de verificación del §1 del .md antes de seguir.");
