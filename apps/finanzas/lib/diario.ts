/**
 * Tipos del diario. Sin escapes: la F5a está aplicada y packages/db/types.ts
 * ya conoce fin_confirmar_asiento, centro_id y las columnas de rastro.
 */
export type LineaAsiento = {
  cuentaPlanId: string;
  centroId: string | null;
  descripcion: string | null;
  debe: number;
  haber: number;
};

export type CentroBreve = { id: string; nombre: string };

export type CuentaPlan = { id: string; codigo: string; nombre: string };

export type AsientoCabecera = {
  id: string;
  numero: number | null;
  fecha: string;
  descripcion: string | null;
  estado: "borrador" | "confirmado";
  origen_tipo: string;
};
