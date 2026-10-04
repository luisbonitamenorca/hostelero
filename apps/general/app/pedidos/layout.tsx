import "./pedidos.css";
import type { Metadata } from "next";
import Link from "next/link";
import { exigirModulo } from "@/lib/supabase/server";
import { cerrarSesion } from "../acciones";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pedidos · Hostelero",
  description: "Pedidos a proveedores: por voz, por escrito o por catálogo.",
};

/* Capa de página de Pedidos: cabecera de la casa (como rrhh) y el panel debajo. Móvil primero:
   en pantallas estrechas el correo se oculta para que la cabecera quepa en una línea. */
export default async function PedidosLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { perfil, cuenta } = await exigirModulo("pedidos");

  return (
    <>
      <header className="cabecera">
        <div className="cabecera-interior ped-cabecera">
          <div className="ped-cabecera-izq">
            <span className="marca">{cuenta.nombre}</span>
            <span className="pildora-rol">Pedidos</span>
          </div>
          <div className="cabecera-derecha ped-cabecera-der">
            <span className="ped-cabecera-correo">{perfil.correo}</span>
            <Link href="/" className="boton-secundario ped-cabecera-boton">
              ← Inicio
            </Link>
            <form action={cerrarSesion}>
              <button className="boton-secundario ped-cabecera-boton" type="submit">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
