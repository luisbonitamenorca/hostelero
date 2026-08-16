// Validación de identificadores fiscales españoles y de IBAN.
//
// El formato lo valida el cliente para avisar cuanto antes; la normalización
// que se guarda en fin_clientes.nif_norm la hace SIEMPRE el trigger de la base
// (norm_nif). `normalizarNif` de aquí replica esa función para poder buscar
// duplicados antes de guardar, no para sustituirla.

const LETRAS_DNI = "TRWAGMYFPDXBNJZSQVHLCKE";
const LETRAS_CONTROL_CIF = "JABCDEFGHI";

/** Mismo criterio que norm_nif() en la base: mayúsculas, sin separadores,
 *  sin prefijo ES y como mucho 9 caracteres. */
export function normalizarNif(valor: string | null | undefined): string | null {
  if (!valor || !valor.trim()) return null;
  const limpio = valor.toUpperCase().trim().replace(/[^A-Z0-9]/g, "");
  // Ojo: la base usa un lookahead `^ES(?=[A-Z0-9]{9})`, es decir, al menos 9
  // caracteres detrás del prefijo, no exactamente 9. Aquí igual, o el
  // nif_norm que calculamos no coincidiría con el guardado.
  const sinPrefijo = /^ES[A-Z0-9]{9}/.test(limpio) ? limpio.slice(2) : limpio;
  const norm = sinPrefijo.slice(0, 9);
  return norm === "" ? null : norm;
}

function letraDni(numero: number): string {
  return LETRAS_DNI[numero % 23];
}

function validarDni(nif: string): boolean {
  const m = /^(\d{8})([A-Z])$/.exec(nif);
  if (!m) return false;
  return letraDni(parseInt(m[1], 10)) === m[2];
}

function validarNie(nif: string): boolean {
  const m = /^([XYZ])(\d{7})([A-Z])$/.exec(nif);
  if (!m) return false;
  const prefijo = { X: "0", Y: "1", Z: "2" }[m[1] as "X" | "Y" | "Z"];
  return letraDni(parseInt(prefijo + m[2], 10)) === m[3];
}

function validarCif(nif: string): boolean {
  const m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(nif);
  if (!m) return false;
  const [, tipo, digitos, control] = m;

  let suma = 0;
  for (let i = 0; i < 7; i++) {
    const d = parseInt(digitos[i], 10);
    if (i % 2 === 0) {
      // Posiciones impares (1.ª, 3.ª…): se duplican y se suman sus cifras.
      const doble = d * 2;
      suma += Math.floor(doble / 10) + (doble % 10);
    } else {
      suma += d;
    }
  }
  const digitoControl = (10 - (suma % 10)) % 10;

  // Sociedades y entes: unos exigen letra, otros dígito, y varios admiten ambos.
  const soloLetra = "KPQRSNW".includes(tipo);
  const soloDigito = "ABEH".includes(tipo);
  if (soloLetra) return control === LETRAS_CONTROL_CIF[digitoControl];
  if (soloDigito) return control === String(digitoControl);
  return control === String(digitoControl) || control === LETRAS_CONTROL_CIF[digitoControl];
}

export type TipoNif = "dni" | "nie" | "cif" | "desconocido";

export function tipoDeNif(valor: string): TipoNif {
  const nif = normalizarNif(valor) ?? "";
  if (/^\d{8}[A-Z]$/.test(nif)) return "dni";
  if (/^[XYZ]\d{7}[A-Z]$/.test(nif)) return "nie";
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(nif)) return "cif";
  return "desconocido";
}

/** Valida NIF/NIE/CIF español con su dígito de control.
 *  Devuelve null si es válido, o el motivo del rechazo. */
export function errorDeNif(valor: string): string | null {
  const nif = normalizarNif(valor);
  if (!nif) {
    return valor.trim()
      ? "No parece un NIF, NIE ni CIF válido."
      : "El NIF es obligatorio para los clientes españoles.";
  }
  if (nif.length !== 9) return "Un NIF español tiene 9 caracteres (8 dígitos y letra, o letra y 8 caracteres).";

  switch (tipoDeNif(nif)) {
    case "dni":
      return validarDni(nif) ? null : "La letra no corresponde a ese número de DNI.";
    case "nie":
      return validarNie(nif) ? null : "La letra no corresponde a ese número de NIE.";
    case "cif":
      return validarCif(nif) ? null : "El dígito de control del CIF no cuadra.";
    default:
      return "No parece un NIF, NIE ni CIF válido.";
  }
}

/** IBAN: formato y dígitos de control (ISO 7064 mod-97). */
export function errorDeIban(valor: string): string | null {
  const iban = valor.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!iban) return null; // opcional
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return "El IBAN no tiene un formato válido.";
  if (iban.startsWith("ES") && iban.length !== 24) return "Un IBAN español tiene 24 caracteres.";

  const reordenado = iban.slice(4) + iban.slice(0, 4);
  const numerico = reordenado.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

  // mod 97 a trozos: el número entero no cabe en un double.
  let resto = 0;
  for (const cifra of numerico) resto = (resto * 10 + Number(cifra)) % 97;

  return resto === 1 ? null : "Los dígitos de control del IBAN no cuadran.";
}

export function formatearIban(valor: string): string {
  const iban = valor.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return iban.replace(/(.{4})/g, "$1 ").trim();
}
