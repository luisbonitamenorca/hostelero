"use client";

import { useEffect, useState } from "react";
import * as api from "../acciones";
import { NOMBRES_DIA, dowDe, h5, hoyISO, type Restaurante } from "../tipos";
import type { SecProps } from "../lib-reservas";
import "./informes.css";

/* Informes: KPIs y gráficas sencillas del periodo. */
export default function SecInformes({ rest }: SecProps) {
  return <TabDatos rest={rest} />;
}

/* ---- Datos ---- */
export function TabDatos({ rest }: { rest: Restaurante }) {
  const [rango, setRango] = useState("mes");
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.datosRango>> | null>(null);

  useEffect(() => {
    setDatos(null);
    const hoy = new Date(hoyISO() + "T12:00:00");
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    let ini: string, fin: string;
    if (rango === "mes") { ini = hoyISO().slice(0, 8) + "01"; fin = hoyISO(); }
    else if (rango === "mes-1") {
      ini = iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
      fin = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0));
    } else if (rango === "todo") { ini = "2000-01-01"; fin = "2099-12-31"; }
    else {
      const d = new Date(hoy);
      d.setDate(d.getDate() - parseInt(rango));
      ini = iso(d);
      fin = hoyISO();
    }
    api.datosRango(rest.id, ini, fin).then(setDatos);
  }, [rest.id, rango]);

  const barra = (eti: string, segs: { v: number; c: string }[], val: number, max: number) => (
    <div className="fila-bar" key={eti}>
      <div className="eti">{eti}</div>
      <div className="pista">
        {segs.map((s, i) => (
          <div key={i} className="seg" style={{ width: `${max ? (s.v / max) * 100 : 0}%`, background: s.c }} />
        ))}
      </div>
      <div className="val">{val}</div>
    </div>
  );

  return (
    <>
      <select value={rango} onChange={(e) => setRango(e.target.value)} style={{ maxWidth: 230 }}>
        <option value="mes">Este mes</option>
        <option value="mes-1">Mes anterior</option>
        <option value="30">Últimos 30 días</option>
        <option value="90">Últimos 90 días</option>
        <option value="todo">Toda la temporada</option>
      </select>
      <div style={{ marginTop: 12 }}>
        {!datos ? (
          <div className="spinner" />
        ) : !datos.ok ? (
          <div className="aviso err">No se han podido cargar los datos.</div>
        ) : !datos.rows.length ? (
          <div className="vacio">Sin reservas de {rest.nombre} en ese periodo.</div>
        ) : (
          (() => {
            const rows = datos.rows;
            const vivas = rows.filter((r) => r.estado !== "cancelada");
            const asistidas = rows.filter((r) => ["terminada", "sentada"].includes(r.estado));
            const noshows = rows.filter((r) => r.estado === "no_show");
            const canceladas = rows.length - vivas.length;
            const paxAsistidos = asistidas.reduce((a, r) => a + r.pax, 0);
            const paxFuturos = vivas.filter((r) => ["pendiente", "confirmada"].includes(r.estado)).reduce((a, r) => a + r.pax, 0);
            const online = vivas.filter((r) => r.origen === "online").length;
            const pctNoShow = noshows.length + asistidas.length ? Math.round((noshows.length / (noshows.length + asistidas.length)) * 100) : 0;

            const dias = Array.from({ length: 7 }, () => ({ c: 0, n: 0 }));
            vivas.filter((r) => r.estado !== "no_show").forEach((r) => {
              const d = dias[dowDe(r.fecha) - 1];
              if (h5(r.hora) < "17:00") d.c += r.pax;
              else d.n += r.pax;
            });
            const maxDia = Math.max(...dias.map((d) => d.c + d.n), 1);

            const canales: Record<string, number> = {};
            vivas.forEach((r) => {
              const c = r.canal || r.origen;
              canales[c] = (canales[c] || 0) + r.pax;
            });
            const topCanales = Object.entries(canales).sort((a, b) => b[1] - a[1]).slice(0, 7);
            const maxCanal = topCanales.length ? topCanales[0][1] : 1;

            const porCliente: Record<string, number> = {};
            asistidas.forEach((r) => { if (r.cliente_id) porCliente[r.cliente_id] = (porCliente[r.cliente_id] || 0) + 1; });
            const topIds = Object.entries(porCliente).sort((a, b) => b[1] - a[1]).slice(0, 8);

            return (
              <>
                <div className="kpis">
                  <div className="kpi"><b>{rows.length}</b><span>reservas</span></div>
                  <div className="kpi"><b>{paxAsistidos}</b><span>pax servidos</span></div>
                  <div className="kpi"><b>{paxFuturos}</b><span>pax por venir</span></div>
                  <div className="kpi"><b>{pctNoShow}%</b><span>no-show</span></div>
                  <div className="kpi"><b>{rows.length ? Math.round((canceladas / rows.length) * 100) : 0}%</b><span>cancelación</span></div>
                  <div className="kpi"><b>{vivas.length ? Math.round((online / vivas.length) * 100) : 0}%</b><span>reservas online</span></div>
                </div>
                <div className="grafica">
                  <h4>Pax por día de la semana</h4>
                  {dias.map((d, i) => barra(NOMBRES_DIA[i], [{ v: d.c, c: "var(--mar)" }, { v: d.n, c: "var(--vi)" }], d.c + d.n, maxDia))}
                  <div className="mini-leyenda">
                    <span><i style={{ background: "var(--mar)" }} />Comida</span>
                    <span><i style={{ background: "var(--vi)" }} />Cena</span>
                  </div>
                </div>
                <div className="grafica">
                  <h4>Pax por canal</h4>
                  {topCanales.map(([c, v]) => barra(c, [{ v, c: "var(--mar)" }], v, maxCanal))}
                </div>
                {topIds.length ? (
                  <div className="grafica">
                    <h4>Clientes más fieles del periodo</h4>
                    <div className="lista-simple">
                      {topIds.map(([id, n]) => {
                        const c = datos.nombres[id];
                        return (
                          <div key={id} className="item">
                            <div className="tit">{c?.nombre || "—"} {c?.vip ? "⭐" : ""}</div>
                            <div className="det">{n} visita{n > 1 ? "s" : ""}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </>
            );
          })()
        )}
      </div>
    </>
  );
}
