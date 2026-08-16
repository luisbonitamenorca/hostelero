/**
 * Módulos que ya tienen su propia app dentro del esqueleto. Única fuente:
 * la usan la portada (para sombrear los que aún no están) y /m/[modulo]
 * (para redirigir a la app del módulo). Al portar un módulo nuevo, se
 * añade aquí y las dos pantallas se enteran solas.
 */
export const RUTAS_MODULO: Record<string, string> = {
  visitas: "/visitas",
  reservas: "/reservas",
  crm: "/crm",
  rrhh: "/rrhh",
  curso: "/curso",
  docs: "/docs",
  // Los dos llevan a la misma app: es una sola aplicación con su menú.
  facturacion: "/finanzas",
  contabilidad: "/finanzas",
};

/**
 * Módulos que se sirven desde UNA sola aplicación. La portada pinta una ficha
 * por grupo, no una por módulo contratado.
 *
 * El motivo: los cinco módulos del área Finanzas (facturación, contabilidad,
 * bancos, impuestos y remesas) son la misma app. Con una ficha por módulo, el
 * área acabaría con cinco tarjetas que abren exactamente la misma pantalla.
 *
 * Esto NO cambia la contratación, que sigue siendo por módulo y es lo que se
 * factura: cada pantalla comprueba la suya por dentro (el plan de cuentas
 * exige `contabilidad`, el resto `facturacion`). Solo cambia cómo se dibuja
 * la portada.
 */
export const GRUPOS_PORTADA: { id: string; nombre: string; ruta: string; modulos: string[] }[] = [
  {
    id: "finanzas",
    nombre: "Contabilidad",
    ruta: "/finanzas",
    modulos: ["contabilidad", "facturacion", "bancos", "impuestos", "remesas"],
  },
];

/** ¿Este módulo se pinta dentro de una ficha agrupada? */
export function grupoDe(moduloId: string) {
  return GRUPOS_PORTADA.find((g) => g.modulos.includes(moduloId));
}
