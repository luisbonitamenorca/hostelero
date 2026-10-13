import "./curso.css";
import { CabeceraModulo } from "@/app/cabecera-modulo";
import { exigirModulo } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function CursoLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { perfil, cuenta } = await exigirModulo("curso");

  return (
    <>
      <CabeceraModulo modulo="Formación" cuenta={cuenta.nombre} correo={perfil.correo} />
      {children}
    </>
  );
}
