import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirPerfil, ACCESO_POR_ROL } from "@/lib/supabase/server";
import { cerrarSesion } from "./acciones";

export const dynamic = "force-dynamic";

const ROLES: Record<string, string> = {
  direccion: "Dirección",
  jefe_sala: "Jefe de sala",
  administracion: "Administración",
};

export default async function Portada() {
  const { supabase, perfil, cuenta } = await exigirPerfil();

  // Los empleados tienen su propia app; la lanzadera de módulos es para gestión.
  if (perfil.rol === "empleado") redirect("/empleado");

  if (cuenta.estado === "suspendida" || cuenta.estado === "baja") {
    return (
      <main className="pantalla-login">
        <div className="caja-login">
          <span className="marca" style={{ color: "var(--verde)" }}>Hostelero</span>
          <p style={{ margin: "12px 0 16px", color: "var(--gris)" }}>
            La cuenta de {cuenta.nombre} está {cuenta.estado === "baja" ? "de baja" : "suspendida"}.
            Escribe a soporte de Hostelero para reactivarla.
          </p>
          <form action={cerrarSesion}>
            <button className="boton" type="submit" style={{ background: "var(--verde)" }}>
              Salir
            </button>
          </form>
        </div>
      </main>
    );
  }

  const [{ data: contratados, error }, { data: modulos }] = await Promise.all([
    supabase
      .from("modulos_contratados")
      .select("modulo_id, activo")
      .eq("cuenta_id", cuenta.id)
      .eq("activo", true),
    supabase.from("modulos").select("id, nombre, area").order("id"),
  ]);

  const idsContratados = new Set((contratados ?? []).map((m) => m.modulo_id));
  const permitidos = ACCESO_POR_ROL[perfil.rol] ?? null;

  const visibles = (modulos ?? []).filter(
    (m) => idsContratados.has(m.id) && (permitidos === null || permitidos.includes(m.id))
  );

  const areas = [...new Set(visibles.map((m) => m.area))];

  return (
    <>
      <header className="cabecera">
        <div className="cabecera-interior">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span className="marca">{cuenta.nombre}</span>
            <span className="pildora-rol">Hostelero</span>
          </div>
          <div className="cabecera-derecha">
            <span>
              {perfil.correo} · {ROLES[perfil.rol] ?? perfil.rol}
            </span>
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

      <main className="contenido">
        {error ? (
          <p className="aviso-error">
            No se han podido cargar tus módulos. Recarga la página; si sigue
            pasando, escribe a soporte.
          </p>
        ) : visibles.length === 0 ? (
          <div className="tarjeta">
            <p className="vacio">
              Tu cuenta no tiene módulos activos ahora mismo. Habla con
              Hostelero para activar los que necesites.
            </p>
          </div>
        ) : (
          areas.map((area) => (
            <section key={area} style={{ marginBottom: 26 }}>
              <h2 className="rotulo">{area}</h2>
              <div className="rejilla-lanzadera">
                {visibles
                  .filter((m) => m.area === area)
                  .map((m) => (
                    <Link key={m.id} href={`/m/${m.id}`} className="tarjeta-modulo">
                      <span className="nombre-modulo">{m.nombre}</span>
                    </Link>
                  ))}
              </div>
            </section>
          ))
        )}
      </main>

      <footer className="pie">
        <div className="pie-interior">Hostelero · {cuenta.nombre}</div>
      </footer>
    </>
  );
}
