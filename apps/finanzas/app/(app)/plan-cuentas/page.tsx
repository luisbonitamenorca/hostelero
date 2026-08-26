import Link from "next/link";
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
  const pag = Math.max(1, parseInt(sp.pag ?? "1", 10) || 1);

  // Esta pantalla es del módulo de contabilidad, no del de facturación.
  const { supabase } = await exigirModulo("contabilidad");

  let consulta = supabase
    .from("fin_plan_cuentas")
    .select("id, codigo, nombre, origen", { count: "exact" })
    .order("codigo")
    .range((pag - 1) * LIMITE, pag * LIMITE - 1);

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
          {q ? `${total} cuentas coinciden con «${q}»` : `${total} cuentas en el plan`}
          {total > LIMITE ? ` · ${(pag - 1) * LIMITE + 1}–${Math.min(pag * LIMITE, total)}` : ""}
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
                <th></th>
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
                    <td>
                      <Link className="boton-secundario" style={{ padding: "3px 10px", fontSize: 12 }} href={`/mayor?cuenta=${c.codigo}`}>
                        Mayor
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > LIMITE && (
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", margin: "12px 0" }}>
          {pag > 1 && (
            <Link className="boton-secundario" style={{ padding: "4px 12px", fontSize: 13 }} href={`/plan-cuentas?pag=${pag - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>
              ← Anteriores
            </Link>
          )}
          {pag * LIMITE < total && (
            <Link className="boton-secundario" style={{ padding: "4px 12px", fontSize: 13 }} href={`/plan-cuentas?pag=${pag + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>
              Siguientes →
            </Link>
          )}
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
