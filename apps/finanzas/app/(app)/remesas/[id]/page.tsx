import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirFacturacion } from "@/lib/supabase/server";
import { euros, fecha } from "@/lib/importes";
import { ruta } from "@/lib/rutas.ts";
import { clienteRemesas, ESTADO_REMESA, type ItemRemesa, type Remesa } from "@/lib/remesas";
import AccionesRemesa from "./acciones-remesa";

export const dynamic = "force-dynamic";

export default async function DetalleRemesa({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await exigirFacturacion();
  const db = clienteRemesas(supabase);

  const { data: remesa } = await db
    .from("fin_remesas")
    .select("id, sentido, banco_cuenta_id, concepto, fecha_ejecucion, estado, total, num_items, creado_en")
    .eq("id", id)
    .maybeSingle();

  if (!remesa) notFound();
  const r = remesa as Remesa;

  const [{ data: items }, { data: banco }] = await Promise.all([
    db.from("fin_remesas_items")
      .select("id, vencimiento_id, importe, nombre, iban, bic, mandato_ref, mandato_fecha, secuencia, concepto, referencia")
      .eq("remesa_id", id)
      .order("nombre"),
    db.from("fin_bancos_cuentas").select("nombre, iban").eq("id", r.banco_cuenta_id).maybeSingle(),
  ]);

  const lineas = (items ?? []) as ItemRemesa[];
  const editable = r.estado === "borrador";

  return (
    <>
      <div className="cabecera-pagina">
        <p className="miga">
          <Link className="enlace" href="/remesas">Remesas</Link> /{" "}
          {r.sentido === "cobro" ? "Cobro" : "Pago"}
        </p>
        <h1>{r.concepto ?? "Remesa sin concepto"}</h1>
        <p className="sub">
          {r.sentido === "cobro" ? "Adeudos domiciliados" : "Transferencias"} ·{" "}
          {ESTADO_REMESA[r.estado] ?? r.estado}
        </p>
      </div>

      <div className="bloque">
        <div className="rejilla">
          <div className="campo">
            <span>Cuenta</span>
            <p className="valor">{banco?.nombre ?? "—"}</p>
            <p className="detalle dato">{banco?.iban ?? ""}</p>
          </div>
          <div className="campo">
            <span>{r.sentido === "cobro" ? "Fecha de cargo" : "Fecha de pago"}</span>
            <p className="valor dato">{fecha(r.fecha_ejecucion)}</p>
          </div>
          <div className="campo">
            <span>Líneas</span>
            <p className="valor dato">{r.num_items}</p>
          </div>
          <div className="campo">
            <span>Total</span>
            <p className="valor dato">{euros(Number(r.total))}</p>
          </div>
        </div>
      </div>

      <div className="tabla-envoltura" style={{ marginTop: 16 }}>
        <table className="tabla">
          <thead>
            <tr>
              <th>{r.sentido === "cobro" ? "Deudor" : "Beneficiario"}</th>
              <th>IBAN</th>
              {r.sentido === "cobro" && <th>Mandato</th>}
              <th>Concepto</th>
              <th className="a-derecha">Importe</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.id}>
                <td>{l.nombre}</td>
                <td className="dato">{l.iban}</td>
                {r.sentido === "cobro" && (
                  <td className="dato">
                    {l.mandato_ref ?? "—"}
                    {l.secuencia && <span className="secundario">{l.secuencia === "FRST" ? "primer adeudo" : "recurrente"}</span>}
                  </td>
                )}
                <td>{l.concepto ?? "—"}</td>
                <td className="numero">{euros(Number(l.importe))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="acciones" style={{ marginTop: 16 }}>
        <a className="boton boton-auto" href={ruta(`/remesas/${r.id}/fichero`)} target="_blank" rel="noreferrer">
          Descargar fichero
        </a>
        <AccionesRemesa id={r.id} estado={r.estado} />
      </div>

      {editable && (
        <p className="pista">
          Mientras esté en borrador se puede anular y rehacer. En cuanto marques que has generado el
          fichero, sus líneas quedan congeladas: son el reflejo de lo que se mandó al banco.
        </p>
      )}
    </>
  );
}
