"use client";

/* Gráficas en SVG puro para Informes (sin librerías): barras verticales, barras horizontales y
   líneas. Los colores salen de las variables del tema (--mar, --vi, --gris, --borde, --panel-2),
   así se ven bien en oscuro y en claro. El ancho se mide con ResizeObserver para dibujar a
   píxel real (texto nítido, nada de escalar el SVG). Los estilos están en secciones/informes.css. */

import { useEffect, useRef, useState, type MouseEvent, type RefObject, type TouchEvent } from "react";

export type PuntoBarra = {
  etiqueta: string;
  valor: number;
  /** Segunda serie apilada encima (opcional). */
  valor2?: number | null;
  /** Color propio de la barra (p. ej. el del estado). */
  color?: string;
  /** Texto extra en el tooltip / al lado del valor. */
  detalle?: string;
};

export type SerieLinea = { nombre: string; valores: (number | null)[]; color?: string };

const FUENTE = { fontFamily: "inherit", fontSize: 10.5 } as const;
const COLOR_1 = "var(--mar)";
const COLOR_2 = "var(--vi)";

export const fmtNumero = (v: number) => v.toLocaleString("es-ES", { maximumFractionDigits: 1 });

/** Ancho real del contenedor (0 hasta el primer layout). */
function useAncho(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setAncho(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entradas) => {
      const w = Math.floor(entradas[0]?.contentRect.width ?? el.clientWidth);
      setAncho((a) => (Math.abs(a - w) > 1 ? w : a));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, ancho];
}

/** Escala «bonita» del eje: tope redondo y marcas cada 1/2/2,5/5 × 10ⁿ. */
export function escalaBonita(max: number, pasos = 4): { tope: number; marcas: number[] } {
  if (!(max > 0)) return { tope: 1, marcas: [0, 1] };
  const bruto = max / pasos;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const n = bruto / pot;
  const paso = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pot;
  const tope = Math.ceil(max / paso - 1e-9) * paso;
  const marcas: number[] = [];
  for (let v = 0; v <= tope + 1e-9; v += paso) marcas.push(+v.toFixed(6));
  return { tope, marcas };
}

const truncar = (s: string, max: number) => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + "…" : s);

/* ---------- piezas comunes ---------- */

function Tooltip({ x, y, lineas, ancho }: { x: number; y: number; lineas: string[]; ancho: number }) {
  const w = Math.max(...lineas.map((l) => l.length)) * 6.3 + 18;
  const h = lineas.length * 14 + 10;
  let px = x + 12;
  if (px + w > ancho) px = x - w - 12;
  if (px < 0) px = 2;
  let py = y - h - 8;
  if (py < 0) py = y + 12;
  return (
    <g style={{ pointerEvents: "none" }}>
      <rect x={px} y={py} width={w} height={h} rx={6} style={{ fill: "var(--panel-2, #fff)", stroke: "var(--borde)", filter: "drop-shadow(0 2px 4px rgba(0,0,0,.25))" }} />
      {lineas.map((l, i) => (
        <text key={i} x={px + 9} y={py + 15 + i * 14} style={{ ...FUENTE, fill: i === 0 ? "var(--tinta)" : "var(--gris)", fontWeight: i === 0 ? 700 : 600 }}>
          {l}
        </text>
      ))}
    </g>
  );
}

function Leyenda({ items }: { items: { nombre: string; color: string }[] }) {
  return (
    <div className="gf-leyenda">
      {items.map((it) => (
        <span key={it.nombre}><i style={{ background: it.color }} />{it.nombre}</span>
      ))}
    </div>
  );
}

/* ---------- barras ---------- */

export type GraficaBarrasProps = {
  datos: PuntoBarra[];
  /** Alto del dibujo en px (vertical). En horizontal se calcula por filas. */
  alto?: number;
  formato?: (v: number) => string;
  color?: string;
  color2?: string;
  /** Nombres de las series para tooltip y leyenda. */
  nombre?: string;
  nombre2?: string;
  horizontal?: boolean;
  vacio?: string;
};

export function GraficaBarras(props: GraficaBarrasProps) {
  const { datos, alto = 190, formato = fmtNumero, color = COLOR_1, color2 = COLOR_2, nombre = "Valor", nombre2, horizontal, vacio = "Sin datos en el periodo." } = props;
  const [ref, ancho] = useAncho();
  const [hov, setHov] = useState<number | null>(null);

  if (!datos.length) return <div ref={ref} className="gf gf-vacio">{vacio}</div>;
  const W = ancho || 320;

  /* --- horizontal: una fila por categoría, etiqueta a la izquierda, valor a la derecha --- */
  if (horizontal) {
    const filaH = 24;
    const H = datos.length * filaH + 4;
    const etiW = Math.min(150, Math.max(72, Math.round(W * 0.3)));
    const valW = Math.max(...datos.map((d) => formato(d.valor + (d.valor2 ?? 0)).length + (d.detalle ? d.detalle.length + 3 : 0))) * 6.3 + 10;
    const iw = Math.max(20, W - etiW - valW - 8);
    const max = Math.max(...datos.map((d) => d.valor + (d.valor2 ?? 0)), 0) || 1;
    return (
      <div ref={ref} className="gf">
        <svg width={W} height={H} role="img">
          {datos.map((d, i) => {
            const cy = 2 + filaH * i + filaH / 2;
            const w1 = (iw * d.valor) / max;
            const w2 = (iw * (d.valor2 ?? 0)) / max;
            const total = d.valor + (d.valor2 ?? 0);
            return (
              <g key={i}>
                <title>{`${d.etiqueta}: ${formato(total)}${d.detalle ? ` · ${d.detalle}` : ""}`}</title>
                <text x={etiW - 8} y={cy + 3.5} textAnchor="end" style={{ ...FUENTE, fill: "var(--tinta)", fontWeight: 600 }}>
                  {truncar(d.etiqueta, Math.floor(etiW / 6.4))}
                </text>
                <rect x={etiW} y={cy - 8} width={iw} height={16} rx={3} style={{ fill: "var(--panel-2, #F1EDE2)" }} />
                <rect x={etiW} y={cy - 8} width={Math.max(w1, total > 0 ? 2 : 0)} height={16} rx={3} style={{ fill: d.color ?? color }} />
                {w2 > 0 ? <rect x={etiW + w1} y={cy - 8} width={w2} height={16} style={{ fill: color2 }} /> : null}
                <text x={etiW + iw + 6} y={cy + 3.5} style={{ ...FUENTE, fill: "var(--gris)", fontWeight: 600 }}>
                  {formato(total)}{d.detalle ? <tspan style={{ fontWeight: 500 }}> · {d.detalle}</tspan> : null}
                </text>
              </g>
            );
          })}
        </svg>
        {nombre2 ? <Leyenda items={[{ nombre, color }, { nombre: nombre2, color: color2 }]} /> : null}
      </div>
    );
  }

  /* --- vertical --- */
  const H = alto;
  const mL = 40, mR = 8, mT = 12, mB = 24;
  const iw = Math.max(10, W - mL - mR);
  const ih = H - mT - mB;
  const max = Math.max(...datos.map((d) => d.valor + (d.valor2 ?? 0)), 0);
  const { tope, marcas } = escalaBonita(max);
  const slot = iw / datos.length;
  const bw = Math.max(2, Math.min(slot * 0.68, 44));
  const y = (v: number) => mT + ih - (v / tope) * ih;
  const cada = Math.max(1, Math.ceil(datos.length / Math.max(1, Math.floor(iw / 46))));
  const h = hov != null ? datos[hov] : null;

  return (
    <div ref={ref} className="gf">
      <svg width={W} height={H} role="img" onMouseLeave={() => setHov(null)}>
        {marcas.map((m) => (
          <g key={m}>
            <line x1={mL} x2={W - mR} y1={y(m)} y2={y(m)} style={{ stroke: "var(--borde)", strokeDasharray: m === 0 ? undefined : "2 3" }} />
            <text x={mL - 6} y={y(m) + 3.5} textAnchor="end" style={{ ...FUENTE, fill: "var(--gris)" }}>{formato(m)}</text>
          </g>
        ))}
        {datos.map((d, i) => {
          const cx = mL + slot * i + slot / 2;
          const x0 = cx - bw / 2;
          const v2 = d.valor2 ?? 0;
          const h1 = Math.max(0, (ih * d.valor) / tope);
          const h2 = Math.max(0, (ih * v2) / tope);
          const apagada = hov != null && hov !== i;
          return (
            <g key={i} onMouseEnter={() => setHov(i)} onTouchStart={() => setHov(i)}>
              <rect x={mL + slot * i} y={mT} width={slot} height={ih} fill="transparent" />
              {h2 > 0 ? <rect x={x0} y={y(d.valor + v2)} width={bw} height={h2} rx={2} style={{ fill: color2, opacity: apagada ? 0.5 : 1 }} /> : null}
              <rect x={x0} y={y(d.valor)} width={bw} height={h1} rx={2} style={{ fill: d.color ?? color, opacity: apagada ? 0.5 : 1 }} />
              {i % cada === 0 ? (
                <text x={cx} y={H - 7} textAnchor="middle" style={{ ...FUENTE, fill: "var(--gris)" }}>{d.etiqueta}</text>
              ) : null}
            </g>
          );
        })}
        {h && hov != null ? (
          <Tooltip
            x={mL + slot * hov + slot / 2}
            y={y(h.valor + (h.valor2 ?? 0))}
            ancho={W}
            lineas={[
              h.etiqueta,
              `${nombre}: ${formato(h.valor)}`,
              ...(nombre2 ? [`${nombre2}: ${formato(h.valor2 ?? 0)}`] : []),
              ...(h.detalle ? [h.detalle] : []),
            ]}
          />
        ) : null}
      </svg>
      {nombre2 ? <Leyenda items={[{ nombre, color }, { nombre: nombre2, color: color2 }]} /> : null}
    </div>
  );
}

/* ---------- líneas ---------- */

export type GraficaLineasProps = {
  etiquetas: string[];
  series: SerieLinea[];
  alto?: number;
  formato?: (v: number) => string;
  vacio?: string;
  /** Tope fijo del eje (p. ej. 100 para porcentajes). */
  tope?: number;
};

export function GraficaLineas(props: GraficaLineasProps) {
  const { etiquetas, series, alto = 200, formato = fmtNumero, vacio = "Sin datos en el periodo.", tope: topeFijo } = props;
  const [ref, ancho] = useAncho();
  const [hov, setHov] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const n = etiquetas.length;
  if (!n || !series.length) return <div ref={ref} className="gf gf-vacio">{vacio}</div>;

  const W = ancho || 320;
  const H = alto;
  const mL = 40, mR = 10, mT = 12, mB = 24;
  const iw = Math.max(10, W - mL - mR);
  const ih = H - mT - mB;
  const colores = series.map((s, i) => s.color ?? (i === 0 ? COLOR_1 : i === 1 ? COLOR_2 : "var(--e-pendiente)"));
  const max = Math.max(0, ...series.flatMap((s) => s.valores.map((v) => v ?? 0)));
  const { tope, marcas } = topeFijo ? { tope: topeFijo, marcas: escalaBonita(topeFijo).marcas } : escalaBonita(max);
  const x = (i: number) => (n <= 1 ? mL + iw / 2 : mL + (iw * i) / (n - 1));
  const y = (v: number) => mT + ih - (Math.min(v, tope) / tope) * ih;
  const cada = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 52))));

  const trazo = (vals: (number | null)[]) => {
    let d = "";
    let abierto = false;
    vals.forEach((v, i) => {
      if (v == null) { abierto = false; return; }
      d += `${abierto ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      abierto = true;
    });
    return d;
  };

  const mover = (ev: MouseEvent<SVGSVGElement> | TouchEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = "touches" in ev ? ev.touches[0]?.clientX ?? 0 : ev.clientX;
    const px = cx - rect.left - mL;
    const i = n <= 1 ? 0 : Math.round((px / iw) * (n - 1));
    setHov(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div ref={ref} className="gf">
      <svg ref={svgRef} width={W} height={H} role="img" onMouseMove={mover} onTouchStart={mover} onTouchMove={mover} onMouseLeave={() => setHov(null)}>
        {marcas.map((m) => (
          <g key={m}>
            <line x1={mL} x2={W - mR} y1={y(m)} y2={y(m)} style={{ stroke: "var(--borde)", strokeDasharray: m === 0 ? undefined : "2 3" }} />
            <text x={mL - 6} y={y(m) + 3.5} textAnchor="end" style={{ ...FUENTE, fill: "var(--gris)" }}>{formato(m)}</text>
          </g>
        ))}
        {etiquetas.map((e, i) =>
          i % cada === 0 ? (
            <text key={i} x={x(i)} y={H - 7} textAnchor={n <= 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"} style={{ ...FUENTE, fill: "var(--gris)" }}>{e}</text>
          ) : null,
        )}
        {series.map((s, si) => (
          <g key={s.nombre}>
            <path d={trazo(s.valores)} style={{ fill: "none", stroke: colores[si], strokeWidth: 2, strokeLinejoin: "round", strokeLinecap: "round" }} />
            {n <= 60
              ? s.valores.map((v, i) => (v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={hov === i ? 4 : 2.5} style={{ fill: colores[si] }} />))
              : null}
          </g>
        ))}
        {hov != null && hov < n ? (
          <>
            <line x1={x(hov)} x2={x(hov)} y1={mT} y2={mT + ih} style={{ stroke: "var(--gris)", strokeDasharray: "3 3" }} />
            <Tooltip
              x={x(hov)}
              y={Math.min(...series.map((s) => y(s.valores[hov] ?? 0)))}
              ancho={W}
              lineas={[etiquetas[hov], ...series.map((s) => `${s.nombre}: ${s.valores[hov] == null ? "—" : formato(s.valores[hov] as number)}`)]}
            />
          </>
        ) : null}
      </svg>
      {series.length > 1 ? <Leyenda items={series.map((s, i) => ({ nombre: s.nombre, color: colores[i] }))} /> : null}
    </div>
  );
}
