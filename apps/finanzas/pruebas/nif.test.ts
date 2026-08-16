import { errorDeNif, errorDeIban, normalizarNif, tipoDeNif } from "../lib/nif.ts";

const casos: [string, boolean, string][] = [
  ["B01996826", true, "CIF real de Bonita Menorca, SL"],
  ["b-0199.6826", true, "el mismo, sucio: minúsculas y separadores"],
  ["ESB01996826", true, "el mismo con prefijo ES"],
  ["12345678Z", true, "DNI válido"],
  ["12345678A", false, "DNI con letra cambiada"],
  ["00000000T", true, "DNI de ceros, válido"],
  ["X1234567L", true, "NIE válido"],
  ["X1234567A", false, "NIE con letra cambiada"],
  ["A58818501", true, "CIF con control numérico"],
  ["", false, "vacío"],
  ["1234", false, "corto"],
  ["ÑÑÑÑÑÑÑÑÑ", false, "basura"],
];

let fallos = 0;
for (const [valor, deberiaValer, nota] of casos) {
  const err = errorDeNif(valor);
  const ok = (err === null) === deberiaValer;
  if (!ok) fallos++;
  console.log(`${ok ? "ok  " : "FALLA"} ${valor.padEnd(12)} ${(tipoDeNif(valor)+"").padEnd(12)} ${nota}${err ? " → " + err : ""}`);
}

console.log("\n-- IBAN --");
const ibans: [string, boolean][] = [
  ["ES91 2100 0418 4502 0005 1332", true],
  ["ES9121000418450200051332", true],
  ["ES9121000418450200051333", false],
  ["", true],
  ["ES912100041845020005133", false],
  ["DE89370400440532013000", true],
];
for (const [v, deberiaValer] of ibans) {
  const err = errorDeIban(v);
  const ok = (err === null) === deberiaValer;
  if (!ok) fallos++;
  console.log(`${ok ? "ok  " : "FALLA"} ${v || "(vacío)"}${err ? " → " + err : ""}`);
}

console.log("\n-- normalizar (debe coincidir con norm_nif de la base) --");
for (const v of ["b-0199.6826", "ESB01996826", "  12345678z  ", "", "ES91 2100 0418", "ÑÑÑ"])
  console.log(JSON.stringify(v), "→", JSON.stringify(normalizarNif(v)));

console.log(fallos === 0 ? "\nTODO CORRECTO" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
