#!/usr/bin/env node
// scripts/maestros/cargar-maestro.mjs · Carga en el maestro COMÚN (mae_proveedor / mae_producto /
// mae_precio_tarifa) el JSON normalizado que produce catalogo-a-json.mjs, y después vincula la cuenta
// indicada con el maestro (mae_vincular_cuenta): proveedor por NIF, productos por referencia o EAN,
// y rellena en compras_producto formato / unidad / unidades por caja / EAN / precio de catálogo.
//
//   node scripts/maestros/cargar-maestro.mjs ~/Downloads/maestro-atsa.json [--cuenta <uuid>] [--solo-ver]
//
//   --cuenta     cuenta que aporta el catálogo y que se vincula al final (por defecto Bonita Menorca)
//   --solo-ver   no escribe nada: enseña qué haría (nuevos, cambios de precio, sin cambios)
//
// Claves: apps/general/.env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Idempotente:
// repetir la carga del mismo fichero no duplica nada; una tarifa nueva actualiza precio_tarifa y añade
// una fila al histórico mae_precio_tarifa.

import { readFileSync } from "node:fs";
import { basename, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const linea of readFileSync(resolve(raiz, "apps/general/.env.local"), "utf8").split("\n")) {
  const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en apps/general/.env.local"); process.exit(1); }

const args = process.argv.slice(2);
const opt = { cuenta: "082c5366-d9ae-49b9-a8b8-8caad73985bd" };
let fichero = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--cuenta") opt.cuenta = args[++i];
  else if (args[i] === "--solo-ver") opt.soloVer = true;
  else fichero = args[i].replace(/^~/, process.env.HOME);
}
if (!fichero) { console.error("Uso: cargar-maestro.mjs fichero.json [--cuenta uuid] [--solo-ver]"); process.exit(1); }

const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
async function sb(path, init = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${init.method || "GET"} ${path} → ${r.status}: ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : null;
}
const normRef = (t) => { let s = String(t ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); if (!s) return null; if (/^\d+$/.test(s)) s = s.replace(/^0+(?=\d)/, ""); return s; };
const normNif = (t) => { if (!t) return null; let s = String(t).toUpperCase().replace(/[^A-Z0-9]/g, ""); s = s.replace(/^ES(?=[A-Z0-9]{9})/, ""); return s.slice(0, 9) || null; };
const igual = (a, b) => (a == null && b == null) || (a != null && b != null && (typeof a === "number" ? Math.abs(a - b) < 1e-6 : String(a) === String(b)));

const j = JSON.parse(readFileSync(fichero, "utf8"));
if (!j.proveedor || !j.proveedor.nombre || !Array.isArray(j.productos)) { console.error("El JSON no tiene la forma esperada (proveedor + productos)"); process.exit(1); }

/* 1) proveedor del maestro */
const nifN = normNif(j.proveedor.nif);
let prov = null;
if (nifN) prov = (await sb(`mae_proveedor?nif_norm=eq.${nifN}&select=*`))[0] || null;
if (!prov) {
  const porNombre = await sb(`mae_proveedor?nif_norm=is.null&select=*`);
  prov = porNombre.find((p) => p.nombre.toUpperCase() === j.proveedor.nombre.toUpperCase()) || null;
}
console.log(`Proveedor: ${j.proveedor.nombre} (${j.proveedor.nif || "sin NIF"}) → ${prov ? "ya en el maestro (" + prov.id + ")" : "NUEVO"}`);
if (!prov && !opt.soloVer) {
  prov = (await sb("mae_proveedor", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
    nombre: j.proveedor.nombre, nif: j.proveedor.nif || null, codigos_son_ean: !!j.proveedor.codigos_son_ean,
    email_albaranes: j.proveedor.email_albaranes || null, creado_por_cuenta: opt.cuenta,
  }) }))[0];
}

/* 2) carga */
let carga = null;
if (!opt.soloVer) {
  carga = (await sb("mae_carga", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
    proveedor_id: prov.id, cuenta_id: opt.cuenta, archivo: j.archivo || basename(fichero), fuente: j.fuente || "catalogo",
    vigente_desde: j.vigente_desde || null, filas: j.productos.length,
  }) }))[0];
}

/* 3) productos */
const existentes = prov ? await sb(`mae_producto?proveedor_id=eq.${prov.id}&select=*&limit=20000`) : [];
const porRef = new Map(existentes.map((p) => [p.ref_norm, p]));
const CAMPOS = ["ref_fabricante", "ean", "nombre", "marca", "categoria", "formato", "unidad_venta", "unidades_caja", "contenido", "contenido_unidad", "precio_tarifa", "precio_tarifa_desde", "caducidad"];
let nuevos = 0, actualizados = 0, sinCambios = 0, precios = 0;
const altas = [], detalle = [];
for (const p of j.productos) {
  const ref = String(p.ref_proveedor || "").trim();
  const rn = normRef(ref);
  if (!rn || !p.nombre) continue;
  const fila = {
    ref_proveedor: ref, ref_fabricante: p.ref_fabricante || null, ean: p.ean || null, nombre: p.nombre, marca: p.marca || null,
    categoria: p.categoria || null, formato: p.formato || null, unidad_venta: p.unidad_venta || null,
    unidades_caja: p.unidades_caja ?? null, contenido: p.contenido ?? null, contenido_unidad: p.contenido_unidad || null,
    precio_tarifa: p.precio_tarifa ?? null, precio_tarifa_desde: p.precio_tarifa_desde || j.vigente_desde || null,
    caducidad: p.caducidad || null, fuente: j.fuente || "catalogo",
  };
  const ex = porRef.get(rn);
  if (!ex) { altas.push({ ...fila, proveedor_id: prov ? prov.id : null, carga_id: carga ? carga.id : null }); nuevos++; continue; }
  const cambios = {};
  for (const k of CAMPOS) {
    // la tarifa nueva manda; el resto solo se completa si el maestro no lo tenía (no pisamos revisiones a mano)
    if (k === "precio_tarifa" || k === "precio_tarifa_desde") { if (fila[k] != null && !igual(fila[k], ex[k])) cambios[k] = fila[k]; }
    else if (ex[k] == null && fila[k] != null) cambios[k] = fila[k];
  }
  if (ex.formato_fiable && ("unidades_caja" in cambios || "contenido" in cambios || "contenido_unidad" in cambios)) { delete cambios.unidades_caja; delete cambios.contenido; delete cambios.contenido_unidad; }
  if (!Object.keys(cambios).length) { sinCambios++; continue; }
  if ("precio_tarifa" in cambios) { precios++; detalle.push({ ref, nombre: ex.nombre, de: ex.precio_tarifa, a: cambios.precio_tarifa }); }
  actualizados++;
  if (!opt.soloVer) {
    await sb(`mae_producto?id=eq.${ex.id}`, { method: "PATCH", body: JSON.stringify({ ...cambios, carga_id: carga.id }) });
    if ("precio_tarifa" in cambios && cambios.precio_tarifa != null) {
      await sb("mae_precio_tarifa", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({
        producto_id: ex.id, precio: cambios.precio_tarifa, desde: cambios.precio_tarifa_desde || ex.precio_tarifa_desde || new Date().toISOString().slice(0, 10), carga_id: carga.id,
      }) });
    }
  }
}
if (!opt.soloVer && altas.length) {
  for (let i = 0; i < altas.length; i += 200) {
    const lote = altas.slice(i, i + 200);
    const ins = await sb("mae_producto", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(lote) });
    const hist = ins.filter((x) => x.precio_tarifa != null).map((x) => ({ producto_id: x.id, precio: x.precio_tarifa, desde: x.precio_tarifa_desde || new Date().toISOString().slice(0, 10), carga_id: carga.id }));
    if (hist.length) await sb("mae_precio_tarifa", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(hist) });
  }
  await sb(`mae_carga?id=eq.${carga.id}`, { method: "PATCH", body: JSON.stringify({ nuevos, actualizados, sin_cambios: sinCambios, detalle: { cambios_precio: detalle.slice(0, 500) } }) });
}
console.log(`Productos: ${j.productos.length} en el fichero → ${nuevos} nuevos · ${actualizados} actualizados (${precios} cambios de precio) · ${sinCambios} sin cambios${opt.soloVer ? "  [solo ver: no se ha escrito nada]" : ""}`);
if (detalle.length) console.log("  Cambios de precio:", detalle.slice(0, 15).map((d) => `${d.ref} ${d.nombre}: ${d.de} → ${d.a}`).join(" | "), detalle.length > 15 ? `… (+${detalle.length - 15})` : "");

/* 4) vincular la cuenta */
if (!opt.soloVer) {
  const r = await sb("rpc/mae_vincular_cuenta", { method: "POST", body: JSON.stringify({ p_cuenta: opt.cuenta }) });
  const v = Array.isArray(r) ? r[0] : r;
  console.log(`Vinculación de la cuenta ${opt.cuenta}: ${v.proveedores} proveedores · ${v.productos} productos enlazados · ${v.completados} productos completados con formato/EAN/precio`);
}
