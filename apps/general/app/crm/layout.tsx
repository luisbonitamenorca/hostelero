import "./crm.css";
import { CabeceraModulo } from "@/app/cabecera-modulo";
import { exigirModulo } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CrmLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { perfil, cuenta } = await exigirModulo("crm");

  return (
    <>
      <CabeceraModulo modulo="Clientes" cuenta={cuenta.nombre} correo={perfil.correo} />
      {children}
    </>
  );
}
