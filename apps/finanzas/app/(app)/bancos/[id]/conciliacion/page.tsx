import { notFound } from "next/navigation";
import { exigirModulo } from "@/lib/supabase/server";
import { ruta } from "@/lib/rutas";
import { euros, fecha } from "@/lib/importes";
import {
  conciliarManual,
  desconciliarMovimiento,
  ignorarMovimiento,
  lanzarConciliacionAuto,
} from "@/app/acciones-bancos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMITE = 200;

type Mov = {
  id: string;
  fecha: string;
  concepto: string;
  detalle: string | null;
  importe: number;
  saldo: number | null;
  estado: string;
  conciliado_via: string | null;
  apunte_id: string | null;
};
type Sugerencia = { mov_id: string; ap_id: string; asiento_numero: number; asiento_fecha: string; descripcion: string };
type Resumen = {
  total: number; conciliados: number; pendientes: number; ignorados: number;
  saldo_banco: number | null; saldo_contable: number | null;
};

/**
 * Conciliación bancaria: el extracto del banco frente al diario. El cruce
 * automático ya emparejó lo inequívoco; esta pantalla es para lo demás —
 * elegir entre candidatos, ignorar lo que no toca conciliar, y vigilar la
 * diferencia entre el saldo del banco y el de la 572.
 */
export default async function Conciliacion({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ estado?: string; q?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await exigirModulo("contabilidad");

  const { data: banco } = await supabase
    .from("fin_bancos_cuentas")
    .select("id, nombre, iban")
    .eq("id", id)
    .maybeSingle();
  if (!banco) notFound();

  const estadoFiltro = ["pendiente", "conciliado", "ignorado", "todos"].includes(sp.estado ?? "")
    ? sp.estado!
    : "pendiente";
  const q = (sp.q ?? "").trim();

  let consulta = supabase
    .from("fin_banco_movimientos")
    .select("id, fecha, concepto, detalle, importe, saldo, estado, conciliado_via, apunte_id")
    .eq("banco_cuenta_id", id)
    .order("fecha", { ascending: false })
    .limit(LIMITE);
  if (estadoFiltro !== "todos") consulta = consulta.eq("estado", estadoFiltro);
  if (q) consulta = consulta.or(`concepto.ilike.%${q.replace(/[,()*%\\]/g, " ")}%,detalle.ilike.%${q.replace(/[,()*%\\]/g, " ")}%`);

  const rpc = supabase as unknown as {
    rpc: (fn: string, args: { p_banco: string }) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  const [{ data: movsData, error }, { data: resumenData }, { data: sugData }] = await Promise.all([
    consulta,
    rpc.rpc("fin_conciliacion_resumen", { p_banco: id }),
    rpc.rpc("fin_conciliacion_sugerencias", { p_banco: id }),
  ]);

  const movs = (movsData ?? []) as Mov[];
  const resumen = ((resumenData as Resumen[] | null) ?? [])[0] ?? null;
  const sugerencias = new Map<string, Sugerencia[]>();
  for (const s of ((sugData as Sugerencia[] | null) ?? [])) {
    (sugerencias.get(s.mov_id) ?? sugerencias.set(s.mov_id, []).get(s.mov_id)!).push(s);
  }

  const dif =
    resumen?.saldo_banco != null && resumen?.saldo_contable != null
      ? Math.round((Number(resumen.saldo_banco) - Number(resumen.saldo_contable)) * 100) / 100
      : null;
  const pct = resumen && resumen.total > 0 ? Math.round((resumen.conciliados / resumen.total) * 100) : 0;

  // <a> crudos: el prefijo /finanzas del multizona no se añade solo (lib/rutas.ts).
  const enlace = (estado: string) =>
    ruta(`/bancos/${id}/conciliacion?estado=${estado}${q ? `&q=${encodeURIComponent(q)}` : ""}`);

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Conciliación · {banco.nombre}</h1>
        <p className="sub">
          {banco.iban} · el extracto del banco frente al diario. El cruce automático empareja lo
          inequívoco; aquí se decide lo demás.
        </p>
      </div>

      {resumen && (
        <div className="tarjetas-kpi" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 18 }}>
          {[
            ["Movimientos", String(resumen.total)],
            ["Conciliados", `${resumen.conciliados} (${pct}%)`],
            ["Pendientes", String(resumen.pendientes)],
            ["Ignorados", String(resumen.ignorados)],
            ["Saldo banco", resumen.saldo_banco != null ? euros(Number(resumen.saldo_banco)) : "—"],
            ["Saldo contable 572", resumen.saldo_contable != null ? euros(Number(resumen.saldo_contable)) : "—"],
            ["Diferencia", dif != null ? euros(dif) : "—"],
          ].map(([k, v]) => (
            <div key={k} style={{ background: "#fff", border: "1px solid #DDE2DF", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 12, color: "#5F6B65" }}>{k}</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: k === "Diferencia" && dif ? "#B4423A" : undefined }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="barra-filtros" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {(["pendiente", "conciliado", "ignorado", "todos"] as const).map((e) => (
            <a
              key={e}
              href={enlace(e)}
              className="boton-secundario"
              style={{ padding: "5px 12px", fontSize: 13, ...(estadoFiltro === e ? { background: "#0F6E56", color: "#fff", borderColor: "#0F6E56" } : {}) }}
            >
              {e === "todos" ? "Todos" : e[0].toUpperCase() + e.slice(1) + "s"}
            </a>
          ))}
        </div>
        <form method="get" style={{ display: "flex", gap: 6, flex: "1 1 220px" }}>
          <input type="hidden" name="estado" value={estadoFiltro} />
          <input name="q" defaultValue={q} placeholder="Buscar en concepto o detalle…" style={{ flex: 1, padding: "6px 10px", border: "1px solid #DDE2DF", borderRadius: 6 }} />
          <button className="boton-secundario" type="submit">Buscar</button>
        </form>
        <form action={lanzarConciliacionAuto}>
          <input type="hidden" name="banco" value={id} />
          <button className="boton" type="submit" title="Vuelve a cruzar los pendientes contra el diario (tras cargar extracto o diario nuevos)">
            ↻ Cruce automático
          </button>
        </form>
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudieron cargar los movimientos</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && movs.length === 0 && (
        <div className="estado-vacio">
          <strong>{estadoFiltro === "pendiente" ? "No queda nada pendiente" : "Sin movimientos en este filtro"}</strong>
          {estadoFiltro === "pendiente" ? "Todo el extracto está conciliado o ignorado." : ""}
        </div>
      )}

      {!error && movs.length > 0 && (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th className="a-derecha">Importe</th>
                <th>Estado</th>
                <th style={{ minWidth: 340 }}>Conciliación</th>
              </tr>
            </thead>
            <tbody>
              {movs.map((m) => {
                const sug = sugerencias.get(m.id) ?? [];
                return (
                  <tr key={m.id}>
                    <td className="dato">{fecha(m.fecha)}</td>
                    <td>
                      {m.concepto}
                      {m.detalle && <span className="secundario">{m.detalle}</span>}
                    </td>
                    <td className="numero" style={{ color: m.importe < 0 ? "#B4423A" : "#0F6E56" }}>
                      {euros(Number(m.importe))}
                    </td>
                    <td>
                      {m.estado === "conciliado" ? (m.conciliado_via === "auto" ? "✓ auto" : "✓ manual") : m.estado}
                    </td>
                    <td>
                      {m.estado === "pendiente" && sug.length > 0 && (
                        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <form action={conciliarManual} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                            <input type="hidden" name="banco" value={id} />
                            <input type="hidden" name="mov" value={m.id} />
                            <select name="apunte" style={{ maxWidth: 240, padding: "4px 6px", border: "1px solid #DDE2DF", borderRadius: 6, fontSize: 13 }}>
                              {sug.map((s) => (
                                <option key={s.ap_id} value={s.ap_id}>
                                  nº {s.asiento_numero} · {fecha(s.asiento_fecha)} · {s.descripcion.slice(0, 40)}
                                </option>
                              ))}
                            </select>
                            <button className="boton-secundario" type="submit" style={{ fontSize: 13 }}>Conciliar</button>
                          </form>
                          <BotonIgnorar bancoId={id} movId={m.id} />
                        </span>
                      )}
                      {m.estado === "pendiente" && sug.length === 0 && (
                        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                          <span className="secundario" style={{ display: "inline" }}>sin candidato en el diario</span>
                          <BotonIgnorar bancoId={id} movId={m.id} />
                        </span>
                      )}
                      {m.estado !== "pendiente" && (
                        <form action={desconciliarMovimiento} style={{ display: "inline" }}>
                          <input type="hidden" name="banco" value={id} />
                          <input type="hidden" name="mov" value={m.id} />
                          <button className="boton-secundario" type="submit" style={{ fontSize: 12 }}>
                            {m.estado === "ignorado" ? "Recuperar" : "Deshacer"}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="pista">
        Se enseñan los {LIMITE} más recientes del filtro. «Sin candidato en el diario» significa que
        no hay ningún apunte de la 572 con ese importe a menos de 10 días: o falta el asiento en el
        diario cargado, o el movimiento no se contabiliza suelto (liquidaciones agrupadas de TPV,
        comisiones…) — para esos está «Ignorar». La diferencia de saldos de arriba es la deuda real
        de la conciliación: a cero, banco y contabilidad dicen lo mismo.
      </p>
    </>
  );
}

function BotonIgnorar({ bancoId, movId }: { bancoId: string; movId: string }) {
  return (
    <form action={ignorarMovimiento} style={{ display: "inline" }}>
      <input type="hidden" name="banco" value={bancoId} />
      <input type="hidden" name="mov" value={movId} />
      <button className="boton-secundario" type="submit" style={{ fontSize: 12 }}>Ignorar</button>
    </form>
  );
}
