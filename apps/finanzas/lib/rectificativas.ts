/**
 * Constantes de las facturas rectificativas.
 *
 * Vive aquí y no en app/acciones.ts por una regla de Next: un fichero con
 * "use server" SOLO puede exportar funciones async. Exportar de allí este
 * array compilaba sin quejarse y reventaba en producción al cargar el módulo
 * ("A 'use server' file can only export async functions, found object"),
 * tumbando toda pantalla que importara acciones.ts.
 */

/** Códigos de la AEAT (mismas listas que el SII). El texto es el suyo, no una
 *  interpretación: quien elige la causa es quien factura. */
export const CAUSAS_RECTIFICACION = [
  { codigo: "R1", texto: "Error fundado en derecho y art. 80 Uno, Dos y Seis de la Ley del IVA" },
  { codigo: "R2", texto: "Concurso de acreedores (art. 80 Tres)" },
  { codigo: "R3", texto: "Créditos incobrables (art. 80 Cuatro)" },
  { codigo: "R4", texto: "Resto de causas" },
  { codigo: "R5", texto: "Rectificación de facturas simplificadas" },
] as const;
