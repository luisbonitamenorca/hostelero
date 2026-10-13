import "./reservas.css";
import { CabeceraModulo } from "@/app/cabecera-modulo";
import type { Metadata } from "next";
import { exigirModulo } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reservas · Jano",
  description: "Panel de sala: reservas, plano, cronograma, clientes y lista de espera.",
  // El panel está pensado para tablet y ordenador; sin zoom accidental al tocar un campo.
  other: { "apple-mobile-web-app-capable": "yes" },
};

/* Capa de página: cabecera compacta del esqueleto + panel a toda la altura (100dvh) sin scroll
   de página. Lo que desborda hace scroll dentro del panel (main), como una app. */
export default async function ReservasLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { perfil, cuenta } = await exigirModulo("reservas");

  return (
    <div className="rsv-capa">
      <CabeceraModulo modulo="Reservas" cuenta={cuenta.nombre} correo={perfil.correo} clase="rsv-cabecera" claseInterior="rsv-cabecera-interior" />
      {children}
    </div>
  );
}
