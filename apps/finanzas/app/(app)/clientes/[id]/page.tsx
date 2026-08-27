import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirFacturacion } from "@/lib/supabase/server";
import FormularioCliente, { type ClienteFicha } from "../formulario";

export const dynamic = "force-dynamic";

export default async function EditarCliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await exigirFacturacion();

  const { data } = await supabase
    .from("fin_clientes")
    .select(
      "id, nif, nombre_fiscal, nombre_comercial, direccion, codigo_postal, municipio, provincia, pais, email, telefono, iban, dias_vencimiento, tipo_iva_defecto, retencion_pct, notas, activo",
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  // Su cuenta 43x en el plan (por NIF, o por nombre si no hay NIF): el enlace
  // al mayor del cliente.
  let cuentaMayor: string | null = null;
  {
    const nif = (data.nif ?? "").replace(/[^A-Za-z0-9]/g, "");
    if (nif) {
      const { data: porNif } = await supabase
        .from("fin_plan_cuentas")
        .select("codigo")
        .like("codigo", "43%")
        .eq("nif", nif)
        .limit(1);
      cuentaMayor = porNif?.[0]?.codigo ?? null;
    }
    if (!cuentaMayor && data.nombre_fiscal) {
      const { data: porNombre } = await supabase
        .from("fin_plan_cuentas")
        .select("codigo")
        .like("codigo", "43%")
        .ilike("nombre", `${data.nombre_fiscal.slice(0, 12)}%`)
        .limit(1);
      cuentaMayor = porNombre?.[0]?.codigo ?? null;
    }
  }

  return (
    <>
      <div className="cabecera-pagina con-accion">
        <div>
          <p className="miga">
            <Link className="enlace" href="/clientes">
              Clientes
            </Link>{" "}
            / Ficha
          </p>
          <h1>{data.nombre_fiscal}</h1>
          <p className="sub">
            Los cambios afectan a las facturas futuras. Las ya expedidas conservan los datos con los
            que se emitieron.
          </p>
        </div>
        {cuentaMayor && (
          <Link className="boton-secundario boton-auto" href={`/mayor?cuenta=${cuentaMayor}`}>
            Ver su mayor ({cuentaMayor})
          </Link>
        )}
      </div>
      <FormularioCliente cliente={data as unknown as ClienteFicha} />
    </>
  );
}
