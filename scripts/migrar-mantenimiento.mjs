/**
 * Mudanza de Mantenimiento: copia TODOS los partes del Supabase del proyecto
 * mantenimiento-bonita (abierto con su clave publicable) a la tabla
 * mant_partes del Supabase de Hostelero, conservando los id originales.
 * Idempotente: on_conflict sobre id no duplica si se relanza.
 *
 * Los medios (fotos/vídeos en base64) viajan tal cual dentro del jsonb, así
 * que los lotes van pequeños: un parte con fotos pesa cientos de KB.
 *
 * Claves: HOSTELERO_URL y HOSTELERO_SERVICE_KEY desde .env.local (gitignored).
 * Uso: node scripts/migrar-mantenimiento.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ORIGEN_URL = "https://zqvkaeuwqxyixvanwxtl.supabase.co";
const ORIGEN_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxdmthZXV3cXh5aXh2YW53eHRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5ODU2NzIsImV4cCI6MjA5NjU2MTY3Mn0.TfYe371pbJorYurdxTGUfztTltK9ZJ2WkJGUkI5Ir_M";
const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca

const env = {};
for (const linea of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = linea.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
if (!env.HOSTELERO_URL || !env.HOSTELERO_SERVICE_KEY) {
  console.error("Faltan HOSTELERO_URL o HOSTELERO_SERVICE_KEY en .env.local");
  process.exit(1);
}

const origen = await fetch(`${ORIGEN_URL}/rest/v1/partes?select=*&order=id.asc`, {
  headers: { apikey: ORIGEN_KEY, Authorization: `Bearer ${ORIGEN_KEY}` },
});
if (!origen.ok) throw new Error(`lectura del origen: ${origen.status}`);
const partes = await origen.json();
console.log(`Origen: ${partes.length} partes`);

let copiados = 0;
for (const p of partes) {
  const r = await fetch(`${env.HOSTELERO_URL}/rest/v1/mant_partes?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: env.HOSTELERO_SERVICE_KEY,
      Authorization: `Bearer ${env.HOSTELERO_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal,resolution=ignore-duplicates",
    },
    body: JSON.stringify({ ...p, cuenta_id: CUENTA_ID }),
  });
  if (!r.ok) throw new Error(`parte ${p.id}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  copiados++;
  if (copiados % 10 === 0) console.log(`${copiados}/${partes.length}`);
}
console.log(`HECHO: ${copiados} partes copiados. Queda ajustar la secuencia del id.`);
