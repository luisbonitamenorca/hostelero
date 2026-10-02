/**
 * Sincroniza reservas_clientes con CoverManager: una ficha por persona, con los datos de Cover, y
 * cada reserva apuntando a la ficha de la persona que la hizo.
 *
 *   node scripts/sincronizar-clientes-cover.mjs <tracking.csv> <clientes.tsv> [--dry-run]
 *
 * Ficheros (los mismos que cargar-cover-tracking.mjs):
 *   · Tracking de reservas de Cover (CSV con «;», todas las reservas, todos los locales).
 *   · Listado de clientes de Cover (TSV: ID, Nombre, Apellidos, Código, Teléfono, Email, …).
 *
 * Por qué existe (01-10-2026): la primera versión del cargador actualizaba clientes con un upsert
 * por lotes en el que cada fila llevaba columnas distintas; PostgREST aplica a todas las filas del
 * lote la unión de columnas, y las que faltaban en una fila se escribían con su valor por defecto.
 * Así se vaciaron teléfonos, emails e IDs de Cover y cada pasada creaba duplicados. Este script
 * reconstruye el estado correcto desde Cover (la fuente de verdad) y es idempotente: una segunda
 * ejecución no cambia nada. Todas las escrituras masivas usan filas completas (mismas columnas en
 * todas las filas del lote) o update() con el mismo valor para todo el lote.
 *
 * Algoritmo:
 *   1. Personas = clientes de Cover agrupados por teléfono normalizado → email → nombre. Los
 *      contactos del tracking que no estén en el listado forman personas propias.
 *   2. Cada ficha existente se asigna a una persona: si tiene reservas, por mayoría de los contactos
 *      de sus reservas en el tracking; si no, por ID de Cover, teléfono o email.
 *   3. Por persona, una ficha canónica (la de más reservas); sus datos = Cover, completados con lo
 *      que hubiera en la canónica y en sus duplicados (no se pierde nada que solo estuviera aquí).
 *   4. Cada reserva del tracking apunta a la canónica de su contacto.
 *   5. Se eliminan los duplicados y las fichas sin persona ni referencias (las vacías del fallo).
 *      Las fichas sin persona pero con referencias (pruebas del sistema antiguo) se respetan.
 *
 * Claves en .env.local (raíz): HOSTELERO_URL y HOSTELERO_SERVICE_KEY. PII: solo en memoria; el
 * informe imprime recuentos, nunca datos personales.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca
const args = process.argv.slice(2);
const [TRACKING, CLIENTES] = args.filter((a) => !a.startsWith("--"));
const DRY = args.includes("--dry-run");
const LOTE = 500;
const CONCURRENCIA = 8;

if (!TRACKING || !CLIENTES) {
  console.error("Uso: node scripts/sincronizar-clientes-cover.mjs <tracking.csv> <clientes.tsv> [--dry-run]");
  process.exit(1);
}

const IDIOMAS = { spanish: "es", english: "en", french: "fr", italian: "it", german: "de", portuguese: "pt", catalan: "ca" };

/* ================= utilidades ================= */

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

/** CSV con comillas dobles (el tracking de Cover). */
function parseCsv(texto, sep) {
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

function tabla(filas) {
  const cab = filas[0].map((h) => h.trim());
  const ix = Object.fromEntries(cab.map((h, i) => [h, i]));
  const datos = filas.slice(1).filter((f) => f.length >= cab.length - 1);
  return { datos, get: (f, col) => (ix[col] == null ? "" : String(f[ix[col]] ?? "").trim()) };
}

const leerTexto = (ruta) => readFileSync(resolve(ruta), "utf8").replace(/^﻿/, "");

/** Teléfono normalizado. Misma regla que reservas_norm_tel para España (9 cifras) y prefijo
    internacional delante para el resto; no duplica el prefijo si el número ya lo trae. */
function normTel(prefijo, tel) {
  let d = String(tel || "").replace(/\D/g, "");
  const p = String(prefijo || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (p && p !== "34" && !(d.startsWith(p) && d.length - p.length >= 9)) d = p + d;
  if (d.length === 13 && d.startsWith("0034")) d = d.slice(4);
  else if (d.length === 11 && d.startsWith("34")) d = d.slice(2);
  return d.length >= 6 ? d : null;
}
const normEmail = (e) => {
  const x = String(e || "").trim().toLowerCase();
  return x && x.includes("@") ? x : null;
};
// Clientes «comodín» de Cover sin contacto (walk-ins y prerreservas de OpenTable): no son
// personas; sus reservas quedan sin ficha de cliente.
const SIN_CLIENTE = "__sin_cliente__";
const esGenerico = (n, a) => /^(walk[\s-]?in|walkin|opentable[\s-]?prereserv|sin nombre|cliente|no name|-+|\.+)$/i
  .test(`${String(n || "").trim()} ${String(a || "").trim()}`.trim());
const nombreKey = (n, a) => `${String(n || "").trim().toLowerCase()}|${String(a || "").trim().toLowerCase()}`;
const vacio = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const siNo = (v) => /^(si|sí|yes|s)$/i.test(String(v || "").trim());
const primero = (...vs) => vs.find((v) => !vacio(v)) ?? null;
// une textos sin repetir; parte primero los ya unidos para que una segunda pasada no duplique
const unir = (vs, sep) => [...new Set(vs.filter((v) => !vacio(v)).flatMap((v) => String(v).split(sep))
  .map((v) => v.trim()).filter(Boolean))].join(sep) || null;

function tsMadrid(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || "")) return null;
  return new Date(`${fecha}T10:00:00Z`).toISOString(); // mediodía en Menorca
}

const canon = (v) => (v && typeof v === "object" && !Array.isArray(v))
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
  : Array.isArray(v) ? [...v].map(canon) : v;
const igual = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
const igualConjunto = (a, b) => igual([...(a || [])].sort(), [...(b || [])].sort());

async function todas(tablaNombre, select) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from(tablaNombre).select(select).eq("cuenta_id", CUENTA_ID).order("id").range(desde, desde + 999);
    if (error) throw new Error(`${tablaNombre}: ${error.message}`);
    filas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return filas;
}

async function enParalelo(tareas, limite = CONCURRENCIA) {
  let i = 0, hechas = 0;
  const trabajador = async () => {
    while (i < tareas.length) {
      const t = tareas[i++];
      await t();
      hechas++;
      if (hechas % 200 === 0) process.stdout.write(`\r    ${hechas}/${tareas.length}   `);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, tareas.length) }, trabajador));
  if (tareas.length >= 200) console.log(`\r    ${tareas.length}/${tareas.length}   `);
}

const trozos = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, k) => arr.slice(k * n, k * n + n));

/* ================= 1. personas de Cover ================= */

console.log(`Sincronizar clientes con Cover${DRY ? " (SIMULACIÓN, no escribe)" : ""}\n`);

const etiquetasBD = await todas("reservas_etiquetas", "id,ambito,nombre");
const etqCliente = new Map(etiquetasBD.filter((e) => e.ambito === "cliente").map((e) => [e.nombre.trim().toLowerCase(), e.id]));
const etqNuevas = new Map(); // nombre en minúsculas → nombre original

function idsEtiquetas(texto) {
  const nombres = String(texto || "").split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  for (const n of nombres) if (!etqCliente.has(n.toLowerCase())) etqNuevas.set(n.toLowerCase(), n);
  return nombres; // se resuelven a ids cuando existan todas
}

const personas = new Map(); // clave → persona
const porCover = new Map(); // ID de Cover → clave
const porEmail = new Map(); // email → clave (primera persona con ese email)

function clavePara(tel, email, nombre, apellidos, coverId) {
  if (tel) return `t:${tel}`;
  if (email) return `e:${email}`;
  const nk = nombreKey(nombre, apellidos);
  if (nk !== "|") return `n:${nk}`;
  return coverId ? `c:${coverId}` : null;
}

{
  // El TSV lo generamos nosotros desde la tabla de Cover: tabuladores, sin comillas.
  const lineas = leerTexto(CLIENTES).split("\n").filter((l) => l.length);
  const t = tabla(lineas.map((l) => l.split("\t")));
  for (const f of t.datos) {
    const g = (c) => t.get(f, c);
    const coverId = g("ID");
    if (!coverId) continue;
    const tel = normTel(g("Código"), g("Teléfono"));
    const email = normEmail(g("Email"));
    if (!tel && !email && esGenerico(g("Nombre"), g("Apellidos"))) continue;
    const clave = clavePara(tel, email, g("Nombre"), g("Apellidos"), coverId);
    if (!clave) continue;
    let p = personas.get(clave);
    if (!p) { p = { clave, tel, filas: [], tracking: [] }; personas.set(clave, p); }
    p.filas.push({
      coverId,
      nombre: g("Nombre"), apellidos: g("Apellidos"), email,
      tel2: normTel("", g("Teléfono 2")),
      pais: g("País") || null, cp: g("Código Postal") || null, empresa: g("Empresa") || null,
      etiquetas: idsEtiquetas(g("Etiquetas de cliente")),
      subscrito: siNo(g("Subscrito")),
      registro: g("Fecha registro"),
      reservas: Number(g("Reservas")) || 0,
      idioma: IDIOMAS[g("Idioma").toLowerCase()] || null,
      direccion: g("Dirección") || null,
      nacimiento: /^\d{4}-\d{2}-\d{2}$/.test(g("Fecha de nacimiento")) ? g("Fecha de nacimiento") : null,
      socio: g("Número de socio") && g("Número de socio") !== "0" ? g("Número de socio") : null,
      alergias: g("Restricciones alimentarias") || null,
      notas: [g("Notas del cliente"), g("Preferencia de mesa") && `Mesa: ${g("Preferencia de mesa")}`,
        g("Preferencia de camarero") && `Camarero: ${g("Preferencia de camarero")}`,
        g("Preferencia alimentarias") && `Preferencias: ${g("Preferencia alimentarias")}`, g("Campo Adicional")]
        .filter(Boolean).join(" · ") || null,
      origen: g("Origen del cliente") || null,
    });
    porCover.set(coverId, clave);
    if (email && !porEmail.has(email)) porEmail.set(email, clave);
  }
}
const personasCover = personas.size;

/* ================= 2. contactos del tracking ================= */

const contactoReserva = new Map(); // token (localizador) → clave de persona
{
  const t = tabla(parseCsv(leerTexto(TRACKING), ";"));
  for (const f of t.datos) {
    const g = (c) => t.get(f, c);
    const token = g("Token");
    if (!token) continue;
    const tel = normTel(g("Prefijo"), g("Teléfono"));
    const email = normEmail(g("Email"));
    let clave = null;
    if (!tel && !email && esGenerico(g("Nombre"), g("Apellidos"))) { contactoReserva.set(token.toUpperCase(), SIN_CLIENTE); continue; }
    if (tel && personas.has(`t:${tel}`)) clave = `t:${tel}`;
    else if (email && porEmail.has(email)) clave = porEmail.get(email);
    else if (!tel && !email && personas.has(`n:${nombreKey(g("Nombre"), g("Apellidos"))}`)) clave = `n:${nombreKey(g("Nombre"), g("Apellidos"))}`;
    if (!clave) {
      // contacto que no está en el listado de clientes de Cover: persona propia
      clave = clavePara(tel, email, g("Nombre"), g("Apellidos"), null);
      if (!clave) continue;
      let p = personas.get(clave);
      if (!p) { p = { clave, tel, filas: [], tracking: [] }; personas.set(clave, p); if (email && !porEmail.has(email)) porEmail.set(email, clave); }
      p.tracking.push({
        fecha: g("Fecha Añadida"), nombre: g("Nombre"), apellidos: g("Apellidos"), email,
        pais: g("País") || null, cp: g("Código Postal") || null, empresa: g("Empresa") || null,
        subscrito: siNo(g("Subscrito")), etiquetas: idsEtiquetas(g("Etiquetas de cliente")),
      });
    }
    contactoReserva.set(token.toUpperCase(), clave);
  }
}

/* ================= 3. fichas actuales → personas ================= */

const clientes = await todas("reservas_clientes", "*");
const reservas = await todas("reservas_reservas", "id,cliente_id,localizador,cover_id");
const espera = (await todas("reservas_lista_espera", "id,cliente_id")).filter((x) => x.cliente_id);
const mensajes = (await todas("reservas_mensajes", "id,cliente_id")).filter((x) => x.cliente_id);
console.log(`Cover: ${personasCover} personas en el listado (+${personas.size - personasCover} solo en el tracking) · tracking: ${contactoReserva.size} reservas`);
console.log(`Base: ${clientes.length} fichas, ${reservas.length} reservas, ${espera.length} en espera con ficha, ${mensajes.length} mensajes con ficha`);

const reservasDe = new Map(); // cliente_id → reservas
const claveReserva = (r) => contactoReserva.get(String(r.cover_id || r.localizador || "").toUpperCase());
for (const r of reservas) {
  if (!r.cliente_id || claveReserva(r) === SIN_CLIENTE) continue;
  if (!reservasDe.has(r.cliente_id)) reservasDe.set(r.cliente_id, []);
  reservasDe.get(r.cliente_id).push(r);
}
const referenciada = new Set([...reservasDe.keys(), ...espera.map((x) => x.cliente_id), ...mensajes.map((x) => x.cliente_id)]);

const personaDe = new Map(); // cliente.id → clave
const votos = new Map(); // cliente.id → nº de reservas de su persona
for (const c of clientes) {
  let clave = null, n = 0;
  const rs = reservasDe.get(c.id) || [];
  if (rs.length) {
    const cuenta = new Map();
    for (const r of rs) {
      const k = contactoReserva.get(String(r.cover_id || r.localizador || "").toUpperCase());
      if (k) cuenta.set(k, (cuenta.get(k) || 0) + 1);
    }
    for (const [k, v] of [...cuenta].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) { clave = k; n = v; break; }
  }
  if (!clave && c.cover_id && porCover.has(c.cover_id)) clave = porCover.get(c.cover_id);
  if (!clave && c.telefono_norm && personas.has(`t:${c.telefono_norm}`)) clave = `t:${c.telefono_norm}`;
  if (!clave && c.telefono && personas.has(`t:${normTel("", c.telefono)}`)) clave = `t:${normTel("", c.telefono)}`;
  if (!clave && c.email_norm && porEmail.has(c.email_norm)) clave = porEmail.get(c.email_norm);
  if (clave) { personaDe.set(c.id, clave); votos.set(c.id, n); }
}

// Rescate por nombre: ficha sin otra pista cuyo nombre corresponde a UNA sola persona de Cover
// (también «Nombre Apellidos» guardado entero en nombre). Así una ficha a la que se le vació el
// teléfono no se pierde: se une a su persona y sus datos propios pasan a la canónica.
{
  const porNombre = new Map(); // clave de nombre → Set(personas)
  const añadir = (nk, k) => { if (nk === "|") return; if (!porNombre.has(nk)) porNombre.set(nk, new Set()); porNombre.get(nk).add(k); };
  for (const [k, p] of personas) {
    for (const f of [...p.filas, ...p.tracking]) {
      añadir(nombreKey(f.nombre, f.apellidos), k);
      añadir(nombreKey(`${f.nombre} ${f.apellidos || ""}`.trim(), ""), k);
    }
  }
  let rescatadas = 0;
  for (const c of clientes) {
    if (personaDe.has(c.id) || referenciada.has(c.id)) continue;
    const ks = new Set([
      ...(porNombre.get(nombreKey(c.nombre, c.apellidos)) || []),
      ...(porNombre.get(nombreKey(`${c.nombre} ${c.apellidos || ""}`.trim(), "")) || []),
    ]);
    if (ks.size !== 1) continue;
    personaDe.set(c.id, [...ks][0]);
    votos.set(c.id, 0);
    rescatadas++;
  }
  console.log(`Fichas sin pista unidas a su persona por nombre (único en Cover): ${rescatadas}`);
}

// Canónica por persona: la de más reservas de esa persona; luego la que ya tiene su ID de Cover.
const fichasDe = new Map(); // clave → [cliente]
for (const c of clientes) {
  const k = personaDe.get(c.id);
  if (!k) continue;
  if (!fichasDe.has(k)) fichasDe.set(k, []);
  fichasDe.get(k).push(c);
}
const canonica = new Map(); // clave → cliente
const duplicados = []; // {id, canonicaClave}
for (const [k, fs] of fichasDe) {
  const p = personas.get(k);
  const coverPrincipal = p.filas.length ? [...p.filas].sort(ordenFilas)[0].coverId : null;
  fs.sort((a, b) => (votos.get(b.id) || 0) - (votos.get(a.id) || 0)
    || ((b.cover_id === coverPrincipal) - (a.cover_id === coverPrincipal))
    || (a.id < b.id ? -1 : 1));
  canonica.set(k, fs[0]);
  for (const d of fs.slice(1)) duplicados.push({ id: d.id, clave: k });
}
function ordenFilas(a, b) {
  return b.reservas - a.reservas || String(a.registro).localeCompare(String(b.registro)) || (a.coverId < b.coverId ? -1 : 1);
}

const sinPersona = clientes.filter((c) => !personaDe.has(c.id));
const huerfanasConRefs = sinPersona.filter((c) => referenciada.has(c.id));
const basura = sinPersona.filter((c) => !referenciada.has(c.id));

/* ================= 4. ficha objetivo por persona ================= */

// etiquetas nuevas de Cover (se crean antes de calcular ids)
if (etqNuevas.size && !DRY) {
  const filas = [...etqNuevas.values()].map((nombre) => ({ cuenta_id: CUENTA_ID, ambito: "cliente", nombre, color: "#888888", orden: 500 }));
  for (const lote of trozos(filas, LOTE)) {
    const { data, error } = await sb.from("reservas_etiquetas").insert(lote, { defaultToNull: false }).select("id,nombre");
    if (error) throw new Error(`etiquetas: ${error.message}`);
    for (const e of data) etqCliente.set(e.nombre.trim().toLowerCase(), e.id);
  }
}
const aIds = (nombres) => nombres.map((n) => etqCliente.get(n.toLowerCase())).filter(Boolean);

const telefonosDePersonas = new Set([...personas.values()].map((p) => p.tel).filter(Boolean));
const coversDePersonas = new Set(porCover.keys());

function objetivo(p, base, dups) {
  const fs = [...p.filas].sort(ordenFilas);
  const pr = fs[0] || null;
  const tr = [...p.tracking].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0] || null;
  const fuentes = [base, ...dups]; // lo que ya había en la base (canónica primero)
  const etiquetasCover = new Set(aIds(fs.flatMap((f) => f.etiquetas).concat(p.tracking.flatMap((t) => t.etiquetas))));
  const etiquetas = [...new Set([...(base?.etiquetas || []), ...dups.flatMap((d) => d.etiquetas || []), ...etiquetasCover])].sort();
  const nombresEtq = fs.flatMap((f) => f.etiquetas).concat(p.tracking.flatMap((t) => t.etiquetas));

  let nombre = primero(pr?.nombre, ...fs.map((f) => f.nombre), tr?.nombre);
  let apellidos = primero(pr?.apellidos, ...fs.map((f) => f.apellidos), tr?.apellidos);
  if (!nombre && apellidos) { nombre = apellidos; apellidos = null; }
  if (!nombre) { nombre = primero(...fuentes.map((x) => x?.nombre)) || "Sin nombre"; apellidos = primero(...fuentes.map((x) => x?.apellidos)); }

  // teléfono: el de la persona; si no tiene, el que hubiera (si no es de otra persona)
  let telefono = p.tel;
  if (!telefono) {
    const t = primero(...fuentes.map((x) => x?.telefono));
    telefono = t && !telefonosDePersonas.has(normTel("", t)) ? t : null;
  }
  const otrosTel = [...new Set(fs.map((f) => f.tel2).filter((x) => x && x !== telefono))];
  let coverId = pr?.coverId ?? null;
  if (!coverId) { const c = primero(...fuentes.map((x) => x?.cover_id)); coverId = c && !coversDePersonas.has(c) ? c : null; }

  const fila = {
    nombre,
    apellidos: apellidos || null,
    telefono,
    email: primero(pr?.email, ...fs.map((f) => f.email), tr?.email, ...fuentes.map((x) => x?.email)),
    idioma: primero(pr?.idioma, ...fs.map((f) => f.idioma), ...fuentes.map((x) => x?.idioma)) || "es",
    pais: primero(pr?.pais, ...fs.map((f) => f.pais), tr?.pais, ...fuentes.map((x) => x?.pais)) || "ES",
    codigo_postal: primero(pr?.cp, ...fs.map((f) => f.cp), tr?.cp, ...fuentes.map((x) => x?.codigo_postal)),
    empresa: primero(pr?.empresa, ...fs.map((f) => f.empresa), tr?.empresa, ...fuentes.map((x) => x?.empresa)),
    telefono_adicional: primero(otrosTel[0], ...fuentes.map((x) => x?.telefono_adicional)),
    fecha_nacimiento: primero(pr?.nacimiento, ...fs.map((f) => f.nacimiento), ...fuentes.map((x) => x?.fecha_nacimiento)),
    numero_socio: primero(pr?.socio, ...fs.map((f) => f.socio), ...fuentes.map((x) => x?.numero_socio)),
    alergias: unir([...fs.map((f) => f.alergias), ...fuentes.map((x) => x?.alergias)], " / "),
    notas: unir([...fs.map((f) => f.notas), ...fuentes.map((x) => x?.notas)], "\n"),
    etiquetas,
    vip: fuentes.some((x) => x?.vip) || nombresEtq.some((n) => /\bvip\b/i.test(n)),
    lista_negra: fuentes.some((x) => x?.lista_negra) || nombresEtq.some((n) => /black[\s-]?list/i.test(n)),
    consentimiento_marketing: fuentes.some((x) => x?.consentimiento_marketing) || fs.some((f) => f.subscrito) || p.tracking.some((t) => t.subscrito),
    cover_id: coverId,
    cover_meta: fs.length ? {
      origen: pr.origen,
      origenes: [...new Set(fs.map((f) => f.origen).filter(Boolean))].sort(),
      reservas_cover: fs.reduce((s, f) => s + f.reservas, 0),
      direccion: primero(pr.direccion, ...fs.map((f) => f.direccion)),
      otros_ids: fs.slice(1).map((f) => f.coverId).sort(),
    } : { solo_tracking: true },
  };
  const registros = fs.map((f) => tsMadrid(f.registro)).filter(Boolean);
  const creados = [...registros, ...fuentes.map((x) => x?.creado_en).filter(Boolean)].map((x) => new Date(x).getTime());
  if (creados.length) fila.creado_en = new Date(Math.min(...creados)).toISOString();
  return fila;
}

const CAMPOS = ["nombre", "apellidos", "telefono", "email", "idioma", "pais", "codigo_postal", "empresa", "telefono_adicional",
  "fecha_nacimiento", "numero_socio", "alergias", "notas", "etiquetas", "vip", "lista_negra", "consentimiento_marketing",
  "cover_id", "cover_meta", "creado_en"];

const clientePorId = new Map(clientes.map((c) => [c.id, c]));
const dupsDe = new Map();
for (const d of duplicados) {
  if (!dupsDe.has(d.clave)) dupsDe.set(d.clave, []);
  dupsDe.get(d.clave).push(clientePorId.get(d.id));
}

const actualizar = []; // {base, fila}
const insertar = []; // {clave, fila}
for (const [k, p] of personas) {
  const base = canonica.get(k) || null;
  const fila = objetivo(p, base, dupsDe.get(k) || []);
  if (!base) { insertar.push({ clave: k, fila }); continue; }
  const cambia = CAMPOS.some((c) => {
    if (c === "etiquetas") return !igualConjunto(fila.etiquetas, base.etiquetas);
    if (c === "creado_en") return fila.creado_en && new Date(fila.creado_en).getTime() !== new Date(base.creado_en).getTime();
    return !igual(fila[c], base[c]);
  });
  if (cambia) actualizar.push({ base, fila });
}

// reservas: cada una a la canónica de su contacto
const destinoReserva = []; // {reservaId, clave}
for (const r of reservas) {
  const k = contactoReserva.get(String(r.cover_id || r.localizador || "").toUpperCase());
  if (k) destinoReserva.push({ reservaId: r.id, actual: r.cliente_id, clave: k });
}

/* ================= colisiones de claves únicas ================= */
// Teléfono e ID de Cover son únicos por cuenta. Valor final de cada ficha que sobrevive; si dos
// coinciden, se queda la clave quien la tiene como clave de persona y el resto la pierde (el
// teléfono pasa a teléfono adicional). Se informa del recuento.
let colisionesTel = 0, colisionesCover = 0;
{
  const finalDe = new Map(); // id → fila final (solo fichas que sobreviven)
  const actualizadas = new Map(actualizar.map((x) => [x.base.id, x.fila]));
  for (const [k, c] of canonica) finalDe.set(c.id, { clave: k, fila: actualizadas.get(c.id) || c });
  for (const c of huerfanasConRefs) finalDe.set(c.id, { clave: null, fila: c });
  const nuevos = insertar.map((x, i) => [`nuevo:${i}`, { clave: x.clave, fila: x.fila }]);
  const todasFinales = [...finalDe.entries(), ...nuevos];
  for (const campo of ["telefono", "cover_id"]) {
    const usos = new Map();
    for (const [id, v] of todasFinales) {
      const val = v.fila[campo];
      if (!val) continue;
      if (!usos.has(val)) usos.set(val, []);
      usos.get(val).push([id, v]);
    }
    for (const [val, lista] of usos) {
      if (lista.length < 2) continue;
      const dueña = lista.find(([, v]) => campo === "telefono" ? v.clave === `t:${val}` : personas.get(v.clave)?.filas.some((f) => f.coverId === val))
        || lista[0];
      for (const [id, v] of lista) {
        if (v === dueña[1]) continue;
        if (campo === "telefono") { colisionesTel++; if (!v.fila.telefono_adicional) v.fila.telefono_adicional = val; }
        else colisionesCover++;
        // la fila pierde la clave: si era una canónica sin cambios, pasa a «actualizar»
        if (!actualizadas.has(id) && !String(id).startsWith("nuevo:")) {
          const base = clientePorId.get(id);
          const fila = { ...Object.fromEntries(CAMPOS.map((c) => [c, base[c]])) };
          fila[campo] = null;
          if (campo === "telefono" && !fila.telefono_adicional) fila.telefono_adicional = val;
          actualizar.push({ base, fila });
          actualizadas.set(id, fila);
          v.fila = fila;
        } else v.fila[campo] = null;
      }
    }
  }
}

/* ================= informe previo ================= */

const borrar = [...duplicados.map((d) => d.id), ...basura.map((c) => c.id)];
console.log(`\nPlan:`);
console.log(`  personas: ${personas.size} · con ficha: ${canonica.size} · sin ficha (se crean): ${insertar.length}`);
console.log(`  fichas a corregir: ${actualizar.length} · ya correctas: ${canonica.size - actualizar.length}`);
console.log(`  duplicados a fusionar y eliminar: ${duplicados.length}`);
console.log(`  fichas vacías sin persona ni referencias (eliminar): ${basura.length}`);
console.log(`  fichas sin persona pero con reservas (se respetan): ${huerfanasConRefs.length}`);
console.log(`  etiquetas de cliente nuevas: ${etqNuevas.size}`);
console.log(`  colisiones resueltas: teléfono ${colisionesTel} · ID de Cover ${colisionesCover}`);
console.log(`  reservas a reasignar: (se calcula tras crear las fichas que faltan)`);
console.log(`  resultado esperado: ${clientes.length - borrar.length + insertar.length} fichas`);

if (DRY) {
  // reasignaciones posibles sin crear fichas (las de personas que ya tienen canónica)
  let n = 0, sinFicha = 0;
  for (const d of destinoReserva) {
    if (d.clave === SIN_CLIENTE) { if (d.actual) sinFicha++; continue; }
    const c = canonica.get(d.clave); if (c && c.id !== d.actual) n++;
  }
  console.log(`  reservas a reasignar (a fichas existentes): ${n} · walk-ins/comodines que pasan a «sin ficha»: ${sinFicha}`);
  console.log("\nSimulación: no se ha escrito nada.");
  process.exit(0);
}

/* ================= 5. escritura ================= */

// 5.1 liberar teléfono e ID de Cover de lo que va a cambiar o desaparecer (índices únicos)
console.log("\n1/5 liberando teléfonos e IDs de Cover…");
{
  const ids = new Set(borrar);
  for (const { base, fila } of actualizar) if (base.telefono !== fila.telefono || base.cover_id !== fila.cover_id) ids.add(base.id);
  const conClave = clientes.filter((c) => ids.has(c.id) && (c.telefono || c.cover_id)).map((c) => c.id);
  await enParalelo(trozos(conClave, 200).map((lote) => async () => {
    const { error } = await sb.from("reservas_clientes").update({ telefono: null, cover_id: null }).in("id", lote);
    if (error) throw new Error(`liberar: ${error.message}`);
  }));
  console.log(`  ${conClave.length} fichas liberadas`);
}

// 5.2 corregir canónicas: filas COMPLETAS (todas las columnas en todas las filas del lote)
console.log("2/5 corrigiendo fichas…");
{
  const filas = actualizar.map(({ base, fila }) => {
    const { telefono_norm, email_norm, actualizado_en, ...resto } = base; // los rellena el trigger
    return { ...resto, ...fila, cuenta_id: CUENTA_ID };
  });
  await enParalelo(trozos(filas, LOTE).map((lote) => async () => {
    const { error } = await sb.from("reservas_clientes").upsert(lote, { onConflict: "id", defaultToNull: false });
    if (error) throw new Error(`corregir: ${error.message}`);
  }), 4);
  console.log(`  ${filas.length} fichas corregidas`);
}

// 5.3 crear las que faltan (todas las filas con las mismas columnas)
console.log("3/5 creando fichas que faltan…");
{
  const columnas = [...CAMPOS, "cuenta_id"];
  const completa = (f) => Object.fromEntries(columnas.map((c) => [c, c === "cuenta_id" ? CUENTA_ID : (f[c] ?? (c === "creado_en" ? new Date().toISOString() : null))]))
  const conCover = insertar.filter((x) => x.fila.cover_id);
  const sinCover = insertar.filter((x) => !x.fila.cover_id);
  for (const lote of trozos(conCover, LOTE)) {
    const { data, error } = await sb.from("reservas_clientes").insert(lote.map((x) => completa(x.fila)), { defaultToNull: false }).select("id,cover_id");
    if (error) throw new Error(`crear: ${error.message}`);
    const porId = new Map(data.map((d) => [d.cover_id, d.id]));
    for (const x of lote) canonica.set(x.clave, { id: porId.get(x.fila.cover_id) });
  }
  await enParalelo(sinCover.map((x) => async () => {
    const { data, error } = await sb.from("reservas_clientes").insert(completa(x.fila), { defaultToNull: false }).select("id").single();
    if (error) throw new Error(`crear: ${error.message}`);
    canonica.set(x.clave, { id: data.id });
  }));
  console.log(`  ${insertar.length} fichas creadas`);
}

// 5.4 reasignar reservas, lista de espera y mensajes
console.log("4/5 reasignando reservas…");
{
  const porDestino = new Map(); // canónica → [reservaId]
  const aNulo = [];
  for (const d of destinoReserva) {
    if (d.clave === SIN_CLIENTE) { if (d.actual) aNulo.push(d.reservaId); continue; }
    const c = canonica.get(d.clave);
    if (!c?.id || c.id === d.actual) continue;
    if (!porDestino.has(c.id)) porDestino.set(c.id, []);
    porDestino.get(c.id).push(d.reservaId);
  }
  let n = 0;
  await enParalelo(trozos(aNulo, 200).map((lote) => async () => {
    const { error } = await sb.from("reservas_reservas").update({ cliente_id: null }).in("id", lote);
    if (error) throw new Error(`sin ficha: ${error.message}`);
  }));
  if (aNulo.length) console.log(`  ${aNulo.length} reservas de walk-in/comodín sin ficha de cliente`);
  await enParalelo([...porDestino].flatMap(([destino, ids]) => trozos(ids, 200).map((lote) => async () => {
    const { error } = await sb.from("reservas_reservas").update({ cliente_id: destino }).in("id", lote);
    if (error) throw new Error(`reasignar: ${error.message}`);
    n += lote.length;
  })));
  // duplicados: lo que quede apuntándoles (lista de espera, mensajes, reservas sin tracking)
  const destinoDup = new Map(duplicados.map((d) => [d.id, canonica.get(d.clave)?.id]));
  const pendientes = [];
  for (const [tablaNombre, filas] of [["reservas_reservas", reservas], ["reservas_lista_espera", espera], ["reservas_mensajes", mensajes]]) {
    for (const f of filas) {
      const destino = destinoDup.get(f.cliente_id);
      if (!destino) continue;
      if (tablaNombre === "reservas_reservas" && contactoReserva.has(String(f.cover_id || f.localizador || "").toUpperCase())) continue;
      pendientes.push(async () => {
        const { error } = await sb.from(tablaNombre).update({ cliente_id: destino }).eq("id", f.id);
        if (error) throw new Error(`reasignar ${tablaNombre}: ${error.message}`);
      });
    }
  }
  await enParalelo(pendientes);
  console.log(`  ${n} reservas reasignadas · ${pendientes.length} referencias de duplicados movidas`);
}

// 5.5 eliminar duplicados y fichas vacías (si algo aún las referencia, la FK lo impide y se avisa)
console.log("5/5 eliminando duplicados y fichas vacías…");
{
  let ok = 0, fallidas = 0;
  await enParalelo(trozos(borrar, 200).map((lote) => async () => {
    const { error } = await sb.from("reservas_clientes").delete().in("id", lote);
    if (!error) { ok += lote.length; return; }
    for (const id of lote) {
      const r = await sb.from("reservas_clientes").delete().eq("id", id);
      if (r.error) fallidas++; else ok++;
    }
  }));
  console.log(`  ${ok} eliminadas${fallidas ? ` · ${fallidas} no se pudieron eliminar (aún referenciadas)` : ""}`);
}

const { count } = await sb.from("reservas_clientes").select("*", { count: "exact", head: true }).eq("cuenta_id", CUENTA_ID);
console.log(`\nHecho. Fichas de cliente ahora: ${count}. Ejecuta de nuevo con --dry-run: debe salir todo a 0.`);
