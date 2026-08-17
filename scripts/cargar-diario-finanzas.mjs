/**
 * Finanzas · Carga del diario contable con DETALLE desde un JSON local.
 *
 * El JSON lo genera un paso previo leyendo el Excel de A3 en local (lleva
 * conceptos con nombres reales: JAMÁS entra en este repo, que es público) y
 * tiene esta forma:
 *   [{ a3: 123, fecha: "2026-01-31", concepto: "…", lineas: [["600000000","40","0"], …] }, …]
 *
 * Qué hace: inserta cada asiento como BORRADOR con sus apuntes, resolviendo
 * cada código de cuenta contra fin_plan_cuentas. No confirma nada: la
 * confirmación (numeración correlativa bajo advisory lock) se lanza después
 * con fin_confirmar_asiento, en orden de fecha.
 *
 * Claves: SOLO desde .env.local (en .gitignore): HOSTELERO_URL y
 * HOSTELERO_SERVICE_KEY. Uso:
 *   node scripts/cargar-diario-finanzas.mjs <ruta-al-json>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

// ---------- constantes del inquilino (las mismas que apps/finanzas/CLAUDE.md) ----------
const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca
const SOCIEDAD_ID = "798cf9dc-0146-4a24-94e8-fdb04f93ab70"; // Bonita Menorca, SL
const CREADO_POR = "632f6d25-e8ea-4f11-8f7b-d406a529df37"; // usuario de Luis

// ---------- .env.local ----------
const env = {};
for (const linea of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = linea.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const URL_BASE = env.HOSTELERO_URL;
const KEY = env.HOSTELERO_SERVICE_KEY;
if (!URL_BASE || !KEY) {
  console.error("Faltan HOSTELERO_URL o HOSTELERO_SERVICE_KEY en .env.local");
  process.exit(1);
}

const rutaJson = process.argv[2];
if (!rutaJson) {
  console.error("Uso: node scripts/cargar-diario-finanzas.mjs <ruta-al-json>");
  process.exit(1);
}

async function api(camino, opciones = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${camino}`, {
    ...opciones,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(opciones.headers ?? {}),
    },
  });
  if (!r.ok) {
    const cuerpo = await r.text();
    throw new Error(`${opciones.method ?? "GET"} ${camino} → ${r.status}: ${cuerpo.slice(0, 500)}`);
  }
  return r;
}

const asientos = JSON.parse(readFileSync(resolve(rutaJson), "utf8"));
console.log(`JSON: ${asientos.length} asientos, ${asientos.reduce((s, a) => s + a.lineas.length, 0)} apuntes`);

// ---------- seguridad: no cargar encima de un diario que ya tiene asientos ----------
const rExistentes = await api(`fin_asientos?select=id&limit=1`, {
  method: "HEAD",
  headers: { Prefer: "count=exact" },
});
const existentes = Number((rExistentes.headers.get("content-range") ?? "/0").split("/")[1]);
if (existentes > 0) {
  console.error(
    `El diario ya tiene ${existentes} asientos. Este script solo carga sobre un diario VACÍO:\n` +
      `bórralos antes a propósito (no lo hace él solo, para que borrar sea siempre una decisión).`,
  );
  process.exit(1);
}

// ---------- mapa código → id del plan de cuentas (paginado) ----------
const plan = new Map();
for (let desde = 0; ; desde += 1000) {
  const r = await api(
    `fin_plan_cuentas?select=id,codigo&sociedad_id=eq.${SOCIEDAD_ID}&order=codigo&limit=1000&offset=${desde}`,
  );
  const pagina = await r.json();
  for (const c of pagina) plan.set(c.codigo, c.id);
  if (pagina.length < 1000) break;
}
console.log(`Plan de cuentas: ${plan.size} cuentas`);

const sinCuenta = new Set();
for (const a of asientos) for (const l of a.lineas) if (!plan.has(l[0])) sinCuenta.add(l[0]);
if (sinCuenta.size > 0) {
  console.error(`Códigos sin cuenta en el plan (${sinCuenta.size}): ${[...sinCuenta].join(", ")}`);
  process.exit(1);
}

// ---------- ejercicio del año de la carga ----------
const anio = Number(asientos[0].fecha.slice(0, 4));
const rEj = await api(`fin_ejercicios?select=id,anio&sociedad_id=eq.${SOCIEDAD_ID}&anio=eq.${anio}`);
const ejercicios = await rEj.json();
if (ejercicios.length !== 1) {
  console.error(`Esperaba 1 ejercicio ${anio} y hay ${ejercicios.length}.`);
  process.exit(1);
}
const EJERCICIO_ID = ejercicios[0].id;

// ---------- inserción por lotes: asientos (con id propio) y luego apuntes ----------
for (const a of asientos) a.id = randomUUID();

const LOTE_ASIENTOS = 500;
for (let i = 0; i < asientos.length; i += LOTE_ASIENTOS) {
  const lote = asientos.slice(i, i + LOTE_ASIENTOS).map((a) => ({
    id: a.id,
    cuenta_id: CUENTA_ID,
    sociedad_id: SOCIEDAD_ID,
    ejercicio_id: EJERCICIO_ID,
    fecha: a.fecha,
    descripcion: `${a.concepto} · A3 ${a.a3}`,
    origen_tipo: "manual",
    creado_por: CREADO_POR,
  }));
  await api("fin_asientos", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(lote),
  });
  console.log(`asientos ${Math.min(i + LOTE_ASIENTOS, asientos.length)}/${asientos.length}`);
}

const apuntes = asientos.flatMap((a) =>
  a.lineas.map((l, j) => ({
    cuenta_id: CUENTA_ID,
    asiento_id: a.id,
    orden: j + 1,
    cuenta_plan_id: plan.get(l[0]),
    debe: l[1],
    haber: l[2],
  })),
);

const LOTE_APUNTES = 2000;
for (let i = 0; i < apuntes.length; i += LOTE_APUNTES) {
  await api("fin_apuntes", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(apuntes.slice(i, i + LOTE_APUNTES)),
  });
  console.log(`apuntes ${Math.min(i + LOTE_APUNTES, apuntes.length)}/${apuntes.length}`);
}

console.log(
  `\nHECHO: ${asientos.length} asientos en borrador con ${apuntes.length} apuntes.\n` +
    `Siguiente paso: confirmarlos en orden de fecha con fin_confirmar_asiento.`,
);
