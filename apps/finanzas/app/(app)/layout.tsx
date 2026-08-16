import { exigirFacturacion } from "@/lib/supabase/server";
import BotonSalir from "./boton-salir";
import Navegacion from "./navegacion";

/** Cada entrada declara de qué módulo depende: si la cuenta no lo tiene
 *  contratado, no se enseña. Antes se enseñaba siempre, y una cuenta con
 *  facturación pero sin contabilidad veía «Plan de cuentas» y se comía un
 *  «no encontrado» al pincharlo. */
const grupos = [
  { titulo: null, items: [{ ruta: "/panel", nombre: "Panel", modulo: null }] },
  {
    titulo: "Ventas",
    items: [
      { ruta: "/facturas", nombre: "Facturas emitidas", modulo: "facturacion" },
      { ruta: "/clientes", nombre: "Clientes", modulo: "facturacion" },
      { ruta: "/series", nombre: "Series", modulo: "facturacion" },
    ],
  },
  {
    // El maestro y la entrada de estos documentos viven en el módulo de
    // compras; aquí se consultan con ojos de contabilidad.
    titulo: "Compras",
    items: [
      { ruta: "/facturas-recibidas", nombre: "Facturas recibidas", modulo: "compras" },
      { ruta: "/proveedores", nombre: "Proveedores", modulo: "compras" },
    ],
  },
  {
    titulo: "Cartera",
    items: [{ ruta: "/cartera", nombre: "Cobros y pagos", modulo: "facturacion" }],
  },
  {
    titulo: "Remesas",
    items: [
      { ruta: "/remesas", nombre: "Remesas", modulo: "facturacion" },
      { ruta: "/mandatos", nombre: "Mandatos SEPA", modulo: "facturacion" },
      { ruta: "/bancos", nombre: "Cuentas bancarias", modulo: "facturacion" },
    ],
  },
  {
    titulo: "Contabilidad",
    items: [{ ruta: "/plan-cuentas", nombre: "Plan de cuentas", modulo: "contabilidad" }],
  },
];

const enCamino = [
  { nombre: "Bancos", fase: "F2" },
  { nombre: "Impuestos", fase: "F3" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Guard del servidor: sesión + módulo contratado + rol. Nada se pinta antes.
  const { supabase, perfil, cuenta } = await exigirFacturacion();

  const { data: contratados } = await supabase
    .from("modulos_contratados")
    .select("modulo_id")
    .eq("cuenta_id", cuenta.id)
    .eq("activo", true);

  const activos = new Set((contratados ?? []).map((m) => m.modulo_id));

  const gruposVisibles = grupos
    .map((g) => ({ ...g, items: g.items.filter((it) => !it.modulo || activos.has(it.modulo)) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="aplicacion">
      <aside className="lateral">
        <div className="marca">
          <span className="marca-nombre">Hostelero</span>
          <span className="marca-modulo">Finanzas</span>
        </div>
        <Navegacion grupos={gruposVisibles} enCamino={enCamino} />
        <div className="lateral-pie">
          <p className="usuario" title={perfil.correo ?? undefined}>
            {perfil.correo}
          </p>
          <div className="lateral-botones">
            {/* <a> y no <Link>: hay que salir del basePath /finanzas para volver
                a la portada, que es la raíz del mismo dominio. Mismo sitio y
                mismo peso visual que el «← Inicio» del resto de módulos. */}
            <a className="boton-fantasma" href="/">
              ← Inicio
            </a>
            <BotonSalir />
          </div>
        </div>
      </aside>
      <main className="contenido">{children}</main>
    </div>
  );
}
