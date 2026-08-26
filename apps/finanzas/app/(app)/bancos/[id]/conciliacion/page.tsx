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
  pend_cobros: number; pend_cobros_importe: number;
  pend_pagos: number; pend_pagos_importe: number;
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
  searchParams: Promise<{ estado?: string; q?: string; mes?: string; pag?: string; orden?: string; dir?: string; sentido?: string }>;
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
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : "";
  const pag = Math.max(1, parseInt(sp.pag ?? "1", 10) || 1);
  // Orden clicable: por fecha (defecto), concepto —que aquí hace de
  // proveedor—, importe o estado. La fecha desempata siempre.
  const orden = ["fecha", "concepto", "importe", "estado"].includes(sp.orden ?? "") ? sp.orden! : "fecha";
  const dir = sp.dir === "asc" ? "asc" : "desc";
  // Cobros = entradas (importe > 0), pagos = salidas. El signo ES el sentido.
  const sentido = ["cobros", "pagos"].includes(sp.sentido ?? "") ? sp.sentido! : "";

  // La misma consulta dos veces: una contada (para saber cuántas páginas hay)
  // y otra paginada. El filtro por mes acota por fecha de movimiento.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtrar = <T,>(c: T): T => {
    // Los métodos de filtro del builder devuelven el propio builder; el molde
    // laxo evita pelear con los genéricos de supabase-js en las dos variantes
    // (con y sin count) de la misma consulta.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = c as any;
    let r = b.eq("banco_cuenta_id", id);
    if (estadoFiltro !== "todos") r = r.eq("estado", estadoFiltro);
    if (q) r = r.or(`concepto.ilike.%${q.replace(/[,()*%\\]/g, " ")}%,detalle.ilike.%${q.replace(/[,()*%\\]/g, " ")}%`);
    if (mes) {
      const [a, m] = mes.split("-").map(Number);
      const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
      r = r.gte("fecha", `${mes}-01`).lte("fecha", fin);
    }
    if (sentido === "cobros") r = r.gt("importe", 0);
    if (sentido === "pagos") r = r.lt("importe", 0);
    return r as T;
  };

  const consulta = filtrar(
    supabase
      .from("fin_banco_movimientos")
      .select("id, fecha, concepto, detalle, importe, saldo, estado, conciliado_via, apunte_id"),
  )
    .order(orden, { ascending: dir === "asc" })
    .order("fecha", { ascending: false })
    .range((pag - 1) * LIMITE, pag * LIMITE - 1);

  const { count: totalFiltrado } = await filtrar(
    supabase.from("fin_banco_movimientos").select("id", { count: "exact", head: true }),
  );

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
  const enlace = (cambios: Record<string, string>) => {
    const base: Record<string, string> = {
      estado: estadoFiltro,
      ...(q ? { q } : {}),
      ...(mes ? { mes } : {}),
      ...(orden !== "fecha" || dir !== "desc" ? { orden, dir } : {}),
      ...(sentido ? { sentido } : {}),
      ...cambios,
    };
    const p = Object.entries(base)
      .filter(([, v]) => v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    return ruta(`/bancos/${id}/conciliacion?${p}`);
  };

  const total = totalFiltrado ?? 0;
  const paginas = Math.max(1, Math.ceil(total / LIMITE));
  const desde = total === 0 ? 0 : (pag - 1) * LIMITE + 1;
  const hastaN = Math.min(pag * LIMITE, total);

  // Meses con datos: del primero del extracto al último (2026 de momento).
  const MESES_EXTRACTO = ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];

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
            ["· cobros", `${resumen.pend_cobros} (${euros(Number(resumen.pend_cobros_importe))})`],
            ["· pagos", `${resumen.pend_pagos} (${euros(Number(resumen.pend_pagos_importe))})`],
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
          {(
            [
              ["", "Cobros y pagos"],
              ["cobros", "Solo cobros"],
              ["pagos", "Solo pagos"],
            ] as const
          ).map(([v, t]) => (
            <a
              key={t}
              href={enlace({ sentido: v, pag: "" })}
              className="boton-secundario"
              style={{ padding: "5px 12px", fontSize: 13, ...(sentido === v ? { background: "#1B2420", color: "#fff", borderColor: "#1B2420" } : {}) }}
            >
              {t}
            </a>
          ))}
          {(["pendiente", "conciliado", "ignorado", "todos"] as const).map((e) => (
            <a
              key={e}
              href={enlace({ estado: e, pag: "" })}
              className="boton-secundario"
              style={{ padding: "5px 12px", fontSize: 13, ...(estadoFiltro === e ? { background: "#0F6E56", color: "#fff", borderColor: "#0F6E56" } : {}) }}
            >
              {e === "todos" ? "Todos" : e[0].toUpperCase() + e.slice(1) + "s"}
            </a>
          ))}
        </div>
        <form method="get" style={{ display: "flex", gap: 6, flex: "1 1 300px" }}>
          <input type="hidden" name="estado" value={estadoFiltro} />
          <select name="mes" defaultValue={mes} style={{ padding: "6px 8px", border: "1px solid #DDE2DF", borderRadius: 6 }}>
            <option value="">Todo el año</option>
            {MESES_EXTRACTO.map((m) => (
              <option key={m} value={m}>{m.split("-").reverse().join("/")}</option>
            ))}
          </select>
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
                {(
                  [
                    ["fecha", "Fecha", ""],
                    ["concepto", "Concepto", ""],
                    ["importe", "Importe", "a-derecha"],
                    ["estado", "Estado", ""],
                  ] as const
                ).map(([campo, titulo, clase]) => (
                  <th key={campo} className={clase || undefined}>
                    <a
                      href={enlace({ orden: campo, dir: orden === campo && dir === "desc" ? "asc" : "desc", pag: "" })}
                      style={{ color: "inherit", textDecoration: "none", cursor: "pointer" }}
                      title={`Ordenar por ${titulo.toLowerCase()}`}
                    >
                      {titulo}
                      {orden === campo ? (dir === "asc" ? " ↑" : " ↓") : ""}
                    </a>
                  </th>
                ))}
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

      {total > 0 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end", margin: "12px 0" }}>
          <span className="secundario" style={{ display: "inline" }}>
            {desde}–{hastaN} de {total}
          </span>
          {pag > 1 && <a className="boton-secundario" style={{ padding: "4px 12px", fontSize: 13 }} href={enlace({ pag: String(pag - 1) })}>← Anteriores</a>}
          {pag < paginas && <a className="boton-secundario" style={{ padding: "4px 12px", fontSize: 13 }} href={enlace({ pag: String(pag + 1) })}>Siguientes →</a>}
        </div>
      )}

      <p className="pista">
        La tabla va de {LIMITE} en {LIMITE}, del más reciente al más antiguo; con el selector de mes
        acotas el periodo. «Sin candidato en el diario» significa que
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
