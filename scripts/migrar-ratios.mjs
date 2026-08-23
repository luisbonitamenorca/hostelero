// Mudanza de RATIOS: Ratios Bonita (osmfedjemjmlxyifrreq) → hostelero.
// Fase 1 (esquema): lee la tabla _ddl_export ensamblada en origen y aplica
// cada sentencia en hostelero vía rpc ejecutar_ddl (service key).
// Fase 2 (datos): copia las 25 tablas por REST con upsert por PK — reanudable
// y válida para pasadas delta antes del corte.
//
// Uso:  RATIOS_ANON="eyJ..." node scripts/migrar-ratios.mjs [esquema|datos|tabla]

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const linea of readFileSync(resolve(raiz, ".env.local"), "utf8").split("\n")) {
  const m = linea.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const ORIGEN_URL = "https://osmfedjemjmlxyifrreq.supabase.co";
const ORIGEN_ANON = process.env.RATIOS_ANON;
const DESTINO_URL = process.env.HOSTELERO_URL;
const DESTINO_KEY = process.env.HOSTELERO_SERVICE_KEY;
if (!ORIGEN_ANON || !DESTINO_URL || !DESTINO_KEY) {
  console.error("Faltan RATIOS_ANON / HOSTELERO_URL / HOSTELERO_SERVICE_KEY");
  process.exit(1);
}

const TABLAS = [
  { t: "familias", pk: "id" },
  { t: "subfamilias", pk: "id" },
  { t: "doc_departamentos", pk: "id" },
  { t: "doc_subcategorias", pk: "id" },
  { t: "doc_documentos", pk: "id" },
  { t: "comensales", pk: "id" },
  { t: "ecommerce", pk: "pedido_id" },
  { t: "ecommerce_historico", pk: "pedido_id" },
  { t: "gastos", pk: "id" },
  { t: "ingresos", pk: "id" },
  { t: "ingresos_historico", pk: "id" },
  { t: "inventarios", pk: "id" },
  { t: "nominas", pk: "id" },
  { t: "nominas_reparto", pk: "id" },
  { t: "nominas_reparto_horas", pk: "id" },
  { t: "presupuesto", pk: "id" },
  { t: "presupuesto_nominas", pk: "id" },
  { t: "productos_agora", pk: "id_prod" },
  { t: "productos_controlados", pk: "id_prod,centro" },
  { t: "productos_dijit", pk: "id_interno" },
  { t: "ratios_objetivo", pk: "familia" },
  { t: "rrhh", pk: "id" },
  { t: "rrhh_excepciones", pk: "id" },
  { t: "rrhh_puestos", pk: "id" },
  { t: "visitas", pk: "id" },
];

const LOTE = 1000;

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

async function leerOrigen(ruta) {
  return conReintentos(async () => {
    const r = await fetch(`${ORIGEN_URL}/rest/v1/${ruta}`, {
      headers: { apikey: ORIGEN_ANON, Authorization: `Bearer ${ORIGEN_ANON}` },
    });
    if (!r.ok) throw new Error(`lectura ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  });
}

async function aplicarDDL(sql) {
  const r = await fetch(`${DESTINO_URL}/rest/v1/rpc/ejecutar_ddl`, {
    method: "POST",
    headers: {
      apikey: DESTINO_KEY, Authorization: `Bearer ${DESTINO_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_sql: sql }),
  });
  if (!r.ok) throw new Error(`ddl ${r.status}: ${(await r.text()).slice(0, 300)}\nSQL: ${sql.slice(0, 160)}`);
}

async function faseEsquema() {
  const sentencias = await leerOrigen("_ddl_export?select=*&order=orden.asc&limit=1000");
  console.log(`Esquema: ${sentencias.length} sentencias`);
  let fallosFk = [];
  for (const s of sentencias) {
    try { await aplicarDDL(s.sql); }
    catch (e) {
      // los constraints pueden depender entre sí; segunda ronda al final
      if (s.seccion === "constraint" || s.seccion === "indice") { fallosFk.push(s); continue; }
      throw e;
    }
  }
  for (const s of fallosFk) await aplicarDDL(s.sql); // segunda ronda
  console.log("Esquema aplicado.");
}

async function copiarTabla({ t, pk }) {
  const pk1 = pk.split(",")[0];
  let offset = 0, total = 0;
  for (;;) {
    const filas = await leerOrigen(`${t}?select=*&order=${pk1}.asc&limit=${LOTE}&offset=${offset}`);
    if (!filas.length) break;
    await conReintentos(async () => {
      const r = await fetch(`${DESTINO_URL}/rest/v1/${t}?on_conflict=${pk}`, {
        method: "POST",
        headers: {
          apikey: DESTINO_KEY, Authorization: `Bearer ${DESTINO_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(filas),
      });
      if (!r.ok) throw new Error(`${t} escritura ${r.status}: ${(await r.text()).slice(0, 300)}`);
    });
    total += filas.length;
    offset += LOTE;
    if (total % 5000 === 0 || filas.length < LOTE) console.log(`   ${t}: ${total}`);
    if (filas.length < LOTE) break;
  }
  return total;
}

const modo = process.argv[2] || "todo";
if (modo === "esquema" || modo === "todo") await faseEsquema();
if (modo !== "esquema") {
  const resumen = [];
  for (const def of TABLAS) {
    if (modo !== "datos" && modo !== "todo" && def.t !== modo) continue;
    console.log(`→ ${def.t}`);
    resumen.push(`${def.t}: ${await copiarTabla(def)}`);
  }
  console.log("\nHECHO\n" + resumen.join("\n"));
}
