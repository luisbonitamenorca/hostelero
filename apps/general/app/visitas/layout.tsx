import "./visitas.css";
import Link from "next/link";
import { exigirModulo } from "@/lib/supabase/server";
import { cerrarSesion } from "../acciones";
import Tabs from "./_ui/Tabs";

export const dynamic = "force-dynamic";

export default async function VisitasLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { perfil, cuenta } = await exigirModulo("visitas");

  return (
    <>
      <header className="cabecera">
        <div className="cabecera-interior">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span className="marca">{cuenta.nombre}</span>
            <span className="pildora-rol">Visitas</span>
          </div>
          <div className="cabecera-derecha">
            <span>{perfil.correo}</span>
            <Link
              href="/"
              className="boton-secundario"
              style={{ padding: "5px 10px", fontSize: 12, textDecoration: "none" }}
            >
              ← Inicio
            </Link>
            <form action={cerrarSesion}>
              <button
                className="boton-secundario"
                type="submit"
                style={{ padding: "5px 10px", fontSize: 12 }}
              >
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="vis">
        <Tabs />
        <div className="vis-main">{children}</div>
      </div>
    </>
  );
}
