import Link from "next/link";
import type { ReactNode } from "react";
import { LogoJano } from "@/app/logo-jano";
import { cerrarSesion } from "@/app/acciones";

/**
 * Cabecera única de la plataforma (13-10-2026): la misma banda en todos los
 * módulos React. Orden fijo a la izquierda: logo de Jano (enlaza a Inicio),
 * nombre del módulo y nombre de la cuenta (Bonita Menorca). A la derecha:
 * correo, lo que el módulo quiera añadir, «← Inicio» y «Salir», siempre en
 * el mismo sitio. Los HTML heredados pintan la misma banda desde
 * lib/banda-jano.ts: si se cambia algo aquí, cambiarlo allí también.
 */
export function CabeceraModulo({
  modulo,
  cuenta,
  correo,
  inicio = true,
  salir = true,
  extra,
  clase,
  claseInterior,
}: {
  modulo: string;
  cuenta: string;
  correo?: string | null;
  /** false en la portada, que ya es Inicio. */
  inicio?: boolean;
  salir?: boolean;
  /** Elementos propios del módulo, entre el correo y los botones. */
  extra?: ReactNode;
  /** Clases extra para header y para su interior (Reservas y Pedidos compactan). */
  clase?: string;
  claseInterior?: string;
}) {
  return (
    <header className={["cabecera", clase].filter(Boolean).join(" ")}>
      <div className={["cabecera-interior", claseInterior].filter(Boolean).join(" ")}>
        <div className="cabecera-izq">
          <Link href="/" className="cabecera-logo" title="Inicio" aria-label="Jano · Inicio">
            <LogoJano tamano={20} />
          </Link>
          <span className="cabecera-modulo">{modulo}</span>
          <span className="cabecera-cuenta">{cuenta}</span>
        </div>
        <div className="cabecera-derecha">
          {correo && <span className="cabecera-correo">{correo}</span>}
          {extra}
          {inicio && (
            <Link href="/" className="boton-secundario cabecera-boton">
              ← Inicio
            </Link>
          )}
          {salir && (
            <form action={cerrarSesion}>
              <button className="boton-secundario cabecera-boton" type="submit">
                Salir
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
