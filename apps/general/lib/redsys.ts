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
