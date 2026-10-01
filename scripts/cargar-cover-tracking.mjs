/**
 * Carga del «Tracking de reservas» de CoverManager y, opcionalmente, del «Listado de clientes»
 * en el módulo Reservas de Hostelero (el mismo camino que Skello → Personal: hasta el corte,
 * Sonia y compañía siguen en Cover y aquí se carga el informe; Ratios lee en vivo del módulo).
 *
 *   node scripts/cargar-cover-tracking.mjs <tracking.csv> [--clientes=<clientes.tsv>] [--dry-run]
 *                                          [--solo-clientes] [--solo-reservas]
 *
 * Ficheros (Analytics › Informes de Cover):
 *   · Tracking de reservas → «Descargar CSV» con «Incluir otros establecimientos», «Ampliar con
 *     más datos» y «Ampliar con datos de prescriptores». Llega por correo: CSV con «;».
 *     Pedir TODAS las reservas (todos los estados), no solo «las que fueron».
 *   · Clientes › Listado de clientes → TSV (ID, Nombre, Apellidos, Código, Teléfono, Email, …).
 *
 * Idempotente: una segunda ejecución no duplica nada.
 *   · reservas por localizador (= «Token» de Cover, 8 caracteres) y cover_id.
 *   · clientes por cover_id, o por teléfono / email normalizados (misma regla que reservas_norm_tel).
 *   · mesas por (sala, nombre), etiquetas por (ámbito, nombre), prescriptores por nombre.
 * Solo se actualizan las filas que cambian (no se ensucia reservas_reservas_historial).
 *
 * Mensajería: las filas importadas llevan notificar = false y cover_id; el trigger
 * reservas_encolar_email no programa mensajes para filas con cover_id escritas por el service
 * role (ver migración 20261001130000). Ningún cliente real recibe correos por esta carga.
 *
 * Claves en .env.local (raíz del repo): HOSTELERO_URL y HOSTELERO_SERVICE_KEY (service role).
 * PII: todo en memoria; no escribe ficheros intermedios; el informe final no imprime datos
 * personales.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

/* ================= parámetros ================= */

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca
const args = process.argv.slice(2);
const FICHERO = args.find((a) => !a.startsWith("--"));
const CLIENTES = (args.find((a) => a.startsWith("--clientes=")) || "").split("=")[1] || null;
const DRY = args.includes("--dry-run");
const SOLO_CLIENTES = args.includes("--solo-clientes");
const SOLO_RESERVAS = args.includes("--solo-reservas");
const LOTE = 500;

if (!FICHERO && !CLIENTES) {
  console.error("Uso: node scripts/cargar-cover-tracking.mjs <tracking.csv> [--clientes=<clientes.tsv>] [--dry-run]");
  process.exit(1);
}

// Nombre del restaurante en Cover → slug en reservas_restaurantes
const RESTAURANTES = {
  "Bodegas Binifadet": "binifadet",
  Tamarindos: "tamarindos",
  "Casa Tirant": "casa-tirant",
  "El Bar de Tamarindos": "bar-tamarindos",
};

// Zonas de Cover que en nuestro plano son sub-zonas de una sala
const ZONA_ALIAS = { "terraza patio": "terraza", "wine bar": "terraza", "bar viñedo": "viñedo" };

// Estado de Cover → [estado, cancelada_por]
const ESTADOS = {
  Sentada: ["sentada"],
  Liberada: ["terminada"],
  "Cancelado por el cliente": ["cancelada", "cliente"],
  "Cancelado por el restaurante": ["cancelada", "restaurante"],
  "Cancelado por no introducir tarjeta": ["cancelada", "sistema"],
  "No show": ["no_show"],
  Confirmada: ["confirmada"],
  Reconfirmada: ["reconfirmada"],
  "Llegada Barra": ["llegada"],
  Llegada: ["llegada"],
  "Cuenta solicitada": ["cuenta"],
  Postre: ["postre"],
  "A revisar": ["a_revisar"],
  "Tarjeta no introducida": ["tarjeta_pendiente"],
  "Pendiente de confirmación": ["pendiente"],
  Pendiente: ["pendiente"],
  "": ["pendiente"],
};

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

/** CSV con separador configurable y comillas dobles (saltos de línea dentro de comillas). */
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

function leerTabla(ruta, sep) {
  const texto = readFileSync(resolve(ruta), "utf8").replace(/^﻿/, "");
  const filas = parseDelimitado(texto, sep);
  const cab = filas[0].map((h) => h.trim());
  const ix = Object.fromEntries(cab.map((h, i) => [h, i]));
  const datos = filas.slice(1).filter((f) => f.length >= cab.length - 1);
  return { cab, ix, datos, get: (f, col) => (ix[col] == null ? "" : (f[ix[col]] ?? "").trim()) };
}

/** Misma regla que reservas_norm_tel: solo dígitos; 0034… / 34… de 11-13 cifras → 9 cifras. */
function normTel(prefijo, tel) {
  let d = String(tel || "").replace(/\D/g, "");
  const p = String(prefijo || "").replace(/\D/g, "");
  if (!d) return null;
  if (p && p !== "34") d = p + d;
  else if (p === "34" && d.length === 9) d = d;
  if (d.length === 13 && d.startsWith("0034")) d = d.slice(4);
  else if (d.length === 11 && d.startsWith("34")) d = d.slice(2);
  return d || null;
}
const normEmail = (e) => {
  const x = String(e || "").trim().toLowerCase();
  return x && x.includes("@") ? x : null;
};
const vacio = (v) => v == null || v === "";
const siNo = (v) => /^(si|sí|yes|s)$/i.test(String(v || "").trim());

/** Fecha+hora locales de Menorca → ISO (UTC). */
function offsetMadrid(d) {
  const parte = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", timeZoneName: "shortOffset" })
    .formatToParts(d).find((x) => x.type === "timeZoneName")?.value || "GMT+1";
  const m = parte.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!m) return 60;
  const h = Number(m[1]);
  return h * 60 + (m[2] ? Math.sign(h) * Number(m[2]) : 0);
}
function tsMadrid(fecha, hora) {
  if (!fecha) return null;
  const h = (hora || "00:00:00").length === 5 ? hora + ":00" : hora || "00:00:00";
  const base = new Date(`${fecha}T${h}Z`);
  if (isNaN(base.getTime())) return null;
  return new Date(base.getTime() - offsetMadrid(base) * 60000).toISOString();
}
function tsMadridCompleto(s) {
  // "2026-03-27 12:53:43"
  const m = String(s || "").match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  return m ? tsMadrid(m[1], m[2]) : null;
}

const igualJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function todas(tabla, select, filtro) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    let q = sb.from(tabla).select(select).range(desde, desde + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(`${tabla}: ${error.message}`);
    filas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return filas;
}

async function insertarLotes(tabla, filas, select) {
  const out = [];
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    let q = sb.from(tabla).insert(lote, { defaultToNull: false });
    if (select) q = q.select(select);
    const { data, error } = await q;
    if (error) throw new Error(`insert ${tabla}: ${error.message}`);
    if (select) out.push(...(data || []));
    process.stdout.write(`\r  ${tabla}: insertadas ${Math.min(i + LOTE, filas.length)}/${filas.length}   `);
  }
  if (filas.length) console.log();
  return out;
}

async function upsertLotes(tabla, filas, onConflict, ignoreDuplicates = false) {
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    const { error } = await sb.from(tabla).upsert(lote, { onConflict, ignoreDuplicates, defaultToNull: false });
    if (error) throw new Error(`upsert ${tabla}: ${error.message}`);
    process.stdout.write(`\r  ${tabla}: actualizadas ${Math.min(i + LOTE, filas.length)}/${filas.length}   `);
  }
  if (filas.length) console.log();
}

/* ================= catálogos de la base ================= */

console.log(`Cover → Reservas${DRY ? " (SIMULACIÓN, no escribe)" : ""}\n`);

const restaurantes = await todas("reservas_restaurantes", "id,slug,nombre,orden");
const restPorSlug = Object.fromEntries(restaurantes.map((r) => [r.slug, r]));
const salas = await todas("reservas_salas", "id,restaurante_id,nombre,orden");
const mesas = await todas("reservas_mesas", "id,sala_id,nombre,cap_min,cap_max");
const turnos = await todas("reservas_turnos", "id,restaurante_id,nombre,hora_inicio,hora_fin,duracion_min");
const etiquetas = await todas("reservas_etiquetas", "id,ambito,nombre");
const prescriptores = await todas("reservas_prescriptores", "id,nombre");

const salasDe = (restId) => salas.filter((s) => s.restaurante_id === restId).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
function salaPorZona(restId, zona) {
  const z = (zona || "").trim().toLowerCase();
  if (!z) return null;
  const nombre = ZONA_ALIAS[z] || z;
  return salasDe(restId).find((s) => s.nombre.toLowerCase() === nombre) || null;
}
const mesaKey = (salaId, nombre) => `${salaId}|${nombre.toLowerCase()}`;
const mesasPorKey = new Map(mesas.map((m) => [mesaKey(m.sala_id, m.nombre), m]));
const mesasNuevas = new Map(); // key → fila a crear

// Mesas que Cover nombra y nosotros no tenemos: solo se crean si aparecen en ≥ MIN_RESERVAS_MESA
// reservas (las erratas tipo «2003» o «1161» con una o dos reservas se quedan sin mesa, con el
// nombre de Cover en cover_meta.mesa).
const MIN_RESERVAS_MESA = 5;
const usoMesaCover = new Map(); // `${rest}|${nombre}` → nº de reservas en el fichero

/** Nombre de mesa de Cover → mesa nuestra (crea las que faltan en la sala de la zona). */
function resolverMesa(rest, zona, nombreCover, pax) {
  const n = String(nombreCover || "").trim();
  if (!n || /^sin$/i.test(n)) return null;
  const todasSalas = salasDe(rest.id);
  const salaZona = salaPorZona(rest.id, zona) || todasSalas[0];
  const candidatos = [n];
  if (rest.slug === "tamarindos" && /^\d+$/.test(n)) {
    const z = (zona || "").toLowerCase();
    if (z === "sala") candidatos.unshift("S" + n);
    else candidatos.unshift("T" + n);
  }
  for (const c of candidatos) {
    for (const s of [salaZona, ...todasSalas.filter((x) => x.id !== salaZona?.id)]) {
      if (!s) continue;
      const m = mesasPorKey.get(mesaKey(s.id, c)) || mesasNuevas.get(mesaKey(s.id, c));
      if (m) { if (m._nueva) m.cap_max = Math.max(m.cap_max, pax || 1); return m; }
    }
  }
  if (!salaZona) return null;
  if ((usoMesaCover.get(`${rest.slug}|${n}`) || 0) < MIN_RESERVAS_MESA) return null;
  const nombre = candidatos[0];
  const i = mesasNuevas.size;
  const nueva = {
    _nueva: true,
    cuenta_id: CUENTA_ID,
    sala_id: salaZona.id,
    nombre,
    cap_min: 1,
    cap_max: Math.max(2, pax || 2),
    forma: "cuadrada",
    pos_x: 6 + (i % 11) * 8.5,
    pos_y: 64 - Math.floor(i / 11) * 7,
    reservable_online: false,
    activa: true,
  };
  mesasNuevas.set(mesaKey(salaZona.id, nombre), nueva);
  return nueva;
}

function turnoDe(rest, servicio) {
  const s = /cena/i.test(servicio || "") ? "cena" : "comida";
  return turnos.find((t) => t.restaurante_id === rest.id && t.nombre.toLowerCase() === s) || null;
}

const etiquetaKey = (ambito, nombre) => `${ambito}|${nombre.trim().toLowerCase()}`;
const etiquetasPorKey = new Map(etiquetas.map((e) => [etiquetaKey(e.ambito, e.nombre), e]));
const etiquetasNuevas = new Map();
function resolverEtiquetas(ambito, texto) {
  const ids = [];
  for (const raw of String(texto || "").split(/[,;]/)) {
    const nombre = raw.trim();
    if (!nombre) continue;
    const k = etiquetaKey(ambito, nombre);
    let e = etiquetasPorKey.get(k) || etiquetasNuevas.get(k);
    if (!e) { e = { _nueva: true, cuenta_id: CUENTA_ID, ambito, nombre, color: "#888888", orden: 500 }; etiquetasNuevas.set(k, e); }
    ids.push(e);
  }
  return ids;
}

const prescPorNombre = new Map(prescriptores.map((p) => [p.nombre.trim().toLowerCase(), p]));
const prescNuevos = new Map();
function resolverPrescriptor(nombre) {
  const n = String(nombre || "").trim();
  if (!n) return null;
  const k = n.toLowerCase();
  let p = prescPorNombre.get(k) || prescNuevos.get(k);
  if (!p) { p = { _nuevo: true, cuenta_id: CUENTA_ID, nombre: n, tipo: "canal", activo: true }; prescNuevos.set(k, p); }
  return p;
}

/* ================= clientes existentes ================= */

const clientesBD = await todas("reservas_clientes", "id,nombre,apellidos,telefono,email,telefono_norm,email_norm,etiquetas,vip,lista_negra,cover_id,pais,codigo_postal,empresa,idioma,consentimiento_marketing,fecha_nacimiento,telefono_adicional,numero_socio,alergias,notas");
const porTel = new Map(), porEmail = new Map(), porCover = new Map();
// Clientes sin teléfono ni email (walk-ins con solo nombre): se casan por nombre para no
// duplicarlos en cada pasada.
const clientesPorNombre = new Map(); // nombre|apellidos (minúsculas) → cliente
const nombreKey = (n, a) => `${String(n || "").trim().toLowerCase()}|${String(a || "").trim().toLowerCase()}`;
for (const c of clientesBD) {
  const t = c.telefono_norm || normTel("", c.telefono);
  const e = c.email_norm || normEmail(c.email);
  if (t && !porTel.has(t)) porTel.set(t, c);
  if (e && !porEmail.has(e)) porEmail.set(e, c);
  if (c.cover_id) porCover.set(c.cover_id, c);
  if (!t && !e && !c.cover_id) {
    const k = nombreKey(c.nombre, c.apellidos);
    if (!clientesPorNombre.has(k)) clientesPorNombre.set(k, c);
  }
}
console.log(`Base: ${restaurantes.length} restaurantes, ${salas.length} salas, ${mesas.length} mesas, ${clientesBD.length} clientes, ${etiquetas.length} etiquetas, ${prescriptores.length} prescriptores`);

const clientesNuevos = []; // filas a insertar
const clientesCambios = new Map(); // id → campos a actualizar

function separarNombre(nombre, apellidos) {
  let n = String(nombre || "").trim(), a = String(apellidos || "").trim();
  if (!a && n.includes(" ")) { /* Cover ya separa; si no, dejamos todo en nombre */ }
  return [n, a];
}

/** Devuelve el cliente (existente o nuevo en memoria) para unos datos de contacto; acumula cambios. */
function resolverCliente(d) {
  const tel = normTel(d.prefijo, d.telefono);
  const email = normEmail(d.email);
  let c = (d.cover_id && porCover.get(d.cover_id)) || (tel && porTel.get(tel)) || (email && porEmail.get(email)) || null;
  const [nombre, apellidos] = separarNombre(d.nombre, d.apellidos);
  if (!c && !tel && !email) {
    if (!nombre && !apellidos) return null;
    c = clientesPorNombre.get(nombreKey(nombre, apellidos));
    if (c) return c;
  }
  if (!c) {
    c = {
      _nuevo: true,
      cuenta_id: CUENTA_ID,
      nombre: nombre || apellidos || "Sin nombre",
      apellidos: nombre ? apellidos || null : null,
      telefono: tel,
      email,
      pais: d.pais || "ES",
      codigo_postal: d.cp || null,
      empresa: d.empresa || null,
      idioma: d.idioma || "es",
      consentimiento_marketing: !!d.consentimiento,
      vip: false,
      lista_negra: false,
      etiquetas: [],
      alergias: d.alergias || null,
      notas: d.notas || null,
      fecha_nacimiento: d.fecha_nacimiento || null,
      telefono_adicional: d.telefono_adicional || null,
      numero_socio: d.numero_socio || null,
      cover_id: d.cover_id || null,
      cover_meta: d.cover_meta || null,
      creado_en: d.creado_en || undefined,
    };
    clientesNuevos.push(c);
    if (tel) porTel.set(tel, c);
    if (email) porEmail.set(email, c);
    if (d.cover_id) porCover.set(d.cover_id, c);
    if (!tel && !email && !d.cover_id) clientesPorNombre.set(nombreKey(nombre, apellidos), c);
  } else {
    // completar huecos del existente (sin pisar lo que ya hay)
    const cambios = clientesCambios.get(c.id) || {};
    const pon = (campo, valor) => { if (!vacio(valor) && vacio(c[campo]) && !igualJson(c[campo], valor)) { cambios[campo] = valor; c[campo] = valor; } };
    if (apellidos && vacio(c.apellidos)) {
      const n = String(c.nombre || "").trim();
      if (n.toLowerCase().endsWith(" " + apellidos.toLowerCase())) {
        cambios.nombre = n.slice(0, n.length - apellidos.length).trim(); c.nombre = cambios.nombre;
      }
      cambios.apellidos = apellidos; c.apellidos = apellidos;
    }
    if (tel && vacio(c.telefono) && (!porTel.has(tel) || porTel.get(tel) === c)) { pon("telefono", tel); porTel.set(tel, c); }
    pon("email", email);
    if (d.pais && (vacio(c.pais) || c.pais === "ES") && d.pais !== c.pais) { cambios.pais = d.pais; c.pais = d.pais; }
    pon("codigo_postal", d.cp);
    pon("empresa", d.empresa);
    if (d.idioma && d.idioma !== "es" && (vacio(c.idioma) || c.idioma === "es")) { cambios.idioma = d.idioma; c.idioma = d.idioma; }
    if (d.consentimiento && !c.consentimiento_marketing) { cambios.consentimiento_marketing = true; c.consentimiento_marketing = true; }
    pon("alergias", d.alergias);
    pon("notas", d.notas);
    pon("fecha_nacimiento", d.fecha_nacimiento);
    pon("telefono_adicional", d.telefono_adicional);
    pon("numero_socio", d.numero_socio);
    pon("cover_id", d.cover_id);
    pon("cover_meta", d.cover_meta);
    if (Object.keys(cambios).length) clientesCambios.set(c.id, cambios);
  }
  // etiquetas, VIP, lista negra (unión)
  if (d.etiquetas && d.etiquetas.length) c._etq = [...(c._etq || []), ...d.etiquetas];
  if (d.etiquetas?.some((e) => /\bvip\b/i.test(e.nombre))) c._vip = true;
  if (d.etiquetas?.some((e) => /black[\s-]?list/i.test(e.nombre))) c._negra = true;
  return c;
}

/* ================= 1. listado de clientes ================= */

if (CLIENTES && !SOLO_RESERVAS) {
  const t = leerTabla(CLIENTES, "\t");
  console.log(`\nClientes de Cover: ${t.datos.length} filas (${t.cab.length} columnas)`);
  let n = 0;
  for (const f of t.datos) {
    const g = (c) => t.get(f, c);
    const notas = [g("Notas del cliente"), g("Preferencia de mesa") && `Mesa: ${g("Preferencia de mesa")}`, g("Preferencia de camarero") && `Camarero: ${g("Preferencia de camarero")}`, g("Preferencia alimentarias") && `Preferencias: ${g("Preferencia alimentarias")}`, g("Campo Adicional")].filter(Boolean).join(" · ") || null;
    const reg = g("Fecha registro");
    resolverCliente({
      cover_id: g("ID") || null,
      nombre: g("Nombre"),
      apellidos: g("Apellidos"),
      prefijo: g("Código"),
      telefono: g("Teléfono"),
      email: g("Email"),
      pais: g("País") || null,
      cp: g("Código Postal") || null,
      empresa: g("Empresa") || null,
      idioma: IDIOMAS[g("Idioma").toLowerCase()] || null,
      consentimiento: siNo(g("Subscrito")),
      alergias: g("Restricciones alimentarias") || null,
      notas,
      fecha_nacimiento: /^\d{4}-\d{2}-\d{2}$/.test(g("Fecha de nacimiento")) ? g("Fecha de nacimiento") : null,
      telefono_adicional: g("Teléfono 2") ? normTel("", g("Teléfono 2")) : null,
      numero_socio: g("Número de socio") && g("Número de socio") !== "0" ? g("Número de socio") : null,
      etiquetas: resolverEtiquetas("cliente", g("Etiquetas de cliente")),
      rest: g("Origen del cliente"),
      creado_en: /^\d{4}-\d{2}-\d{2}$/.test(reg) ? tsMadrid(reg, "12:00:00") : null,
      cover_meta: { origen: g("Origen del cliente") || null, reservas_cover: Number(g("Reservas")) || 0, direccion: g("Dirección") || null },
    });
    if (++n % 10000 === 0) process.stdout.write(`\r  procesados ${n}`);
  }
  console.log(`\r  procesados ${n}`);
}

/* ================= 2. tracking de reservas ================= */

const reservasNuevas = [];
const reservasCambios = []; // {id, ...campos}
const mesasExtra = []; // {reserva (obj o id), mesa}
const stats = { filas: 0, sinRestaurante: 0, estadoDesconocido: new Map(), sinMesa: 0, nuevas: 0, cambiadas: 0, iguales: 0, sinCliente: 0 };
let reservasBD = [];

if (FICHERO && !SOLO_CLIENTES) {
  const t = leerTabla(FICHERO, ";");
  console.log(`\nTracking de Cover: ${t.datos.length} filas (${t.cab.length} columnas)`);
  reservasBD = await todas("reservas_reservas", "id,localizador,cliente_id,restaurante_id,turno_id,mesa_id,zona_id,fecha,hora,pax,estado,origen,canal,notas_cliente,notas_internas,creado_en,tipo,estado_pago,cancelada_por,cancelada_en,llegada_en,sentada_en,salida_en,reconfirmada_en,pais,empresa,prescriptor_id,etiquetas,cover_id,cover_meta,notificar,consentimiento_marketing");
  const porLoc = new Map(reservasBD.map((r) => [String(r.localizador || "").toUpperCase(), r]));
  console.log(`  en la base: ${reservasBD.length} reservas`);

  // Primera pasada: cuántas reservas usan cada nombre de mesa de Cover (para no crear erratas).
  for (const f of t.datos) {
    const slug = RESTAURANTES[t.get(f, "Restaurante")];
    if (!slug) continue;
    for (const n of t.get(f, "Mesa").split("-").map((x) => x.trim()).filter(Boolean)) {
      const k = `${slug}|${n}`;
      usoMesaCover.set(k, (usoMesaCover.get(k) || 0) + 1);
    }
  }

  for (const f of t.datos) {
    const g = (c) => t.get(f, c);
    stats.filas++;
    const rest = restPorSlug[RESTAURANTES[g("Restaurante")]];
    if (!rest) { stats.sinRestaurante++; continue; }
    const token = g("Token");
    if (!token) continue;
    const estadoCover = g("Estado");
    const [estado, canceladaPor] = ESTADOS[estadoCover] || [];
    if (!estado) { stats.estadoDesconocido.set(estadoCover, (stats.estadoDesconocido.get(estadoCover) || 0) + 1); continue; }
    const fecha = g("Fecha");
    const hora = g("Hora").length === 5 ? g("Hora") + ":00" : g("Hora");
    const pax = Number(g("Personas")) || 1;
    const turno = turnoDe(rest, g("Servicio"));
    const zona = g("Zona");
    const sala = salaPorZona(rest.id, zona);
    const nombresMesa = g("Mesa").split("-").map((x) => x.trim()).filter(Boolean);
    const mesasRes = nombresMesa.map((n) => resolverMesa(rest, zona, n, pax)).filter(Boolean);
    if (!mesasRes.length) stats.sinMesa++;

    const origenCover = g("Origen");
    const presc = g("Prescriptor");
    let origen = "panel", canal = origenCover || null;
    if (origenCover === "moduloweb") origen = "online";
    else if (origenCover === "terceros") { origen = "online"; canal = presc || "terceros"; }
    else if (origenCover === "walk in") origen = "walkin";
    const prescriptor = resolverPrescriptor(presc);

    const com = g("Comentarios");
    const m = com.match(/^R:(.*?)\s*C:(.*)$/s);
    const notasInternas = (m ? m[1] : com).trim() || null;
    const notasCliente = m ? m[2].trim() || null : null;

    const tipoCover = g("Tipo");
    const tipo = /pol[ií]tica/i.test(tipoCover) ? "politica_cancelacion" : /prepago|ticket/i.test(tipoCover) ? "prepago" : /garant/i.test(tipoCover) ? "garantia" : "gratis";
    let estadoPago = "no_requerido";
    if (tipo !== "gratis") {
      if (estadoCover === "Cancelado por no introducir tarjeta") estadoPago = "pendiente_tarjeta";
      else if (siNo(g("Aplicada Política de Cancelación"))) estadoPago = "cobrado_noshow";
      else estadoPago = tipo === "prepago" ? "pagada" : "garantizada";
    }

    const etq = resolverEtiquetas("reserva", g("Etiquetas de reserva"));
    const cliente = resolverCliente({
      nombre: g("Nombre"),
      apellidos: g("Apellidos"),
      prefijo: g("Prefijo"),
      telefono: g("Teléfono"),
      email: g("Email"),
      pais: g("País") || null,
      cp: g("Código Postal") || null,
      empresa: g("Empresa") || null,
      consentimiento: siNo(g("Subscrito")),
      etiquetas: resolverEtiquetas("cliente", g("Etiquetas de cliente")),
      rest: rest.slug,
    });
    if (!cliente) stats.sinCliente++;

    const sentadaEn = tsMadridCompleto(g("Hora en la que se Sentó"));
    const fila = {
      cuenta_id: CUENTA_ID,
      localizador: token,
      cover_id: token,
      restaurante_id: rest.id,
      turno_id: turno?.id ?? null,
      zona_id: sala?.id ?? null,
      fecha,
      hora,
      pax,
      duracion_min: turno?.duracion_min ?? 120,
      estado,
      cancelada_por: canceladaPor ?? null,
      cancelada_en: tsMadridCompleto(g("Fecha de cancelación")),
      llegada_en: sentadaEn,
      sentada_en: sentadaEn,
      salida_en: tsMadridCompleto(g("Hora en la que se Liberó")),
      origen,
      canal,
      tipo,
      estado_pago: estadoPago,
      notas_cliente: notasCliente,
      notas_internas: notasInternas,
      pais: g("País") || null,
      empresa: g("Empresa") || null,
      consentimiento_marketing: siNo(g("Subscrito")),
      notificar: false,
      creado_en: tsMadrid(g("Fecha Añadida"), g("Hora Añadida")) || undefined,
      cover_meta: {
        estado: estadoCover, tipo: tipoCover, origen: origenCover, zona: zona || null, mesa: g("Mesa") || null,
        anotado_por: g("Anotado por") || null, creado_por: g("Creado por") || null,
        total_dia: Number(g("Total personas (día)")) || null, reconfirmado: siNo(g("Reconfirmado")),
        dentro_politica: siNo(g("Dentro de Política de Cancelación")), aplicada_politica: siNo(g("Aplicada Política de Cancelación")),
        grupo: siNo(g("Grupo")), prescriptor: presc || null, referencia: g("Referencia") || null,
        total_pagado: g("Total pagado") || null, numero_socio: g("Número de socio") && g("Número de socio") !== "0" ? g("Número de socio") : null,
        cross_selling: g("Cross-selling") && g("Cross-selling") !== "N/A" ? g("Cross-selling") : null,
      },
      _cliente: cliente,
      _mesas: mesasRes,
      _presc: prescriptor,
      _etq: etq,
    };

    const existente = porLoc.get(token.toUpperCase());
    if (!existente) { reservasNuevas.push(fila); stats.nuevas++; }
    else {
      fila._id = existente.id;
      fila._existente = existente;
      reservasCambios.push(fila);
    }
  }
}

/* ================= 3. escritura ================= */

const nuevasMesas = [...mesasNuevas.values()];
const nuevasEtq = [...etiquetasNuevas.values()];
const nuevosPresc = [...prescNuevos.values()];
console.log(`\nResumen previo:`);
console.log(`  mesas nuevas: ${nuevasMesas.length}${nuevasMesas.length ? " → " + nuevasMesas.map((m) => `${salas.find((s) => s.id === m.sala_id)?.nombre}/${m.nombre}`).join(", ") : ""}`);
console.log(`  etiquetas nuevas: ${nuevasEtq.length}${nuevasEtq.length ? " → " + nuevasEtq.map((e) => `${e.ambito}:${e.nombre}`).join(", ") : ""}`);
console.log(`  prescriptores nuevos: ${nuevosPresc.length}${nuevosPresc.length ? " → " + nuevosPresc.map((p) => p.nombre).join(", ") : ""}`);
console.log(`  clientes nuevos: ${clientesNuevos.length} · existentes con datos nuevos: ${clientesCambios.size}`);
if (FICHERO && !SOLO_CLIENTES) {
  console.log(`  reservas: ${stats.filas} filas · nuevas ${stats.nuevas} · ya existentes ${reservasCambios.length} · sin restaurante ${stats.sinRestaurante} · sin mesa ${stats.sinMesa} · sin cliente ${stats.sinCliente}`);
  if (stats.estadoDesconocido.size) console.log(`  ESTADOS DESCONOCIDOS (no cargados): ${[...stats.estadoDesconocido].map(([k, v]) => `${k || "(vacío)"}×${v}`).join(", ")}`);
}

if (DRY) { console.log("\nSimulación: no se ha escrito nada."); process.exit(0); }

// 3.1 catálogos
if (nuevasMesas.length) {
  const ins = await insertarLotes("reservas_mesas", nuevasMesas.map(({ _nueva, ...m }) => m), "id,sala_id,nombre");
  for (const m of ins) { const k = mesaKey(m.sala_id, m.nombre); const o = mesasNuevas.get(k); if (o) o.id = m.id; }
}
if (nuevasEtq.length) {
  const ins = await insertarLotes("reservas_etiquetas", nuevasEtq.map(({ _nueva, ...e }) => e), "id,ambito,nombre");
  for (const e of ins) { const o = etiquetasNuevas.get(etiquetaKey(e.ambito, e.nombre)); if (o) o.id = e.id; }
}
if (nuevosPresc.length) {
  const ins = await insertarLotes("reservas_prescriptores", nuevosPresc.map(({ _nuevo, ...p }) => p), "id,nombre");
  for (const p of ins) { const o = prescNuevos.get(p.nombre.trim().toLowerCase()); if (o) o.id = p.id; }
}

// 3.2 clientes nuevos (etiquetas/VIP/lista negra resueltas ya)
const idsEtq = (c) => [...new Set([...(c.etiquetas || []), ...((c._etq || []).map((e) => e.id).filter(Boolean))])];
if (clientesNuevos.length) {
  const filas = clientesNuevos.map((c) => {
    const { _nuevo, _etq, _vip, _negra, creado_en, ...x } = c;
    const fila = { ...x, etiquetas: idsEtq(c), vip: !!_vip, lista_negra: !!_negra };
    if (creado_en) fila.creado_en = creado_en;
    return fila;
  });
  // Inserción por lotes; si un lote choca con el índice único de teléfono (cuenta_id, telefono)
  // —teléfonos que ya estaban en la base con otro formato—, ese lote va fila a fila y la fila
  // que choca se casa con el cliente existente en vez de crear uno nuevo.
  const ins = [];
  let casados = 0;
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    const { data, error } = await sb.from("reservas_clientes").insert(lote, { defaultToNull: false }).select("id,telefono_norm,email_norm,cover_id");
    if (!error) { ins.push(...(data || [])); }
    else if (/tel_unico|duplicate key/i.test(error.message)) {
      for (const fila of lote) {
        const r1 = await sb.from("reservas_clientes").insert(fila, { defaultToNull: false }).select("id,telefono_norm,email_norm,cover_id").single();
        if (!r1.error) { ins.push(r1.data); continue; }
        const r2 = await sb.from("reservas_clientes").select("id,telefono_norm,email_norm,cover_id")
          .eq("cuenta_id", CUENTA_ID).eq("telefono", fila.telefono).limit(1).maybeSingle();
        if (r2.error || !r2.data) throw new Error(`insert reservas_clientes: ${r1.error.message}`);
        ins.push({ ...r2.data, telefono_norm: fila.telefono, cover_id: fila.cover_id || r2.data.cover_id });
        casados++;
      }
    } else throw new Error(`insert reservas_clientes: ${error.message}`);
    process.stdout.write(`\r  reservas_clientes: insertadas ${Math.min(i + LOTE, filas.length)}/${filas.length}   `);
  }
  console.log(casados ? `\n  (${casados} teléfonos ya existían con otro formato: casados con el cliente existente)` : "");
  // casar ids devueltos con los objetos en memoria (mismo orden de inserción)
  if (ins.length === clientesNuevos.length) clientesNuevos.forEach((c, i) => { c.id = ins[i].id; });
  else {
    const byTel = new Map(ins.filter((x) => x.telefono_norm).map((x) => [x.telefono_norm, x.id]));
    const byEmail = new Map(ins.filter((x) => x.email_norm).map((x) => [x.email_norm, x.id]));
    const byCover = new Map(ins.filter((x) => x.cover_id).map((x) => [x.cover_id, x.id]));
    for (const c of clientesNuevos) c.id = (c.cover_id && byCover.get(c.cover_id)) || (c.telefono && byTel.get(c.telefono)) || (c.email && byEmail.get(c.email)) || c.id;
  }
}
// 3.3 clientes existentes: huecos + etiquetas/VIP/lista negra
{
  const filas = [];
  for (const c of clientesBD) {
    const cambios = { ...(clientesCambios.get(c.id) || {}) };
    const etq = idsEtq(c);
    if (!igualJson([...etq].sort(), [...(c.etiquetas || [])].sort())) cambios.etiquetas = etq;
    if (c._vip && !c.vip) cambios.vip = true;
    if (c._negra && !c.lista_negra) cambios.lista_negra = true;
    if (Object.keys(cambios).length) filas.push({ id: c.id, cuenta_id: CUENTA_ID, ...cambios });
  }
  if (filas.length) await upsertLotes("reservas_clientes", filas, "id");
}

// 3.4 reservas
const limpiar = (f) => {
  const { _cliente, _mesas, _presc, _etq, _id, _existente, creado_en, ...x } = f;
  x.cliente_id = _cliente?.id ?? null;
  x.mesa_id = _mesas[0]?.id ?? null;
  x.prescriptor_id = _presc?.id ?? null;
  x.etiquetas = _etq.map((e) => e.id).filter(Boolean);
  if (creado_en) x.creado_en = creado_en;
  return x;
};
if (reservasNuevas.length) {
  const ins = await insertarLotes("reservas_reservas", reservasNuevas.map(limpiar), "id,localizador");
  const porLoc = new Map(ins.map((r) => [String(r.localizador).toUpperCase(), r.id]));
  for (const f of reservasNuevas) {
    const id = porLoc.get(f.localizador.toUpperCase());
    for (const m of f._mesas.slice(1)) if (id && m.id) mesasExtra.push({ cuenta_id: CUENTA_ID, reserva_id: id, mesa_id: m.id });
  }
}
{
  const CAMPOS = ["restaurante_id", "turno_id", "zona_id", "fecha", "hora", "pax", "estado", "cancelada_por", "cancelada_en", "llegada_en", "sentada_en", "salida_en", "origen", "canal", "tipo", "estado_pago", "notas_cliente", "notas_internas", "pais", "empresa", "consentimiento_marketing", "notificar", "cover_id", "cover_meta", "cliente_id", "mesa_id", "prescriptor_id", "etiquetas"];
  const filas = [];
  for (const f of reservasCambios) {
    const x = limpiar(f);
    const e = f._existente;
    const cambios = {};
    for (const k of CAMPOS) {
      let nuevo = x[k], viejo = e[k];
      if (k === "hora") { nuevo = String(nuevo).slice(0, 8); viejo = String(viejo).slice(0, 8); }
      if (k === "cliente_id" && !nuevo) continue; // no quitamos un cliente ya enlazado
      if (k === "mesa_id" && !nuevo && viejo) continue; // Cover sin mesa: dejamos la que hay
      if (k === "notas_internas" && !nuevo && viejo) continue;
      if (k === "etiquetas" && igualJson([...(nuevo || [])].sort(), [...(viejo || [])].sort())) continue;
      if ((k === "cancelada_en" || k === "llegada_en" || k === "sentada_en" || k === "salida_en") && nuevo && viejo && Math.abs(new Date(nuevo) - new Date(viejo)) < 1000) continue;
      if (!igualJson(nuevo, viejo)) cambios[k] = nuevo;
    }
    // El upsert por id necesita la fila completa (las columnas not null sin default se evalúan en el
    // INSERT aunque luego gane el ON CONFLICT): fila existente + cambios.
    if (Object.keys(cambios).length) { filas.push({ ...e, ...cambios, cuenta_id: CUENTA_ID }); stats.cambiadas++; } else stats.iguales++;
    for (const m of f._mesas.slice(1)) if (m.id) mesasExtra.push({ cuenta_id: CUENTA_ID, reserva_id: f._id, mesa_id: m.id });
  }
  if (filas.length) await upsertLotes("reservas_reservas", filas, "id");
}
if (mesasExtra.length) await upsertLotes("reservas_reserva_mesas", mesasExtra, "reserva_id,mesa_id", true);

/* ================= 4. informe ================= */

const contar = async (tabla, filtro) => {
  let q = sb.from(tabla).select("*", { count: "exact", head: true });
  if (filtro) q = filtro(q);
  const { count, error } = await q;
  if (error) throw new Error(`count ${tabla}: ${error.message}`);
  return count;
};
console.log(`\nHecho.`);
console.log(`  reservas: nuevas ${stats.nuevas} · actualizadas ${stats.cambiadas} · sin cambios ${stats.iguales}`);
console.log(`  clientes: nuevos ${clientesNuevos.length} · actualizados ${clientesCambios.size}`);
console.log(`  mesas creadas ${nuevasMesas.length} · etiquetas ${nuevasEtq.length} · prescriptores ${nuevosPresc.length} · mesas extra ${mesasExtra.length}`);
console.log(`  en la base ahora: ${await contar("reservas_reservas")} reservas (${await contar("reservas_reservas", (q) => q.not("cover_id", "is", null))} con cover_id), ${await contar("reservas_clientes")} clientes, ${await contar("reservas_mensajes", (q) => q.eq("estado", "pendiente"))} mensajes pendientes (debe ser 0 tras una carga)`);
