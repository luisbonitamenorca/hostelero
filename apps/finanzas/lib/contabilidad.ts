/**
 * De apuntes a informes: sumas y saldos, balance de situación y pérdidas y
 * ganancias. Función pura, sin Supabase, para poder probarla.
 *
 * DOS CONVENIOS QUE MANDAN EN TODO EL ARCHIVO
 *
 * 1. El saldo de una cuenta se calcula SIEMPRE como debe − haber. Positivo es
 *    saldo deudor. Al presentar, las cuentas de pasivo y patrimonio se dan la
 *    vuelta (haber − debe) para que salgan en positivo, que es como se leen.
 *
 * 2. Las cuentas correctoras (280/281 amortización acumulada, 29x deterioro)
 *    van en el ACTIVO, no en el pasivo, y restan. Su saldo natural es acreedor,
 *    así que debe − haber ya sale negativo solo: no hay que hacer nada especial,
 *    y por eso están clasificadas como activo a propósito. Ponerlas en el pasivo
 *    infla el balance por los dos lados y sigue cuadrando, que es justo lo que
 *    lo hace difícil de detectar.
 *
 * QUÉ NO ES ESTO
 * No es el modelo oficial de cuentas anuales. El balance y la PyG del PGC
 * tienen un formato normalizado con epígrafes fijos (A-1, A-2, B-I…) y para
 * emitirlo hace falta un mapa cuenta→epígrafe que decide la asesoría, no yo.
 * Esto es el balance y la PyG DE GESTIÓN: las mismas cifras, agrupadas por
 * masas patrimoniales y por subgrupo contable. Para mirar el negocio sirve;
 * para depositar en el registro, no.
 */

import { redondear } from "./importes.ts";

// ---------------------------------------------------------------- clasificación

export type Naturaleza = "activo" | "pasivo" | "patrimonio" | "gasto" | "ingreso" | "desconocida";

export type Masa =
  | "activo-no-corriente"
  | "activo-corriente"
  | "patrimonio-neto"
  | "pasivo-no-corriente"
  | "pasivo-corriente"
  | "resultado"
  | "sin-clasificar";

export const NOMBRE_MASA: Record<Masa, string> = {
  "activo-no-corriente": "Activo no corriente",
  "activo-corriente": "Activo corriente",
  "patrimonio-neto": "Patrimonio neto",
  "pasivo-no-corriente": "Pasivo no corriente",
  "pasivo-corriente": "Pasivo corriente",
  resultado: "Resultado del ejercicio",
  "sin-clasificar": "Sin clasificar",
};

/**
 * Mapa subgrupo (dos dígitos) → masa del balance, según el PGC 2007.
 *
 * Solo están los subgrupos que existen de verdad. Lo que no esté aquí NO se
 * coloca a ojo: cae en «sin clasificar» y sale a la vista en el informe. Es
 * preferible un renglón feo que te obliga a mirarlo, a una cuenta metida en la
 * masa equivocada que cuadra igual y nadie ve nunca.
 */
const MASA_POR_SUBGRUPO: Record<string, Masa> = {
  // Grupo 1 — Financiación básica
  "10": "patrimonio-neto", // Capital
  "11": "patrimonio-neto", // Reservas
  "12": "patrimonio-neto", // Resultados pendientes de aplicación
  "13": "patrimonio-neto", // Subvenciones, donaciones y ajustes
  "14": "pasivo-no-corriente", // Provisiones
  "15": "pasivo-no-corriente", // Deudas a largo plazo con características especiales
  "16": "pasivo-no-corriente", // Deudas a l/p con partes vinculadas
  "17": "pasivo-no-corriente", // Deudas a l/p por préstamos y otros
  "18": "pasivo-no-corriente", // Fianzas y depósitos recibidos a l/p
  "19": "patrimonio-neto", // Situaciones transitorias de financiación

  // Grupo 2 — Activo no corriente
  "20": "activo-no-corriente", // Inmovilizado intangible
  "21": "activo-no-corriente", // Inmovilizado material
  "22": "activo-no-corriente", // Inversiones inmobiliarias
  "23": "activo-no-corriente", // Inmovilizado en curso
  "24": "activo-no-corriente", // Inversiones financieras en partes vinculadas
  "25": "activo-no-corriente", // Otras inversiones financieras a l/p
  "26": "activo-no-corriente", // Fianzas y depósitos constituidos a l/p
  "28": "activo-no-corriente", // Amortización acumulada — CORRECTORA, resta
  "29": "activo-no-corriente", // Deterioro de valor — CORRECTORA, resta

  // Grupo 3 — Existencias
  "30": "activo-corriente",
  "31": "activo-corriente",
  "32": "activo-corriente",
  "33": "activo-corriente",
  "34": "activo-corriente",
  "35": "activo-corriente",
  "36": "activo-corriente",
  "39": "activo-corriente", // Deterioro de existencias — correctora, resta

  // Grupo 4 — Acreedores y deudores. Aquí es donde más se falla: el mismo
  // grupo tiene cuentas de activo y de pasivo, y no se puede resolver por el
  // primer dígito.
  "40": "pasivo-corriente", // Proveedores
  "41": "pasivo-corriente", // Acreedores varios
  "43": "activo-corriente", // Clientes
  "44": "activo-corriente", // Deudores varios
  "46": "pasivo-corriente", // Personal (remuneraciones pendientes de pago)
  "47": "sin-clasificar", // Administraciones públicas: ver AAPP más abajo
  "48": "sin-clasificar", // Ajustes por periodificación: 480 activo, 485 pasivo
  "49": "activo-corriente", // Deterioro de créditos comerciales — correctora

  // Grupo 5 — Cuentas financieras
  "50": "pasivo-corriente", // Empréstitos y deudas a c/p
  "51": "pasivo-corriente", // Deudas a c/p con partes vinculadas
  "52": "pasivo-corriente", // Deudas a c/p por préstamos y otros
  "53": "activo-corriente", // Inversiones financieras a c/p en partes vinculadas
  "54": "activo-corriente", // Otras inversiones financieras a c/p
  "55": "sin-clasificar", // Otras cuentas no bancarias: 551 puede ir a los dos lados
  "56": "sin-clasificar", // Fianzas y depósitos a c/p: 565 activo, 560/561 pasivo
  "57": "activo-corriente", // Tesorería
  "58": "activo-corriente", // Activos no corrientes mantenidos para la venta
  "59": "activo-corriente", // Deterioro de inversiones a c/p — correctora
};

/**
 * Cuentas de tres dígitos que no siguen a su subgrupo. Se resuelven antes que
 * el subgrupo. Las administraciones públicas son el caso clásico: 470 es un
 * derecho de cobro (Hacienda nos debe) y 477 es una deuda (le debemos el IVA
 * repercutido), y las dos empiezan por 47.
 */
const MASA_POR_CUENTA: Record<string, Masa> = {
  "470": "activo-corriente", // Hacienda Pública, deudora por diversos conceptos
  "471": "activo-corriente", // Organismos de la Seguridad Social, deudores
  "472": "activo-corriente", // Hacienda Pública, IVA soportado
  "473": "activo-corriente", // Hacienda Pública, retenciones y pagos a cuenta
  "474": "activo-corriente", // Activos por impuesto diferido
  "475": "pasivo-corriente", // Hacienda Pública, acreedora por conceptos fiscales
  "476": "pasivo-corriente", // Organismos de la Seguridad Social, acreedores
  "477": "pasivo-corriente", // Hacienda Pública, IVA repercutido
  "479": "pasivo-no-corriente", // Pasivos por diferencias temporarias imponibles
  "480": "activo-corriente", // Gastos anticipados
  "485": "pasivo-corriente", // Ingresos anticipados
  "551": "sin-clasificar", // Cuenta corriente con socios: según signo
  "555": "sin-clasificar", // Partidas pendientes de aplicación
  "560": "pasivo-corriente", // Fianzas recibidas a c/p
  "561": "pasivo-corriente", // Depósitos recibidos a c/p
  "565": "activo-corriente", // Fianzas constituidas a c/p
  "566": "activo-corriente", // Depósitos constituidos a c/p
};

export type Clasificacion = { masa: Masa; naturaleza: Naturaleza };

export function clasificar(codigo: string): Clasificacion {
  const c = (codigo ?? "").trim();
  if (c.length === 0) return { masa: "sin-clasificar", naturaleza: "desconocida" };

  const grupo = c[0];

  // Los grupos 6 y 7 no pasan por el balance: son la cuenta de resultados.
  if (grupo === "6") return { masa: "resultado", naturaleza: "gasto" };
  if (grupo === "7") return { masa: "resultado", naturaleza: "ingreso" };

  // Los grupos 8 y 9 (gastos e ingresos imputados al patrimonio neto) existen
  // pero no los usa una hostelería sin instrumentos financieros complejos. Si
  // aparecen, que se vean.
  if (grupo === "8" || grupo === "9") return { masa: "sin-clasificar", naturaleza: "desconocida" };

  const porCuenta = MASA_POR_CUENTA[c.slice(0, 3)];
  const masa = porCuenta ?? MASA_POR_SUBGRUPO[c.slice(0, 2)] ?? "sin-clasificar";

  const naturaleza: Naturaleza =
    masa === "activo-no-corriente" || masa === "activo-corriente"
      ? "activo"
      : masa === "patrimonio-neto"
        ? "patrimonio"
        : masa === "pasivo-no-corriente" || masa === "pasivo-corriente"
          ? "pasivo"
          : "desconocida";

  return { masa, naturaleza };
}

/** Signo de presentación: activo se lee debe−haber; pasivo y neto, al revés. */
export function signoDePresentacion(masa: Masa): 1 | -1 {
  return masa === "activo-no-corriente" || masa === "activo-corriente" ? 1 : -1;
}

// ---------------------------------------------------------------- sumas y saldos

/** Un apunte tal y como sale de la base, ya con el código de su cuenta. */
export type ApunteInforme = {
  codigo: string;
  nombre: string;
  fecha: string; // AAAA-MM-DD
  debe: number;
  haber: number;
};

export type FilaSaldos = {
  codigo: string;
  nombre: string;
  masa: Masa;
  /** Acumulado ANTES del periodo pedido. */
  debeAnterior: number;
  haberAnterior: number;
  /** Movimientos DENTRO del periodo. */
  debePeriodo: number;
  haberPeriodo: number;
  /** Acumulado hasta el final del periodo (anterior + periodo). */
  debeTotal: number;
  haberTotal: number;
  /** debe − haber acumulado. Positivo = deudor. */
  saldo: number;
};

/**
 * Sumas y saldos: una fila por cuenta con movimiento.
 *
 * `desde` separa lo anterior de lo del periodo; `hasta` corta por arriba. Una
 * cuenta sin movimiento en ninguno de los dos tramos no sale: un listado con
 * 658 filas a cero no se lee.
 */
export function sumasYSaldos(
  apuntes: ApunteInforme[],
  desde: string,
  hasta: string,
): FilaSaldos[] {
  const porCuenta = new Map<string, FilaSaldos>();

  for (const a of apuntes) {
    if (a.fecha > hasta) continue; // defensa: la consulta ya debería cortarlo

    let fila = porCuenta.get(a.codigo);
    if (!fila) {
      fila = {
        codigo: a.codigo,
        nombre: a.nombre,
        masa: clasificar(a.codigo).masa,
        debeAnterior: 0,
        haberAnterior: 0,
        debePeriodo: 0,
        haberPeriodo: 0,
        debeTotal: 0,
        haberTotal: 0,
        saldo: 0,
      };
      porCuenta.set(a.codigo, fila);
    }

    if (a.fecha < desde) {
      fila.debeAnterior += a.debe;
      fila.haberAnterior += a.haber;
    } else {
      fila.debePeriodo += a.debe;
      fila.haberPeriodo += a.haber;
    }
  }

  const filas = [...porCuenta.values()];
  for (const f of filas) {
    f.debeAnterior = redondear(f.debeAnterior);
    f.haberAnterior = redondear(f.haberAnterior);
    f.debePeriodo = redondear(f.debePeriodo);
    f.haberPeriodo = redondear(f.haberPeriodo);
    f.debeTotal = redondear(f.debeAnterior + f.debePeriodo);
    f.haberTotal = redondear(f.haberAnterior + f.haberPeriodo);
    f.saldo = redondear(f.debeTotal - f.haberTotal);
  }

  return filas.sort((a, b) => a.codigo.localeCompare(b.codigo));
}

// ---------------------------------------------------------------- balance

export type LineaBalance = { codigo: string; nombre: string; importe: number };
export type BloqueBalance = { masa: Masa; titulo: string; lineas: LineaBalance[]; total: number };

export type Balance = {
  activo: BloqueBalance[];
  pasivo: BloqueBalance[];
  sinClasificar: LineaBalance[];
  totalActivo: number;
  totalPasivo: number;
  resultado: number;
  /** totalActivo − totalPasivo. Cero si todo está clasificado y el diario cuadra. */
  descuadre: number;
};

const ORDEN_ACTIVO: Masa[] = ["activo-no-corriente", "activo-corriente"];
const ORDEN_PASIVO: Masa[] = ["patrimonio-neto", "pasivo-no-corriente", "pasivo-corriente"];

/**
 * Balance a fecha: es una foto, no un movimiento, así que se construye desde
 * los saldos ACUMULADOS (debeTotal/haberTotal), nunca desde los del periodo.
 *
 * El resultado del ejercicio (ingresos − gastos) entra en el patrimonio neto.
 * Sin eso el balance no cuadra nunca, porque los grupos 6 y 7 no están en
 * ninguna masa patrimonial hasta que se regularizan al cierre.
 */
export function balance(filas: FilaSaldos[]): Balance {
  const bloques = new Map<Masa, LineaBalance[]>();
  const sinClasificar: LineaBalance[] = [];
  let resultado = 0;

  for (const f of filas) {
    if (f.masa === "resultado") {
      // Ingresos (haber) menos gastos (debe): el saldo es debe−haber, así que
      // el resultado es su opuesto.
      resultado -= f.saldo;
      continue;
    }
    if (f.masa === "sin-clasificar") {
      if (f.saldo !== 0) sinClasificar.push({ codigo: f.codigo, nombre: f.nombre, importe: f.saldo });
      continue;
    }

    const importe = redondear(f.saldo * signoDePresentacion(f.masa));
    if (importe === 0) continue; // una cuenta saldada no ocupa sitio en el balance

    const lista = bloques.get(f.masa) ?? [];
    lista.push({ codigo: f.codigo, nombre: f.nombre, importe });
    bloques.set(f.masa, lista);
  }

  resultado = redondear(resultado);

  const construir = (orden: Masa[]): BloqueBalance[] =>
    orden
      .map((masa) => {
        const lineas = (bloques.get(masa) ?? []).sort((a, b) => a.codigo.localeCompare(b.codigo));
        return {
          masa,
          titulo: NOMBRE_MASA[masa],
          lineas,
          total: redondear(lineas.reduce((s, l) => s + l.importe, 0)),
        };
      })
      .filter((b) => b.lineas.length > 0);

  const activo = construir(ORDEN_ACTIVO);
  const pasivo = construir(ORDEN_PASIVO);

  // El resultado se suma al patrimonio neto. Si no hay bloque de neto todavía
  // (una sociedad recién arrancada), se crea con esa única línea.
  if (resultado !== 0) {
    const neto = pasivo.find((b) => b.masa === "patrimonio-neto");
    const linea: LineaBalance = { codigo: "129", nombre: "Resultado del ejercicio", importe: resultado };
    if (neto) {
      neto.lineas.push(linea);
      neto.total = redondear(neto.total + resultado);
    } else {
      pasivo.unshift({
        masa: "patrimonio-neto",
        titulo: NOMBRE_MASA["patrimonio-neto"],
        lineas: [linea],
        total: resultado,
      });
    }
  }

  const totalActivo = redondear(activo.reduce((s, b) => s + b.total, 0));
  const totalPasivo = redondear(pasivo.reduce((s, b) => s + b.total, 0));

  return {
    activo,
    pasivo,
    sinClasificar: sinClasificar.sort((a, b) => a.codigo.localeCompare(b.codigo)),
    totalActivo,
    totalPasivo,
    resultado,
    descuadre: redondear(totalActivo - totalPasivo),
  };
}

// ---------------------------------------------------------------- pérdidas y ganancias

export type LineaPyG = { codigo: string; nombre: string; importe: number };
export type BloquePyG = { subgrupo: string; titulo: string; lineas: LineaPyG[]; total: number };

export type PyG = {
  ingresos: BloquePyG[];
  gastos: BloquePyG[];
  totalIngresos: number;
  totalGastos: number;
  resultado: number;
};

/** Nombres de los subgrupos de resultado que usa una hostelería. */
const NOMBRE_SUBGRUPO: Record<string, string> = {
  "60": "Compras",
  "61": "Variación de existencias",
  "62": "Servicios exteriores",
  "63": "Tributos",
  "64": "Gastos de personal",
  "65": "Otros gastos de gestión",
  "66": "Gastos financieros",
  "67": "Pérdidas y gastos excepcionales",
  "68": "Dotaciones para amortizaciones",
  "69": "Pérdidas por deterioro",
  "70": "Ventas",
  "71": "Variación de existencias de productos",
  "73": "Trabajos realizados para la empresa",
  "74": "Subvenciones",
  "75": "Otros ingresos de gestión",
  "76": "Ingresos financieros",
  "77": "Beneficios e ingresos excepcionales",
  "79": "Excesos y aplicaciones de provisiones",
};

/**
 * Pérdidas y ganancias del PERIODO — aquí sí manda el movimiento del tramo
 * pedido, no el acumulado: la PyG de marzo es lo que pasó en marzo.
 *
 * Un gasto tiene saldo deudor y un ingreso acreedor, así que ambos se
 * presentan en positivo y el resultado es ingresos − gastos.
 */
export function perdidasYGanancias(filas: FilaSaldos[]): PyG {
  const gastos = new Map<string, LineaPyG[]>();
  const ingresos = new Map<string, LineaPyG[]>();

  for (const f of filas) {
    if (f.masa !== "resultado") continue;

    const movimiento = redondear(f.debePeriodo - f.haberPeriodo);
    if (movimiento === 0) continue;

    const subgrupo = f.codigo.slice(0, 2);
    const esGasto = f.codigo[0] === "6";
    const destino = esGasto ? gastos : ingresos;
    const importe = esGasto ? movimiento : -movimiento;

    const lista = destino.get(subgrupo) ?? [];
    lista.push({ codigo: f.codigo, nombre: f.nombre, importe });
    destino.set(subgrupo, lista);
  }

  const construir = (m: Map<string, LineaPyG[]>): BloquePyG[] =>
    [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([subgrupo, lineas]) => ({
        subgrupo,
        titulo: NOMBRE_SUBGRUPO[subgrupo] ?? `Subgrupo ${subgrupo}`,
        lineas: lineas.sort((a, b) => a.codigo.localeCompare(b.codigo)),
        total: redondear(lineas.reduce((s, l) => s + l.importe, 0)),
      }));

  const bloquesGastos = construir(gastos);
  const bloquesIngresos = construir(ingresos);
  const totalGastos = redondear(bloquesGastos.reduce((s, b) => s + b.total, 0));
  const totalIngresos = redondear(bloquesIngresos.reduce((s, b) => s + b.total, 0));

  return {
    ingresos: bloquesIngresos,
    gastos: bloquesGastos,
    totalIngresos,
    totalGastos,
    resultado: redondear(totalIngresos - totalGastos),
  };
}

// ---------------------------------------------------------------- periodos

export type ModoPeriodo = "mes" | "trimestre" | "anual" | "rango";

export type Periodo = { desde: string; hasta: string; titulo: string };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function diaFinal(anio: number, mes: number): string {
  // Día 0 del mes siguiente = último del mes pedido. Cubre febrero y bisiestos.
  const d = new Date(Date.UTC(anio, mes, 0));
  return d.toISOString().slice(0, 10);
}

function primerDia(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, "0")}-01`;
}

/**
 * Traduce la elección del usuario a un rango de fechas.
 *
 * «Acumulado anual» va del 1 de enero al final del mes elegido, que es lo que
 * se quiere decir al pedirlo: cómo va el año HASTA ahora. Si no se elige mes,
 * el año entero.
 */
export function calcularPeriodo(
  anio: number,
  modo: ModoPeriodo,
  opciones: { mes?: number; trimestre?: number; desde?: string; hasta?: string } = {},
): Periodo {
  if (modo === "rango") {
    const desde = opciones.desde || primerDia(anio, 1);
    const hasta = opciones.hasta || diaFinal(anio, 12);
    return { desde, hasta, titulo: `del ${voltear(desde)} al ${voltear(hasta)}` };
  }

  if (modo === "mes") {
    const mes = acotar(opciones.mes ?? 1, 1, 12);
    return {
      desde: primerDia(anio, mes),
      hasta: diaFinal(anio, mes),
      titulo: `${MESES[mes - 1]} de ${anio}`,
    };
  }

  if (modo === "trimestre") {
    const t = acotar(opciones.trimestre ?? 1, 1, 4);
    const primero = t * 3 - 2;
    return {
      desde: primerDia(anio, primero),
      hasta: diaFinal(anio, primero + 2),
      titulo: `${t}.º trimestre de ${anio}`,
    };
  }

  // anual acumulado
  const hastaMes = acotar(opciones.mes ?? 12, 1, 12);
  return {
    desde: primerDia(anio, 1),
    hasta: diaFinal(anio, hastaMes),
    titulo:
      hastaMes === 12
        ? `ejercicio ${anio} completo`
        : `acumulado de enero a ${MESES[hastaMes - 1]} de ${anio}`,
  };
}

function acotar(v: number, min: number, max: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : min;
}

function voltear(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

// ---------------------------------------------------------------- informes en columnas

/**
 * Vista de un informe: cuántas columnas tiene y qué significa cada una.
 * «anual» es todo el ejercicio junto; «trimestres» y «meses» sacan una columna
 * por tramo; «rango» es una sola columna entre dos fechas. «centros» no parte
 * el tiempo sino el NEGOCIO: mismo periodo (el ejercicio) en todas las
 * columnas, una por centro de coste — en tramosDeVista cae en el caso anual a
 * propósito, porque los datos que necesita son los del año entero.
 */
export type Vista = "anual" | "trimestres" | "meses" | "rango" | "centros";

export type Tramo = { titulo: string; desde: string; hasta: string };

const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function tramosDeVista(
  anio: number,
  vista: Vista,
  opciones: { desde?: string; hasta?: string } = {},
): Tramo[] {
  if (vista === "meses") {
    return MESES_CORTOS.map((titulo, i) => ({
      titulo,
      desde: primerDia(anio, i + 1),
      hasta: diaFinal(anio, i + 1),
    }));
  }
  if (vista === "trimestres") {
    return [1, 2, 3, 4].map((t) => ({
      titulo: `T${t}`,
      desde: primerDia(anio, t * 3 - 2),
      hasta: diaFinal(anio, t * 3),
    }));
  }
  if (vista === "rango") {
    const desde = opciones.desde || primerDia(anio, 1);
    const hasta = opciones.hasta || diaFinal(anio, 12);
    return [{ titulo: `${voltear(desde)} – ${voltear(hasta)}`, desde, hasta }];
  }
  return [{ titulo: `Ejercicio ${anio}`, desde: primerDia(anio, 1), hasta: diaFinal(anio, 12) }];
}

/** Una fila de informe con un importe por tramo, en el mismo orden que los tramos. */
export type FilaColumnas = { codigo: string; nombre: string; importes: number[] };
export type BloqueColumnas = {
  clave: string;
  titulo: string;
  filas: FilaColumnas[];
  totales: number[];
};

/**
 * Funde varios informes de un solo tramo en una tabla de columnas: la unión de
 * bloques y de cuentas, con 0 donde una cuenta no se movió ese tramo. El orden
 * de bloques respeta el del primer tramo donde aparece cada uno (que ya viene
 * ordenado de las funciones de un tramo).
 */
function fundir(
  porTramo: { clave: string; titulo: string; lineas: { codigo: string; nombre: string; importe: number }[] }[][],
): BloqueColumnas[] {
  const n = porTramo.length;
  const bloques = new Map<string, BloqueColumnas>();

  porTramo.forEach((lista, i) => {
    for (const b of lista) {
      let bloque = bloques.get(b.clave);
      if (!bloque) {
        bloque = { clave: b.clave, titulo: b.titulo, filas: [], totales: Array(n).fill(0) };
        bloques.set(b.clave, bloque);
      }
      for (const l of b.lineas) {
        let fila = bloque.filas.find((f) => f.codigo === l.codigo);
        if (!fila) {
          fila = { codigo: l.codigo, nombre: l.nombre, importes: Array(n).fill(0) };
          bloque.filas.push(fila);
        }
        fila.importes[i] = l.importe;
      }
    }
  });

  const resultado = [...bloques.values()];
  for (const b of resultado) {
    b.filas.sort((a, z) => a.codigo.localeCompare(z.codigo));
    b.totales = b.totales.map((_, i) =>
      redondear(b.filas.reduce((s, f) => s + f.importes[i], 0)),
    );
  }
  return resultado;
}

export type PyGColumnas = {
  tramos: Tramo[];
  ingresos: BloqueColumnas[];
  gastos: BloqueColumnas[];
  totalIngresos: number[];
  totalGastos: number[];
  resultado: number[];
};

/** PyG con una columna por tramo: cada columna es el MOVIMIENTO de su tramo. */
export function pygEnColumnas(apuntes: ApunteInforme[], tramos: Tramo[]): PyGColumnas {
  const porTramo = tramos.map((t) => perdidasYGanancias(sumasYSaldos(apuntes, t.desde, t.hasta)));

  const aBloques = (lado: "ingresos" | "gastos") =>
    fundir(porTramo.map((p) => p[lado].map((b) => ({ clave: b.subgrupo, titulo: b.titulo, lineas: b.lineas }))));

  const ingresos = aBloques("ingresos");
  const gastos = aBloques("gastos");
  const totalIngresos = porTramo.map((p) => p.totalIngresos);
  const totalGastos = porTramo.map((p) => p.totalGastos);

  return {
    tramos,
    ingresos,
    gastos,
    totalIngresos,
    totalGastos,
    resultado: porTramo.map((p) => p.resultado),
  };
}

/** Un apunte de informe que además sabe de qué centro es (o de ninguno). */
export type ApunteCentrado = ApunteInforme & { centroId: string | null };

/**
 * PyG con una columna por CENTRO en vez de por tramo: el mismo periodo en
 * todas, y en cada columna solo los apuntes imputados a ese centro. Los
 * apuntes sin centro (amortizaciones, financieros…) forman una columna «Sin
 * centro» al final, para que la suma de columnas siga dando el resultado de
 * la empresa. Un centro sin movimiento de PyG no saca columna.
 *
 * Devuelve PyGColumnas con los centros disfrazados de tramos: así la tabla,
 * el Excel y los totales de la página valen tal cual, sin otro camino de
 * render.
 */
export function pygPorCentros(
  apuntes: ApunteCentrado[],
  centros: { id: string; nombre: string }[],
  desde: string,
  hasta: string,
): PyGColumnas {
  const esPyG = (a: ApunteInforme) => a.codigo.startsWith("6") || a.codigo.startsWith("7");

  const grupos: { titulo: string; apuntes: ApunteInforme[] }[] = [];
  for (const c of centros) {
    const propios = apuntes.filter((a) => a.centroId === c.id);
    if (propios.some(esPyG)) grupos.push({ titulo: c.nombre, apuntes: propios });
  }
  const sueltos = apuntes.filter((a) => a.centroId === null);
  if (sueltos.some(esPyG)) grupos.push({ titulo: "Sin centro", apuntes: sueltos });

  const porGrupo = grupos.map((g) => perdidasYGanancias(sumasYSaldos(g.apuntes, desde, hasta)));
  const aBloques = (lado: "ingresos" | "gastos") =>
    fundir(porGrupo.map((p) => p[lado].map((b) => ({ clave: b.subgrupo, titulo: b.titulo, lineas: b.lineas }))));

  return {
    tramos: grupos.map((g) => ({ titulo: g.titulo, desde, hasta })),
    ingresos: aBloques("ingresos"),
    gastos: aBloques("gastos"),
    totalIngresos: porGrupo.map((p) => p.totalIngresos),
    totalGastos: porGrupo.map((p) => p.totalGastos),
    resultado: porGrupo.map((p) => p.resultado),
  };
}

export type BalanceColumnas = {
  tramos: Tramo[];
  activo: BloqueColumnas[];
  pasivo: BloqueColumnas[];
  sinClasificar: FilaColumnas[];
  totalActivo: number[];
  totalPasivo: number[];
  resultado: number[];
  descuadres: number[];
};

/**
 * Balance con una columna por tramo: cada columna es la FOTO al último día del
 * tramo (acumulada desde `inicioEjercicio`), no el movimiento del tramo. Por
 * eso «meses» aquí se lee «cómo estaba la empresa a fin de cada mes».
 */
export function balanceEnColumnas(
  apuntes: ApunteInforme[],
  tramos: Tramo[],
  inicioEjercicio: string,
): BalanceColumnas {
  const porTramo = tramos.map((t) => balance(sumasYSaldos(apuntes, inicioEjercicio, t.hasta)));

  const aBloques = (lado: "activo" | "pasivo") =>
    fundir(porTramo.map((b) => b[lado].map((x) => ({ clave: x.masa, titulo: x.titulo, lineas: x.lineas }))));

  const sinClasificar = fundir(
    porTramo.map((b) => [{ clave: "sin", titulo: "Sin clasificar", lineas: b.sinClasificar }]),
  )[0]?.filas ?? [];

  return {
    tramos,
    activo: aBloques("activo"),
    pasivo: aBloques("pasivo"),
    sinClasificar,
    totalActivo: porTramo.map((b) => b.totalActivo),
    totalPasivo: porTramo.map((b) => b.totalPasivo),
    resultado: porTramo.map((b) => b.resultado),
    descuadres: porTramo.map((b) => b.descuadre),
  };
}
