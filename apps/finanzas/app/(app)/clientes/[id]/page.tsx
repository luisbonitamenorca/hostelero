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

  return (
    <>
      <div className="cabecera-pagina">
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
      <FormularioCliente cliente={data as unknown as ClienteFicha} />
    </>
  );
}
