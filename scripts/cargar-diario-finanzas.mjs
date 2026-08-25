/**
 * Finanzas · Carga del diario contable con DETALLE desde un JSON local.
 *
 * El JSON lo genera un paso previo leyendo el Excel de A3 en local (lleva
 * conceptos con nombres reales: JAMÁS entra en este repo, que es público) y
 * tiene esta forma:
 *   [{ a3: 123, fecha: "2026-01-31", concepto: "…", lineas: [["600000000","40","0",6], …] }, …]
 *   (el 4º elemento de cada línea es el CENTRO DE COSTE de A3, 1-8; 0 o ausente = sin centro)
 *
 * Qué hace: inserta cada asiento como BORRADOR con sus apuntes, resolviendo
 * cada código de cuenta contra fin_plan_cuentas. No confirma nada: la
 * confirmación (numeración correlativa bajo advisory lock) se lanza después
 * con fin_confirmar_asiento, en orden de fecha.
 *
 * ES REANUDABLE: si el proceso se corta a medias, se relanza con el mismo
 * JSON y continúa donde iba. Los asientos se reconocen por el «· A3 n» del
 * final de su descripción, y los apuntes se insertan en un orden determinista,
 * así que el número de filas ya insertadas dice exactamente por dónde seguir.
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
// Centros de coste: código de A3 → centros.id (verificado 25-08-2026; misma
// numeración que compras_centro_coste — contabilidad y Compras hablan igual)
const CENTROS = {
  1: "0e5c90bd-62e9-4f6f-877e-bb2228f10325", // Estructura
  2: "a2c6e3e1-c8e0-4c0a-a70f-8c612a3a2d77", // Binifadet Bodega
  3: "b62bee30-03d3-4f61-9cc7-1c0f5492873b", // Cocina Produccion
  4: "2c3b1092-bf98-4a59-bdc4-8df06c067a0a", // Binifadet Restaurante
  5: "1c6593a8-f805-43a5-b920-9bb2d4a93f59", // Binifadet Tienda
  6: "fb9e4af7-e50d-4617-b5e7-2de795faa894", // Tamarindos Restaurante
  7: "e89c055e-956d-4eba-a1f3-581dd7740a6f", // Tamarindos Bar
  8: "c974f3b0-ffbf-45f2-90ae-26745bb2f8f1", // Casa Tirant
};

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

/** fetch con timeout y reintentos: una petición colgada no puede matar la carga. */
async function api(camino, opciones = {}) {
  for (let intento = 1; ; intento++) {
    try {
      const r = await fetch(`${URL_BASE}/rest/v1/${camino}`, {
        ...opciones,
        signal: AbortSignal.timeout(60_000),
        headers: {
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
          "Content-Type": "application/json",
          ...(opciones.headers ?? {}),
        },
      });
      if (!r.ok) {
        const cuerpo = await r.text();
        throw new Error(`${opciones.method ?? "GET"} ${camino} → ${r.status}: ${cuerpo.slice(0, 300)}`);
      }
      return r;
    } catch (e) {
      // Un POST de inserción que falla por red puede haber llegado a medias…
      // no: cada POST es UNA sentencia SQL y es atómico. Reintentar un lote que
      // sí entró daría error de clave duplicada solo en fin_asientos (id); en
      // fin_apuntes no hay unicidad, así que ahí NO se reintenta a ciegas: se
      // relee el contador y se sigue desde donde diga la base.
      if (intento >= 3 || opciones.sinReintento) throw e;
      console.log(`  aviso: ${e.message ?? e} — reintento ${intento + 1}/3 en 5 s`);
      await new Promise((r2) => setTimeout(r2, 5000));
    }
  }
}

async function contar(tabla, filtro = "") {
  const r = await api(`${tabla}?select=id${filtro}&limit=1`, {
    method: "HEAD",
    headers: { Prefer: "count=exact" },
  });
  return Number((r.headers.get("content-range") ?? "/0").split("/")[1]);
}

const asientos = JSON.parse(readFileSync(resolve(rutaJson), "utf8"));
const totalApuntes = asientos.reduce((s, a) => s + a.lineas.length, 0);
console.log(`JSON: ${asientos.length} asientos, ${totalApuntes} apuntes`);

// ---------- ¿carga nueva o reanudación? ----------
const asientosExistentes = await contar("fin_asientos");
const apuntesExistentes = await contar("fin_apuntes");

if (asientosExistentes > 0 && asientosExistentes !== asientos.length) {
  console.error(
    `El diario tiene ${asientosExistentes} asientos y el JSON trae ${asientos.length}: ni vacío ni ` +
      `una carga a medias de ESTE fichero. No toco nada — bórralo a propósito si quieres recargar.`,
  );
  process.exit(1);
}
if (asientosExistentes === asientos.length && apuntesExistentes >= totalApuntes) {
  console.log("Ya está todo cargado: nada que hacer.");
  process.exit(0);
}
const reanudando = asientosExistentes === asientos.length;
if (reanudando) console.log(`Reanudando: asientos ya cargados, apuntes ${apuntesExistentes}/${totalApuntes}`);

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

if (!reanudando) {
  // ---------- ejercicio del año de la carga ----------
  const anio = Number(asientos[0].fecha.slice(0, 4));
  const rEj = await api(`fin_ejercicios?select=id,anio&sociedad_id=eq.${SOCIEDAD_ID}&anio=eq.${anio}`);
  const ejercicios = await rEj.json();
  if (ejercicios.length !== 1) {
    console.error(`Esperaba 1 ejercicio ${anio} y hay ${ejercicios.length}.`);
    process.exit(1);
  }
  const EJERCICIO_ID = ejercicios[0].id;

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
      sinReintento: true, // un reintento aquí chocaría con los id ya insertados
    });
    console.log(`asientos ${Math.min(i + LOTE_ASIENTOS, asientos.length)}/${asientos.length}`);
  }
} else {
  // ---------- recuperar los id reales de los asientos ya insertados ----------
  console.log("Recuperando los id de los asientos por su marca «· A3 n»…");
  const porA3 = new Map();
  for (let desde = 0; ; desde += 1000) {
    const r = await api(`fin_asientos?select=id,descripcion&order=id&limit=1000&offset=${desde}`);
    const pagina = await r.json();
    for (const f of pagina) {
      const m = (f.descripcion ?? "").match(/· A3 (\d+)$/);
      if (m) porA3.set(Number(m[1]), f.id);
    }
    if (pagina.length < 1000) break;
  }
  let sinId = 0;
  for (const a of asientos) {
    a.id = porA3.get(a.a3);
    if (!a.id) sinId++;
  }
  if (sinId > 0) {
    console.error(`${sinId} asientos del JSON no aparecen en la base: no reanudo sobre datos que no reconozco.`);
    process.exit(1);
  }
}

// ---------- apuntes, en orden determinista, desde donde diga la base ----------
const apuntes = asientos.flatMap((a) =>
  a.lineas.map((l, j) => ({
    cuenta_id: CUENTA_ID,
    asiento_id: a.id,
    orden: j + 1,
    cuenta_plan_id: plan.get(l[0]),
    debe: l[1],
    haber: l[2],
    centro_id: CENTROS[l[3]] ?? null,
  })),
);

const LOTE_APUNTES = 500;
let hechos = reanudando ? apuntesExistentes : 0;
while (hechos < apuntes.length) {
  const lote = apuntes.slice(hechos, hechos + LOTE_APUNTES);
  try {
    await api("fin_apuntes", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(lote),
      sinReintento: true,
    });
    hechos += lote.length;
  } catch (e) {
    // ¿Entró o no entró? La base es la única que lo sabe: se relee el contador
    // y se sigue desde ahí. Así un corte de red nunca duplica ni salta filas.
    console.log(`  aviso: ${e.message ?? e} — compruebo en la base por dónde vamos…`);
    await new Promise((r2) => setTimeout(r2, 5000));
    hechos = await contar("fin_apuntes");
  }
  console.log(`apuntes ${hechos}/${apuntes.length}`);
}

const finales = await contar("fin_apuntes");
console.log(
  `\nHECHO: ${asientos.length} asientos en borrador con ${finales} apuntes.\n` +
    `Siguiente paso: confirmarlos en orden de fecha con fin_confirmar_asiento.`,
);
