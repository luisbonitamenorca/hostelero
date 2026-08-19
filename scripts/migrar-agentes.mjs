/**
 * Mudanza de Agentes: copia las 13 tablas agent_* del Supabase del proyecto
 * agentes-bonita al de Hostelero, conservando claves. Idempotente
 * (ignore-duplicates sobre la PK). El origen tiene RLS de solo-autenticados,
 * así que se lee con el usuario puente (credencial en plataforma_secretos,
 * que este script consulta con la service key de .env.local).
 *
 * Orden de copia: los padres antes que sus hijos (FKs).
 * Uso: node scripts/migrar-agentes.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TABLAS = [
  "agent_tones", "agent_reviews", "agent_runs", "agent_knowledge",
  "agent_competitors", "agent_watch_findings", "agent_sync_checks",
  "agent_sync_alerts", "agent_grants", "agent_grant_profile",
  "agent_prospects", "agent_wa_chats", "agent_wa_messages",
];
const PK = { agent_tones: "venue" }; // el resto usa "id"

const env = {};
for (const linea of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = linea.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
if (!env.HOSTELERO_URL || !env.HOSTELERO_SERVICE_KEY) {
  console.error("Faltan HOSTELERO_URL o HOSTELERO_SERVICE_KEY en .env.local");
  process.exit(1);
}
const cabecerasHostelero = {
  apikey: env.HOSTELERO_SERVICE_KEY,
  Authorization: `Bearer ${env.HOSTELERO_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// 1) credencial del puente y sesión en el origen
const rSecreto = await fetch(
  `${env.HOSTELERO_URL}/rest/v1/plataforma_secretos?clave=eq.agentes_puente&select=valor`,
  { headers: cabecerasHostelero },
);
const [fila] = await rSecreto.json();
if (!fila) throw new Error("no está el secreto agentes_puente");
const puente = fila.valor;

const rToken = await fetch(`${puente.url}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: puente.anon, "Content-Type": "application/json" },
  body: JSON.stringify({ email: puente.email, password: puente.password }),
});
if (!rToken.ok) throw new Error(`login del puente: ${rToken.status}`);
const { access_token } = await rToken.json();
const cabecerasOrigen = { apikey: puente.anon, Authorization: `Bearer ${access_token}` };

// 2) tabla a tabla
for (const tabla of TABLAS) {
  const r = await fetch(`${puente.url}/rest/v1/${tabla}?select=*`, { headers: cabecerasOrigen });
  if (!r.ok) throw new Error(`${tabla} lectura: ${r.status}`);
  const filas = await r.json();
  if (filas.length) {
    const pk = PK[tabla] ?? "id";
    const w = await fetch(`${env.HOSTELERO_URL}/rest/v1/${tabla}?on_conflict=${pk}`, {
      method: "POST",
      headers: { ...cabecerasHostelero, Prefer: "return=minimal,resolution=ignore-duplicates" },
      body: JSON.stringify(filas),
    });
    if (!w.ok) throw new Error(`${tabla} escritura: ${w.status} ${(await w.text()).slice(0, 200)}`);
  }
  console.log(`${tabla}: ${filas.length}`);
}
console.log("HECHO");
