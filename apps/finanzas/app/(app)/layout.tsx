import Link from "next/link";
import { exigirFacturacion } from "@/lib/supabase/server";
import { cerrarSesion } from "../acciones";
import Navegacion from "./navegacion";

const grupos = [
  { titulo: null, items: [{ ruta: "/panel", nombre: "Panel" }] },
  {
    titulo: "Facturación",
    items: [
      { ruta: "/facturas", nombre: "Facturas" },
      { ruta: "/clientes", nombre: "Clientes" },
      { ruta: "/series", nombre: "Series" },
    ],
  },
  {
    titulo: "Contabilidad",
    items: [{ ruta: "/plan-cuentas", nombre: "Plan de cuentas" }],
  },
];

const enCamino = [
  { nombre: "Bancos", fase: "F2" },
  { nombre: "Impuestos", fase: "F3" },
  { nombre: "Remesas", fase: "F4" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Guard del servidor: sesión + módulo contratado + rol. Nada se pinta antes.
  const { perfil } = await exigirFacturacion();

  return (
    <div className="aplicacion">
      <aside className="lateral">
        <div className="marca">
          <span className="marca-nombre">Hostelero</span>
          <span className="marca-modulo">Finanzas</span>
        </div>
        <Navegacion grupos={grupos} enCamino={enCamino} />
        <div className="lateral-pie">
          <p className="usuario" title={perfil.correo ?? undefined}>
            {perfil.correo}
          </p>
          <form action={cerrarSesion}>
            <button className="boton-fantasma" type="submit">
              Salir
            </button>
          </form>
          <p className="volver">
            <Link className="enlace-tenue" href="https://hostelero-app.vercel.app">
              ← Volver a Hostelero
            </Link>
          </p>
        </div>
      </aside>
      <main className="contenido">{children}</main>
    </div>
  );
}
