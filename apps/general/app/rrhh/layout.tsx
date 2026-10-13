import "./rrhh.css";
import { CabeceraModulo } from "@/app/cabecera-modulo";
import { exigirModulo } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RrhhLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { perfil, cuenta } = await exigirModulo("rrhh");

  return (
    <>
      <CabeceraModulo modulo="Personal" cuenta={cuenta.nombre} correo={perfil.correo} />
      {children}
    </>
  );
}
