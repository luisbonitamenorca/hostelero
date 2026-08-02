import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigirPerfil, ACCESO_POR_ROL } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Módulos que ya tienen su propia app dentro del esqueleto: su tarjeta entra ahí. */
const RUTAS_MODULO: Record<string, string> = {
  visitas: "/visitas",
};

export default async function PaginaModulo({
  params,
}: {
  params: Promise<{ modulo: string }>;
}) {
  const { modulo } = await params;
  const { supabase, perfil, cuenta } = await exigirPerfil();

  const [{ data: definicion }, { data: contratacion }] = await Promise.all([
    supabase.from("modulos").select("id, nombre, area").eq("id", modulo).maybeSingle(),
    supabase
      .from("modulos_contratados")
      .select("activo")
      .eq("cuenta_id", cuenta.id)
      .eq("modulo_id", modulo)
      .maybeSingle(),
  ]);

  const permitidos = ACCESO_POR_ROL[perfil.rol] ?? null;
  const conAcceso =
    definicion &&
    contratacion?.activo === true &&
    (permitidos === null || permitidos.includes(modulo));

  if (!conAcceso) notFound();

  // Módulo ya portado: su tarjeta lleva a su propia app (que revalida el acceso).
  if (RUTAS_MODULO[modulo]) redirect(RUTAS_MODULO[modulo]);

  return (
    <>
      <header className="cabecera">
        <div className="cabecera-interior">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span className="marca">{cuenta.nombre}</span>
            <span className="pildora-rol">Hostelero</span>
          </div>
          <div className="cabecera-derecha">
            <span>{perfil.correo}</span>
          </div>
        </div>
      </header>

      <main className="contenido">
        <Link href="/" className="migas">
          ← Inicio
        </Link>

        <h1 className="titulo">{definicion.nombre}</h1>
        <p className="subtitulo">{definicion.area}</p>

        <div
          style={{
            border: "1px dashed var(--borde)",
            borderRadius: 10,
            background: "var(--blanco)",
            padding: "40px 24px",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 15, margin: "0 0 6px" }}>
            Este módulo todavía no está dentro del esqueleto.
          </p>
          <p style={{ fontSize: 14, color: "var(--gris)", margin: 0 }}>
            Entra cuando le toque. Compras va primero.
          </p>
        </div>
      </main>

      <footer className="pie">
        <div className="pie-interior">Hostelero · {cuenta.nombre}</div>
      </footer>
    </>
  );
}
