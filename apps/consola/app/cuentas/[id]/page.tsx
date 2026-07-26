import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirOperador } from "@/lib/supabase/server";
import { alternarModulo, cerrarSesion } from "../../acciones";

export const dynamic = "force-dynamic";

const ETIQUETA_ESTADO: Record<string, string> = {
  activa: "activa",
  en_pruebas: "en pruebas",
  suspendida: "suspendida",
  baja: "baja",
};

export default async function DetalleCuenta({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, operador } = await exigirOperador();

  const [{ data: cuenta }, { data: modulos }] = await Promise.all([
    supabase
      .from("cuentas")
      .select(
        "id, nombre, plan, estado, creada_en, sociedades(id, nombre, cif, centros(id, nombre)), perfiles(id, correo, nombre, rol), modulos_contratados(modulo_id, activo)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("modulos").select("id, nombre, area").order("id"),
  ]);

  if (!cuenta) notFound();

  const contratados = new Map(
    cuenta.modulos_contratados.map((m) => [m.modulo_id, m.activo])
  );

  const ROLES: Record<string, string> = {
    direccion: "Dirección",
    jefe_sala: "Jefe de sala",
    administracion: "Administración",
  };

  return (
    <>
      <header className="cabecera">
        <div className="cabecera-interior">
          <div>
            <span className="marca">Consola Hostelero</span>
            <span className="etiqueta-interno">Interno</span>
          </div>
          <div className="cabecera-derecha">
            <span>{operador.correo}</span>
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
        <Link href="/" className="migas">
          ← Cuentas
        </Link>

        <h1 className="titulo">{cuenta.nombre}</h1>
        <p className="subtitulo">
          plan {cuenta.plan} · alta{" "}
          {new Date(cuenta.creada_en).toLocaleDateString("es-ES")} ·{" "}
          {ETIQUETA_ESTADO[cuenta.estado] ?? cuenta.estado}
        </p>

        <section>
          <h2 className="rotulo">Sociedades y centros</h2>
          <div className="tarjeta">
            {cuenta.sociedades.length === 0 ? (
              <p className="vacio">Sin sociedades todavía.</p>
            ) : (
              cuenta.sociedades.map((s) => (
                <div key={s.id} className="bloque-fila">
                  <div className="nombre-sociedad">
                    {s.nombre}
                    {s.cif && (
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 12,
                          fontWeight: 400,
                          color: "var(--gris-claro)",
                          marginLeft: 10,
                        }}
                      >
                        {s.cif}
                      </span>
                    )}
                  </div>
                  <div className="chips">
                    {s.centros.length === 0 ? (
                      <span className="chip">Sin centros</span>
                    ) : (
                      s.centros.map((c) => (
                        <span key={c.id} className="chip">
                          {c.nombre}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section>
          <h2 className="rotulo">Módulos contratados</h2>
          <div className="tarjeta">
            <div className="rejilla-modulos">
              {(modulos ?? []).map((m) => {
                const activo = contratados.get(m.id) === true;
                return (
                  <form key={m.id} action={alternarModulo}>
                    <input type="hidden" name="cuenta_id" value={cuenta.id} />
                    <input type="hidden" name="modulo_id" value={m.id} />
                    <input type="hidden" name="activo" value={String(activo)} />
                    <button
                      type="submit"
                      className={"modulo-boton" + (activo ? "" : " apagado")}
                    >
                      <span className={"casilla" + (activo ? " marcada" : "")}>
                        {activo ? "✓" : ""}
                      </span>
                      {m.nombre}
                    </button>
                  </form>
                );
              })}
            </div>
          </div>
        </section>

        <section>
          <h2 className="rotulo">Usuarios</h2>
          <div className="tarjeta">
            {cuenta.perfiles.length === 0 ? (
              <p className="vacio">
                Sin usuarios todavía. Se darán de alta cuando la app de cliente
                tenga su pantalla de acceso.
              </p>
            ) : (
              cuenta.perfiles.map((u) => (
                <div key={u.id} className="fila-usuario">
                  <span className="correo">{u.correo}</span>
                  <span className="rol">{ROLES[u.rol] ?? u.rol}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      <footer className="pie">
        <div className="pie-interior">
          Consola interna de Hostelero · solo operadores
        </div>
      </footer>
    </>
  );
}
