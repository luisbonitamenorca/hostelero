/**
 * Generación de los ficheros SEPA que se suben a la banca electrónica:
 * pain.001 para transferencias (pagos) y pain.008 para adeudos (cobros).
 *
 * ADVERTENCIA: esto mueve dinero real. Un fichero mal formado no da un error
 * bonito — carga importes equivocados a clientes de verdad. Ningún fichero se
 * sube al banco hasta que la entidad valide uno de prueba, porque la versión
 * exacta de esquema que acepta cada banco es un dato suyo, no una elección
 * nuestra (los "cuadernos" 19 y 34 tienen variantes).
 *
 * Reglas del estándar que se aplican aquí y conviene no tocar a la ligera:
 *  · Los textos van en un juego de caracteres reducido. Los acentos y la ñ NO
 *    están permitidos: se transliteran. Si se cuela una ñ, el banco rechaza el
 *    fichero entero, no la línea.
 *  · Los nombres se cortan a 70 caracteres, y los identificadores a 35.
 *  · Los importes van con punto decimal y siempre dos decimales.
 */

const MAX_NOMBRE = 70;
const MAX_ID = 35;

/** Juego de caracteres SEPA: solo estos pasan. */
export function limpiarTexto(texto: string, maximo = MAX_NOMBRE): string {
  const sinAcentos = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes
    .replace(/ñ/g, "n")
    .replace(/Ñ/g, "N")
    .replace(/ç/g, "c")
    .replace(/Ç/g, "C");

  // Lo que no esté en el juego permitido pasa a espacio, y se colapsan espacios.
  return sinAcentos
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximo);
}

export function limpiarIban(iban: string): string {
  return iban.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Importe con punto y dos decimales, como exige el esquema. */
export function importeSepa(valor: number): string {
  return valor.toFixed(2);
}

export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function t(texto: string, maximo?: number): string {
  return escaparXml(limpiarTexto(texto, maximo));
}

export type LineaRemesa = {
  referencia: string;      // identificador de la línea dentro del fichero
  nombre: string;          // deudor (cobro) u ordenante del pago (proveedor)
  iban: string;
  bic?: string | null;
  importe: number;
  concepto?: string | null;
  mandatoRef?: string | null;
  mandatoFecha?: string | null;
  secuencia?: "FRST" | "RCUR" | "OOFF" | "FNAL" | null;
};

export type DatosRemesa = {
  mensajeId: string;
  creadaEn: string;        // ISO completo
  fechaEjecucion: string;  // AAAA-MM-DD
  ordenante: { nombre: string; iban: string; bic?: string | null; identificador?: string | null };
  concepto?: string | null;
  lineas: LineaRemesa[];
  /** CORE (particulares) o B2B (empresas). Solo en adeudos. */
  esquema?: "CORE" | "B2B";
};

function totalDe(lineas: LineaRemesa[]): number {
  return Number(lineas.reduce((s, l) => s + l.importe, 0).toFixed(2));
}

// ---------------------------------------------------------------- pain.001

/** Transferencias: nosotros pagamos a proveedores. */
export function construirPain001(d: DatosRemesa): string {
  const total = totalDe(d.lineas);
  const cab = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">',
    "  <CstmrCdtTrfInitn>",
    "    <GrpHdr>",
    `      <MsgId>${t(d.mensajeId, MAX_ID)}</MsgId>`,
    `      <CreDtTm>${d.creadaEn}</CreDtTm>`,
    `      <NbOfTxs>${d.lineas.length}</NbOfTxs>`,
    `      <CtrlSum>${importeSepa(total)}</CtrlSum>`,
    "      <InitgPty>",
    `        <Nm>${t(d.ordenante.nombre)}</Nm>`,
    "      </InitgPty>",
    "    </GrpHdr>",
    "    <PmtInf>",
    `      <PmtInfId>${t(d.mensajeId, MAX_ID)}</PmtInfId>`,
    "      <PmtMtd>TRF</PmtMtd>",
    `      <NbOfTxs>${d.lineas.length}</NbOfTxs>`,
    `      <CtrlSum>${importeSepa(total)}</CtrlSum>`,
    `      <ReqdExctnDt>${d.fechaEjecucion}</ReqdExctnDt>`,
    "      <Dbtr>",
    `        <Nm>${t(d.ordenante.nombre)}</Nm>`,
    "      </Dbtr>",
    "      <DbtrAcct>",
    `        <Id><IBAN>${limpiarIban(d.ordenante.iban)}</IBAN></Id>`,
    "      </DbtrAcct>",
    "      <DbtrAgt>",
    `        <FinInstnId>${d.ordenante.bic ? `<BIC>${t(d.ordenante.bic, 11)}</BIC>` : "<Othr><Id>NOTPROVIDED</Id></Othr>"}</FinInstnId>`,
    "      </DbtrAgt>",
  ];

  const cuerpo = d.lineas.flatMap((l) => [
    "      <CdtTrfTxInf>",
    "        <PmtId>",
    `          <EndToEndId>${t(l.referencia, MAX_ID)}</EndToEndId>`,
    "        </PmtId>",
    "        <Amt>",
    `          <InstdAmt Ccy="EUR">${importeSepa(l.importe)}</InstdAmt>`,
    "        </Amt>",
    "        <Cdtr>",
    `          <Nm>${t(l.nombre)}</Nm>`,
    "        </Cdtr>",
    "        <CdtrAcct>",
    `          <Id><IBAN>${limpiarIban(l.iban)}</IBAN></Id>`,
    "        </CdtrAcct>",
    ...(l.concepto
      ? ["        <RmtInf>", `          <Ustrd>${t(l.concepto, 140)}</Ustrd>`, "        </RmtInf>"]
      : []),
    "      </CdtTrfTxInf>",
  ]);

  return [...cab, ...cuerpo, "    </PmtInf>", "  </CstmrCdtTrfInitn>", "</Document>", ""].join("\n");
}

// ---------------------------------------------------------------- pain.008

/** Adeudos domiciliados: cobramos a clientes que han firmado mandato. */
export function construirPain008(d: DatosRemesa): string {
  if (!d.ordenante.identificador) {
    throw new Error(
      "Falta el identificador de acreedor. Lo asigna el banco al contratar los adeudos y sin él la remesa no vale.",
    );
  }
  const sinMandato = d.lineas.find((l) => !l.mandatoRef || !l.mandatoFecha);
  if (sinMandato) {
    throw new Error(
      `La línea de ${sinMandato.nombre} no tiene mandato. Domiciliar sin mandato firmado no es legal.`,
    );
  }

  const total = totalDe(d.lineas);
  const esquema = d.esquema ?? "CORE";

  const cab = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">',
    "  <CstmrDrctDbtInitn>",
    "    <GrpHdr>",
    `      <MsgId>${t(d.mensajeId, MAX_ID)}</MsgId>`,
    `      <CreDtTm>${d.creadaEn}</CreDtTm>`,
    `      <NbOfTxs>${d.lineas.length}</NbOfTxs>`,
    `      <CtrlSum>${importeSepa(total)}</CtrlSum>`,
    "      <InitgPty>",
    `        <Nm>${t(d.ordenante.nombre)}</Nm>`,
    "      </InitgPty>",
    "    </GrpHdr>",
    "    <PmtInf>",
    `      <PmtInfId>${t(d.mensajeId, MAX_ID)}</PmtInfId>`,
    "      <PmtMtd>DD</PmtMtd>",
    `      <NbOfTxs>${d.lineas.length}</NbOfTxs>`,
    `      <CtrlSum>${importeSepa(total)}</CtrlSum>`,
    "      <PmtTpInf>",
    "        <SvcLvl><Cd>SEPA</Cd></SvcLvl>",
    `        <LclInstrm><Cd>${esquema}</Cd></LclInstrm>`,
    `        <SeqTp>${d.lineas[0]?.secuencia ?? "RCUR"}</SeqTp>`,
    "      </PmtTpInf>",
    `      <ReqdColltnDt>${d.fechaEjecucion}</ReqdColltnDt>`,
    "      <Cdtr>",
    `        <Nm>${t(d.ordenante.nombre)}</Nm>`,
    "      </Cdtr>",
    "      <CdtrAcct>",
    `        <Id><IBAN>${limpiarIban(d.ordenante.iban)}</IBAN></Id>`,
    "      </CdtrAcct>",
    "      <CdtrAgt>",
    `        <FinInstnId>${d.ordenante.bic ? `<BIC>${t(d.ordenante.bic, 11)}</BIC>` : "<Othr><Id>NOTPROVIDED</Id></Othr>"}</FinInstnId>`,
    "      </CdtrAgt>",
    "      <CdtrSchmeId>",
    "        <Id><PrvtId><Othr>",
    `          <Id>${t(d.ordenante.identificador, MAX_ID)}</Id>`,
    "          <SchmeNm><Prtry>SEPA</Prtry></SchmeNm>",
    "        </Othr></PrvtId></Id>",
    "      </CdtrSchmeId>",
  ];

  const cuerpo = d.lineas.flatMap((l) => [
    "      <DrctDbtTxInf>",
    "        <PmtId>",
    `          <EndToEndId>${t(l.referencia, MAX_ID)}</EndToEndId>`,
    "        </PmtId>",
    `        <InstdAmt Ccy="EUR">${importeSepa(l.importe)}</InstdAmt>`,
    "        <DrctDbtTx>",
    "          <MndtRltdInf>",
    `            <MndtId>${t(l.mandatoRef ?? "", MAX_ID)}</MndtId>`,
    `            <DtOfSgntr>${l.mandatoFecha}</DtOfSgntr>`,
    "          </MndtRltdInf>",
    "        </DrctDbtTx>",
    "        <Dbtr>",
    `          <Nm>${t(l.nombre)}</Nm>`,
    "        </Dbtr>",
    "        <DbtrAcct>",
    `          <Id><IBAN>${limpiarIban(l.iban)}</IBAN></Id>`,
    "        </DbtrAcct>",
    ...(l.concepto
      ? ["        <RmtInf>", `          <Ustrd>${t(l.concepto, 140)}</Ustrd>`, "        </RmtInf>"]
      : []),
    "      </DrctDbtTxInf>",
  ]);

  return [...cab, ...cuerpo, "    </PmtInf>", "  </CstmrDrctDbtInitn>", "</Document>", ""].join("\n");
}
