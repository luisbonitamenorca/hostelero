import { exigirModulo } from "@/lib/supabase/server";
import { clasificar, NOMBRE_MASA } from "@/lib/contabilidad";
import Buscador from "../clientes/buscador";
import NuevaCuenta from "./nueva-cuenta";

export const dynamic = "force-dynamic";

const LIMITE = 200;

export default async function PlanCuentas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();

  // Esta pantalla es del módulo de contabilidad, no del de facturación.
  const { supabase } = await exigirModulo("contabilidad");

  let consulta = supabase
    .from("fin_plan_cuentas")
    .select("id, codigo, nombre, origen", { count: "exact" })
    .order("codigo")
    .limit(LIMITE);

  // Sin buscador, 658 cuentas cortadas a 200 escondían justo las del final.
  if (q) consulta = consulta.or(`codigo.ilike.%${q}%,nombre.ilike.%${q}%`);

  const { data, error, count } = await consulta;
  const filas = data ?? [];

  // Para no ofrecer como «habitual» una cuenta que ya existe.
  const { data: codigos } = await supabase.from("fin_plan_cuentas").select("codigo");

  const total = count ?? 0;

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Plan de cuentas</h1>
        <p className="sub">
          {q
            ? `${total} cuentas coinciden con «${q}»${total > LIMITE ? ` · mostrando ${LIMITE}` : ""}`
            : `${total} cuentas · mostrando las ${Math.min(total, LIMITE)} primeras`}
        </p>
      </div>

      <div className="barra-filtros">
        <Buscador q={q} soloActivos sinFiltroActivos etiqueta="Buscar por código o nombre…" />
        <NuevaCuenta existentes={(codigos ?? []).map((c) => c.codigo)} />
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudo cargar el plan de cuentas</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && filas.length === 0 && (
        <div className="estado-vacio">
          <strong>{q ? `Ninguna cuenta coincide con «${q}»` : "Plan de cuentas vacío"}</strong>
          {q ? "Prueba con otro código o nombre." : "La migración desde A3 se ejecuta después de aplicar la F0."}
        </div>
      )}

      {!error && filas.length > 0 && (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Va en</th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => {
                const { masa } = clasificar(c.codigo);
                return (
                  <tr key={c.id}>
                    <td className="dato">{c.codigo}</td>
                    <td>{c.nombre}</td>
                    <td className={masa === "sin-clasificar" ? "error-texto" : "texto-suave"}>
                      {masa === "resultado" ? "Pérdidas y ganancias" : NOMBRE_MASA[masa]}
                    </td>
                    <td className="texto-suave">{c.origen}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="pista">
        La columna «va en» dice a qué masa del balance o de la cuenta de resultados
        lleva cada cuenta en los informes. Las que salgan en rojo no se han podido
        clasificar y quedarán fuera del balance hasta decidir dónde van.
      </p>
    </>
  );
}
