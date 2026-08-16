import Link from "next/link";
import { exigirModulo } from "@/lib/supabase/server";
import FormularioActivo from "./formulario-activo";

export const dynamic = "force-dynamic";

export default async function NuevoActivo() {
  const { supabase } = await exigirModulo("contabilidad");

  const [{ data: cuentas }, { data: centros }] = await Promise.all([
    supabase.from("fin_plan_cuentas").select("id, codigo, nombre").order("codigo"),
    supabase.from("centros").select("id, nombre").order("nombre"),
  ]);

  // Solo las de inmovilizado para el activo; las 28x y 68x para las otras dos.
  const todas = cuentas ?? [];
  const deActivo = todas.filter((c) => /^2[01]\d/.test(c.codigo) && !c.codigo.startsWith("28"));
  const deAmortizacion = todas.filter((c) => c.codigo.startsWith("28"));
  const deDotacion = todas.filter((c) => /^68\d?$/.test(c.codigo));

  return (
    <>
      <div className="cabecera-pagina">
        <p className="miga">
          <Link className="enlace" href="/activos">Activos</Link> / Nuevo
        </p>
        <h1>Nuevo activo</h1>
        <p className="sub">
          Al guardarlo se calcula su cuadro de amortización completo, mes a mes.
        </p>
      </div>

      {deActivo.length === 0 ? (
        <div className="estado-vacio">
          <strong>No hay cuentas de inmovilizado en el plan contable</strong>
          Las siembra la migración F2c. Si ya está aplicada y sigues viendo esto, avisa.
        </div>
      ) : (
        <FormularioActivo
          cuentasActivo={deActivo}
          cuentasAmortizacion={deAmortizacion}
          cuentasDotacion={deDotacion}
          centros={centros ?? []}
        />
      )}
    </>
  );
}
