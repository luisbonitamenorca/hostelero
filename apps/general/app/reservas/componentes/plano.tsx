"use client";

import { useRef } from "react";
import { h5, type Mesa, type Reserva } from "../tipos";
import "./plano.css";

export type Posiciones = Record<string, { pos_x: number; pos_y: number }>;

/* Plano de sala (SVG 100×70). Compartido por Día, Cronograma y Mes. */
export function Plano(props: {
  mesas: Mesa[];
  resMesaTurno: (mesaId: string) => Reserva[];
  edicion: boolean;
  posCambiadas: Posiciones;
  setPosCambiadas: (p: Posiciones) => void;
  onMesa: (id: string) => void;
}) {
  const { mesas, resMesaTurno, edicion, posCambiadas, setPosCambiadas, onMesa } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; movido: boolean } | null>(null);

  function coords(ev: React.PointerEvent) {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = ev.clientX;
    p.y = ev.clientY;
    return p.matrixTransform(svg.getScreenCTM()!.inverse());
  }

  return (
    <svg
      ref={svgRef}
      className="plano"
      viewBox="0 0 100 70"
      xmlns="http://www.w3.org/2000/svg"
      onPointerMove={(ev) => {
        if (!edicion || !drag.current) return;
        drag.current.movido = true;
        const c = coords(ev);
        const x = Math.min(95, Math.max(5, c.x));
        const y = Math.min(65, Math.max(5, c.y));
        setPosCambiadas({ ...posCambiadas, [drag.current.id]: { pos_x: Math.round(x * 10) / 10, pos_y: Math.round(y * 10) / 10 } });
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        const { id, movido } = drag.current;
        drag.current = null;
        if (edicion && !movido) onMesa(id);
      }}
    >
      {mesas.map((m) => {
        const rs = resMesaTurno(m.id);
        const sentada = rs.find((r) => r.estado === "sentada");
        let fill = "#FFFFFF", stroke = "#B9C6CA", texto = "#1A2226";
        if (sentada) { fill = "#2F7D46"; stroke = "#256A3A"; texto = "#fff"; }
        else if (rs.length >= 2) { fill = "#7C2D3E"; stroke = "#5E2230"; texto = "#fff"; }
        else if (rs.length === 1) { fill = "#0F4C5C"; stroke = "#0C3E4B"; texto = "#fff"; }
        else if (!m.reservable_online) { fill = "#EFEFEF"; }
        const pos = posCambiadas[m.id];
        const x = Math.min(95, Math.max(5, Number(pos?.pos_x ?? m.pos_x)));
        const y = Math.min(66, Math.max(4, Number(pos?.pos_y ?? m.pos_y)));
        let forma: React.ReactNode;
        let br: number;
        if (m.forma === "redonda") {
          const rr = m.cap_max >= 7 ? 4.1 : m.cap_max >= 5 ? 3.6 : 3.1;
          forma = <circle cx={0} cy={0} r={rr} fill={fill} stroke={stroke} strokeWidth={0.55} />;
          br = rr;
        } else if (m.forma === "rectangular") {
          const w = m.cap_max >= 10 ? 12 : m.cap_max >= 6 ? 10 : 8.5;
          const h = m.cap_max >= 10 ? 7 : 6;
          forma = <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={1.1} fill={fill} stroke={stroke} strokeWidth={0.55} />;
          br = w / 2;
        } else {
          const l = m.cap_max >= 5 ? 8 : 7;
          forma = <rect x={-l / 2} y={-l / 2} width={l} height={l} rx={1} fill={fill} stroke={stroke} strokeWidth={0.55} />;
          br = l / 2;
        }
        const sub = rs.length ? rs.map((r) => h5(r.hora)).join("·") : `${m.cap_min}-${m.cap_max}`;
        return (
          <g
            key={m.id}
            className="mesa-g"
            transform={`translate(${x},${y})`}
            onPointerDown={(ev) => {
              if (edicion) {
                drag.current = { id: m.id, movido: false };
                (ev.target as Element).setPointerCapture?.(ev.pointerId);
              }
            }}
            onClick={() => { if (!edicion) onMesa(m.id); }}
          >
            {forma}
            <text y={-0.3} textAnchor="middle" fontSize={1.8} fill={texto}>{m.nombre}</text>
            <text y={2} textAnchor="middle" fontSize={1.3} fill={rs.length ? "#ffffffcc" : "#6B7280"}>{sub}</text>
            {rs.length >= 2 ? (
              <>
                <circle cx={br} cy={-br} r={1.7} fill="#fff" stroke="#7C2D3E" strokeWidth={0.4} />
                <text x={br} y={-br + 0.8} textAnchor="middle" fontSize={2} fill="#7C2D3E" fontWeight={700}>{rs.length}</text>
              </>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
