import { exigirModulo } from "@/lib/supabase/server";
import { columnasDeAjustes } from "@/lib/proveedores";
import FormularioAjustes from "./formulario-ajustes";

export const dynamic = "force-dynamic";

/** Ajustes del módulo de Finanzas (13-10-2026). Primera preferencia: las
 *  columnas del listado de proveedores. Van en fin_ajustes, una fila por cuenta. */
export default async function Ajustes() {
  const { supabase, cuenta } = await exigirModulo("compras");

  // Si la tabla aún no existe (migración sin aplicar), se enseñan las de defecto.
  const { data, error } = await supabase.from("fin_ajustes").select("ajustes").eq("cuenta_id", cuenta.id).maybeSingle();
  const columnas = columnasDeAjustes(error ? null : data?.ajustes);

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Ajustes</h1>
        <p className="sub">Preferencias del módulo para toda la cuenta. Lo que cambies aquí lo ve todo el equipo.</p>
      </div>
      {error && (
        <p className="aviso-texto">
          Los ajustes aún no se pueden guardar: falta la migración 20261013130000 en la base. Se muestran las columnas de defecto.
        </p>
      )}
      <FormularioAjustes columnas={columnas} />
    </>
  );
}
