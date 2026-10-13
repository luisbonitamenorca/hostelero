/**
 * Carga del informe de SATISFACCIÓN de CoverManager (Analytics › Informes › Satisfacción,
 * «Descargar CSV», llega por correo con «;») en reservas_valoraciones, para la pestaña
 * Valoraciones de Ratios (13-10-2026, Luis).
 *
 *   node scripts/cargar-cover-valoraciones.mjs <satisfaccion.csv> [--dry-run]
 *
 * · Idempotente: cada fila de Cover tiene una huella (md5 de restaurante + fechas + hora +
 *   contacto + notas); una segunda pasada no duplica ni cambia nada.
 * · Enlaza con la reserva del módulo cuando la encuentra (mismo restaurante, fecha de reserva,
 *   hora y teléfono o correo); si no, queda sin reserva_id (los años anteriores a 2026 no
 *   están en el módulo).
 * · Escrituras por lotes con FILAS COMPLETAS (mismas columnas en todas), como manda la casa.
 *
 * Claves en .env.local (raíz): HOSTELERO_URL y HOSTELERO_SERVICE_KEY. PII solo en memoria; el
 * informe imprime recuentos.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca
const args = process.argv.slice(2);
const FICHERO = args.find((a) => !a.startsWith("--"));
const DRY = args.includes("--dry-run");
const LOTE = 500;

if (!FICHERO) {
  console.error("Uso: node scripts/cargar-cover-valoraciones.mjs <satisfaccion.csv> [--dry-run]");
  process.exit(1);
}

const RESTAURANTES = {
  "Bodegas Binifadet": "binifadet",
  Tamarindos: "tamarindos",
  "Casa Tirant": "casa-tirant",
  "El Bar de Tamarindos": "bar-tamarindos",
};

const env = {};
for (const linea of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const l = linea.trim();
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const [k, ...v] = l.split("=");
  env[k.trim()] = v.join("=").trim();
}
if (!env.HOSTELERO_URL || !env.HOSTELERO_SERVICE_KEY) {
  console.error("Faltan HOSTELERO_URL / HOSTELERO_SERVICE_KEY en .env.local");
  process.exit(1);
}
const sb = createClient(env.HOSTELERO_URL, env.HOSTELERO_SERVICE_KEY, { auth: { persistSession: false } });

function parseDelimitado(texto, sep) {
  const filas = [];
  let fila = [], campo = "", enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else enComillas = false;
      } else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === sep) { fila.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo); campo = "";
      if (fila.length > 1 || fila[0] !== "") filas.push(fila);
      fila = [];
    } else campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

const texto = readFileSync(resolve(FICHERO), "utf8").replace(/^﻿/, "");
const filas = parseDelimitado(texto, ";");
const cab = filas[0].map((h) => h.trim());
const ix = Object.fromEntries(cab.map((h, i) => [h, i]));
const datos = filas.slice(1).filter((f) => f.length >= cab.length - 2);
const g = (f, col) => (ix[col] == null ? "" : (f[ix[col]] ?? "").trim());

const nota = (s) => {
  const t = String(s ?? "").trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 10 ? Math.round(n) : null;
};
const fecha = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
const hora = (s) => (/^\d{1,2}:\d{2}/.test(s) ? s.slice(0, 5) + ":00" : null);
const normTel = (prefijo, tel) => {
  let d = String(tel || "").replace(/\D/g, "");
  if (!d) return null;
  const p = String(prefijo || "").replace(/\D/g, "");
  if (p && p !== "34" && !d.startsWith(p)) d = p + d;
  if (p === "34" && d.length === 9) return d;
  if (d.startsWith("34") && d.length === 11) return d.slice(2);
  return d;
};
const normEmail = (e) => (String(e || "").trim().toLowerCase() || null);

/* ================= maestros ================= */

const { data: rests, error: eR } = await sb.from("reservas_restaurantes").select("id, slug").eq("cuenta_id", CUENTA_ID);
if (eR) throw new Error(eR.message);
const restPorSlug = new Map(rests.map((r) => [r.slug, r.id]));

const { data: existentes, error: eE } = await sb.from("reservas_valoraciones").select("huella, reserva_id").eq("cuenta_id", CUENTA_ID).range(0, 99999);
if (eE && !(DRY && /reservas_valoraciones/.test(eE.message))) {
  if (/reservas_valoraciones/.test(eE.message)) {
    console.error("La tabla reservas_valoraciones no existe: aplica la migración 20261013204406 antes de cargar.");
    process.exit(1);
  }
  throw new Error(eE.message);
}
if (eE) console.warn("Aviso: la tabla reservas_valoraciones aún no existe; la simulación supone que está vacía.");
const huellas = new Map((existentes || []).map((e) => [e.huella, e]));

/* ================= filas ================= */

const nuevas = [];
let repetidas = 0, sinRestaurante = 0, sinFecha = 0;
const clavesReserva = new Set();
for (const f of datos) {
  const slug = RESTAURANTES[g(f, "Restaurante")];
  const restaurante_id = slug ? restPorSlug.get(slug) : null;
  if (!restaurante_id) { sinRestaurante++; continue; }
  const fecha_valoracion = fecha(g(f, "Fecha de valoración"));
  if (!fecha_valoracion) { sinFecha++; continue; }
  const fecha_reserva = fecha(g(f, "Fecha Reserva"));
  const h = hora(g(f, "Hora"));
  const telefono = normTel(g(f, "Prefijo"), g(f, "Teléfono"));
  const email = normEmail(g(f, "Email"));
  const notas = {
    cocina: nota(g(f, "Cocina")),
    servicio_nota: nota(g(f, "Servicio")),
    ambiente: nota(g(f, "Ambiente")),
    vinos: nota(g(f, "Vinos")),
    visita_cata: nota(g(f, "Visita y Cata")),
  };
  const huella = createHash("md5")
    .update([slug, fecha_valoracion, fecha_reserva, h, telefono, email, g(f, "Nombre"), g(f, "Apellidos"),
      notas.cocina, notas.servicio_nota, notas.ambiente, notas.vinos, notas.visita_cata, g(f, "Opinión")].join("|"))
    .digest("hex");
  if (huellas.has(huella)) { repetidas++; continue; }
  huellas.set(huella, true);
  const turno = g(f, "Turno");
  const fila = {
    cuenta_id: CUENTA_ID,
    restaurante_id,
    reserva_id: null,
    huella,
    fecha_valoracion,
    fecha_reserva,
    hora: h,
    servicio: /cena/i.test(turno) ? "Cena" : turno ? "Comida" : null,
    pax: Number(g(f, "PAX")) || null,
    ...notas,
    opinion: g(f, "Opinión") || null,
    nombre: g(f, "Nombre") || null,
    apellidos: g(f, "Apellidos") || null,
    telefono,
    email,
    origen: g(f, "Origen") || null,
    prescriptor: g(f, "Prescriptor") || null,
    cover_meta: {
      estado: g(f, "Estado") || null,
      mesas: g(f, "Mesas") || null,
      pais: g(f, "País") || null,
      observaciones: g(f, "Observaciones") || null,
      fecha_anadida: g(f, "Fecha añadida") || null,
      n_pax_dia: Number(g(f, "N PAX")) || null,
    },
  };
  nuevas.push(fila);
  if (fecha_reserva && h) clavesReserva.add(`${restaurante_id}|${fecha_reserva}`);
}

/* ================= enlace con la reserva ================= */

// Reservas del módulo en los días que aparecen: se enlaza por hora y teléfono o correo.
let enlazadas = 0;
if (nuevas.length) {
  const dias = [...new Set(nuevas.map((n) => n.fecha_reserva).filter(Boolean))];
  const porClave = new Map();
  for (let i = 0; i < dias.length; i += 200) {
    // El contacto no está en la reserva sino en su ficha de cliente (reservas_clientes).
    const { data, error } = await sb
      .from("reservas_reservas")
      .select("id, restaurante_id, fecha, hora, cliente_id")
      .eq("cuenta_id", CUENTA_ID)
      .in("fecha", dias.slice(i, i + 200))
      .range(0, 49999);
    if (error) { console.warn("No pude leer reservas para enlazar:", error.message); break; }
    const ids = [...new Set(data.map((r) => r.cliente_id).filter(Boolean))];
    const contacto = new Map();
    for (let j = 0; j < ids.length; j += 300) {
      const { data: cl, error: eC } = await sb.from("reservas_clientes").select("id, telefono, email").in("id", ids.slice(j, j + 300));
      if (eC) { console.warn("No pude leer clientes para enlazar:", eC.message); break; }
      for (const c of cl) contacto.set(c.id, c);
    }
    for (const r of data) {
      const c = contacto.get(r.cliente_id);
      if (!c) continue;
      const h = String(r.hora || "").slice(0, 5);
      const tel = normTel("", c.telefono);
      const em = normEmail(c.email);
      if (tel) porClave.set(`${r.restaurante_id}|${r.fecha}|${h}|t:${tel}`, r.id);
      if (em) porClave.set(`${r.restaurante_id}|${r.fecha}|${h}|e:${em}`, r.id);
    }
  }
  for (const n of nuevas) {
    if (!n.fecha_reserva || !n.hora) continue;
    const h = n.hora.slice(0, 5);
    const id = (n.telefono && porClave.get(`${n.restaurante_id}|${n.fecha_reserva}|${h}|t:${n.telefono}`))
      || (n.email && porClave.get(`${n.restaurante_id}|${n.fecha_reserva}|${h}|e:${n.email}`)) || null;
    if (id) { n.reserva_id = id; enlazadas++; }
  }
}

console.log(`Cover → Valoraciones${DRY ? " (SIMULACIÓN, no escribe)" : ""}`);
console.log(`  informe: ${datos.length} filas · ya cargadas: ${repetidas} · sin restaurante: ${sinRestaurante} · sin fecha: ${sinFecha}`);
console.log(`  nuevas: ${nuevas.length} · enlazadas a una reserva del módulo: ${enlazadas}`);
const porRest = {};
for (const n of nuevas) { const s = rests.find((r) => r.id === n.restaurante_id)?.slug; porRest[s] = (porRest[s] || 0) + 1; }
console.log(`  por restaurante: ${Object.entries(porRest).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}`);

if (DRY || !nuevas.length) { console.log(DRY ? "\nSimulación: no se ha escrito nada." : "\nNada que cargar."); process.exit(0); }

for (let i = 0; i < nuevas.length; i += LOTE) {
  const lote = nuevas.slice(i, i + LOTE);
  const { error } = await sb.from("reservas_valoraciones").insert(lote);
  if (error) throw new Error(`insertar valoraciones: ${error.message}`);
  process.stdout.write(`\r  reservas_valoraciones: insertadas ${Math.min(i + LOTE, nuevas.length)}/${nuevas.length}   `);
}
const { count } = await sb.from("reservas_valoraciones").select("id", { count: "exact", head: true }).eq("cuenta_id", CUENTA_ID);
console.log(`\n\nHecho. En la base ahora: ${count} valoraciones.`);
