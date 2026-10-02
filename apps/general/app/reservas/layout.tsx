import "./reservas.css";
import type { Metadata } from "next";
import Link from "next/link";
import { exigirModulo } from "@/lib/supabase/server";
import { cerrarSesion } from "../acciones";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reservas · Hostelero",
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
      <header className="cabecera rsv-cabecera">
        <div className="rsv-cabecera-interior">
          <div className="rsv-cabecera-izq">
            <span className="marca">{cuenta.nombre}</span>
            <span className="pildora-rol">Reservas</span>
          </div>
          <div className="cabecera-derecha rsv-cabecera-der">
            <span className="rsv-correo">{perfil.correo}</span>
            <Link href="/" className="boton-secundario rsv-boton">
              ← Inicio
            </Link>
            <form action={cerrarSesion}>
              <button className="boton-secundario rsv-boton" type="submit">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
