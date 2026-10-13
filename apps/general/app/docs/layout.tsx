import "./docs.css";
import { CabeceraModulo } from "@/app/cabecera-modulo";
import { exigirModulo } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DocsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { perfil, cuenta } = await exigirModulo("docs");

  return (
    <>
      <CabeceraModulo modulo="Documentos" cuenta={cuenta.nombre} correo={perfil.correo} />
      {children}
    </>
  );
}
