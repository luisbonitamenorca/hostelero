"use client";

/* Pantalla DÍA (guía §2): fila de turnos + chips de estado, lista a la izquierda y plano a
   la derecha. Es la pantalla que la sala tiene abierta todo el servicio: sondeo cada 60 s (y
   al volver a la pestaña), Esc cierra, popover de acciones rápidas, menú de mesa libre
   (walk-in, nueva, asignar, sentar desde la lista de espera), drag & drop de la lista al
   plano, cupos/bloqueos/nota del día, exportar CSV e imprimir. Las flechas ←/→ las lleva la
   barra (PanelReservas). El turno se sincroniza con la barra por "rsv:turno". */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tables } from "@hostelero/db";
import * as api from "../acciones/dia";
import type { DiaCompleto, ReservaDia } from "../acciones/dia";
import { ocupacionMesas } from "../acciones/reserva";
import { sentar as sentarDesdeEspera } from "../acciones/espera";
import { dowDe, hoyISO, telWA, turnoDe, type Espera, type Mesa, type Reserva, type Sala, type Turno } from "../tipos";
import {
  ESTADO,
  ESTADOS,
  ESTADOS_EN_SALA,
  ESTADOS_VIVOS,
  anunciarTurno,
  colorTexto,
  fmtFecha,
  fmtFechaLarga,
  fmtHora,
  guardarPref,
  irATab,
  leerPref,
  pedirRecarga,
  useRecargaExterna,
  useTurnoActivo,
  type SecProps,
  type Tema,
  nombreCliente,
} from "../lib-reservas";
import { Plano, type PlanoReserva } from "../componentes/plano";
import { ModalReserva } from "../componentes/modal-reserva";
import { PopoverReserva } from "../componentes/popover-reserva";
import { Icono, ListaReservas } from "../componentes/lista-reservas";
import "./dia.css";

/* ==================== Tipos locales ==================== */

type Filtro = "todas" | "confirmadas" | "pendientes" | "espera" | "llegadas" | string;
type Popover = { reserva: ReservaDia; x: number; y: number } | null;
/** Menú de una mesa: varias reservas para elegir, o mesa libre con sus opciones. */
type MenuMesaEstado = { mesaId: string; reservas: ReservaDia[]; x: number; y: number } | null;
type Modal = { reserva: Reserva | null; mesaInicial?: string | null; horaInicial?: string | null } | null;
type Panel = "cupos" | "bloqueos" | null;
type Confirmar = { texto: string; si: () => Promise<void> } | null;
type Desplazar = { reserva: ReservaDia } | null;
type Bloqueo = Tables<"reservas_bloqueos">;

const SONDEO_MS = 60000;

/* ==================== Helpers puros ==================== */

const ahoraHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const min = (h: string) => { const [a, b] = h.slice(0, 5).split(":").map(Number); return a * 60 + b; };
const mesasDe = (r: Reserva) => {
  const ids = (r.reservas_reserva_mesas || []).map((x) => x.mesa_id);
  if (r.mesa_id && !ids.includes(r.mesa_id)) ids.unshift(r.mesa_id);
  return ids;
};
/** Una reserva es del turno si lleva su id o, sin turno, si su hora cae en la franja. */
const deTurno = (r: Reserva, t: Turno) =>
  r.turno_id ? r.turno_id === t.id : fmtHora(r.hora) >= fmtHora(t.hora_inicio) && fmtHora(r.hora) <= fmtHora(t.hora_fin);
const solapan = (h1: string, d1: number, h2: string, d2: number) => {
  const a = min(h1), b = min(h2);
  return a < b + d2 && b < a + d1;
};
const pax = (xs: Reserva[]) => xs.reduce((a, r) => a + r.pax, 0);

/** Bloqueo que afecta a una mesa: el de la propia mesa, el de su sala entera o el de todo el
    restaurante (mesa_id y sala_id null). Con `hora`, solo si la franja [hora, hora+dur) se
    solapa con la del bloqueo. */
export function bloqueoDe(bloqueos: Bloqueo[], mesa: Pick<Mesa, "id" | "sala_id"> | undefined | null, hora?: string, dur = 120): Bloqueo | undefined {
  if (!mesa) return undefined;
  return bloqueos.find((b) => {
    const toca = b.mesa_id ? b.mesa_id === mesa.id : b.sala_id ? b.sala_id === mesa.sala_id : true;
    if (!toca) return false;
    if (hora == null) return true;
    return solapan(b.hora_inicio, Math.max(1, min(b.hora_fin) - min(b.hora_inicio)), hora, dur);
  });
}
const textoBloqueo = (b: Bloqueo) => `de ${fmtHora(b.hora_inicio)} a ${fmtHora(b.hora_fin)}${b.motivo ? ` (${b.motivo})` : ""}`;

/** Turno por defecto de un día: hoy, el que sigue en servicio; si no, el primero. */
function turnoPorDefecto(turnosDia: Turno[], esHoy: boolean, ahora: string): string {
  let elegido = turnosDia[0]?.id ?? "dia";
  if (esHoy) {
    const enCurso = turnosDia.find((t) => ahora <= fmtHora(t.fin_servicio ?? t.hora_fin));
    if (enCurso) elegido = enCurso.id;
  }
  return elegido;
}

/** Mensaje de WhatsApp para pedir confirmación, en el idioma del cliente (es por defecto).
    Cuando el agente de mensajes cargue la plantilla whatsapp/«confirmacion» de
    reservas_plantillas, este texto pasa a ser solo el de reserva. */
function textoWhatsApp(idioma: string | null | undefined, d: { nombre: string; rest: string; fecha: string; hora: string; pax: number; loc: string }) {
  const loc = d.loc ? ` (${d.loc})` : "";
  switch ((idioma || "es").slice(0, 2).toLowerCase()) {
    case "en":
      return `Hello ${d.nombre}, this is ${d.rest}. Your booking is on ${d.fecha} at ${d.hora} for ${d.pax}${loc}. Could you please confirm it? Thank you.`;
    case "fr":
      return `Bonjour ${d.nombre}, ici ${d.rest}. Votre réservation est le ${d.fecha} à ${d.hora} pour ${d.pax} personnes${loc}. Pouvez-vous la confirmer ? Merci.`;
    case "de":
      return `Hallo ${d.nombre}, hier ist ${d.rest}. Ihre Reservierung ist am ${d.fecha} um ${d.hora} für ${d.pax} Personen${loc}. Können Sie sie bitte bestätigen? Danke.`;
    case "ca":
      return `Hola ${d.nombre}, us escrivim de ${d.rest}. La vostra reserva és el ${d.fecha} a les ${d.hora} per a ${d.pax} persones${loc}. Ens la confirmeu? Gràcies.`;
    default:
      return `Hola ${d.nombre}, te escribimos de ${d.rest}. Tu reserva es el ${d.fecha} a las ${d.hora} para ${d.pax} personas${loc ? ` (localizador ${d.loc})` : ""}. ¿Nos la confirmas? Gracias.`;
  }
}

/** Tema actual leído del contenedor .rv (lo cambia la barra; aquí solo se observa). */
function useTemaDom(ref: React.RefObject<HTMLElement | null>): Tema {
  const [tema, setTema] = useState<Tema>("oscuro");
  useEffect(() => {
    const rv = ref.current?.closest(".rv") as HTMLElement | null;
    if (!rv) return;
    const leer = () => setTema(rv.getAttribute("data-tema") === "claro" ? "claro" : "oscuro");
    leer();
    const obs = new MutationObserver(leer);
    obs.observe(rv, { attributes: true, attributeFilter: ["data-tema"] });
    return () => obs.disconnect();
  }, [ref]);
  return tema;
}

/* ==================== Sección ==================== */

export default function SecDia({ rest, fecha, setFecha, avisar }: SecProps) {
  const restId = rest.id;
  const raiz = useRef<HTMLDivElement>(null);
  const tema = useTemaDom(raiz);

  const [datos, setDatos] = useState<DiaCompleto | null>(null);
  const [cargando, setCargando] = useState(true);
  // Turno: "" = sin elegir (se usa el de por defecto), "dia" = día completo, o id de turno.
  // Arranca con el último que anunció la barra para no abrir en otro turno.
  const turnoBarra = useTurnoActivo();
  const [turnoSel, setTurnoSel] = useState<string>(() => turnoBarra ?? "");
  // Turno por defecto fijado una vez por restaurante y día (no salta solo al pasar la hora).
  const [turnoAuto, setTurnoAuto] = useState<{ clave: string; id: string } | null>(null);
  const eco = useRef(false);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [menuMas, setMenuMas] = useState(false);
  const [salaSel, setSalaSel] = useState<string>(() => leerPref(`dia:sala:${restId}`, ""));
  const [mesaSel, setMesaSel] = useState<string | null>(null);
  const [popover, setPopover] = useState<Popover>(null);
  const [menuMesa, setMenuMesa] = useState<MenuMesaEstado>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [confirmar, setConfirmar] = useState<Confirmar>(null);
  const [desplazar, setDesplazar] = useState<Desplazar>(null);
  const [walkin, setWalkin] = useState<{ mesaId: string } | null>(null);
  const [vista, setVista] = useState<"lista" | "plano">(() => leerPref("dia:vista", "lista"));
  const [leyenda, setLeyenda] = useState<boolean>(() => leerPref("dia:leyenda", false));
  const [ahora, setAhora] = useState(ahoraHHMM());
  const modalAbierto = useRef(false);
  modalAbierto.current = !!modal || !!panel || !!desplazar || !!walkin;
  const clave = `${restId}|${fecha}`;

  /* ---- carga ---- */
  // Cada petición lleva un número: solo la última pinta. Así una respuesta lenta del día
  // anterior (o un sondeo en vuelo) no aparece bajo la fecha nueva.
  const peticion = useRef(0);
  const recargar = useCallback(async (silencioso = false) => {
    const n = ++peticion.current;
    if (!silencioso) setCargando(true);
    try {
      const d = await api.cargarDiaCompleto(restId, fecha);
      if (n !== peticion.current) return;
      setDatos(d);
    } catch {
      // Se conservan los datos que hubiera: mejor algo de hace un minuto que una lista vacía.
      if (n === peticion.current) avisar("No se ha podido cargar el día. Revisa la conexión.");
    } finally {
      if (n === peticion.current) setCargando(false);
    }
  }, [restId, fecha, avisar]);

  // Al cambiar de día o de restaurante, fuera los datos del anterior: el spinner tapa la
  // pantalla y no se puede tocar una mesa con datos de otro día.
  useEffect(() => {
    setDatos(null);
    setPopover(null);
    setMenuMesa(null);
    setMesaSel(null);
    setDesplazar(null);
    setWalkin(null);
  }, [restId, fecha]);

  useEffect(() => { recargar(); }, [recargar]);

  // Sondeo de 60 s (sin realtime). No se recarga con un modal abierto para no pisar lo que se edita.
  useEffect(() => {
    const t = setInterval(() => {
      setAhora(ahoraHHMM());
      if (!document.hidden && !modalAbierto.current) recargar(true);
    }, SONDEO_MS);
    // Al volver a la pestaña (iPad desbloqueado), al momento: es cuando se va a sentar a alguien.
    const alVolver = () => {
      if (document.visibilityState !== "visible") return;
      setAhora(ahoraHHMM());
      if (!modalAbierto.current) recargar(true);
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [recargar]);

  useRecargaExterna(useCallback(() => { recargar(true); }, [recargar]));

  // La barra publica el turno en "rsv:turno" (detail = id | null). null = sin selección en la
  // barra: se vuelve al turno por defecto (el que está en servicio), no a «día completo».
  // Los anuncios que hace esta misma pantalla se ignoran (eco).
  useEffect(() => {
    const h = (e: Event) => {
      if (eco.current) return;
      const id = (e as CustomEvent<string | null>).detail;
      if (typeof id === "string" && id) setTurnoSel(id);
      else { setTurnoSel(""); setTurnoAuto(null); }
    };
    window.addEventListener("rsv:turno", h);
    return () => window.removeEventListener("rsv:turno", h);
  }, []);

  /** Elegir turno desde esta pantalla: se guarda y se anuncia a la barra y al resto
      («día completo» se anuncia como null). */
  function elegirTurno(v: string) {
    setTurnoSel(v);
    eco.current = true;
    try { anunciarTurno(v === "dia" ? null : v); } finally { eco.current = false; }
  }

  // Esc cierra lo que esté abierto. Las flechas ←/→ las gestiona la barra.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setPopover(null); setMenuMesa(null); setMenuMas(false); setConfirmar(null); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  /* ---- derivados ---- */
  const reservas = useMemo(() => datos?.reservas ?? [], [datos]);
  const salas = useMemo(() => datos?.salas ?? [], [datos]);
  const turnos = useMemo(() => datos?.turnos ?? [], [datos]);
  const bloqueos = useMemo(() => datos?.bloqueos ?? [], [datos]);
  const esHoy = fecha === hoyISO();
  const dow = dowDe(fecha);
  const turnosDia = useMemo(() => turnos.filter((t) => t.activo && (t.dias_semana || []).includes(dow)), [turnos, dow]);

  // Turno por defecto: se calcula una vez cuando llegan los datos de ese día.
  useEffect(() => {
    if (!datos || turnoAuto?.clave === clave) return;
    setTurnoAuto({ clave, id: turnoPorDefecto(turnosDia, fecha === hoyISO(), ahoraHHMM()) });
  }, [datos, clave, turnoAuto, turnosDia, fecha]);

  const turnoActivo: string = useMemo(() => {
    if (turnoSel === "dia") return "dia";
    if (turnoSel && turnosDia.some((t) => t.id === turnoSel)) return turnoSel;
    if (turnoAuto?.clave === clave && (turnoAuto.id === "dia" || turnosDia.some((t) => t.id === turnoAuto.id))) return turnoAuto.id;
    return turnosDia[0]?.id ?? "dia";
  }, [turnoSel, turnosDia, turnoAuto, clave]);
  const turno = turnoActivo === "dia" ? null : turnosDia.find((t) => t.id === turnoActivo) ?? null;

  /** Reservas del turno (todas las de la pestaña, sin filtro de estado). */
  const delTurno = useMemo(() => (turno ? reservas.filter((r) => deTurno(r, turno)) : reservas), [reservas, turno]);
  const vivas = useMemo(() => delTurno.filter((r) => ESTADOS_VIVOS.includes(r.estado)), [delTurno]);
  /** Vivas del día entero (para conflictos de mesa: una reserva de otro turno también ocupa). */
  const vivasDia = useMemo(() => reservas.filter((r) => ESTADOS_VIVOS.includes(r.estado)), [reservas]);

  const grupos = useMemo(() => {
    const g = (f: (r: Reserva) => boolean) => delTurno.filter(f);
    return {
      todas: g((r) => !["cancelada", "no_show"].includes(r.estado)),
      confirmadas: g((r) => r.estado === "confirmada" || r.estado === "reconfirmada"),
      pendientes: g((r) => r.estado === "pendiente" || r.estado === "tarjeta_pendiente"),
      espera: g((r) => r.estado === "lista_espera"),
      llegadas: g((r) => ESTADOS_EN_SALA.includes(r.estado)),
    };
  }, [delTurno]);
  const esperando = useMemo(() => (datos?.espera ?? []).filter((e) => e.estado === "esperando" || e.estado === "avisado"), [datos]);
  const enEspera = esperando.filter((e) => e.estado === "esperando").length;

  const filtradas = useMemo(() => {
    if (filtro in grupos) return grupos[filtro as keyof typeof grupos];
    return delTurno.filter((r) => r.estado === filtro);
  }, [filtro, grupos, delTurno]);

  const mesas: Mesa[] = useMemo(() => salas.flatMap((s) => s.mesas || []), [salas]);
  const salasActivas = useMemo(() => salas.filter((s) => s.activa), [salas]);

  /** Mesas ocupadas por sala en el turno (para las pestañas «TERRAZA (10/24)»). */
  const ocupadasPorSala = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const r of vivas) for (const id of mesasDe(r)) {
      const mesa = mesas.find((x) => x.id === id);
      if (!mesa) continue;
      (m[mesa.sala_id] = m[mesa.sala_id] || new Set()).add(id);
    }
    return m;
  }, [vivas, mesas]);

  const sala: Sala | null = useMemo(() => {
    if (salaSel && salasActivas.some((s) => s.id === salaSel)) return salasActivas.find((s) => s.id === salaSel)!;
    return salasActivas.find((s) => (ocupadasPorSala[s.id]?.size ?? 0) > 0) ?? salasActivas[0] ?? null;
  }, [salaSel, salasActivas, ocupadasPorSala]);

  const reservasPorMesa = useMemo(() => {
    const m: Record<string, PlanoReserva[]> = {};
    const nombreEtq: Record<string, string> = {};
    for (const e of datos?.etiquetas ?? []) nombreEtq[e.id] = e.nombre;
    for (const r of vivas) {
      const p: PlanoReserva = {
        id: r.id, hora: r.hora, pax: r.pax, estado: r.estado, duracion_min: r.duracion_min, mesa_id: r.mesa_id,
        nombre: nombreCliente(r).nombre, apellidos: nombreCliente(r).apellidos,
        etiquetas: (r.etiquetas || []).map((id) => nombreEtq[id]).filter(Boolean),
        origen: r.origen, canal: r.canal, notas: r.notas_cliente ?? r.notas_internas ?? null, telefono: r.reservas_clientes?.telefono ?? null,
      };
      for (const id of mesasDe(r)) (m[id] = m[id] || []).push(p);
    }
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.hora < b.hora ? -1 : 1));
    return m;
  }, [vivas, datos?.etiquetas]);

  /** Bloqueos que tocan el turno (o todos en «día completo»). */
  const bloqueosTurno = useMemo(() => {
    if (!turno) return bloqueos;
    return bloqueos.filter((b) => fmtHora(b.hora_inicio) < fmtHora(turno.fin_servicio ?? turno.hora_fin) && fmtHora(b.hora_fin) > fmtHora(turno.hora_inicio));
  }, [bloqueos, turno]);

  /** Reservas vivas del turno sin mesa (para «Asignar reserva sin mesa…»). */
  const sinMesa = useMemo(() => vivas.filter((r) => mesasDe(r).length === 0), [vivas]);

  const cupoDe = (turnoId: string | null) => (datos?.cupos ?? []).find((c) => (turnoId ? c.turno_id === turnoId : c.turno_id == null));
  /** Turno cerrado por cupo (del turno o del día) o por cierre (del turno o del día), como la barra. */
  const turnoCerrado = (turnoId: string) =>
    !!cupoDe(turnoId)?.cerrado || !!cupoDe(null)?.cerrado || (datos?.cierres ?? []).some((c) => c.turno_id === null || c.turno_id === turnoId);
  const nota = datos?.notas_dia?.[datos.notas_dia.length - 1]?.texto ?? "";

  /* ---- acciones ---- */
  /** Ejecuta una acción y, si va bien, pide recarga a todos (el Día escucha "rsv:recargar"
      y la barra actualiza sus contadores y el interruptor de cupo). */
  async function correr(p: Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    let r: { ok: boolean; error?: string };
    try {
      r = await p;
    } catch {
      r = { ok: false };
    }
    if (!r.ok) { avisar(r.error || "No se ha podido guardar. Revisa la conexión."); return false; }
    if (okMsg) avisar(okMsg);
    pedirRecarga();
    return true;
  }

  function abrirPopover(r: ReservaDia, ev: { x: number; y: number }) {
    setMenuMesa(null);
    setMesaSel(mesasDe(r)[0] ?? null);
    setPopover({ reserva: r, x: ev.x, y: ev.y });
  }
  function cerrarPopover() { setPopover(null); setMesaSel(null); }

  /** Hora propuesta para una reserva nueva: hoy y dentro del turno, la actual redondeada al
      cuarto; si no, el inicio del turno activo (o del primero del día). */
  function horaInicialDe() {
    const t = turno ?? turnosDia[0];
    if (!t) return null;
    if (esHoy && ahora >= fmtHora(t.hora_inicio) && ahora <= fmtHora(t.hora_fin)) {
      const m = Math.ceil(min(ahora) / 15) * 15;
      return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    }
    return fmtHora(t.hora_inicio);
  }

  const reservasDeMesa = (mesaId: string) =>
    (reservasPorMesa[mesaId] ?? []).map((p) => reservas.find((r) => r.id === p.id)).filter((r): r is ReservaDia => !!r);
  const mesaPorId = (id: string | null | undefined) => (id ? mesas.find((m) => m.id === id) : undefined);
  const nombreMesa = (m: Mesa | undefined) => m?.etiqueta || m?.nombre || "";

  function onMesaClick(mesaId: string, ev: { x: number; y: number }) {
    setPopover(null);
    const rs = reservasDeMesa(mesaId);
    if (rs.length === 1) { abrirPopover(rs[0], ev); return; }
    setMesaSel(mesaId);
    if (rs.length > 1) { setMenuMesa({ mesaId, reservas: rs, x: ev.x, y: ev.y }); return; }
    const bloqueo = bloqueoDe(bloqueosTurno, mesaPorId(mesaId));
    if (bloqueo) {
      avisar(`${bloqueo.mesa_id ? "Mesa bloqueada" : bloqueo.sala_id ? "Sala bloqueada" : "Restaurante bloqueado"} ${textoBloqueo(bloqueo)}.`);
      setPanel("bloqueos");
      return;
    }
    // Mesa libre: walk-in, nueva, asignar una sin mesa o sentar desde la lista de espera.
    setMenuMesa({ mesaId, reservas: [], x: ev.x, y: ev.y });
  }

  function onMesaDoble(mesaId: string) {
    setPopover(null);
    setMesaSel(mesaId);
    const rs = reservasDeMesa(mesaId);
    if (rs.length === 1) { setMenuMesa(null); setModal({ reserva: rs[0] }); return; }
    if (rs.length > 1) {
      // Sin coordenadas del doble clic: se coloca en el centro del lienzo.
      const b = raiz.current?.querySelector(".dia-plano-lienzo")?.getBoundingClientRect();
      setMenuMesa({ mesaId, reservas: rs, x: b ? b.left + b.width / 2 : window.innerWidth / 2, y: b ? b.top + 40 : 120 });
      return;
    }
    const bloqueo = bloqueoDe(bloqueosTurno, mesaPorId(mesaId));
    if (bloqueo) { avisar(`Mesa bloqueada ${textoBloqueo(bloqueo)}.`); return; }
    setMenuMesa(null);
    setModal({ reserva: null, mesaInicial: mesaId, horaInicial: horaInicialDe() });
  }

  async function onReservaDrop(reservaId: string, mesaId: string) {
    const r = reservas.find((x) => x.id === reservaId);
    if (!r) return;
    const ya = mesasDe(r);
    if (ya.length === 1 && ya[0] === mesaId) return;
    const mesa = mesaPorId(mesaId);
    const dur = r.duracion_min || 120;
    const hacer = () => correr(api.asignarMesa(reservaId, [mesaId]), `Reserva movida a la mesa ${nombreMesa(mesa)}.`);
    // Avisos en orden de gravedad; se encadenan para que cada «sí» pase al siguiente.
    const avisos: string[] = [];
    const bloqueo = bloqueoDe(bloqueos, mesa, r.hora, dur);
    if (bloqueo) avisos.push(`La mesa ${nombreMesa(mesa)} está bloqueada ${textoBloqueo(bloqueo)}. ¿Asignar igualmente?`);
    const conflicto = vivasDia.find((o) => o.id !== reservaId && mesasDe(o).includes(mesaId) && solapan(o.hora, o.duracion_min || 120, r.hora, dur));
    if (conflicto) avisos.push(`La mesa ${nombreMesa(mesa)} ya tiene a ${conflicto.reservas_clientes?.nombre ?? "otra reserva"} a las ${fmtHora(conflicto.hora)}. ¿Mover igualmente?`);
    if (mesa && r.pax > mesa.cap_max) avisos.push(`La mesa ${nombreMesa(mesa)} es para ${mesa.cap_max} y la reserva es de ${r.pax}. ¿Mover igualmente?`);
    const pedir = (i: number): void => {
      if (i >= avisos.length) { void hacer(); return; }
      setConfirmar({ texto: avisos[i], si: async () => { pedir(i + 1); } });
    };
    pedir(0);
  }

  function whatsapp(r: Reserva) {
    const c = r.reservas_clientes;
    let n = telWA(c?.telefono);
    if (n.startsWith("00")) n = n.slice(2);
    if (n.length < 8) { avisar("El cliente no tiene un teléfono válido."); return; }
    const msg = textoWhatsApp(r.idioma, {
      nombre: c?.nombre ?? "", rest: rest.nombre, fecha: fmtFecha(r.fecha), hora: fmtHora(r.hora), pax: r.pax, loc: r.localizador ?? "",
    });
    window.open(`https://wa.me/${n}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  }

  async function exportarCsv() {
    // Mismo turno que la pantalla; canceladas y no-shows solo si es lo que se está mirando.
    const r = await api.exportarDiaCsv(restId, fecha, turno?.id ?? null, filtro === "cancelada" || filtro === "no_show");
    if (!r.ok || !r.data) { avisar(r.error || "No se ha podido exportar."); return; }
    const blob = new Blob([r.data], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reservas-${rest.slug || "restaurante"}-${fecha}${turno ? "-" + turno.nombre.toLowerCase() : ""}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function crearListaEspera() {
    // La pestaña Lista de espera abre su formulario al recibir "rsv:espera-nueva" (o leyendo la pref).
    guardarPref("espera:abrir", true);
    irATab("espera");
    setTimeout(() => window.dispatchEvent(new CustomEvent("rsv:espera-nueva", { detail: { fecha } })), 50);
  }

  /** Sienta una entrada de la lista de espera en la mesa (crea la reserva walk-in sentada). */
  async function sentarEspera(e: Espera, mesaId: string) {
    const hora = esHoy ? ahora : horaInicialDe() ?? ahora;
    const t = turnoDe(turnos, fecha, hora);
    const ok = await correr(sentarDesdeEspera({ id: e.id, mesaId, hora, duracionMin: 120, turnoId: t?.id ?? null }), `${e.nombre} sentado en la mesa ${nombreMesa(mesaPorId(mesaId))}.`);
    if (ok) { setMenuMesa(null); setMesaSel(null); }
  }

  function elegirSala(id: string) { setSalaSel(id); guardarPref(`dia:sala:${restId}`, id); }
  function cambiarVista(v: "lista" | "plano") { setVista(v); guardarPref("dia:vista", v); }

  /* ---- render ---- */
  if (!datos && cargando) return <div ref={raiz} className="spinner" />;
  if (!datos) return <div ref={raiz} className="vacio">No se ha podido cargar el día.</div>;

  const chip = (id: Filtro, texto: string, xs: Reserva[], color?: string) => (
    <button
      key={id}
      type="button"
      className={"dia-chip" + (filtro === id ? " activo" : "")}
      onClick={() => { setFiltro(id); setMenuMas(false); }}
    >
      {color ? <i style={{ background: color }} /> : null}
      {texto} <span>({xs.length}/{pax(xs)})</span>
    </button>
  );
  const restoEstados = ["terminada", "no_show", "cancelada", "a_revisar", "tarjeta_pendiente"];
  const filtroEnResto = restoEstados.includes(filtro);

  return (
    <div ref={raiz} className={"dia" + (cargando ? " cargando" : "")}>
      {/* cabecera solo para imprimir */}
      <div className="dia-print-cab">
        <b>{rest.nombre}</b> · {fmtFechaLarga(fecha)}{turno ? ` · ${turno.nombre}` : ""} · {filtradas.length} reservas · {pax(filtradas)} pax
      </div>

      {/* fila de turnos */}
      <div className="dia-turnos">
        <div className="dia-turnos-btns">
          {turnosDia.map((t) => {
            const xs = reservas.filter((r) => deTurno(r, t) && ESTADOS_VIVOS.includes(r.estado));
            const cerrado = turnoCerrado(t.id);
            return (
              <button key={t.id} type="button" className={"dia-turno" + (turnoActivo === t.id ? " activo" : "") + (cerrado ? " cerrado" : "")} onClick={() => elegirTurno(t.id)} aria-pressed={turnoActivo === t.id}>
                {cerrado ? <Icono nombre="prohibido" tam={11} titulo="Turno cerrado" /> : null}
                {t.nombre}
                <small>{pax(xs)} pax · {xs.length}</small>
              </button>
            );
          })}
          <button type="button" className={"dia-turno" + (turnoActivo === "dia" ? " activo" : "")} onClick={() => elegirTurno("dia")} aria-pressed={turnoActivo === "dia"}>
            Día completo<small>{pax(vivasDia)} pax</small>
          </button>
        </div>
        <div className="dia-iconos">
          <button type="button" className="dia-ico" title="Cupos del día: cerrar/abrir turnos, aforo y nota" onClick={() => setPanel("cupos")} aria-label="Cupos del día">
            <Icono nombre="calendario" tam={16} />
            {nota ? <i className="dia-ico-punto" /> : null}
          </button>
          <button type="button" className="dia-ico" title="Exportar CSV (lo que se ve en este turno, sin canceladas ni no-shows)" onClick={exportarCsv} aria-label="Exportar CSV"><Icono nombre="descargar" tam={16} /></button>
          <button type="button" className="dia-ico" title="Imprimir lista" onClick={() => window.print()} aria-label="Imprimir"><Icono nombre="imprimir" tam={16} /></button>
          <button type="button" className="dia-espera" onClick={crearListaEspera}>
            Crear lista de espera{enEspera ? <span className="dia-espera-n">{enEspera}</span> : null}
          </button>
        </div>
      </div>

      {nota ? (
        <button type="button" className="dia-nota" onClick={() => setPanel("cupos")} title="Editar nota del día">
          <Icono nombre="comentario" tam={12} /> {nota}
        </button>
      ) : null}

      {/* chips de estado */}
      <div className="dia-chips">
        {chip("todas", "Todas", grupos.todas)}
        {chip("confirmadas", "Confirmadas", grupos.confirmadas, ESTADO.confirmada.color)}
        {chip("pendientes", "Pendientes", grupos.pendientes, ESTADO.pendiente.color)}
        {chip("espera", "Lista espera", grupos.espera, ESTADO.lista_espera.color)}
        {chip("llegadas", "Llegadas", grupos.llegadas, ESTADO.llegada.color)}
        <div className="dia-mas">
          <button type="button" className={"dia-chip" + (filtroEnResto ? " activo" : "")} onClick={() => setMenuMas(!menuMas)} aria-haspopup="menu" aria-expanded={menuMas}>
            {filtroEnResto ? <><i style={{ background: ESTADO[filtro].color }} />{ESTADO[filtro].texto} <span>({filtradas.length}/{pax(filtradas)})</span></> : "⋮"}
          </button>
          {menuMas ? (
            <div className="dia-mas-menu" role="menu">
              {restoEstados.map((id) => {
                const xs = delTurno.filter((r) => r.estado === id);
                return (
                  <button key={id} type="button" role="menuitem" onClick={() => { setFiltro(id); setMenuMas(false); }}>
                    <i style={{ background: ESTADO[id].color, borderColor: ESTADO[id].borde ?? ESTADO[id].color }} />{ESTADO[id].texto} <span>({xs.length}/{pax(xs)})</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="dia-vista">
          <button type="button" className={vista === "lista" ? "activo" : ""} onClick={() => cambiarVista("lista")}>Lista</button>
          <button type="button" className={vista === "plano" ? "activo" : ""} onClick={() => cambiarVista("plano")}>Plano</button>
        </div>
      </div>

      {/* cuerpo: lista + plano */}
      <div className={"dia-cuerpo vista-" + vista}>
        <section className="dia-lista" aria-label="Lista de reservas">
          <ListaReservas
            reservas={filtradas}
            mesas={mesas}
            etiquetas={datos.etiquetas}
            seleccionada={popover?.reserva.id ?? null}
            mesaResaltada={mesaSel}
            ahora={esHoy ? ahora : undefined}
            onClick={abrirPopover}
            onDoble={(r) => { setPopover(null); setModal({ reserva: r }); }}
            vacio={turno ? `Sin reservas en ${turno.nombre.toLowerCase()} para el ${fmtFecha(fecha)}.` : `Sin reservas para el ${fmtFecha(fecha)}.`}
          />
        </section>

        <section className="dia-plano" aria-label="Plano de sala">
          <div className="dia-plano-cab">
            <div className="dia-salas" role="tablist">
              {salasActivas.map((s) => {
                const total = (s.mesas || []).filter((m) => m.activa).length;
                const ocup = ocupadasPorSala[s.id]?.size ?? 0;
                return (
                  <button key={s.id} type="button" role="tab" aria-selected={sala?.id === s.id} className={"dia-sala" + (sala?.id === s.id ? " activa" : "")} onClick={() => elegirSala(s.id)}>
                    {s.nombre}<small>({ocup}/{total})</small>
                  </button>
                );
              })}
            </div>
            <div className="dia-plano-iconos">
              <button type="button" className="dia-ico" title="Ver llegadas (en sala)" aria-label="Llegadas" onClick={() => { setFiltro("llegadas"); cambiarVista("lista"); }}>
                <Icono nombre="llegada" tam={15} />
              </button>
              <button type="button" className="dia-ico" title="Bloquear mesa o sala en una franja" aria-label="Bloqueos" onClick={() => setPanel("bloqueos")}>
                <Icono nombre="candado" tam={15} />
                {bloqueosTurno.length ? <i className="dia-ico-punto" /> : null}
              </button>
              <button type="button" className="dia-ico" title="Nueva reserva en la mesa seleccionada" aria-label="Nueva reserva" onClick={() => setModal({ reserva: null, mesaInicial: mesaSel, horaInicial: horaInicialDe() })}>
                <Icono nombre="mas" tam={15} />
              </button>
              <button type="button" className="dia-ico" title="Cronograma" aria-label="Cronograma" onClick={() => irATab("cronograma")}>
                <Icono nombre="reloj" tam={15} />
              </button>
            </div>
          </div>

          {sala ? (
            <div className="dia-plano-lienzo">
              <Plano
                sala={sala}
                objetos={(datos.objetos || []).filter((o) => o.sala_id === sala.id)}
                reservasPorMesa={reservasPorMesa}
                bloqueos={bloqueosTurno}
                seleccionada={mesaSel}
                modo="sala"
                tema={tema}
                ahora={esHoy ? ahora : undefined}
                onMesaClick={onMesaClick}
                onMesaDoble={onMesaDoble}
                onReservaDrop={onReservaDrop}
                onFondoClick={() => { if (!popover && !menuMesa) setMesaSel(null); }}
              />
            </div>
          ) : (
            <div className="vacio">Este restaurante no tiene salas activas. Créalas en Ajustes › Salas y planos.</div>
          )}

          <div className="dia-leyenda">
            <button type="button" className="dia-leyenda-btn" onClick={() => { setLeyenda(!leyenda); guardarPref("dia:leyenda", !leyenda); }} aria-expanded={leyenda}>
              Leyenda {leyenda ? "▾" : "▸"}
            </button>
            {leyenda ? (
              <>
                <div className="dia-leyenda-fila">
                  {ESTADOS.map((e) => (
                    <span key={e.id} className="dia-leyenda-pill" style={{ background: e.color, color: e.borde ? "#1a1a1a" : colorTexto(e.color), borderColor: e.borde ?? e.color }}>{e.texto}</span>
                  ))}
                </div>
                <div className="dia-leyenda-fila iconos">
                  <span><Icono nombre="campana" /> Motor web</span>
                  <span><Icono nombre="repetir" /> Canal externo</span>
                  <span><Icono nombre="doblecheck" /> Reconfirmada</span>
                  <span><Icono nombre="comentario" /> Comentario</span>
                  <span><Icono nombre="ticket" /> Prepago / experiencia</span>
                  <span><Icono nombre="tarjeta" /> Política / garantía</span>
                  <span><Icono nombre="alerta" /> Alergias</span>
                  <span><Icono nombre="estrella" /> VIP</span>
                  <span><Icono nombre="candado" /> Bloqueada</span>
                </div>
              </>
            ) : null}
          </div>
        </section>
      </div>

      {/* ====== capas ====== */}
      {popover ? (
        <PopoverReserva
          reserva={popover.reserva}
          x={popover.x}
          y={popover.y}
          cerrar={cerrarPopover}
          onEstado={async (estado, extra) => { await correr(api.cambiarEstado(popover.reserva.id, estado, extra)); }}
          onEditar={() => setModal({ reserva: popover.reserva })}
          onLiberar={async () => { await correr(api.liberar(popover.reserva.id), "Mesa liberada."); }}
          onDesplazar={() => setDesplazar({ reserva: popover.reserva })}
          onWhatsApp={() => whatsapp(popover.reserva)}
        />
      ) : null}

      {menuMesa ? (
        <MenuMesa
          x={menuMesa.x}
          y={menuMesa.y}
          reservas={menuMesa.reservas}
          mesa={mesaPorId(menuMesa.mesaId) ?? null}
          esHoy={esHoy}
          sinMesa={sinMesa}
          espera={esperando}
          cerrar={() => { setMenuMesa(null); setMesaSel(null); }}
          elegir={(r) => abrirPopover(r, { x: menuMesa.x, y: menuMesa.y })}
          nueva={() => { setMenuMesa(null); setModal({ reserva: null, mesaInicial: menuMesa.mesaId, horaInicial: horaInicialDe() }); }}
          walkin={() => { setMenuMesa(null); setWalkin({ mesaId: menuMesa.mesaId }); }}
          asignar={(r) => { setMenuMesa(null); void onReservaDrop(r.id, menuMesa.mesaId); }}
          sentarEspera={(e) => sentarEspera(e, menuMesa.mesaId)}
        />
      ) : null}

      {walkin ? (
        <WalkinBox
          mesa={mesaPorId(walkin.mesaId) ?? null}
          cerrar={() => { setWalkin(null); setMesaSel(null); }}
          crear={async (n, nombre) => {
            const ok = await correr(
              api.walkIn({ restauranteId: restId, fecha, hora: ahoraHHMM(), mesaId: walkin.mesaId, pax: n, nombre }),
              `Walk-in sentado en la mesa ${nombreMesa(mesaPorId(walkin.mesaId))}.`,
            );
            if (ok) { setWalkin(null); setMesaSel(null); }
          }}
        />
      ) : null}

      {modal ? (
        <ModalReserva
          rest={rest}
          fecha={fecha}
          turnos={turnos}
          salas={salasActivas}
          reserva={modal.reserva}
          mesaInicial={modal.mesaInicial ?? null}
          horaInicial={modal.horaInicial ?? null}
          cerrar={() => { setModal(null); setMesaSel(null); }}
          guardado={({ fecha: f }) => {
            setModal(null);
            setMesaSel(null);
            avisar(modal.reserva ? "Reserva guardada." : "Reserva creada.");
            if (f !== fecha) setFecha(f);
            else pedirRecarga();
          }}
        />
      ) : null}

      {desplazar ? (
        <DesplazarBox
          restId={restId}
          reserva={desplazar.reserva}
          salas={salasActivas}
          reservasDia={vivasDia}
          bloqueos={bloqueos}
          turnos={turnos}
          cerrar={() => setDesplazar(null)}
          guardar={async (cambios) => {
            const ok = await correr(api.desplazarReserva(desplazar.reserva.id, cambios), "Reserva desplazada.");
            if (ok) setDesplazar(null);
          }}
        />
      ) : null}

      {panel === "cupos" ? (
        <PanelCupos
          fecha={fecha}
          turnos={turnosDia}
          cupos={datos.cupos}
          nota={nota}
          mesas={mesas}
          cerrar={() => setPanel(null)}
          guardarCupo={(turnoId, v) => correr(api.guardarCupo(restId, fecha, turnoId, v), "Cupo guardado.")}
          guardarNota={(t) => correr(api.guardarNotaDia(restId, fecha, t), "Nota guardada.")}
        />
      ) : null}

      {panel === "bloqueos" ? (
        <PanelBloqueos
          fecha={fecha}
          turno={turno}
          salas={salasActivas}
          bloqueos={bloqueos}
          mesaInicial={mesaSel}
          salaInicial={sala?.id ?? null}
          cerrar={() => setPanel(null)}
          crear={(b) => correr(api.crearBloqueo({ restauranteId: restId, fecha, ...b }), "Bloqueo creado.")}
          borrar={(id) => correr(api.borrarBloqueo(id), "Bloqueo quitado.")}
        />
      ) : null}

      {confirmar ? (
        <Caja cerrar={() => setConfirmar(null)} titulo="Confirmar" estrecha>
          <form onSubmit={async (e) => { e.preventDefault(); const f = confirmar.si; setConfirmar(null); await f(); }}>
            <p className="dia-confirmar-txt">{confirmar.texto}</p>
            <div className="dia-caja-pie">
              <button type="button" className="btn mini sec" onClick={() => setConfirmar(null)}>No</button>
              <button type="submit" className="btn mini" autoFocus>Sí</button>
            </div>
          </form>
        </Caja>
      ) : null}
    </div>
  );
}

/* ==================== Caja (modal ligero propio de la sección) ==================== */

function Caja({ titulo, cerrar, children, estrecha }: { titulo: string; cerrar: () => void; children: React.ReactNode; estrecha?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [cerrar]);
  return (
    <div className="dia-caja-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <div className={"dia-caja" + (estrecha ? " estrecha" : "")} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="dia-caja-cab">
          <h3>{titulo}</h3>
          <button type="button" className="dia-caja-x" onClick={cerrar} aria-label="Cerrar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ==================== Menú de mesa (varias reservas o mesa libre) ==================== */

function MenuMesa(props: {
  x: number;
  y: number;
  reservas: ReservaDia[];
  mesa: Mesa | null;
  esHoy: boolean;
  sinMesa: ReservaDia[];
  espera: Espera[];
  cerrar: () => void;
  elegir: (r: ReservaDia) => void;
  nueva: () => void;
  walkin: () => void;
  asignar: (r: ReservaDia) => void;
  sentarEspera: (e: Espera) => Promise<void>;
}) {
  const { x, y, reservas, mesa, esHoy, sinMesa, espera, cerrar, elegir, nueva, walkin, asignar, sentarEspera } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [abierto, setAbierto] = useState<"asignar" | "espera" | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const libre = reservas.length === 0;
  const nombre = mesa?.etiqueta || mesa?.nombre || "";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8)), top: y + 12 + h > window.innerHeight - 8 ? Math.max(8, y - h - 12) : y + 12 });
  }, [x, y, abierto]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) cerrar(); };
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    return () => { clearTimeout(t); window.removeEventListener("mousedown", onDown); };
  }, [cerrar]);
  // Teclado: el foco entra en el menú al abrirse.
  useEffect(() => { ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true }); }, []);

  return (
    <div ref={ref} className="dia-elegir" style={pos} role="menu" aria-label={`Mesa ${nombre}`}>
      <div className="dia-elegir-tit">
        Mesa {nombre}
        {mesa ? ` · ${mesa.cap_min}–${mesa.cap_max} pax` : ""}
        {libre ? " · libre" : ` · ${reservas.length} reservas`}
      </div>
      {reservas.map((r) => {
        const e = ESTADO[r.estado];
        return (
          <button key={r.id} type="button" role="menuitem" onClick={() => elegir(r)}>
            <b>{fmtHora(r.hora)}</b> {nombreCliente(r).nombre} · {r.pax} pax
            <span className="dia-elegir-estado" style={{ background: e?.color, color: e?.borde ? "#1a1a1a" : colorTexto(e?.color ?? "#888") }}>{e?.texto ?? r.estado}</span>
          </button>
        );
      })}
      {libre && esHoy ? (
        <button type="button" role="menuitem" className="destacado" onClick={walkin}>
          <Icono nombre="sentada" tam={13} /> Walk-in (sentar ahora)
        </button>
      ) : null}
      <button type="button" role="menuitem" className={libre ? "" : "nueva"} onClick={nueva}>
        <Icono nombre="mas" tam={13} /> {libre ? "Nueva reserva" : "Nueva reserva en esta mesa"}
      </button>
      {libre ? (
        <>
          <button type="button" role="menuitem" aria-expanded={abierto === "asignar"} disabled={!sinMesa.length} onClick={() => setAbierto(abierto === "asignar" ? null : "asignar")}>
            <Icono nombre="calendario" tam={13} /> Asignar reserva sin mesa…
            <span className="dia-elegir-n">{sinMesa.length}</span>
          </button>
          {abierto === "asignar" ? (
            <div className="dia-elegir-sub">
              {sinMesa.map((r) => (
                <button key={r.id} type="button" role="menuitem" onClick={() => asignar(r)}>
                  <b>{fmtHora(r.hora)}</b> {nombreCliente(r).nombre} · {r.pax} pax
                  {mesa && r.pax > mesa.cap_max ? <small className="dia-elegir-aviso">grande</small> : null}
                </button>
              ))}
            </div>
          ) : null}
          {esHoy ? (
            <button type="button" role="menuitem" aria-expanded={abierto === "espera"} disabled={!espera.length} onClick={() => setAbierto(abierto === "espera" ? null : "espera")}>
              <Icono nombre="reloj" tam={13} /> Sentar desde lista de espera…
              <span className="dia-elegir-n">{espera.length}</span>
            </button>
          ) : null}
          {abierto === "espera" ? (
            <div className="dia-elegir-sub">
              {espera.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  role="menuitem"
                  disabled={!!ocupado}
                  onClick={async () => { setOcupado(e.id); try { await sentarEspera(e); } finally { setOcupado(null); } }}
                >
                  <b>{e.nombre}</b> · {e.pax} pax{e.hora_preferida ? ` · ${fmtHora(e.hora_preferida)}` : ""}
                  {mesa && e.pax > mesa.cap_max ? <small className="dia-elegir-aviso">grande</small> : null}
                  {ocupado === e.id ? <small className="dia-elegir-aviso">…</small> : null}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* ==================== Walk-in (sentar ahora sin reserva) ==================== */

function WalkinBox({ mesa, cerrar, crear }: { mesa: Mesa | null; cerrar: () => void; crear: (pax: number, nombre: string | null) => Promise<void> }) {
  const [n, setN] = useState(Math.max(1, Math.min(mesa?.cap_max ?? 2, 2)));
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  return (
    <Caja titulo={`Walk-in · Mesa ${mesa?.etiqueta || mesa?.nombre || ""}`} cerrar={cerrar} estrecha>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (guardando) return;
          setGuardando(true);
          try { await crear(n, nombre.trim() || null); } finally { setGuardando(false); }
        }}
      >
        <div className="dia-form-lbl">Personas</div>
        <div className="dia-pax">
          <button type="button" className="btn mini sec" onClick={() => setN((x) => Math.max(1, x - 1))} aria-label="Menos">−</button>
          <input type="number" min={1} max={99} inputMode="numeric" value={n} onChange={(e) => setN(Math.max(1, Math.min(99, parseInt(e.target.value) || 1)))} aria-label="Personas" />
          <button type="button" className="btn mini sec" onClick={() => setN((x) => Math.min(99, x + 1))} aria-label="Más">+</button>
          {mesa && n > mesa.cap_max ? <small className="dia-form-aviso">La mesa es para {mesa.cap_max}.</small> : null}
        </div>
        <label style={{ marginTop: 10 }}>Nombre <small>(opcional)</small>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} placeholder="Sin nombre" autoFocus />
        </label>
        <div className="dia-form-ayuda">Se crea una reserva sentada ahora, sin avisos al cliente.</div>
        <div className="dia-caja-pie">
          <button type="button" className="btn mini sec" onClick={cerrar}>Cancelar</button>
          <button type="submit" className="btn mini" disabled={guardando}>{guardando ? "Sentando…" : "Sentar ahora"}</button>
        </div>
      </form>
    </Caja>
  );
}

/* ==================== Desplazar (hora / día / mesa) ==================== */

type Ocupacion = { ocupadas: Record<string, { nombre: string; hora: string }>; bloqueadas: Record<string, string> };

function DesplazarBox(props: {
  restId: string;
  reserva: ReservaDia;
  salas: Sala[];
  /** Reservas vivas del día entero (todas las salas y turnos). */
  reservasDia: ReservaDia[];
  bloqueos: Bloqueo[];
  turnos: Turno[];
  cerrar: () => void;
  guardar: (c: { fecha?: string; hora?: string; mesaIds?: string[]; turno_id?: string | null }) => Promise<void>;
}) {
  const { restId, reserva: r, salas, reservasDia, bloqueos, turnos, cerrar, guardar } = props;
  const [fecha, setFecha] = useState(r.fecha);
  const [hora, setHora] = useState(fmtHora(r.hora));
  const [mesaIds, setMesaIds] = useState<string[]>(mesasDe(r));
  const [guardando, setGuardando] = useState(false);
  const [remota, setRemota] = useState<{ clave: string; oc: Ocupacion | null; error?: boolean } | null>(null);
  const todas = salas.flatMap((s) => (s.mesas || []).filter((m) => m.activa).map((m) => ({ ...m, sala_nombre: s.nombre })));
  const dur = r.duracion_min || 120;
  const horaOk = /^\d{2}:\d{2}$/.test(hora);
  const turnoNuevo = horaOk ? turnoDe(turnos, fecha, hora) ?? null : null;
  const otroDia = fecha !== r.fecha;
  const claveRemota = `${fecha}|${hora}`;

  // Otro día: la ocupación se pide al servidor (con un pequeño retardo mientras se teclea).
  useEffect(() => {
    if (!otroDia || !horaOk) return;
    let vivo = true;
    const t = setTimeout(async () => {
      try {
        const oc = await ocupacionMesas({ restauranteId: restId, fecha, hora, duracion: dur, excluirId: r.id });
        if (!vivo) return;
        const bloqueadas: Record<string, string> = {};
        for (const id of oc.bloqueadas) bloqueadas[id] = "Bloqueada";
        for (const m of todas) {
          if (oc.salasBloqueadas.includes("*") || oc.salasBloqueadas.includes(m.sala_id)) bloqueadas[m.id] = "Bloqueada";
        }
        const ocupadas: Ocupacion["ocupadas"] = {};
        for (const [id, o] of Object.entries(oc.ocupadas)) ocupadas[id] = { nombre: o.nombre, hora: o.hora };
        setRemota({ clave: `${fecha}|${hora}`, oc: { ocupadas, bloqueadas } });
      } catch {
        if (vivo) setRemota({ clave: `${fecha}|${hora}`, oc: null, error: true });
      }
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
    // `todas` se recalcula en cada render; basta con las salas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otroDia, horaOk, fecha, hora, dur, restId, r.id, salas]);

  /** Ocupación de una mesa en la franja elegida: mismo día con los datos que ya hay (todas
      las reservas vivas del día, no solo las del turno); otro día, lo que diga el servidor. */
  function estadoMesa(m: Mesa): { ocupante?: { nombre: string; hora: string }; bloqueo?: string } {
    if (!horaOk) return {};
    if (otroDia) {
      const oc = remota?.clave === claveRemota ? remota.oc : null;
      return { ocupante: oc?.ocupadas[m.id], bloqueo: oc?.bloqueadas[m.id] };
    }
    const o = reservasDia.find((x) => x.id !== r.id && mesasDe(x).includes(m.id) && solapan(x.hora, x.duracion_min || 120, hora, dur));
    const b = bloqueoDe(bloqueos, m, hora, dur);
    return {
      ocupante: o ? { nombre: o.reservas_clientes?.nombre ?? "otra reserva", hora: fmtHora(o.hora) } : undefined,
      bloqueo: b ? `Bloqueada ${textoBloqueo(b)}` : undefined,
    };
  }
  const comprobando = otroDia && horaOk && remota?.clave !== claveRemota;
  const sinComprobar = otroDia && remota?.clave === claveRemota && remota.error;

  const toggle = (id: string) => setMesaIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const problemas = mesaIds
    .map((id) => todas.find((m) => m.id === id))
    .filter((m): m is (typeof todas)[number] => !!m)
    .map((m) => {
      const e = estadoMesa(m);
      if (e.bloqueo) return `${m.etiqueta || m.nombre}: ${e.bloqueo.toLowerCase()}`;
      if (e.ocupante) return `${m.etiqueta || m.nombre}: ocupada por ${e.ocupante.nombre} a las ${e.ocupante.hora}`;
      return null;
    })
    .filter(Boolean) as string[];
  const errorTurno = horaOk && !turnoNuevo ? "La hora tiene que estar dentro de un turno de ese día." : null;

  return (
    <Caja titulo={`Desplazar · ${r.reservas_clientes?.nombre ?? ""} · ${r.pax} pax`} cerrar={cerrar}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (guardando || !horaOk || errorTurno) return;
          setGuardando(true);
          try {
            await guardar({
              ...(fecha !== r.fecha ? { fecha } : {}),
              ...(hora !== fmtHora(r.hora) ? { hora } : {}),
              mesaIds,
              turno_id: turnoNuevo?.id ?? null,
            });
          } finally { setGuardando(false); }
        }}
      >
        <div className="dia-form-fila">
          <label>Día<input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} /></label>
          <label>Hora<input type="time" step={900} value={hora} onChange={(e) => setHora(e.target.value)} /></label>
          <label>Turno<input value={turnoNuevo ? turnoNuevo.nombre : "—"} readOnly tabIndex={-1} aria-readonly /></label>
        </div>
        {errorTurno ? <div className="dia-form-error" role="alert">{errorTurno}</div> : null}
        <div className="dia-form-lbl">
          Mesas <small>(toca para marcar; la primera es la principal)</small>
          {comprobando ? <small> · comprobando ocupación…</small> : null}
          {sinComprobar ? <small className="dia-form-aviso"> · no se ha podido comprobar la ocupación de ese día</small> : null}
        </div>
        <div className="dia-mesas-grid">
          {salas.map((s) => (
            <div key={s.id} className="dia-mesas-sala">
              <div className="dia-mesas-sala-nom">{s.nombre}</div>
              <div className="dia-mesas-chips">
                {(s.mesas || []).filter((m) => m.activa).map((m) => {
                  const sel = mesaIds.includes(m.id);
                  const e = estadoMesa(m);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={"dia-mesa-chip" + (sel ? " sel" : "") + (e.ocupante ? " ocupada" : "") + (e.bloqueo ? " bloqueada" : "") + (m.cap_max < r.pax ? " pequena" : "")}
                      title={e.bloqueo ?? (e.ocupante ? `Ocupada: ${e.ocupante.nombre} a las ${e.ocupante.hora}` : `${m.cap_min}–${m.cap_max} pax`)}
                      aria-pressed={sel}
                      onClick={() => toggle(m.id)}
                    >
                      {e.bloqueo ? <Icono nombre="candado" tam={10} /> : null}
                      {m.etiqueta || m.nombre}<small>({m.cap_max})</small>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {mesaIds.length ? (
          <div className="dia-form-ayuda">Principal: <b>{todas.find((m) => m.id === mesaIds[0])?.etiqueta || todas.find((m) => m.id === mesaIds[0])?.nombre}</b>{mesaIds.length > 1 ? ` + ${mesaIds.length - 1} más` : ""}</div>
        ) : (
          <div className="dia-form-ayuda">Sin mesa: la reserva queda pendiente de asignar.</div>
        )}
        {problemas.length ? <div className="dia-form-aviso">Ojo: {problemas.join(" · ")}. Se moverá igualmente.</div> : null}
        <div className="dia-caja-pie">
          <button type="button" className="btn mini sec" onClick={cerrar}>Cancelar</button>
          <button type="submit" className="btn mini" disabled={guardando || !horaOk || !!errorTurno}>
            {guardando ? "Desplazando…" : "Desplazar"}
          </button>
        </div>
      </form>
    </Caja>
  );
}

/* ==================== Panel de cupos y nota del día ==================== */

function PanelCupos(props: {
  fecha: string;
  turnos: Turno[];
  cupos: Tables<"reservas_cupos">[];
  nota: string;
  mesas: Mesa[];
  cerrar: () => void;
  guardarCupo: (turnoId: string | null, v: { cerrado: boolean; max_pax_online: number | null; max_pax_total: number | null; nota: string | null }) => Promise<boolean>;
  guardarNota: (texto: string) => Promise<boolean>;
}) {
  const { fecha, turnos, cupos, nota, mesas, cerrar, guardarCupo, guardarNota } = props;
  const aforoMesas = mesas.filter((m) => m.activa).reduce((a, m) => a + m.cap_max, 0);
  const [textoNota, setTextoNota] = useState(nota);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const filas = [...turnos.map((t) => ({ id: t.id as string | null, nombre: t.nombre, t })), { id: null as string | null, nombre: "Todo el día", t: null as Turno | null }];
  const notaSinCambios = textoNota.trim() === nota.trim();
  async function guardarLaNota() {
    if (ocupado === "nota" || notaSinCambios) return;
    setOcupado("nota");
    try { await guardarNota(textoNota); } finally { setOcupado(null); }
  }
  return (
    <Caja titulo={`Cupos del ${fmtFecha(fecha)}`} cerrar={cerrar}>
      <div className="dia-cupos">
        {filas.map((f) => (
          <FilaCupo
            key={f.id ?? "dia"}
            nombre={f.nombre}
            turno={f.t}
            cupo={cupos.find((c) => (f.id ? c.turno_id === f.id : c.turno_id == null)) ?? null}
            aforoMesas={aforoMesas}
            ocupado={ocupado === (f.id ?? "dia")}
            guardar={async (v) => { setOcupado(f.id ?? "dia"); try { await guardarCupo(f.id, v); } finally { setOcupado(null); } }}
          />
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void guardarLaNota(); }}>
        <div className="dia-form-lbl">Nota del día <small>(la ve toda la sala en esta pantalla y en Mes · Ctrl/⌘ + Intro guarda)</small></div>
        <textarea
          className="dia-nota-txt"
          rows={3}
          value={textoNota}
          onChange={(e) => setTextoNota(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void guardarLaNota(); } }}
          placeholder="P. ej. «Grupo de 20 a las 14:30 en terraza, menú cerrado»"
        />
        <div className="dia-caja-pie">
          <button type="button" className="btn mini sec" onClick={cerrar}>Cerrar</button>
          <button type="submit" className="btn mini" disabled={ocupado === "nota" || notaSinCambios}>Guardar nota</button>
        </div>
      </form>
    </Caja>
  );
}

function FilaCupo(props: {
  nombre: string;
  turno: Turno | null;
  cupo: Tables<"reservas_cupos"> | null;
  aforoMesas: number;
  ocupado: boolean;
  guardar: (v: { cerrado: boolean; max_pax_online: number | null; max_pax_total: number | null; nota: string | null }) => Promise<void>;
}) {
  const { nombre, turno, cupo, aforoMesas, ocupado, guardar } = props;
  const [cerrado, setCerrado] = useState(!!cupo?.cerrado);
  const [online, setOnline] = useState(cupo?.max_pax_online != null ? String(cupo.max_pax_online) : "");
  const [total, setTotal] = useState(cupo?.max_pax_total != null ? String(cupo.max_pax_total) : "");
  const [notaT, setNotaT] = useState(cupo?.nota ?? "");
  const cambiado = cerrado !== !!cupo?.cerrado || online !== (cupo?.max_pax_online != null ? String(cupo.max_pax_online) : "") || total !== (cupo?.max_pax_total != null ? String(cupo.max_pax_total) : "") || notaT !== (cupo?.nota ?? "");
  return (
    <form
      className={"dia-cupo" + (cerrado ? " cerrado" : "")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!cambiado || ocupado) return;
        void guardar({ cerrado, max_pax_online: online.trim() === "" ? null : Math.max(0, parseInt(online) || 0), max_pax_total: total.trim() === "" ? null : Math.max(0, parseInt(total) || 0), nota: notaT });
      }}
    >
      <div className="dia-cupo-cab">
        <b>{nombre}</b>
        {turno ? <small>{fmtHora(turno.hora_inicio)}–{fmtHora(turno.hora_fin)}</small> : null}
        <label className="dia-switch">
          <input type="checkbox" checked={!cerrado} onChange={(e) => setCerrado(!e.target.checked)} />
          <span className="dia-switch-pista"><span className="dia-switch-bola" /></span>
          <span className="dia-switch-txt">{cerrado ? "Cerrado" : "Abierto"}</span>
        </label>
      </div>
      <div className="dia-form-fila">
        <label>Aforo online<input type="number" min={0} inputMode="numeric" value={online} onChange={(e) => setOnline(e.target.value)} placeholder={turno ? String(turno.max_pax_online) : "sin límite"} /></label>
        <label>Aforo total<input type="number" min={0} inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} placeholder={String(turno?.max_pax_total ?? aforoMesas)} /></label>
        <label>Nota del turno<input value={notaT} onChange={(e) => setNotaT(e.target.value)} placeholder="Opcional" /></label>
      </div>
      <div className="dia-cupo-pie">
        <button type="submit" className="btn mini" disabled={!cambiado || ocupado}>
          {ocupado ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}

/* ==================== Panel de bloqueos ==================== */

function PanelBloqueos(props: {
  fecha: string;
  turno: Turno | null;
  salas: Sala[];
  bloqueos: Tables<"reservas_bloqueos">[];
  mesaInicial: string | null;
  salaInicial: string | null;
  cerrar: () => void;
  crear: (b: { hora_inicio: string; hora_fin: string; mesa_id: string | null; sala_id: string | null; motivo: string | null }) => Promise<boolean>;
  borrar: (id: string) => Promise<boolean>;
}) {
  const { fecha, turno, salas, bloqueos, mesaInicial, salaInicial, cerrar, crear, borrar } = props;
  const [ambito, setAmbito] = useState<"mesa" | "sala">(mesaInicial ? "mesa" : "sala");
  const [salaId, setSalaId] = useState(salaInicial ?? salas[0]?.id ?? "");
  const [mesaId, setMesaId] = useState(mesaInicial ?? "");
  const [ini, setIni] = useState(turno ? fmtHora(turno.hora_inicio) : "12:00");
  const [fin, setFin] = useState(turno ? fmtHora(turno.fin_servicio ?? turno.hora_fin) : "23:59");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const salaForm = salas.find((s) => s.id === salaId);
  const nombreMesa = (id: string | null) => {
    for (const s of salas) for (const m of s.mesas || []) if (m.id === id) return `${m.etiqueta || m.nombre} (${s.nombre})`;
    return "?";
  };
  const nombreSala = (id: string | null) => salas.find((s) => s.id === id)?.nombre ?? "?";
  const valido = !!ini && !!fin && fin > ini && (ambito === "mesa" ? !!mesaId : !!salaId);
  return (
    <Caja titulo={`Bloqueos del ${fmtFecha(fecha)}`} cerrar={cerrar}>
      {bloqueos.length ? (
        <div className="dia-bloqueos">
          {bloqueos.map((b) => (
            <div key={b.id} className="dia-bloqueo">
              <Icono nombre="candado" tam={13} />
              <div>
                <b>{b.mesa_id ? `Mesa ${nombreMesa(b.mesa_id)}` : b.sala_id ? `Sala ${nombreSala(b.sala_id)} entera` : "Todo el restaurante"}</b>
                <small>{fmtHora(b.hora_inicio)}–{fmtHora(b.hora_fin)}{b.motivo ? ` · ${b.motivo}` : ""}</small>
              </div>
              <button type="button" className="dia-bloqueo-x" onClick={() => borrar(b.id)} aria-label="Quitar bloqueo">Quitar</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="dia-form-ayuda">No hay bloqueos este día.</div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (guardando || !valido) return;
          setGuardando(true);
          try {
            const ok = await crear({ hora_inicio: ini, hora_fin: fin, mesa_id: ambito === "mesa" ? mesaId : null, sala_id: salaId, motivo: motivo || null });
            if (ok) { setMotivo(""); if (ambito === "mesa") setMesaId(""); }
          } finally { setGuardando(false); }
        }}
      >
        <div className="dia-form-lbl">Nuevo bloqueo</div>
        <div className="dia-segmento">
          <button type="button" className={ambito === "mesa" ? "activo" : ""} onClick={() => setAmbito("mesa")} aria-pressed={ambito === "mesa"}>Una mesa</button>
          <button type="button" className={ambito === "sala" ? "activo" : ""} onClick={() => setAmbito("sala")} aria-pressed={ambito === "sala"}>Sala entera</button>
        </div>
        <div className="dia-form-fila">
          <label>Sala
            <select value={salaId} onChange={(e) => { setSalaId(e.target.value); setMesaId(""); }}>
              {salas.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
          {ambito === "mesa" ? (
            <label>Mesa
              <select value={mesaId} onChange={(e) => setMesaId(e.target.value)}>
                <option value="">— elige —</option>
                {(salaForm?.mesas || []).filter((m) => m.activa).map((m) => <option key={m.id} value={m.id}>{m.etiqueta || m.nombre} ({m.cap_min}–{m.cap_max})</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <div className="dia-form-fila">
          <label>Desde<input type="time" step={900} value={ini} onChange={(e) => setIni(e.target.value)} /></label>
          <label>Hasta<input type="time" step={900} value={fin} onChange={(e) => setFin(e.target.value)} /></label>
          <label>Motivo<input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Opcional: avería, evento…" /></label>
        </div>
        <div className="dia-caja-pie">
          <button type="button" className="btn mini sec" onClick={cerrar}>Cerrar</button>
          <button type="submit" className="btn mini" disabled={guardando || !valido}>Bloquear</button>
        </div>
      </form>
    </Caja>
  );
}
