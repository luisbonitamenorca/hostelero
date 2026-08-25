import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirModulo } from "@/lib/supabase/server";
import { crearUsuario, cambiarVeto } from "./acciones";
import FilaAcciones from "./fila-acciones";

export const dynamic = "force-dynamic";

const ROLES: { id: string; nombre: string; pista: string }[] = [
  { id: "direccion", nombre: "Dirección", pista: "ve todo (salvo vetos)" },
  { id: "responsable_area", nombre: "Responsable de área", pista: "ratios, personal, TPV, compras, clientes, documentos, reservas" },
  { id: "administracion", nombre: "Administración", pista: "compras, documentos, clientes, formación" },
  { id: "jefe_sala", nombre: "Jefe de sala", pista: "reservas, visitas, TPV, personal" },
  { id: "empleado", nombre: "Empleado", pista: "solo la app de empleado (fichar)" },
];

const ERRORES: Record<string, string> = {
  datos: "Faltan datos o el correo no es válido.",
  clave: "La contraseña temporal necesita al menos 8 caracteres.",
  existe: "Ya hay un usuario con ese correo.",
  auth: "No se pudo crear el usuario. Vuelve a intentarlo.",
  perfil: "No se pudo crear el perfil; el alta se ha deshecho entera.",
  configuracion: "Falta configuración en el servidor (clave de servicio).",
  propio: "No puedes vetarte a ti mismo el módulo de Usuarios: te quedarías fuera de esta pantalla.",
  "propio-rol": "Tu propio rol no se cambia desde aquí: la única dirección podría degradarse y dejar la cuenta sin gestión.",
  "propio-borrado": "No puedes borrarte a ti mismo.",
};

export default async function Usuarios({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, perfil, cuenta } = await exigirModulo("usuarios");
  // El módulo es de dirección: gestionar personas y permisos no se delega
  // por defecto. Otros roles ni siquiera lo ven en la portada.
  if (perfil.rol !== "direccion") redirect("/no-autorizado");

  const [{ data: gente }, { data: contratados }, { data: modulos }, { data: vetos }] =
    await Promise.all([
      supabase
        .from("perfiles")
        .select("id, nombre, correo, rol")
        .eq("cuenta_id", cuenta.id)
        .order("nombre"),
      supabase
        .from("modulos_contratados")
        .select("modulo_id")
        .eq("cuenta_id", cuenta.id)
        .eq("activo", true),
      supabase.from("modulos").select("id, nombre, area").order("area"),
      supabase.from("modulos_vetados").select("perfil_id, modulo_id").eq("cuenta_id", cuenta.id),
    ]);

  const idsContratados = new Set((contratados ?? []).map((c) => c.modulo_id));
  const modulosDeLaCuenta = (modulos ?? []).filter((m) => idsContratados.has(m.id));
  const vetado = new Set((vetos ?? []).map((v) => `${v.perfil_id}|${v.modulo_id}`));

  return (
    <>
      <header className="cabecera">
        <div className="cabecera-interior">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span className="marca">{cuenta.nombre}</span>
            <span className="pildora-rol">Usuarios</span>
          </div>
          <div className="cabecera-derecha">
            <Link href="/" className="boton-secundario" style={{ padding: "5px 10px", fontSize: 12 }}>
              ← Inicio
            </Link>
          </div>
        </div>
      </header>

      <main className="contenido">
        {sp.error && <p className="aviso-error">{ERRORES[sp.error] ?? "Algo ha fallado."}</p>}
        {sp.borrado && (
          <div className="tarjeta" style={{ marginBottom: 20 }}>
            <p>Usuario borrado: su acceso, su perfil y sus vetos han desaparecido a la vez.</p>
          </div>
        )}
        {sp.creado && (
          <div className="tarjeta" style={{ marginBottom: 20, borderColor: "var(--verde, #0F6E56)" }}>
            <p>
              <strong>{sp.creado}</strong> ya puede entrar con su correo y la contraseña
              temporal. Pídele que la cambie desde «¿Has olvidado tu contraseña?» en el login.
            </p>
          </div>
        )}

        <section style={{ marginBottom: 30 }}>
          <h2 className="rotulo">Dar de alta a alguien</h2>
          <div className="tarjeta">
            <form
              action={crearUsuario}
              style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", alignItems: "end" }}
            >
              <label className="campo" style={{ margin: 0 }}>
                <span>Nombre</span>
                <input name="nombre" type="text" required placeholder="Sonia" />
              </label>
              <label className="campo" style={{ margin: 0 }}>
                <span>Correo</span>
                <input name="correo" type="email" required placeholder="sonia@bonitamenorca.com" />
              </label>
              <label className="campo" style={{ margin: 0 }}>
                <span>Contraseña temporal (mín. 8)</span>
                <input name="clave" type="password" required minLength={8} autoComplete="new-password" />
              </label>
              <label className="campo" style={{ margin: 0 }}>
                <span>Rol</span>
                <select name="rol" defaultValue="direccion">
                  {ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.nombre} — {r.pista}
                    </option>
                  ))}
                </select>
              </label>
              <button className="boton" type="submit" style={{ width: "auto" }}>
                Crear usuario
              </button>
            </form>
          </div>
        </section>

        <section>
          <h2 className="rotulo">Quién ve qué</h2>
          <p style={{ color: "var(--gris, #5F6B65)", fontSize: 13, margin: "0 0 12px" }}>
            El rol marca el máximo; aquí se quita lo que alguien no deba ver. Verde = lo ve;
            pulsa para vetarlo (y al revés). Los cambios valen desde su siguiente carga de página.
          </p>
          <div className="tabla-envoltura" style={{ background: "#fff", border: "1px solid #DDE2DF", borderRadius: 8, overflowX: "auto" }}>
            <table className="tabla" style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Usuario</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Rol · borrar</th>
                  {modulosDeLaCuenta.map((m) => (
                    <th key={m.id} style={{ padding: "12px 8px", fontSize: 11, textAlign: "center" }}>
                      {m.nombre}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(gente ?? []).map((g) => (
                  <tr key={g.id} style={{ borderTop: "1px solid #DDE2DF" }}>
                    <td style={{ padding: "10px 16px" }}>
                      <strong>{g.nombre}</strong>
                      <span style={{ color: "#5F6B65", display: "block", fontSize: 12 }}>{g.correo}</span>
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      <FilaAcciones
                        perfilId={g.id}
                        rol={g.rol ?? "empleado"}
                        nombre={g.nombre ?? g.correo ?? "este usuario"}
                        esYo={g.id === perfil.id}
                        roles={ROLES.map((r) => ({ id: r.id, nombre: r.nombre }))}
                      />
                    </td>
                    {modulosDeLaCuenta.map((m) => {
                      const estaVetado = vetado.has(`${g.id}|${m.id}`);
                      return (
                        <td key={m.id} style={{ padding: "6px 4px", textAlign: "center" }}>
                          <form action={cambiarVeto}>
                            <input type="hidden" name="perfil" value={g.id} />
                            <input type="hidden" name="modulo" value={m.id} />
                            <input type="hidden" name="vetar" value={estaVetado ? "no" : "si"} />
                            <button
                              type="submit"
                              title={estaVetado ? `Vetado — pulsar para que ${g.nombre} lo vea` : `Lo ve — pulsar para vetar`}
                              style={{
                                width: 30, height: 30, borderRadius: 6, border: "1px solid #DDE2DF",
                                cursor: "pointer", fontSize: 14,
                                background: estaVetado ? "#FCEBEB" : "#E1F5EE",
                              }}
                            >
                              {estaVetado ? "✕" : "✓"}
                            </button>
                          </form>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: "var(--gris, #5F6B65)", fontSize: 13, marginTop: 12 }}>
            El veto manda sobre el rol, pero no lo amplía: vetar no da acceso a nada, y un
            módulo que el rol no permite sigue sin verse aunque no tenga veto. Las bajas de
            usuarios, de momento, pídemelas.
          </p>
        </section>
      </main>
    </>
  );
}
