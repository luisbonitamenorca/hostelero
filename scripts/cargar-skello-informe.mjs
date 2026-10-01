/**
 * Carga del informe estándar de Skello (un .xlsx por centro) en el módulo Personal / RRHH v2.
 *
 *   node scripts/cargar-skello-informe.mjs <carpeta> [--dry-run] [--crear-solo-contratos] [--exportado=YYYY-MM-DD]
 *
 * Hojas que lee de cada fichero:
 *   «Detalles»            → turnos (trabajo), horas validadas por día y ausencias.
 *   «01-01 - 31-12»       → contratos (sección CONTRATOS ESTÁNDAR: periodos). CONTRATOS DIARIOS /
 *                           EXTRA: solo como periodo si la persona no tiene ningún contrato estándar.
 *   «Resumen Contadores» + «Ficha empleados» → contador inicial a cierre de la S39 (27-09-2026):
 *                           el export de Skello trunca las columnas S01…Snn de la hoja de contratos
 *                           (solo trae 6-14 semanas), así que el contador se toma del «Contador fin
 *                           de periodo después de modificaciones» (lo que Skello enseña) menos la
 *                           desviación de las semanas ≥ S40 que ya tienen planificación en la ficha.
 *   «Saldo de vacaciones» → ajuste de vacaciones (Disfrutados Skello − disfrutados aquí).
 *
 * Idempotente: una segunda ejecución no duplica nada (dedupe contra la base en todas las tablas).
 * Claves en .env.local: HOSTELERO_URL y HOSTELERO_SERVICE_KEY (service role, sin RLS).
 * PII: todo en memoria; no escribe ficheros intermedios. Solo imprime nombres en el informe final.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

/* ================= parámetros ================= */

const CUENTA_ID = "082c5366-d9ae-49b9-a8b8-8caad73985bd"; // Bonita Menorca
const args = process.argv.slice(2);
const CARPETA = args.find((a) => !a.startsWith("--"));
const DRY = args.includes("--dry-run");
const CREAR_SOLO_CONTRATOS = args.includes("--crear-solo-contratos");
const EXPORTADO = (args.find((a) => a.startsWith("--exportado=")) || "--exportado=2026-10-01").split("=")[1];
const ANIO = Number(EXPORTADO.slice(0, 4));
const HASTA_HORAS = "2026-09-30"; // horas validadas solo hasta aquí
const CONTADOR_FECHA = "2026-09-27"; // domingo de cierre de la S39
const CONTADOR_SEMANAS = 39; // S01…S39
const LOTE = 500;

if (!CARPETA) {
  console.error("Uso: node scripts/cargar-skello-informe.mjs <carpeta> [--dry-run] [--crear-solo-contratos]");
  process.exit(1);
}

// Código de centro en Skello → centro_id
const CENTROS = {
  BINIFADET: "2c3b1092-bf98-4a59-bdc4-8df06c067a0a",
  BODEGA: "a2c6e3e1-c8e0-4c0a-a70f-8c612a3a2d77",
  TIENDA: "1c6593a8-f805-43a5-b920-9bb2d4a93f59",
  TIRANT: "c974f3b0-ffbf-45f2-90ae-26745bb2f8f1",
  PRODUCCION: "b62bee30-03d3-4f61-9cc7-1c0f5492873b",
  OFICINA: "0e5c90bd-62e9-4f6f-877e-bb2228f10325",
  "TAMARINDOS BAR": "e89c055e-956d-4eba-a1f3-581dd7740a6f",
  TAMARINDOS_BAR: "e89c055e-956d-4eba-a1f3-581dd7740a6f",
  TAMARINDOS: "fb9e4af7-e50d-4617-b5e7-2de795faa894",
};

// Ausencias de Skello que NO se cargan
const AUSENCIAS_EXCLUIDAS = new Set(["Descanso semanal", "Descanso", "Festivo", "Ausencia incorporación/salida"]);
// Nombre Skello → rrhh_tipos_ausencia.nombre (el resto por nombre igual)
const MAPA_AUSENCIAS = {
  "Ausencia autorizada no remunerada": "Permiso sin sueldo",
  "Ausencia autorizada remunerada": "Permiso retribuido",
  "Permiso justificado": "Permiso retribuido",
  "Licencia por fuerza mayor": "Fuerza mayor",
  "Permiso por hospitalización de un hijo": "Permiso por hospitalización de familiar",
  "Despido disciplinario": "Otro",
  // no estaban en el mapa del plan; ambos son permisos retribuidos en el convenio
  "Baja por fallecimiento de un descendiente directo": "Permiso retribuido",
  "Asuntos propios": "Permiso retribuido",
};

/* ================= utilidades ================= */

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const espacios = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const capitalizar = (s) =>
  espacios(s)
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (m, sep, l) => sep + l.toUpperCase());
const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "-") return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const r2 = (n) => Math.round(n * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");

// Serial Excel → 'YYYY-MM-DD' (sin zona horaria: el serial ya es fecha local de Skello)
function fechaSerial(v) {
  if (typeof v === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      let y = Number(m[3]);
      if (m[3].length === 2) y += y <= 69 ? 2000 : 1900;
      return `${y}-${pad(m[2])}-${pad(m[1])}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}
// Serial Excel con fracción → 'HH:MM:00' (redondeo al minuto)
function horaSerial(v) {
  if (typeof v !== "number") return null;
  let min = Math.round((v - Math.floor(v)) * 1440);
  if (min >= 1440) min -= 1440;
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`;
}
const minutos = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
function horasTurno(ini, fin, pausaMin) {
  let d = minutos(fin) - minutos(ini);
  if (d <= 0) d += 1440;
  return Math.max(0, (d - pausaMin) / 60);
}
const sumarDias = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
// Nº identificación → últimas 3 cifras + letra ('12345678Z' → '678Z', 'Y0280706M' → '706M')
function dniUltimos(v) {
  const s = String(v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const m = s.match(/(\d{3})([A-Z])$/);
  return m ? m[1] + m[2] : null;
}
function enumTipo(nombreTipo) {
  const n = norm(nombreTipo);
  if (n === "vacaciones") return "vacaciones";
  if (/^baja|^accidente|maternidad|paternidad/.test(n)) return "baja";
  if (/^permiso|^formaci|^descanso compensatorio|^fuerza mayor/.test(n)) return "permiso";
  return "otro";
}

/* ================= Supabase ================= */

const env = {};
for (const linea of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const i = linea.indexOf("=");
  if (i > 0 && !linea.trim().startsWith("#")) env[linea.slice(0, i).trim()] = linea.slice(i + 1).trim();
}
if (!env.HOSTELERO_URL || !env.HOSTELERO_SERVICE_KEY) {
  console.error("Faltan HOSTELERO_URL / HOSTELERO_SERVICE_KEY en .env.local");
  process.exit(1);
}
const sb = createClient(env.HOSTELERO_URL, env.HOSTELERO_SERVICE_KEY, { auth: { persistSession: false } });

async function leerTodo(tabla, select, filtro = (q) => q) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await filtro(sb.from(tabla).select(select)).range(desde, desde + 999);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    filas.push(...data);
    if (data.length < 1000) break;
  }
  return filas;
}
async function contar(tabla, filtro = (q) => q) {
  const { count, error } = await filtro(sb.from(tabla).select("*", { count: "exact", head: true }));
  if (error) throw new Error(`count ${tabla}: ${error.message}`);
  return count;
}
async function insertarLotes(tabla, filas, etiqueta = tabla) {
  let hechas = 0;
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    const { error } = await sb.from(tabla).insert(lote);
    if (error) throw new Error(`insert ${tabla}: ${error.message}`);
    hechas += lote.length;
    process.stdout.write(`\r  ${etiqueta}: ${hechas}/${filas.length}`);
  }
  if (filas.length) console.log();
}
async function upsertLotes(tabla, filas, onConflict, etiqueta = tabla) {
  let hechas = 0;
  for (let i = 0; i < filas.length; i += LOTE) {
    const lote = filas.slice(i, i + LOTE);
    const { error } = await sb.from(tabla).upsert(lote, { onConflict });
    if (error) throw new Error(`upsert ${tabla}: ${error.message}`);
    hechas += lote.length;
    process.stdout.write(`\r  ${etiqueta}: ${hechas}/${filas.length}`);
  }
  if (filas.length) console.log();
}
const porCuenta = (q) => q.eq("cuenta_id", CUENTA_ID);

/* ================= lectura de los ficheros ================= */

const personas = new Map(); // clave norm('nombre apellidos') → { nombre, apellidos, dni, centro, tipoContrato, horasSemana, enDetalles }
const turnosFichero = new Map(); // clave (persona|centro|fecha|ini|fin) → turno
const ausenciasDia = []; // { persona, tipoSkello, fecha }
const contratos = []; // { persona, seccion, fechaAlta, fechaBaja, horasSemana, nota, contadorInicio, semanas: [] }
const vacaciones = []; // { persona, disfrutados }
const semanasFicha = new Map(); // clave persona → Map(semana → { contrato, vol, total })
const contadoresSkello = []; // { persona, fin, modificaciones }
const avisos = [];
const tiposSkelloVistos = new Map();
const puestosVistos = new Set();
let filasTrabajo = 0;
let filasAusencia = 0;

function persona(nombre, apellidos, extra = {}) {
  const clave = norm(`${nombre} ${apellidos}`);
  if (!clave) return null;
  let p = personas.get(clave);
  if (!p) {
    p = { clave, nombre: espacios(nombre), apellidos: espacios(apellidos), dni: null, centro: null, centroFichero: null, tipoContrato: null, horasSemana: null, enDetalles: false };
    personas.set(clave, p);
  }
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== "" && p[k] == null) p[k] = v;
  return p;
}

const ficheros = readdirSync(CARPETA).filter((f) => f.toLowerCase().endsWith(".xlsx") && !f.startsWith("~$"));
if (!ficheros.length) {
  console.error(`No hay .xlsx en ${CARPETA}`);
  process.exit(1);
}
console.log(`Skello → Personal · ${ficheros.length} ficheros en ${CARPETA}${DRY ? " · DRY-RUN" : ""}\n`);

for (const f of ficheros) {
  const wb = XLSX.readFile(join(CARPETA, f));
  const codigoFichero = f.replace(/_.*$/, "").toUpperCase();
  const hoja = (n) => (wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) : null);

  // --- Detalles ---
  const det = hoja("Detalles");
  if (!det) {
    avisos.push(`${f}: sin hoja «Detalles»`);
  } else {
    for (const r of det.slice(1)) {
      if (!r[0] || !r[9]) continue;
      const fecha = fechaSerial(r[9]);
      if (!fecha) continue;
      const centroPrincipal = CENTROS[espacios(r[7]).toUpperCase()] ?? null;
      if (!centroPrincipal) avisos.push(`${f}: establecimiento principal desconocido «${r[7]}»`);
      const p = persona(r[0], r[1], {
        dni: dniUltimos(r[2]),
        centro: centroPrincipal,
        tipoContrato: r[4] ? espacios(r[4]) : null,
        horasSemana: num(r[5]),
      });
      p.enDetalles = true;
      const tipoFila = norm(r[10]);
      if (tipoFila === "trabajo") {
        filasTrabajo++;
        const codigo = espacios(r[12]).toUpperCase();
        const centro = codigo ? CENTROS[codigo] : centroPrincipal;
        if (!centro) {
          avisos.push(`${f}: centro de turno desconocido «${r[12]}»`);
          continue;
        }
        const ini = horaSerial(r[13]);
        const fin = horaSerial(r[14]);
        if (!ini || !fin) {
          avisos.push(`${f}: turno sin inicio/fin ${fecha} (${p.clave.split(" ")[0]}…)`);
          continue;
        }
        if (fechaSerial(r[13]) !== fecha) avisos.push(`${f}: fecha ≠ día de inicio en ${fecha}`);
        const pausa = Math.round((num(r[15]) ?? 0) * 60);
        const puesto = espacios(r[11]) || null;
        if (puesto) puestosVistos.add(puesto);
        const clave = `${p.clave}|${centro}|${fecha}|${ini}|${fin}`;
        if (turnosFichero.has(clave)) continue; // mismo turno en dos ficheros
        turnosFichero.set(clave, {
          persona: p,
          centro,
          fecha,
          ini,
          fin,
          pausa,
          puesto,
          nota: r[17] ? espacios(r[17]) : null,
          retenidas: num(r[18]) ?? 0,
          retraso: num(r[16]) ?? 0,
        });
      } else if (tipoFila === "ausencia") {
        filasAusencia++;
        const tipoSkello = espacios(r[11]);
        tiposSkelloVistos.set(tipoSkello, (tiposSkelloVistos.get(tipoSkello) ?? 0) + 1);
        if (AUSENCIAS_EXCLUIDAS.has(tipoSkello)) continue;
        ausenciasDia.push({ persona: p, tipoSkello, fecha });
      }
    }
  }

  // --- Contratos ---
  const con = hoja("01-01 - 31-12");
  if (!con) {
    avisos.push(`${f}: sin hoja de contratos`);
  } else {
    let seccion = null;
    let cab = null;
    for (const r of con) {
      const c0 = r[0] == null ? "" : String(r[0]).trim();
      if (c0 && r.slice(1).every((x) => x == null || x === "") && c0.toUpperCase() === c0 && /[A-ZÁÉÍÓÚ]{3}/.test(c0)) {
        seccion = c0;
        cab = null;
        continue;
      }
      if (c0 === "Apellido/s") {
        cab = r.map((x) => String(x ?? "").trim());
        continue;
      }
      if (!cab || !c0 || typeof r[1] !== "string" || !r[1].trim()) continue;
      const col = (nombre) => cab.findIndex((h) => h.startsWith(nombre));
      const p = persona(r[1], r[0], { centroFichero: CENTROS[codigoFichero] ?? null });
      const fechaAlta = fechaSerial(r[col("Fecha de contratación")]);
      if (!fechaAlta) {
        avisos.push(`${f}: contrato sin fecha de alta (${p.nombre.split(" ")[0]} ${p.apellidos.slice(0, 3)}…)`);
        continue;
      }
      const iNota = col("Nota de archivo");
      const iCont = col("Contador inicio de periodo");
      const semanas = [];
      cab.forEach((h, i) => {
        const m = h.match(/^S(\d{2}) /);
        if (m) semanas[Number(m[1])] = num(r[i]);
      });
      contratos.push({
        persona: p,
        seccion: seccion ?? "?",
        estandar: /EST[ÁA]NDAR/.test(seccion ?? ""),
        fechaAlta,
        fechaBaja: fechaSerial(r[col("Fecha de fin del contrato")]),
        horasSemana: col("Volumen horario semanal") >= 0 ? num(r[col("Volumen horario semanal")]) : null,
        nota: iNota >= 0 && r[iNota] ? espacios(r[iNota]) : null,
        contadorInicio: iCont >= 0 ? num(r[iCont]) : null,
        semanas,
      });
    }
  }

  // --- Ficha empleados (semanas) + Resumen Contadores ---
  const ficha = hoja("Ficha empleados");
  if (ficha) {
    let cur = null;
    for (let i = 0; i < ficha.length; i++) {
      const r = ficha[i];
      const sig = ficha[i + 1];
      if (typeof r[0] === "string" && r[0].trim() && r.slice(1).every((x) => x == null || x === "") && sig && sig[0] === "Detalles planificación") {
        cur = norm(r[0]);
        semanasFicha.set(cur, new Map());
        continue;
      }
      if (!cur || typeof r[0] !== "string") continue;
      const m = r[0].match(/^Semana (\d{2})/);
      if (!m) continue;
      const contrato = !!r[3] && r[3] !== "No hay contratos";
      semanasFicha.get(cur).set(Number(m[1]), { contrato, vol: num(r[4]) ?? 0, total: num(r[15]) ?? 0 });
    }
  } else avisos.push(`${f}: sin hoja «Ficha empleados»`);
  const rc = hoja("Resumen Contadores");
  if (rc) {
    const cab = (rc[0] ?? []).map((x) => String(x ?? "").trim());
    const iFin = cab.findIndex((h) => h.startsWith("Contador fin de periodo después"));
    const iMod = cab.findIndex((h) => h.startsWith("Horas salidas del contador"));
    for (const r of rc.slice(1)) {
      if (!r[0] || !r[1] || iFin < 0) continue;
      const fin = num(r[iFin]);
      if (fin == null) continue;
      contadoresSkello.push({ persona: persona(r[1], r[0]), fin, modificaciones: iMod >= 0 ? num(r[iMod]) ?? 0 : 0 });
    }
  } else avisos.push(`${f}: sin hoja «Resumen Contadores»`);

  // --- Saldo de vacaciones ---
  const vac = hoja("Saldo de vacaciones");
  if (vac) {
    const cab = (vac[0] ?? []).map((x) => String(x ?? "").trim());
    const iDis = cab.findIndex((h) => h.startsWith("Disfrutados"));
    for (const r of vac.slice(1)) {
      if (!r[0] || !r[1] || iDis < 0) continue;
      const d = num(r[iDis]);
      if (d == null) continue;
      vacaciones.push({ persona: persona(r[1], r[0]), disfrutados: d });
    }
  }
  console.log(`  ${f} (${codigoFichero}): detalles ${det ? det.length - 1 : 0} filas, contratos ${con ? con.length : 0} filas`);
}

const personasDetalles = [...personas.values()].filter((p) => p.enDetalles);
console.log(`\nFicheros: ${personas.size} personas (${personasDetalles.length} con filas en Detalles), ${filasTrabajo} filas trabajo → ${turnosFichero.size} turnos únicos, ${filasAusencia} filas ausencia, ${contratos.length} contratos, ${vacaciones.length} saldos de vacaciones`);
console.log("Tipos de ausencia en Skello:", Object.fromEntries([...tiposSkelloVistos.entries()].sort((a, b) => b[1] - a[1])));

/* ================= base: estado inicial ================= */

const counts = async () => ({
  empleados: await contar("empleados", porCuenta),
  periodos: await contar("rrhh_periodos_contrato", porCuenta),
  turnos_publicados: await contar("rrhh_turnos", (q) => porCuenta(q).eq("estado", "publicado")),
  turnos_borrador: await contar("rrhh_turnos", (q) => porCuenta(q).eq("estado", "borrador")),
  turnos_futuros: await contar("rrhh_turnos", (q) => porCuenta(q).gt("fecha", HASTA_HORAS)),
  horas_dia: await contar("rrhh_horas_dia", porCuenta),
  ausencias: await contar("rrhh_ausencias", porCuenta),
  puestos: await contar("rrhh_puestos_cat", porCuenta),
});
const antes = await counts();
console.log("\nBase antes:", antes);

const empleados = await leerTodo("empleados", "id,nombre,apellidos,dni_ultimos,centro_principal_id,fecha_alta,fecha_baja,horas_semana", porCuenta);
const tipos = await leerTodo("rrhh_tipos_ausencia", "id,nombre,solicitable_empleado,activo", porCuenta);
const puestosCat = await leerTodo("rrhh_puestos_cat", "id,nombre", porCuenta);
const tipoPorNombre = new Map(tipos.map((t) => [norm(t.nombre), t]));
const puestoPorNombre = new Map(puestosCat.map((p) => [p.nombre.toLowerCase(), p.id]));

/* ================= 1. EMPLEADOS ================= */

console.log("\n1/7 Empleados");
const porNombreCompleto = new Map();
for (const e of empleados) {
  const k = norm(`${e.nombre} ${e.apellidos ?? ""}`);
  porNombreCompleto.set(k, [...(porNombreCompleto.get(k) ?? []), e]);
}
const casados = new Map(); // clave persona → empleado
const creadas = [];
const noCasadas = [];
const soloContratos = [];
const dniRellenar = [];

for (const p of personas.values()) {
  let e = null;
  const exactos = porNombreCompleto.get(p.clave) ?? [];
  if (exactos.length === 1) e = exactos[0];
  else if (exactos.length > 1) {
    noCasadas.push(`${p.nombre} ${p.apellidos}: ${exactos.length} empleados con el mismo nombre`);
    continue;
  } else {
    const ap = norm(p.apellidos);
    const t1 = norm(p.nombre).split(" ")[0];
    const cand = empleados.filter((x) => norm(x.apellidos) === ap && norm(x.nombre).split(" ")[0] === t1);
    if (cand.length === 1) e = cand[0];
    else if (cand.length > 1) {
      noCasadas.push(`${p.nombre} ${p.apellidos}: ${cand.length} candidatos por apellidos + primer nombre`);
      continue;
    }
  }
  if (e) {
    casados.set(p.clave, e);
    if (!e.dni_ultimos && p.dni) dniRellenar.push({ id: e.id, dni_ultimos: p.dni, p });
    continue;
  }
  // no casa → crear
  const misContratos = contratos.filter((c) => c.persona === p);
  const primeraAlta = misContratos.map((c) => c.fechaAlta).sort()[0] ?? null;
  if (!p.enDetalles && !CREAR_SOLO_CONTRATOS) {
    soloContratos.push(`${capitalizar(p.nombre)} ${capitalizar(p.apellidos)} (${misContratos.map((c) => `${c.fechaAlta}→${c.fechaBaja ?? "…"}`).join(", ") || "sin fechas"})`);
    continue;
  }
  if (!primeraAlta && !p.enDetalles) {
    noCasadas.push(`${p.nombre} ${p.apellidos}: sin turnos ni fecha de contratación, no se crea`);
    continue;
  }
  const centroPrincipal = p.centro ?? p.centroFichero ?? null;
  creadas.push({
    p,
    fila: {
      cuenta_id: CUENTA_ID,
      nombre: capitalizar(p.nombre),
      apellidos: capitalizar(p.apellidos),
      centro_principal_id: centroPrincipal,
      tipo_contrato: p.tipoContrato ?? null,
      horas_semana: p.horasSemana ?? misContratos.find((c) => c.estandar)?.horasSemana ?? null,
      fecha_alta: primeraAlta,
      departamento: null,
      dni_ultimos: p.dni,
      user_id: null,
    },
  });
}
console.log(`  casadas ${casados.size} · a crear ${creadas.length} · solo en contratos (no se crean${CREAR_SOLO_CONTRATOS ? "" : ", usa --crear-solo-contratos"}) ${soloContratos.length} · no casadas ${noCasadas.length} · dni_ultimos a rellenar ${dniRellenar.length}`);
for (const c of creadas) console.log(`    + crear: ${c.fila.nombre} ${c.fila.apellidos} · centro ${c.fila.centro_principal_id?.slice(0, 8)} · ${c.fila.tipo_contrato ?? "-"} · ${c.fila.horas_semana ?? "-"} h · alta ${c.fila.fecha_alta ?? "-"}`);
for (const n of noCasadas) console.log(`    ! no casa: ${n}`);
if (soloContratos.length) console.log(`    solo contratos: ${soloContratos.join(" · ")}`);

if (noCasadas.length > 10 || (personasDetalles.length && casados.size + creadas.length < personasDetalles.length * 0.8)) {
  console.error("\nABORTADO: demasiadas personas sin casar. Revisa los nombres antes de cargar.");
  process.exit(2);
}

if (!DRY) {
  if (creadas.length) {
    const { data, error } = await sb.from("empleados").insert(creadas.map((c) => c.fila)).select("id,nombre,apellidos,dni_ultimos,centro_principal_id,fecha_alta,fecha_baja,horas_semana");
    if (error) throw new Error(`insert empleados: ${error.message}`);
    for (const e of data) {
      const p = creadas.find((c) => norm(`${c.fila.nombre} ${c.fila.apellidos}`) === norm(`${e.nombre} ${e.apellidos}`))?.p;
      if (p) casados.set(p.clave, e);
      empleados.push(e);
    }
    console.log(`  creados ${data.length}`);
  }
  for (const d of dniRellenar) {
    const { error } = await sb.from("empleados").update({ dni_ultimos: d.dni_ultimos }).eq("id", d.id).is("dni_ultimos", null);
    if (error) throw new Error(`update dni: ${error.message}`);
  }
  if (dniRellenar.length) console.log(`  dni_ultimos rellenados ${dniRellenar.length}`);
}
const empDe = (p) => casados.get(p.clave) ?? null;

/* ================= 2. PERIODOS DE CONTRATO ================= */

console.log("\n2/7 Periodos de contrato");
const periodosBD = await leerTodo("rrhh_periodos_contrato", "id,empleado_id,fecha_alta,fecha_baja,horas_semana,nota", porCuenta);
const periodoPorClave = new Map(periodosBD.map((x) => [`${x.empleado_id}|${x.fecha_alta}`, x]));
const periodosInsertar = [];
const periodosActualizar = [];
const periodosMoverAlta = [];
const altasFichero = new Set(contratos.map((c) => (empDe(c.persona) ? `${empDe(c.persona).id}|${c.fechaAlta}` : "")));
const empleadosConEstandar = new Set(contratos.filter((c) => c.estandar).map((c) => c.persona.clave));
let contratosOmitidos = 0;
let contratosSinEmpleado = 0;
const vistos = new Set();
for (const c of contratos) {
  const e = empDe(c.persona);
  if (!e) {
    contratosSinEmpleado++;
    continue;
  }
  if (!c.estandar && empleadosConEstandar.has(c.persona.clave)) {
    contratosOmitidos++;
    continue;
  }
  const clave = `${e.id}|${c.fechaAlta}`;
  if (vistos.has(clave)) continue;
  vistos.add(clave);
  const nota = c.nota ?? (c.estandar ? null : `${capitalizar(c.seccion)} (Skello)`);
  const ex = periodoPorClave.get(clave);
  if (!ex) {
    // misma baja y horas con alta movida unos días en Skello → se corrige la alta en vez de duplicar el periodo
    const cercano = periodosBD.find(
      (y) => y.empleado_id === e.id && !altasFichero.has(`${e.id}|${y.fecha_alta}`) && (y.fecha_baja ?? null) === (c.fechaBaja ?? null) && Number(y.horas_semana ?? -1) === Number(c.horasSemana ?? -1) && Math.abs(diasEntre(y.fecha_alta, c.fechaAlta)) <= 8 && !periodosMoverAlta.some((m) => m.id === y.id),
    );
    if (cercano) {
      periodosMoverAlta.push({ id: cercano.id, empleado_id: e.id, fecha_alta: c.fechaAlta, antes: `${cercano.fecha_alta}→${cercano.fecha_baja ?? "…"} ${cercano.horas_semana}h` });
      continue;
    }
    periodosInsertar.push({ cuenta_id: CUENTA_ID, empleado_id: e.id, fecha_alta: c.fechaAlta, fecha_baja: c.fechaBaja, horas_semana: c.horasSemana, nota });
  } else if ((ex.fecha_baja ?? null) !== (c.fechaBaja ?? null) || Number(ex.horas_semana ?? -1) !== Number(c.horasSemana ?? -1)) {
    periodosActualizar.push({ id: ex.id, empleado_id: e.id, fecha_baja: c.fechaBaja, horas_semana: c.horasSemana, nota: nota ?? ex.nota, antes: ex });
  }
}
console.log(`  contratos ${contratos.length} · insertar ${periodosInsertar.length} · actualizar ${periodosActualizar.length} · mover alta ${periodosMoverAlta.length} · diarios/extra omitidos (ya hay estándar) ${contratosOmitidos} · sin empleado ${contratosSinEmpleado}`);
for (const m of periodosMoverAlta) console.log(`    ↔ ${m.empleado_id.slice(0, 8)} ${m.antes} → alta ${m.fecha_alta}`);
const empsConPeriodos = new Set(periodosBD.map((x) => x.empleado_id));
const insertNuevosConPeriodos = periodosInsertar.filter((x) => empsConPeriodos.has(x.empleado_id)).length;
console.log(`  (de los insertados, ${insertNuevosConPeriodos} son de empleados que ya tienen otros periodos: posibles altas distintas por un día)`);
for (const x of periodosInsertar.filter((x) => empsConPeriodos.has(x.empleado_id)).slice(0, 10)) {
  const otros = periodosBD.filter((y) => y.empleado_id === x.empleado_id).map((y) => `${y.fecha_alta}→${y.fecha_baja ?? "…"} ${y.horas_semana}h`).join(", ");
  console.log(`    + ${x.empleado_id.slice(0, 8)} nuevo ${x.fecha_alta}→${x.fecha_baja ?? "…"} ${x.horas_semana}h ${x.nota ? "(" + x.nota + ")" : ""} · ya tiene: ${otros}`);
}
for (const u of periodosActualizar.slice(0, 15)) console.log(`    ~ ${u.empleado_id.slice(0, 8)} alta ${u.antes.fecha_alta}: baja ${u.antes.fecha_baja ?? "…"}→${u.fecha_baja ?? "…"} horas ${u.antes.horas_semana}→${u.horas_semana}`);
if (!DRY) {
  await insertarLotes("rrhh_periodos_contrato", periodosInsertar, "periodos insertados");
  for (const u of periodosActualizar) {
    const { error } = await sb.from("rrhh_periodos_contrato").update({ fecha_baja: u.fecha_baja, horas_semana: u.horas_semana, nota: u.nota }).eq("id", u.id);
    if (error) throw new Error(`update periodo: ${error.message}`);
  }
  for (const m of periodosMoverAlta) {
    const { error } = await sb.from("rrhh_periodos_contrato").update({ fecha_alta: m.fecha_alta }).eq("id", m.id);
    if (error) throw new Error(`mover alta periodo: ${error.message}`);
  }
  // sincronizar empleados con su último periodo (como sincronizarEmpleadoTrasPeriodo)
  // (todos los empleados con contrato en el fichero: idempotente y corrige empleados cuyo resumen se quedó desfasado)
  const tocados = new Set(contratos.map((c) => empDe(c.persona)?.id).filter(Boolean));
  let sincronizados = 0;
  for (const empleadoId of tocados) {
    const { data } = await sb.from("rrhh_periodos_contrato").select("fecha_alta,fecha_baja,horas_semana").eq("empleado_id", empleadoId).order("fecha_alta", { ascending: false }).limit(1);
    const ult = data?.[0];
    if (!ult) continue;
    const { error } = await sb.from("empleados").update({ fecha_alta: ult.fecha_alta, fecha_baja: ult.fecha_baja, horas_semana: ult.horas_semana }).eq("id", empleadoId);
    if (error) throw new Error(`sync empleado: ${error.message}`);
    sincronizados++;
  }
  console.log(`  empleados sincronizados con su último periodo: ${sincronizados}`);
}

/* ================= 3. TURNOS ================= */

console.log("\n3/7 Turnos");
// puestos que faltan
const puestosNuevos = [...puestosVistos].filter((p) => !puestoPorNombre.has(p.toLowerCase()));
console.log(`  puestos distintos ${puestosVistos.size} · nuevos en rrhh_puestos_cat ${puestosNuevos.length}${puestosNuevos.length ? ": " + puestosNuevos.join(", ") : ""}`);
if (!DRY && puestosNuevos.length) {
  const { data, error } = await sb
    .from("rrhh_puestos_cat")
    .insert(puestosNuevos.map((nombre) => ({ cuenta_id: CUENTA_ID, nombre, color: "#888888", departamento_id: null })))
    .select("id,nombre");
  if (error) throw new Error(`insert puestos: ${error.message}`);
  for (const p of data) puestoPorNombre.set(p.nombre.toLowerCase(), p.id);
}

const turnosBD = await leerTodo("rrhh_turnos", "id,empleado_id,centro_id,fecha,hora_inicio,hora_fin,estado", porCuenta);
const turnoPorClave = new Map();
for (const t of turnosBD) turnoPorClave.set(`${t.empleado_id}|${t.centro_id}|${t.fecha}|${t.hora_inicio}|${t.hora_fin}`, t);
const turnosInsertar = [];
const borradoresPublicar = [];
let turnosExistentes = 0;
let turnosSinEmpleado = 0;
const ahora = new Date().toISOString();
for (const t of turnosFichero.values()) {
  const e = empDe(t.persona);
  if (!e) {
    turnosSinEmpleado++;
    continue;
  }
  const ex = turnoPorClave.get(`${e.id}|${t.centro}|${t.fecha}|${t.ini}|${t.fin}`);
  if (ex) {
    turnosExistentes++;
    if (ex.estado === "borrador") borradoresPublicar.push(ex.id);
    continue;
  }
  turnosInsertar.push({
    cuenta_id: CUENTA_ID,
    empleado_id: e.id,
    centro_id: t.centro,
    fecha: t.fecha,
    hora_inicio: t.ini,
    hora_fin: t.fin,
    pausa_min: t.pausa,
    puesto: t.puesto,
    puesto_id: t.puesto ? (puestoPorNombre.get(t.puesto.toLowerCase()) ?? null) : null,
    nota: t.nota,
    estado: "publicado",
    publicado_at: ahora,
    creado_por: null,
  });
}
const futuros = turnosInsertar.filter((t) => t.fecha > HASTA_HORAS).length;
const borradoresRestantes = turnosBD.filter((t) => t.estado === "borrador" && !borradoresPublicar.includes(t.id));
if (borradoresRestantes.length) {
  const fechas = [...new Set(borradoresRestantes.map((t) => t.fecha))].sort();
  console.log(`  aviso: ${borradoresRestantes.length} turnos en borrador (${fechas[0]}→${fechas[fechas.length - 1]}) no coinciden con ningún turno del fichero (horas distintas): se dejan en borrador, el fichero manda los publicados`);
}
console.log(`  en fichero ${turnosFichero.size} · ya en base ${turnosExistentes} (borradores a publicar ${borradoresPublicar.length}) · insertar ${turnosInsertar.length} (futuros > ${HASTA_HORAS}: ${futuros}) · sin empleado ${turnosSinEmpleado}`);
if (!DRY) {
  await insertarLotes("rrhh_turnos", turnosInsertar, "turnos insertados");
  for (let i = 0; i < borradoresPublicar.length; i += 200) {
    const { error } = await sb.from("rrhh_turnos").update({ estado: "publicado", publicado_at: ahora }).in("id", borradoresPublicar.slice(i, i + 200));
    if (error) throw new Error(`publicar borradores: ${error.message}`);
  }
  if (borradoresPublicar.length) console.log(`  borradores publicados ${borradoresPublicar.length}`);
}

/* ================= 4. HORAS VALIDADAS ================= */

console.log("\n4/7 Horas validadas por día");
const horasDia = new Map();
for (const t of turnosFichero.values()) {
  if (t.fecha > HASTA_HORAS) continue;
  const e = empDe(t.persona);
  if (!e) continue;
  const k = `${e.id}|${t.fecha}|${t.centro}`;
  const h = horasDia.get(k) ?? { empleado_id: e.id, fecha: t.fecha, centro_id: t.centro, plan: 0, retenidas: 0, retraso: 0 };
  h.plan += horasTurno(t.ini, t.fin, t.pausa);
  h.retenidas += t.retenidas;
  h.retraso += t.retraso;
  horasDia.set(k, h);
}
const horasBD = await leerTodo("rrhh_horas_dia", "empleado_id,fecha,centro_id,validado_por,horas_retenidas", porCuenta);
const horasProtegidas = new Set(horasBD.filter((h) => h.validado_por).map((h) => `${h.empleado_id}|${h.fecha}|${h.centro_id}`));
const horasExistentes = new Set(horasBD.map((h) => `${h.empleado_id}|${h.fecha}|${h.centro_id}`));
const horasUpsert = [];
let horasSaltadas = 0;
let horasYaIguales = 0;
const horasBDMap = new Map(horasBD.map((h) => [`${h.empleado_id}|${h.fecha}|${h.centro_id}`, h]));
for (const [k, h] of horasDia) {
  if (horasProtegidas.has(k)) {
    horasSaltadas++;
    continue;
  }
  const ex = horasBDMap.get(k);
  if (ex && Number(ex.horas_retenidas) === r2(h.retenidas)) {
    horasYaIguales++;
    continue;
  }
  horasUpsert.push({
    cuenta_id: CUENTA_ID,
    empleado_id: h.empleado_id,
    fecha: h.fecha,
    centro_id: h.centro_id,
    horas_plan: r2(h.plan),
    horas_retenidas: r2(h.retenidas),
    horas_fichadas: null,
    retraso_min: Math.round(h.retraso * 60),
    estado: "validada",
    validado_en: ahora,
    validado_por: null,
    nota: `Importado de Skello ${EXPORTADO.split("-").reverse().join("-")}`,
    incidencias: [],
  });
}
const sumPlan = r2([...horasDia.values()].reduce((a, h) => a + h.plan, 0));
const sumRet = r2([...horasDia.values()].reduce((a, h) => a + h.retenidas, 0));
console.log(`  días-persona-centro hasta ${HASTA_HORAS}: ${horasDia.size} · upsert ${horasUpsert.length} (${horasUpsert.filter((h) => !horasExistentes.has(`${h.empleado_id}|${h.fecha}|${h.centro_id}`)).length} nuevos) · ya iguales ${horasYaIguales} · protegidas (validadas por alguien) ${horasSaltadas} · Σ plan ${sumPlan} h · Σ retenidas ${sumRet} h`);
if (!DRY) await upsertLotes("rrhh_horas_dia", horasUpsert, "empleado_id,fecha,centro_id", "horas_dia upsert");

/* ================= 5. AUSENCIAS ================= */

console.log("\n5/7 Ausencias");
// agrupar días consecutivos por (persona, tipo)
const porPersonaTipo = new Map();
for (const a of ausenciasDia) {
  const k = `${a.persona.clave}|${a.tipoSkello}`;
  if (!porPersonaTipo.has(k)) porPersonaTipo.set(k, { persona: a.persona, tipoSkello: a.tipoSkello, fechas: new Set() });
  porPersonaTipo.get(k).fechas.add(a.fecha);
}
const rangos = [];
const tiposSinMapa = new Map();
for (const g of porPersonaTipo.values()) {
  const nombreTipo = MAPA_AUSENCIAS[g.tipoSkello] ?? g.tipoSkello;
  const tipo = tipoPorNombre.get(norm(nombreTipo));
  if (!tipo) {
    tiposSinMapa.set(g.tipoSkello, (tiposSinMapa.get(g.tipoSkello) ?? 0) + g.fechas.size);
    continue;
  }
  const fechas = [...g.fechas].sort();
  let ini = fechas[0];
  let fin = fechas[0];
  for (const f of fechas.slice(1)) {
    if (f === sumarDias(fin, 1)) fin = f;
    else {
      rangos.push({ persona: g.persona, tipo, tipoSkello: g.tipoSkello, ini, fin });
      ini = fin = f;
    }
  }
  rangos.push({ persona: g.persona, tipo, tipoSkello: g.tipoSkello, ini, fin });
}
if (tiposSinMapa.size) console.log(`  ! tipos de Skello sin equivalente (no se cargan): ${JSON.stringify(Object.fromEntries(tiposSinMapa))}`);
const ausBD = await leerTodo("rrhh_ausencias", "id,empleado_id,tipo_id,fecha_inicio,fecha_fin,estado", (q) => porCuenta(q).eq("estado", "aprobada"));
const ausInsertar = [];
const ausAmpliar = [];
const ausRetipar = [];
let ausIguales = 0;
let ausSinEmpleado = 0;
const solapesOtroTipo = [];
const porTipoNuevo = new Map();
for (const r of rangos) {
  const e = empDe(r.persona);
  if (!e) {
    ausSinEmpleado++;
    continue;
  }
  const solapan = ausBD.filter((a) => a.empleado_id === e.id && a.fecha_inicio <= r.fin && a.fecha_fin >= r.ini);
  const mismoTipo = solapan.find((a) => a.tipo_id === r.tipo.id);
  if (mismoTipo) {
    if (mismoTipo.fecha_inicio <= r.ini && mismoTipo.fecha_fin >= r.fin) ausIguales++;
    else {
      const ini = mismoTipo.fecha_inicio < r.ini ? mismoTipo.fecha_inicio : r.ini;
      const fin = mismoTipo.fecha_fin > r.fin ? mismoTipo.fecha_fin : r.fin;
      ausAmpliar.push({ id: mismoTipo.id, fecha_inicio: ini, fecha_fin: fin, antes: `${mismoTipo.fecha_inicio}→${mismoTipo.fecha_fin}` });
      mismoTipo.fecha_inicio = ini;
      mismoTipo.fecha_fin = fin;
    }
    continue;
  }
  // misma ausencia cargada en agosto con un tipo más grueso (p. ej. Accidente → Baja, Paternidad → Permiso retribuido):
  // si la existente cabe dentro del rango nuevo, se le pone el tipo preciso (y se amplía) en vez de duplicarla
  const contenida = solapan.find((a) => a.id && a.fecha_inicio >= r.ini && a.fecha_fin <= r.fin);
  if (contenida) {
    const tipoAntes = tipos.find((t) => t.id === contenida.tipo_id)?.nombre ?? "?";
    ausRetipar.push({ id: contenida.id, tipo_id: r.tipo.id, tipo: enumTipo(r.tipo.nombre), fecha_inicio: r.ini, fecha_fin: r.fin, antes: `${tipoAntes} ${contenida.fecha_inicio}→${contenida.fecha_fin}`, despues: `${r.tipo.nombre} ${r.ini}→${r.fin}` });
    contenida.tipo_id = r.tipo.id;
    contenida.fecha_inicio = r.ini;
    contenida.fecha_fin = r.fin;
    continue;
  }
  if (solapan.length) solapesOtroTipo.push(`${e.id.slice(0, 8)} ${r.tipo.nombre} ${r.ini}→${r.fin} solapa parcialmente con otro tipo ya aprobado`);
  const fila = {
    cuenta_id: CUENTA_ID,
    empleado_id: e.id,
    tipo_id: r.tipo.id,
    tipo: enumTipo(r.tipo.nombre),
    fecha_inicio: r.ini,
    fecha_fin: r.fin,
    estado: "aprobada",
    centro_id: null,
    resuelta_en: ahora,
    solicitada_por: null,
    resuelta_por: null,
  };
  ausInsertar.push(fila);
  ausBD.push({ ...fila, id: null }); // para que un segundo rango del mismo fichero no se duplique
  porTipoNuevo.set(r.tipo.nombre, (porTipoNuevo.get(r.tipo.nombre) ?? 0) + 1);
}
console.log(`  rangos en fichero ${rangos.length} · ya existen ${ausIguales} · ampliar ${ausAmpliar.length} · retipar (misma ausencia con tipo grueso de agosto) ${ausRetipar.length} · insertar ${ausInsertar.length} · sin empleado ${ausSinEmpleado}`);
const retipos = new Map();
for (const a of ausRetipar) {
  const k = `${a.antes.replace(/ \d.*$/, "")} → ${a.despues.replace(/ \d.*$/, "")}`;
  retipos.set(k, (retipos.get(k) ?? 0) + 1);
}
if (retipos.size) console.log(`  retipados: ${[...retipos.entries()].map(([k, n]) => `${k} ×${n}`).join(" · ")}`);
console.log(`  nuevas por tipo: ${JSON.stringify(Object.fromEntries(porTipoNuevo))}`);
if (solapesOtroTipo.length) console.log(`  aviso: ${solapesOtroTipo.length} rangos nuevos solapan PARCIALMENTE con una ausencia aprobada de otro tipo (se insertan igualmente):\n    ${solapesOtroTipo.slice(0, 20).join("\n    ")}`);
for (const a of ausAmpliar.slice(0, 10)) console.log(`    ~ ampliar ${a.id.slice(0, 8)} ${a.antes} → ${a.fecha_inicio}→${a.fecha_fin}`);
if (!DRY) {
  // El trigger trg_rrhh_ausencias_derivar_tipo rechaza tipos no solicitables si quien escribe no es
  // gestor (con service key auth.uid() es null). Se abren temporalmente y se restauran al final.
  const tiposUsados = new Set([...ausInsertar, ...ausRetipar].map((a) => a.tipo_id));
  const abrir = tipos.filter((t) => tiposUsados.has(t.id) && !(t.solicitable_empleado && t.activo));
  try {
    for (const t of abrir) {
      const { error } = await sb.from("rrhh_tipos_ausencia").update({ solicitable_empleado: true, activo: true }).eq("id", t.id);
      if (error) throw new Error(`abrir tipo: ${error.message}`);
    }
    await insertarLotes("rrhh_ausencias", ausInsertar, "ausencias insertadas");
    for (const a of ausRetipar) {
      const { error } = await sb.from("rrhh_ausencias").update({ tipo_id: a.tipo_id, tipo: a.tipo, fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin }).eq("id", a.id);
      if (error) throw new Error(`retipar ausencia: ${error.message}`);
    }
    if (ausRetipar.length) console.log(`  ausencias retipadas ${ausRetipar.length}`);
  } finally {
    for (const t of abrir) {
      const { error } = await sb.from("rrhh_tipos_ausencia").update({ solicitable_empleado: t.solicitable_empleado, activo: t.activo }).eq("id", t.id);
      if (error) console.error(`!! no se pudo restaurar el tipo ${t.nombre}: ${error.message}`);
    }
  }
  for (const a of ausAmpliar) {
    const { error } = await sb.from("rrhh_ausencias").update({ fecha_inicio: a.fecha_inicio, fecha_fin: a.fecha_fin }).eq("id", a.id);
    if (error) throw new Error(`ampliar ausencia: ${error.message}`);
  }
  if (ausAmpliar.length) console.log(`  ausencias ampliadas ${ausAmpliar.length}`);
}

/* ================= 6. CONTADOR INICIAL ================= */

console.log(`\n6/7 Contador inicial (Skello «fin de periodo después de modificaciones» − semanas ≥ S${CONTADOR_SEMANAS + 1} planificadas → saldo a ${CONTADOR_FECHA})`);
const contadores = [];
let contadorSinFicha = 0;
let contadorConFuturo = 0;
const vistosContador = new Set();
for (const c of contadoresSkello) {
  const e = empDe(c.persona);
  if (!e || vistosContador.has(e.id)) continue;
  vistosContador.add(e.id);
  const semanas = semanasFicha.get(c.persona.clave);
  if (!semanas) contadorSinFicha++;
  let futuro = 0;
  for (const [w, x] of semanas ?? []) if (w > CONTADOR_SEMANAS && w <= 52 && x.contrato && x.total > 0) futuro += x.total - x.vol;
  if (futuro) contadorConFuturo++;
  contadores.push({ id: e.id, contador_inicial_h: r2(c.fin - futuro), contador_inicial_fecha: CONTADOR_FECHA, skello: c.fin, futuro: r2(futuro), modificaciones: c.modificaciones });
}
const sumaContadores = r2(contadores.reduce((a, c) => a + c.contador_inicial_h, 0));
const sumaSkello = r2(contadores.reduce((a, c) => a + c.skello, 0));
console.log(`  empleados con contador ${contadores.length} · Σ Skello ${sumaSkello} h · Σ cargado ${sumaContadores} h · con semanas futuras descontadas ${contadorConFuturo} · sin ficha semanal ${contadorSinFicha}`);
if (contadores.length) console.log(`  min ${Math.min(...contadores.map((c) => c.contador_inicial_h))} · max ${Math.max(...contadores.map((c) => c.contador_inicial_h))}`);
for (const c of [...contadores].sort((a, b) => Math.abs(b.contador_inicial_h) - Math.abs(a.contador_inicial_h)).slice(0, 5)) console.log(`    mayor |saldo|: ${c.id.slice(0, 8)} Skello ${c.skello} → ${c.contador_inicial_h} (modif. ${c.modificaciones})`);
for (const c of contadores.filter((c) => c.futuro).slice(0, 6)) console.log(`    ${c.id.slice(0, 8)} Skello ${c.skello} − futuro ${c.futuro} = ${c.contador_inicial_h} (modif. Skello ${c.modificaciones})`);
if (!DRY) {
  for (const c of contadores) {
    const { error } = await sb.from("empleados").update({ contador_inicial_h: c.contador_inicial_h, contador_inicial_fecha: c.contador_inicial_fecha }).eq("id", c.id);
    if (error) throw new Error(`contador: ${error.message}`);
  }
  console.log(`  contadores escritos ${contadores.length}`);
}

/* ================= 7. VACACIONES ================= */

console.log("\n7/7 Ajuste de vacaciones");
const tipoVac = tipoPorNombre.get("vacaciones");
const ajustes = [];
if (!tipoVac) console.log("  ! no existe el tipo Vacaciones");
else {
  // disfrutados aquí = días naturales de ausencias aprobadas de Vacaciones dentro del año
  const vacBD = await leerTodo("rrhh_ausencias", "empleado_id,fecha_inicio,fecha_fin", (q) => porCuenta(q).eq("estado", "aprobada").eq("tipo_id", tipoVac.id).lte("fecha_inicio", `${ANIO}-12-31`).gte("fecha_fin", `${ANIO}-01-01`));
  const vacPorEmp = new Map();
  const nuevasVac = DRY ? ausInsertar.filter((a) => a.tipo_id === tipoVac.id) : [];
  for (const a of [...vacBD, ...nuevasVac]) {
    const ini = a.fecha_inicio < `${ANIO}-01-01` ? `${ANIO}-01-01` : a.fecha_inicio;
    const fin = a.fecha_fin > `${ANIO}-12-31` ? `${ANIO}-12-31` : a.fecha_fin;
    vacPorEmp.set(a.empleado_id, (vacPorEmp.get(a.empleado_id) ?? 0) + diasEntre(ini, fin));
  }
  const vistosVac = new Set();
  for (const v of vacaciones) {
    const e = empDe(v.persona);
    if (!e || vistosVac.has(e.id)) continue;
    vistosVac.add(e.id);
    const nuestro = vacPorEmp.get(e.id) ?? 0;
    ajustes.push({ id: e.id, vacaciones_ajuste_dias: r2(v.disfrutados - nuestro), skello: v.disfrutados, nuestro });
  }
  const distintos = ajustes.filter((a) => a.vacaciones_ajuste_dias !== 0);
  console.log(`  empleados con saldo en Skello ${ajustes.length} · con ajuste ≠ 0: ${distintos.length}${DRY && ausInsertar.length ? " (dry-run: incluye las ausencias que se insertarían)" : ""}`);
  for (const a of distintos.slice(0, 10)) console.log(`    ${a.id.slice(0, 8)} Skello ${a.skello} · aquí ${a.nuestro} · ajuste ${a.vacaciones_ajuste_dias}`);
  const conDias = ajustes.filter((a) => a.nuestro > 0 || a.skello > 0);
  console.log(`  con días (Skello o aquí) ${conDias.length} · Σ Skello ${r2(conDias.reduce((x, a) => x + a.skello, 0))} · Σ aquí ${conDias.reduce((x, a) => x + a.nuestro, 0)}`);
  for (const a of conDias.slice(0, 5)) console.log(`    ${a.id.slice(0, 8)} Skello ${a.skello} · aquí ${a.nuestro}`);
  if (!DRY) {
    for (const a of ajustes) {
      const { error } = await sb.from("empleados").update({ vacaciones_ajuste_dias: a.vacaciones_ajuste_dias }).eq("id", a.id);
      if (error) throw new Error(`vacaciones: ${error.message}`);
    }
    console.log(`  ajustes escritos ${ajustes.length}`);
  }
}

/* ================= VERIFICACIÓN ================= */

console.log("\n=== Verificación ===");
if (avisos.length) {
  const resumen = new Map();
  for (const a of avisos) resumen.set(a, (resumen.get(a) ?? 0) + 1);
  console.log(`Avisos de lectura (${avisos.length}):`);
  for (const [a, n] of [...resumen.entries()].slice(0, 30)) console.log(`  ${a}${n > 1 ? ` ×${n}` : ""}`);
}
const despues = DRY ? antes : await counts();
console.log("Base antes :", antes);
console.log("Base después:", despues);
console.log(`Personas del fichero: ${personas.size} · casadas ${casados.size - (DRY ? 0 : creadas.length)} · creadas ${creadas.length} · solo en contratos (no creadas) ${soloContratos.length} · no casadas ${noCasadas.length}`);
if (creadas.length) console.log(`  creadas: ${creadas.map((c) => `${c.fila.nombre} ${c.fila.apellidos}`).join(" · ")}`);
if (noCasadas.length) console.log(`  no casadas: ${noCasadas.join(" · ")}`);

if (!DRY) {
  // Muestra 1: un empleado con turnos la semana del 28-09
  const lunes = "2026-09-28";
  const domingo = "2026-10-04";
  const { data: semana } = await sb.from("rrhh_turnos").select("empleado_id,fecha,hora_inicio,hora_fin,pausa_min,centro_id,puesto,estado").eq("cuenta_id", CUENTA_ID).gte("fecha", lunes).lte("fecha", domingo).order("empleado_id").order("fecha").limit(2000);
  const porEmp = new Map();
  for (const t of semana ?? []) porEmp.set(t.empleado_id, [...(porEmp.get(t.empleado_id) ?? []), t]);
  const muestraId = [...porEmp.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
  if (muestraId) {
    const e = empleados.find((x) => x.id === muestraId);
    const ts = porEmp.get(muestraId);
    console.log(`\nMuestra 1 · ${e?.nombre} ${e?.apellidos} (${muestraId.slice(0, 8)}) · turnos semana ${lunes}:`);
    for (const t of ts) console.log(`  ${t.fecha} ${t.hora_inicio.slice(0, 5)}–${t.hora_fin.slice(0, 5)} pausa ${t.pausa_min} · ${t.puesto ?? "-"} · ${t.estado}`);
    const planSemana = r2(ts.reduce((a, t) => a + horasTurno(t.hora_inicio, t.hora_fin, t.pausa_min), 0));
    const { data: emp } = await sb.from("empleados").select("contador_inicial_h,contador_inicial_fecha,horas_semana").eq("id", muestraId).single();
    const { data: resumen } = await sb.rpc("rrhh_resumen_semana", { p_centro_id: null, p_desde: lunes, p_hasta: domingo, p_empleado_id: muestraId });
    const { data: saldo } = await sb.rpc("rrhh_saldo_horas", { p_empleado_id: muestraId, p_hasta: new Date().toISOString().slice(0, 10) });
    const fila = (resumen ?? []).find((r) => r.empleado_id === muestraId) ?? resumen?.[0];
    console.log(`  contador_inicial ${emp?.contador_inicial_h} h a ${emp?.contador_inicial_fecha} · contrato ${emp?.horas_semana} h/sem · plan semana ${planSemana} h`);
    console.log(`  rrhh_resumen_semana(${lunes}): ${JSON.stringify(fila ?? resumen)}`);
    console.log(`  rrhh_saldo_horas(hoy) = ${saldo} · esperado ≈ contador_inicial + diferencia de la semana del 28-09 = ${r2(Number(emp?.contador_inicial_h ?? 0) + Number(fila?.diferencia ?? 0))}`);
  }
  // Muestra 2: una ausencia nueva
  const nueva = ausInsertar[0];
  if (nueva) {
    const { data } = await sb.from("rrhh_ausencias").select("id,empleado_id,tipo,tipo_id,fecha_inicio,fecha_fin,estado,resuelta_en").eq("empleado_id", nueva.empleado_id).eq("tipo_id", nueva.tipo_id).eq("fecha_inicio", nueva.fecha_inicio);
    const e = empleados.find((x) => x.id === nueva.empleado_id);
    console.log(`\nMuestra 2 · ausencia nueva de ${e?.nombre} ${e?.apellidos}: ${JSON.stringify(data)} (tipo ${tipos.find((t) => t.id === nueva.tipo_id)?.nombre})`);
  }
  // Muestra 3: horas_dia de un día cualquiera de la muestra 1
  if (muestraId) {
    const { data } = await sb.from("rrhh_horas_dia").select("fecha,centro_id,horas_plan,horas_retenidas,retraso_min,estado,nota").eq("empleado_id", muestraId).lte("fecha", HASTA_HORAS).order("fecha", { ascending: false }).limit(3);
    console.log(`\nMuestra 3 · últimas horas_dia validadas de la muestra 1: ${JSON.stringify(data)}`);
  }
  const futurosBD = await contar("rrhh_turnos", (q) => porCuenta(q).gt("fecha", HASTA_HORAS));
  console.log(`\nselect count(*) from rrhh_turnos where fecha > '${HASTA_HORAS}' → ${futurosBD}`);
}
console.log(DRY ? "\nDRY-RUN: no se ha escrito nada." : "\nCarga terminada.");
