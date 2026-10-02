"use client";

/* Autocompletar de clientes del modal de reserva: por teléfono, email o nombre, con debounce.
   Cada sugerencia enseña visitas, no-shows, etiquetas y última visita; al final «Crear nuevo». */

import { useEffect, useRef, useState } from "react";
import type { Cliente } from "../tipos";
import { fmtFecha } from "../lib-reservas";
import { buscarClientesModal, type Etiqueta, type StatsCliente } from "../acciones/reserva";
import "./buscador-cliente.css";

export type SeleccionCliente = { cliente: Cliente; stats: StatsCliente | null };

export function BuscadorCliente(props: {
  etiquetas?: Etiqueta[];
  autoFocus?: boolean;
  placeholder?: string;
  onSeleccion: (s: SeleccionCliente) => void;
  /** Texto escrito cuando el usuario pulsa «Crear nuevo» (nombre o teléfono según lo que parezca). */
  onCrearNuevo: (texto: string) => void;
}) {
  const { etiquetas = [], autoFocus, placeholder, onSeleccion, onCrearNuevo } = props;
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<{ clientes: Cliente[]; stats: Record<string, StatsCliente> } | null>(null);
  const [activo, setActivo] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultima = useRef(0);
  const raiz = useRef<HTMLDivElement>(null);

  const etiNombre = (id: string) => etiquetas.find((e) => e.id === id);

  function escribir(v: string) {
    setQ(v);
    setActivo(0);
    if (timer.current) clearTimeout(timer.current);
    const t = v.trim();
    if (t.length < 2) {
      setResultado(null);
      setAbierto(false);
      return;
    }
    setAbierto(true);
    setCargando(true);
    const n = ++ultima.current;
    timer.current = setTimeout(async () => {
      const r = await buscarClientesModal(t);
      if (n !== ultima.current) return; // llegó tarde: ya hay otra búsqueda en marcha
      setResultado(r);
      setCargando(false);
    }, 250);
  }

  // Clic fuera: cerrar la lista
  useEffect(() => {
    if (!abierto) return;
    const h = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [abierto]);

  const lista = resultado?.clientes ?? [];
  const total = lista.length + 1; // + «crear nuevo»

  function elegir(i: number) {
    if (i < lista.length) {
      const c = lista[i];
      onSeleccion({ cliente: c, stats: resultado?.stats[c.id] ?? null });
      setQ("");
      setResultado(null);
      setAbierto(false);
    } else {
      onCrearNuevo(q.trim());
      setQ("");
      setResultado(null);
      setAbierto(false);
    }
  }

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!abierto) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActivo((a) => (a + 1) % total); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActivo((a) => (a - 1 + total) % total); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (!cargando) elegir(activo); }
    else if (e.key === "Escape") { e.stopPropagation(); setAbierto(false); }
  }

  return (
    <div className="bc" ref={raiz}>
      <div className="bc-campo">
        <span className="bc-lupa" aria-hidden>⌕</span>
        <input
          type="text"
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder={placeholder ?? "Buscar cliente por teléfono, email o nombre…"}
          value={q}
          onChange={(e) => escribir(e.target.value)}
          onFocus={() => { if (q.trim().length >= 2) setAbierto(true); }}
          onKeyDown={teclas}
          aria-label="Buscar cliente"
          aria-expanded={abierto}
        />
        {cargando ? <span className="bc-cargando" aria-hidden /> : null}
      </div>

      {abierto ? (
        <div className="bc-lista" role="listbox">
          {lista.map((c, i) => {
            const s = resultado?.stats[c.id];
            const nombre = [c.nombre, c.apellidos].filter(Boolean).join(" ") || "Sin nombre";
            const visitas = (s?.visitas ?? 0) + (s?.visitas_presuntas ?? 0);
            return (
              <div
                key={c.id}
                role="option"
                aria-selected={i === activo}
                className={"bc-item" + (i === activo ? " activo" : "")}
                onMouseEnter={() => setActivo(i)}
                onMouseDown={(e) => { e.preventDefault(); elegir(i); }}
              >
                <div className="bc-avatar" aria-hidden>{iniciales(nombre)}</div>
                <div className="bc-cuerpo">
                  <div className="bc-nombre">
                    {nombre}
                    {c.vip ? <span className="bc-badge vip">VIP</span> : null}
                    {c.lista_negra ? <span className="bc-badge negra">Lista negra</span> : null}
                  </div>
                  <div className="bc-det">
                    {c.telefono ? <span>{fmtTel(c.telefono)}</span> : null}
                    {c.email ? <span>{c.email}</span> : null}
                    {!c.telefono && !c.email ? <span>Sin contacto</span> : null}
                  </div>
                  {c.etiquetas?.length ? (
                    <div className="bc-etis">
                      {c.etiquetas.slice(0, 4).map((id) => {
                        const e = etiNombre(id);
                        return e ? <span key={id} className="bc-eti" style={{ background: e.color }}>{e.nombre}</span> : null;
                      })}
                    </div>
                  ) : null}
                </div>
                <div className="bc-stats">
                  <span className="bc-n" title="Visitas"><b>{visitas}</b> vis.</span>
                  {s?.no_shows ? <span className="bc-n ns" title="No-shows"><b>{s.no_shows}</b> no-show</span> : null}
                  {s?.ultima_visita ? <span className="bc-ult">últ. {fmtFecha(s.ultima_visita)}</span> : null}
                </div>
              </div>
            );
          })}
          {!cargando && lista.length === 0 ? <div className="bc-vacio">Ningún cliente con «{q.trim()}»</div> : null}
          <div
            role="option"
            aria-selected={activo === lista.length}
            className={"bc-item bc-nuevo" + (activo === lista.length ? " activo" : "")}
            onMouseEnter={() => setActivo(lista.length)}
            onMouseDown={(e) => { e.preventDefault(); elegir(lista.length); }}
          >
            <span className="bc-mas" aria-hidden>+</span> Crear cliente nuevo{q.trim() ? <> con «{q.trim()}»</> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function iniciales(nombre: string): string {
  const p = nombre.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

/** 34612345678 → +34 612 345 678 (solo para enseñar). */
export function fmtTel(t: string | null | undefined): string {
  const n = (t || "").replace(/\D/g, "");
  if (!n) return "";
  if (n.length === 9) return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  if (n.length === 11 && n.startsWith("34")) return `+34 ${n.slice(2, 5)} ${n.slice(5, 8)} ${n.slice(8)}`;
  if (n.length > 9) return `+${n.slice(0, n.length - 9)} ${n.slice(-9, -6)} ${n.slice(-6, -3)} ${n.slice(-3)}`;
  return n;
}
