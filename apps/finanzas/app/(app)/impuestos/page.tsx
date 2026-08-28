import { exigirModulo } from "@/lib/supabase/server";
import { euros } from "@/lib/importes";

export const dynamic = "force-dynamic";

/**
 * Impuestos: los modelos calculados desde el diario, trimestre a trimestre.
 * 303 (IVA), 111 y 115 (retenciones), 390 (resumen anual) y una estimación de
 * Sociedades. Hoy es la sala de máquinas para contrastar números; de aquí a
 * enero se le añade la generación del fichero oficial de AEAT para presentar.
 *
 * Los flujos salen de fin_impuestos(), que excluye la apertura y los asientos
 * de regularización/liquidación (4750/470): solo cuenta el devengo del año.
 */

type Fila = { trimestre: number; clave: string; importe: number };

const IVA_PCT: Record<string, number> = { "004": 4, "010": 10, "021": 21 };
const RET_PCT: Record<string, number> = { "001": 1, "002": 2, "007": 7, "015": 15, "019": 19 };

export default async function Impuestos({ searchParams }: { searchParams: Promise<{ anio?: string }> }) {
  const { anio: anioParam } = await searchParams;
  const anio = Number(anioParam) || new Date().getFullYear();
  const { supabase } = await exigirModulo("contabilidad");

  const rpc = supabase as unknown as {
    rpc: (fn: "fin_impuestos", args: { p_anio: number }) => PromiseLike<{ data: Fila[] | null; error: unknown }>;
  };
  const [{ data: filasData }, { data: nominasData }] = await Promise.all([
    rpc.rpc("fin_impuestos", { p_anio: anio }),
    supabase.from("nominas").select("mes, total_devengado, irpf").eq("anio", anio),
  ]);
  const filas = (filasData ?? []) as Fila[];
  const nominas = (nominasData ?? []) as { mes: number; total_devengado: number | null; irpf: number | null }[];

  // v(t, clave): el importe de ese trimestre; t=0 suma el año entero.
  const v = (t: number, clave: string) =>
    filas.filter((f) => (t === 0 || f.trimestre === t) && f.clave === clave).reduce((s, f) => s + Number(f.importe), 0);
  const nomina = (t: number, campo: "total_devengado" | "irpf") =>
    nominas.filter((n) => t === 0 || Math.ceil(n.mes / 3) === t).reduce((s, n) => s + Number(n[campo] ?? 0), 0);

  const hoy = new Date();
  const tActual = anio === hoy.getFullYear() ? Math.ceil((hoy.getMonth() + 1) / 3) : anio < hoy.getFullYear() ? 5 : 0;
  const trimestres = [1, 2, 3, 4].filter((t) => t <= tActual);
  const estado = (t: number) => (t === tActual && anio === hoy.getFullYear() ? " · en curso" : "");

  const devengadoTotal = (t: number) =>
    v(t, "rep_004") + v(t, "rep_010") + v(t, "rep_021") + v(t, "rep_otros") + v(t, "rep_isp");
  const deducibleTotal = (t: number) =>
    v(t, "sop_004") + v(t, "sop_010") + v(t, "sop_021") + v(t, "sop_012") + v(t, "sop_otros") + v(t, "sop_isp");
  const m111 = (t: number) => v(t, "ret_000") + v(t, "ret_001") + v(t, "ret_002") + v(t, "ret_007") + v(t, "ret_015");

  const num = (n: number) => (Math.abs(n) < 0.005 ? "—" : euros(n));

  function FilaIVA({ etiqueta, cuota, pct }: { etiqueta: string; cuota: number; pct?: number }) {
    if (Math.abs(cuota) < 0.005) return null;
    return (
      <tr>
        <td>{etiqueta}</td>
        <td className="numero">{pct ? euros(cuota / (pct / 100)) : "—"}</td>
        <td className="numero">{euros(cuota)}</td>
      </tr>
    );
  }

  const resultado = v(0, "ingresos") - v(0, "gastos");
  const cuotaIS = Math.max(0, resultado) * 0.25;

  return (
    <>
      <div className="cabecera-pagina con-accion">
        <div>
          <h1>Impuestos</h1>
          <p className="sub">
            Modelos calculados desde el diario, al día. La presentación con fichero de AEAT llega antes de enero.
          </p>
        </div>
        <span style={{ display: "inline-flex", gap: 8 }}>
          {[anio - 1, anio, anio + 1].filter((a) => a >= 2026 && a <= hoy.getFullYear()).map((a) => (
            <a key={a} className={a === anio ? "boton" : "boton-secundario"} href={`?anio=${a}`}>{a}</a>
          ))}
        </span>
      </div>

      {/* ── 303: IVA trimestral ─────────────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Modelo 303 · IVA trimestral</h2>
        <p className="sub" style={{ marginBottom: 12 }}>
          Bases reconstruidas desde las cuotas (base = cuota ÷ tipo). El 12% agrario (REAGYP) va como compensación.
        </p>
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          {trimestres.map((t) => {
            const res = devengadoTotal(t) - deducibleTotal(t);
            return (
              <div key={t} className="tarjeta" style={{ padding: 16 }}>
                <p className="etiqueta" style={{ marginBottom: 8 }}>{t}T {anio}{estado(t)}</p>
                <div className="tabla-envoltura">
                  <table className="tabla" style={{ fontSize: 13 }}>
                    <thead><tr><th></th><th className="a-derecha">Base</th><th className="a-derecha">Cuota</th></tr></thead>
                    <tbody>
                      {(["004", "010", "021"] as const).map((k) => (
                        <FilaIVA key={k} etiqueta={`Devengado ${IVA_PCT[k]}%`} cuota={v(t, "rep_" + k)} pct={IVA_PCT[k]} />
                      ))}
                      <FilaIVA etiqueta="Devengado ISP" cuota={v(t, "rep_isp")} />
                      <FilaIVA etiqueta="Devengado otros" cuota={v(t, "rep_otros")} />
                      {(["004", "010", "021"] as const).map((k) => (
                        <FilaIVA key={k} etiqueta={`Soportado ${IVA_PCT[k]}%`} cuota={-v(t, "sop_" + k)} pct={IVA_PCT[k]} />
                      ))}
                      <FilaIVA etiqueta="Compensación REAGYP 12%" cuota={-v(t, "sop_012")} pct={12} />
                      <FilaIVA etiqueta="Soportado ISP" cuota={-v(t, "sop_isp")} />
                      <FilaIVA etiqueta="Soportado otros" cuota={-v(t, "sop_otros")} />
                    </tbody>
                  </table>
                </div>
                <p style={{ marginTop: 10, fontSize: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span>
                    Resultado:{" "}
                    <strong style={{ color: res > 0 ? "#B4423A" : "#0F6E56" }}>
                      {euros(res)} {res > 0 ? "a ingresar" : "a compensar"}
                    </strong>
                  </span>
                  <a
                    className="boton-secundario"
                    style={{ fontSize: 12, padding: "3px 10px", marginLeft: "auto" }}
                    href={`/impuestos/fichero?anio=${anio}&t=${t}`}
                    title="Fichero en formato de presentación de AEAT (borrador para contrastar; se puede validar en la Sede sin firmar)"
                  >
                    Fichero AEAT ↓
                  </a>
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 111 y 115: retenciones ──────────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Modelos 111 y 115 · Retenciones</h2>
        <p className="sub" style={{ marginBottom: 12 }}>
          Cuotas practicadas en el trimestre (el haber de las 4751). La base del trabajo sale de las nóminas de Ratios.
        </p>
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th></th>
                {trimestres.map((t) => <th key={t} className="a-derecha">{t}T{estado(t)}</th>)}
                <th className="a-derecha">Año</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>111 · Trabajo (nóminas) — base devengada</td>
                {trimestres.map((t) => <td key={t} className="numero">{num(nomina(t, "total_devengado"))}</td>)}
                <td className="numero">{num(nomina(0, "total_devengado"))}</td>
              </tr>
              <tr>
                <td>111 · Trabajo — retención practicada</td>
                {trimestres.map((t) => <td key={t} className="numero">{num(v(t, "ret_000"))}</td>)}
                <td className="numero">{num(v(0, "ret_000"))}</td>
              </tr>
              {(["015", "007", "002", "001"] as const).map((k) => (
                <tr key={k}>
                  <td>111 · Actividades {RET_PCT[k]}% — retención</td>
                  {trimestres.map((t) => <td key={t} className="numero">{num(v(t, "ret_" + k))}</td>)}
                  <td className="numero">{num(v(0, "ret_" + k))}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600 }}>
                <td>111 · Total a ingresar</td>
                {trimestres.map((t) => <td key={t} className="numero">{num(m111(t))}</td>)}
                <td className="numero">{num(m111(0))}</td>
              </tr>
              <tr>
                <td>115 · Alquileres — base (cuota ÷ 19%)</td>
                {trimestres.map((t) => <td key={t} className="numero">{num(v(t, "ret_019") / 0.19)}</td>)}
                <td className="numero">{num(v(0, "ret_019") / 0.19)}</td>
              </tr>
              <tr style={{ fontWeight: 600 }}>
                <td>115 · Total a ingresar</td>
                {trimestres.map((t) => <td key={t} className="numero">{num(v(t, "ret_019"))}</td>)}
                <td className="numero">{num(v(0, "ret_019"))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 390 y Sociedades ────────────────────────────────────────────── */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Resumen anual</h2>
        <div className="tarjetas">
          <div className="tarjeta">
            <p className="etiqueta">390 · IVA devengado {anio}</p>
            <p className="valor dato">{euros(devengadoTotal(0))}</p>
          </div>
          <div className="tarjeta">
            <p className="etiqueta">390 · IVA deducible {anio}</p>
            <p className="valor dato">{euros(deducibleTotal(0))}</p>
          </div>
          <div className="tarjeta">
            <p className="etiqueta">390 · Resultado {anio}</p>
            <p className={devengadoTotal(0) - deducibleTotal(0) > 0 ? "valor dato alerta" : "valor dato"}>
              {euros(devengadoTotal(0) - deducibleTotal(0))}
            </p>
          </div>
        </div>

        <h2 style={{ fontSize: 18, fontWeight: 600, margin: "24px 0 4px" }}>Sociedades · estimación orientativa</h2>
        <p className="sub" style={{ marginBottom: 12 }}>
          Resultado contable acumulado × 25%, sin ajustes fiscales ni compensación de bases negativas: es un orden de
          magnitud, no una liquidación. Pagos fraccionados (202): abril, octubre y diciembre.
        </p>
        <div className="tarjetas">
          <div className="tarjeta">
            <p className="etiqueta">Ingresos (grupo 7)</p>
            <p className="valor dato">{euros(v(0, "ingresos"))}</p>
          </div>
          <div className="tarjeta">
            <p className="etiqueta">Gastos (grupo 6)</p>
            <p className="valor dato">{euros(v(0, "gastos"))}</p>
          </div>
          <div className="tarjeta">
            <p className="etiqueta">Resultado contable</p>
            <p className={resultado < 0 ? "valor dato alerta" : "valor dato"}>{euros(resultado)}</p>
          </div>
          <div className="tarjeta">
            <p className="etiqueta">Cuota estimada (25%)</p>
            <p className="valor dato">{euros(cuotaIS)}</p>
          </div>
          <div className="tarjeta">
            <p className="etiqueta">Retenciones y pagos a cuenta</p>
            <p className="valor dato">{euros(v(0, "ret_favor") + v(0, "pagos_is"))}</p>
          </div>
        </div>
      </section>

      <p className="pista">
        Estos números salen del diario en vivo: si falta contabilidad por entrar (facturas en Compras sin numerar,
        extractos sin conciliar), los modelos se quedan cortos. Antes de presentar, cuadrar siempre con Sumas y saldos.
      </p>
    </>
  );
}
