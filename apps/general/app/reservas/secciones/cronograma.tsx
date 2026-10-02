"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../acciones";
import { bloqueosDia, cambiarDuracion, moverReserva, type Bloqueo } from "../acciones/cronograma";
import { cambiarEstado, liberar } from "../acciones/dia";
import { dowDe, h5, hoyISO, mesasDe, minutos, type Mesa, type Reserva, type Sala, type Turno } from "../tipos";
import {
  ESTADOS_EN_SALA,
  ESTADOS_FINALES,
  colorTexto,
  estadoDe,
  fmtFecha,
  fmtFechaLarga,
  fmtHora,
  guardarPref,
  leerPref,
  useRecargaExterna,
  useTurnoActivo,
  type SecProps,
  nombreCliente,
} from "../lib-reservas";
import { PopoverReserva } from "../componentes/popover-reserva";
import "./cronograma.css";

/* ==================== Constantes de dibujo ==================== */

const PASO = 15; // minutos por columna
const ZOOMS = [18, 26, 36]; // px por columna
const ALTO_FILA = 30; // px por carril de mesa
const ALTO_SALA = 26; // px de la cabecera de sala
const ALTO_CAB = 44; // px de la cabecera de horas
const DUR_MAX = 600;
const PULSACION_MS = 300; // con el dedo, mantener pulsado para empezar a arrastrar
const BORDE_AUTO = 40; // px junto al borde de la rejilla en los que se desplaza sola al arrastrar

/** Estados que no se pintan en el cronograma (no ocupan hueco). */
const OCULTOS = ["cancelada", "no_show", "lista_espera"];

/* ==================== Tipos internos ==================== */

type Fila =
  | { tipo: "sinmesa"; alto: number; y: number; carriles: number }
  | { tipo: "sala"; sala: Sala; alto: number; y: number; nMesas: number; nReservas: number }
  | { tipo: "mesa"; mesa: Mesa; sala: Sala; alto: number; y: number; carriles: number };

type Barra = {
  r: Reserva;
  mesaId: string | null;
  filaIdx: number;
  carril: number;
  ini: number; // minutos desde medianoche
  fin: number;
  secundaria: boolean; // mesa adicional de una combinación
};

type Arrastre = {
  id: string;
  mesaOrigen: string | null;
  modo: "mover" | "estirar";
  pointerId: number;
  dedo: boolean; // gesto táctil
  activo: boolean; // ya mueve la barra (ratón: desde el principio; dedo: tras mantener pulsado)
  desplazado: boolean; // dedo: se ha usado para desplazar la rejilla (ya no es un toque)
  x0: number; // punto de inicio en pantalla
  y0: number;
  xUlt: number; // último punto en pantalla (desplazamiento a mano con el dedo)
  yUlt: number;
  xc0: number; // x del puntero en coordenadas del contenido al empezar
  hora0: number;
  dur0: number;
  filaIdx0: number;
  hora: number;
  dur: number;
  filaIdx: number;
  movido: boolean;
};

type Confirmacion = { titulo: string; lineas: string[]; boton: string; hacer: () => void };

/* ==================== Utilidades ==================== */

const aHora = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const redondear = (min: number, arriba: boolean) => (arriba ? Math.ceil(min / PASO) : Math.floor(min / PASO)) * PASO;
const solapa = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;
const nombreDe = (r: Reserva) => {
  const n = nombreCliente(r);
  return [n.nombre, n.apellidos].filter(Boolean).join(" ").trim();
};
const ordenMesas = (a: Mesa, b: Mesa) => (a.etiqueta || a.nombre).localeCompare(b.etiqueta || b.nombre, "es", { numeric: true });
const nombreMesa = (m: Mesa | undefined) => (m ? m.etiqueta || m.nombre : "?");

/** ¿La hora (en minutos) cae dentro del turno? Tiene en cuenta los turnos que cruzan la medianoche. */
function enTurno(t: Turno, min: number): boolean {
  const ini = minutos(h5(t.hora_inicio)), fin = minutos(h5(t.hora_fin));
  return fin < ini ? min >= ini || min <= fin : min >= ini && min <= fin;
}

/** Mesas con las que queda la reserva tras soltarla (misma regla que moverReserva en el servidor).
    undefined = no cambian; null = «Sin mesa» (si se arrastró una mesa de una combinación, solo sale esa). */
function combinacionResultante(actuales: string[], mesaNueva: string | null | undefined, mesaOrigen: string | null): string[] {
  if (mesaNueva === undefined) return actuales;
  const enComb = !!mesaOrigen && actuales.length > 1 && actuales.includes(mesaOrigen);
  if (mesaNueva === null) return enComb ? actuales.filter((m) => m !== mesaOrigen) : [];
  return enComb ? [...new Set(actuales.map((m) => (m === mesaOrigen ? mesaNueva : m)))] : [mesaNueva];
}

/** Fin real del servicio de un turno: fin_servicio o hora_fin + duración. */
function finServicio(t: Turno): number {
  const ini = minutos(h5(t.hora_inicio));
  let fin = t.fin_servicio ? minutos(h5(t.fin_servicio)) : minutos(h5(t.hora_fin)) + (t.duracion_min || 120);
  if (fin <= ini) fin += 1440; // cierre pasada la medianoche
  return fin;
}

/** Minutos que lleva en sala una reserva (desde sentada_en / llegada_en o, si no, desde su hora). */
function minutosEnSala(r: Reserva, ahoraMin: number): number | null {
  if (!ESTADOS_EN_SALA.includes(r.estado)) return null;
  const sello = r.sentada_en || r.llegada_en;
  if (sello) {
    const d = new Date(sello);
    const m = Math.round((Date.now() - d.getTime()) / 60000);
    return m >= 0 && m < 1440 ? m : null;
  }
  const m = ahoraMin - minutos(h5(r.hora));
  return m >= 0 ? m : null;
}

/* ==================== Sección ==================== */

export default function SecCronograma({ rest, fecha, avisar }: SecProps) {
  const restId = rest.id;
  const [salas, setSalas] = useState<Sala[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [bloqueos, setBloqueos] = useState<Bloqueo[]>([]);
  const [cargado, setCargado] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [plegadas, setPlegadas] = useState<string[]>([]);
  const [arr, setArr] = useState<Arrastre | null>(null);
  const arrRef = useRef<Arrastre | null>(null);
  const [confirmar, setConfirmar] = useState<Confirmacion | null>(null);
  const [resumen, setResumen] = useState<Turno | null>(null);
  const [turnoFoco, setTurnoFoco] = useState<string | null>(null);
  const [popover, setPopover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [resaltada, setResaltada] = useState<string | null>(null);
  const turnoBarra = useTurnoActivo();
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const raf = useRef<number | null>(null);
  const ultimoPuntero = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [ahoraMin, setAhoraMin] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollInicial = useRef(false);
  const [estrecho, setEstrecho] = useState(false);

  // Etiqueta de mesa más corta en pantallas estrechas
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const h = () => setEstrecho(mq.matches);
    h();
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  const slotW = ZOOMS[zoom] ?? ZOOMS[1];
  const labelW = estrecho ? 104 : 150;
  const hoy = hoyISO();
  const esHoy = fecha === hoy;

  /* ---- preferencias ---- */
  useEffect(() => {
    const z = leerPref<number>("crono.zoom", 1);
    setZoom(Math.min(ZOOMS.length - 1, Math.max(0, Number(z) || 0)));
    setPlegadas(leerPref<string[]>("crono.plegadas", []));
  }, []);
  const cambiarZoom = (d: number) => {
    setZoom((z) => { const n = Math.min(ZOOMS.length - 1, Math.max(0, z + d)); guardarPref("crono.zoom", n); return n; });
  };
  const plegar = (salaId: string) => {
    setPlegadas((xs) => { const n = xs.includes(salaId) ? xs.filter((x) => x !== salaId) : [...xs, salaId]; guardarPref("crono.plegadas", n); return n; });
  };

  /* ---- carga ---- */
  const recargarLocal = useCallback(async (id: string) => {
    const { salas: s, turnos: t } = await api.cargarLocal(id);
    setSalas(s as unknown as Sala[]);
    setTurnos(t as Turno[]);
  }, []);
  const recargarDia = useCallback(async (id: string, f: string) => {
    const [d, b] = await Promise.all([api.cargarDia(id, f, hoyISO()), bloqueosDia(id, f)]);
    setReservas(d.reservas);
    setBloqueos(b);
    setCargado(true);
  }, []);

  useEffect(() => {
    setCargado(false);
    scrollInicial.current = false;
    recargarLocal(restId).then(() => recargarDia(restId, fecha));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restId]);
  useEffect(() => {
    scrollInicial.current = false;
    recargarDia(restId, fecha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);

  // Sondeo cada 60 s (sin realtime); no se recarga mientras se arrastra
  useEffect(() => {
    const int = setInterval(() => {
      if (!document.hidden && !arrRef.current) recargarDia(restId, fecha);
    }, 60000);
    return () => clearInterval(int);
  }, [recargarDia, restId, fecha]);
  useRecargaExterna(useCallback(() => { recargarDia(restId, fecha); }, [recargarDia, restId, fecha]));

  // Reloj para la línea de «ahora» y los «lleva X min»
  useEffect(() => {
    const int = setInterval(() => { const d = new Date(); setAhoraMin(d.getHours() * 60 + d.getMinutes()); }, 30000);
    return () => clearInterval(int);
  }, []);

  /* ---- turnos del día y rango horario ---- */
  const dow = dowDe(fecha);
  const turnosDia = useMemo(
    () => turnos.filter((t) => t.activo && (t.dias_semana || []).includes(dow)).sort((a, b) => (a.hora_inicio < b.hora_inicio ? -1 : 1)),
    [turnos, dow],
  );
  const vivas = useMemo(() => reservas.filter((r) => !OCULTOS.includes(r.estado)), [reservas]);

  const { iniMin, finMin } = useMemo(() => {
    let ini = Infinity, fin = -Infinity;
    turnosDia.forEach((t) => { ini = Math.min(ini, minutos(h5(t.hora_inicio))); fin = Math.max(fin, finServicio(t)); });
    vivas.forEach((r) => { const a = minutos(h5(r.hora)); ini = Math.min(ini, a); fin = Math.max(fin, a + (r.duracion_min || 120)); });
    if (!isFinite(ini)) { ini = 12 * 60; fin = 24 * 60; }
    ini = redondear(ini, false) - 30; // media hora de margen antes
    fin = redondear(fin, true);
    if (fin - ini < 4 * 60) fin = ini + 4 * 60;
    return { iniMin: Math.max(0, ini), finMin: Math.min(fin, 36 * 60) };
  }, [turnosDia, vivas]);
  const nSlots = Math.max(1, (finMin - iniMin) / PASO);
  const anchoPista = nSlots * slotW;
  const xDe = (min: number) => ((min - iniMin) / PASO) * slotW;

  /* ---- filas (sin mesa + salas plegables + mesas) y barras ---- */
  const mesasActivas = useMemo(() => {
    const out: Mesa[] = [];
    salas.filter((s) => s.activa).forEach((s) => (s.mesas || []).filter((m) => m.activa).forEach((m) => out.push({ ...m, sala_nombre: s.nombre })));
    return out;
  }, [salas]);
  const mesaPorId = useMemo(() => new Map(mesasActivas.map((m) => [m.id, m])), [mesasActivas]);

  const { filas, barras, altoTotal } = useMemo(() => {
    const filas: Fila[] = [{ tipo: "sinmesa", alto: ALTO_FILA, y: 0, carriles: 1 }];
    const idxMesa = new Map<string, number>();
    const reservasSala = new Map<string, Set<string>>();
    salas.filter((s) => s.activa).forEach((s) => {
      const mesas = (s.mesas || []).filter((m) => m.activa).sort(ordenMesas);
      filas.push({ tipo: "sala", sala: s, alto: ALTO_SALA, y: 0, nMesas: mesas.length, nReservas: 0 });
      reservasSala.set(s.id, new Set());
      if (plegadas.includes(s.id)) return;
      mesas.forEach((m) => { idxMesa.set(m.id, filas.length); filas.push({ tipo: "mesa", mesa: m, sala: s, alto: ALTO_FILA, y: 0, carriles: 1 }); });
    });

    const porFila = new Map<number, Barra[]>();
    const meter = (b: Barra) => { const l = porFila.get(b.filaIdx) || []; l.push(b); porFila.set(b.filaIdx, l); };
    vivas.forEach((r) => {
      const ini = minutos(h5(r.hora));
      const fin = ini + (r.duracion_min || 120);
      const ids = mesasDe(r).filter((id) => mesaPorId.has(id));
      if (!ids.length) { meter({ r, mesaId: null, filaIdx: 0, carril: 0, ini, fin, secundaria: false }); return; }
      ids.forEach((id) => {
        const m = mesaPorId.get(id)!;
        reservasSala.get(m.sala_id)?.add(r.id);
        const fi = idxMesa.get(id);
        if (fi === undefined) return; // sala plegada
        meter({ r, mesaId: id, filaIdx: fi, carril: 0, ini, fin, secundaria: ids.length > 1 && r.mesa_id !== id });
      });
    });

    // Carriles: si dos reservas se solapan en la misma fila, van una debajo de otra
    const barras: Barra[] = [];
    porFila.forEach((lista, fi) => {
      lista.sort((a, b) => a.ini - b.ini || a.fin - b.fin);
      const finCarril: number[] = [];
      lista.forEach((b) => {
        let c = finCarril.findIndex((f) => f <= b.ini);
        if (c < 0) { c = finCarril.length; finCarril.push(b.fin); } else finCarril[c] = b.fin;
        b.carril = c;
        barras.push(b);
      });
      const f = filas[fi];
      if (f.tipo !== "sala") { f.carriles = Math.max(1, finCarril.length); f.alto = f.carriles * ALTO_FILA; }
    });
    filas.forEach((f) => { if (f.tipo === "sala") f.nReservas = reservasSala.get(f.sala.id)?.size ?? 0; });

    let y = 0;
    filas.forEach((f) => { f.y = y; y += f.alto; });
    return { filas, barras, altoTotal: y };
  }, [salas, plegadas, vivas, mesaPorId]);

  /* ---- bloqueos y franjas fuera de turno ---- */
  const bloqueosPintados = useMemo(() => {
    const out: { key: string; filaIdx: number; ini: number; fin: number; motivo: string }[] = [];
    bloqueos.forEach((b) => {
      const ini = Math.max(iniMin, minutos(h5(b.hora_inicio)));
      const fin = Math.min(finMin, b.hora_fin >= "23:59" ? finMin : minutos(h5(b.hora_fin)));
      if (fin <= ini) return;
      filas.forEach((f, i) => {
        if (f.tipo !== "mesa") return;
        const afecta = b.mesa_id ? f.mesa.id === b.mesa_id : b.sala_id ? f.sala.id === b.sala_id : true;
        if (afecta) out.push({ key: b.id + f.mesa.id, filaIdx: i, ini, fin, motivo: b.motivo || "Bloqueada" });
      });
    });
    return out;
  }, [bloqueos, filas, iniMin, finMin]);

  const fueraTurno = useMemo(() => {
    const rangos = turnosDia.map((t) => [minutos(h5(t.hora_inicio)), finServicio(t)] as [number, number]).sort((a, b) => a[0] - b[0]);
    const huecos: [number, number][] = [];
    let cursor = iniMin;
    rangos.forEach(([a, b]) => { if (a > cursor) huecos.push([cursor, a]); cursor = Math.max(cursor, b); });
    if (cursor < finMin) huecos.push([cursor, finMin]);
    return huecos;
  }, [turnosDia, iniMin, finMin]);

  /* ---- scroll inicial y turno activo de la barra ---- */
  const irAMinuto = useCallback((min: number, suave = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: Math.max(0, xDe(min) - 8), behavior: suave ? "smooth" : "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iniMin, slotW]);

  useEffect(() => {
    if (!cargado || scrollInicial.current) return;
    scrollInicial.current = true;
    // Primero manda el turno elegido en la barra (p. ej. «Cena»); si no hay, «ahora» o el primer turno con gente
    const tb = turnoBarra ? turnosDia.find((t) => t.id === turnoBarra) : null;
    if (tb) { setTurnoFoco(tb.id); irAMinuto(minutos(h5(tb.hora_inicio)) - 30, false); }
    else if (esHoy && ahoraMin > iniMin && ahoraMin < finMin) irAMinuto(ahoraMin - 60, false);
    else {
      const conGente = turnosDia.find((t) => vivas.some((r) => enTurno(t, minutos(h5(r.hora)))));
      if (conGente) irAMinuto(minutos(h5(conGente.hora_inicio)) - 30, false);
    }
  }, [cargado, esHoy, ahoraMin, iniMin, finMin, turnosDia, vivas, irAMinuto, turnoBarra]);

  // Si después cambia el turno en la barra, la rejilla lo sigue
  const turnoBarraPrevio = useRef(turnoBarra);
  useEffect(() => {
    if (turnoBarraPrevio.current === turnoBarra) return;
    turnoBarraPrevio.current = turnoBarra;
    const t = turnoBarra ? turnosDia.find((x) => x.id === turnoBarra) : null;
    setTurnoFoco(t ? t.id : null);
    if (t) irAMinuto(minutos(h5(t.hora_inicio)) - 30);
  }, [turnoBarra, turnosDia, irAMinuto]);

  // Esc cierra lo que haya abierto (el popover se cierra solo)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { setConfirmar(null); setResumen(null); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Al desmontar: nada de temporizadores ni animaciones colgando
  useEffect(() => () => {
    if (temporizador.current) clearTimeout(temporizador.current);
    if (raf.current != null) cancelAnimationFrame(raf.current);
  }, []);

  // El resaltado de «Desplazar» se apaga solo
  useEffect(() => {
    if (!resaltada) return;
    const t = setTimeout(() => setResaltada(null), 6000);
    return () => clearTimeout(t);
  }, [resaltada]);

  /* ---- acciones ---- */
  const abrirReserva = (id: string) => {
    window.dispatchEvent(new CustomEvent("rsv:abrir-reserva", { detail: id }));
  };

  async function aplicarMover(r: Reserva, horaMin: number, mesaNueva: string | null | undefined, mesaOrigen: string | null) {
    const horaTxt = aHora(horaMin);
    // Optimista: se pinta ya; si falla, se recarga
    setReservas((xs) => xs.map((x) => {
      if (x.id !== r.id) return x;
      const n: Reserva = { ...x, hora: horaTxt + ":00" };
      if (mesaNueva === undefined) return n;
      const comb = combinacionResultante(mesasDe(x), mesaNueva, mesaOrigen);
      if (mesaNueva === null) n.mesa_id = x.mesa_id && comb.includes(x.mesa_id) ? x.mesa_id : (comb[0] ?? null);
      else n.mesa_id = x.mesa_id === mesaOrigen || !x.mesa_id || comb.length === 1 ? mesaNueva : x.mesa_id;
      n.reservas_reserva_mesas = comb.map((mesa_id) => ({ mesa_id }));
      return n;
    }));
    const res = await moverReserva(r.id, horaTxt, mesaNueva, mesaOrigen);
    if (!res.ok) avisar(res.error || "No se ha podido mover la reserva.");
    else {
      const m = mesaNueva ? mesaPorId.get(mesaNueva) : null;
      const soltada = mesaNueva === null && mesaOrigen ? mesaPorId.get(mesaOrigen) : null;
      const quedan = mesaNueva === null ? combinacionResultante(mesasDe(r), null, mesaOrigen).length : 0;
      const txtMesa = mesaNueva === null
        ? (quedan ? ` · sin la mesa ${nombreMesa(soltada ?? undefined)}` : " · sin mesa")
        : m ? ` · mesa ${nombreMesa(m)}` : "";
      avisar(`${nombreDe(r)} → ${horaTxt}${txtMesa}`);
    }
    recargarDia(restId, fecha);
  }

  async function aplicarDuracion(r: Reserva, dur: number) {
    setReservas((xs) => xs.map((x) => (x.id === r.id ? { ...x, duracion_min: dur } : x)));
    const res = await cambiarDuracion(r.id, dur);
    if (!res.ok) avisar(res.error || "No se ha podido cambiar la duración.");
    else avisar(`${nombreDe(r)} · ${dur} min`);
    recargarDia(restId, fecha);
  }

  /** Avisos de choque para la reserva `r` ocupando `mesas` en [ini, fin): otras reservas vivas
      en cualquiera de esas mesas y bloqueos (de mesa, de sala o del restaurante entero). */
  function choquesEn(r: Reserva, mesas: string[], ini: number, fin: number): string[] {
    const lineas: string[] = [];
    mesas.forEach((id) => {
      const m = mesaPorId.get(id);
      if (!m) return;
      vivas
        .filter((o) => o.id !== r.id && !ESTADOS_FINALES.includes(o.estado) && mesasDe(o).includes(id))
        .filter((o) => { const oi = minutos(h5(o.hora)); return solapa(ini, fin, oi, oi + (o.duracion_min || 120)); })
        .forEach((o) => lineas.push(`La mesa ${nombreMesa(m)} ya tiene a ${nombreDe(o)} (${h5(o.hora)}, ${o.pax} pax) en esa franja.`));
      bloqueos
        .filter((b) => (b.mesa_id ? b.mesa_id === id : b.sala_id ? b.sala_id === m.sala_id : true))
        .filter((b) => solapa(ini, fin, minutos(h5(b.hora_inicio)), b.hora_fin >= "23:59" ? 36 * 60 : minutos(h5(b.hora_fin))))
        .forEach((b) => lineas.push(`La mesa ${nombreMesa(m)} está bloqueada en esa franja (${b.motivo || "sin motivo"}).`));
    });
    return [...new Set(lineas)];
  }

  function terminarArrastre(a: Arrastre) {
    const r = reservas.find((x) => x.id === a.id);
    if (!r) return;
    if (a.modo === "estirar") {
      if (a.dur === a.dur0) return;
      // Al estirar también se avisa si la barra pisa la siguiente reserva o un bloqueo
      const lineas = a.dur > a.dur0 ? choquesEn(r, mesasDe(r), a.hora0, a.hora0 + a.dur) : [];
      const hacer = () => aplicarDuracion(r, a.dur);
      if (lineas.length) setConfirmar({ titulo: `¿Alargar a ${nombreDe(r)} igualmente?`, lineas, boton: "Cambiar igualmente", hacer });
      else hacer();
      return;
    }
    const fila = filas[a.filaIdx];
    let mesaNueva: string | null | undefined;
    if (fila?.tipo === "mesa") mesaNueva = fila.mesa.id;
    else if (fila?.tipo === "sinmesa") mesaNueva = null;
    const cambioMesa = mesaNueva !== undefined && mesaNueva !== a.mesaOrigen;
    const cambioHora = a.hora !== a.hora0;
    if (!cambioMesa && !cambioHora) return;
    if (!cambioMesa) mesaNueva = undefined;

    // Avisos antes de aplicar: solapes y bloqueos en TODAS las mesas finales a la hora nueva, y capacidad
    const finales = combinacionResultante(mesasDe(r), mesaNueva, a.mesaOrigen);
    const dur = r.duracion_min || 120;
    const lineas = choquesEn(r, finales, a.hora, a.hora + dur);
    if (cambioMesa && finales.length) {
      const ms = finales.map((id) => mesaPorId.get(id)).filter((m): m is Mesa => !!m);
      const cMin = ms.reduce((s, m) => s + m.cap_min, 0), cMax = ms.reduce((s, m) => s + m.cap_max, 0);
      if (ms.length && (r.pax > cMax || r.pax < cMin)) {
        const nombre = ms.length > 1 ? `La combinación ${ms.map(nombreMesa).join("+")}` : `La mesa ${nombreMesa(ms[0])}`;
        lineas.push(`${nombre} es de ${cMin}-${cMax} y la reserva es de ${r.pax}.`);
      }
    }
    const hacer = () => aplicarMover(r, a.hora, mesaNueva, a.mesaOrigen);
    if (lineas.length) setConfirmar({ titulo: `¿Mover a ${nombreDe(r)} igualmente?`, lineas, boton: "Mover igualmente", hacer });
    else hacer();
  }

  /* ---- popover de acciones rápidas (clic en una barra) ---- */
  function whatsapp(r: Reserva) {
    const c = r.reservas_clientes;
    let n = (c?.telefono || "").replace(/\D/g, "");
    if (!n) { avisar("El cliente no tiene teléfono."); return; }
    if (n.length === 9) n = "34" + n;
    const msg = `Hola ${c?.nombre ?? ""}, te escribimos de ${rest.nombre}. Tu reserva es el ${fmtFecha(r.fecha)} a las ${fmtHora(r.hora)} para ${r.pax} personas (localizador ${r.localizador}). ¿Nos la confirmas? Gracias.`;
    window.open(`https://wa.me/${n}?text=${encodeURIComponent(msg)}`, "_blank", "noopener,noreferrer");
  }
  async function trasAccion(res: { ok: boolean; error?: string }, okMsg?: string) {
    if (!res.ok) avisar(res.error || "No se ha podido guardar. Revisa la conexión.");
    else if (okMsg) avisar(okMsg);
    await recargarDia(restId, fecha);
  }

  /* ---- arrastre (pointer events; funciona con ratón y con dedo) ----
     Ratón: arrastra en cuanto se mueve 4 px; un clic sin mover abre el popover.
     Dedo: deslizar desplaza la rejilla; mantener pulsado 300 ms «coge» la barra; un toque abre el popover.
     Las posiciones se calculan en coordenadas del contenido (con el scroll), y la rejilla se
     desplaza sola cuando el puntero se acerca al borde. */
  const filaEnY = (y: number, filaIdxAnterior: number) => {
    const i = filas.findIndex((f) => y >= f.y && y < f.y + f.alto);
    if (i < 0) return y < 0 ? 0 : filaIdxAnterior;
    return filas[i].tipo === "sala" ? filaIdxAnterior : i;
  };
  /** Pantalla → contenido: x dentro de la pista de horas, y dentro del cuerpo de filas. */
  const aContenido = (cx: number, cy: number) => {
    const el = scrollRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: cx - rect.left - el.clientLeft + el.scrollLeft - labelW,
      y: cy - rect.top - el.clientTop + el.scrollTop - ALTO_CAB,
    };
  };
  const pararAuto = () => {
    if (temporizador.current) { clearTimeout(temporizador.current); temporizador.current = null; }
    if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; }
  };

  const empezar = (ev: React.PointerEvent, b: Barra, modo: "mover" | "estirar") => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    ev.stopPropagation();
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
    pararAuto();
    const dedo = ev.pointerType === "touch";
    const a: Arrastre = {
      id: b.r.id, mesaOrigen: b.mesaId, modo, pointerId: ev.pointerId,
      dedo, activo: !dedo, desplazado: false,
      x0: ev.clientX, y0: ev.clientY, xUlt: ev.clientX, yUlt: ev.clientY, xc0: aContenido(ev.clientX, ev.clientY).x,
      hora0: b.ini, dur0: b.fin - b.ini, filaIdx0: b.filaIdx,
      hora: b.ini, dur: b.fin - b.ini, filaIdx: b.filaIdx, movido: false,
    };
    arrRef.current = a;
    if (!dedo) { setArr(a); return; }
    // Con el dedo: si se mantiene quieto, la barra queda «cogida»
    temporizador.current = setTimeout(() => {
      temporizador.current = null;
      const x = arrRef.current;
      if (!x || x.id !== a.id || x.desplazado) return;
      const n = { ...x, activo: true };
      arrRef.current = n;
      setArr(n);
      try { navigator.vibrate?.(15); } catch { /* sin vibración */ }
    }, PULSACION_MS);
  };

  /** Recalcula hora / fila / duración con la posición del puntero (en pantalla). */
  const actualizar = (cx: number, cy: number) => {
    const a = arrRef.current;
    if (!a || !a.activo) return;
    const c = aContenido(cx, cy);
    const pasos = Math.round((c.x - a.xc0) / slotW);
    const n: Arrastre = { ...a, movido: a.movido || Math.abs(cx - a.x0) > 4 || Math.abs(cy - a.y0) > 4 || pasos !== 0 };
    if (a.modo === "mover") {
      // Como mucho, empezar a las 23:45 del mismo día: la hora no cambia de fecha
      const tope = Math.min(finMin - a.dur0, 1440 - PASO);
      n.hora = Math.max(iniMin, Math.min(tope, a.hora0 + pasos * PASO));
      n.filaIdx = filaEnY(c.y, a.filaIdx);
    } else {
      n.dur = Math.max(PASO, Math.min(DUR_MAX, finMin - a.hora0, a.dur0 + pasos * PASO));
    }
    arrRef.current = n;
    setArr(n);
  };

  /** Desplazamiento automático mientras el puntero está cerca del borde de la rejilla. */
  const velBorde = (): { vx: number; vy: number } => {
    const el = scrollRef.current;
    if (!el) return { vx: 0, vy: 0 };
    const r = el.getBoundingClientRect();
    const p = ultimoPuntero.current;
    const vel = (d: number) => Math.min(18, Math.ceil(d / 3) + 2);
    const izq = r.left + labelW + BORDE_AUTO, der = r.right - BORDE_AUTO;
    const arr = r.top + ALTO_CAB + BORDE_AUTO, aba = r.bottom - BORDE_AUTO;
    const vx = p.x < izq ? -vel(izq - p.x) : p.x > der ? vel(p.x - der) : 0;
    const vy = p.y < arr ? -vel(arr - p.y) : p.y > aba ? vel(p.y - aba) : 0;
    return { vx, vy };
  };
  const paso = () => {
    raf.current = null;
    const a = arrRef.current, el = scrollRef.current;
    if (!a || !a.activo || !el) return;
    const { vx, vy } = velBorde();
    if (!vx && !vy) return;
    el.scrollBy(vx, vy);
    actualizar(ultimoPuntero.current.x, ultimoPuntero.current.y);
    raf.current = requestAnimationFrame(paso);
  };

  const mover = (ev: React.PointerEvent) => {
    const a = arrRef.current;
    if (!a || ev.pointerId !== a.pointerId) return;
    if (a.dedo && !a.activo) {
      // Aún no se ha cogido la barra: el dedo desplaza la rejilla a mano (la barra tiene touch-action: none)
      const lejos = Math.abs(ev.clientX - a.x0) > 6 || Math.abs(ev.clientY - a.y0) > 6;
      scrollRef.current?.scrollBy(a.xUlt - ev.clientX, a.yUlt - ev.clientY);
      arrRef.current = { ...a, xUlt: ev.clientX, yUlt: ev.clientY, desplazado: a.desplazado || lejos };
      if (lejos && temporizador.current) { clearTimeout(temporizador.current); temporizador.current = null; }
      return;
    }
    ultimoPuntero.current = { x: ev.clientX, y: ev.clientY };
    actualizar(ev.clientX, ev.clientY);
    if (raf.current == null) raf.current = requestAnimationFrame(paso);
  };
  const soltar = (ev: React.PointerEvent) => {
    const a = arrRef.current;
    if (!a || ev.pointerId !== a.pointerId) return;
    pararAuto();
    arrRef.current = null;
    setArr(null);
    if (a.dedo && !a.activo) {
      if (!a.desplazado) setPopover({ id: a.id, x: ev.clientX, y: ev.clientY }); // toque
      return;
    }
    if (!a.movido) {
      if (!a.dedo) setPopover({ id: a.id, x: ev.clientX, y: ev.clientY }); // clic
      return;
    }
    terminarArrastre(a);
  };
  const cancelarArrastre = () => { pararAuto(); arrRef.current = null; setArr(null); };

  /* ---- resumen por turno (pie) ---- */
  const aforoMesas = mesasActivas.reduce((s, m) => s + m.cap_max, 0);
  // Reservas y pax cuentan como en Mes (reservas_ocupacion_mes): todo menos cancelada, no show y
  // lista de espera, incluidas las terminadas. Las terminadas solo salen de «mesas ocupadas ahora».
  const resumenTurno = (t: Turno) => {
    const rs = vivas.filter((r) => r.turno_id === t.id || (!r.turno_id && enTurno(t, minutos(h5(r.hora)))));
    const activas = rs.filter((r) => !ESTADOS_FINALES.includes(r.estado));
    const pax = rs.reduce((s, r) => s + r.pax, 0);
    const mesasOc = new Set(activas.flatMap((r) => mesasDe(r).filter((id) => mesaPorId.has(id))));
    const aforo = t.max_pax_total || aforoMesas || 1;
    return { rs, activas, pax, aforo, mesasOc: mesasOc.size, pct: Math.round((pax / aforo) * 100), sinMesa: activas.filter((r) => !mesasDe(r).some((id) => mesaPorId.has(id))) };
  };

  if (!cargado) return <div className="spinner" />;

  // Arrastre visible: ratón en cuanto se mueve; dedo en cuanto se ha cogido la barra
  const vis = arr && arr.activo && (arr.movido || arr.dedo) ? arr : null;
  const barraArrastrada = vis ? barras.find((b) => b.r.id === vis.id && b.mesaId === vis.mesaOrigen) : null;
  const reservaPopover = popover ? reservas.find((r) => r.id === popover.id) ?? null : null;

  return (
    <div className="cg">
      {/* controles */}
      <div className="cg-controles">
        <div className="cg-titulo">
          <b>Cronograma</b> · {fmtFechaLarga(fecha)}
          <span className="cg-sub"> · {vivas.length} reservas · {vivas.reduce((s, r) => s + r.pax, 0)} pax</span>
        </div>
        <div className="cg-zoom">
          <button onClick={() => cambiarZoom(-1)} disabled={zoom === 0} aria-label="Reducir">−</button>
          <span>{slotW}px / 15′</span>
          <button onClick={() => cambiarZoom(1)} disabled={zoom === ZOOMS.length - 1} aria-label="Ampliar">+</button>
        </div>
        {esHoy && ahoraMin > iniMin && ahoraMin < finMin ? (
          <button className="cg-btn" onClick={() => irAMinuto(ahoraMin - 60)}>Ir a ahora</button>
        ) : null}
        {turnosDia.map((t) => (
          <button key={t.id} className={`cg-btn ${turnoFoco === t.id ? "activo" : ""}`} onClick={() => { setTurnoFoco(t.id); irAMinuto(minutos(h5(t.hora_inicio)) - 30); }}>
            {t.nombre}
          </button>
        ))}
      </div>

      {!turnosDia.length ? <div className="aviso info">Este día no tiene turnos activos; se muestra de {aHora(iniMin)} a {aHora(finMin)}.</div> : null}

      {/* rejilla */}
      <div
        className={`cg-scroll ${vis ? "arrastrando" : ""}`}
        ref={scrollRef}
        style={{ ["--sw" as string]: `${slotW}px`, ["--eti" as string]: `${labelW}px` }}
      >
        {/* cabecera de horas */}
        <div className="cg-cab" style={{ width: labelW + anchoPista, height: ALTO_CAB }}>
          <div className="cg-esquina" style={{ width: labelW }}>Mesa (pax)</div>
          <div className="cg-cab-pista" style={{ width: anchoPista }}>
            {turnosDia.map((t) => {
              const a = minutos(h5(t.hora_inicio)), b = finServicio(t);
              return (
                <div
                  key={t.id}
                  className={`cg-turno ${turnoFoco === t.id ? "foco" : ""}`}
                  style={{ left: xDe(a), width: xDe(b) - xDe(a), background: t.color || undefined }}
                  title={`${t.nombre} · ${h5(t.hora_inicio)}–${aHora(b)}`}
                >
                  {t.nombre}
                </div>
              );
            })}
            {Array.from({ length: nSlots }, (_, i) => {
              const min = iniMin + i * PASO;
              const mm = min % 60;
              const enPunto = mm === 0;
              if (!enPunto && slotW < 22 && mm !== 30) return null;
              return (
                <div key={i} className={`cg-hora ${enPunto ? "punto" : ""}`} style={{ left: i * slotW, width: slotW }}>
                  {enPunto ? String(Math.floor(min / 60) % 24) : String(mm)}
                </div>
              );
            })}
            {esHoy && ahoraMin > iniMin && ahoraMin < finMin ? (
              <div className="cg-ahora-eti" style={{ left: xDe(ahoraMin) }}>{aHora(ahoraMin)}</div>
            ) : null}
          </div>
        </div>

        {/* cuerpo */}
        <div className="cg-cuerpo" style={{ width: labelW + anchoPista, height: altoTotal }}>
          {filas.map((f, i) => {
            if (f.tipo === "sala") {
              const plegada = plegadas.includes(f.sala.id);
              return (
                <div key={"s" + f.sala.id} className="cg-fila sala" style={{ height: f.alto }}>
                  <button className="cg-eti sala" style={{ width: labelW }} onClick={() => plegar(f.sala.id)}>
                    <span className="cg-flecha">{plegada ? "▸" : "▾"}</span>
                    <span className="cg-sala-nombre">{f.sala.nombre}</span>
                    <span className="cg-sala-n">{f.nReservas}/{f.nMesas}</span>
                  </button>
                  <div className="cg-pista sala" style={{ width: anchoPista }} />
                </div>
              );
            }
            if (f.tipo === "sinmesa") {
              const n = barras.filter((b) => b.filaIdx === 0).length;
              return (
                <div key="sinmesa" className="cg-fila sinmesa" style={{ height: f.alto }}>
                  <div className="cg-eti sinmesa" style={{ width: labelW }}>
                    Sin mesa {n ? <span className="cg-badge">{n}</span> : null}
                  </div>
                  <div className="cg-pista sinmesa" style={{ width: anchoPista }} />
                </div>
              );
            }
            const esDestino = vis?.modo === "mover" && vis.filaIdx === i;
            return (
              <div key={f.mesa.id} className={`cg-fila mesa ${esDestino ? "destino" : ""}`} style={{ height: f.alto }}>
                <div className="cg-eti" style={{ width: labelW }} title={`${f.sala.nombre} · ${f.mesa.forma}${f.mesa.reservable_online ? "" : " · no reservable online"}`}>
                  <span className="cg-mesa-nombre">{f.mesa.etiqueta || f.mesa.nombre}</span>
                  <span className="cg-mesa-cap">({f.mesa.cap_min}-{f.mesa.cap_max})</span>
                  {!f.mesa.reservable_online ? <span className="cg-mesa-web">web</span> : null}
                </div>
                <div className="cg-pista" style={{ width: anchoPista }} />
              </div>
            );
          })}

          {/* capa de dibujo: fuera de turno, bloqueos, barras y línea de ahora */}
          <div className="cg-capa" style={{ left: labelW, width: anchoPista, height: altoTotal }}>
            {fueraTurno.map(([a, b]) => (
              <div key={a} className="cg-fuera" style={{ left: xDe(a), width: xDe(b) - xDe(a) }} />
            ))}
            {bloqueosPintados.map((b) => (
              <div
                key={b.key}
                className="cg-bloqueo"
                title={b.motivo}
                style={{ left: xDe(b.ini), width: xDe(b.fin) - xDe(b.ini), top: filas[b.filaIdx].y, height: filas[b.filaIdx].alto }}
              >
                <span>🔒</span>
              </div>
            ))}
            {barras.map((b) => {
              const enArrastre = !!vis && b.r.id === vis.id && b.mesaId === vis.mesaOrigen;
              const ini = enArrastre ? vis.hora : b.ini;
              const dur = enArrastre ? vis.dur : b.fin - b.ini;
              const filaIdx = enArrastre && vis.modo === "mover" ? vis.filaIdx : b.filaIdx;
              const carril = enArrastre && vis.modo === "mover" && vis.filaIdx !== b.filaIdx ? 0 : b.carril;
              const fila = filas[filaIdx];
              const e = estadoDe(b.r.estado);
              const w = Math.max(slotW - 2, (dur / PASO) * slotW - 2);
              const lleva = esHoy ? minutosEnSala(b.r, ahoraMin) : null;
              const c = b.r.reservas_clientes;
              const texto = `${b.r.pax} · ${nombreDe(b.r)}`;
              const tip = [
                `${h5(b.r.hora)} · ${b.r.pax} pax · ${nombreDe(b.r)} · ${e.texto}`,
                `${dur} min${b.mesaId ? ` · mesa ${mesaPorId.get(b.mesaId)?.etiqueta || mesaPorId.get(b.mesaId)?.nombre}` : " · sin mesa"}`,
                c?.telefono ? `Tel: ${c.telefono}` : "",
                b.r.alergias || c?.alergias ? `Alergias: ${b.r.alergias || c?.alergias}` : "",
                b.r.notas_cliente ? `Cliente: ${b.r.notas_cliente}` : "",
                b.r.notas_internas ? `Notas: ${b.r.notas_internas}` : "",
                lleva != null ? `Lleva ${lleva} min en sala` : "",
              ].filter(Boolean).join("\n");
              return (
                <div
                  key={b.r.id + ":" + (b.mesaId ?? "x")}
                  className={`cg-barra ${enArrastre ? "fantasma" : ""} ${b.secundaria ? "secundaria" : ""} ${e.id === "tarjeta_pendiente" ? "borde" : ""} ${resaltada === b.r.id ? "resaltada" : ""} ${popover?.id === b.r.id ? "abierta" : ""}`}
                  style={{
                    left: xDe(ini) + 1, width: w,
                    top: fila.y + carril * ALTO_FILA + 3, height: ALTO_FILA - 6,
                    background: e.color, color: colorTexto(e.color),
                    borderColor: e.borde || "transparent",
                  }}
                  title={tip}
                  onPointerDown={(ev) => empezar(ev, b, "mover")}
                  onPointerMove={mover}
                  onPointerUp={soltar}
                  onPointerCancel={cancelarArrastre}
                  onDoubleClick={() => { cancelarArrastre(); setPopover(null); abrirReserva(b.r.id); }}
                  onContextMenu={(ev) => ev.preventDefault()}
                  draggable={false}
                >
                  <span className="cg-barra-txt">
                    {b.secundaria ? "🔗 " : ""}{texto}
                  </span>
                  <span className="cg-barra-ico">
                    {lleva != null && w > 110 ? <i className="cg-lleva">{lleva}′</i> : null}
                    {b.r.origen === "online" ? "🔔" : ""}
                    {b.r.alergias || c?.alergias ? "⚠" : ""}
                    {b.r.notas_cliente ? "💬" : ""}
                    {b.r.notas_internas ? "📝" : ""}
                    {c?.vip ? "★" : ""}
                  </span>
                  {!b.secundaria ? (
                    /* El asa captura el puntero; los pointermove/up suben por burbuja hasta la barra */
                    <span className="cg-asa" onPointerDown={(ev) => empezar(ev, b, "estirar")} title="Estirar para cambiar la duración" />
                  ) : null}
                  {enArrastre ? (
                    <span className="cg-globo">{aHora(ini)}–{aHora(ini + dur)} · {dur}′</span>
                  ) : null}
                </div>
              );
            })}
            {esHoy && ahoraMin > iniMin && ahoraMin < finMin ? <div className="cg-ahora" style={{ left: xDe(ahoraMin) }} /> : null}
          </div>
        </div>
      </div>

      {/* leyenda y ayuda */}
      <div className="leyenda cg-leyenda">
        {[...new Set(vivas.map((r) => r.estado))].map((id) => { const e = estadoDe(id); return <span key={id}><i style={{ background: e.color, border: e.borde ? `1px solid ${e.borde}` : undefined }} />{e.texto}</span>; })}
        <span className="cg-ayuda">Clic: acciones · doble clic: editar · arrastra para cambiar hora o mesa (con el dedo, mantén pulsado) · estira el borde derecho para la duración</span>
      </div>

      {/* resumen por turno */}
      {turnosDia.length ? (
        <div className="cg-pie">
          {turnosDia.map((t) => {
            const s = resumenTurno(t);
            const nivel = s.pct >= 100 ? "rojo" : s.pct >= 80 ? "ambar" : "verde";
            return (
              <div key={t.id} className="cg-pie-turno">
                <div className="cg-pie-nombre">{t.nombre} <span>{h5(t.hora_inicio)}–{h5(t.hora_fin)}</span></div>
                <div className="cg-pie-datos">
                  <b>{s.rs.length}</b> reservas · <b>{s.pax}</b>/{s.aforo} pax · <b>{s.mesasOc}</b>/{mesasActivas.length} mesas
                  {s.sinMesa.length ? <span className="cg-pie-aviso"> · {s.sinMesa.length} sin mesa</span> : null}
                </div>
                <div className={`cg-ocup ${nivel}`}><i style={{ width: `${Math.min(100, s.pct)}%` }} /><span>{s.pct} %</span></div>
                <button className="cg-btn" onClick={() => setResumen(t)}>Resumen turno {t.nombre.toLowerCase()}</button>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* confirmación de movimiento con avisos */}
      {confirmar ? (
        <div className="rsp-modal" onClick={(e) => { if (e.target === e.currentTarget) setConfirmar(null); }}>
          <div className="modal cg-modal-peq">
            <h2>{confirmar.titulo}</h2>
            <ul className="cg-avisos">{confirmar.lineas.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <div className="acciones">
              <button className="primaria" onClick={() => { const h = confirmar.hacer; setConfirmar(null); h(); }}>{confirmar.boton}</button>
              <button onClick={() => setConfirmar(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* resumen de turno */}
      {resumen ? (
        <ResumenTurno
          turno={resumen}
          fecha={fecha}
          datos={resumenTurno(resumen)}
          salas={salas.filter((s) => s.activa)}
          mesaPorId={mesaPorId}
          nMesas={mesasActivas.length}
          abrir={(id) => { setResumen(null); abrirReserva(id); }}
          cerrar={() => setResumen(null)}
        />
      ) : null}

      {/* popover de acciones rápidas */}
      {popover && reservaPopover ? (
        <PopoverReserva
          key={reservaPopover.id}
          reserva={reservaPopover}
          x={popover.x}
          y={popover.y}
          cerrar={() => setPopover(null)}
          onEstado={async (estado, extra) => { await trasAccion(await cambiarEstado(reservaPopover.id, estado, { pax_llegados: extra?.pax_llegados ?? null })); }}
          onEditar={() => { setPopover(null); abrirReserva(reservaPopover.id); }}
          onLiberar={async () => { await trasAccion(await liberar(reservaPopover.id), "Mesa liberada."); }}
          onDesplazar={() => {
            setPopover(null);
            setResaltada(reservaPopover.id);
            avisar("Arrastra la barra a otra hora o mesa (con el dedo: mantén pulsado y arrastra).");
          }}
          onWhatsApp={() => whatsapp(reservaPopover)}
        />
      ) : null}

      {barraArrastrada && vis?.modo === "mover" ? <div className="cg-sr" aria-live="polite">Moviendo a {nombreDe(barraArrastrada.r)} a las {aHora(vis.hora)}</div> : null}
    </div>
  );
}

/* ==================== Modal «Resumen turno» ==================== */

function ResumenTurno(props: {
  turno: Turno;
  fecha: string;
  datos: { rs: Reserva[]; activas: Reserva[]; pax: number; aforo: number; mesasOc: number; pct: number; sinMesa: Reserva[] };
  salas: Sala[];
  mesaPorId: Map<string, Mesa>;
  nMesas: number;
  abrir: (id: string) => void;
  cerrar: () => void;
}) {
  const { turno, fecha, datos, salas, mesaPorId, nMesas, abrir, cerrar } = props;
  const { activas } = datos;

  // Por sala
  const porSala = salas.map((s) => {
    const ids = new Set((s.mesas || []).filter((m) => m.activa).map((m) => m.id));
    const rs = datos.rs.filter((r) => mesasDe(r).some((id) => ids.has(id)));
    return { sala: s, n: rs.length, pax: rs.reduce((a, r) => a + r.pax, 0), mesas: new Set(rs.flatMap((r) => mesasDe(r).filter((id) => ids.has(id)))).size, total: ids.size };
  });
  // Por estado
  const porEstado: Record<string, { n: number; pax: number }> = {};
  datos.rs.forEach((r) => { const d = (porEstado[r.estado] = porEstado[r.estado] || { n: 0, pax: 0 }); d.n++; d.pax += r.pax; });
  // Por media hora
  const porHora: Record<string, { n: number; pax: number }> = {};
  datos.rs.forEach((r) => { const m = minutos(h5(r.hora)); const k = aHora(Math.floor(m / 30) * 30); const d = (porHora[k] = porHora[k] || { n: 0, pax: 0 }); d.n++; d.pax += r.pax; });
  const horas = Object.keys(porHora).sort();
  const maxPaxHora = Math.max(1, ...horas.map((h) => porHora[h].pax));
  // Avisos de sala: alergias, notas, VIP, grupos
  const avisos = activas
    .map((r) => {
      const c = r.reservas_clientes;
      const partes: string[] = [];
      if (r.alergias || c?.alergias) partes.push(`⚠ ${r.alergias || c?.alergias}`);
      if (c?.vip) partes.push("★ VIP");
      if (r.notas_cliente) partes.push(`💬 ${r.notas_cliente}`);
      if (r.notas_internas) partes.push(`📝 ${r.notas_internas}`);
      if (r.pax >= 8) partes.push(`👥 grupo de ${r.pax}`);
      return partes.length ? { r, texto: partes.join(" · ") } : null;
    })
    .filter((x): x is { r: Reserva; texto: string } => !!x)
    .sort((a, b) => (a.r.hora < b.r.hora ? -1 : 1));

  const mesaTxt = (r: Reserva) => {
    const ms = mesasDe(r).map((id) => mesaPorId.get(id)).filter((m): m is Mesa => !!m);
    return ms.length ? ms.map((m) => m.etiqueta || m.nombre).join("+") : "—";
  };

  return (
    <div className="rsp-modal" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <div className="modal cg-modal">
        <button className="cerrar" onClick={cerrar} aria-label="Cerrar">✕</button>
        <h2>Resumen turno {turno.nombre.toLowerCase()}</h2>
        <div className="cg-res-sub">{fmtFechaLarga(fecha)} · {h5(turno.hora_inicio)}–{h5(turno.hora_fin)}</div>

        <div className="cg-res-kpis">
          <div><b>{datos.rs.length}</b><span>reservas</span></div>
          <div><b>{datos.pax}</b><span>pax de {datos.aforo}</span></div>
          <div><b>{datos.mesasOc}</b><span>mesas de {nMesas}</span></div>
          <div><b>{datos.pct} %</b><span>ocupación</span></div>
          {datos.sinMesa.length ? <div className="alerta"><b>{datos.sinMesa.length}</b><span>sin mesa</span></div> : null}
        </div>

        <h4>Por sala</h4>
        <table className="cg-tabla">
          <thead><tr><th>Sala</th><th>Reservas</th><th>Pax</th><th>Mesas</th></tr></thead>
          <tbody>
            {porSala.map((x) => (
              <tr key={x.sala.id}><td>{x.sala.nombre}</td><td>{x.n}</td><td>{x.pax}</td><td>{x.mesas}/{x.total}</td></tr>
            ))}
            {datos.sinMesa.length ? <tr className="alerta"><td>Sin mesa</td><td>{datos.sinMesa.length}</td><td>{datos.sinMesa.reduce((a, r) => a + r.pax, 0)}</td><td>—</td></tr> : null}
          </tbody>
        </table>

        <h4>Por estado</h4>
        <div className="chips">
          {Object.entries(porEstado).sort((a, b) => estadoDe(a[0]).orden - estadoDe(b[0]).orden).map(([id, d]) => {
            const e = estadoDe(id);
            return <span key={id} className="chip estado" style={{ background: e.color, color: colorTexto(e.color), border: e.borde ? `1px solid ${e.borde}` : undefined }}>{e.texto} {d.n} · {d.pax} pax</span>;
          })}
        </div>

        <h4>Llegadas por media hora</h4>
        <div className="cg-horas">
          {horas.map((h) => (
            <div key={h} className="fila-bar">
              <span className="eti">{h}</span>
              <span className="pista"><i className="seg" style={{ width: `${(porHora[h].pax / maxPaxHora) * 100}%` }} /></span>
              <span className="val">{porHora[h].pax} pax · {porHora[h].n}</span>
            </div>
          ))}
          {!horas.length ? <div className="vacio">Sin reservas en este turno.</div> : null}
        </div>

        {datos.sinMesa.length ? (
          <>
            <h4>Sin mesa asignada</h4>
            <div className="lista-simple">
              {datos.sinMesa.map((r) => (
                <div key={r.id} className="item cg-item" onClick={() => abrir(r.id)}>
                  <span className="tit">{h5(r.hora)} · {nombreDe(r)} · {r.pax} pax</span>
                  <span className="det">{estadoDe(r.estado).texto}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {avisos.length ? (
          <>
            <h4>Avisos de sala</h4>
            <div className="lista-simple">
              {avisos.map(({ r, texto }) => (
                <div key={r.id} className="item cg-item" onClick={() => abrir(r.id)}>
                  <span className="tit">{h5(r.hora)} · {mesaTxt(r)} · {nombreDe(r)} ({r.pax})</span>
                  <span className="det cg-aviso-txt">{texto}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
