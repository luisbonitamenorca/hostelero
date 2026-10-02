import { createCipheriv, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma y validación del TPV Virtual de CaixaBank (Cyberpac, tecnología
 * Redsys), integración por redirección: el cliente paga EN la página del
 * banco y nosotros nunca vemos la tarjeta.
 *
 * El esquema de firma es el HMAC_SHA256_V1 de Redsys y es idéntico en test y
 * en real; lo único que cambia entre entornos son las cuatro variables de
 * entorno (comercio, terminal, clave y URL), que viven en Vercel y JAMÁS en
 * este repo, que es público:
 *   TPV_COMERCIO   — Ds_Merchant_MerchantCode
 *   TPV_TERMINAL   — normalmente "1"
 *   TPV_CLAVE      — clave secreta de cifrado, en Base64
 *   TPV_URL        — https://sis-t.redsys.es:25443/sis/realizarPago (test)
 *                    https://sis.redsys.es/sis/realizarPago        (real)
 */

export type ConfigTpv = { comercio: string; terminal: string; clave: string; url: string };

export function configTpv(): ConfigTpv | null {
  const comercio = process.env.TPV_COMERCIO;
  const terminal = process.env.TPV_TERMINAL;
  const clave = process.env.TPV_CLAVE;
  const url = process.env.TPV_URL;
  if (!comercio || !terminal || !clave || !url) return null;
  return { comercio, terminal, clave, url };
}

/**
 * Número de pedido Redsys: 12 caracteres, los 4 primeros OBLIGATORIAMENTE
 * numéricos y único por comercio. Los 4 dígitos salen del reloj (minutos del
 * año, se repiten cada ~7 días pero el sufijo aleatorio desambigua) y el
 * resto es aleatorio alfanumérico.
 */
export function nuevoPedido(): string {
  const minutosDelAnio = Math.floor((Date.now() % 31536000000) / 60000) % 10000;
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let sufijo = "";
  for (let i = 0; i < 8; i++) sufijo += abc[Math.floor(Math.random() * abc.length)];
  return String(minutosDelAnio).padStart(4, "0") + sufijo;
}

/**
 * Derivación de clave de Redsys: la clave del comercio (Base64) cifra el
 * número de pedido con 3DES-CBC (IV a ceros, relleno con ceros hasta
 * múltiplo de 8). Con esa clave derivada se calcula el HMAC-SHA256 del
 * Base64 de los parámetros. Así cada operación firma con una clave distinta.
 */
function claveDerivada(claveB64: string, pedido: string): Buffer {
  const clave = Buffer.from(claveB64, "base64");
  const iv = Buffer.alloc(8, 0);
  const cifrador = createCipheriv("des-ede3-cbc", clave, iv);
  cifrador.setAutoPadding(false);
  const relleno = Math.ceil(pedido.length / 8) * 8;
  const datos = Buffer.alloc(relleno, 0);
  datos.write(pedido, "utf8");
  return Buffer.concat([cifrador.update(datos), cifrador.final()]);
}

/** Petición lista para el formulario de redirección al TPV. */
export function firmarPeticion(
  cfg: ConfigTpv,
  pedido: string,
  importeCentimos: number,
  extras: Record<string, string>,
): { Ds_SignatureVersion: string; Ds_MerchantParameters: string; Ds_Signature: string } {
  const parametros = {
    DS_MERCHANT_AMOUNT: String(importeCentimos),
    DS_MERCHANT_ORDER: pedido,
    DS_MERCHANT_MERCHANTCODE: cfg.comercio,
    DS_MERCHANT_CURRENCY: "978",
    DS_MERCHANT_TRANSACTIONTYPE: "0",
    DS_MERCHANT_TERMINAL: cfg.terminal,
    ...extras,
  };
  const b64 = Buffer.from(JSON.stringify(parametros), "utf8").toString("base64");
  const firma = createHmac("sha256", claveDerivada(cfg.clave, pedido)).update(b64).digest("base64");
  return { Ds_SignatureVersion: "HMAC_SHA256_V1", Ds_MerchantParameters: b64, Ds_Signature: firma };
}

export type NotificacionTpv = {
  pedido: string;
  /** Código Ds_Response: 0–99 es pago autorizado; 900 devolución aceptada. */
  respuesta: number;
  autorizacion: string | null;
  parametros: Record<string, string>;
};

/**
 * Valida la notificación servidor-a-servidor del banco. Los campos llegan en
 * Base64URL y la firma se comprueba en tiempo constante. Devuelve null si la
 * firma no casa: una notificación sin firma válida no existe.
 */
export function validarNotificacion(
  cfg: ConfigTpv,
  paramsB64Url: string,
  firmaRecibidaB64Url: string,
): NotificacionTpv | null {
  try {
    const b64 = paramsB64Url.replace(/-/g, "+").replace(/_/g, "/");
    const parametros = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Record<string, string>;
    const pedido = parametros.Ds_Order || "";
    if (!pedido) return null;

    // OJO: el HMAC se calcula sobre la cadena RECIBIDA tal cual (Base64URL),
    // no sobre la versión normalizada — así lo define Redsys.
    const esperada = createHmac("sha256", claveDerivada(cfg.clave, pedido))
      .update(paramsB64Url)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    const a = Buffer.from(esperada);
    const b = Buffer.from(firmaRecibidaB64Url);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    return {
      pedido,
      respuesta: parseInt(parametros.Ds_Response ?? "9999", 10),
      autorizacion: parametros.Ds_AuthorisationCode?.trim() || null,
      parametros,
    };
  } catch {
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ampliación para Reservas (garantía con tarjeta, cargo por no-show, devolución).
   Lo de arriba lo usa Visitas y no cambia; todo lo nuevo va en funciones aparte.

   Conceptos Redsys que se usan aquí:
   - COF (Credential On File) = «pago por referencia»: en la primera operación el banco
     nos devuelve un identificador de la tarjeta (Ds_Merchant_Identifier) y un id de
     transacción (Ds_Merchant_Cof_Txnid). Con ellos podemos cobrar después SIN que el
     cliente vuelva a meter la tarjeta y sin que la tarjeta pase por nosotros.
   - Operación de 0 € = tokenización sin cargo (la «garantía»: no se cobra nada ahora).
   - REST (trataPeticionREST) = operaciones servidor-a-servidor (cargo con referencia y
     devolución). Mismo esquema de firma HMAC_SHA256_V1.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Tipos de operación Redsys (DS_MERCHANT_TRANSACTIONTYPE) que usamos. */
export const TPV_OP = { autorizacion: "0", devolucion: "3" } as const;

/** Idioma del TPV (DS_MERCHANT_CONSUMERLANGUAGE). */
export const TPV_IDIOMA: Record<string, string> = { es: "1", en: "2", ca: "3", fr: "4", de: "5", it: "7", pt: "9" };

/**
 * URL del servicio REST, derivada de TPV_URL (misma raíz: sis-t en test, sis en real).
 * Se puede forzar con TPV_URL_REST si algún día cambiara el patrón.
 */
export function urlRest(cfg: ConfigTpv): string {
  const forzada = process.env.TPV_URL_REST;
  if (forzada) return forzada;
  try {
    const u = new URL(cfg.url);
    return `${u.origin}/sis/rest/trataPeticionREST`;
  } catch {
    return "https://sis-t.redsys.es:25443/sis/rest/trataPeticionREST";
  }
}

/** Firma genérica: Base64 de los parámetros + HMAC con la clave derivada del pedido. */
export function firmarParametros(
  cfg: ConfigTpv,
  pedido: string,
  parametros: Record<string, string>,
): { Ds_SignatureVersion: string; Ds_MerchantParameters: string; Ds_Signature: string } {
  const b64 = Buffer.from(JSON.stringify(parametros), "utf8").toString("base64");
  const firma = createHmac("sha256", claveDerivada(cfg.clave, pedido)).update(b64).digest("base64");
  return { Ds_SignatureVersion: "HMAC_SHA256_V1", Ds_MerchantParameters: b64, Ds_Signature: firma };
}

/** Parámetros base de cualquier operación (comercio, terminal, moneda EUR). */
function base(cfg: ConfigTpv, pedido: string, importeCentimos: number, tipo: string): Record<string, string> {
  return {
    DS_MERCHANT_AMOUNT: String(importeCentimos),
    DS_MERCHANT_ORDER: pedido,
    DS_MERCHANT_MERCHANTCODE: cfg.comercio,
    DS_MERCHANT_CURRENCY: "978",
    DS_MERCHANT_TRANSACTIONTYPE: tipo,
    DS_MERCHANT_TERMINAL: cfg.terminal,
  };
}

export type UrlsRetorno = { notificacion: string; ok: string; ko: string };

/**
 * Formulario de redirección para GUARDAR la tarjeta sin cobrar (garantía): operación de
 * 0 € con tokenización COF. El banco devuelve en la notificación Ds_Merchant_Identifier,
 * Ds_Merchant_Cof_Txnid, Ds_Card_Number (enmascarado) y Ds_ExpiryDate.
 * Requiere que CaixaBank tenga activado en el comercio «pago por referencia» y «operaciones
 * de importe 0» (ver docs/reservas-v2-pagos.md).
 */
export function formularioGarantia(
  cfg: ConfigTpv,
  pedido: string,
  urls: UrlsRetorno,
  extras: { descripcion: string; titular?: string; idioma?: string; datos?: string },
) {
  return firmarParametros(cfg, pedido, {
    ...base(cfg, pedido, 0, TPV_OP.autorizacion),
    DS_MERCHANT_IDENTIFIER: "REQUIRED",
    DS_MERCHANT_COF_INI: "S",
    DS_MERCHANT_COF_TYPE: "C",
    DS_MERCHANT_MERCHANTURL: urls.notificacion,
    DS_MERCHANT_URLOK: urls.ok,
    DS_MERCHANT_URLKO: urls.ko,
    DS_MERCHANT_PRODUCTDESCRIPTION: extras.descripcion.slice(0, 125),
    DS_MERCHANT_TITULAR: (extras.titular || "").slice(0, 60),
    DS_MERCHANT_CONSUMERLANGUAGE: TPV_IDIOMA[extras.idioma || "es"] ?? "1",
    ...(extras.datos ? { DS_MERCHANT_MERCHANTDATA: extras.datos.slice(0, 1024) } : {}),
  });
}

/**
 * Formulario de redirección para un COBRO normal (prepago / ticket). Igual que Visitas,
 * pero con las URLs de vuelta de Reservas.
 */
export function formularioCobro(
  cfg: ConfigTpv,
  pedido: string,
  importeCentimos: number,
  urls: UrlsRetorno,
  extras: { descripcion: string; titular?: string; idioma?: string; datos?: string },
) {
  return firmarParametros(cfg, pedido, {
    ...base(cfg, pedido, importeCentimos, TPV_OP.autorizacion),
    DS_MERCHANT_MERCHANTURL: urls.notificacion,
    DS_MERCHANT_URLOK: urls.ok,
    DS_MERCHANT_URLKO: urls.ko,
    DS_MERCHANT_PRODUCTDESCRIPTION: extras.descripcion.slice(0, 125),
    DS_MERCHANT_TITULAR: (extras.titular || "").slice(0, 60),
    DS_MERCHANT_CONSUMERLANGUAGE: TPV_IDIOMA[extras.idioma || "es"] ?? "1",
    ...(extras.datos ? { DS_MERCHANT_MERCHANTDATA: extras.datos.slice(0, 1024) } : {}),
  });
}

/** Datos de tarjeta tokenizada que devuelve el banco (nunca el número completo). */
export type TarjetaCof = {
  identificador: string | null;
  cofTxnid: string | null;
  mascara: string | null;
  /** Caducidad tal cual la da Redsys: «AAMM». */
  caducidad: string | null;
};

/** Extrae los datos COF de los parámetros de una notificación o respuesta REST. */
export function tarjetaDeParametros(p: Record<string, string>): TarjetaCof {
  const limpio = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    identificador: limpio(p.Ds_Merchant_Identifier),
    cofTxnid: limpio(p.Ds_Merchant_Cof_Txnid),
    mascara: limpio(p.Ds_Card_Number ?? p.Ds_CardNumber),
    caducidad: limpio(p.Ds_ExpiryDate),
  };
}

/** Ds_Response 0–99 = autorizada. */
export const respuestaAutorizada = (codigo: number) => codigo >= 0 && codigo <= 99;
/** Ds_Response 900 = devolución (o anulación) aceptada. */
export const respuestaDevuelta = (codigo: number) => codigo === 900;

export type RespuestaRest = {
  ok: boolean;
  /** Código Ds_Response (-1 si no llegó). */
  respuesta: number;
  autorizacion: string | null;
  pedido: string;
  parametros: Record<string, string>;
  /** Código de error SIS (p. ej. SIS0051) o descripción nuestra si no hubo respuesta firmada. */
  error: string | null;
  /**
   * true cuando NO sabemos si el banco ha ejecutado la operación (se cortó la conexión, venció
   * el tiempo de espera o la respuesta llegó ilegible). En ese caso no se debe reintentar a
   * ciegas: hay que mirar la operación en el portal del TPV antes de volver a cobrar.
   */
  incierto: boolean;
};

/** Tiempo máximo de espera de una llamada REST al banco. */
const ESPERA_REST_MS = 25_000;

/**
 * Llamada REST firmada a Redsys (cargo con referencia, devolución…). Comprueba la firma
 * de la respuesta con la misma derivación por pedido. Devuelve ok=false con `error`
 * cuando el banco contesta con errorCode, la firma no casa o no hay respuesta.
 */
export async function peticionRest(
  cfg: ConfigTpv,
  pedido: string,
  parametros: Record<string, string>,
): Promise<RespuestaRest> {
  const vacio: RespuestaRest = { ok: false, respuesta: -1, autorizacion: null, pedido, parametros: {}, error: null, incierto: false };
  const cuerpo = firmarParametros(cfg, pedido, parametros);
  let json: Record<string, string> | null = null;
  try {
    const r = await fetch(urlRest(cfg), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      cache: "no-store",
      signal: AbortSignal.timeout(ESPERA_REST_MS),
    });
    json = (await r.json().catch(() => null)) as Record<string, string> | null;
    // Sin cuerpo legible no sabemos qué ha hecho el banco (un 5xx puede llegar tras ejecutar).
    if (!json) return { ...vacio, error: "sin_respuesta", incierto: true, parametros: { _http: String(r.status) } };
  } catch (e) {
    // Error de red o tiempo agotado: la petición pudo llegar al banco y ejecutarse.
    return { ...vacio, error: "sin_respuesta", incierto: true, parametros: { _detalle: e instanceof Error ? e.message.slice(0, 200) : "?" } };
  }
  // errorCode (SIS0xxx) = el banco ha rechazado la petición antes de ejecutarla: seguro.
  if (json.errorCode) return { ...vacio, error: String(json.errorCode) };
  const params = json.Ds_MerchantParameters;
  const firma = json.Ds_Signature;
  if (!params || !firma) return { ...vacio, error: "respuesta_incompleta", incierto: true };

  // La respuesta REST llega en Base64 estándar; la firma se calcula sobre la cadena recibida.
  let decodificados: Record<string, string>;
  try {
    decodificados = JSON.parse(Buffer.from(params, "base64").toString("utf8")) as Record<string, string>;
  } catch {
    return { ...vacio, error: "respuesta_ilegible", incierto: true };
  }
  const pedidoResp = decodificados.Ds_Order || pedido;
  const esperada = createHmac("sha256", claveDerivada(cfg.clave, pedidoResp)).update(params).digest("base64");
  if (!firmasIguales(esperada, firma)) return { ...vacio, parametros: decodificados, error: "firma_invalida", incierto: true };

  const codigo = parseInt(decodificados.Ds_Response ?? "-1", 10);
  const tipo = decodificados.Ds_TransactionType ?? parametros.DS_MERCHANT_TRANSACTIONTYPE;
  const ok = tipo === TPV_OP.devolucion ? respuestaDevuelta(codigo) : respuestaAutorizada(codigo);
  return {
    ok,
    respuesta: Number.isNaN(codigo) ? -1 : codigo,
    autorizacion: decodificados.Ds_AuthorisationCode?.trim() || null,
    pedido: pedidoResp,
    parametros: decodificados,
    error: ok ? null : `DS_RESPONSE_${Number.isNaN(codigo) ? "?" : codigo}`,
    incierto: false,
  };
}

/** Compara dos firmas Base64 (estándar o URL-safe) en tiempo constante. */
function firmasIguales(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const x = Buffer.from(norm(a));
  const y = Buffer.from(norm(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Cobro posterior con la referencia guardada (MIT: iniciado por el comercio, sin cliente
 * presente): cargo por no-show o cancelación tardía. COF_INI=N + COF_TXNID de la operación
 * inicial, DIRECTPAYMENT=true para que no pida autenticación 3DS.
 */
export function cobrarConReferencia(
  cfg: ConfigTpv,
  pedido: string,
  importeCentimos: number,
  tarjeta: { identificador: string; cofTxnid: string | null },
  descripcion: string,
): Promise<RespuestaRest> {
  return peticionRest(cfg, pedido, {
    ...base(cfg, pedido, importeCentimos, TPV_OP.autorizacion),
    DS_MERCHANT_IDENTIFIER: tarjeta.identificador,
    DS_MERCHANT_DIRECTPAYMENT: "true",
    DS_MERCHANT_EXCEP_SCA: "MIT",
    DS_MERCHANT_COF_INI: "N",
    DS_MERCHANT_COF_TYPE: "C",
    ...(tarjeta.cofTxnid ? { DS_MERCHANT_COF_TXNID: tarjeta.cofTxnid } : {}),
    DS_MERCHANT_PRODUCTDESCRIPTION: descripcion.slice(0, 125),
  });
}

/**
 * Devolución (total o parcial) de un cobro: operación tipo 3 sobre el MISMO número de
 * pedido del cobro original. Ds_Response 900 = aceptada.
 */
export function devolverCobro(cfg: ConfigTpv, pedidoOriginal: string, importeCentimos: number): Promise<RespuestaRest> {
  return peticionRest(cfg, pedidoOriginal, base(cfg, pedidoOriginal, importeCentimos, TPV_OP.devolucion));
}
