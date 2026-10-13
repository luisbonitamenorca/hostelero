import "./pedidos.css";
import { CabeceraModulo } from "@/app/cabecera-modulo";
import type { Metadata } from "next";
import { exigirModulo } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pedidos · Jano",
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
      <CabeceraModulo modulo="Pedidos" cuenta={cuenta.nombre} correo={perfil.correo} claseInterior="ped-cabecera" />
      {children}
    </>
  );
}
