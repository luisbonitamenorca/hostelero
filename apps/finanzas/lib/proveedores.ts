/** Listado de proveedores: catálogo de columnas y preferencia de la cuenta (13-10-2026). */

export type ColumnaProveedor = {
  clave: string;
  etiqueta: string;
  /** De dónde sale: el maestro de Compras, la ficha de Finanzas o el cálculo. */
  origen: "compras" | "finanzas" | "calculo";
  numerica?: boolean;
};

/** El nombre va siempre; estas son las que se pueden encender y apagar en Ajustes. */
export const COLUMNAS_PROVEEDOR: ColumnaProveedor[] = [
  { clave: "nif", etiqueta: "NIF", origen: "compras" },
  { clave: "categoria", etiqueta: "Categoría", origen: "compras" },
  { clave: "departamento", etiqueta: "Departamento por defecto", origen: "compras" },
  { clave: "cuenta", etiqueta: "Cuenta", origen: "compras" },
  { clave: "codigo_a3", etiqueta: "Código A3", origen: "compras" },
  { clave: "pago", etiqueta: "Forma y plazo de pago", origen: "finanzas" },
  { clave: "iban", etiqueta: "Cuenta bancaria", origen: "finanzas" },
  { clave: "contacto", etiqueta: "Persona de contacto", origen: "finanzas" },
  { clave: "telefono", etiqueta: "Teléfono", origen: "finanzas" },
  { clave: "email", etiqueta: "Correo", origen: "finanzas" },
  { clave: "facturas", etiqueta: "Nº facturas", origen: "calculo", numerica: true },
  { clave: "facturado", etiqueta: "Facturado", origen: "calculo", numerica: true },
];

export const COLUMNAS_PROVEEDOR_DEFECTO = ["nif", "categoria", "cuenta", "facturas", "facturado", "pago"];

/** Deja solo claves conocidas y en el orden del catálogo. Vacío o inválido → las de defecto. */
export function columnasValidas(claves: unknown): string[] {
  if (!Array.isArray(claves)) return COLUMNAS_PROVEEDOR_DEFECTO;
  const set = new Set(claves.filter((c): c is string => typeof c === "string"));
  const ordenadas = COLUMNAS_PROVEEDOR.map((c) => c.clave).filter((c) => set.has(c));
  return ordenadas.length ? ordenadas : COLUMNAS_PROVEEDOR_DEFECTO;
}

/** Lee la preferencia del jsonb de fin_ajustes, tolerando que no exista. */
export function columnasDeAjustes(ajustes: unknown): string[] {
  const a = (ajustes ?? {}) as { proveedores_columnas?: unknown };
  return columnasValidas(a.proveedores_columnas);
}
