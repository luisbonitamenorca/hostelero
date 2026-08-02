/**
 * T1 · Módulo RRHH (Planifica) — carga de datos desde el Supabase legado
 * (planifica-bonita, SOLO LECTURA) al Supabase hostelero.
 *
 * Orden del §4-T1 de docs/migracion-rrhh.md:
 *   empleados → periodos_contrato → asignaciones → turnos → fichajes → ausencias.
 *
 * Mapeos: cuenta_id en todo; local_id → centro_id con el MAPA SAGRADO del §2
 * (el script ABORTA si aparece un local fuera del mapa); user_id SIEMPRE NULL
 * (los auth users del legado son de otro proyecto) — y por la misma razón,
 * creado_por / corregido_por / solicitada_por / resuelta_por también van a NULL;
 * empleados.departamento (texto) se copia tal cual y ADEMÁS se resuelve
 * departamento_id casando por nombre contra el maestro; created_at → creado_en.
 *
 * rrhh_fichajes es APPEND-ONLY también aquí: solo inserts (el trigger de hora
 * de servidor les pondrá el ts de la carga — aceptado, son pruebas).
 * PII solo en memoria: cero ficheros intermedios.
 *
 * Uso:  node scripts/cargar-rrhh.mjs
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca
const LOTE = 1000;

// Mapa locales (legado) → centros (hostelero) — §2 del traspaso. SAGRADO.
const CENTROS = {
  "bdc739b5-f496-4d22-b073-0d58e04792b6": "a2c6e3e1-c8e0-4c0a-a70f-8c612a3a2d77", // Binifadet Bodega
  "8520bfba-6404-4fcc-aab5-100c0fb418ec": "2c3b1092-bf98-4a59-bdc4-8df06c067a0a", // Binifadet Restaurante
  "285b8b7b-f8b4-41dc-b6f7-ef3a7c913baa": "1c6593a8-f805-43a5-b920-9bb2d4a93f59", // Binifadet Tienda
  "439ee458-6959-4fcf-bbc0-cac3fe5fc291": "c974f3b0-ffbf-45f2-90ae-26745bb2f8f1", // Casa Tirant
  "ecb21326-4109-47ab-9784-9f1783213191": "0e5c90bd-62e9-4f6f-877e-bb2228f10325", // Oficina → Estructura
  "4a22b74f-ca97-4d9e-b423-479885d0795e": "b62bee30-03d3-4f61-9cc7-1c0f5492873b", // Producción → Cocina Produccion
  "dd25b6a2-f021-4e18-9575-f7730045fad1": "e89c055e-956d-4eba-a1f3-581dd7740a6f", // Tamarindos Bar
  "87f4cd8d-0ed6-4eb7-b9f0-12dbb1d1530f": "fb9e4af7-e50d-4617-b5e7-2de795faa894", // Tamarindos Restaurante
};

function centroDe(localId, contexto) {
  if (localId == null) return null;
  const c = CENTROS[localId];
  if (!c) {
    console.error(`\nABORTADO: local_id ${localId} (${contexto}) no está en el mapa del §2.`);
    process.exit(1);
  }
  return c;
}

// ---------- .env.local ----------
const env = {};
for (const linea of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const l = linea.trim();
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const [k, ...v] = l.split("=");
  env[k.trim()] = v.join("=").trim();
}
const LEGADO_URL = env.RRHH_LEGADO_URL;
const LEGADO_KEY = env.RRHH_LEGADO_SERVICE_KEY;
const DESTINO_URL = env.HOSTELERO_URL;
const DESTINO_KEY = env.HOSTELERO_SERVICE_KEY;
if (!LEGADO_URL || !LEGADO_KEY || !DESTINO_URL || !DESTINO_KEY) {
  console.error("Faltan claves en .env.local (RRHH_LEGADO_* / HOSTELERO_*).");
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

async function leerLegado(tabla, orden = "id") {
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

async function escribir(tabla, filas) {
  let hechas = 0;
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    await conReintentos(async () => {
      const res = await fetch(`${DESTINO_URL}/rest/v1/${tabla}`, {
        method: "POST",
        headers: cab(DESTINO_KEY, { Prefer: "return=minimal" }),
        body: JSON.stringify(lote),
      });
      if (!res.ok) throw new Error(`POST ${tabla} ${res.status}: ${await res.text()}`);
    });
    hechas += lote.length;
    process.stdout.write(`\r  escribiendo ${tabla}: ${hechas}/${filas.length}`);
  }
  console.log();
}

async function contar(tabla) {
  const res = await fetch(`${DESTINO_URL}/rest/v1/${tabla}?select=*`, {
    method: "HEAD",
    headers: cab(DESTINO_KEY, { Prefer: "count=exact", Range: "0-0" }),
  });
  return parseInt((res.headers.get("content-range") || "").split("/")[1] || "0", 10);
}

/** Normaliza para casar nombres de departamento (minúsculas, sin tildes). */
const norm = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// ---------- carga ----------
console.log("T1 · Carga RRHH (Planifica) — legado → hostelero\n");

// Maestro de departamentos (ya cargado) para resolver departamento_id por nombre.
const deptos = await conReintentos(async () => {
  const res = await fetch(`${DESTINO_URL}/rest/v1/departamentos?select=id,nombre`, {
    headers: cab(DESTINO_KEY),
  });
  if (!res.ok) throw new Error(`GET departamentos ${res.status}`);
  return res.json();
});
const deptoPorNombre = Object.fromEntries(deptos.map((d) => [norm(d.nombre), d.id]));
console.log(`maestro departamentos: ${deptos.length}\n`);

// 1. empleados
console.log("1/6 empleados");
const empleados = await leerLegado("empleados");
let deptosResueltos = 0;
await escribir(
  "empleados",
  empleados.map(({ local_principal_id, created_at, user_id, departamento, ...e }) => {
    const departamento_id = deptoPorNombre[norm(departamento)] ?? null;
    if (departamento_id) deptosResueltos++;
    void user_id; // SIEMPRE NULL: los auth users del legado no existen aquí
    return {
      ...e,
      cuenta_id: CUENTA_ID,
      centro_principal_id: centroDe(local_principal_id, "empleados"),
      departamento: departamento ?? null,
      departamento_id,
      user_id: null,
      creado_en: created_at,
    };
  }),
);
console.log(`  departamento_id resuelto en ${deptosResueltos}/${empleados.length}`);

// 2. periodos_contrato
console.log("2/6 periodos_contrato");
const periodos = await leerLegado("periodos_contrato");
await escribir(
  "rrhh_periodos_contrato",
  periodos.map(({ created_at, ...p }) => ({ ...p, cuenta_id: CUENTA_ID, creado_en: created_at })),
);

// 3. asignaciones
console.log("3/6 asignaciones");
const asignaciones = await leerLegado("asignaciones");
await escribir(
  "rrhh_asignaciones",
  asignaciones.map(({ local_id, ...a }) => ({
    ...a,
    cuenta_id: CUENTA_ID,
    centro_id: centroDe(local_id, "asignaciones"),
  })),
);

// 4. turnos
console.log("4/6 turnos");
const turnos = await leerLegado("turnos");
await escribir(
  "rrhh_turnos",
  turnos.map(({ local_id, created_at, creado_por, ...t }) => {
    void creado_por; // auth user del legado → NULL
    return {
      ...t,
      cuenta_id: CUENTA_ID,
      centro_id: centroDe(local_id, "turnos"),
      creado_por: null,
      creado_en: created_at,
    };
  }),
);

// 5. fichajes (append-only: SOLO inserts; el trigger pondrá la hora de servidor)
console.log("5/6 fichajes");
const fichajes = await leerLegado("fichajes");
await escribir(
  "rrhh_fichajes",
  fichajes.map(({ local_id, created_at, corregido_por, ...f }) => {
    void created_at;
    void corregido_por; // auth user del legado → NULL
    return {
      ...f,
      cuenta_id: CUENTA_ID,
      centro_id: centroDe(local_id, "fichajes"),
      corregido_por: null,
    };
  }),
);

// 6. ausencias (0 esperadas, pero el flujo queda completo)
console.log("6/6 ausencias");
const ausencias = await leerLegado("ausencias");
await escribir(
  "rrhh_ausencias",
  // auth users del legado (solicitada_por / resuelta_por) → NULL; llegará vacío (0 filas)
  ausencias.map(({ created_at, solicitada_por, resuelta_por, ...a }) => {
    void solicitada_por;
    void resuelta_por;
    return { ...a, cuenta_id: CUENTA_ID, solicitada_por: null, resuelta_por: null, creado_en: created_at };
  }),
);

// ---------- resumen ----------
console.log("\nCounts en hostelero tras la carga:");
for (const [tabla, esperado] of [
  ["empleados", empleados.length],
  ["rrhh_periodos_contrato", periodos.length],
  ["rrhh_asignaciones", asignaciones.length],
  ["rrhh_turnos", turnos.length],
  ["rrhh_fichajes", fichajes.length],
  ["rrhh_ausencias", ausencias.length],
]) {
  const n = await contar(tabla);
  console.log(`  ${tabla}: ${n} ${n === esperado ? "✓" : `✗ (esperaba ${esperado})`}`);
}
console.log("\nHecho. Verifica la aceptación del §4-T1 antes de seguir.");
