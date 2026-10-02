"use client";

/* Piezas compartidas de las subpantallas de Ajustes: tipos de props, campos de formulario,
   interruptores, botones, confirmación y utilidades de datos. Todo acotado a .aj (ajustes.css). */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Tables } from "@hostelero/db";
import type { Restaurante, Sala, Turno } from "../../tipos";
import type { Ctx, Tema } from "../../lib-reservas";

/* ==================== Props comunes ==================== */

export type AjProps = {
  ctx: Ctx;
  rest: Restaurante;
  fecha: string;
  avisar: (m: string) => void;
  turnos: Turno[];
  salas: Sala[];
  /** Vuelve a leer turnos y salas (tras crear/editar en Turnos, Planos o Mesas). */
  recargarBase: () => Promise<void>;
  /** Dirección o `puede_ajustes` que cubre este restaurante: si es false, todo en solo lectura. */
  puedeEditar: boolean;
  /** Puede cambiar lo común a todos los restaurantes (plantillas y códigos de la cuenta, catálogos):
      dirección o `puede_ajustes` sin restricción de restaurante. */
  puedeEditarCuenta: boolean;
  /** Dirección o `puede_editar_plano` (con este restaurante): el editor del plano mira este permiso. */
  puedeEditarPlano: boolean;
  esDireccion: boolean;
  tema: Tema;
  /** La subpantalla ha guardado el restaurante: Ajustes y PanelReservas actualizan su copia. */
  onRestaurante: (r: Restaurante) => void;
  /** La subpantalla tiene (true) o ya no tiene (false) cambios sin guardar: Ajustes pide
      confirmación antes de cambiar de pestaña o de restaurante, y al cerrar la página. */
  onSucio: (b: boolean) => void;
  /** Cambia a otra pestaña de Ajustes (con la misma confirmación si hay cambios). */
  irA: (tab: string) => void;
};

export type Resultado<T = undefined> = { ok: boolean; error?: string; data?: T };

/* ==================== Catálogos de texto ==================== */

export const IDIOMAS: { id: string; texto: string }[] = [
  { id: "es", texto: "Español" },
  { id: "en", texto: "Inglés" },
  { id: "ca", texto: "Catalán" },
  { id: "fr", texto: "Francés" },
  { id: "de", texto: "Alemán" },
  { id: "it", texto: "Italiano" },
];
export const nombreIdioma = (id: string) => IDIOMAS.find((i) => i.id === id)?.texto ?? id.toUpperCase();

export const DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];
export const DIAS_LARGOS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export const TIPOS_PLANTILLA: { id: string; texto: string; cuando: string }[] = [
  { id: "confirmacion", texto: "Reserva recibida", cuando: "Al crear la reserva (online o desde el panel con aviso)." },
  { id: "confirmada", texto: "Reserva confirmada", cuando: "Cuando el restaurante acepta una reserva pendiente." },
  { id: "recordatorio", texto: "Recordatorio", cuando: "Unas horas antes (ajustable en Mensajes › horas)." },
  { id: "reconfirmacion", texto: "Reconfirmación", cuando: "Para reservas con política, garantía o grupos." },
  { id: "modificacion", texto: "Modificación", cuando: "Cuando cambian fecha, hora o personas." },
  { id: "cancelacion", texto: "Cancelación", cuando: "Al cancelar (cliente o restaurante)." },
  { id: "lista_espera", texto: "Lista de espera", cuando: "Cuando queda un hueco libre para un apuntado." },
  { id: "valoracion", texto: "Valoración", cuando: "Unas horas después de la visita." },
  { id: "pago", texto: "Prepago", cuando: "Enlace para pagar por adelantado." },
  { id: "garantia", texto: "Garantía (tarjeta)", cuando: "Enlace para dejar la tarjeta como garantía." },
  { id: "noshow", texto: "No-show", cuando: "Cuando el cliente no se presenta." },
  { id: "invitacion", texto: "Invitación a acompañantes", cuando: "Cuando el cliente invita a su mesa desde la confirmación." },
];
export const nombrePlantilla = (id: string) => TIPOS_PLANTILLA.find((t) => t.id === id)?.texto ?? id;

export const CANALES: { id: string; texto: string }[] = [
  { id: "email", texto: "Email" },
  { id: "sms", texto: "SMS" },
  { id: "whatsapp", texto: "WhatsApp" },
];

/** Variables que admite reservas_renderizar (las sustituye el envío real). */
export const VARIABLES_PLANTILLA: { clave: string; texto: string }[] = [
  { clave: "nombre", texto: "Nombre del cliente" },
  { clave: "nombre_completo", texto: "Nombre y apellidos" },
  { clave: "restaurante", texto: "Nombre del restaurante" },
  { clave: "fecha", texto: "Fecha de la reserva" },
  { clave: "hora", texto: "Hora" },
  { clave: "pax", texto: "Personas" },
  { clave: "localizador", texto: "Localizador" },
  { clave: "enlace", texto: "Enlace de gestión" },
  { clave: "enlace_confirmar", texto: "Enlace para confirmar" },
  { clave: "enlace_cancelar", texto: "Enlace para cancelar" },
  { clave: "enlace_pago", texto: "Enlace de pago" },
  { clave: "enlace_valorar", texto: "Enlace de valoración" },
  { clave: "direccion", texto: "Dirección del restaurante" },
  { clave: "telefono", texto: "Teléfono del restaurante" },
  { clave: "mensaje", texto: "Mensaje del widget" },
  { clave: "importe", texto: "Importe (garantía o prepago)" },
  { clave: "horas_politica", texto: "Horas de la política de cancelación" },
];

/* ==================== Datos ==================== */

export type TramoDuracion = { desde: number; hasta: number | null; min: number };
type Json = Tables<"reservas_restaurantes">["duracion_por_pax"];

/** {"1-2":90,"3-4":120,"9+":180} → tramos ordenados. */
export function tramosDeJson(j: Json | null | undefined): TramoDuracion[] {
  if (!j || typeof j !== "object" || Array.isArray(j)) return [];
  const out: TramoDuracion[] = [];
  for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
    const min = parseInt(String(v), 10);
    if (!Number.isFinite(min) || min <= 0) continue;
    if (k.endsWith("+")) out.push({ desde: parseInt(k.slice(0, -1), 10) || 1, hasta: null, min });
    else if (k.includes("-")) {
      const [a, b] = k.split("-");
      out.push({ desde: parseInt(a, 10) || 1, hasta: parseInt(b, 10) || 1, min });
    } else out.push({ desde: parseInt(k, 10) || 1, hasta: parseInt(k, 10) || 1, min });
  }
  return out.sort((a, b) => a.desde - b.desde);
}

export const TRAMOS_DEFECTO: TramoDuracion[] = [
  { desde: 1, hasta: 2, min: 90 },
  { desde: 3, hasta: 4, min: 120 },
  { desde: 5, hasta: 8, min: 150 },
  { desde: 9, hasta: null, min: 180 },
];

/** "13:30:00" → "13:30" */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

/** Días [1..7] → "L M X J V S D" o "todos" */
export function textoDias(ds: number[] | null | undefined): string {
  if (!ds || !ds.length || ds.length === 7) return "todos los días";
  return ds.map((d) => DIAS_SEMANA[d - 1]).join(" ");
}

export const fmtEuros = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);

const HEX = /^#[0-9A-Fa-f]{6}$/;
export const esHex = (s: string) => HEX.test(s);

/** Paleta rápida para etiquetas, turnos, camareros… (los mismos tonos que los estados). */
export const PALETA = ["#2E9E5B", "#16A34A", "#1D6B3E", "#2F80ED", "#1F4E9E", "#7C3AED", "#D64D8A", "#D32F2F", "#F26B1D", "#D99A1E", "#8A9199", "#4B5057", "#0F6E56", "#2FA886", "#6b3d2e", "#4db6ac"];

/** Texto legible sobre un fondo hex. */
export function textoSobre(hex: string): "#fff" | "#1a1a1a" {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return "#1a1a1a";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#1a1a1a" : "#fff";
}

/* ==================== Hooks ==================== */

/** Ejecuta una acción de servidor con estado «guardando»; avisa del error o del texto de éxito. */
export function useAccion(avisar: (m: string) => void) {
  const [ocupado, setOcupado] = useState(false);
  async function correr<T>(p: Promise<Resultado<T>>, exito?: string): Promise<Resultado<T>> {
    setOcupado(true);
    try {
      const r = await p;
      if (!r.ok) avisar(r.error || "No se ha podido guardar. Revisa la conexión.");
      else if (exito) avisar(exito);
      return r;
    } catch {
      avisar("No se ha podido guardar. Revisa la conexión.");
      return { ok: false, error: "red" };
    } finally {
      setOcupado(false);
    }
  }
  return { ocupado, correr };
}

/* Pila de manejadores de Esc: solo actúa el último abierto (un Confirmar encima de un ModalForm
   cierra solo el Confirmar). Un único listener en captura que corta la propagación. */
const pilaEsc: { fn: () => void }[] = [];
function alPulsarEsc(e: KeyboardEvent) {
  if (e.key !== "Escape" || !pilaEsc.length) return;
  e.stopImmediatePropagation();
  e.stopPropagation();
  pilaEsc[pilaEsc.length - 1].fn();
}

/** Esc ejecuta el callback (cerrar modales, cancelar edición). */
export function useEsc(fn: (() => void) | null | undefined) {
  const ref = useRef(fn);
  ref.current = fn;
  const activo = !!fn;
  useEffect(() => {
    if (!activo) return;
    // La entrada lee siempre la última versión del callback: re-renderizar no la mueve en la pila.
    const entrada = { fn: () => ref.current?.() };
    if (!pilaEsc.length) window.addEventListener("keydown", alPulsarEsc, true);
    pilaEsc.push(entrada);
    return () => {
      const i = pilaEsc.indexOf(entrada);
      if (i >= 0) pilaEsc.splice(i, 1);
      if (!pilaEsc.length) window.removeEventListener("keydown", alPulsarEsc, true);
    };
  }, [activo]);
}

/** Avisa a Ajustes de si la subpantalla tiene cambios sin guardar (y de que ya no, al desmontarse). */
export function useSucio(onSucio: (b: boolean) => void, cambios: boolean) {
  useEffect(() => { onSucio(cambios); }, [onSucio, cambios]);
  useEffect(() => () => onSucio(false), [onSucio]);
}

/* ==================== Componentes ==================== */

export function Cabecera({ titulo, texto, children }: { titulo: string; texto?: string; children?: ReactNode }) {
  return (
    <div className="aj-cab">
      <div>
        <h2 className="aj-titulo">{titulo}</h2>
        {texto ? <p className="aj-sub">{texto}</p> : null}
      </div>
      {children ? <div className="aj-cab-acciones">{children}</div> : null}
    </div>
  );
}

export function Panel({ titulo, texto, children, className }: { titulo?: string; texto?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`aj-panel${className ? ` ${className}` : ""}`}>
      {titulo ? (
        <div className="aj-panel-cab">
          <h3>{titulo}</h3>
          {texto ? <p>{texto}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Etiqueta + control. `ancho` = columnas de la rejilla (1 por defecto; "todo" ocupa la fila). */
export function Campo({ label, ayuda, ancho, children }: { label: string; ayuda?: string; ancho?: 1 | 2 | "todo"; children: ReactNode }) {
  return (
    <div className={`aj-campo${ancho === 2 ? " ancho2" : ancho === "todo" ? " todo" : ""}`}>
      <span className="aj-label">{label}</span>
      {children}
      {ayuda ? <span className="aj-ayuda">{ayuda}</span> : null}
    </div>
  );
}

export function Interruptor({ on, onChange, texto, disabled, pequeno }: { on: boolean; onChange: (v: boolean) => void; texto?: string; disabled?: boolean; pequeno?: boolean }) {
  return (
    <label className={`aj-int${on ? " on" : ""}${disabled ? " off" : ""}${pequeno ? " mini" : ""}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="aj-int-pista"><span className="aj-int-bola" /></span>
      {texto ? <span className="aj-int-txt">{texto}</span> : null}
    </label>
  );
}

export function Boton({ children, tipo = "sec", onClick, disabled, submit, title, className }: {
  children: ReactNode;
  tipo?: "primario" | "sec" | "peligro" | "fantasma";
  onClick?: () => void;
  disabled?: boolean;
  submit?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button type={submit ? "submit" : "button"} className={`aj-btn ${tipo}${className ? ` ${className}` : ""}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

/** Selector de color: muestra de color + paleta + hex editable. */
export function ColorCampo({ valor, onChange, permitirVacio, disabled }: { valor: string | null; onChange: (v: string | null) => void; permitirVacio?: boolean; disabled?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [hex, setHex] = useState(valor ?? "");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setHex(valor ?? ""); }, [valor]);
  useEffect(() => {
    if (!abierto) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [abierto]);
  return (
    <div className="aj-color" ref={ref}>
      <button type="button" className="aj-color-muestra" disabled={disabled} onClick={() => setAbierto((a) => !a)} aria-label="Elegir color"
        style={{ background: valor ?? "transparent", borderStyle: valor ? "solid" : "dashed" }} />
      <input
        value={hex}
        disabled={disabled}
        placeholder={permitirVacio ? "automático" : "#RRGGBB"}
        maxLength={7}
        onChange={(e) => {
          const v = e.target.value.trim();
          setHex(v);
          if (esHex(v)) onChange(v.toUpperCase());
          else if (!v && permitirVacio) onChange(null);
        }}
      />
      {abierto ? (
        <div className="aj-color-paleta">
          {PALETA.map((c) => (
            <button key={c} type="button" style={{ background: c }} className={valor === c ? "sel" : ""} onClick={() => { onChange(c); setAbierto(false); }} aria-label={c} />
          ))}
          {permitirVacio ? <button type="button" className="vacio" onClick={() => { onChange(null); setAbierto(false); }}>Sin color</button> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Botones de día de la semana (1 = lunes). */
export function DiasCampo({ valor, onChange, disabled }: { valor: number[]; onChange: (v: number[]) => void; disabled?: boolean }) {
  return (
    <div className="aj-dias">
      {DIAS_SEMANA.map((d, i) => {
        const n = i + 1;
        const on = valor.includes(n);
        return (
          <button key={d} type="button" className={on ? "on" : ""} disabled={disabled} title={DIAS_LARGOS[i]}
            onClick={() => onChange(on ? valor.filter((x) => x !== n) : [...valor, n].sort())}>
            {d}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({ color, children, title }: { color: string; children: ReactNode; title?: string }) {
  return <span className="aj-chip" style={{ background: color, color: textoSobre(color) }} title={title}>{children}</span>;
}

export function Vacio({ children }: { children: ReactNode }) {
  return <div className="aj-vacio">{children}</div>;
}

/** Confirmación modal (sin confirm() del navegador). Enter confirma, Esc cancela. */
export function Confirmar({ texto, detalle, confirmarTexto = "Sí, adelante", peligro, onSi, onNo, ocupado }: {
  texto: string;
  detalle?: string;
  confirmarTexto?: string;
  peligro?: boolean;
  onSi: () => void;
  onNo: () => void;
  ocupado?: boolean;
}) {
  useEsc(onNo);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="rsp-modal" onClick={(e) => { if (e.target === e.currentTarget) onNo(); }}>
      <div className="modal aj-confirm" role="dialog" aria-modal="true">
        <p className="aj-confirm-txt">{texto}</p>
        {detalle ? <p className="aj-confirm-det">{detalle}</p> : null}
        <div className="aj-confirm-botones">
          <Boton tipo="fantasma" onClick={onNo} disabled={ocupado}>Cancelar</Boton>
          <button ref={ref} type="button" className={`aj-btn ${peligro ? "peligro" : "primario"}`} onClick={onSi} disabled={ocupado}>{confirmarTexto}</button>
        </div>
      </div>
    </div>
  );
}

/** Modal de edición con título y pie de botones; Enter (en el form) guarda y Esc cierra.
    Con `soloLectura`, los campos van desactivados y no hay botón de guardar. */
export function ModalForm({ titulo, children, onCerrar, onGuardar, guardarTexto = "Guardar", ocupado, ancho, extra, soloLectura }: {
  titulo: string;
  children: ReactNode;
  onCerrar: () => void;
  onGuardar: () => void;
  guardarTexto?: string;
  ocupado?: boolean;
  ancho?: number;
  /** Botón extra a la izquierda del pie (p. ej. «Borrar»). */
  extra?: ReactNode;
  soloLectura?: boolean;
}) {
  useEsc(onCerrar);
  return (
    <div className="rsp-modal" onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <form
        className="modal aj-modal"
        style={ancho ? { maxWidth: ancho } : undefined}
        role="dialog"
        aria-modal="true"
        onSubmit={(e) => { e.preventDefault(); if (!ocupado && !soloLectura) onGuardar(); }}
      >
        <div className="aj-modal-cab">
          <h2>{titulo}</h2>
          <button type="button" className="aj-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
        <div className="aj-modal-cuerpo">
          {soloLectura ? <div className="aj-aviso">Solo lectura: no tienes permiso para cambiar esto.</div> : null}
          <fieldset className="aj-fieldset" disabled={soloLectura}>{children}</fieldset>
        </div>
        <div className="aj-modal-pie">
          <div className="aj-modal-extra">{soloLectura ? null : extra}</div>
          <Boton tipo="fantasma" onClick={onCerrar}>{soloLectura ? "Cerrar" : "Cancelar"}</Boton>
          {soloLectura ? null : <Boton tipo="primario" submit disabled={ocupado}>{ocupado ? "Guardando…" : guardarTexto}</Boton>}
        </div>
      </form>
    </div>
  );
}

/** Barra fija al pie con «Guardar» cuando hay cambios pendientes. */
export function PieGuardar({ cambios, ocupado, onGuardar, onDescartar }: { cambios: boolean; ocupado: boolean; onGuardar: () => void; onDescartar: () => void }) {
  if (!cambios) return null;
  return (
    <div className="aj-pie">
      <span>Hay cambios sin guardar.</span>
      <Boton tipo="fantasma" onClick={onDescartar} disabled={ocupado}>Descartar</Boton>
      <Boton tipo="primario" onClick={onGuardar} disabled={ocupado}>{ocupado ? "Guardando…" : "Guardar cambios"}</Boton>
    </div>
  );
}

/** Aviso de solo lectura. */
export function SoloLectura() {
  return <div className="aj-aviso">Solo lectura: pide a dirección el permiso de ajustes para cambiar esta configuración.</div>;
}
