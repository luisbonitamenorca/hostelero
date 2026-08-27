import Link from "next/link";
import { exigirFacturacion } from "@/lib/supabase/server";
import { type CuentaBancaria } from "@/lib/remesas";
import type { Vencimiento } from "@/lib/cartera";
import FormularioRemesa from "./formulario-remesa";

export const dynamic = "force-dynamic";

export default async function NuevaRemesa() {
  const { supabase, cuenta } = await exigirFacturacion();
  const db = supabase;

  const [{ data: cuentas }, { data: vencimientos }, { data: config }] = await Promise.all([
    db.from("fin_bancos_cuentas").select("id, nombre, iban, bic, activa, sociedad_id").eq("activa", true).order("nombre"),
    supabase
      .from("fin_vencimientos")
      .select("id, sentido, factura_id, compra_doc_id, asiento_id, fecha_vencimiento, importe, importe_liquidado, estado, forma_pago, notas")
      .in("estado", ["pendiente", "parcial"])
      .order("fecha_vencimiento"),
    // La columna llega con la F4a: hasta aplicarla, los tipos no la conocen.
    db.from("fin_config").select("identificador_acreedor").limit(1).maybeSingle(),
  ]);

  const abiertos = (vencimientos ?? []) as Vencimiento[];

  // Nombres, para que la lista de selección se pueda leer.
  const idsFactura = abiertos.map((v) => v.factura_id).filter(Boolean) as string[];
  const idsCompra = abiertos.map((v) => v.compra_doc_id).filter(Boolean) as string[];
  const idsAsiento = abiertos.map((v) => v.asiento_id).filter(Boolean) as string[];

  const [{ data: facturas }, { data: compras }, { data: asientosIngreso }] = await Promise.all([
    idsFactura.length ? supabase.from("fin_facturas").select("id, numero_completo, cliente_id").in("id", idsFactura) : Promise.resolve({ data: [] }),
    idsCompra.length ? supabase.from("compras_doc").select("id, proveedor, num_documento").in("id", idsCompra) : Promise.resolve({ data: [] }),
    idsAsiento.length ? supabase.from("fin_asientos").select("id, descripcion").in("id", idsAsiento) : Promise.resolve({ data: [] }),
  ]);

  const idsCliente = (facturas ?? []).map((f) => f.cliente_id).filter(Boolean) as string[];
  const { data: clientes } = idsCliente.length
    ? await supabase.from("fin_clientes").select("id, nombre_fiscal").in("id", idsCliente)
    : { data: [] };
  const nombreCliente = new Map((clientes ?? []).map((c) => [c.id, c.nombre_fiscal]));

  const etiqueta = new Map<string, string>();
  for (const f of facturas ?? []) {
    etiqueta.set(f.id, `${f.numero_completo ?? "borrador"} · ${f.cliente_id ? (nombreCliente.get(f.cliente_id) ?? "—") : "—"}`);
  }
  for (const c of (compras ?? []) as { id: string; proveedor: string | null; num_documento: string | null }[]) {
    etiqueta.set(c.id, `${c.num_documento ?? "s/n"} · ${c.proveedor ?? "—"}`);
  }
  // Facturas de ingreso (Ágora): «Fra. FV-X (Cliente)» en la descripción del asiento.
  for (const a of (asientosIngreso ?? []) as { id: string; descripcion: string | null }[]) {
    const m = (a.descripcion ?? "").match(/^Fra\. (\S+) \((.+)\)$/);
    etiqueta.set(a.id, m ? `${m[1]} · ${m[2]}` : (a.descripcion ?? "—"));
  }

  const lista = abiertos.map((v) => ({
    id: v.id,
    sentido: v.sentido,
    fecha: v.fecha_vencimiento,
    pendiente: Number(v.importe) - Number(v.importe_liquidado),
    quien: etiqueta.get((v.factura_id ?? v.compra_doc_id ?? v.asiento_id) as string) ?? "—",
  }));

  return (
    <>
      <div className="cabecera-pagina">
        <p className="miga">
          <Link className="enlace" href="/remesas">Remesas</Link> / Nueva
        </p>
        <h1>Nueva remesa</h1>
        <p className="sub">Elige los vencimientos que van dentro. Solo entra lo que está pendiente.</p>
      </div>

      <FormularioRemesa
        cuentas={(cuentas ?? []) as CuentaBancaria[]}
        vencimientos={lista}
        hayIdentificador={Boolean(config?.identificador_acreedor)}
      />
    </>
  );
}
