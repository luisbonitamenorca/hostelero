import { NextRequest, NextResponse } from "next/server";
import { exigirModulo } from "@/lib/supabase/server";

/**
 * Ficheros de presentación AEAT (formato BOE, diseño de registro 2026):
 * ?m=303 (por defecto), ?m=111 y ?m=115. Son BORRADORES para contrastar con lo
 * que presente A3 y ensayar la presentación propia de enero: se pueden subir al
 * validador de la Sede sin firmar.
 *
 * Diseños tomados de los módulos AEAT de la OCA (l10n-spain), que replican el
 * diseño oficial. 303: página 1 (régimen general) + página 3 (resultado), con
 * arrastre de cuotas a compensar (110/78/87) encadenado desde el 1T (arranque
 * del año a cero: las cuotas que vinieran de 2025 las presenta A3).
 * Limitaciones asumidas: sin página de exonerados del 390 (4T) ni de devolución.
 * 111: perceptores de trabajo desde las nóminas de Ratios (DNI distintos) y de
 * actividades desde las facturas con retención; retenciones desde las 4751.
 * 115: alquileres al 19% (base = cuota ÷ 0,19).
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
// Entero AEAT: dígitos con ceros a la izquierda (perceptores).
function ent(v: number, size: number): string {
  return String(Math.max(0, Math.round(v))).padStart(size, "0");
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
// Envoltorio común <TMMM0{ej}{per}0000><AUX>…</AUX> + páginas + cierre.
function envolver(modelo: string, anio: number, periodo: string, paginas: string): string {
  return (
    "<T" + modelo + "0" + String(anio) + periodo + "0000>" +
    "<AUX>" + s("", 70) + s("HOST", 4) + s("", 4) + s(NIF, 9) + s("", 213) + "</AUX>" +
    paginas +
    "</T" + modelo + "0" + String(anio) + periodo + "0000>"
  );
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: NextRequest) {
  const { supabase } = await exigirModulo("contabilidad");
  const anio = Number(req.nextUrl.searchParams.get("anio")) || new Date().getFullYear();
  const t = Number(req.nextUrl.searchParams.get("t")) || 1;
  const modelo = req.nextUrl.searchParams.get("m") || "303";
  if (t < 1 || t > 4) return NextResponse.json({ error: "trimestre no válido" }, { status: 400 });
  if (!["303", "111", "115"].includes(modelo))
    return NextResponse.json({ error: "modelo no válido" }, { status: 400 });
  const periodo = `${t}T`;

  const rpc = supabase as unknown as {
    rpc: (fn: "fin_impuestos", args: { p_anio: number }) => PromiseLike<{ data: Fila[] | null; error: unknown }>;
  };
  const { data } = await rpc.rpc("fin_impuestos", { p_anio: anio });
  const v = (clave: string, tt: number = t) =>
    ((data ?? []) as Fila[]).filter((f) => f.trimestre === tt && f.clave === clave).reduce((s2, f) => s2 + Number(f.importe), 0);

  let fichero = "";
  let nombreFichero = "";

  if (modelo === "303") {
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

    // Arrastre de cuotas a compensar: cadena desde el 1T (arranque del año a cero).
    // 110 = pendientes al inicio · 78 = aplicadas · 87 = 110 − 78; un resultado
    // negativo (69 < 0) pasa a engordar el 110 del trimestre siguiente.
    let pend = 0;
    let c110 = 0, c78 = 0;
    for (let q = 1; q <= t; q++) {
      const dev = r2(v("rep_004", q) + v("rep_010", q) + v("rep_021", q) + v("rep_isp", q) + v("rep_otros", q));
      const ded = r2(v("sop_004", q) + v("sop_010", q) + v("sop_021", q) + v("sop_012", q) + v("sop_isp", q) + v("sop_otros", q));
      const c66q = r2(dev - ded);
      const c78q = r2(Math.min(pend, Math.max(0, c66q)));
      const c69q = r2(c66q - c78q);
      if (q === t) { c110 = pend; c78 = c78q; }
      pend = r2(pend - c78q + Math.max(0, -c69q));
    }
    const c87 = r2(c110 - c78);
    const c69 = r2(c46 - c78);
    const tipoDecl = Math.abs(c69) < 0.005 ? "N" : c69 > 0 ? "I" : "C";

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
      n17(c110) + n17(c78) + n17(c87) + // cuotas a compensar [110, 78, 87]
      n17(0) +                    // regularización anual [68]
      n17(0) +                    // rectificativa [108]
      n17(c69) +                  // resultado autoliquidación [69]
      n17(0) +                    // resultados previos [70]
      n17(0) +                    // devoluciones acordadas [109]
      n17(0) +                    // pago a cuenta gasolinas [112]
      n17(c69) +                  // resultado de la liquidación [71]
      (tipoDecl === "N" ? "X" : " ") + // sin actividad
      " " + s("", 13) + " " + n17(0) + " " + " " + // rectificativa: no
      s("", 546) +
      "</T30303000>";

    fichero = envolver("303", anio, periodo, p1 + p3);
    nombreFichero = `M303_${anio}_${periodo}_borrador.303`;
  }

  if (modelo === "111") {
    // Perceptores de trabajo: DNIs distintos en las nóminas del trimestre.
    const meses = [t * 3 - 2, t * 3 - 1, t * 3];
    const { data: noms } = await supabase
      .from("nominas")
      .select("dni, total_devengado")
      .eq("anio", anio)
      .in("mes", meses);
    const filasNom = (noms ?? []) as { dni: string | null; total_devengado: number | null }[];
    const c01 = new Set(filasNom.map((n) => n.dni || "?")).size;
    const c02 = r2(filasNom.reduce((s2, n) => s2 + Number(n.total_devengado ?? 0), 0));
    const c03 = r2(v("ret_000") + v("ret_001"));

    // Actividades económicas (profesionales 15/7% y agrarias 2%): la base se
    // reconstruye de la cuota; los perceptores, de las facturas con retención.
    const c09 = r2(v("ret_015") + v("ret_007") + v("ret_002"));
    const c08 = r2(v("ret_015") / 0.15 + v("ret_007") / 0.07 + v("ret_002") / 0.02);
    const ini = `${anio}-${String(t * 3 - 2).padStart(2, "0")}-01`;
    const fin = t === 4 ? `${anio}-12-31` : `${anio}-${String(t * 3 + 1).padStart(2, "0")}-01`;
    const { count: c07cnt } = await supabase
      .from("compras_doc")
      .select("proveedor", { count: "exact", head: true })
      .eq("tipo", "factura")
      .gt("retencion", 0)
      .gte("fecha", ini)
      .lt("fecha", fin);
    const c07 = Math.max(c09 > 0 ? 1 : 0, Math.min(c07cnt ?? 0, 99999999));

    const c28 = r2(c03 + c09);
    const c30 = c28;
    const tipoDecl = Math.abs(c30) < 0.005 ? "N" : "I";

    const p1 =
      "<T" + "111" + "01" + "000>" +
      " " +                        // página complementaria
      tipoDecl +                   // tipo de declaración
      s(NIF, 9) + s(RAZON, 60) + s("", 20) + String(anio) + periodo +
      ent(c01, 8) + n17(c02) + n17(c03) +   // trabajo dinerario [01-03]
      ent(0, 8) + n17(0) + n17(0) +         // trabajo en especie [04-06]
      ent(c07, 8) + n17(c08) + n17(c09) +   // actividades dinerario [07-09]
      ent(0, 8) + n17(0) + n17(0) +         // actividades en especie [10-12]
      ent(0, 8) + n17(0) + n17(0) +         // premios dinerarios [13-15]
      ent(0, 8) + n17(0) + n17(0) +         // premios en especie [16-18]
      ent(0, 8) + n17(0) + n17(0) +         // ganancias patrimoniales [19-21]
      ent(0, 8) + n17(0) + n17(0) +         // ganancias en especie [22-24]
      ent(0, 8) + n17(0) + n17(0) +         // cesión derechos de imagen [25-27]
      n17(c28) +                   // suma de retenciones [28]
      n17(0) +                     // a deducir (complementaria) [29]
      n17(c30) +                   // resultado a ingresar [30]
      " " +                        // complementaria: no
      s("", 13) +                  // justificante anterior
      " " +                        // colegio concertado: no
      s("", 34) +                  // IBAN (sin domiciliar en el borrador)
      s("", 389) + s("", 13) +
      "</T11101000>";

    fichero = envolver("111", anio, periodo, p1) + "\r\n";
    nombreFichero = `M111_${anio}_${periodo}_borrador.111`;
  }

  if (modelo === "115") {
    const c03 = r2(v("ret_019"));
    const c02 = r2(c03 / 0.19);
    // Perceptores: arrendadores distintos con retención del 19% en el trimestre.
    const ini = `${anio}-${String(t * 3 - 2).padStart(2, "0")}-01`;
    const fin = t === 4 ? `${anio}-12-31` : `${anio}-${String(t * 3 + 1).padStart(2, "0")}-01`;
    const { data: docs } = await supabase
      .from("compras_doc")
      .select("proveedor, retencion_pct")
      .eq("tipo", "factura")
      .gt("retencion", 0)
      .gte("fecha", ini)
      .lt("fecha", fin);
    const arrendadores = new Set(
      ((docs ?? []) as { proveedor: string | null; retencion_pct: number | null }[])
        .filter((d) => Math.round(Number(d.retencion_pct ?? 0)) === 19)
        .map((d) => d.proveedor || "?"),
    ).size;
    const c01 = Math.max(c03 > 0 ? 1 : 0, arrendadores);
    const c05 = c03;
    const tipoDecl = Math.abs(c05) < 0.005 ? "N" : "I";

    const p1 =
      "<T" + "115" + "01" + "000>" +
      " " +                        // página complementaria
      tipoDecl +                   // tipo de declaración
      s(NIF, 9) + s(RAZON, 60) + s("", 20) + String(anio) + periodo +
      ent(c01, 15) +               // nº de perceptores [01]
      n17(c02) +                   // base retenciones [02]
      n17(c03) +                   // retenciones [03]
      n17(0) +                     // resultados anteriores [04]
      n17(c05) +                   // resultado a ingresar [05]
      " " +                        // complementaria: no
      s("", 13) +                  // justificante anterior
      s("", 34) +                  // IBAN
      s("", 236) + s("", 13) +
      "</T11501000>";

    fichero = envolver("115", anio, periodo, p1) + "\r\n";
    nombreFichero = `M115_${anio}_${periodo}_borrador.115`;
  }

  return new NextResponse(Buffer.from(fichero, "latin1"), {
    headers: {
      "Content-Type": "text/plain; charset=iso-8859-1",
      "Content-Disposition": `attachment; filename="${nombreFichero}"`,
    },
  });
}
