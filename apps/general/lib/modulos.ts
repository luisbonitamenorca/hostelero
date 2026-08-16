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
  // Finanzas vive en apps/finanzas y se sirve por rewrite bajo este dominio
  // (ver next.config.mjs). Las dos entradas apuntan a la misma app.
  facturacion: "/finanzas",
  contabilidad: "/finanzas/plan-cuentas",
};
