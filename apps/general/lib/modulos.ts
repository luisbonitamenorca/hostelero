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
  // Apps de un solo HTML servidas por app/{pyg,ratios}/route.ts con la sesión
  // de la casa; sus datos siguen en el proyecto Ratios de Supabase
  // (independiente, fase de pruebas — el port de datos es decisión de noviembre).
  pyg: "/pyg",
  // PyG en sombra desde Contabilidad (15-09-2026); sustituirá a pyg a fin de año.
  pyg_pruebas: "/pyg-pruebas",
  ratios: "/ratios",
  // Igual que los dos de arriba, pero conserva su login interno (Supabase
  // Auth propio del proyecto agentes) y proxea /api/agentes/* a su Vercel.
  agentes: "/agentes",
  // Como pyg/ratios (sin login interno que quitar: no traía) y con pasarela
  // /api/compras/* a su Vercel. La URL original sigue viva para el equipo.
  compras: "/compras",
  mantenimiento: "/mantenimiento",
  // Presupuesto (15-09-2026): tablas pre_* en esta casa, sin login interno.
  presupuesto: "/presupuesto",
  // Autogestion del dueño: alta de usuarios y vetos por modulo (solo direccion).
  usuarios: "/usuarios",
  contabilidad: "/finanzas",
  // Pedidos a proveedores (04-10-2026): dictado/catálogo → borradores → envío → cotejo.
  pedidos: "/pedidos",
};

/**
 * Accesos directos a aplicaciones EXTERNAS por cuenta, mientras no se integran en el esqueleto.
 * La ficha de la portada abre /m/<modulo> en una pestaña nueva; /m/<modulo> revalida el acceso
 * (contratado + rol + vetos) y redirige aquí. Las demás cuentas siguen viendo «Próximamente».
 */
const ENLACES_EXTERNOS: Record<string, Record<string, string>> = {
  // Bonita Menorca · TPV de Joan (JS Technology), 04-10-2026, hasta integrarlo.
  "082c5366-d9ae-49b9-a8b8-8caad73985bd": {
    tpv: "http://jstechnologymenorcasl.ddns.net:7870/",
  },
};

/** URL externa del módulo para esta cuenta, o null si no tiene acceso directo. */
export function enlaceExterno(moduloId: string, cuentaId: string): string | null {
  return ENLACES_EXTERNOS[cuentaId]?.[moduloId] ?? null;
}

/**
 * Módulos que se sirven desde UNA sola aplicación. La portada pinta una ficha
 * por grupo, no una por módulo contratado.
 *
 * El motivo: los módulos del área Finanzas (contabilidad, bancos, impuestos
 * y remesas) son la misma app. Con una ficha por módulo, el área acabaría con
 * varias tarjetas que abren exactamente la misma pantalla.
 *
 * Esto NO cambia la contratación, que sigue siendo por módulo y es lo que se
 * factura: cada pantalla comprueba la suya por dentro. Facturación se fusionó
 * en contabilidad el 25-08-2026 (pedido de Luis): un solo módulo para toda la
 * app contable. Solo cambia cómo se dibuja la portada.
 */
export const GRUPOS_PORTADA: { id: string; nombre: string; ruta: string; modulos: string[] }[] = [
  {
    id: "finanzas",
    nombre: "Contabilidad",
    ruta: "/finanzas",
    modulos: ["contabilidad", "bancos", "impuestos", "remesas"],
  },
];

/** ¿Este módulo se pinta dentro de una ficha agrupada? */
export function grupoDe(moduloId: string) {
  return GRUPOS_PORTADA.find((g) => g.modulos.includes(moduloId));
}
