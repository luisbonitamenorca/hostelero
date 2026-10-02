"use client";

/* Plano de sala tipo Cover. Lienzo SVG con viewBox = sala.ancho × sala.alto (unidades del plano;
   pos_x/pos_y/ancho/alto de mesas y objetos van en esas unidades).
   - Modo «sala»: clic → popover (onMesaClick), doble clic → modal (onMesaDoble), arrastrar una reserva
     (de la lista, dataTransfer "rsv/reserva", o la propia mesa ocupada) a otra mesa → onReservaDrop.
   - Modo «edición»: mover/redimensionar mesas y objetos con el puntero; cada interacción emite su delta
     por onCambios (el editor acumula, deshace y guarda).
   Zoom con rueda/pinch, arrastre del lienzo, botón «ajustar». Todo con pointer events (iPad). */

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent as KEvent } from "react";
import type { Tables } from "@hostelero/db";
import type { Mesa, Reserva, Sala } from "../tipos";
import { ESTADOS_EN_SALA, fmtHora, type Tema } from "../lib-reservas";
import "./plano.css";

/* ==================== Tipos del contrato ==================== */

export type PlanoReserva = Pick<Reserva, "id" | "hora" | "pax" | "estado" | "duracion_min" | "mesa_id"> & {
  nombre: string;
  apellidos?: string | null;
  etiquetas?: string[];
  origen?: string | null;
  canal?: string | null;
  notas?: string | null;
  telefono?: string | null;
};

export type PlanoMesaEstado = "libre" | "web" | "reservada" | "sentada" | "en_sala" | "bloqueada" | "inactiva" | "seleccionada";

export type PlanoObjeto = Tables<"reservas_plano_objetos">;
export type CambioMesa = Partial<Mesa> & { id: string; _nuevo?: boolean; _borrar?: boolean };
export type CambioObjeto = Partial<PlanoObjeto> & { id?: string; _borrar?: boolean; _nuevo?: boolean };
export type PlanoCambios = { mesas: CambioMesa[]; objetos: CambioObjeto[] };

export type PlanoProps = {
  sala: Sala;
  objetos: PlanoObjeto[];
  reservasPorMesa: Record<string, PlanoReserva[]>;
  bloqueos?: Tables<"reservas_bloqueos">[];
  seleccionada?: string | null;
  resaltadas?: string[];
  modo: "sala" | "edicion";
  onMesaClick?: (mesaId: string, ev: { x: number; y: number }) => void;
  onMesaDoble?: (mesaId: string) => void;
  onReservaDrop?: (reservaId: string, mesaId: string) => void;
  onCambios?: (c: PlanoCambios) => void;
  tema: Tema;
  ahora?: string;
  /* --- extras opcionales (los usa el editor) --- */
  objetoSeleccionado?: string | null;
  onObjetoClick?: (objetoId: string) => void;
  onFondoClick?: () => void;
  /** Paso de la rejilla en edición (unidades). 0 = sin ajustar. */
  rejilla?: number;
  /** Mostrar la rejilla aunque no sea edición (no se usa en sala). */
  mostrarRejilla?: boolean;
};

/** Compatibilidad con el import antiguo de secciones/dia.tsx (se retira con el nuevo Día). */
export type Posiciones = Record<string, { pos_x: number; pos_y: number }>;

/* ==================== Colores ==================== */

type Colores = { fondo: string; borde: string; texto: string };

const COLORES: Record<Tema, Record<PlanoMesaEstado, Colores>> = {
  oscuro: {
    libre: { fondo: "#6b3d2e", borde: "#4e2b20", texto: "#ffffff" },
    web: { fondo: "#8a8f94", borde: "#6c7176", texto: "#ffffff" },
    reservada: { fondo: "#8bc34a", borde: "#6f9f33", texto: "#1a2a10" },
    sentada: { fondo: "#2e7d32", borde: "#1f5a22", texto: "#ffffff" },
    en_sala: { fondo: "#1f4e9e", borde: "#163a78", texto: "#ffffff" },
    bloqueada: { fondo: "#4b5057", borde: "#6b7178", texto: "#d7dbe0" },
    inactiva: { fondo: "#3a3f45", borde: "#4b5057", texto: "#8a9199" },
    seleccionada: { fondo: "#6b3d2e", borde: "#e53935", texto: "#ffffff" },
  },
  claro: {
    libre: { fondo: "#7a4a35", borde: "#5a3426", texto: "#ffffff" },
    web: { fondo: "#9aa0a6", borde: "#7c8288", texto: "#ffffff" },
    reservada: { fondo: "#8bc34a", borde: "#6f9f33", texto: "#1a2a10" },
    sentada: { fondo: "#2e7d32", borde: "#1f5a22", texto: "#ffffff" },
    en_sala: { fondo: "#1f4e9e", borde: "#163a78", texto: "#ffffff" },
    bloqueada: { fondo: "#d9d4c9", borde: "#9aa0a6", texto: "#4b5057" },
    inactiva: { fondo: "#e6e1d6", borde: "#cfc8ba", texto: "#9aa0a6" },
    seleccionada: { fondo: "#7a4a35", borde: "#e53935", texto: "#ffffff" },
  },
};

/** Colores de una mesa según estado y tema (contrato). */
export function colorMesa(estado: PlanoMesaEstado, tema: Tema): Colores {
  return COLORES[tema][estado];
}

const OBJ: Record<Tema, Record<string, string>> = {
  oscuro: { planta: "#4db6ac", pared: "#3a3f45", barra: "#3a3f45", barraLinea: "#4b5057", cocina: "#2f3338", textoFondo: "rgba(230,180,60,.22)", texto: "#e6b43c", linea: "#a3aab3", columna: "#555b63", columnaBorde: "#6b7178", ventana: "rgba(142,197,255,.25)", ventanaBorde: "#8ec5ff", etiqueta: "#c9ced4" },
  claro: { planta: "#3aa394", pared: "#c9c3b6", barra: "#cfc8ba", barraLinea: "#b8b0a0", cocina: "#d8d3c8", textoFondo: "rgba(230,180,60,.32)", texto: "#7a5410", linea: "#6b7280", columna: "#9aa0a6", columnaBorde: "#7c8288", ventana: "rgba(31,78,158,.15)", ventanaBorde: "#1f4e9e", etiqueta: "#4b5057" },
};

/* ==================== Geometría ==================== */

export type Vista = { x: number; y: number; w: number; h: number };

/** Tamaño de una mesa en unidades del plano (si no tiene ancho/alto, por capacidad y forma, guía §2). */
export function tamanoMesa(m: Pick<Mesa, "ancho" | "alto" | "forma" | "cap_max">): { w: number; h: number } {
  if (m.ancho != null && m.alto != null && m.ancho > 0 && m.alto > 0) return { w: Number(m.ancho), h: Number(m.alto) };
  const cap = m.cap_max ?? 2;
  if (m.forma === "rectangular") {
    if (cap <= 4) return { w: 8, h: 6 };
    if (cap <= 8) return { w: 8.4, h: 6.4 };
    return { w: 11, h: 6 };
  }
  const l = cap <= 2 ? 5.6 : cap <= 4 ? 6.8 : cap <= 8 ? 8 : 10;
  return { w: l, h: l };
}

/** Caja efectiva (ancho/alto en pantalla) según la rotación: a 90°/270° se intercambian. */
function cajaEfectiva(w: number, h: number, rot: number) {
  const r = ((rot % 360) + 360) % 360;
  return r === 90 || r === 270 ? { we: h, he: w } : { we: w, he: h };
}

const minutos = (hhmm: string) => {
  const [a, b] = hhmm.slice(0, 5).split(":").map(Number);
  return (a || 0) * 60 + (b || 0);
};

function recortarTexto(s: string, max: number) {
  const t = (s || "").trim();
  if (max < 2) return "";
  return t.length <= max ? t : t.slice(0, Math.max(1, max - 1)) + "…";
}

/** Reserva «principal» de la mesa: la que está en sala; si no, la primera por hora. */
export function reservaPrincipal(rs: PlanoReserva[]): PlanoReserva | null {
  if (!rs.length) return null;
  const enSala = rs.find((r) => ESTADOS_EN_SALA.includes(r.estado));
  if (enSala) return enSala;
  return [...rs].sort((a, b) => a.hora.localeCompare(b.hora))[0];
}

/** ¿Afecta algún bloqueo a esta mesa? (el de la mesa, el de su sala o el de todo el restaurante). */
export function mesaBloqueada(m: Pick<Mesa, "id">, bloqueos: Tables<"reservas_bloqueos">[] | undefined, salaId: string): boolean {
  return !!bloqueos?.some((b) => (!b.mesa_id && !b.sala_id) || b.sala_id === salaId || b.mesa_id === m.id);
}

/** Estado visual de una mesa (sin «seleccionada»: eso es un borde encima).
    Una reserva viva manda sobre el bloqueo: si la mesa tiene gente o una reserva, se pinta su estado
    y el bloqueo va como capa (rayado + candado). «Bloqueada» solo para mesas sin reservas. */
export function estadoMesa(
  m: Pick<Mesa, "id" | "activa" | "reservable_online">,
  rs: PlanoReserva[],
  bloqueos: Tables<"reservas_bloqueos">[] | undefined,
  salaId: string,
): PlanoMesaEstado {
  const p = reservaPrincipal(rs);
  if (p) {
    if (p.estado === "sentada") return "sentada";
    if (ESTADOS_EN_SALA.includes(p.estado)) return "en_sala";
    return "reservada";
  }
  if (!m.activa) return "inactiva";
  if (mesaBloqueada(m, bloqueos, salaId)) return "bloqueada";
  return m.reservable_online ? "libre" : "web";
}

/** Número visible de la mesa: la etiqueta si la hay; si no, el nombre (contrato §1). */
export const numeroMesa = (m: Pick<Mesa, "nombre" | "etiqueta">) => (m.etiqueta || "").trim() || m.nombre;

const SUFIJO_ESTADO: Record<string, string> = { llegada: "Llegada", postre: "Postre", cuenta: "Cuenta" };

/* ==================== Mesa ==================== */

type MesaGProps = {
  mesa: Mesa;
  estado: PlanoMesaEstado;
  reservas: PlanoReserva[];
  tema: Tema;
  seleccionada: boolean;
  resaltada: boolean;
  bloqueada: boolean; // hay un bloqueo que la afecta (capa encima del estado)
  destino: "si" | "no" | null; // una reserva se está arrastrando sobre ella (no = destino no válido)
  edicion: boolean;
  dx: number; // desplazamiento temporal mientras se arrastra (edición)
  dy: number;
  dw: number; // tamaño temporal mientras se redimensiona (edición)
  dh: number;
  ahora?: string;
  idRayas: string;
  onTecla: (id: string, el: SVGGElement, doble: boolean) => void;
};

const MesaG = memo(function MesaG(p: MesaGProps) {
  const { mesa: m, estado, reservas, tema, seleccionada, resaltada, bloqueada, destino, edicion, dx, dy, dw, dh, ahora, idRayas } = p;
  const base = tamanoMesa(m);
  const w = dw || base.w;
  const h = dh || base.h;
  const rot = Number(m.rotacion) || 0;
  const { we, he } = cajaEfectiva(w, h, rot);
  const cx = Number(m.pos_x) + dx;
  const cy = Number(m.pos_y) + dy;
  const col = colorMesa(estado, tema);
  const fondo = estado === "libre" && m.color ? m.color : col.fondo;
  const radio = m.forma === "redonda" ? 0 : Math.min(w, h) * (m.tipo === "barra" ? 0.06 : 0.12);
  const principal = reservaPrincipal(reservas);
  const numero = numeroMesa(m);
  const rayado = bloqueada || estado === "bloqueada";

  /* Líneas de texto: número (cap) · hora · nombre · apellidos, las que quepan. */
  const k = Math.max(0.68, Math.min(1.2, Math.min(we, he) / 7));
  const lineas: { t: string; f: number; peso: number; op?: number }[] = [];
  if (principal && (estado === "reservada" || estado === "sentada" || estado === "en_sala")) {
    lineas.push({ t: `${numero} (${principal.pax}p)`, f: 1.75 * k, peso: 700 });
    // Línea de la hora: «13:00 · 45' · Cuenta». El sufijo (llegada/postre/cuenta) va SIEMPRE en esta línea,
    // que nunca se descarta; si no cabe entera se sacrifica primero la hora de la reserva.
    const hora = fmtHora(principal.hora);
    let lleva: string | null = null;
    if (ahora && (estado === "sentada" || estado === "en_sala")) {
      const min = minutos(ahora) - minutos(principal.hora);
      if (min >= 0 && min < 600) lleva = `${min}'`;
    }
    const suf = SUFIJO_ESTADO[principal.estado];
    const fHora = 1.55 * k;
    const cabe = (t: string) => t.length <= Math.floor((we * 0.94) / (fHora * 0.55));
    const opciones = suf
      ? [[hora, lleva, suf], [lleva, suf], [suf]].map((xs) => xs.filter(Boolean).join(" · "))
      : [[hora, lleva].filter(Boolean).join(" · "), hora];
    lineas.push({ t: opciones.find(cabe) ?? opciones[opciones.length - 1], f: fHora, peso: suf ? 700 : 600 });
    const maxChars = Math.floor(we / (1.5 * k * 0.56));
    lineas.push({ t: recortarTexto(principal.nombre, maxChars), f: 1.5 * k, peso: 600 });
    if (principal.apellidos) lineas.push({ t: recortarTexto(principal.apellidos, maxChars), f: 1.5 * k, peso: 600 });
  } else {
    lineas.push({ t: `${numero} (${m.cap_max})`, f: 1.8 * k, peso: 700 });
    if (estado === "web") lineas.push({ t: "WEB", f: 1.45 * k, peso: 700 });
    else if (estado === "bloqueada") lineas.push({ t: "Bloqueada", f: 1.3 * k, peso: 600, op: 0.9 });
    else if (estado === "inactiva") lineas.push({ t: "Inactiva", f: 1.3 * k, peso: 600, op: 0.9 });
  }
  // Quitamos líneas por el final hasta que el bloque quepa en la mesa.
  const altoLinea = (f: number) => f * 1.18;
  const disponible = he - 1.1;
  while (lineas.length > 1 && lineas.reduce((s, l) => s + altoLinea(l.f), 0) > disponible) lineas.pop();
  const altoBloque = lineas.reduce((s, l) => s + altoLinea(l.f), 0);
  let y = -altoBloque / 2;

  const etiquetaA11y = (() => {
    const cap = m.cap_min === m.cap_max ? `${m.cap_max} personas` : `${m.cap_min} a ${m.cap_max} personas`;
    const bloq = bloqueada && estado !== "bloqueada" ? ", bloqueada" : "";
    if (principal && reservas.length) return `Mesa ${numero}, ${cap}${bloq}, ${reservas.length > 1 ? `${reservas.length} reservas, ` : ""}${fmtHora(principal.hora)} ${principal.nombre} ${principal.apellidos ?? ""}`.trim();
    return `Mesa ${numero}, ${cap}, ${estado === "web" ? "no se reserva online" : estado}`;
  })();

  const clase = ["pl-mesa", `est-${estado}`, seleccionada && "seleccionada", resaltada && "resaltada", destino === "si" && "destino", destino === "no" && "destino-no", edicion && "edicion", !m.activa && "inactiva"]
    .filter(Boolean)
    .join(" ");

  const forma =
    m.forma === "redonda" ? (
      <ellipse className="pl-forma" rx={w / 2} ry={h / 2} />
    ) : (
      <rect className="pl-forma" x={-w / 2} y={-h / 2} width={w} height={h} rx={radio} ry={radio} />
    );

  return (
    <g
      className={clase}
      data-mesa={m.id}
      data-ocupada={reservas.length ? "1" : undefined}
      transform={`translate(${cx},${cy})`}
      tabIndex={0}
      role="button"
      aria-label={etiquetaA11y}
      onKeyDown={(ev: KEvent<SVGGElement>) => {
        // Intro/espacio = clic; Mayús+Intro = doble clic (abrir el modal en esta mesa).
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); p.onTecla(m.id, ev.currentTarget, ev.shiftKey && ev.key === "Enter"); }
      }}
    >
      <g transform={rot ? `rotate(${rot})` : undefined} style={{ fill: fondo, stroke: col.borde }}>
        {/* sombra: copia desplazada del contorno (barata, sin filtro) */}
        {m.forma === "redonda" ? (
          <ellipse className="pl-sombra" rx={w / 2} ry={h / 2} />
        ) : (
          <rect className="pl-sombra" x={-w / 2} y={-h / 2} width={w} height={h} rx={radio} ry={radio} />
        )}
        {forma}
        {rayado ? (
          m.forma === "redonda" ? <ellipse rx={w / 2} ry={h / 2} fill={`url(#${idRayas})`} stroke="none" /> : <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={radio} ry={radio} fill={`url(#${idRayas})`} stroke="none" />
        ) : null}
        {m.tipo === "alta" ? (
          m.forma === "redonda" ? <ellipse className="pl-alta" rx={w / 2 - 0.7} ry={h / 2 - 0.7} /> : <rect className="pl-alta" x={-w / 2 + 0.7} y={-h / 2 + 0.7} width={w - 1.4} height={h - 1.4} rx={Math.max(0, radio - 0.5)} />
        ) : null}
        {m.tipo === "barra" ? <line className="pl-barra-linea" x1={-w / 2 + 1} y1={-h / 2 + 1} x2={w / 2 - 1} y2={-h / 2 + 1} /> : null}
      </g>
      {/* borde de selección / resaltado, siempre sobre la caja efectiva */}
      {seleccionada || resaltada || destino ? (
        m.forma === "redonda" ? (
          <ellipse className="pl-aro" rx={we / 2 + 0.35} ry={he / 2 + 0.35} />
        ) : (
          <rect className="pl-aro" x={-we / 2 - 0.35} y={-he / 2 - 0.35} width={we + 0.7} height={he + 0.7} rx={radio + 0.35} />
        )
      ) : null}
      <g className="pl-texto" style={{ fill: col.texto }}>
        {lineas.map((l, i) => {
          y += altoLinea(l.f);
          return (
            <text key={i} y={y - l.f * 0.3} fontSize={l.f} fontWeight={l.peso} textAnchor="middle" opacity={l.op ?? 1}>
              {l.t}
            </text>
          );
        })}
      </g>
      {rayado ? <Candado x={reservas.length >= 2 ? -we / 2 + 0.3 : we / 2 - 1.6} y={-he / 2 + 0.3} /> : null}
      {reservas.length >= 2 ? (
        <g className="pl-badge" transform={`translate(${we / 2 - 0.4},${-he / 2 + 0.4})`}>
          <circle r={1.5} />
          <text y={0.55} fontSize={1.8} fontWeight={700} textAnchor="middle">{reservas.length}</text>
        </g>
      ) : null}
    </g>
  );
});

function Candado({ x, y }: { x: number; y: number }) {
  return (
    <g className="pl-candado" transform={`translate(${x},${y})`}>
      <path d="M0.35 1 v-0.45 a0.45 0.45 0 0 1 0.9 0 v0.45" fill="none" strokeWidth={0.22} />
      <rect x={0.05} y={1} width={1.5} height={1.1} rx={0.2} stroke="none" />
    </g>
  );
}

/* ==================== Objetos decorativos ==================== */

type ObjetoGProps = { o: PlanoObjeto; tema: Tema; seleccionado: boolean; edicion: boolean; dx: number; dy: number; dw: number; dh: number };

const ObjetoG = memo(function ObjetoG({ o, tema, seleccionado, edicion, dx, dy, dw, dh }: ObjetoGProps) {
  const c = OBJ[tema];
  const w = dw || Number(o.ancho) || 6;
  const h = dh || Number(o.alto) || 6;
  const rot = Number(o.rotacion) || 0;
  const { we, he } = cajaEfectiva(w, h, rot);
  const cx = Number(o.pos_x) + dx;
  const cy = Number(o.pos_y) + dy;
  const color = o.color || undefined;
  let cuerpo: JSX.Element;

  switch (o.tipo) {
    case "planta": {
      const r = Math.min(w, h) / 2;
      if (o.texto === "redonda") {
        // arbusto: círculo con bultos
        const bultos = Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return <circle key={i} cx={Math.cos(a) * r * 0.62} cy={Math.sin(a) * r * 0.62} r={r * 0.42} />;
        });
        cuerpo = <g fill={color || c.planta} stroke="none">{bultos}<circle r={r * 0.7} /></g>;
      } else {
        // planta de hojas en estrella (como las de Cover)
        const hojas = Array.from({ length: 6 }, (_, i) => (
          <ellipse key={i} cx={0} cy={-r * 0.55} rx={r * 0.28} ry={r * 0.55} transform={`rotate(${i * 60 + 15})`} />
        ));
        cuerpo = <g fill={color || c.planta} stroke="none">{hojas}<circle r={r * 0.22} opacity={0.85} /></g>;
      }
      break;
    }
    case "pared":
      cuerpo = <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={color || c.pared} stroke="none" />;
      break;
    case "barra":
      cuerpo = (
        <g>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={0.8} fill={color || c.barra} stroke="none" />
          <line x1={-w / 2 + 0.8} y1={-h / 2 + 1} x2={w / 2 - 0.8} y2={-h / 2 + 1} stroke={c.barraLinea} strokeWidth={0.3} />
        </g>
      );
      break;
    case "cocina":
      cuerpo = <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={0.6} fill={color || c.cocina} stroke={c.barraLinea} strokeWidth={0.25} strokeDasharray="1 0.6" />;
      break;
    case "texto": {
      const f = Math.max(1.2, Math.min(h * 0.55, w / Math.max(3, (o.texto || "").length * 0.62)));
      cuerpo = (
        <g>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill={c.textoFondo} stroke="none" />
          <text y={f * 0.36} fontSize={f} fontWeight={700} textAnchor="middle" fill={color || c.texto}>{o.texto || "Texto"}</text>
        </g>
      );
      break;
    }
    case "puerta": {
      // hoja de puerta + arco de apertura (símbolo de plano)
      const r = Math.min(w, h);
      cuerpo = (
        <g fill="none" stroke={color || c.linea} strokeWidth={0.3}>
          <line x1={-w / 2} y1={h / 2} x2={-w / 2} y2={h / 2 - r} />
          <path d={`M${-w / 2} ${h / 2 - r} A${r} ${r} 0 0 1 ${-w / 2 + r} ${h / 2}`} strokeDasharray="0.6 0.5" />
          <line x1={-w / 2} y1={h / 2} x2={-w / 2 + r} y2={h / 2} strokeWidth={0.5} />
        </g>
      );
      break;
    }
    case "columna":
      cuerpo = <ellipse rx={w / 2} ry={h / 2} fill={color || c.columna} stroke={c.columnaBorde} strokeWidth={0.3} />;
      break;
    case "ventana":
      cuerpo = (
        <g>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={c.ventana} stroke={color || c.ventanaBorde} strokeWidth={0.3} />
          <line x1={-w / 2} y1={0} x2={w / 2} y2={0} stroke={color || c.ventanaBorde} strokeWidth={0.2} />
        </g>
      );
      break;
    case "escalera": {
      const paso = 1.2;
      const n = Math.max(1, Math.floor(h / paso));
      const lineas = Array.from({ length: n - 1 }, (_, i) => {
        const yy = -h / 2 + (i + 1) * (h / n);
        return <line key={i} x1={-w / 2} y1={yy} x2={w / 2} y2={yy} />;
      });
      cuerpo = (
        <g fill="none" stroke={color || c.linea} strokeWidth={0.25}>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={c.pared} fillOpacity={0.5} />
          {lineas}
        </g>
      );
      break;
    }
    default:
      cuerpo = <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={color || c.pared} />;
  }

  const etiqueta = o.texto && (o.tipo === "barra" || o.tipo === "cocina") ? (
    <text y={0.5} fontSize={Math.max(1.1, Math.min(1.8, w / Math.max(4, o.texto.length * 0.6)))} fontWeight={600} textAnchor="middle" fill={c.etiqueta}>{o.texto}</text>
  ) : null;

  return (
    <g className={`pl-objeto tipo-${o.tipo}${seleccionado ? " seleccionado" : ""}${edicion ? " edicion" : ""}`} data-objeto={o.id} transform={`translate(${cx},${cy})`}>
      <g transform={rot ? `rotate(${rot})` : undefined}>{cuerpo}</g>
      {etiqueta}
      {edicion ? <rect className="pl-objeto-hit" x={-we / 2} y={-he / 2} width={we} height={he} /> : null}
      {seleccionado ? <rect className="pl-aro" x={-we / 2 - 0.35} y={-he / 2 - 0.35} width={we + 0.7} height={he + 0.7} rx={0.6} /> : null}
    </g>
  );
});

/* ==================== Plano ==================== */

type Objetivo = { clase: "mesa" | "objeto" | "asa" | "fondo"; id: string | null };
type Gesto =
  | { tipo: "pan"; x0: number; y0: number; vista0: Vista; activo: boolean; objetivo: Objetivo }
  | { tipo: "reserva"; x0: number; y0: number; activo: boolean; mesaId: string; reservaId: string; w: number; h: number }
  | { tipo: "mover"; x0: number; y0: number; activo: boolean; objetivo: Objetivo; pos0: { x: number; y: number } }
  | { tipo: "redim"; x0: number; y0: number; activo: boolean; objetivo: Objetivo; dim0: { w: number; h: number }; rot: number }
  | { tipo: "pinch"; d0: number; vista0: Vista; c0: { x: number; y: number } };

const UMBRAL_PX = 6;
/** Pulsación larga (táctil/lápiz) para empezar a arrastrar una reserva; antes de eso, el dedo desplaza el plano. */
const PULSACION_LARGA_MS = 350;
/** Doble clic / doble toque: misma mesa, menos de 350 ms y menos de 10 px entre los dos. */
const DOBLE_MS = 350;
const DOBLE_PX = 10;

export function Plano(props: PlanoProps): JSX.Element {
  const { sala, objetos, reservasPorMesa, bloqueos, seleccionada, resaltadas, modo, tema, ahora, objetoSeleccionado, rejilla = 1 } = props;
  const edicion = modo === "edicion";
  const salaW = Number(sala.ancho) || 100;
  const salaH = Number(sala.alto) || 70;
  const uid = useId().replace(/:/g, "");
  const idRayas = `pl-rayas-${uid}`;
  const idRejilla = `pl-rejilla-${uid}`;

  const envRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [vista, setVista] = useState<Vista>({ x: 0, y: 0, w: salaW, h: salaH });
  const vistaRef = useRef(vista);
  vistaRef.current = vista;
  const ajusteRef = useRef<Vista>({ x: 0, y: 0, w: salaW, h: salaH });

  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const gesto = useRef<Gesto | null>(null);
  const [arrastre, setArrastre] = useState<{ clase: "mesa" | "objeto"; id: string; dx: number; dy: number; dw: number; dh: number } | null>(null);
  const [fantasma, setFantasma] = useState<{ x: number; y: number; w: number; h: number; texto: string } | null>(null);
  const [destino, setDestino] = useState<{ id: string; ok: boolean } | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const [moviendo, setMoviendo] = useState(false);
  const pulsacion = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimoClic = useRef<{ id: string; t: number; x: number; y: number } | null>(null);
  const cancelarPulsacion = () => { if (pulsacion.current) { clearTimeout(pulsacion.current); pulsacion.current = null; } };
  useEffect(() => () => { if (pulsacion.current) clearTimeout(pulsacion.current); }, []);

  // Callbacks en refs para que los handlers (y las mesas memorizadas) no cambien de identidad.
  const cbs = useRef(props);
  cbs.current = props;

  /* ---------- vista: ajustar al contenedor ---------- */
  const ajustar = useCallback(() => {
    const el = envRef.current;
    const rect = el?.getBoundingClientRect();
    const aspecto = rect && rect.width > 0 && rect.height > 0 ? rect.width / rect.height : salaW / salaH;
    const margen = 1.04;
    let w: number, h: number;
    if (salaW / salaH > aspecto) { w = salaW * margen; h = w / aspecto; } else { h = salaH * margen; w = h * aspecto; }
    const v = { x: (salaW - w) / 2, y: (salaH - h) / 2, w, h };
    ajusteRef.current = v;
    setVista(v);
  }, [salaW, salaH]);

  useEffect(() => {
    ajustar();
    const el = envRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Al cambiar el tamaño del contenedor se mantiene el aspecto (zoom relativo intacto).
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const v = vistaRef.current;
      const aspecto = rect.width / rect.height;
      const h = v.w / aspecto;
      if (Math.abs(h - v.h) < 0.01) return;
      setVista({ ...v, h, y: v.y + (v.h - h) / 2 });
      const a = ajusteRef.current;
      ajusteRef.current = { ...a, h: a.w / aspecto, y: (salaH - a.w / aspecto) / 2 };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ajustar, sala.id, salaH]);

  const limitar = useCallback((v: Vista): Vista => {
    const a = ajusteRef.current;
    const wMin = a.w / 5, wMax = a.w * 1.6;
    let w = Math.max(wMin, Math.min(wMax, v.w));
    const h = w * (a.h / a.w);
    w = h * (a.w / a.h);
    const x = Math.max(-w * 0.9, Math.min(salaW - w * 0.1, v.x));
    const y = Math.max(-h * 0.9, Math.min(salaH - h * 0.1, v.y));
    return { x, y, w, h };
  }, [salaW, salaH]);

  /** Coordenadas de pantalla → unidades del plano. */
  const aPlano = useCallback((cx: number, cy: number, v: Vista = vistaRef.current) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    return { x: v.x + ((cx - rect.left) / rect.width) * v.w, y: v.y + ((cy - rect.top) / rect.height) * v.h };
  }, []);
  /** Píxeles por unidad. */
  const escala = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? rect.width / vistaRef.current.w : 1;
  }, []);

  const zoom = useCallback((factor: number, centroCliente?: { x: number; y: number }) => {
    const v = vistaRef.current;
    const rect = svgRef.current?.getBoundingClientRect();
    const c = centroCliente && rect ? centroCliente : rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
    const p = aPlano(c.x, c.y, v);
    const nv = limitar({ ...v, w: v.w / factor, h: v.h / factor });
    const f = nv.w / v.w;
    setVista(limitar({ ...nv, x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f }));
  }, [aPlano, limitar]);

  // Rueda: zoom alrededor del cursor. Listener nativo para poder preventDefault (passive:false).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const h = (ev: WheelEvent) => {
      ev.preventDefault();
      const delta = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
      zoom(Math.exp(-delta * 0.0018), { x: ev.clientX, y: ev.clientY });
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [zoom]);

  /* ---------- índices ---------- */
  const mesas = useMemo(() => (sala.mesas ?? []).filter((m) => edicion || m.activa || reservasPorMesa[m.id]?.length), [sala.mesas, edicion, reservasPorMesa]);
  const mesasPorId = useMemo(() => new Map(mesas.map((m) => [m.id, m])), [mesas]);
  const objetosPorId = useMemo(() => new Map(objetos.map((o) => [o.id, o])), [objetos]);
  const setResaltadas = useMemo(() => new Set(resaltadas ?? []), [resaltadas]);
  const estados = useMemo(() => {
    const out: Record<string, PlanoMesaEstado> = {};
    for (const m of mesas) out[m.id] = estadoMesa(m, reservasPorMesa[m.id] ?? [], bloqueos, sala.id);
    return out;
  }, [mesas, reservasPorMesa, bloqueos, sala.id]);
  const bloqueadas = useMemo(() => new Set(mesas.filter((m) => mesaBloqueada(m, bloqueos, sala.id)).map((m) => m.id)), [mesas, bloqueos, sala.id]);
  /** ¿Se puede soltar una reserva en esta mesa? No en mesas inactivas ni bloqueadas. */
  const admiteReserva = (id: string) => !!mesasPorId.get(id)?.activa && !bloqueadas.has(id);
  const VACIO = useMemo<PlanoReserva[]>(() => [], []);

  const ajustarRejilla = useCallback((v: number) => (edicion && rejilla > 0 ? Math.round(v / rejilla) * rejilla : Math.round(v * 10) / 10), [edicion, rejilla]);

  /* ---------- objetivo bajo el puntero ---------- */
  const objetivoDe = (t: EventTarget | null): Objetivo => {
    const el = t as Element | null;
    if (!el || typeof el.closest !== "function") return { clase: "fondo", id: null };
    const asa = el.closest("[data-asa]");
    if (asa) return { clase: "asa", id: asa.getAttribute("data-asa") };
    const mesa = el.closest("[data-mesa]");
    if (mesa) return { clase: "mesa", id: mesa.getAttribute("data-mesa") };
    const obj = el.closest("[data-objeto]");
    if (obj) return { clase: "objeto", id: obj.getAttribute("data-objeto") };
    return { clase: "fondo", id: null };
  };

  const mesaEnPunto = (cx: number, cy: number): string | null => {
    const el = document.elementFromPoint(cx, cy);
    const g = el?.closest?.("[data-mesa]");
    return g ? g.getAttribute("data-mesa") : null;
  };

  /* ---------- pointer events ---------- */
  const onPointerDown = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (ev.button !== 0 && ev.pointerType === "mouse") return;
    const svg = svgRef.current!;
    punteros.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { svg.setPointerCapture(ev.pointerId); } catch { /* nada */ }
    setTip(null);

    if (punteros.current.size === 2) {
      cancelarPulsacion();
      setDestino(null);
      const [a, b] = [...punteros.current.values()];
      const d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesto.current = { tipo: "pinch", d0, vista0: vistaRef.current, c0: aPlano(mid.x, mid.y) };
      setArrastre(null);
      setFantasma(null);
      return;
    }
    if (punteros.current.size > 2) return;

    const objetivo = objetivoDe(ev.target);
    const base = { x0: ev.clientX, y0: ev.clientY, activo: false };
    if (edicion) {
      if (objetivo.clase === "asa" && objetivo.id) {
        const [clase, id] = objetivo.id.split(":") as ["mesa" | "objeto", string];
        const m = clase === "mesa" ? mesasPorId.get(id) : null;
        const o = clase === "objeto" ? objetosPorId.get(id) : null;
        if (m || o) {
          const dim0 = m ? tamanoMesa(m) : { w: Number(o!.ancho), h: Number(o!.alto) };
          gesto.current = { tipo: "redim", ...base, objetivo: { clase, id }, dim0, rot: Number((m ?? o)!.rotacion) || 0 };
          return;
        }
      }
      if ((objetivo.clase === "mesa" || objetivo.clase === "objeto") && objetivo.id) {
        const it = objetivo.clase === "mesa" ? mesasPorId.get(objetivo.id) : objetosPorId.get(objetivo.id);
        if (it) {
          gesto.current = { tipo: "mover", ...base, objetivo, pos0: { x: Number(it.pos_x), y: Number(it.pos_y) } };
          return;
        }
      }
      gesto.current = { tipo: "pan", ...base, vista0: vistaRef.current, objetivo };
      return;
    }
    // modo sala
    if (objetivo.clase === "mesa" && objetivo.id && cbs.current.onReservaDrop) {
      const rs = reservasPorMesa[objetivo.id] ?? [];
      const p = reservaPrincipal(rs);
      const m = mesasPorId.get(objetivo.id);
      if (p && m) {
        const { w, h } = tamanoMesa(m);
        const reserva: Gesto = { tipo: "reserva", ...base, mesaId: objetivo.id, reservaId: p.id, w, h };
        if (ev.pointerType === "mouse") {
          gesto.current = reserva;
          return;
        }
        // Táctil o lápiz: el dedo desplaza el plano; solo una pulsación larga sin moverse coge la reserva
        // (con la sala llena casi todo el lienzo son mesas ocupadas).
        const pan: Gesto = { tipo: "pan", ...base, vista0: vistaRef.current, objetivo };
        gesto.current = pan;
        const cx = ev.clientX, cy = ev.clientY;
        cancelarPulsacion();
        pulsacion.current = setTimeout(() => {
          pulsacion.current = null;
          if (gesto.current !== pan || pan.activo || punteros.current.size !== 1) return;
          reserva.activo = true;
          gesto.current = reserva;
          setMoviendo(true);
          const pt = aPlano(cx, cy);
          setFantasma({ x: pt.x, y: pt.y, w, h, texto: `${fmtHora(p.hora)} · ${p.nombre}` });
          setDestino({ id: objetivo.id!, ok: true });
          try { navigator.vibrate?.(15); } catch { /* nada */ }
        }, PULSACION_LARGA_MS);
        return;
      }
    }
    gesto.current = { tipo: "pan", ...base, vista0: vistaRef.current, objetivo };
  };

  const onPointerMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    const g = gesto.current;
    if (punteros.current.has(ev.pointerId)) punteros.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (!g) {
      // tooltip (solo ratón)
      if (ev.pointerType === "mouse" && tipRef.current) colocarTip(ev.clientX, ev.clientY);
      return;
    }
    if (g.tipo === "pinch") {
      if (punteros.current.size < 2) return;
      const [a, b] = [...punteros.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const rect = svgRef.current!.getBoundingClientRect();
      const f = d / g.d0;
      const w = g.vista0.w / f, h = g.vista0.h / f;
      const nv = limitar({ x: g.c0.x - ((mid.x - rect.left) / rect.width) * w, y: g.c0.y - ((mid.y - rect.top) / rect.height) * h, w, h });
      setVista(nv);
      return;
    }
    const dxPx = ev.clientX - g.x0, dyPx = ev.clientY - g.y0;
    if (!g.activo) {
      if (Math.hypot(dxPx, dyPx) < UMBRAL_PX) return;
      cancelarPulsacion();
      g.activo = true;
      setMoviendo(true);
      setTip(null);
    }
    const e = escala();
    if (g.tipo === "pan") {
      setVista(limitar({ ...g.vista0, x: g.vista0.x - dxPx / e, y: g.vista0.y - dyPx / e }));
    } else if (g.tipo === "reserva") {
      const p = aPlano(ev.clientX, ev.clientY);
      const rs = reservasPorMesa[g.mesaId] ?? [];
      const r = reservaPrincipal(rs);
      setFantasma({ x: p.x, y: p.y, w: g.w, h: g.h, texto: r ? `${fmtHora(r.hora)} · ${r.nombre}` : "" });
      const id = mesaEnPunto(ev.clientX, ev.clientY);
      setDestino(id ? { id, ok: id === g.mesaId || admiteReserva(id) } : null);
    } else if (g.tipo === "mover") {
      const nx = ajustarRejilla(Math.max(0, Math.min(salaW, g.pos0.x + dxPx / e)));
      const ny = ajustarRejilla(Math.max(0, Math.min(salaH, g.pos0.y + dyPx / e)));
      setArrastre({ clase: g.objetivo.clase as "mesa" | "objeto", id: g.objetivo.id!, dx: nx - g.pos0.x, dy: ny - g.pos0.y, dw: 0, dh: 0 });
    } else if (g.tipo === "redim") {
      // El asa está en la esquina inferior derecha de la caja efectiva: crece el doble de lo que se mueve (centro fijo).
      const { we, he } = cajaEfectiva(g.dim0.w, g.dim0.h, g.rot);
      const min = g.objetivo.clase === "objeto" ? 0.5 : 2; // una pared o ventana puede ser fina
      const nwe = Math.max(min, ajustarRejilla(we + (2 * dxPx) / e));
      const nhe = Math.max(min, ajustarRejilla(he + (2 * dyPx) / e));
      const r = ((g.rot % 360) + 360) % 360;
      const [nw, nh] = r === 90 || r === 270 ? [nhe, nwe] : [nwe, nhe];
      setArrastre({ clase: g.objetivo.clase as "mesa" | "objeto", id: g.objetivo.id!, dx: 0, dy: 0, dw: nw, dh: nh });
    }
  };

  const terminar = (ev: React.PointerEvent<SVGSVGElement>) => {
    punteros.current.delete(ev.pointerId);
    cancelarPulsacion();
    try { svgRef.current?.releasePointerCapture(ev.pointerId); } catch { /* nada */ }
    const g = gesto.current;
    if (!g) return;
    if (g.tipo === "pinch") {
      if (punteros.current.size === 0) gesto.current = null;
      return;
    }
    gesto.current = null;
    setMoviendo(false);
    const p = cbs.current;

    if (!g.activo) {
      // clic
      if (ev.type === "pointercancel") return;
      const obj = g.tipo === "pan" ? g.objetivo : g.tipo === "reserva" ? { clase: "mesa" as const, id: g.mesaId } : g.objetivo;
      if (obj.clase === "mesa" && obj.id) {
        // Doble clic / doble toque detectado a mano: con la captura del puntero en el <svg>, el dblclick
        // nativo no llega al <g> de la mesa, y en el iPad no es fiable.
        const u = ultimoClic.current;
        const t = ev.timeStamp;
        if (p.onMesaDoble && u && u.id === obj.id && t - u.t < DOBLE_MS && Math.hypot(ev.clientX - u.x, ev.clientY - u.y) < DOBLE_PX) {
          ultimoClic.current = null;
          p.onMesaDoble(obj.id);
          return;
        }
        ultimoClic.current = { id: obj.id, t, x: ev.clientX, y: ev.clientY };
        p.onMesaClick?.(obj.id, { x: ev.clientX, y: ev.clientY });
        return;
      }
      ultimoClic.current = null;
      if (obj.clase === "objeto" && obj.id) p.onObjetoClick?.(obj.id);
      else if (obj.clase === "fondo") p.onFondoClick?.();
      return;
    }
    if (g.tipo === "reserva") {
      setFantasma(null);
      setDestino(null);
      const destinoId = ev.type === "pointercancel" ? null : mesaEnPunto(ev.clientX, ev.clientY);
      if (destinoId && destinoId !== g.mesaId && admiteReserva(destinoId)) p.onReservaDrop?.(g.reservaId, destinoId);
      return;
    }
    if (g.tipo === "mover" || g.tipo === "redim") {
      const a = arrastre;
      setArrastre(null);
      if (!a || ev.type === "pointercancel") return;
      const cambio: Partial<Mesa & PlanoObjeto> = {};
      if (g.tipo === "mover") {
        if (a.dx === 0 && a.dy === 0) return;
        cambio.pos_x = Math.round((g.pos0.x + a.dx) * 10) / 10;
        cambio.pos_y = Math.round((g.pos0.y + a.dy) * 10) / 10;
      } else {
        if (a.dw === g.dim0.w && a.dh === g.dim0.h) return;
        cambio.ancho = Math.round(a.dw * 10) / 10;
        cambio.alto = Math.round(a.dh * 10) / 10;
      }
      if (a.clase === "mesa") p.onCambios?.({ mesas: [{ id: a.id, ...cambio }], objetos: [] });
      else p.onCambios?.({ mesas: [], objetos: [{ id: a.id, ...cambio }] });
    }
  };

  /* ---------- HTML5 drag & drop desde la lista ---------- */
  const aceptaReserva = (ev: React.DragEvent) => !edicion && !!cbs.current.onReservaDrop && Array.from(ev.dataTransfer.types).includes("rsv/reserva");
  const onDragOver = (ev: React.DragEvent<SVGSVGElement>) => {
    if (!aceptaReserva(ev)) return;
    ev.preventDefault();
    const o = objetivoDe(ev.target);
    const id = o.clase === "mesa" ? o.id : null;
    const ok = !!id && admiteReserva(id);
    ev.dataTransfer.dropEffect = id && !ok ? "none" : "move";
    if (id !== (destino?.id ?? null) || (destino && destino.ok !== ok)) setDestino(id ? { id, ok } : null);
  };
  const onDrop = (ev: React.DragEvent<SVGSVGElement>) => {
    if (!aceptaReserva(ev)) return;
    ev.preventDefault();
    const o = objetivoDe(ev.target);
    const id = ev.dataTransfer.getData("rsv/reserva");
    setDestino(null);
    if (o.clase === "mesa" && o.id && id && admiteReserva(o.id)) cbs.current.onReservaDrop?.(id, o.id);
  };

  /* ---------- tooltip ---------- */
  // Junto al cursor; si se sale del plano (que recorta con overflow:hidden), a la izquierda o arriba.
  const ultimoCursor = useRef<{ x: number; y: number } | null>(null);
  function colocarTip(cx: number, cy: number) {
    const el = tipRef.current, env = envRef.current;
    if (!el || !env) return;
    ultimoCursor.current = { x: cx, y: cy };
    const r = env.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = cx - r.left + 14, y = cy - r.top + 14;
    if (x + w > r.width - 4) x = Math.max(4, cx - r.left - w - 14);
    if (y + h > r.height - 4) y = Math.max(4, cy - r.top - h - 14);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }
  // Al cambiar de mesa cambia el tamaño del tooltip: se recoloca con la última posición del cursor.
  useEffect(() => {
    if (tip && ultimoCursor.current) colocarTip(ultimoCursor.current.x, ultimoCursor.current.y);
  });
  const onPointerOver = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (ev.pointerType !== "mouse" || gesto.current || edicion) return;
    const o = objetivoDe(ev.target);
    ultimoCursor.current = { x: ev.clientX, y: ev.clientY };
    setTip(o.clase === "mesa" ? o.id : null);
  };
  const onPointerLeave = () => setTip(null);

  const onTecla = useCallback((id: string, el: SVGGElement, doble: boolean) => {
    if (doble && cbs.current.onMesaDoble) { cbs.current.onMesaDoble(id); return; }
    const r = el.getBoundingClientRect();
    cbs.current.onMesaClick?.(id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }, []);

  /* ---------- asa de redimensionar (edición) ---------- */
  const asa = (() => {
    if (!edicion) return null;
    const m = seleccionada ? mesasPorId.get(seleccionada) : null;
    const o = !m && objetoSeleccionado ? objetosPorId.get(objetoSeleccionado) : null;
    const it = m ?? o;
    if (!it) return null;
    const clase = m ? "mesa" : "objeto";
    const a = arrastre && arrastre.id === it.id ? arrastre : null;
    const base = m ? tamanoMesa(m) : { w: Number(o!.ancho), h: Number(o!.alto) };
    const { we, he } = cajaEfectiva(a?.dw || base.w, a?.dh || base.h, Number(it.rotacion) || 0);
    const cx = Number(it.pos_x) + (a?.dx ?? 0), cy = Number(it.pos_y) + (a?.dy ?? 0);
    const t = Math.max(1.4, vista.w / 60);
    return <rect className="pl-asa" data-asa={`${clase}:${it.id}`} x={cx + we / 2 - t / 2} y={cy + he / 2 - t / 2} width={t} height={t} rx={0.25} />;
  })();

  const tipMesa = tip ? mesasPorId.get(tip) : null;
  const tipReservas = tip ? reservasPorMesa[tip] ?? [] : [];

  return (
    <div ref={envRef} className={`pl${moviendo ? " moviendo" : ""}${edicion ? " edicion" : ""}`} data-tema={tema}>
      <svg
        ref={svgRef}
        className="pl-svg"
        viewBox={`${vista.x} ${vista.y} ${vista.w} ${vista.h}`}
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        role="group"
        aria-label={`Plano de ${sala.nombre}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={terminar}
        onPointerCancel={terminar}
        onPointerOver={onPointerOver}
        onPointerLeave={onPointerLeave}
        onDragOver={onDragOver}
        onDragLeave={() => setDestino(null)}
        onDrop={onDrop}
      >
        <defs>
          <pattern id={idRayas} width={1.4} height={1.4} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={0.6} height={1.4} className="pl-raya" />
          </pattern>
          <pattern id={idRejilla} width={rejilla > 0 ? rejilla : 1} height={rejilla > 0 ? rejilla : 1} patternUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={0.09} className="pl-punto" />
          </pattern>
        </defs>
        {/* suelo de la sala */}
        <rect className="pl-suelo" x={0} y={0} width={salaW} height={salaH} />
        {(edicion || props.mostrarRejilla) && rejilla > 0 ? <rect x={0} y={0} width={salaW} height={salaH} fill={`url(#${idRejilla})`} pointerEvents="none" /> : null}
        {edicion ? <rect className="pl-borde-sala" x={0} y={0} width={salaW} height={salaH} /> : null}

        {objetos.map((o) => (
          <ObjetoG
            key={o.id}
            o={o}
            tema={tema}
            seleccionado={edicion && objetoSeleccionado === o.id}
            edicion={edicion}
            dx={arrastre?.clase === "objeto" && arrastre.id === o.id ? arrastre.dx : 0}
            dy={arrastre?.clase === "objeto" && arrastre.id === o.id ? arrastre.dy : 0}
            dw={arrastre?.clase === "objeto" && arrastre.id === o.id ? arrastre.dw : 0}
            dh={arrastre?.clase === "objeto" && arrastre.id === o.id ? arrastre.dh : 0}
          />
        ))}
        {mesas.map((m) => (
          <MesaG
            key={m.id}
            mesa={m}
            estado={estados[m.id]}
            reservas={reservasPorMesa[m.id] ?? VACIO}
            tema={tema}
            seleccionada={seleccionada === m.id}
            resaltada={setResaltadas.has(m.id)}
            bloqueada={bloqueadas.has(m.id)}
            destino={destino?.id === m.id ? (destino.ok ? "si" : "no") : null}
            edicion={edicion}
            dx={arrastre?.clase === "mesa" && arrastre.id === m.id ? arrastre.dx : 0}
            dy={arrastre?.clase === "mesa" && arrastre.id === m.id ? arrastre.dy : 0}
            dw={arrastre?.clase === "mesa" && arrastre.id === m.id ? arrastre.dw : 0}
            dh={arrastre?.clase === "mesa" && arrastre.id === m.id ? arrastre.dh : 0}
            ahora={ahora}
            idRayas={idRayas}
            onTecla={onTecla}
          />
        ))}
        {asa}
        {fantasma ? (
          <g className="pl-fantasma" transform={`translate(${fantasma.x},${fantasma.y})`} pointerEvents="none">
            <rect x={-fantasma.w / 2} y={-fantasma.h / 2} width={fantasma.w} height={fantasma.h} rx={0.8} />
            <text y={0.5} fontSize={1.4} fontWeight={700} textAnchor="middle">{recortarTexto(fantasma.texto, Math.floor(fantasma.w / 0.8))}</text>
          </g>
        ) : null}
      </svg>

      {/* controles de zoom */}
      <div className="pl-controles" role="group" aria-label="Zoom del plano">
        <button type="button" onClick={() => zoom(1.25)} aria-label="Acercar" title="Acercar">+</button>
        <button type="button" onClick={() => zoom(0.8)} aria-label="Alejar" title="Alejar">−</button>
        <button type="button" onClick={ajustar} aria-label="Ajustar a la pantalla" title="Ajustar">⤢</button>
      </div>

      {/* tooltip (solo ratón) */}
      <div ref={tipRef} className={`pl-tip${tipMesa ? " visible" : ""}`} role="tooltip" aria-hidden={!tipMesa}>
        {tipMesa ? (
          <>
            <div className="pl-tip-cab">
              <b>Mesa {numeroMesa(tipMesa)}</b>
              <span>{tipMesa.cap_min === tipMesa.cap_max ? `${tipMesa.cap_max} pax` : `${tipMesa.cap_min}–${tipMesa.cap_max} pax`}</span>
              {bloqueadas.has(tipMesa.id) && tipReservas.length ? <span>· bloqueada</span> : null}
            </div>
            {tipReservas.length === 0 ? (
              <div className="pl-tip-vacio">{estados[tipMesa.id] === "bloqueada" ? "Bloqueada" : estados[tipMesa.id] === "inactiva" ? "Inactiva" : estados[tipMesa.id] === "web" ? "No se reserva online" : "Libre"}</div>
            ) : (
              [...tipReservas].sort((a, b) => a.hora.localeCompare(b.hora)).map((r) => (
                <div key={r.id} className="pl-tip-res">
                  <div className="pl-tip-l1">
                    <b>{fmtHora(r.hora)}</b> · {r.pax} pax · {r.nombre} {r.apellidos ?? ""}
                  </div>
                  <div className="pl-tip-l2">
                    {r.telefono ? <span>{r.telefono}</span> : null}
                    {r.canal || r.origen ? <span>{r.canal || r.origen}</span> : null}
                    {r.etiquetas?.length ? <span>{r.etiquetas.join(", ")}</span> : null}
                  </div>
                  {r.notas ? <div className="pl-tip-notas">{r.notas}</div> : null}
                </div>
              ))
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default Plano;
