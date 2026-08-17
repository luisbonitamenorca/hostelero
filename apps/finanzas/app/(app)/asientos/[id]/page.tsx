import Link from "next/link";
import { notFound } from "next/navigation";
import { euros, fecha as formatearFecha } from "@/lib/importes";
import { cargarCuentas } from "../datos";
import EditorAsiento from "../editor-asiento";

export const dynamic = "force-dynamic";

type ApunteFila = {
  orden: number;
  descripcion: string | null;
  debe: number;
  haber: number;
  cuenta_plan_id: string;
  centro_id: string | null;
  fin_plan_cuentas: { codigo: string; nombre: string } | null;
  centros: { nombre: string } | null;
};

export default async function DetalleAsiento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, cuentas, centros } = await cargarCuentas();

  const { data: asiento } = await supabase
    .from("fin_asientos")
    .select("id, numero, fecha, descripcion, estado, origen_tipo, creado_en")
    .eq("id", id)
    .maybeSingle();

  if (!asiento) notFound();

  const { data: apuntesData } = await supabase
    .from("fin_apuntes")
    .select("orden, descripcion, debe, haber, cuenta_plan_id, centro_id, fin_plan_cuentas(codigo, nombre), centros(nombre)")
    .eq("asiento_id", id)
    .order("orden");

  const apuntes = (apuntesData ?? []) as unknown as ApunteFila[];
  const totalDebe = apuntes.reduce((s, a) => s + Number(a.debe), 0);
  const totalHaber = apuntes.reduce((s, a) => s + Number(a.haber), 0);

  // Un borrador se edita en el mismo sitio donde se creó. Un confirmado no se
  // edita en ninguno: se enseña y punto.
  if (asiento.estado === "borrador") {
    return (
      <>
        <div className="cabecera-pagina">
          <p className="miga">
            <Link className="enlace" href="/asientos">
              ← Diario
            </Link>
          </p>
          <h1>Borrador de asiento</h1>
          <p className="sub">Sin número todavía. Se lo dará la confirmación.</p>
        </div>

        <EditorAsiento
          cuentas={cuentas}
          centros={centros}
          borrador={{
            id: asiento.id,
            fecha: asiento.fecha,
            descripcion: asiento.descripcion,
            apuntes: apuntes.map((a) => ({
              cuenta_plan_id: a.cuenta_plan_id,
              centro_id: a.centro_id,
              descripcion: a.descripcion,
              debe: Number(a.debe),
              haber: Number(a.haber),
            })),
          }}
        />
      </>
    );
  }

  return (
    <>
      <div className="cabecera-pagina">
        <p className="miga">
          <Link className="enlace" href="/asientos">
            ← Diario
          </Link>
        </p>
        <h1>Asiento {asiento.numero}</h1>
        <p className="sub">
          {formatearFecha(asiento.fecha)}
          {asiento.descripcion ? ` · ${asiento.descripcion}` : ""}
          {" · "}
          <span className="etiqueta-estado">confirmado</span>
        </p>
      </div>

      <div className="tabla-envoltura">
        <table className="tabla">
          <thead>
            <tr>
              <th>Cuenta</th>
              <th>Centro</th>
              <th>Concepto</th>
              <th className="dato">Debe</th>
              <th className="dato">Haber</th>
            </tr>
          </thead>
          <tbody>
            {apuntes.map((a) => (
              <tr key={a.orden}>
                <td className="dato">
                  {a.fin_plan_cuentas?.codigo ?? "—"}
                  <span className="texto-suave"> {a.fin_plan_cuentas?.nombre ?? ""}</span>
                </td>
                <td className="texto-suave">{a.centros?.nombre ?? "—"}</td>
                <td>{a.descripcion ?? "—"}</td>
                <td className="dato">{Number(a.debe) ? euros(Number(a.debe)) : ""}</td>
                <td className="dato">{Number(a.haber) ? euros(Number(a.haber)) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <strong>Totales</strong>
              </td>
              <td className="dato">
                <strong>{euros(totalDebe)}</strong>
              </td>
              <td className="dato">
                <strong>{euros(totalHaber)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="pista">
        Un asiento confirmado no se edita ni se borra. Si está mal, se corrige con
        otro asiento que lo deshaga o lo ajuste — así queda rastro de las dos cosas.
      </p>
    </>
  );
}
