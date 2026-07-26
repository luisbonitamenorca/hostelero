import Link from "next/link";
import { exigirOperador } from "@/lib/supabase/server";
import { cerrarSesion } from "./acciones";

export const dynamic = "force-dynamic";

const ETIQUETA_ESTADO: Record<string, string> = {
  activa: "Activa",
  en_pruebas: "En pruebas",
  suspendida: "Suspendida",
  baja: "Baja",
};

export default async function Portada() {
  const { supabase, operador } = await exigirOperador();

  const { data: cuentas, error } = await supabase
    .from("cuentas")
    .select(
      "id, nombre, plan, estado, creada_en, sociedades(id), centros(id), modulos_contratados(activo)"
    )
    .order("creada_en", { ascending: true });

  const filas = (cuentas ?? []).map((c) => ({
    id: c.id,
    nombre: c.nombre,
    plan: c.plan,
    estado: c.estado,
    alta: new Date(c.creada_en).toLocaleDateString("es-ES"),
    sociedades: c.sociedades.length,
    centros: c.centros.length,
    modulos: c.modulos_contratados.filter((m) => m.activo).length,
  }));

  const totalCentros = filas.reduce((t, f) => t + f.centros, 0);
  const enPruebas = filas.filter((f) => f.estado === "en_pruebas").length;

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
        {error ? (
          <p className="aviso-error">
            No se han podido cargar las cuentas. Recarga la página; si sigue
            pasando, revisa la conexión con Supabase.
          </p>
        ) : (
          <>
            <div className="cifras">
              <div>
                <div className="cifra-numero">{filas.length}</div>
                <div className="cifra-etiqueta">cuentas</div>
              </div>
              <div>
                <div className="cifra-numero">{totalCentros}</div>
                <div className="cifra-etiqueta">centros</div>
              </div>
              <div>
                <div className={"cifra-numero" + (enPruebas > 0 ? " acento" : "")}>
                  {enPruebas}
                </div>
                <div className="cifra-etiqueta">en pruebas</div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 16,
                marginBottom: 8,
              }}
            >
              <h2 className="rotulo" style={{ margin: 0 }}>
                Cuentas
              </h2>
              <Link href="/cuentas/nueva" className="boton-enlace">
                Nueva cuenta
              </Link>
            </div>

            <div className="tarjeta">
              {filas.length === 0 ? (
                <p className="vacio">
                  Sin cuentas todavía. Crea la primera con «Nueva cuenta».
                </p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="tabla">
                    <thead>
                      <tr>
                        <th>Cuenta</th>
                        <th>Plan</th>
                        <th>Estado</th>
                        <th className="num">Sociedades</th>
                        <th className="num">Centros</th>
                        <th className="num">Módulos</th>
                        <th className="num">Alta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((f) => (
                        <tr key={f.id} className="fila-enlace">
                          <td className="nombre-cuenta">
                            <Link
                              href={`/cuentas/${f.id}`}
                              style={{ display: "block" }}
                            >
                              {f.nombre}
                            </Link>
                          </td>
                          <td style={{ color: "var(--gris)" }}>{f.plan}</td>
                          <td>
                            <span className={`estado ${f.estado}`}>
                              {ETIQUETA_ESTADO[f.estado] ?? f.estado}
                            </span>
                          </td>
                          <td className="num">{f.sociedades}</td>
                          <td className="num">{f.centros}</td>
                          <td className="num">{f.modulos}</td>
                          <td className="num" style={{ color: "var(--gris)" }}>
                            {f.alta}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <footer className="pie">
        <div className="pie-interior">
          Consola interna de Hostelero · solo operadores
        </div>
      </footer>
    </>
  );
}
