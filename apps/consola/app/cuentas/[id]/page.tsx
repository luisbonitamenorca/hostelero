import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirOperador } from "@/lib/supabase/server";
import {
  actualizarCentro,
  actualizarCuenta,
  actualizarSociedad,
  alternarModulo,
  cerrarSesion,
  crearCentro,
  crearSociedad,
} from "../../acciones";

export const dynamic = "force-dynamic";

const AVISOS_OK: Record<string, string> = {
  cuenta: "Datos de la cuenta guardados.",
  sociedad: "Sociedad guardada.",
  centro: "Centro guardado.",
};

const AVISOS_ERROR: Record<string, string> = {
  nombre: "El nombre es obligatorio.",
  guardar: "No se ha podido guardar. Vuelve a intentarlo.",
  modulo: "No se ha podido cambiar el módulo. Vuelve a intentarlo.",
};

export default async function DetalleCuenta({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { id } = await params;
  const { ok, error: err } = await searchParams;
  const { supabase, operador } = await exigirOperador();

  const [{ data: cuenta }, { data: modulos }] = await Promise.all([
    supabase
      .from("cuentas")
      .select(
        "id, nombre, plan, estado, creada_en, sociedades(id, nombre, cif, direccion, telefono, email, centros(id, nombre, direccion, telefono, email, persona_contacto, observaciones)), perfiles(id, correo, nombre, rol), modulos_contratados(modulo_id, activo)"
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

        {ok && AVISOS_OK[ok] && <p className="aviso-ok">{AVISOS_OK[ok]}</p>}
        {err && AVISOS_ERROR[err] && (
          <p className="aviso-error">{AVISOS_ERROR[err]}</p>
        )}

        <section>
          <h2 className="rotulo">Cuenta</h2>
          <div className="tarjeta">
            <form action={actualizarCuenta} className="form-bloque">
              <input type="hidden" name="id" value={cuenta.id} />
              <div className="rejilla-campos">
                <div className="campo">
                  <label htmlFor="c-nombre">Nombre</label>
                  <input
                    id="c-nombre"
                    name="nombre"
                    defaultValue={cuenta.nombre}
                    required
                  />
                </div>
                <div className="campo">
                  <label htmlFor="c-plan">Plan</label>
                  <select id="c-plan" name="plan" defaultValue={cuenta.plan}>
                    <option value="basico">Básico</option>
                    <option value="operaciones">Operaciones</option>
                    <option value="completo">Completo</option>
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor="c-estado">Estado</label>
                  <select id="c-estado" name="estado" defaultValue={cuenta.estado}>
                    <option value="en_pruebas">En pruebas</option>
                    <option value="activa">Activa</option>
                    <option value="suspendida">Suspendida</option>
                    <option value="baja">Baja</option>
                  </select>
                </div>
              </div>
              <button className="boton" type="submit">
                Guardar cuenta
              </button>
            </form>
          </div>
        </section>

        <section>
          <h2 className="rotulo">Sociedades y centros</h2>
          {cuenta.sociedades.map((s) => (
            <div key={s.id} className="tarjeta">
              <form action={actualizarSociedad} className="form-bloque">
                <input type="hidden" name="cuenta_id" value={cuenta.id} />
                <input type="hidden" name="sociedad_id" value={s.id} />
                <div className="rejilla-campos">
                  <div className="campo">
                    <label>Razón social</label>
                    <input name="nombre" defaultValue={s.nombre} required />
                  </div>
                  <div className="campo">
                    <label>CIF</label>
                    <input name="cif" defaultValue={s.cif ?? ""} />
                  </div>
                  <div className="campo">
                    <label>Teléfono</label>
                    <input name="telefono" type="tel" defaultValue={s.telefono ?? ""} />
                  </div>
                  <div className="campo">
                    <label>Email de contacto</label>
                    <input name="email" type="email" defaultValue={s.email ?? ""} />
                  </div>
                  <div className="campo campo-ancho">
                    <label>Dirección</label>
                    <input name="direccion" defaultValue={s.direccion ?? ""} />
                  </div>
                </div>
                <button className="boton" type="submit">
                  Guardar sociedad
                </button>
              </form>

              {s.centros.map((c) => (
                <details key={c.id} className="pliegue">
                  <summary>
                    <span className="sumario-nombre">{c.nombre}</span>
                    <span className="sumario-detalle">
                      {[c.direccion, c.persona_contacto].filter(Boolean).join(" · ")}
                    </span>
                  </summary>
                  <form action={actualizarCentro} className="form-bloque">
                    <input type="hidden" name="cuenta_id" value={cuenta.id} />
                    <input type="hidden" name="centro_id" value={c.id} />
                    <div className="rejilla-campos">
                      <div className="campo">
                        <label>Nombre</label>
                        <input name="nombre" defaultValue={c.nombre} required />
                      </div>
                      <div className="campo">
                        <label>Persona de contacto</label>
                        <input
                          name="persona_contacto"
                          defaultValue={c.persona_contacto ?? ""}
                        />
                      </div>
                      <div className="campo">
                        <label>Teléfono</label>
                        <input name="telefono" type="tel" defaultValue={c.telefono ?? ""} />
                      </div>
                      <div className="campo">
                        <label>Email</label>
                        <input name="email" type="email" defaultValue={c.email ?? ""} />
                      </div>
                      <div className="campo campo-ancho">
                        <label>Dirección</label>
                        <input name="direccion" defaultValue={c.direccion ?? ""} />
                      </div>
                      <div className="campo campo-ancho">
                        <label>Observaciones</label>
                        <textarea
                          name="observaciones"
                          defaultValue={c.observaciones ?? ""}
                        />
                      </div>
                    </div>
                    <button className="boton" type="submit">
                      Guardar centro
                    </button>
                  </form>
                </details>
              ))}

              <details className="pliegue">
                <summary>
                  <span className="sumario-nombre" style={{ color: "var(--verde)" }}>
                    Añadir centro a {s.nombre}
                  </span>
                </summary>
                <form action={crearCentro} className="form-bloque">
                  <input type="hidden" name="cuenta_id" value={cuenta.id} />
                  <input type="hidden" name="sociedad_id" value={s.id} />
                  <div className="rejilla-campos">
                    <div className="campo">
                      <label>Nombre</label>
                      <input name="nombre" required placeholder="Nombre del centro" />
                    </div>
                    <div className="campo">
                      <label>Persona de contacto</label>
                      <input name="persona_contacto" />
                    </div>
                    <div className="campo">
                      <label>Teléfono</label>
                      <input name="telefono" type="tel" />
                    </div>
                    <div className="campo">
                      <label>Email</label>
                      <input name="email" type="email" />
                    </div>
                    <div className="campo campo-ancho">
                      <label>Dirección</label>
                      <input name="direccion" />
                    </div>
                    <div className="campo campo-ancho">
                      <label>Observaciones</label>
                      <textarea name="observaciones" />
                    </div>
                  </div>
                  <button className="boton" type="submit">
                    Crear centro
                  </button>
                </form>
              </details>
            </div>
          ))}

          <div className="tarjeta">
            <details className="pliegue" style={{ borderTop: "none" }}>
              <summary>
                <span className="sumario-nombre" style={{ color: "var(--verde)" }}>
                  Añadir sociedad
                </span>
              </summary>
              <form action={crearSociedad} className="form-bloque">
                <input type="hidden" name="cuenta_id" value={cuenta.id} />
                <div className="rejilla-campos">
                  <div className="campo">
                    <label>Razón social</label>
                    <input name="nombre" required placeholder="Nueva Sociedad SL" />
                  </div>
                  <div className="campo">
                    <label>CIF</label>
                    <input name="cif" />
                  </div>
                  <div className="campo">
                    <label>Teléfono</label>
                    <input name="telefono" type="tel" />
                  </div>
                  <div className="campo">
                    <label>Email de contacto</label>
                    <input name="email" type="email" />
                  </div>
                  <div className="campo campo-ancho">
                    <label>Dirección</label>
                    <input name="direccion" />
                  </div>
                </div>
                <button className="boton" type="submit">
                  Crear sociedad
                </button>
              </form>
            </details>
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
