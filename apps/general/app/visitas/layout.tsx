import "./visitas.css";
import { CabeceraModulo } from "@/app/cabecera-modulo";
import { exigirModulo } from "@/lib/supabase/server";
import Tabs from "./_ui/Tabs";

export const dynamic = "force-dynamic";

export default async function VisitasLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { perfil, cuenta } = await exigirModulo("visitas");

  return (
    <>
      <CabeceraModulo modulo="Visitas" cuenta={cuenta.nombre} correo={perfil.correo} />

      <div className="vis">
        <Tabs />
        <div className="vis-main">{children}</div>
      </div>
    </>
  );
}
