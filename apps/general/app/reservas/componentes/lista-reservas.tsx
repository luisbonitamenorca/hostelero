"use client";

/* Lista de reservas estilo Cover (guía §2): M · Hora · Nombre · Pax · Estado, con la info del
   cliente (ámbar) y de la reserva (azul) bajo la fila. Reutilizable por otras secciones:
   solo necesita las reservas (con cliente y mesas) y las mesas para resolver nombres.

   - Clic en la fila → onClick (popover); doble clic → onDoble o, si no se pasa, el evento
     window "rsv:abrir-reserva" (detail = id) que abre el modal desde cualquier sección.
   - Filas arrastrables: dataTransfer "rsv/reserva" = id (el plano hace el drop).
   - Buscador y ordenación locales (hora / mesa / nombre). */

import { useMemo, useState } from "react";
import type { Tables } from "@hostelero/db";
import type { Mesa, Reserva } from "../tipos";
import { ESTADO, ESTADOS_EN_SALA, colorTexto, estadoDe, fmtHora, nombreCliente } from "../lib-reservas";
import "./lista-reservas.css";

/** Reserva con los extras opcionales que calcula acciones/dia.ts (visitas, prescriptor…). */
export type ReservaLista = Reserva & {
  visitas?: number;
  no_shows?: number;
  riesgo_no_show?: number | null;
  prescriptor_nombre?: string | null;
};

export type OrdenLista = "hora" | "mesa" | "nombre";

export type ListaReservasProps<T extends ReservaLista = ReservaLista> = {
  reservas: T[];
  mesas: Mesa[];
  /** Catálogo de etiquetas para resolver los uuid de reserva/cliente/alérgenos. */
  etiquetas?: Tables<"reservas_etiquetas">[];
  /** Reserva resaltada (p. ej. la del popover abierto). */
  seleccionada?: string | null;
  /** Mesa resaltada en el plano: sus filas se marcan. */
  mesaResaltada?: string | null;
  onClick?: (r: T, ev: { x: number; y: number }) => void;
  onDoble?: (r: T) => void;
  /** Buscador local encima de la lista (por defecto sí). */
  buscador?: boolean;
  /** Filas arrastrables (por defecto sí). */
  arrastrable?: boolean;
  /** Texto cuando no hay filas. */
  vacio?: string;
  /** "HH:MM" para pintar «lleva X min» en las sentadas. */
  ahora?: string;
  /** Ordenación inicial. */
  orden?: OrdenLista;
};

/* ==================== Iconos (SVG en línea, sin librerías) ==================== */

const RUTAS: Record<string, string> = {
  campana: "M12 2a6 6 0 0 0-6 6v3.6L4 15v1h16v-1l-2-3.4V8a6 6 0 0 0-6-6zm0 20a2.5 2.5 0 0 0 2.4-2H9.6A2.5 2.5 0 0 0 12 22z",
  repetir: "M7 7h9V4l4 4-4 4V9H7a2 2 0 0 0-2 2v1H3v-1a4 4 0 0 1 4-4zm10 10H8v3l-4-4 4-4v3h9a2 2 0 0 0 2-2v-1h2v1a4 4 0 0 1-4 4z",
  doblecheck: "M2 12.5l4.5 4.5L15 8.5l-1.5-1.5-7 7-3-3zm8.5 2.5l1.5 1.5L22 7l-1.5-1.5L12 14l-1.5-1.5z",
  comentario: "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2z",
  ticket: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 1 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 1 0 0-4V7zm6 2v2h6V9H9zm0 4v2h6v-2H9z",
  tarjeta: "M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2H2V6zm0 4h20v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8zm3 5v2h6v-2H5z",
  alerta: "M12 2L1 21h22L12 2zm0 6l1 7h-2l1-7zm0 9a1.3 1.3 0 1 1 0 2.6A1.3 1.3 0 0 1 12 17z",
  estrella: "M12 2l3 7 7 .6-5.3 4.6 1.7 7L12 17.5 5.6 21.2l1.7-7L2 9.6 9 9z",
  prohibido: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 0 1 6.3 13L7 6.7A8 8 0 0 1 12 4zM5.7 7.7L17 19.3A8 8 0 0 1 5.7 7.7z",
  lupa: "M10 2a8 8 0 1 0 4.9 14.3l5.4 5.4 1.4-1.4-5.4-5.4A8 8 0 0 0 10 2zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12z",
  orden: "M8 4l4 5H4l4-5zm0 16l-4-5h8l-4 5zm8-16l4 5h-8l4-5zm0 16l-4-5h8l-4 5z",
  reloj: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm-1 3h2v5.6l3.5 2-1 1.7L11 13.2V7z",
  sentada: "M12 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-7 18a7 7 0 0 1 14 0v2H5v-2z",
  llegada: "M9 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-7 18a7 7 0 0 1 14 0v2H2v-2zm16-9h2v3h3v2h-3v3h-2v-3h-3v-2h3v-3z",
  cuenta: "M4 3h16v18l-3-2-3 2-2-2-2 2-3-2-3 2V3zm3 5v2h10V8H7zm0 4v2h10v-2H7z",
  postre: "M4 11h16a8 8 0 0 1-16 0zm8-9l1.5 3h-3L12 2zm-8 18h16v2H4v-2z",
  candado: "M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3zm0 9a2 2 0 0 1 1 3.7V19h-2v-2.3A2 2 0 0 1 12 13z",
  calendario: "M7 2v2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3V2h-2v2H9V2H7zM4 9h16v11H4V9zm2 2v2h3v-2H6zm5 0v2h3v-2h-3zm5 0v2h2v-2h-2zM6 15v2h3v-2H6zm5 0v2h3v-2h-3z",
  descargar: "M11 3h2v9.2l3.5-3.5 1.4 1.4L12 16l-5.9-5.9 1.4-1.4L11 12.2V3zM4 17h2v2h12v-2h2v4H4v-4z",
  imprimir: "M6 2h12v5H6V2zm-2 7h16a2 2 0 0 1 2 2v7h-4v4H6v-4H2v-7a2 2 0 0 1 2-2zm4 7v4h8v-4H8zm10-5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  mas: "M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4z",
};

/** Icono de 12 px que hereda el color del texto. */
export function Icono({ nombre, titulo, tam = 12 }: { nombre: keyof typeof RUTAS | string; titulo?: string; tam?: number }) {
  const d = RUTAS[nombre];
  if (!d) return null;
  return (
    <svg className="lr-ico" width={tam} height={tam} viewBox="0 0 24 24" fill="currentColor" aria-hidden={!titulo} role={titulo ? "img" : undefined}>
      {titulo ? <title>{titulo}</title> : null}
      <path d={d} />
    </svg>
  );
}

/** Iconos que van dentro de la píldora de estado (origen, reconfirmada, comentario, ticket, política). */
export function iconosReserva(r: Reserva): { nombre: string; titulo: string }[] {
  const out: { nombre: string; titulo: string }[] = [];
  if (r.origen === "online") out.push({ nombre: r.canal ? "repetir" : "campana", titulo: r.canal ? `Canal: ${r.canal}` : "Hecha desde el motor web" });
  if (r.estado === "reconfirmada" || r.reconfirmada_en) out.push({ nombre: "doblecheck", titulo: "Reconfirmada por el cliente" });
  if (r.notas_cliente) out.push({ nombre: "comentario", titulo: "Comentario del cliente" });
  if (r.tipo === "prepago" || r.tipo === "experiencia") out.push({ nombre: "ticket", titulo: r.tipo === "prepago" ? "Prepago" : "Experiencia / menú" });
  if (r.tipo === "politica_cancelacion" || r.tipo === "garantia") out.push({ nombre: "tarjeta", titulo: r.tipo === "garantia" ? "Garantía con tarjeta" : "Política de cancelación" });
  if (ESTADOS_EN_SALA.includes(r.estado)) {
    const ico = r.estado === "sentada" ? "sentada" : r.estado === "llegada" ? "llegada" : r.estado === "cuenta" ? "cuenta" : "postre";
    out.push({ nombre: ico, titulo: ESTADO[r.estado]?.texto ?? r.estado });
  }
  return out;
}

/* ==================== Helpers ==================== */

const IDIOMAS: Record<string, string> = { es: "ES", en: "EN", ca: "CA", fr: "FR", de: "DE", it: "IT", pt: "PT", nl: "NL" };

function mesasDeReserva(r: Reserva): string[] {
  const ids = (r.reservas_reserva_mesas || []).map((x) => x.mesa_id);
  if (r.mesa_id && !ids.includes(r.mesa_id)) ids.unshift(r.mesa_id);
  return ids;
}

function minutosDesde(ts: string | null, ahora?: string): number | null {
  if (!ts || !ahora) return null;
  const d = new Date(ts);
  const h = Number(d.toLocaleTimeString("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hour12: false }));
  const m = Number(d.toLocaleTimeString("en-GB", { timeZone: "Europe/Madrid", minute: "2-digit" }));
  const [ha, ma] = ahora.split(":").map(Number);
  const diff = ha * 60 + ma - (h * 60 + m);
  return diff >= 0 ? diff : null;
}

/* ==================== Componente ==================== */

export function ListaReservas<T extends ReservaLista>(props: ListaReservasProps<T>) {
  const { reservas, mesas, etiquetas = [], seleccionada, mesaResaltada, onClick, onDoble, buscador = true, arrastrable = true, vacio, ahora } = props;
  const [q, setQ] = useState("");
  const [orden, setOrden] = useState<OrdenLista>(props.orden ?? "hora");
  const [asc, setAsc] = useState(true);

  const nombreMesa = useMemo(() => {
    const m: Record<string, string> = {};
    for (const x of mesas) m[x.id] = x.etiqueta || x.nombre;
    return m;
  }, [mesas]);
  const etiquetaPor = useMemo(() => {
    const m: Record<string, Tables<"reservas_etiquetas">> = {};
    for (const e of etiquetas) m[e.id] = e;
    return m;
  }, [etiquetas]);

  const filas = useMemo(() => {
    const t = q.trim().toLowerCase();
    // Teléfono solo si la consulta es casi toda numérica: «Mesa 1» o un localizador con
    // dígitos no deben coincidir con cualquier teléfono que contenga ese número.
    const tel = /^[\d\s+()-]+$/.test(t) ? t.replace(/\D/g, "") : "";
    let xs = reservas;
    if (t) {
      xs = xs.filter((r) => {
        const c = r.reservas_clientes;
        const txt = `${c?.nombre ?? ""} ${c?.apellidos ?? ""} ${c?.email ?? ""} ${r.localizador ?? ""} ${r.empresa ?? ""}`.toLowerCase();
        if (txt.includes(t)) return true;
        if (tel.length >= 3 && (c?.telefono ?? "").replace(/\D/g, "").includes(tel)) return true;
        return mesasDeReserva(r).some((id) => (nombreMesa[id] ?? "").toLowerCase() === t);
      });
    }
    const clave = (r: T) => {
      if (orden === "mesa") {
        const n = nombreMesa[mesasDeReserva(r)[0] ?? ""] ?? "";
        const num = parseInt(n, 10);
        return isNaN(num) ? `z${n}` : String(num).padStart(6, "0");
      }
      if (orden === "nombre") return `${r.reservas_clientes?.nombre ?? ""} ${r.reservas_clientes?.apellidos ?? ""}`.trim().toLowerCase();
      return `${fmtHora(r.hora)} ${nombreMesa[r.mesa_id ?? ""] ?? ""}`;
    };
    return [...xs].sort((a, b) => {
      const ka = clave(a), kb = clave(b);
      const c = ka < kb ? -1 : ka > kb ? 1 : 0;
      return asc ? c : -c;
    });
  }, [reservas, q, orden, asc, nombreMesa]);

  function cambiarOrden(o: OrdenLista) {
    if (o === orden) setAsc(!asc);
    else { setOrden(o); setAsc(true); }
  }

  function doble(r: T) {
    if (onDoble) onDoble(r);
    else if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("rsv:abrir-reserva", { detail: r.id }));
  }

  const Cab = ({ o, children }: { o: OrdenLista; children: React.ReactNode }) => (
    <button type="button" className={"lr-cab-btn" + (orden === o ? " activo" : "")} onClick={() => cambiarOrden(o)} aria-sort={orden === o ? (asc ? "ascending" : "descending") : undefined}>
      {children}<Icono nombre="orden" tam={10} />
    </button>
  );

  return (
    <div className="lr">
      {buscador ? (
        <div className="lr-buscar">
          <Icono nombre="lupa" tam={14} />
          <input
            type="search"
            placeholder="Buscar por nombre, apellido, teléfono, localizador…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar en la lista"
          />
          {q ? <button type="button" className="lr-limpiar" onClick={() => setQ("")} aria-label="Limpiar búsqueda">✕</button> : null}
        </div>
      ) : null}

      <div className="lr-cabecera" role="row">
        <div className="lr-m"><Cab o="mesa">M</Cab></div>
        <div className="lr-h"><Cab o="hora">Hora</Cab></div>
        <div className="lr-n"><Cab o="nombre">Nombre</Cab></div>
        <div className="lr-p">Pax</div>
        <div className="lr-e">Estado</div>
      </div>

      {!filas.length ? (
        <div className="lr-vacio">{q ? "Nada coincide con la búsqueda." : vacio ?? "Sin reservas."}</div>
      ) : (
        filas.map((r) => {
          const c = r.reservas_clientes;
          const def = estadoDe(r.estado);
          const txtPill = def.borde ? "#1a1a1a" : colorTexto(def.color);
          const ids = mesasDeReserva(r);
          const nombresMesas = ids.map((id) => nombreMesa[id] ?? "?");
          const resaltadaMesa = !!mesaResaltada && ids.includes(mesaResaltada);
          const etiqRes = (r.etiquetas || []).map((id) => etiquetaPor[id]).filter(Boolean);
          const etiqCli = (c?.etiquetas || []).map((id) => etiquetaPor[id]).filter(Boolean);
          const alergenos = (c?.alergenos || []).map((id) => etiquetaPor[id]?.nombre).filter(Boolean);
          const alergias = r.alergias || c?.alergias || null;
          // Riesgo de no-show (reservas_clientes_stats, 0–1): solo cuenta antes de que llegue.
          const riesgo = !ESTADOS_EN_SALA.includes(r.estado) && typeof r.riesgo_no_show === "number" ? r.riesgo_no_show : null;
          const sub: string[] = [];
          if (r.canal) sub.push(`CH: ${r.canal}`);
          else if (r.origen === "online") sub.push("Web");
          if (r.prescriptor_nombre) sub.push(r.prescriptor_nombre);
          if (r.empresa) sub.push(r.empresa);
          if (r.idioma && r.idioma !== "es") sub.push(IDIOMAS[r.idioma] ?? r.idioma.toUpperCase());
          const llevaMin = r.estado === "sentada" ? minutosDesde(r.sentada_en, ahora) : r.estado === "llegada" ? minutosDesde(r.llegada_en, ahora) : null;
          const infoCliente: string[] = [];
          if (alergias) infoCliente.push(`Alergias: ${alergias}`);
          if (alergenos.length) infoCliente.push(`Alérgenos: ${alergenos.join(", ")}`);
          if (c?.vip) infoCliente.push("VIP");
          if (c?.lista_negra) infoCliente.push("LISTA NEGRA");
          if ((r.no_shows ?? 0) > 0) infoCliente.push(`${r.no_shows} no show${r.no_shows === 1 ? "" : "s"}`);
          if (c?.notas) infoCliente.push(c.notas);
          const infoReserva: string[] = [];
          if (r.notas_cliente) infoReserva.push(r.notas_cliente);
          if (r.notas_internas) infoReserva.push(`Interna: ${r.notas_internas}`);
          if (r.pax_llegados != null && r.pax_llegados !== r.pax && ESTADOS_EN_SALA.includes(r.estado)) infoReserva.push(`Han llegado ${r.pax_llegados} de ${r.pax}`);

          return (
            <div
              key={r.id}
              className={"lr-item" + (seleccionada === r.id ? " sel" : "") + (resaltadaMesa ? " mesa-res" : "") + (c?.lista_negra ? " negra" : "")}
              style={{ ["--lr-c" as string]: def.color }}
              draggable={arrastrable}
              onDragStart={(e) => {
                e.dataTransfer.setData("rsv/reserva", r.id);
                e.dataTransfer.setData("text/plain", r.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={(e) => onClick?.(r, { x: e.clientX, y: e.clientY })}
              onDoubleClick={() => doble(r)}
              role="row"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  onClick?.(r, { x: b.left + b.width / 2, y: b.top + b.height / 2 });
                }
              }}
            >
              <div className="lr-fila">
                <div className="lr-m" title={nombresMesas.length > 1 ? `Mesas ${nombresMesas.join(" + ")}` : undefined}>
                  {nombresMesas.length ? nombresMesas[0] : <span className="lr-sinmesa">—</span>}
                  {nombresMesas.length > 1 ? <small>+{nombresMesas.length - 1}</small> : null}
                </div>
                <div className="lr-h">{fmtHora(r.hora)}</div>
                <div className="lr-n">
                  <div className="lr-nombre">
                    <b>{nombreCliente(r).nombre}{nombreCliente(r).apellidos ? ` ${nombreCliente(r).apellidos}` : ""}</b>
                    {(r.visitas ?? 0) > 0 ? <span className="lr-visitas" title={`${r.visitas} visitas`}>{r.visitas}</span> : null}
                    {riesgo != null && riesgo >= 0.3 ? (
                      <span className={"lr-riesgo" + (riesgo >= 0.6 ? " alto" : "")} title={`Riesgo de no-show: ${Math.round(riesgo * 100)} %`}>Riesgo</span>
                    ) : null}
                    {c?.vip ? <span className="lr-vip" title="VIP"><Icono nombre="estrella" tam={11} /></span> : null}
                    {alergias || alergenos.length ? <span className="lr-alerg" title="Alergias"><Icono nombre="alerta" tam={11} /></span> : null}
                    {c?.lista_negra ? <span className="lr-negra" title="Lista negra"><Icono nombre="prohibido" tam={11} /></span> : null}
                    {etiqRes.map((e) => <span key={e.id} className="lr-etq" style={{ background: e.color, color: colorTexto(e.color) }}>{e.nombre}</span>)}
                    {etiqCli.filter((e) => !["VIP", "Lista negra"].includes(e.nombre)).slice(0, 3).map((e) => (
                      <span key={e.id} className="lr-etq cli" style={{ borderColor: e.color, color: e.color }}>{e.nombre}</span>
                    ))}
                  </div>
                  {sub.length ? <div className="lr-sub">{sub.join(" · ")}</div> : null}
                </div>
                <div className="lr-p">
                  {r.pax}
                  {llevaMin != null ? <small className="lr-lleva" title={r.estado === "sentada" ? "Minutos en mesa" : "Minutos desde la llegada"}>{llevaMin}′</small> : null}
                </div>
                <div className="lr-e">
                  <span className="lr-pill" style={{ background: def.color, color: txtPill, borderColor: def.borde ?? def.color }} title={def.texto}>
                    {iconosReserva(r).map((i) => <Icono key={i.nombre} nombre={i.nombre} titulo={i.titulo} />)}
                    <span className="lr-pill-txt">{def.texto}</span>
                  </span>
                </div>
              </div>
              {infoCliente.length ? (
                <div className="lr-info cliente"><span>Información cliente:</span> {infoCliente.join(" · ")}</div>
              ) : null}
              {infoReserva.length ? (
                <div className="lr-info reserva"><span>Información reserva:</span> {infoReserva.join(" · ")}</div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
