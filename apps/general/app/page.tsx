import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirPerfil, ACCESO_POR_ROL } from "@/lib/supabase/server";
import { RUTAS_MODULO, GRUPOS_PORTADA, grupoDe } from "@/lib/modulos";
import { cerrarSesion } from "./acciones";

export const dynamic = "force-dynamic";

const ROLES: Record<string, string> = {
  direccion: "Dirección",
  responsable_area: "Responsable de área",
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

  const [{ data: contratados, error }, { data: modulos }, { data: vetos }, { data: concesiones }] = await Promise.all([
    supabase
      .from("modulos_contratados")
      .select("modulo_id, activo")
      .eq("cuenta_id", cuenta.id)
      .eq("activo", true),
    supabase.from("modulos").select("id, nombre, area, madurez").order("id"),
    // Vetos por usuario (modulo Usuarios): restan sobre lo que el rol permite.
    supabase.from("modulos_vetados").select("modulo_id").eq("perfil_id", perfil.id),
    // Concesiones: suman un módulo concreto por encima del rol. El veto manda.
    supabase.from("modulos_concedidos").select("modulo_id").eq("perfil_id", perfil.id),
  ]);

  const idsContratados = new Set((contratados ?? []).map((m) => m.modulo_id));
  const idsVetados = new Set((vetos ?? []).map((v) => v.modulo_id));
  const idsConcedidos = new Set((concesiones ?? []).map((c) => c.modulo_id));
  const permitidos = ACCESO_POR_ROL[perfil.rol] ?? null;

  const visibles = (modulos ?? []).filter(
    (m) =>
      idsContratados.has(m.id) &&
      (permitidos === null || permitidos.includes(m.id) || idsConcedidos.has(m.id)) &&
      !idsVetados.has(m.id)
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
          areas.map((area) => {
            const delArea = visibles.filter((m) => m.area === area);
            // Los módulos que comparten app se colapsan en una sola ficha.
            const grupos = GRUPOS_PORTADA.filter((g) =>
              delArea.some((m) => g.modulos.includes(m.id))
            );
            const sueltos = delArea.filter((m) => !grupoDe(m.id));

            // Lo operativo primero; lo beta después con su etiqueta. Un grupo
            // (Contabilidad) es beta mientras todos sus módulos lo sean.
            const esBeta = (m: { madurez?: string | null }) => m.madurez !== "operativo";
            const grupoBeta = (g: (typeof grupos)[number]) =>
              delArea.filter((m) => g.modulos.includes(m.id)).every(esBeta);
            const sueltosOrdenados = [...sueltos].sort(
              (a, b) => Number(esBeta(a)) - Number(esBeta(b))
            );

            return (
              <section key={area} style={{ marginBottom: 26 }}>
                <h2 className="rotulo">{area}</h2>
                <div className="rejilla-lanzadera">
                  {grupos.map((g) => (
                    <Link key={g.id} href={g.ruta} className="tarjeta-modulo">
                      <span className="nombre-modulo">{g.nombre}</span>
                      {grupoBeta(g) && <span className="etiqueta-beta">Versión beta</span>}
                    </Link>
                  ))}
                  {sueltosOrdenados.map((m) =>
                    RUTAS_MODULO[m.id] ? (
                      <Link key={m.id} href={`/m/${m.id}`} className="tarjeta-modulo">
                        <span className="nombre-modulo">{m.nombre}</span>
                        {esBeta(m) && <span className="etiqueta-beta">Versión beta</span>}
                      </Link>
                    ) : (
                      // Contratado pero aún sin app en el esqueleto: sombreado, sin enlace.
                      <div key={m.id} className="tarjeta-modulo no-disponible">
                        <span className="nombre-modulo">{m.nombre}</span>
                        <span className="etiqueta-proximamente">Próximamente</span>
                      </div>
                    )
                  )}
                </div>
              </section>
            );
          })
        )}
      </main>

      <footer className="pie">
        <div className="pie-interior">Hostelero · {cuenta.nombre}</div>
      </footer>
    </>
  );
}
