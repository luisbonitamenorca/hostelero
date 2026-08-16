"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Grupo = { titulo: string | null; items: { ruta: string; nombre: string }[] };
type Futuro = { nombre: string; fase: string };

/** Solo marca cuál está activo: por eso es lo único del armazón que va al cliente. */
export default function Navegacion({ grupos, enCamino }: { grupos: Grupo[]; enCamino: Futuro[] }) {
  const pathname = usePathname();

  return (
    <nav className="navegacion">
      {grupos.map((g) => (
        <div className="nav-grupo" key={g.titulo ?? "raiz"}>
          {g.titulo && <p className="nav-titulo">{g.titulo}</p>}
          {g.items.map((it) => (
            <Link
              key={it.ruta}
              href={it.ruta}
              className={pathname.startsWith(it.ruta) ? "nav-item activo" : "nav-item"}
            >
              {it.nombre}
            </Link>
          ))}
        </div>
      ))}
      <div className="nav-grupo">
        <p className="nav-titulo">En camino</p>
        {enCamino.map((it) => (
          <span className="nav-item futuro" key={it.fase}>
            {it.nombre} <span className="fase">{it.fase}</span>
          </span>
        ))}
      </div>
    </nav>
  );
}
