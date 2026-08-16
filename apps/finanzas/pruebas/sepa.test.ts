import {
  construirPain001, construirPain008, limpiarTexto, limpiarIban, importeSepa,
  type DatosRemesa,
} from "../lib/sepa.ts";

let fallos = 0;
function comprueba(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}${ok ? "" : " -> " + detalle}`);
}

// --- Juego de caracteres: lo que tumba un fichero entero ---
comprueba("quita tildes", limpiarTexto("Anglés Hernández") === "Angles Hernandez", limpiarTexto("Anglés Hernández"));
comprueba("la ñ pasa a n", limpiarTexto("Peña Muñoz") === "Pena Munoz", limpiarTexto("Peña Muñoz"));
comprueba("la ç pasa a c", limpiarTexto("França") === "Franca", limpiarTexto("França"));
comprueba("símbolos raros fuera", limpiarTexto("Bar «El Puerto» @2026") === "Bar El Puerto 2026", limpiarTexto("Bar «El Puerto» @2026"));
comprueba("permite los signos legales", limpiarTexto("SA - C/ Mayor, 3 (local) 50%") === "SA - C/ Mayor, 3 (local) 50", limpiarTexto("SA - C/ Mayor, 3 (local) 50%"));
comprueba("corta a 70", limpiarTexto("A".repeat(120)).length === 70);
comprueba("IBAN sin espacios", limpiarIban("ES91 2100 0418 4502 0005 1332") === "ES9121000418450200051332");
comprueba("importe con dos decimales", importeSepa(1234.5) === "1234.50", importeSepa(1234.5));
comprueba("importe redondea a dos", importeSepa(0.1 + 0.2) === "0.30", importeSepa(0.1 + 0.2));

const base: DatosRemesa = {
  mensajeId: "REM-2026-0001",
  creadaEn: "2026-08-17T09:00:00",
  fechaEjecucion: "2026-08-25",
  ordenante: { nombre: "Bonita Menorca, SL", iban: "ES91 2100 0418 4502 0005 1332", identificador: "ES12ZZZB01996826" },
  lineas: [
    { referencia: "V-1", nombre: "Peña Hostelería SL", iban: "ES7921000813610123456789", importe: 1210, concepto: "Factura F-2026-000001", mandatoRef: "MND-001", mandatoFecha: "2026-01-15", secuencia: "FRST" },
    { referencia: "V-2", nombre: "Muñoz e Hijos", iban: "ES2114650100722030876293", importe: 484.5, concepto: "Factura F-2026-000002", mandatoRef: "MND-002", mandatoFecha: "2026-02-01", secuencia: "RCUR" },
  ],
};

// --- pain.001, transferencias ---
const p1 = construirPain001(base);
comprueba("pain.001 declara su esquema", p1.includes("pain.001.001.03"));
comprueba("pain.001 es de transferencia", p1.includes("<PmtMtd>TRF</PmtMtd>"));
comprueba("pain.001 suma de control correcta", p1.includes("<CtrlSum>1694.50</CtrlSum>"), "esperaba 1694.50");
comprueba("pain.001 cuenta las lineas", (p1.match(/<CdtTrfTxInf>/g) ?? []).length === 2);
comprueba("pain.001 no cuela acentos", !/[áéíóúñÑ«»@]/.test(p1));
comprueba("pain.001 IBAN normalizado", p1.includes("<IBAN>ES9121000418450200051332</IBAN>"));

// --- pain.008, adeudos ---
const p8 = construirPain008(base);
comprueba("pain.008 declara su esquema", p8.includes("pain.008.001.02"));
comprueba("pain.008 es de adeudo", p8.includes("<PmtMtd>DD</PmtMtd>"));
comprueba("pain.008 lleva el identificador de acreedor", p8.includes("ES12ZZZB01996826"));
comprueba("pain.008 lleva el mandato", p8.includes("<MndtId>MND-001</MndtId>") && p8.includes("<DtOfSgntr>2026-01-15</DtOfSgntr>"));
comprueba("pain.008 suma de control correcta", p8.includes("<CtrlSum>1694.50</CtrlSum>"));

// --- Los dos frenos que evitan un desastre ---
try {
  construirPain008({ ...base, ordenante: { ...base.ordenante, identificador: null } });
  comprueba("sin identificador de acreedor debe fallar", false, "no fallo");
} catch (e) {
  comprueba("sin identificador de acreedor debe fallar", String(e).includes("identificador de acreedor"));
}

try {
  construirPain008({ ...base, lineas: [{ ...base.lineas[0], mandatoRef: null }] });
  comprueba("sin mandato debe fallar", false, "no fallo");
} catch (e) {
  comprueba("sin mandato debe fallar", String(e).includes("mandato"));
}

// --- Un XML sin cerrar seria catastrofico: se comprueba el equilibrio ---
function equilibrado(xml: string): boolean {
  const abre = (xml.match(/<([A-Za-z]+)(?: [^>]*)?>/g) ?? []).filter((x) => !x.startsWith("<?")).length;
  const cierra = (xml.match(/<\/[A-Za-z]+>/g) ?? []).length;
  const solos = (xml.match(/<[A-Za-z]+[^>]*\/>/g) ?? []).length;
  return abre - solos === cierra;
}
comprueba("pain.001 tiene todas las etiquetas cerradas", equilibrado(p1));
comprueba("pain.008 tiene todas las etiquetas cerradas", equilibrado(p8));

console.log(fallos === 0 ? "\nTODO CORRECTO" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
