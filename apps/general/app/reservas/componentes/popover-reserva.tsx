"use client";

/* Popover de acciones rápidas de una reserva (clic en la fila de la lista o en una mesa
   ocupada del plano). Cabecera con los datos de la reserva y rejilla de botones grandes con
   el color del estado al que llevan (guía §4). Se cierra con Esc o clic fuera.

   Contrato: onEstado(estado) devuelve una promesa; el segundo parámetro es opcional: «Sentada»
   pasa cuántos han llegado y «Cancelada» quién cancela (cliente / restaurante) y el motivo.
   Los pasos destructivos (no show, cancelar) piden confirmación dentro del propio popover:
   nada de confirm(). Teclado: al abrir, el foco va al primer botón; al cerrar, vuelve a donde
   estaba (la fila de la lista). */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Reserva } from "../tipos";
import { ESTADO, ESTADOS_EN_SALA, colorTexto, fmtFecha, fmtHora, nombreCliente } from "../lib-reservas";
import "./popover-reserva.css";

/** Datos extra de un cambio de estado (todos opcionales). */
export type ExtraEstado = { pax_llegados?: number; cancelada_por?: "cliente" | "restaurante"; motivo?: string };

export type PopoverReservaProps = {
  reserva: Reserva;
  x: number;
  y: number;
  cerrar: () => void;
  onEstado: (estado: string, extra?: ExtraEstado) => Promise<void>;
  onEditar: () => void;
  onLiberar: () => Promise<void>;
  onDesplazar: () => void;
  onWhatsApp: () => void;
};

const ANCHO = 440;

/** Fecha y hora de creación en hora de Madrid: «29/09/2026 12:09». */
function fechaHoraCreacion(ts: string): string {
  const d = new Date(ts);
  const f = d.toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const h = d.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
  return `${fmtFecha(f)} ${h}`;
}

export function PopoverReserva(props: PopoverReservaProps) {
  const { reserva: r, x, y, cerrar, onEstado, onEditar, onLiberar, onDesplazar, onWhatsApp } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; arriba: boolean }>({ left: x, top: y, arriba: false });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<"no_show" | "cancelada" | null>(null);
  const [sentando, setSentando] = useState(false);
  const [paxLlegados, setPaxLlegados] = useState(r.pax_llegados ?? r.pax);
  const [motivo, setMotivo] = useState("");

  const c = r.reservas_clientes;
  const tel = c?.telefono ?? null;
  // Liberar = «terminada», que cuenta como visita y comensales: solo con el cliente en la sala.
  const enSala = ESTADOS_EN_SALA.includes(r.estado);

  // Foco: al montar se recuerda quién lo tenía (la fila) y se pasa al primer botón habilitado;
  // al cambiar de paso (confirmar / sentar) se vuelve a enfocar el primero del paso; al
  // desmontar se devuelve a la fila para seguir con el teclado.
  const previo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previo.current = document.activeElement as HTMLElement | null;
    const nodo = ref.current;
    return () => {
      // Solo si el foco se ha quedado en el popover (o se ha perdido): si se ha cerrado porque
      // se ha tocado otro sitio, el foco es de ese sitio.
      const act = document.activeElement;
      const el = previo.current;
      if (act && act !== document.body && !nodo?.contains(act)) return;
      if (el && el.isConnected && typeof el.focus === "function") el.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(".pv-paso input, .pv-paso button:not(:disabled), .pv-fila button:not(:disabled)");
    el?.focus({ preventScroll: true });
  }, [confirmando, sentando]);

  // Colocación: debajo del punto de clic; si no cabe, encima; nunca fuera de la ventana.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const alto = el.offsetHeight;
    const ancho = Math.min(ANCHO, window.innerWidth - 16);
    let left = x - ancho / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - ancho - 8));
    let top = y + 12;
    let arriba = false;
    if (top + alto > window.innerHeight - 8) {
      top = Math.max(8, y - alto - 12);
      arriba = true;
    }
    setPos({ left, top, arriba });
  }, [x, y, confirmando, sentando]);

  // Esc y clic fuera.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); cerrar(); } };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cerrar();
    };
    window.addEventListener("keydown", onKey, true);
    // En el siguiente tick para no cerrarse con el mismo clic que lo abrió.
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
    };
  }, [cerrar]);

  async function ir(estado: string, extra?: ExtraEstado) {
    if (ocupado) return;
    setOcupado(estado);
    try {
      await onEstado(estado, extra);
      cerrar();
    } finally {
      setOcupado(null);
    }
  }

  async function liberar() {
    if (ocupado) return;
    setOcupado("terminada");
    try {
      await onLiberar();
      cerrar();
    } finally {
      setOcupado(null);
    }
  }

  /** Botón de estado: color del estado destino; el actual se marca y no se puede volver a pulsar. */
  const BotonEstado = ({ estado, texto, icono, onClick }: { estado: string; texto?: string; icono?: React.ReactNode; onClick?: () => void }) => {
    const def = ESTADO[estado];
    const actual = r.estado === estado;
    const txt = def.borde ? "#1a1a1a" : colorTexto(def.color);
    return (
      <button
        type="button"
        className={"pv-btn" + (actual ? " actual" : "")}
        style={{ background: def.color, color: txt, borderColor: def.borde ?? def.color }}
        disabled={actual || !!ocupado}
        aria-pressed={actual}
        onClick={onClick ?? (() => ir(estado))}
      >
        {icono}{texto ?? def.texto}
      </button>
    );
  };

  const mesas = (r.reservas_reserva_mesas || []).length;

  return (
    <div
      ref={ref}
      className={"pv-reserva" + (pos.arriba ? " arriba" : "")}
      style={{ left: pos.left, top: pos.top, width: Math.min(ANCHO, window.innerWidth - 16) }}
      role="dialog"
      aria-label={`Acciones de la reserva de ${c?.nombre ?? "cliente"}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="pv-cab">
        <div className="pv-tit">
          <b>{nombreCliente(r).nombre}{nombreCliente(r).apellidos ? ` ${nombreCliente(r).apellidos}` : ""}</b>
          <span> · {fmtHora(r.hora)} · {r.pax} pax{mesas > 1 ? ` · ${mesas} mesas` : ""}</span>
          <span className="pv-estado" style={{ background: ESTADO[r.estado]?.color ?? "#8A9199", color: ESTADO[r.estado]?.borde ? "#1a1a1a" : colorTexto(ESTADO[r.estado]?.color ?? "#8A9199") }}>
            {ESTADO[r.estado]?.texto ?? r.estado}
          </span>
        </div>
        <div className="pv-meta">
          Reserva hecha: {fechaHoraCreacion(r.creado_en)}
          {tel ? <> · Tel: <a href={`tel:${tel.replace(/\s+/g, "")}`}>{tel}</a></> : null}
          {r.canal ? <> · Canal: {r.canal}</> : null}
          {r.localizador ? <> · <code>{r.localizador}</code></> : null}
        </div>
        {r.alergias || c?.alergias ? <div className="pv-alerg">Alergias: {r.alergias || c?.alergias}</div> : null}
      </div>

      {confirmando === "no_show" ? (
        <div className="pv-confirmar pv-paso">
          <div>¿Marcar como no show? Queda registrado en la ficha del cliente.</div>
          <div className="pv-confirmar-btns">
            <button type="button" className="pv-btn" style={{ background: ESTADO.no_show.color, color: "#fff" }} disabled={!!ocupado} onClick={() => ir("no_show")}>
              Sí, no show
            </button>
            <button type="button" className="pv-btn pv-neutro" onClick={() => setConfirmando(null)}>Volver</button>
          </div>
        </div>
      ) : confirmando === "cancelada" ? (
        <form
          className="pv-confirmar pv-paso"
          onSubmit={(e) => { e.preventDefault(); ir("cancelada", { cancelada_por: "cliente", motivo: motivo.trim() || undefined }); }}
        >
          <div>¿Quién cancela? Se avisará al cliente si tiene notificaciones activas.</div>
          <input
            className="pv-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={500}
            placeholder="Motivo (opcional)"
            aria-label="Motivo de la cancelación"
          />
          <div className="pv-confirmar-btns">
            <button type="submit" className="pv-btn" style={{ background: ESTADO.cancelada.color, color: "#fff" }} disabled={!!ocupado}>
              Cancela el cliente
            </button>
            <button
              type="button"
              className="pv-btn"
              style={{ background: ESTADO.cancelada.color, color: "#fff" }}
              disabled={!!ocupado}
              onClick={() => ir("cancelada", { cancelada_por: "restaurante", motivo: motivo.trim() || undefined })}
            >
              Cancela el restaurante
            </button>
            <button type="button" className="pv-btn pv-neutro" onClick={() => setConfirmando(null)}>Volver</button>
          </div>
        </form>
      ) : sentando ? (
        <div className="pv-confirmar pv-paso">
          <div>¿Cuántos han llegado?</div>
          <div className="pv-confirmar-btns pv-pax">
            <button type="button" className="pv-btn pv-neutro" onClick={() => setPaxLlegados((n) => Math.max(1, n - 1))} aria-label="Menos">−</button>
            <span className="pv-pax-num">{paxLlegados}<small>/{r.pax}</small></span>
            <button type="button" className="pv-btn pv-neutro" onClick={() => setPaxLlegados((n) => n + 1)} aria-label="Más">+</button>
            <button type="button" className="pv-btn" style={{ background: ESTADO.sentada.color, color: "#fff" }} disabled={!!ocupado} onClick={() => ir("sentada", { pax_llegados: paxLlegados })}>
              Sentar
            </button>
            <button type="button" className="pv-btn pv-neutro" onClick={() => setSentando(false)}>Volver</button>
          </div>
        </div>
      ) : (
        <>
          <div className="pv-fila pv-3">
            <button type="button" className="pv-btn pv-oscuro" onClick={() => { cerrar(); onEditar(); }}>Editar reserva</button>
            <button
              type="button"
              className="pv-btn pv-liberar"
              disabled={!enSala || !!ocupado}
              title={enSala ? "Terminar y dejar la mesa libre" : "Solo con el cliente en la sala; si no ha venido, No show o Cancelada"}
              onClick={liberar}
            >
              Liberar
            </button>
            <button type="button" className="pv-btn pv-neutro" onClick={() => { cerrar(); onDesplazar(); }}>Desplazar</button>
          </div>
          <div className="pv-fila pv-4">
            <BotonEstado estado="pendiente" />
            <BotonEstado estado="confirmada" />
            <BotonEstado estado="reconfirmada" icono={<span className="pv-ico" aria-hidden>✓✓ </span>} />
            <BotonEstado estado="cancelada" texto="Cancelada cliente" onClick={() => setConfirmando("cancelada")} />
          </div>
          <div className="pv-fila pv-4">
            <BotonEstado estado="llegada" />
            <BotonEstado estado="sentada" onClick={() => (r.pax > 1 ? setSentando(true) : ir("sentada", { pax_llegados: 1 }))} />
            <BotonEstado estado="postre" />
            <BotonEstado estado="cuenta" />
          </div>
          <div className="pv-fila pv-3">
            <BotonEstado estado="no_show" texto="No show" onClick={() => setConfirmando("no_show")} />
            <BotonEstado estado="a_revisar" />
            <button type="button" className="pv-btn pv-wa" disabled={!tel} title={tel ? "Abrir WhatsApp" : "El cliente no tiene teléfono"} onClick={() => { cerrar(); onWhatsApp(); }}>
              WhatsApp
            </button>
          </div>
        </>
      )}
      <i className="pv-flecha" aria-hidden />
    </div>
  );
}
