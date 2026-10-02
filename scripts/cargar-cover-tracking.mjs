/**
 * Carga del «Tracking de reservas» de CoverManager en el módulo Reservas de Hostelero (el mismo
 * camino que Skello → Personal: hasta el corte, Sonia y compañía siguen en Cover y aquí se carga
 * el informe; Ratios lee en vivo del módulo).
 *
 *   node scripts/cargar-cover-tracking.mjs <tracking.csv> --clientes=<clientes.tsv> [--dry-run]
 *
 * Ficheros (Analytics › Informes de Cover):
 *   · Tracking de reservas → «Descargar CSV» con «Incluir otros establecimientos», «Ampliar con
 *     más datos» y «Ampliar con datos de prescriptores». Llega por correo: CSV con «;».
 *     Pedir TODAS las reservas (todos los estados), no solo «las que fueron».
 *   · Clientes › Listado de clientes → TSV (ID, Nombre, Apellidos, Código, Teléfono, Email, …).
 *
 * Qué hace:
 *   1. Reservas (y mesas, etiquetas de reserva, prescriptores que falten). Idempotente: reservas
 *      por localizador (= «Token» de Cover) y solo se escriben las que cambian.
 *   2. Clientes: este script NO crea ni modifica fichas de cliente. Las reservas nuevas se enlazan
 *      a la ficha que ya exista (ID de Cover → teléfono → email → nombre) y al final se ejecuta
 *      scripts/sincronizar-clientes-cover.mjs, que deja una ficha por persona con los datos de
 *      Cover y reasigna cada reserva a la suya. (La primera versión actualizaba clientes con un
 *      upsert por lotes de columnas distintas y vaciaba campos: ver ese script.)
 *
 * Mensajería: las filas importadas llevan notificar = false y cover_id; el trigger
 * reservas_encolar_email no programa mensajes para filas con cover_id escritas por el service
 * role. Ningún cliente real recibe correos por esta carga.
 *
 * Claves en .env.local (raíz del repo): HOSTELERO_URL y HOSTELERO_SERVICE_KEY (service role).
 * PII: todo en memoria; no escribe ficheros intermedios; el informe final no imprime datos
 * personales.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

/* ================= parámetros ================= */

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca
const args = process.argv.slice(2);
const FICHERO = args.find((a) => !a.startsWith("--"));
const CLIENTES = (args.find((a) => a.startsWith("--clientes=")) || "").split("=")[1] || null;
const DRY = args.includes("--dry-run");
const LOTE = 500;

if (!FICHERO) {
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

/** Teléfono normalizado: misma regla que sincronizar-clientes-cover.mjs (España a 9 cifras,
    resto con prefijo internacional delante sin duplicarlo). */
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

// Comparación con claves ordenadas: jsonb devuelve los objetos con otro orden de claves.
const canon = (v) => (v && typeof v === "object" && !Array.isArray(v))
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
  : Array.isArray(v) ? v.map(canon) : v;
const igualJson = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

async function todas(tabla, select, filtro) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    // orden estable: sin él PostgREST puede repetir o saltarse filas entre páginas
    let q = sb.from(tabla).select(select).order("id").range(desde, desde + 999);
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

/* ================= clientes existentes (solo lectura) ================= */

const clientesBD = await todas("reservas_clientes", "id,nombre,apellidos,telefono,email,telefono_norm,email_norm,cover_id");
const porTel = new Map(), porEmail = new Map();
const clientesPorNombre = new Map(); // walk-ins sin contacto: nombre|apellidos → cliente
const nombreKey = (n, a) => `${String(n || "").trim().toLowerCase()}|${String(a || "").trim().toLowerCase()}`;
for (const c of clientesBD) {
  const t = c.telefono_norm || normTel("", c.telefono);
  const e = c.email_norm || normEmail(c.email);
  if (t && !porTel.has(t)) porTel.set(t, c);
  if (e && !porEmail.has(e)) porEmail.set(e, c);
  if (!t && !e) {
    const k = nombreKey(c.nombre, c.apellidos);
    if (!clientesPorNombre.has(k)) clientesPorNombre.set(k, c);
  }
}
console.log(`Base: ${restaurantes.length} restaurantes, ${salas.length} salas, ${mesas.length} mesas, ${clientesBD.length} clientes, ${etiquetas.length} etiquetas, ${prescriptores.length} prescriptores`);

/** Ficha existente para un contacto del tracking (no crea ni modifica nada). */
function buscarCliente(d) {
  const tel = normTel(d.prefijo, d.telefono);
  const email = normEmail(d.email);
  return (tel && porTel.get(tel)) || (email && porEmail.get(email))
    || (!tel && !email ? clientesPorNombre.get(nombreKey(d.nombre, d.apellidos)) : null) || null;
}

/* ================= 2. tracking de reservas ================= */

const reservasNuevas = [];
const reservasCambios = []; // {id, ...campos}
const mesasExtra = []; // {reserva (obj o id), mesa}
const stats = { filas: 0, sinRestaurante: 0, estadoDesconocido: new Map(), sinMesa: 0, nuevas: 0, cambiadas: 0, iguales: 0, sinCliente: 0 };
let reservasBD = [];

if (FICHERO) {
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
    const cliente = buscarCliente({
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
if (FICHERO) {
  console.log(`  reservas: ${stats.filas} filas · nuevas ${stats.nuevas} · ya existentes ${reservasCambios.length} · sin restaurante ${stats.sinRestaurante} · sin mesa ${stats.sinMesa} · sin cliente ${stats.sinCliente}`);
  if (stats.estadoDesconocido.size) console.log(`  ESTADOS DESCONOCIDOS (no cargados): ${[...stats.estadoDesconocido].map(([k, v]) => `${k || "(vacío)"}×${v}`).join(", ")}`);
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
// cambios de las reservas existentes (se calculan también en simulación)
const filasReservas = [];
{
  const CAMPOS = ["restaurante_id", "turno_id", "zona_id", "fecha", "hora", "pax", "estado", "cancelada_por", "cancelada_en", "llegada_en", "sentada_en", "salida_en", "origen", "canal", "tipo", "estado_pago", "notas_cliente", "notas_internas", "pais", "empresa", "consentimiento_marketing", "notificar", "cover_id", "cover_meta", "mesa_id", "prescriptor_id", "etiquetas"];
  const filas = [];
  for (const f of reservasCambios) {
    const x = limpiar(f);
    const e = f._existente;
    const cambios = {};
    for (const k of CAMPOS) {
      let nuevo = x[k], viejo = e[k];
      if (k === "hora") { nuevo = String(nuevo).slice(0, 8); viejo = String(viejo).slice(0, 8); }
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
  filasReservas.push(...filas);
}
console.log(`  reservas existentes con cambios: ${filasReservas.length} · sin cambios: ${stats.iguales}`);

if (DRY) {
  console.log("\nSimulación de reservas: no se ha escrito nada.");
  if (CLIENTES) {
    console.log("\nSimulación de clientes:\n");
    spawnSync(process.execPath, [resolve("scripts/sincronizar-clientes-cover.mjs"), FICHERO, CLIENTES, "--dry-run"], { stdio: "inherit" });
  }
  process.exit(0);
}

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

// 3.2 reservas
if (reservasNuevas.length) {
  const ins = await insertarLotes("reservas_reservas", reservasNuevas.map(limpiar), "id,localizador");
  const porLoc = new Map(ins.map((r) => [String(r.localizador).toUpperCase(), r.id]));
  for (const f of reservasNuevas) {
    const id = porLoc.get(f.localizador.toUpperCase());
    for (const m of f._mesas.slice(1)) if (id && m.id) mesasExtra.push({ cuenta_id: CUENTA_ID, reserva_id: id, mesa_id: m.id });
  }
}
if (filasReservas.length) await upsertLotes("reservas_reservas", filasReservas, "id");
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
console.log(`  mesas creadas ${nuevasMesas.length} · etiquetas ${nuevasEtq.length} · prescriptores ${nuevosPresc.length} · mesas extra ${mesasExtra.length}`);
console.log(`  en la base ahora: ${await contar("reservas_reservas")} reservas (${await contar("reservas_reservas", (q) => q.not("cover_id", "is", null))} con cover_id), ${await contar("reservas_clientes")} clientes, ${await contar("reservas_mensajes", (q) => q.eq("estado", "pendiente"))} mensajes pendientes (debe ser 0 tras una carga)`);

/* ================= 5. clientes ================= */

if (CLIENTES) {
  console.log(`\nSincronizando clientes con Cover…\n`);
  const r = spawnSync(process.execPath, [resolve("scripts/sincronizar-clientes-cover.mjs"), FICHERO, CLIENTES], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
} else {
  console.log("\nAviso: sin --clientes=<listado.tsv> no se sincronizan las fichas de cliente.");
}
