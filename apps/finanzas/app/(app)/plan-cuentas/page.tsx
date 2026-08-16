import { exigirModulo } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PlanCuentas() {
  // Esta pantalla es del módulo de contabilidad, no del de facturación.
  const { supabase } = await exigirModulo("contabilidad");

  const { data, error, count } = await supabase
    .from("fin_plan_cuentas")
    .select("id, codigo, nombre, origen", { count: "exact" })
    .order("codigo")
    .limit(200);

  const filas = data ?? [];

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Plan de cuentas</h1>
        <p className="sub">
          {count ? `${count} cuentas · mostrando las ${Math.min(count, 200)} primeras` : "Plan contable de la sociedad"}
        </p>
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudo cargar el plan de cuentas</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && filas.length === 0 && (
        <div className="estado-vacio">
          <strong>Plan de cuentas vacío</strong>
          La migración desde A3 (635 cuentas) se ejecuta justo después de aplicar la F0.
        </div>
      )}

      {!error && filas.length > 0 && (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nombre</th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id}>
                  <td className="dato">{c.codigo}</td>
                  <td>{c.nombre}</td>
                  <td>{c.origen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
