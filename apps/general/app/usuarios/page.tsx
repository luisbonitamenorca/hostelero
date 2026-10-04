import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirModulo, rolIncluye } from "@/lib/supabase/server";
import { crearClienteServicio } from "@/lib/supabase/servicio";
import { cambiarVeto, cambiarConcesion } from "./acciones";
import { ERRORES } from "./errores";
import FilaAcciones from "./fila-acciones";
import FormAlta from "./form-alta";

export const dynamic = "force-dynamic";

const ROLES: { id: string; nombre: string; pista: string }[] = [
  { id: "direccion", nombre: "Dirección", pista: "ve todo (salvo vetos)" },
  { id: "responsable_area", nombre: "Responsable de área", pista: "ratios, personal, TPV, compras, pedidos, clientes, documentos, reservas" },
  { id: "administracion", nombre: "Administración", pista: "compras, documentos, clientes, formación" },
  { id: "jefe_sala", nombre: "Jefe de sala", pista: "reservas, visitas, TPV, personal, pedidos" },
  { id: "empleado", nombre: "Empleado", pista: "solo la app de empleado (fichar)" },
];

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

  const [{ data: gente }, { data: contratados }, { data: modulos }, { data: vetos }, { data: concesiones }] =
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
      supabase.from("modulos_concedidos").select("perfil_id, modulo_id").eq("cuenta_id", cuenta.id),
    ]);

  const idsContratados = new Set((contratados ?? []).map((c) => c.modulo_id));
  const modulosDeLaCuenta = (modulos ?? []).filter((m) => idsContratados.has(m.id));
  const vetado = new Set((vetos ?? []).map((v) => `${v.perfil_id}|${v.modulo_id}`));
  const concedido = new Set((concesiones ?? []).map((c) => `${c.perfil_id}|${c.modulo_id}`));

  // Operadores de Hostelero entre la gente de la cuenta: en su fila no se
  // ofrecen cambio de rol, «Nueva contraseña» ni «Borrar» (las acciones los
  // rechazan de todos modos). operadores no es legible con la sesión de una cuenta, por
  // eso va con la service key y limitado a los ids de esta cuenta.
  const servicio = crearClienteServicio();
  const idsGente = (gente ?? []).map((g) => g.id);
  const { data: operadores } =
    servicio && idsGente.length > 0
      ? await servicio.from("operadores").select("id").in("id", idsGente)
      : { data: [] as { id: string }[] };
  const esOperador = new Set((operadores ?? []).map((o) => o.id));

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
          <div className="tarjeta" style={{ marginBottom: 20, padding: "0 16px" }}>
            <p>Usuario borrado: su acceso, su perfil y todo lo vinculado a su usuario han desaparecido.</p>
          </div>
        )}

        <section style={{ marginBottom: 30 }}>
          <h2 className="rotulo">Dar de alta a alguien</h2>
          <FormAlta roles={ROLES} />
        </section>

        <section>
          <h2 className="rotulo">Quién ve qué</h2>
          <p style={{ color: "var(--gris, #5F6B65)", fontSize: 13, margin: "0 0 12px" }}>
            El rol es la base; aquí se afina persona a persona. Verde = lo ve (pulsa para
            vetarlo, y al revés). Guion apagado = el rol no lo incluye: pulsa para concedérselo
            como extra, y el ✓ con borde discontinuo marca ese extra. Los cambios valen desde
            su siguiente carga de página.
          </p>
          <div className="tabla-envoltura" style={{ background: "#fff", border: "1px solid #DDE2DF", borderRadius: 8, overflowX: "auto" }}>
            <table className="tabla" style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Usuario</th>
                  <th style={{ textAlign: "left", padding: "12px 16px" }}>Rol · acciones</th>
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
                        esOperador={esOperador.has(g.id)}
                        gestionaUsuarios={concedido.has(`${g.id}|usuarios`)}
                        soyOperador={esOperador.has(perfil.id)}
                        roles={ROLES.map((r) => ({ id: r.id, nombre: r.nombre }))}
                      />
                    </td>
                    {modulosDeLaCuenta.map((m) => {
                      const estaVetado = vetado.has(`${g.id}|${m.id}`);
                      // El rol es el tope de serie; fuera de él la celda es
                      // una CONCESIÓN: guion apagado = no lo ve (pulsar para
                      // concederlo como extra), ✓ con borde discontinuo = extra
                      // concedido (pulsar para quitarlo). Usuarios es
                      // solo-por-concesión para TODOS los roles.
                      if (!rolIncluye(g.rol ?? "empleado", m.id)) {
                        const tieneExtra = concedido.has(`${g.id}|${m.id}`);
                        return (
                          <td key={m.id} style={{ padding: "6px 4px", textAlign: "center" }}>
                            <form action={cambiarConcesion}>
                              <input type="hidden" name="perfil" value={g.id} />
                              <input type="hidden" name="modulo" value={m.id} />
                              <input type="hidden" name="conceder" value={tieneExtra ? "no" : "si"} />
                              <button
                                type="submit"
                                title={
                                  tieneExtra
                                    ? `Extra concedido por encima del rol — pulsar para quitárselo a ${g.nombre}`
                                    : `El rol de ${g.nombre} no lo incluye — pulsar para concedérselo como extra`
                                }
                                style={{
                                  width: 30, height: 30, borderRadius: 6,
                                  border: "1px dashed " + (tieneExtra ? "#0F6E56" : "#DDE2DF"),
                                  cursor: "pointer", fontSize: 14,
                                  color: tieneExtra ? "inherit" : "#B8C2BC",
                                  background: tieneExtra ? "#E1F5EE" : "transparent",
                                }}
                              >
                                {tieneExtra ? "✓" : "–"}
                              </button>
                            </form>
                          </td>
                        );
                      }
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
            El veto siempre manda: un módulo vetado no se ve aunque esté concedido. Al
            cambiar a alguien de rol, vetos y concesiones se limpian y arranca con los
            permisos por defecto del rol nuevo. Si alguien no puede entrar, usa «Nueva
            contraseña» en su fila en vez de borrarlo: al borrar se pierde todo lo vinculado a su
            usuario.
          </p>
        </section>
      </main>
    </>
  );
}
