// Utilidades PURAS del módulo Pedidos, compartidas por servidor y cliente (sin directiva, sin
// imports de Next ni de Supabase). Fechas siempre en Europe/Madrid. Probadas a mano el 04-10-2026
// (casos en docs/pedidos-contratos.md §6).
import {
  ESTADOS_COTEJO_PEDIDO,
  ESTADOS_PEDIDO,
  CANALES_PEDIDO,
  ROLES_GESTION,
  SIN_PROVEEDOR,
} from "./tipos";
import type {
  CampoCatalogo,
  CanalPedido,
  CotejoDetalle,
  DatosTextoPedido,
  EstadoCotejoPedido,
  EstadoPedido,
  FilaCatalogo,
  FilaProveedor,
  GrupoGuardar,
  GrupoRevision,
  InterpretacionCruda,
  LineaGuardar,
  LineaInterpretada,
  LineaRevision,
  MapeoColumnas,
  MetaGrupo,
  ProductoCatalogo,
  ProveedorPedido,
  RevisionAgrupada,
} from "./tipos";

/* ═══════════════════════ Preferencias del navegador ═══════════════════════ */

const PREFIJO = "ped:";

/** Lee una preferencia de localStorage (con try/catch: modo privado, sin almacenamiento, servidor). */
export function leerPref<T = string>(clave: string, def: T): T {
  try {
    if (typeof window === "undefined") return def;
    const v = window.localStorage.getItem(PREFIJO + clave);
    if (v == null) return def;
    try {
      return JSON.parse(v) as T;
    } catch {
      return v as unknown as T;
    }
  } catch {
    return def;
  }
}

export function guardarPref(clave: string, valor: unknown): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
  } catch {
    /* sin localStorage: no pasa nada */
  }
}

/* ═══════════════════════ Validación y normalización ═══════════════════════ */

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (v: unknown): v is string => typeof v === "string" && RE_UUID.test(v);

/** YYYY-MM-DD y fecha real (no 2026-02-30). */
export function esFechaISO(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/** Antes de la @ solo letras ASCII, números y . _ % + - (nada de ? & = # / que colarían
    parámetros en un mailto:); el dominio, letras (también con acento), números, puntos y guiones. */
const RE_EMAIL = /^[A-Za-z0-9._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}$/u;
export const esEmail = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 254 && RE_EMAIL.test(v.trim());

/** Texto recortado, espacios simples, máx. `max` caracteres; vacío o no texto → null. */
export function limpiarTexto(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

/** Igual que limpiarTexto pero conserva los saltos de línea (notas, transcripción). */
export function limpiarTextoLargo(v: unknown, max = 4000): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return t ? t.slice(0, max) : null;
}

export const puedeGestionar = (rol: string | null | undefined): boolean =>
  !!rol && (ROLES_GESTION as readonly string[]).includes(rol);

const ACENTOS_DE = "áàäâãéèëêíìïîóòöôõúùüûñç";
const ACENTOS_A = "aaaaaeeeeiiiiooooouuuunc";

/** Espejo de pedidos_norm() de la base: minúsculas, sin acentos («l·l» → «ll»), sin signos,
    espacios simples. Vacío → null. */
export function normalizarTexto(t: string | null | undefined): string | null {
  let s = (t ?? "").toLowerCase();
  let out = "";
  for (const ch of s) {
    if (ch === "·") continue;
    const i = ACENTOS_DE.indexOf(ch);
    out += i >= 0 ? ACENTOS_A[i] : ch;
  }
  s = out.replace(/[^a-z0-9]+/g, " ").trim();
  return s || null;
}

const UNIDAD_SINONIMOS: [string, string[]][] = [
  ["unidad", ["u", "ud", "uds", "un", "und", "unidad", "unidades", "unitat", "unitats", "pieza", "piezas", "pza", "pzas", "peca", "peces"]],
  ["kg", ["kg", "kgs", "kilo", "kilos", "quilo", "quilos", "kilogramo", "kilogramos", "quilogram", "quilograms"]],
  ["g", ["g", "gr", "grs", "gramo", "gramos", "gram", "grams"]],
  ["litro", ["l", "lt", "lts", "litro", "litros", "litre", "litres"]],
  ["caja", ["caja", "cajas", "caixa", "caixes", "cj", "cja", "cjs"]],
  ["paquete", ["paquete", "paquetes", "paq", "pack", "packs", "paquet", "paquets"]],
  ["docena", ["docena", "docenas", "dotzena", "dotzenes", "dz", "doc"]],
  ["saco", ["saco", "sacos", "sac", "sacs"]],
  ["garrafa", ["garrafa", "garrafas", "garrafes"]],
  ["botella", ["botella", "botellas", "ampolla", "ampolles", "bot"]],
  ["bandeja", ["bandeja", "bandejas", "safata", "safates"]],
  ["lata", ["lata", "latas", "llauna", "llaunes"]],
  ["barril", ["barril", "barriles", "barrils"]],
];
const UNIDAD_MAPA = new Map<string, string>(UNIDAD_SINONIMOS.flatMap(([c, l]) => l.map((s) => [s, c] as [string, string])));

/** Espejo de pedidos_unidad_norm(): unidad canónica (castellano/catalán, plurales, abreviaturas).
    Lo desconocido vuelve normalizado tal cual; vacío → null. */
export function normalizarUnidad(t: string | null | undefined): string | null {
  const x = normalizarTexto(t);
  if (!x) return null;
  return UNIDAD_MAPA.get(x) ?? x;
}

const PLURAL: Record<string, string> = {
  unidad: "unidades",
  caja: "cajas",
  paquete: "paquetes",
  docena: "docenas",
  saco: "sacos",
  garrafa: "garrafas",
  botella: "botellas",
  bandeja: "bandejas",
  lata: "latas",
  barril: "barriles",
  litro: "litros",
};

/** Nombre de la unidad para pintar, en singular (n = 1) o plural. kg y g no cambian. */
export function nombreUnidad(unidad: string | null | undefined, n = 1): string {
  const canon = normalizarUnidad(unidad);
  if (!canon) return "";
  const conocida = UNIDAD_MAPA.has(canon) || canon in PLURAL;
  const base = conocida ? canon : (unidad ?? "").trim();
  if (n === 1 || !conocida) return base;
  return PLURAL[canon] ?? base;
}

/** WhatsApp para wa.me: solo dígitos, sin «+» ni «00»; 9 dígitos españoles → prefijo 34. */
export function normalizarWhatsApp(v: string | null | undefined): string | null {
  let d = (v ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^[6789]\d{8}$/.test(d)) d = "34" + d;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** "HH:MM" desde un time de Postgres ("07:30:00") o lo que escriba el usuario ("7:30"); inválido → "". */
export function horaCorta(t: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec((t ?? "").trim());
  if (!m) return "";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return "";
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export const esEstadoPedido = (v: unknown): v is EstadoPedido =>
  typeof v === "string" && (ESTADOS_PEDIDO as readonly string[]).includes(v);
export const esCanalPedido = (v: unknown): v is CanalPedido =>
  typeof v === "string" && (CANALES_PEDIDO as readonly string[]).includes(v);
export const comoEstadoCotejo = (v: unknown): EstadoCotejoPedido =>
  typeof v === "string" && (ESTADOS_COTEJO_PEDIDO as readonly string[]).includes(v) ? (v as EstadoCotejoPedido) : "pendiente";

/* ═══════════════════════ Fechas (Europe/Madrid) ═══════════════════════ */

let fmtMadrid: Intl.DateTimeFormat | null = null;

/** Fecha, hora y día ISO de un instante en Madrid. */
export function ahoraMadrid(d: Date = new Date()): { fecha: string; hora: string; isoDia: number } {
  fmtMadrid ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const x of fmtMadrid.formatToParts(d)) p[x.type] = x.value;
  const fecha = `${p.year}-${p.month}-${p.day}`;
  return { fecha, hora: `${p.hour}:${p.minute}`, isoDia: isoDiaSemana(fecha) };
}

export const hoyMadrid = (d: Date = new Date()): string => ahoraMadrid(d).fecha;

/** Suma días a una fecha YYYY-MM-DD (sin husos: aritmética de calendario). */
export function sumarDias(fecha: string, n: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 1 = lunes … 7 = domingo. */
export function isoDiaSemana(fecha: string): number {
  const [y, m, d] = fecha.split("-").map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** Instante (ISO UTC) de una fecha y hora de Madrid: para filtrar timestamptz por día
    («creado_en >= instanteMadrid(desde)», «< instanteMadrid(sumarDias(hasta, 1))»). */
export function instanteMadrid(fecha: string, hora = "00:00"): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const [h, mi] = (horaCorta(hora) || "00:00").split(":").map(Number);
  const base = Date.UTC(y, m - 1, d, h, mi);
  const local = ahoraMadrid(new Date(base));
  const [ly, lm, ld] = local.fecha.split("-").map(Number);
  const [lh, lmi] = local.hora.split(":").map(Number);
  const desfase = Date.UTC(ly, lm - 1, ld, lh, lmi) - base;
  return new Date(base - desfase).toISOString();
}

/** Días entre dos fechas YYYY-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/**
 * Siguiente día de reparto para un pedido hecho AHORA:
 *  - lo más pronto es mañana; si ya pasó la hora de corte (Madrid), pasado mañana;
 *  - desde ahí, el primer día que esté en `dias` (ISO 1-7); sin días = ese mismo.
 */
export function siguienteDiaReparto(o: {
  dias: number[] | null | undefined;
  horaCorte: string | null | undefined;
  ahora?: Date;
}): string {
  const { fecha, hora } = ahoraMadrid(o.ahora);
  const corte = horaCorta(o.horaCorte);
  const desde = sumarDias(fecha, corte && hora >= corte ? 2 : 1);
  const dias = (o.dias ?? []).filter((x) => Number.isInteger(x) && x >= 1 && x <= 7);
  if (!dias.length) return desde;
  for (let i = 0; i < 7; i++) {
    const f = sumarDias(desde, i);
    if (dias.includes(isoDiaSemana(f))) return f;
  }
  return desde;
}

/** Fecha de entrega por defecto para un proveedor (null → mañana). */
export const fechaEntregaPorDefecto = (p: ProveedorPedido | null | undefined, ahora?: Date): string =>
  siguienteDiaReparto({ dias: p?.pedido_dias_reparto, horaCorte: p?.pedido_hora_corte, ahora });

export const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"] as const;
export const DIAS_LARGOS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "mar 7 oct" (o "—"). */
export function formatoFecha(fecha: string | null | undefined): string {
  if (!fecha || !esFechaISO(fecha.slice(0, 10))) return "—";
  const f = fecha.slice(0, 10);
  const [, m, d] = f.split("-").map(Number);
  return `${DIAS_CORTOS[isoDiaSemana(f) - 1]} ${d} ${MESES_CORTOS[m - 1]}`;
}

/** "martes 7 de octubre" (o ""). */
export function formatoFechaLarga(fecha: string | null | undefined): string {
  if (!fecha || !esFechaISO(fecha.slice(0, 10))) return "";
  const f = fecha.slice(0, 10);
  const [, m, d] = f.split("-").map(Number);
  return `${DIAS_LARGOS[isoDiaSemana(f) - 1]} ${d} de ${MESES[m - 1]}`;
}

/** "Hoy", "Mañana" o formatoFecha (para la fecha de entrega). */
export function formatoFechaRelativa(fecha: string | null | undefined, hoy: string): string {
  if (!fecha) return "Sin fecha";
  const n = diasEntre(hoy, fecha.slice(0, 10));
  if (n === 0) return "Hoy";
  if (n === 1) return "Mañana";
  return formatoFecha(fecha);
}

/** "12:05" o "7 oct 12:05" de un timestamptz, en hora de Madrid. */
export function formatoMomento(ts: string | null | undefined, hoy?: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const { fecha, hora } = ahoraMadrid(d);
  if (hoy && fecha === hoy) return hora;
  const [, m, dd] = fecha.split("-").map(Number);
  return `${dd} ${MESES_CORTOS[m - 1]} ${hora}`;
}

/** "lun, mié, vie" · "Todos los días" · "Cualquier día" (sin datos). */
export function textoDiasReparto(dias: number[] | null | undefined): string {
  const v = [...new Set((dias ?? []).filter((x) => Number.isInteger(x) && x >= 1 && x <= 7))].sort((a, b) => a - b);
  if (!v.length) return "Cualquier día";
  if (v.length === 7) return "Todos los días";
  return v.map((x) => DIAS_CORTOS[x - 1]).join(", ");
}

/* ═══════════════════════ Números y cantidades ═══════════════════════ */

export const redondear = (n: number, dec = 3): number => {
  const f = 10 ** dec;
  return Math.round((n + Number.EPSILON) * f) / f;
};

let fmtNum: Intl.NumberFormat | null = null;
let fmtEur: Intl.NumberFormat | null = null;

/** "0,5" · "2" · "1,25" (máx. 3 decimales, coma decimal). */
export function formatoNumero(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  fmtNum ??= new Intl.NumberFormat("es-ES", { maximumFractionDigits: 3 });
  return fmtNum.format(n);
}

/** "2 cajas" · "0,5 cajas" · "1 kg" · "3" (sin unidad). Singular solo si n = 1. */
export function formatoCantidad(n: number, unidad: string | null | undefined): string {
  const u = nombreUnidad(unidad, n);
  return u ? `${formatoNumero(n)} ${u}` : formatoNumero(n);
}

/** "12,50 €" o "—". */
export function formatoEuros(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  fmtEur ??= new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
  return fmtEur.format(n);
}

/**
 * Número de una celda de catálogo: acepta number o texto con «€», espacios, coma o punto decimal
 * («12,50», «1.234,56», «1,234.56», «0.125»). Con solo puntos, «1.234» (grupos de 3 sin cero
 * delante) se lee como miles. Inválido → null.
 */
export function parsearNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[\s €]/g, "").replace(/eur(os)?$/i, "");
  s = s.replace(/[^0-9.,-]/g, "");
  if (!s || !/\d/.test(s)) return null;
  const p = s.lastIndexOf(".");
  const c = s.lastIndexOf(",");
  if (p >= 0 && c >= 0) {
    s = c > p ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (c >= 0) {
    s = (s.match(/,/g) ?? []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (p >= 0 && /^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Confianza de la IA en tres niveles para el chip. null = puesta a mano. */
export function nivelConfianza(c: number | null | undefined): "alta" | "media" | "baja" | null {
  if (c == null) return null;
  if (c >= 0.85) return "alta";
  if (c >= 0.6) return "media";
  return "baja";
}

/* ═══════════════════════ Líneas: revisión, fusión, guardado ═══════════════════════ */

let contadorClave = 0;
/** Clave local única para una línea en revisión (no es un id de la base). */
export function nuevaClave(): string {
  contadorClave += 1;
  return `l${Date.now().toString(36)}${contadorClave.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Precio de referencia de un producto: último de compra y, si no, el de catálogo. */
export const precioReferencia = (p: Pick<ProductoCatalogo, "ultimo_precio" | "precio_catalogo"> | null | undefined): number | null =>
  p ? (p.ultimo_precio ?? p.precio_catalogo ?? null) : null;

type Fusionable = { cantidad: number; unidad: string | null; nota: string | null; texto_original: string | null };

const unirTextos = (a: string | null, b: string | null, sep: string): string | null => {
  const partes = [...new Set([a, b].flatMap((x) => (x ?? "").split(sep)).map((x) => x.trim()).filter(Boolean))];
  return partes.length ? partes.join(sep) : null;
};

/**
 * Fusiona líneas del MISMO producto y unidad (normalizada): suma cantidades (3 decimales), une
 * notas («·») y textos originales («+»). Conserva la posición y el resto de campos de la primera.
 * Las líneas sin producto no se fusionan. Devuelve objetos nuevos.
 */
export function fusionarLineas<T extends Fusionable>(lineas: T[], idProducto: (l: T) => string | null): T[] {
  const out: T[] = [];
  const indice = new Map<string, number>();
  for (const l of lineas) {
    const id = idProducto(l);
    if (!id) {
      out.push({ ...l });
      continue;
    }
    const k = `${id}|${normalizarUnidad(l.unidad) ?? ""}`;
    const i = indice.get(k);
    if (i === undefined) {
      indice.set(k, out.length);
      out.push({ ...l });
    } else {
      const a = out[i];
      out[i] = {
        ...a,
        cantidad: redondear(a.cantidad + l.cantidad),
        nota: unirTextos(a.nota, l.nota, " · "),
        texto_original: unirTextos(a.texto_original, l.texto_original, " + "),
      };
    }
  }
  return out;
}

export const fusionarLineasRevision = (l: LineaRevision[]): LineaRevision[] =>
  fusionarLineas(l, (x) => x.producto?.producto_id ?? null);
export const fusionarLineasGuardar = (l: LineaGuardar[]): LineaGuardar[] => fusionarLineas(l, (x) => x.producto_id);

/** Línea de revisión desde la IA. Sin producto: la descripción es la de la IA o el texto dicho. */
export function lineaDesdeInterpretada(l: LineaInterpretada): LineaRevision {
  return {
    clave: nuevaClave(),
    producto: l.producto,
    alternativas: l.alternativas.slice(0, 3),
    proveedor_id: l.producto?.proveedor_id ?? l.proveedor_id,
    texto_original: l.texto_original || null,
    descripcion: l.producto ? null : (l.descripcion ?? l.texto_original ?? null),
    cantidad: l.cantidad > 0 ? l.cantidad : 1,
    unidad: l.unidad ?? l.producto?.unidad ?? null,
    precio_estimado: precioReferencia(l.producto),
    confianza: l.confianza,
    nota: l.nota,
    ia_producto_id: l.producto?.producto_id ?? null,
    ia_unidad: l.unidad,
  };
}

/** Línea de revisión puesta a mano (catálogo o buscador). Unidad: la del producto. */
export function lineaDesdeProducto(p: ProductoCatalogo, cantidad = 1, unidad?: string | null): LineaRevision {
  return {
    clave: nuevaClave(),
    producto: p,
    alternativas: [],
    proveedor_id: p.proveedor_id,
    texto_original: null,
    descripcion: null,
    cantidad: cantidad > 0 ? cantidad : 1,
    unidad: unidad ?? p.unidad ?? null,
    precio_estimado: precioReferencia(p),
    confianza: null,
    nota: null,
    ia_producto_id: null,
    ia_unidad: null,
  };
}

/** Cambia el producto de una línea (alternativa o buscador). Conserva cantidad, unidad si la
    había, nota, texto original y lo que propuso la IA (para aprender). */
export function cambiarProductoLinea(l: LineaRevision, p: ProductoCatalogo): LineaRevision {
  return {
    ...l,
    producto: p,
    alternativas: l.alternativas.filter((a) => a.producto_id !== p.producto_id),
    proveedor_id: p.proveedor_id,
    descripcion: null,
    unidad: l.unidad ?? p.unidad ?? null,
    precio_estimado: precioReferencia(p),
  };
}

export function lineaAGuardar(l: LineaRevision): LineaGuardar {
  return {
    producto_id: l.producto?.producto_id ?? null,
    texto_original: l.texto_original,
    descripcion: l.producto ? null : (l.descripcion ?? l.texto_original),
    cantidad: l.cantidad,
    unidad: l.unidad,
    precio_estimado: l.precio_estimado,
    confianza: l.confianza,
    nota: l.nota,
    ia_producto_id: l.ia_producto_id,
    ia_unidad: l.ia_unidad,
  };
}

/** Σ cantidad × precio de las líneas con precio (2 decimales); null si ninguna tiene precio. */
export function totalEstimado(lineas: { cantidad: number; precio_estimado: number | null }[]): number | null {
  let hay = false;
  let t = 0;
  for (const l of lineas) {
    if (l.precio_estimado == null || !Number.isFinite(l.precio_estimado)) continue;
    hay = true;
    t += l.cantidad * l.precio_estimado;
  }
  return hay ? redondear(t, 2) : null;
}

/** Pedido mínimo del proveedor frente a un total (null si el proveedor no tiene mínimo). */
export function estadoMinimo(
  p: Pick<ProveedorPedido, "pedido_minimo"> | null | undefined,
  total: number | null,
): { minimo: number; total: number | null; cumple: boolean } | null {
  if (!p?.pedido_minimo) return null;
  return { minimo: p.pedido_minimo, total, cumple: total != null && total >= p.pedido_minimo };
}

/** Agrupa para pintar la revisión: sin identificar arriba; luego por proveedor (nombre). */
export function agruparRevision(lineas: LineaRevision[], proveedores: ProveedorPedido[]): RevisionAgrupada {
  const porId = new Map(proveedores.map((p) => [p.id, p]));
  const sin_identificar: LineaRevision[] = [];
  const grupos = new Map<string, GrupoRevision>();
  for (const l of lineas) {
    if (!l.producto) {
      sin_identificar.push(l);
      continue;
    }
    const clave = l.proveedor_id ?? SIN_PROVEEDOR;
    let g = grupos.get(clave);
    if (!g) {
      g = { clave, proveedor: porId.get(clave) ?? null, lineas: [], total: null };
      grupos.set(clave, g);
    }
    g.lineas.push(l);
  }
  const lista = [...grupos.values()];
  for (const g of lista) g.total = totalEstimado(g.lineas);
  lista.sort((a, b) => (a.proveedor?.nombre ?? "~").localeCompare(b.proveedor?.nombre ?? "~", "es"));
  return { sin_identificar, grupos: lista };
}

/** Fecha y notas de un grupo que aún no tiene meta: la fecha que dijo el empleado o, si no, el
    siguiente día de reparto del proveedor (sin proveedor: la dicha o null); notas, las que dijo
    el empleado en el dictado («que venga antes de las diez») o vacías. */
export function metaPorDefecto(
  p: ProveedorPedido | null | undefined,
  fechaDicha?: string | null,
  ahora?: Date,
  notasDichas?: string | null,
): MetaGrupo {
  return { fecha_entrega: fechaDicha ?? (p ? fechaEntregaPorDefecto(p, ahora) : null), notas: notasDichas ?? "" };
}

/** Grupos que se mandan a guardarBorradores: por proveedor_id (null aparte), líneas fusionadas,
    fecha y notas de `meta` (clave = proveedor_id o SIN_PROVEEDOR). Un grupo SIN meta toma
    metaPorDefecto (si el usuario borró la fecha, la meta existe con null y se respeta). */
export function gruposParaGuardar(
  lineas: LineaRevision[],
  meta: Record<string, MetaGrupo>,
  opciones?: { proveedores?: ProveedorPedido[]; fechaDicha?: string | null; notasDichas?: string | null; ahora?: Date },
): GrupoGuardar[] {
  const porId = new Map((opciones?.proveedores ?? []).map((p) => [p.id, p]));
  const orden: string[] = [];
  const porClave = new Map<string, LineaGuardar[]>();
  for (const l of lineas) {
    const k = l.proveedor_id ?? SIN_PROVEEDOR;
    if (!porClave.has(k)) {
      porClave.set(k, []);
      orden.push(k);
    }
    porClave.get(k)!.push(lineaAGuardar(l));
  }
  return orden.map((k) => {
    const m = Object.prototype.hasOwnProperty.call(meta, k)
      ? meta[k]
      : metaPorDefecto(porId.get(k) ?? null, opciones?.fechaDicha, opciones?.ahora, opciones?.notasDichas);
    return {
      proveedor_id: k === SIN_PROVEEDOR ? null : k,
      fecha_entrega: m.fecha_entrega,
      notas: limpiarTextoLargo(m.notas, 1000),
      lineas: fusionarLineasGuardar(porClave.get(k)!),
    };
  });
}

/* ═══════════════════════ Lectura defensiva de jsonb ═══════════════════════ */

/** compras_pedido.cotejo_detalle / salida de pedidos_cotejar → CotejoDetalle (o null si no es v1). */
export function comoCotejo(j: unknown): CotejoDetalle | null {
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (o.version !== 1 || !o.resumen || typeof o.resumen !== "object") return null;
  return o as unknown as CotejoDetalle;
}

/** compras_pedido.interpretacion → InterpretacionCruda (o null). */
export function comoInterpretacion(j: unknown): InterpretacionCruda | null {
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.lineas)) return null;
  return o as unknown as InterpretacionCruda;
}

type FilaProveedorPedido = Pick<
  FilaProveedor,
  | "id"
  | "nombre"
  | "pedido_canal"
  | "pedido_email"
  | "pedido_whatsapp"
  | "pedido_telefono"
  | "pedido_minimo"
  | "pedido_dias_reparto"
  | "pedido_hora_corte"
  | "pedido_notas"
  | "albaranes_por_email"
  | "catalogo_actualizado_en"
  | "pedible"
>;

/** Fila de compras_proveedor (leída con SELECT_PROVEEDOR) → ProveedorPedido. */
export function comoProveedor(f: FilaProveedorPedido): ProveedorPedido {
  return {
    id: f.id,
    nombre: f.nombre,
    pedido_canal: esCanalPedido(f.pedido_canal) ? f.pedido_canal : "email",
    pedido_email: f.pedido_email,
    pedido_whatsapp: f.pedido_whatsapp,
    pedido_telefono: f.pedido_telefono,
    pedido_minimo: f.pedido_minimo,
    pedido_dias_reparto: (f.pedido_dias_reparto ?? []).filter((x) => Number.isInteger(x) && x >= 1 && x <= 7),
    pedido_hora_corte: f.pedido_hora_corte,
    pedido_notas: f.pedido_notas,
    albaranes_por_email: f.albaranes_por_email,
    catalogo_actualizado_en: f.catalogo_actualizado_en,
    pedible: f.pedible,
  };
}

/* ═══════════════════════ Texto del pedido (email / WhatsApp) ═══════════════════════ */

export function escaparHtml(s: string | null | undefined): string {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function asuntoPedido(d: Pick<DatosTextoPedido, "numero" | "cuenta_nombre" | "centro_nombre" | "fecha_entrega">): string {
  const entrega = d.fecha_entrega ? ` · entrega ${formatoFecha(d.fecha_entrega)}` : "";
  return `Pedido ${d.numero} · ${d.cuenta_nombre} · ${d.centro_nombre}${entrega}`;
}

const pieAlbaran = (buzon: string | null) =>
  buzon ? `Por favor, envíen el albarán en PDF a ${buzon}.` : null;

const firma = (c: DatosTextoPedido["contacto"]) =>
  [c.nombre, c.telefono, c.correo].filter((x): x is string => !!x && !!x.trim()).join(" · ");

/** Texto plano del pedido (WhatsApp, mailto, copiar). */
export function textoPedido(d: DatosTextoPedido): string {
  const r: string[] = [];
  r.push(`Hola, somos ${d.cuenta_nombre} (${d.centro_nombre}).`);
  r.push(`Pedido ${d.numero}${d.fecha_entrega ? ` · entrega el ${formatoFechaLarga(d.fecha_entrega)}` : ""}`);
  r.push("");
  for (const l of d.lineas) {
    const ref = l.ref ? ` [${l.ref}]` : "";
    const nota = l.nota ? ` (${l.nota})` : "";
    r.push(`• ${formatoCantidad(l.cantidad, l.unidad)} — ${l.nombre}${ref}${nota}`);
  }
  if (d.notas) {
    r.push("");
    r.push(`Notas: ${d.notas}`);
  }
  r.push("");
  if (d.centro_direccion) r.push(`Entregar en: ${d.centro_direccion}`);
  const pie = pieAlbaran(d.buzon_albaranes);
  if (pie) r.push(pie);
  r.push("Gracias.");
  const f = firma(d.contacto);
  if (f) r.push(f);
  return r.join("\n");
}

/** HTML del email del pedido: tabla con código del proveedor, producto, cantidad y nota. */
export function htmlPedido(d: DatosTextoPedido): string {
  const e = escaparHtml;
  const td = "padding:8px 10px;border-bottom:1px solid #DDE2DF;vertical-align:top;";
  const th = "padding:8px 10px;border-bottom:2px solid #22282B;text-align:left;font-size:12px;color:#5F6B65;";
  const filas = d.lineas
    .map(
      (l) =>
        `<tr><td style="${td}font-family:monospace;">${e(l.ref ?? "")}</td><td style="${td}">${e(l.nombre)}</td>` +
        `<td style="${td}text-align:right;white-space:nowrap;"><b>${e(formatoNumero(l.cantidad))}</b></td>` +
        `<td style="${td}">${e(nombreUnidad(l.unidad, l.cantidad))}</td><td style="${td}color:#5F6B65;">${e(l.nota ?? "")}</td></tr>`,
    )
    .join("");
  const pie = pieAlbaran(d.buzon_albaranes);
  const f = firma(d.contacto);
  return [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1B2420;max-width:680px;">`,
    `<p>Hola, somos <b>${e(d.cuenta_nombre)}</b> (${e(d.centro_nombre)}).</p>`,
    `<p style="font-size:16px;"><b>Pedido ${e(d.numero)}</b>${d.fecha_entrega ? ` · entrega el <b>${e(formatoFechaLarga(d.fecha_entrega))}</b>` : ""}</p>`,
    `<table style="border-collapse:collapse;width:100%;"><thead><tr>`,
    `<th style="${th}">Código</th><th style="${th}">Producto</th><th style="${th}text-align:right;">Cantidad</th><th style="${th}">Unidad</th><th style="${th}">Nota</th>`,
    `</tr></thead><tbody>${filas}</tbody></table>`,
    d.notas ? `<p><b>Notas:</b> ${e(d.notas).replace(/\n/g, "<br>")}</p>` : "",
    d.centro_direccion ? `<p><b>Entregar en:</b> ${e(d.centro_direccion)}</p>` : "",
    pie ? `<p style="background:#F0F2F1;padding:10px 12px;border-radius:6px;">${e(pie)}</p>` : "",
    `<p>Gracias.</p>`,
    f ? `<p style="color:#5F6B65;">${e(f)}</p>` : "",
    `</div>`,
  ].join("");
}

/** Petición estándar al proveedor: catálogo con códigos (Excel/CSV) y albaranes en PDF por email.
    Con `confirmar_destino` añade un tercer punto: que confirmen a qué email o WhatsApp mandar los
    pedidos (`actual`: adónde se mandan hoy, ya escrito, p. ej. «pedidos@x.com» o «el WhatsApp +34…»).
    Sin él, el texto es el de siempre (dos puntos). */
export function peticionProveedor(d: {
  cuenta_nombre: string;
  proveedor_nombre: string;
  buzon_albaranes: string | null;
  contacto: DatosTextoPedido["contacto"];
  confirmar_destino?: { actual: string | null };
}): { asunto: string; texto: string; html: string } {
  const asunto = `Catálogo de productos y albaranes por email · ${d.cuenta_nombre}`;
  const destinoAlbaran = d.buzon_albaranes
    ? `a ${d.buzon_albaranes}`
    : "respondiendo a este correo";
  const tercero = d.confirmar_destino
    ? `3. Que nos confirmen a qué email o número de WhatsApp debemos enviarles los pedidos${
        d.confirmar_destino.actual ? ` (ahora los enviamos a ${d.confirmar_destino.actual})` : ""
      }.`
    : null;
  const parrafos = [
    `Hola, equipo de ${d.proveedor_nombre}:`,
    `Somos ${d.cuenta_nombre}. Estamos ordenando nuestros pedidos y, para hacerlo más fácil a las dos partes, les pedimos ${tercero ? "tres" : "dos"} cosas:`,
    `1. Su catálogo completo en Excel o CSV, con el código de cada artículo, la descripción, el formato (por ejemplo «caja 20 u»), la unidad de venta y el precio sin IVA. Cuando cambie la tarifa, nos basta con recibir el archivo nuevo.`,
    `2. Que nos envíen cada albarán en PDF ${destinoAlbaran}, el mismo día de la entrega.`,
    ...(tercero ? [tercero] : []),
    `En los pedidos usaremos sus códigos de artículo, así que conviene que el albarán los traiga igual.`,
    `Muchas gracias.`,
  ];
  const f = firma(d.contacto);
  if (f) parrafos.push(f);
  const texto = parrafos.join("\n\n");
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1B2420;max-width:680px;">` +
    parrafos.map((p) => `<p>${escaparHtml(p)}</p>`).join("") +
    `</div>`;
  return { asunto, texto, html };
}

/** https://wa.me/<número>?text=… (sin número: el usuario elige el chat). */
export function enlaceWhatsApp(numero: string | null | undefined, texto: string): string {
  const n = normalizarWhatsApp(numero);
  return `https://wa.me/${n ?? ""}?text=${encodeURIComponent(texto)}`;
}

/** mailto: con asunto y cuerpo. OJO: algunos clientes cortan cuerpos de más de ~1.800 caracteres. */
export function enlaceMailto(para: string | null | undefined, asunto: string, texto: string): string {
  // La dirección también va codificada (la @ se deja tal cual): nada de lo que traiga puede
  // abrir otros campos del mailto (bcc, cc…).
  const a = esEmail(para) ? encodeURIComponent(para.trim()).replace(/%40/g, "@") : "";
  return `mailto:${a}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(texto)}`;
}

export function enlaceTelefono(tel: string | null | undefined): string | null {
  const t = (tel ?? "").replace(/[^\d+]/g, "");
  return t.length >= 6 ? `tel:${t}` : null;
}

/* ═══════════════════════ Importación de catálogo ═══════════════════════ */

/** Patrones por campo, en orden de prioridad (una columna va al primer campo que case). Se
    aplican sobre la cabecera normalizada (normalizarTexto). */
const PATRONES_COLUMNA: [CampoCatalogo, RegExp][] = [
  ["codigo_barras", /\b(ean\d*|gtin\d*|upc|barras|barres)\b/],
  [
    "unidades_formato",
    /\b(uds?|unid|unidades|unitats|u)\s*(x|por|per)?\s*(caja|caixa|bulto|pack|formato|envase|paquete)\b|\buxc\b|\bunidades por\b|\bcantidad por\b/,
  ],
  ["ref", /\b(cod|codigo|codi|ref|referencia|sku)\b|^id\b/],
  ["precio", /\b(precio|preu|pvp|tarifa|importe|coste|neto|eur|euros)\b/],
  ["formato", /\b(formato|format|presentacion|envase|embalaje|bulto)\b/],
  ["unidad", /\b(unidad|unitat|ud|um|medida|venta)\b/],
  ["categoria", /\b(categoria|familia|subfamilia|seccion|seccio|grupo|tipo)\b/],
  ["nombre", /\b(descripcion|descripcio|nombre|nom|articulo|article|producto|producte|denominacion|concepto|detalle)\b/],
];

export const mapeoVacio = (): MapeoColumnas => ({
  ref: null,
  nombre: null,
  formato: null,
  unidad: null,
  unidades_formato: null,
  precio: null,
  codigo_barras: null,
  categoria: null,
});

/** Propone qué columna es cada campo a partir de las cabeceras (el usuario lo confirma). */
export function detectarColumnas(cabeceras: unknown[]): MapeoColumnas {
  const m = mapeoVacio();
  cabeceras.forEach((c, i) => {
    const h = normalizarTexto(c == null ? "" : String(c));
    if (!h) return;
    for (const [campo, re] of PATRONES_COLUMNA) {
      if (m[campo] === null && re.test(h)) {
        m[campo] = i;
        return;
      }
    }
  });
  return m;
}

/** Fila de cabecera (0-based) dentro de las 20 primeras: la primera con ≥ 2 campos reconocidos
    y nombre o código. Si no hay ninguna, 0. */
export function detectarFilaCabecera(tabla: unknown[][]): number {
  const n = Math.min(tabla.length, 20);
  for (let i = 0; i < n; i++) {
    const m = detectarColumnas(tabla[i] ?? []);
    const reconocidos = Object.values(m).filter((x) => x !== null).length;
    if (reconocidos >= 2 && (m.nombre !== null || m.ref !== null)) return i;
  }
  return 0;
}

/** Primer número de un formato: «caja 20 u» → 20, «saco 25 kg» → 25, «6x1,5L» → 6. */
export function unidadesDeFormato(formato: string | null | undefined): number | null {
  const m = /(\d+(?:[.,]\d+)?)/.exec(formato ?? "");
  if (!m) return null;
  const n = parsearNumero(m[1]);
  return n != null && n > 0 ? n : null;
}

/** Unidad de venta de un formato si empieza por una conocida: «caja 20 u» → «caja». */
export function unidadDeFormato(formato: string | null | undefined): string | null {
  const primera = normalizarTexto(formato)?.split(" ")[0] ?? null;
  if (!primera) return null;
  const u = UNIDAD_MAPA.get(primera);
  return u ?? null;
}

const celdaTexto = (v: unknown, max = 300): string | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (v instanceof Date) return null;
  return limpiarTexto(String(v), max);
};

/**
 * Convierte la tabla de la hoja (sheet_to_json con header: 1, defval: null, blankrows: true, para
 * que el índice sea la fila real) en FilaCatalogo. Salta las filas sin código ni nombre.
 * unidad: la de la columna (canónica) o la del formato; unidades_formato: columna o formato.
 */
export function filasCatalogo(tabla: unknown[][], filaCabecera: number, m: MapeoColumnas): FilaCatalogo[] {
  const out: FilaCatalogo[] = [];
  const col = (fila: unknown[], c: number | null) => (c === null ? null : fila[c]);
  for (let i = filaCabecera + 1; i < tabla.length; i++) {
    const f = tabla[i] ?? [];
    const ref = celdaTexto(col(f, m.ref), 60);
    const nombre = celdaTexto(col(f, m.nombre), 300);
    if (!ref && !nombre) continue;
    const formato = celdaTexto(col(f, m.formato), 80);
    const unidadCol = celdaTexto(col(f, m.unidad), 40);
    const ufCol = parsearNumero(col(f, m.unidades_formato));
    const precio = parsearNumero(col(f, m.precio));
    out.push({
      fila: i + 1,
      ref,
      nombre,
      formato,
      unidad: unidadCol ? normalizarUnidad(unidadCol) : unidadDeFormato(formato),
      unidades_formato: ufCol != null && ufCol > 0 ? ufCol : unidadesDeFormato(formato),
      precio: precio != null && precio >= 0 ? redondear(precio, 4) : null,
      codigo_barras: celdaTexto(col(f, m.codigo_barras), 40),
      categoria: celdaTexto(col(f, m.categoria), 80),
    });
  }
  return out;
}

/** Parte un array en trozos de n (por defecto TAM_TROZO_IMPORT = 400). */
export function trozos<T>(arr: T[], n = 400): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
