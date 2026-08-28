import { NextRequest, NextResponse } from "next/server";
import { exigirModulo } from "@/lib/supabase/server";

/**
 * Fichero de presentación del modelo 303 (formato BOE de la AEAT, diseño de
 * registro 2026). Es un BORRADOR para contrastar con lo que presente A3 y para
 * ensayar la presentación propia de enero: se puede subir al validador de la
 * Sede sin firmar. Estructura: <T3030{ej}{per}0000><AUX>…</AUX> + página 1
 * (régimen general) + página 3 (resultado) + cierre, sin saltos de línea.
 *
 * Diseño tomado del módulo AEAT 303-2026 de la OCA (l10n-spain), que replica
 * el diseño oficial. Limitaciones asumidas del borrador: sin cuotas a
 * compensar de periodos anteriores (casillas 110/78/87 a cero), sin página de
 * exonerados del 390 (solo afecta al 4T) y sin página de devolución.
 */

const NIF = "B01996826";
const RAZON = "BONITA MENORCA SL";

export const dynamic = "force-dynamic";

type Fila = { trimestre: number; clave: string; importe: number };

// Importe AEAT: 17 posiciones — signo ('N' negativo, '0' positivo) + 16
// dígitos en céntimos con ceros a la izquierda.
function n17(v: number): string {
  const cents = Math.round(Math.abs(v) * 100);
  return (v < -0.004 ? "N" : "0") + String(cents).padStart(16, "0");
}
// Texto AEAT: mayúsculas sin acentos, relleno con blancos a la derecha.
function s(txt: string, size: number): string {
  return txt
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .padEnd(size, " ")
    .slice(0, size);
}

export async function GET(req: NextRequest) {
  const { supabase } = await exigirModulo("contabilidad");
  const anio = Number(req.nextUrl.searchParams.get("anio")) || new Date().getFullYear();
  const t = Number(req.nextUrl.searchParams.get("t")) || 1;
  if (t < 1 || t > 4) return NextResponse.json({ error: "trimestre no válido" }, { status: 400 });
  const periodo = `${t}T`;

  const rpc = supabase as unknown as {
    rpc: (fn: "fin_impuestos", args: { p_anio: number }) => PromiseLike<{ data: Fila[] | null; error: unknown }>;
  };
  const { data } = await rpc.rpc("fin_impuestos", { p_anio: anio });
  const v = (clave: string) =>
    ((data ?? []) as Fila[]).filter((f) => f.trimestre === t && f.clave === clave).reduce((s2, f) => s2 + Number(f.importe), 0);

  const r2 = (n: number) => Math.round(n * 100) / 100;

  // Devengado por tipo: la base se reconstruye desde la cuota.
  const c03 = r2(v("rep_004")), c01 = r2(c03 / 0.04);
  const c06 = r2(v("rep_010")), c04 = r2(c06 / 0.10);
  const c09 = r2(v("rep_021")), c07 = r2(c09 / 0.21);
  const c13 = r2(v("rep_isp")), c12 = r2(c13 / 0.21); // ISP: contrapartida al 21
  const c15 = r2(v("rep_otros")), c14 = r2(c15 / 0.21); // sin tipo conocido → modificaciones
  const c27 = r2(c03 + c06 + c09 + c13 + c15);

  // Deducible: todo el corriente en 28/29; el 12% agrario, como compensación REAGYP (42).
  const sop = ["004", "010", "021"].map((k) => ({ pct: Number(k) / 100, cuota: r2(v("sop_" + k)) }));
  const sopIsp = r2(v("sop_isp"));
  const sopOtros = r2(v("sop_otros"));
  const c29 = r2(sop.reduce((s2, x) => s2 + x.cuota, 0) + sopIsp + sopOtros);
  const c28 = r2(sop.reduce((s2, x) => s2 + (x.pct ? x.cuota / x.pct : 0), 0) + (sopIsp + sopOtros) / 0.21);
  const c42 = r2(v("sop_012"));
  const c45 = r2(c29 + c42);
  const c46 = r2(c27 - c45);
  const tipoDecl = Math.abs(c46) < 0.005 ? "N" : c46 > 0 ? "I" : "C";

  const p1 =
    "<T" + "303" + "01000" + ">" +
    " " +                       // página complementaria
    tipoDecl +                  // tipo de declaración
    s(NIF, 9) + s(RAZON, 80) + String(anio) + periodo +
    "2" +                       // foral: no
    "2" +                       // devolución mensual: no
    "3" +                       // exclusivamente simplificado: no
    "2" + "2" + "2" + "2" + "2" + "2" + // conjunta/caja/destinatario caja/prorrata/revocación/concurso: no
    s("", 8) + " " +            // fecha y tipo de concurso
    "2" +                       // SII voluntario: no
    (t === 4 ? "1" : "0") +     // exonerado del 390 (solo se pregunta en 4T)
    (t === 4 ? "1" : "0") +     // volumen de operaciones distinto de cero
    "0" +                       // pago a cuenta gasolinas (mensuales 2026-01)
    n17(0) + "00000" + n17(0) + // 0%   [150-152]
    n17(0) + "00000" + n17(0) + // 2%   [165-167]
    n17(c01) + "00400" + n17(c03) + // 4%  [01-03]
    n17(0) + "00000" + n17(0) + // 5%/7,5% [153-155]
    n17(c04) + "01000" + n17(c06) + // 10% [04-06]
    n17(c07) + "02100" + n17(c09) + // 21% [07-09]
    n17(0) + n17(0) +           // AIB bienes [10-11]
    n17(c12) + n17(c13) +       // ISP [12-13]
    n17(c14) + n17(c15) +       // modificación bases y cuotas [14-15]
    n17(0) + "00175" + n17(0) + // RE 1,75% [156-158]
    n17(0) + "00050" + n17(0) + // RE 0,5%  [168-170]
    n17(0) + "00000" + n17(0) + // RE 0/0,5/0,62 [16-18]
    n17(0) + "00140" + n17(0) + // RE 1,4%  [19-21]
    n17(0) + "00520" + n17(0) + // RE 5,2%  [22-24]
    n17(0) + n17(0) +           // modif. recargo [25-26]
    n17(c27) +                  // total devengado [27]
    n17(c28) + n17(c29) +       // soportado corriente [28-29]
    n17(0) + n17(0) +           // bienes de inversión interior [30-31]
    n17(0) + n17(0) +           // importaciones corrientes [32-33]
    n17(0) + n17(0) +           // importaciones inversión [34-35]
    n17(0) + n17(0) +           // AIB corrientes [36-37]
    n17(0) + n17(0) +           // AIB inversión [38-39]
    n17(0) + n17(0) +           // rectificación deducciones [40-41]
    n17(c42) +                  // compensaciones REAGYP [42]
    n17(0) +                    // regularización inversiones [43]
    n17(0) +                    // regularización prorrata [44]
    n17(c45) +                  // total a deducir [45]
    n17(c46) +                  // resultado régimen general [46]
    s("", 521) + s("", 13) +
    "</T30301000>";

  const p3 =
    "<T" + "303" + "03000" + ">" +
    n17(0) + n17(0) + n17(0) + n17(0) + n17(0) + n17(0) + // info adicional [59,60,120,122,123,124]
    n17(0) + n17(0) + n17(0) + n17(0) + // criterio de caja [62,63,74,75]
    n17(0) +                    // regularización art. 80 [76]
    n17(c46) +                  // suma de resultados [64]
    "10000" +                   // % atribuible al Estado [65] = 100,00
    n17(c46) +                  // atribuible al Estado [66]
    n17(0) +                    // IVA importación aduana [77]
    n17(0) + n17(0) + n17(0) +  // cuotas a compensar [110, 78, 87]
    n17(0) +                    // regularización anual [68]
    n17(0) +                    // rectificativa [108]
    n17(c46) +                  // resultado autoliquidación [69]
    n17(0) +                    // resultados previos [70]
    n17(0) +                    // devoluciones acordadas [109]
    n17(0) +                    // pago a cuenta gasolinas [112]
    n17(c46) +                  // resultado de la liquidación [71]
    (tipoDecl === "N" ? "X" : " ") + // sin actividad
    " " + s("", 13) + " " + n17(0) + " " + " " + // rectificativa: no
    s("", 546) +
    "</T30303000>";

  const fichero =
    "<T" + "303" + "0" + String(anio) + periodo + "0000>" +
    "<AUX>" + s("", 70) + s("HOST", 4) + s("", 4) + s(NIF, 9) + s("", 213) + "</AUX>" +
    p1 + p3 +
    "</T3030" + String(anio) + periodo + "0000>";

  return new NextResponse(Buffer.from(fichero, "latin1"), {
    headers: {
      "Content-Type": "text/plain; charset=iso-8859-1",
      "Content-Disposition": `attachment; filename="M303_${anio}_${periodo}_borrador.303"`,
    },
  });
}
