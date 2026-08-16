import { exigirFacturacion } from "@/lib/supabase/server";
import { type ItemRemesa, type Remesa } from "@/lib/remesas";
import { construirPain001, construirPain008, type LineaRemesa } from "@/lib/sepa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_p: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, cuenta } = await exigirFacturacion();
  const db = supabase;

  const { data: fila } = await db
    .from("fin_remesas")
    .select("id, cuenta_id, sociedad_id, sentido, banco_cuenta_id, concepto, fecha_ejecucion, estado, total, num_items, creado_en")
    .eq("id", id)
    .maybeSingle();

  if (!fila) return new Response("Remesa no encontrada", { status: 404 });
  if (fila.cuenta_id !== cuenta.id) return new Response("Sin permiso", { status: 403 });
  if (fila.estado === "anulada") return new Response("Esta remesa está anulada", { status: 409 });

  const r = fila as Remesa;

  const [{ data: items }, { data: banco }, { data: sociedad }, { data: config }] = await Promise.all([
    db.from("fin_remesas_items")
      .select("id, vencimiento_id, importe, nombre, iban, bic, mandato_ref, mandato_fecha, secuencia, concepto, referencia")
      .eq("remesa_id", id)
      .order("nombre"),
    db.from("fin_bancos_cuentas").select("nombre, iban, bic").eq("id", r.banco_cuenta_id).maybeSingle(),
    supabase.from("sociedades").select("nombre").eq("id", fila.sociedad_id).maybeSingle(),
    db.from("fin_config").select("identificador_acreedor").limit(1).maybeSingle(),
  ]);

  const lineas = (items ?? []) as ItemRemesa[];
  if (lineas.length === 0) return new Response("La remesa no tiene líneas", { status: 409 });
  if (!banco) return new Response("La cuenta bancaria ya no existe", { status: 409 });

  const datos = {
    mensajeId: `REM-${r.id.slice(0, 8).toUpperCase()}`,
    creadaEn: new Date().toISOString().slice(0, 19),
    fechaEjecucion: r.fecha_ejecucion,
    ordenante: {
      nombre: sociedad?.nombre ?? "Ordenante",
      iban: banco.iban,
      bic: banco.bic,
      identificador: config?.identificador_acreedor ?? null,
    },
    concepto: r.concepto,
    lineas: lineas.map<LineaRemesa>((l) => ({
      referencia: l.referencia ?? l.id.slice(0, 8),
      nombre: l.nombre,
      iban: l.iban,
      bic: l.bic,
      importe: Number(l.importe),
      concepto: l.concepto,
      mandatoRef: l.mandato_ref,
      mandatoFecha: l.mandato_fecha,
      secuencia: l.secuencia,
    })),
  };

  let xml: string;
  try {
    xml = r.sentido === "cobro" ? construirPain008(datos) : construirPain001(datos);
  } catch (e) {
    // Los frenos de lib/sepa.ts: sin identificador de acreedor o sin mandato no
    // se genera nada. Mejor un mensaje claro que un fichero que el banco rechaza.
    return new Response(e instanceof Error ? e.message : "No se pudo generar el fichero", { status: 409 });
  }

  const nombre = `${r.sentido === "cobro" ? "adeudos" : "transferencias"}-${r.fecha_ejecucion}-${r.id.slice(0, 8)}.xml`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
