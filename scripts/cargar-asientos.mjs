/**
 * Carga asientos genéricos (JSON generado en local) como BORRADORES en la
 * cuenta indicada. Formato: [{fecha, concepto, lineas:[[cuenta,debe,haber,centroA3]]}]
 * — el 4º elemento es el código de centro A3 (1-8) o null. La confirmación va
 * aparte (fin_confirmar_asiento en orden de fecha). Nacido para los ingresos
 * de Ágora del arranque "desde cero" (27-08-2026), vale para cualquier carga.
 *
 * Uso: node scripts/cargar-asientos.mjs <ruta.json>
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

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd";
const SOCIEDAD_ID = "798cf9dc-0146-4a24-94e8-fdb04f93ab70";
const CREADO_POR = "632f6d25-e8ea-4f11-8f7b-d406a529df37";
const CENTROS = {
  1: "0e5c90bd-62e9-4f6f-877e-bb2228f10325", 2: "a2c6e3e1-c8e0-4c0a-a70f-8c612a3a2d77",
  3: "b62bee30-03d3-4f61-9cc7-1c0f5492873b", 4: "2c3b1092-bf98-4a59-bdc4-8df06c067a0a",
  5: "1c6593a8-f805-43a5-b920-9bb2d4a93f59", 6: "fb9e4af7-e50d-4617-b5e7-2de795faa894",
  7: "e89c055e-956d-4eba-a1f3-581dd7740a6f", 8: "c974f3b0-ffbf-45f2-90ae-26745bb2f8f1",
};

async function api(ruta, opciones = {}) {
  const r = await fetch(`${URL}/rest/v1/${ruta}`, {
    ...opciones,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(opciones.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${ruta}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r;
}

const asientos = JSON.parse(readFileSync(process.argv[2], "utf8"));
console.log(`JSON: ${asientos.length} asientos`);

// plan de cuentas: todos los códigos deben existir antes de empezar
const plan = new Map();
for (let off = 0; ; off += 1000) {
  const filas = await (await api(`fin_plan_cuentas?select=id,codigo&cuenta_id=eq.${CUENTA_ID}&limit=1000&offset=${off}`)).json();
  for (const f of filas) plan.set(f.codigo, f.id);
  if (filas.length < 1000) break;
}
const faltan = new Set();
for (const a of asientos) for (const l of a.lineas) if (!plan.has(l[0])) faltan.add(l[0]);
if (faltan.size) { console.error(`Códigos sin cuenta en el plan: ${[...faltan].join(", ")}`); process.exit(1); }

const rEj = await (await api(`fin_ejercicios?select=id&sociedad_id=eq.${SOCIEDAD_ID}&anio=eq.${Number(asientos[0].fecha.slice(0, 4))}`)).json();
if (rEj.length !== 1) { console.error("ejercicio no encontrado"); process.exit(1); }
const ejercicioId = rEj[0].id;

for (let i = 0; i < asientos.length; i += 200) {
  const lote = asientos.slice(i, i + 200);
  const cab = await (await api(`fin_asientos?select=id`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(lote.map((a) => ({
      cuenta_id: CUENTA_ID, sociedad_id: SOCIEDAD_ID, ejercicio_id: ejercicioId,
      fecha: a.fecha, descripcion: a.concepto, origen_tipo: a.origen_tipo ?? "manual",
      origen_id: a.origen_id ?? null, creado_por: CREADO_POR,
    }))),
  })).json();
  const apuntes = [];
  lote.forEach((a, j) => a.lineas.forEach((l, k) => apuntes.push({
    cuenta_id: CUENTA_ID, asiento_id: cab[j].id, orden: k + 1,
    cuenta_plan_id: plan.get(l[0]), debe: l[1], haber: l[2],
    centro_id: l[3] ? CENTROS[l[3]] ?? null : null,
  })));
  await api(`fin_apuntes`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(apuntes) });
  console.log(`${Math.min(i + 200, asientos.length)}/${asientos.length}`);
}
console.log("HECHO: borradores cargados. Siguiente: confirmar en orden de fecha.");
