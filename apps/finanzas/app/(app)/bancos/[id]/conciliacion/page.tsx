import { notFound } from "next/navigation";
import { exigirModulo } from "@/lib/supabase/server";
import { ruta } from "@/lib/rutas";
import SelectorGrupo from "./selector-grupo";
import SelectorLiquidacion from "./selector-liquidacion";
import SelectorMes from "./selector-mes";
import { euros, fecha } from "@/lib/importes";
import {
  clasificarMovimiento,
  conciliarGrupo,
  conciliarManual,
  desconciliarLiquidacion,
  desconciliarMovimiento,
  ignorarMovimiento,
  lanzarConciliacionAuto,
} from "@/app/acciones-bancos";

// Destinos rápidos para movimientos sin factura. La caja es ÚNICA (decisión
// de Luis, 28-08-2026): el centro solo aporta en ingresos, gastos y activos —
// el efectivo se ingresa todo junto y Adyen/Shopify van al mismo saco. El
// asiento contra el banco se genera solo.
const DESTINOS: [string, string][] = [
  ["570000000", "Caja (única)"],
  ["570000500", "Propinas"],
  ["460000000", "Anticipos de nómina"],
  ["642000000|0e5c90bd-62e9-4f6f-877e-bb2228f10325", "SS autónomos (642)"],
  ["626000002", "Comisión bancaria"],
  ["626000001", "Comisión Adyen (Agora Payments)"],
  ["626000005", "Comisión Codetickets"],
  ["626000003", "Comisión Stripe (Shopify)"],
];

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
type Sugerencia = { mov_id: string; ap_id: string; asiento_numero: number; asiento_fecha: string; descripcion: string; importe: number; dias: number };
type Grupo = { mov_id: string; ap_ids: string[]; etiqueta: string };
type Candidato = { ap_id: string; asiento_numero: number; asiento_fecha: string; descripcion: string; importe: number };
type CandidatoCartera = Candidato & { cuenta_codigo: string };
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
  searchParams: Promise<{ estado?: string; q?: string; mes?: string; pag?: string; orden?: string; dir?: string; sentido?: string; grupo?: string; liq?: string }>;
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
    rpc: (fn: string, args: { p_banco: string; p_desde?: string; p_hasta?: string }) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  // Con mes elegido, los indicadores hablan de ESE mes (saldos a fin de mes).
  const rango: { p_desde?: string; p_hasta?: string } = {};
  if (mes) {
    const [a, mm] = mes.split("-").map(Number);
    rango.p_desde = `${mes}-01`;
    rango.p_hasta = new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10);
  }
  // El selector de grupo se abre para UN movimiento (?grupo=id): sus
  // candidatos se piden solo entonces, no para toda la tabla.
  const grupoAbierto = sp.grupo ?? "";
  // El selector de liquidación (?liq=id) es su gemelo: candidatos de CARTERA
  // (clientes 43x, proveedores 40x/41x, nóminas 465, IRPF 475, SS 476).
  const liqAbierto = sp.liq ?? "";
  const rpcCand = supabase as unknown as {
    rpc: (fn: "fin_conciliacion_candidatos" | "fin_cartera_candidatos", args: { p_banco: string; p_mov: string }) => PromiseLike<{ data: unknown }>;
  };
  const [{ data: movsData, error }, { data: resumenData }, { data: sugData }, { data: gruposData }, candResp, cartResp] = await Promise.all([
    consulta,
    rpc.rpc("fin_conciliacion_resumen", { p_banco: id, ...rango }),
    rpc.rpc("fin_conciliacion_sugerencias", { p_banco: id }),
    rpc.rpc("fin_conciliacion_grupos", { p_banco: id }),
    grupoAbierto ? rpcCand.rpc("fin_conciliacion_candidatos", { p_banco: id, p_mov: grupoAbierto }) : Promise.resolve({ data: null }),
    liqAbierto ? rpcCand.rpc("fin_cartera_candidatos", { p_banco: id, p_mov: liqAbierto }) : Promise.resolve({ data: null }),
  ]);

  const movs = (movsData ?? []) as Mov[];
  const resumen = ((resumenData as Resumen[] | null) ?? [])[0] ?? null;
  const sugerencias = new Map<string, Sugerencia[]>();
  for (const s of ((sugData as Sugerencia[] | null) ?? [])) {
    (sugerencias.get(s.mov_id) ?? sugerencias.set(s.mov_id, []).get(s.mov_id)!).push(s);
  }
  const grupos = new Map<string, Grupo[]>();
  for (const g of ((gruposData as Grupo[] | null) ?? [])) {
    (grupos.get(g.mov_id) ?? grupos.set(g.mov_id, []).get(g.mov_id)!).push(g);
  }
  const candidatos = ((candResp.data as Candidato[] | null) ?? []);
  const candidatosCartera = ((cartResp.data as CandidatoCartera[] | null) ?? []);

  // La PRUEBA de cada conciliado: qué asiento se generó/enlazó y contra qué
  // facturas o cuentas se cruzó (con el importe aplicado, que puede ser
  // parcial). Sin esto la conciliación es un acto de fe.
  type Contra = { asiento_id: string; numero: number; descripcion: string; importe: number };
  const asientoDeMov = new Map<string, { asiento_id: string; numero: number; descripcion: string }>();
  const origenesDeMov = new Map<string, Contra[]>();
  {
    const conciliados = movs.filter((m) => m.estado === "conciliado");
    const apIds = conciliados.map((m) => m.apunte_id).filter(Boolean) as string[];
    if (conciliados.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [apsR, origR] = (await Promise.all([
        apIds.length
          ? supabase.from("fin_apuntes").select("id, fin_asientos(id, numero, descripcion)").in("id", apIds)
          : Promise.resolve({ data: [] }),
        supabase
          .from("fin_banco_mov_apuntes")
          .select("movimiento_id, importe, fin_apuntes(debe, haber, fin_asientos(id, numero, descripcion))")
          .in("movimiento_id", conciliados.map((m) => m.id)),
      ])) as any[];
      const asientoPorApunte = new Map<string, { asiento_id: string; numero: number; descripcion: string }>();
      for (const a of apsR.data ?? []) {
        const asi = Array.isArray(a.fin_asientos) ? a.fin_asientos[0] : a.fin_asientos;
        if (asi) asientoPorApunte.set(a.id, { asiento_id: asi.id, numero: asi.numero, descripcion: asi.descripcion ?? "" });
      }
      for (const m of conciliados) {
        if (m.apunte_id && asientoPorApunte.has(m.apunte_id)) asientoDeMov.set(m.id, asientoPorApunte.get(m.apunte_id)!);
      }
      for (const o of origR.data ?? []) {
        const ap = Array.isArray(o.fin_apuntes) ? o.fin_apuntes[0] : o.fin_apuntes;
        const asi = ap && (Array.isArray(ap.fin_asientos) ? ap.fin_asientos[0] : ap.fin_asientos);
        if (!asi) continue;
        const lista = origenesDeMov.get(o.movimiento_id) ?? [];
        lista.push({
          asiento_id: asi.id,
          numero: asi.numero,
          descripcion: asi.descripcion ?? "",
          importe: Number(o.importe ?? Number(ap.debe) + Number(ap.haber)),
        });
        origenesDeMov.set(o.movimiento_id, lista);
      }
    }
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
      ...(pag > 1 ? { pag: String(pag) } : {}),
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
            [mes ? `Movimientos ${mes.split("-").reverse().join("/")}` : "Movimientos", String(resumen.total)],
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
          <SelectorMes meses={MESES_EXTRACTO} valor={mes} />
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
                      {m.estado === "conciliado"
                        ? `✓ ${m.conciliado_via === "liquidacion" ? "liquidación" : m.conciliado_via === "clasificacion" ? "clasificado" : m.conciliado_via ?? "manual"}`
                        : m.estado}
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
                                  {euros(Number(s.importe))} · nº {s.asiento_numero} · {fecha(s.asiento_fecha)} · {s.descripcion.slice(0, 36)}
                                </option>
                              ))}
                            </select>
                            <button className="boton-secundario" type="submit" style={{ fontSize: 13 }}>Conciliar</button>
                          </form>
                          <BotonIgnorar bancoId={id} movId={m.id} />
                        </span>
                      )}
                      {m.estado === "pendiente" && sug.length === 0 && (
                        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          {(grupos.get(m.id) ?? []).map((g, gi) => (
                            <form key={gi} action={conciliarGrupo} style={{ display: "inline" }}>
                              <input type="hidden" name="banco" value={id} />
                              <input type="hidden" name="mov" value={m.id} />
                              {g.ap_ids.map((apId) => (
                                <input key={apId} type="hidden" name="apunte" value={apId} />
                              ))}
                              <button className="boton-secundario" type="submit" style={{ fontSize: 12 }} title="Conciliar contra la suma de estos apuntes">
                                Σ {g.etiqueta}
                              </button>
                            </form>
                          ))}
                          {(grupos.get(m.id) ?? []).length === 0 && (
                            <span className="secundario" style={{ display: "inline" }}>sin candidato en el diario</span>
                          )}
                          <a
                            className="boton-secundario"
                            style={{ fontSize: 12, padding: "3px 10px" }}
                            href={enlace({ grupo: grupoAbierto === m.id ? "" : m.id })}
                            title="Cruzar contra apuntes del banco (572) que ya estén en el diario"
                          >
                            {grupoAbierto === m.id ? "Cerrar" : "Diario…"}
                          </a>
                          <BotonIgnorar bancoId={id} movId={m.id} />
                        </span>
                      )}
                      {m.estado === "pendiente" && (
                        <a
                          className="boton-secundario"
                          style={{ fontSize: 12, padding: "3px 10px", marginLeft: 6 }}
                          href={enlace({ liq: liqAbierto === m.id ? "" : m.id })}
                          title="Cobrar/pagar facturas o nóminas pendientes: genera el asiento contra el banco"
                        >
                          {liqAbierto === m.id ? "Cerrar" : "Liquidar…"}
                        </a>
                      )}
                      {m.estado === "pendiente" && (
                        <form action={clasificarMovimiento} style={{ display: "inline-flex", gap: 4, marginLeft: 6, alignItems: "center" }}>
                          <input type="hidden" name="banco" value={id} />
                          <input type="hidden" name="mov" value={m.id} />
                          <select name="destino" defaultValue="" style={{ maxWidth: 150, padding: "3px 4px", border: "1px solid #DDE2DF", borderRadius: 6, fontSize: 12 }}>
                            <option value="" disabled>Enviar a…</option>
                            {DESTINOS.map(([v, t]) => (
                              <option key={v} value={v}>{t}</option>
                            ))}
                          </select>
                          <button className="boton-secundario" type="submit" style={{ fontSize: 12, padding: "3px 8px" }} title="Genera el asiento contra esa cuenta y concilia el movimiento">
                            OK
                          </button>
                        </form>
                      )}
                      {m.estado === "pendiente" && grupoAbierto === m.id && (
                        <SelectorGrupo bancoId={id} movId={m.id} objetivo={Number(m.importe)} candidatos={candidatos} />
                      )}
                      {m.estado === "pendiente" && liqAbierto === m.id && (
                        <SelectorLiquidacion bancoId={id} movId={m.id} objetivo={Number(m.importe)} candidatos={candidatosCartera} />
                      )}
                      {m.estado === "conciliado" && asientoDeMov.has(m.id) && (
                        <span className="secundario" style={{ display: "block", marginBottom: 4 }}>
                          →{" "}
                          <a className="enlace" href={ruta(`/asientos/${asientoDeMov.get(m.id)!.asiento_id}`)}>
                            nº {asientoDeMov.get(m.id)!.numero}
                          </a>{" "}
                          {asientoDeMov.get(m.id)!.descripcion.slice(0, 44)}
                          {(origenesDeMov.get(m.id) ?? []).map((o) => (
                            <span key={o.asiento_id + o.numero} style={{ display: "block", paddingLeft: 14 }}>
                              contra{" "}
                              <a className="enlace" href={ruta(`/asientos/${o.asiento_id}`)}>
                                nº {o.numero}
                              </a>{" "}
                              {o.descripcion.slice(0, 40)} · {euros(o.importe)}
                            </span>
                          ))}
                        </span>
                      )}
                      {m.estado !== "pendiente" && (
                        <form
                          action={m.conciliado_via === "liquidacion" || m.conciliado_via === "clasificacion" ? desconciliarLiquidacion : desconciliarMovimiento}
                          style={{ display: "inline" }}
                        >
                          <input type="hidden" name="banco" value={id} />
                          <input type="hidden" name="mov" value={m.id} />
                          <button
                            className="boton-secundario"
                            type="submit"
                            style={{ fontSize: 12 }}
                            title={m.conciliado_via === "liquidacion" ? "Deshace la conciliación Y borra el asiento de cobro/pago generado" : undefined}
                          >
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
        comisiones…) — para esos está «Ignorar». Con «Liquidar…» el movimiento se cruza contra lo
        VIVO — facturas de cliente por cobrar, de proveedor por pagar, nóminas, IRPF o Seguridad
        Social — y al cuadrar la suma se genera solo el asiento de cobro/pago contra el banco,
        liquidando de paso la cartera. La diferencia de saldos de arriba es la deuda real
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
