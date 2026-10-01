"use client";

import { useEffect, useState } from "react";
import * as api from "../acciones";
import { DIAS, dowDe, enTurno, hoyISO, type Mesa, type Restaurante, type Sala, type Turno } from "../tipos";
import { irATab, type SecProps } from "../lib-reservas";
import "./mes.css";

/* Vista Mes: ocupación por día y turno. Clic en un día abre la vista Día. */
export default function SecMes({ rest, fecha, setFecha }: SecProps) {
  const [mesAncla, setMesAncla] = useState(fecha.slice(0, 7));
  const [turnos, setTurnos] = useState<Turno[] | null>(null);
  const [mesas, setMesas] = useState<Mesa[]>([]);

  useEffect(() => {
    setTurnos(null);
    api.cargarLocal(rest.id).then(({ salas, turnos: t }) => {
      const s = salas as unknown as Sala[];
      setMesas(s.flatMap((x) => (x.mesas || []).map((m) => ({ ...m, sala_nombre: x.nombre }))));
      setTurnos(t as Turno[]);
    });
  }, [rest.id]);

  if (!turnos) return <div className="spinner" />;

  return (
    <VistaMes
      rest={rest}
      mesAncla={mesAncla}
      setMesAncla={setMesAncla}
      turnos={turnos}
      mesas={mesas}
      irADia={(f) => { setFecha(f); irATab("dia"); }}
    />
  );
}

export function VistaMes(props: {
  rest: Restaurante;
  mesAncla: string;
  setMesAncla: (m: string) => void;
  turnos: Turno[];
  mesas: Mesa[];
  irADia: (f: string) => void;
}) {
  const { rest, mesAncla, setMesAncla, turnos, mesas, irADia } = props;
  const [datos, setDatos] = useState<{ reservas: { fecha: string; hora: string; pax: number; mesa_id: string | null }[]; cierres: { fecha: string; turno_id: string | null }[] } | null>(null);

  const [a, m] = mesAncla.split("-").map(Number);
  const finD = new Date(a, m, 0).getDate();

  useEffect(() => {
    setDatos(null);
    api.mesDatos(rest.id, `${mesAncla}-01`, `${mesAncla}-${String(finD).padStart(2, "0")}`).then((d) => setDatos(d));
  }, [rest.id, mesAncla, finD]);

  function nav(d: number) {
    let [ya, ym] = mesAncla.split("-").map(Number);
    ym += d;
    if (ym < 1) { ym = 12; ya--; }
    if (ym > 12) { ym = 1; ya++; }
    setMesAncla(`${ya}-${String(ym).padStart(2, "0")}`);
  }

  if (!datos) return <div className="spinner" />;

  const mesasAct = mesas.filter((x) => x.activa);
  const plazas = mesasAct.reduce((s, x) => s + x.cap_max, 0) || 1;
  const nMesas = mesasAct.length;

  const agg: Record<string, { pax: number; n: number; mesas: Set<string> }> = {};
  let totPax = 0, totRes = 0;
  datos.reservas.forEach((r) => {
    totPax += r.pax;
    totRes++;
    const rDow = dowDe(r.fecha);
    const t = turnos.find((tt) => tt.activo && (tt.dias_semana || []).includes(rDow) && enTurno(r as { hora: string }, tt));
    const clave = r.fecha + "|" + (t ? t.id : "x");
    const d = (agg[clave] = agg[clave] || { pax: 0, n: 0, mesas: new Set() });
    d.pax += r.pax;
    d.n++;
    if (r.mesa_id) d.mesas.add(r.mesa_id);
  });
  const cierresMap: Record<string, (string | null)[]> = {};
  datos.cierres.forEach((c) => { (cierresMap[c.fecha] = cierresMap[c.fecha] || []).push(c.turno_id); });

  const celdas: React.ReactNode[] = DIAS.map((d) => <div key={"h" + d} className="dsem">{d}</div>);
  const blancos = dowDe(`${mesAncla}-01`) - 1;
  for (let i = 0; i < blancos; i++) celdas.push(<div key={"b" + i} className="mes-celda vacia" />);
  const hoy = hoyISO();
  for (let dia = 1; dia <= finD; dia++) {
    const f = `${mesAncla}-${String(dia).padStart(2, "0")}`;
    const fDow = dowDe(f);
    const ts = turnos
      .filter((t) => t.activo && (t.dias_semana || []).includes(fDow))
      .sort((x, y) => (x.hora_inicio < y.hora_inicio ? -1 : 1));
    const cerradoDia = (cierresMap[f] || []).includes(null);
    celdas.push(
      <div key={f} className={`mes-celda ${f === hoy ? "eshoy" : ""}`} onClick={() => irADia(f)}>
        <div className="num">{dia}</div>
        {cerradoDia ? (
          <div className="mes-turno cerrado">Cerrado</div>
        ) : (
          ts.map((t, i) => {
            const icono = i === 0 ? "☀" : "☾";
            if ((cierresMap[f] || []).includes(t.id)) {
              return <div key={t.id} className="mes-turno cerrado"><span className="icono">{icono}</span>Cerrado</div>;
            }
            const d = agg[f + "|" + t.id] || { pax: 0, n: 0, mesas: new Set() };
            const pct = Math.round((d.pax / plazas) * 100);
            return (
              <div key={t.id} className={`mes-turno ${pct >= 100 ? "lleno" : ""}`}>
                <span className="icono">{icono}</span>
                <span className="pct">{pct}%</span>
                <span className="detalle">{d.pax}/{plazas} · {d.mesas.size}/{nMesas}</span>
              </div>
            );
          })
        )}
      </div>,
    );
  }

  return (
    <>
      <div className="mes-cab">
        <button className="nav mes-nav" onClick={() => nav(-1)}>‹</button>
        <div className="titulo">{new Date(a, m - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" })}</div>
        <button className="nav mes-nav" onClick={() => nav(1)}>›</button>
        <div className="tot"><b>{totPax}</b> pax · <b>{totRes}</b> reservas</div>
      </div>
      <div className="mes-grid">{celdas}</div>
      <div className="leyenda" style={{ marginTop: 10 }}>
        <span>☀ comida · ☾ cena</span>
        <span>% ocupación sobre plazas totales</span>
        <span>pax / plazas · mesas / mesas</span>
      </div>
    </>
  );
}
