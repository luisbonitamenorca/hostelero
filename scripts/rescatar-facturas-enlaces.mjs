/**
 * Rescate único (15-09-2026): correos ya PROCESADOS sin adjunto pero con enlace
 * de descarga (NuestraFactura «Ver factura»): se sigue el enlace, se sube el PDF
 * al bucket 'documentos' y se crea la fila en compras_correo_adjunto en estado
 * PENDIENTE, que es lo que la app de Compras procesa con el OCR. Re-lanzable:
 * salta los correos que ya tienen un adjunto con fichero.
 *
 * Uso: node scripts/rescatar-facturas-enlaces.mjs [--dry]
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
const CUENTA = "082c5366-d9ae-49b9-a8b8-8caad73985bd";
const DRY = process.argv.includes("--dry");
const cab = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function sb(path, opts = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { ...opts, headers: { ...cab, Prefer: opts.prefer || "return=representation", ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : [];
}
async function subir(buffer, nombre) {
  const path = `correo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;
  const r = await fetch(`${URL}/storage/v1/object/documentos/${path}`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/pdf" }, body: buffer });
  if (!r.ok) throw new Error(`storage ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { url: `${URL}/storage/v1/object/public/documentos/${path}`, path };
}

const correos = await sb("compras_correo?select=id,asunto,remitente,fecha_correo,enlaces&enlaces=not.is.null&estado=eq.PROCESADO&order=fecha_correo.asc", { headers: { Range: "0-999" } });
const candidatos = correos.filter((c) => (c.enlaces || []).some((u) => /\.pdf(\?|$)|ver_factura/i.test(u)));
console.log(`correos con enlace a PDF: ${candidatos.length} de ${correos.length}`);
let hechos = 0, saltados = 0, fallidos = 0;
for (const c of candidatos) {
  const adj = await sb(`compras_correo_adjunto?correo_id=eq.${c.id}&url=not.is.null&select=id`);
  if (adj.length) { saltados++; continue; }
  const enlaces = (c.enlaces || []).filter((u) => /\.pdf(\?|$)|ver_factura/i.test(u));
  let ok = false;
  for (const url of enlaces.slice(0, 3)) {
    try {
      const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; Hostelero-Compras/1.0)" } });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const esPdf = (r.headers.get("content-type") || "").includes("pdf") || buf.subarray(0, 5).toString("latin1") === "%PDF-";
      if (!esPdf || buf.length > 15 * 1024 * 1024) continue;
      const nombre = `${String(c.asunto || "factura").replace(/[^\wáéíóúñÁÉÍÓÚÑ .-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60)}.pdf`;
      if (DRY) { console.log(`[dry] ${c.fecha_correo?.slice(0, 10)} ${c.remitente} → ${nombre} (${buf.length} bytes)`); ok = true; break; }
      const s = await subir(buf, nombre);
      await sb("compras_correo_adjunto", { method: "POST", prefer: "return=minimal", body: JSON.stringify([{ cuenta_id: CUENTA, correo_id: c.id, nombre_archivo: nombre, mime: "application/pdf", url: s.url, storage_path: s.path, estado: "PENDIENTE", error: null }]) });
      await sb(`compras_correo?id=eq.${c.id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ num_adjuntos: 1, error: null }) });
      console.log(`✓ ${c.fecha_correo?.slice(0, 10)} ${c.remitente} → ${nombre} (${buf.length} bytes)`);
      ok = true; break;
    } catch (e) { console.warn(`  ✗ ${url.slice(0, 80)}: ${e.message}`); }
  }
  if (ok) hechos++; else { fallidos++; console.warn(`✗ sin PDF: ${c.fecha_correo?.slice(0, 10)} ${c.remitente} ${c.asunto}`); }
}
console.log(`HECHO: rescatados ${hechos} · ya tenían fichero ${saltados} · sin PDF ${fallidos}`);
