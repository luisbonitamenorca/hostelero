"use client";

/* Armazón del panel de Reservas: barra superior (restaurante, buscador global, contadores por
   turno, fecha, nueva reserva, tema), pestañas con contador del Inbox, atajos de teclado y los
   modales que cualquier sección puede pedir por evento (reserva, ficha de cliente).
   Guía: docs/reservas-v2-look.md §1 y §2 «Barra superior». */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./acciones";
import * as comunes from "./acciones/comunes";
import type { ContadorTurno, ResultadoBusqueda } from "./acciones/comunes";
import { EST, hoyISO, type Cliente, type Reserva, type Restaurante, type Sala, type Turno } from "./tipos";
import {
  anunciarTurno,
  enCampoDeTexto,
  estadoDe,
  fmtFechaBarra,
  fmtFechaCorta,
  guardarPref,
  leerPref,
  pedirRecarga,
  sumarDias,
  useRestauranteRecordado,
  useTema,
  type Ctx,
  type DetalleNuevaReserva,
} from "./lib-reservas";
import { ModalReserva } from "./componentes/modal-reserva";
import { FichaCliente } from "./componentes/ficha-cliente";
import { useInboxContador } from "./secciones/inbox";
import SecDia from "./secciones/dia";
import SecCronograma from "./secciones/cronograma";
import SecMes from "./secciones/mes";
import SecInbox from "./secciones/inbox";
import SecClientes from "./secciones/clientes";
import SecEspera from "./secciones/espera";
import SecInformes from "./secciones/informes";
import SecAjustes from "./secciones/ajustes";
import "./secciones/tema.css";

/* ==================== Pestañas ==================== */

/* Registro de pestañas (orden y nombres que la sala reconoce de Cover). */
const TABS = [
  { id: "dia", nombre: "Día", Sec: SecDia },
  { id: "cronograma", nombre: "Cronograma", Sec: SecCronograma },
  { id: "mes", nombre: "Mes", Sec: SecMes },
  { id: "inbox", nombre: "Inbox", Sec: SecInbox },
  { id: "clientes", nombre: "Clientes", Sec: SecClientes },
  { id: "espera", nombre: "Lista de espera", Sec: SecEspera },
  { id: "informes", nombre: "Informes", Sec: SecInformes },
  { id: "ajustes", nombre: "Ajustes", Sec: SecAjustes },
] as const;

type Tab = (typeof TABS)[number]["id"];
const esTab = (v: string): v is Tab => TABS.some((t) => t.id === v);

/* Pestañas en las que la fecha y los contadores de la barra tienen sentido. */
const CON_FECHA: Tab[] = ["dia", "cronograma", "mes", "espera"];

const CONTADORES_MS = 60000;

/* ==================== Tipos locales ==================== */

type Modal = {
  rest: Restaurante;
  salas: Sala[];
  turnos: Turno[];
  reserva: Reserva | null;
  mesaInicial?: string | null;
  horaInicial?: string | null;
  clienteInicial?: Cliente | null;
  fecha: string;
};

/* ==================== Iconos (inline, sin dependencias) ==================== */

const IcoPax = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <circle cx="5.5" cy="5" r="2.6" fill="currentColor" />
    <circle cx="11" cy="5.6" r="2.1" fill="currentColor" opacity=".75" />
    <path d="M1 13.5c0-2.6 2-4.3 4.5-4.3S10 10.9 10 13.5z" fill="currentColor" />
    <path d="M10.2 13.5c0-1.7-.6-3-1.6-3.9.7-.3 1.5-.5 2.4-.5 2.2 0 4 1.5 4 4.4z" fill="currentColor" opacity=".75" />
  </svg>
);
const IcoMesas = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2" fill="currentColor" />
    <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.2" fill="currentColor" />
    <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.2" fill="currentColor" />
    <rect x="9" y="9" width="5.5" height="5.5" rx="1.2" fill="currentColor" />
  </svg>
);
const IcoLupa = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <circle cx="6.8" cy="6.8" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    <path d="M10.4 10.4 14.5 14.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const IcoSol = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
    <circle cx="8" cy="8" r="3.2" fill="currentColor" />
    <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M8 1.2v2M8 12.8v2M1.2 8h2M12.8 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4" />
    </g>
  </svg>
);
const IcoLuna = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
    <path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" fill="currentColor" />
  </svg>
);

/* ==================== Helpers ==================== */

/** Nivel de ocupación para colorear: ámbar desde el 80 %, rojo al 100 %. */
function nivel(valor: number, max: number): "" | "casi" | "lleno" {
  if (!max) return "";
  const r = valor / max;
  return r >= 1 ? "lleno" : r >= 0.8 ? "casi" : "";
}

/** ¿Hay alguna capa modal abierta (modal, popover, ficha)? Los atajos globales no actúan entonces. */
function hayCapaAbierta(): boolean {
  return typeof document !== "undefined" && !!document.querySelector('.rsp-modal, .fc-fondo, [role="dialog"]');
}

/* ==================== Panel ==================== */

export default function PanelReservas(props: { restaurantes: Restaurante[]; userId: string; esDireccion: boolean }) {
  const [rests, setRests] = useState(props.restaurantes);
  const [restId, setRestId] = useRestauranteRecordado(props.restaurantes);
  const rest = rests.find((r) => r.id === restId) ?? rests[0];
  const [fecha, setFecha] = useState(hoyISO());
  // Último «hoy» visto: si el panel pasa la noche abierto, al cambiar de día se avanza la fecha.
  const hoyRef = useRef(hoyISO());
  const [tab, setTab] = useState<Tab>("dia");
  const [tema, alternarTema] = useTema();
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Contadores por turno de la barra y turno activo (lo escuchan Día y Cronograma).
  const [contadores, setContadores] = useState<ContadorTurno[]>([]);
  const [turnoActivo, setTurnoActivo] = useState<string | null>(null);
  const [cupoOcupado, setCupoOcupado] = useState<string | null>(null);

  // Modales que pide cualquier sección por evento.
  const [modal, setModal] = useState<Modal | null>(null);
  const [ficha, setFicha] = useState<string | null>(null);
  const abriendo = useRef(false);
  // La ficha sigue montada (oculta) mientras el modal está abierto; su Esc no debe cerrarla.
  const modalRef = useRef<Modal | null>(modal);
  modalRef.current = modal;

  // Inbox: no leídos (el hook sondea aunque la pestaña no esté abierta; la sección también lo emite).
  const inboxHook = useInboxContador(rest?.id ?? null);
  const [inboxN, setInboxN] = useState(0);
  useEffect(() => setInboxN(inboxHook), [inboxHook]);

  const fechaRef = useRef<HTMLInputElement | null>(null);
  const buscadorRef = useRef<HTMLInputElement | null>(null);

  const ctx: Ctx = useMemo(
    () => ({ restaurantes: rests, userId: props.userId, esDireccion: props.esDireccion }),
    [rests, props.userId, props.esDireccion],
  );

  const avisar = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  /* ---- pestaña recordada ---- */
  useEffect(() => {
    const ultima = leerPref<string>("tab", "dia");
    if (esTab(ultima)) setTab(ultima);
  }, []);

  const cambiarTab = useCallback((id: Tab) => {
    setTab(id);
    guardarPref("tab", id);
  }, []);

  /* ---- eventos entre secciones ---- */

  // Cambio de pestaña: window 'rsv:tab' (detail = id, cancelable).
  useEffect(() => {
    const onTab = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail;
      if (typeof id === "string" && esTab(id)) { e.preventDefault(); cambiarTab(id); }
    };
    window.addEventListener("rsv:tab", onTab);
    return () => window.removeEventListener("rsv:tab", onTab);
  }, [cambiarTab]);

  // Ajustes guarda el restaurante → actualizamos nuestra copia.
  useEffect(() => {
    const onRest = (e: Event) => {
      const r = (e as CustomEvent<Restaurante>).detail;
      if (r?.id) setRests((xs) => xs.map((x) => (x.id === r.id ? r : x)));
    };
    window.addEventListener("rsv:restaurante", onRest);
    return () => window.removeEventListener("rsv:restaurante", onRest);
  }, []);

  // Contador del Inbox (lo emite la sección o el hook).
  useEffect(() => {
    const h = (e: Event) => {
      const n = (e as CustomEvent<unknown>).detail;
      if (typeof n === "number") setInboxN(n);
    };
    window.addEventListener("rsv:inbox-contador", h);
    return () => window.removeEventListener("rsv:inbox-contador", h);
  }, []);

  // Turno activo: si una sección lo anuncia, la barra lo refleja.
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<string | null>).detail;
      setTurnoActivo(typeof id === "string" && id ? id : null);
    };
    window.addEventListener("rsv:turno", h);
    return () => window.removeEventListener("rsv:turno", h);
  }, []);

  /* ---- contadores de la barra ---- */

  // Nº de petición: se descartan respuestas atrasadas (otro día, otro restaurante o una carga
  // que salió antes de tocar el interruptor de cupo).
  const pet = useRef(0);
  const cargarContadores = useCallback(async () => {
    if (!rest?.id) return;
    const n = ++pet.current;
    try {
      const c = await comunes.contadoresDia(rest.id, fecha);
      if (n === pet.current) setContadores(c);
    } catch {
      /* sin red: se mantienen los últimos */
    }
  }, [rest?.id, fecha]);

  /** Cambio de día natural con el panel abierto: si la barra estaba en «hoy», pasa al nuevo hoy. */
  const comprobarHoy = useCallback(() => {
    const h = hoyISO();
    if (h === hoyRef.current) return;
    const anterior = hoyRef.current;
    hoyRef.current = h;
    setFecha((f) => (f === anterior ? h : f));
  }, []);

  useEffect(() => {
    cargarContadores();
    const t = setInterval(() => {
      comprobarHoy();
      if (document.visibilityState === "visible") cargarContadores();
    }, CONTADORES_MS);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      comprobarHoy();
      cargarContadores();
    };
    const onRecarga = () => cargarContadores();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("rsv:recargar", onRecarga);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("rsv:recargar", onRecarga);
    };
  }, [cargarContadores, comprobarHoy]);

  // Al cambiar de día o de restaurante, el turno activo deja de tener sentido si ya no existe
  // (también cuando el día nuevo no tiene turnos: contadores vacío).
  useEffect(() => {
    if (turnoActivo && !contadores.some((c) => c.turno_id === turnoActivo)) {
      setTurnoActivo(null);
      anunciarTurno(null);
    }
  }, [contadores, turnoActivo]);

  /** Cambio de restaurante: fuera los contadores y el turno del anterior antes de recargar. */
  function cambiarRestaurante(id: string) {
    pet.current++;
    setContadores([]);
    setTurnoActivo(null);
    anunciarTurno(null);
    setRestId(id);
  }

  function elegirTurno(id: string) {
    const nuevo = turnoActivo === id ? null : id;
    setTurnoActivo(nuevo);
    anunciarTurno(nuevo);
  }

  async function alternarCupo(c: ContadorTurno) {
    if (cupoOcupado) return;
    const cerrar = !c.cerrado;
    setCupoOcupado(c.turno_id);
    // Optimista: la sala ve el interruptor moverse al instante.
    setContadores((xs) => xs.map((x) => (x.turno_id === c.turno_id ? { ...x, cerrado: cerrar } : x)));
    // Invalida las cargas de contadores en vuelo: no deben deshacer el cambio optimista.
    pet.current++;
    let r: { ok: boolean; error?: string };
    try {
      r = await comunes.alternarCupo(rest.id, fecha, c.turno_id, cerrar);
    } catch {
      r = { ok: false, error: "Sin conexión: no se ha cambiado el cupo." };
    } finally {
      setCupoOcupado(null);
    }
    if (!r.ok) {
      setContadores((xs) => xs.map((x) => (x.turno_id === c.turno_id ? { ...x, cerrado: c.cerrado } : x)));
      avisar(r.error ?? "No se ha podido cambiar el cupo.");
      void cargarContadores();
      return;
    }
    avisar(cerrar ? `${c.nombre}: cupo cerrado para ${fmtFechaCorta(fecha)}.` : `${c.nombre}: cupo abierto para ${fmtFechaCorta(fecha)}.`);
    // pedirRecarga dispara 'rsv:recargar', que también recarga los contadores de la barra.
    pedirRecarga();
  }

  /* ---- fecha ---- */

  const moverDia = useCallback((d: number) => setFecha((f) => sumarDias(f, d)), []);
  const irHoy = useCallback(() => setFecha(hoyISO()), []);

  function abrirCalendario() {
    const el = fechaRef.current;
    if (!el) return;
    try {
      if (typeof el.showPicker === "function") el.showPicker();
      else el.focus();
    } catch {
      el.focus();
    }
  }

  /* ---- modal de reserva y ficha de cliente ---- */

  /** Carga salas y turnos del restaurante y abre el modal. `restDe` permite abrir una reserva de
      otro restaurante sin cambiar el seleccionado en la barra. */
  const abrirModal = useCallback(
    async (opts: Partial<Omit<Modal, "salas" | "turnos" | "rest">> & { rest?: Restaurante }) => {
      if (abriendo.current) return;
      abriendo.current = true;
      try {
        const restDe = opts.rest ?? rest;
        const { salas, turnos } = await api.cargarLocal(restDe.id);
        setModal({
          rest: restDe,
          salas: (salas as unknown as Sala[]).filter((s) => s.activa),
          turnos: turnos as Turno[],
          reserva: opts.reserva ?? null,
          mesaInicial: opts.mesaInicial ?? null,
          horaInicial: opts.horaInicial ?? null,
          clienteInicial: opts.clienteInicial ?? null,
          fecha: opts.fecha ?? fecha,
        });
      } catch {
        avisar("No se ha podido abrir la reserva.");
      } finally {
        abriendo.current = false;
      }
    },
    [rest, fecha, avisar],
  );

  const abrirNueva = useCallback((detalle: DetalleNuevaReserva = {}) => {
    (async () => {
      let cli: Cliente | null = null;
      if (detalle.clienteId) {
        try {
          cli = await comunes.cargarCliente(detalle.clienteId);
        } catch {
          avisar("No se ha podido cargar el cliente.");
          return;
        }
      }
      await abrirModal({ reserva: null, clienteInicial: cli, mesaInicial: detalle.mesaId ?? null, horaInicial: detalle.hora ?? null, fecha: detalle.fecha });
    })();
  }, [abrirModal, avisar]);

  const abrirReservaPorId = useCallback(
    async (id: string) => {
      let r: Reserva | null;
      try {
        r = await comunes.cargarReserva(id);
      } catch {
        avisar("No se ha podido abrir la reserva.");
        return;
      }
      if (!r) { avisar("No encuentro esa reserva."); return; }
      const restDe = rests.find((x) => x.id === r.restaurante_id) ?? rest;
      await abrirModal({ rest: restDe, reserva: r, fecha: r.fecha });
    },
    [rests, rest, abrirModal, avisar],
  );

  useEffect(() => {
    const onAbrir = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail;
      if (typeof id !== "string" || !id) return;
      e.preventDefault();
      abrirReservaPorId(id);
    };
    const onNueva = (e: Event) => {
      const d = (e as CustomEvent<unknown>).detail;
      e.preventDefault();
      abrirNueva(d && typeof d === "object" ? (d as DetalleNuevaReserva) : {});
    };
    const onFicha = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail;
      if (typeof id !== "string" || !id) return;
      e.preventDefault();
      setFicha(id);
    };
    window.addEventListener("rsv:abrir-reserva", onAbrir);
    window.addEventListener("rsv:nueva-reserva", onNueva);
    window.addEventListener("rsv:ficha-cliente", onFicha);
    return () => {
      window.removeEventListener("rsv:abrir-reserva", onAbrir);
      window.removeEventListener("rsv:nueva-reserva", onNueva);
      window.removeEventListener("rsv:ficha-cliente", onFicha);
    };
  }, [abrirReservaPorId, abrirNueva]);

  /* ---- atajos de teclado ---- */

  const actual = TABS.find((t) => t.id === tab) ?? TABS[0];
  const conFecha = CON_FECHA.includes(actual.id);

  useEffect(() => {
    // En fase de captura: ←/→ se detienen aquí para que una sección que también los escuche
    // no mueva el día dos veces. El resto de teclas siguen su curso.
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (document.activeElement === buscadorRef.current) buscadorRef.current?.blur();
        return;
      }
      if (enCampoDeTexto(e.target)) return;
      if (hayCapaAbierta()) {
        // Con modal, popover o ficha abiertos, ←/→ no deben llegar a las secciones (Día movería
        // el día por detrás).
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") e.stopPropagation();
        return;
      }
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowRight":
          if (!conFecha) return;
          e.preventDefault();
          e.stopPropagation();
          moverDia(e.key === "ArrowLeft" ? -1 : 1);
          break;
        case "t":
        case "T":
          if (!conFecha) return;
          e.preventDefault();
          irHoy();
          break;
        case "n":
        case "N":
          e.preventDefault();
          abrirNueva();
          break;
        case "/":
          e.preventDefault();
          buscadorRef.current?.focus();
          buscadorRef.current?.select();
          break;
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [conFecha, moverDia, irHoy, abrirNueva]);

  /* ==================== Render ==================== */

  if (!rests.length) {
    return <div className="rsp rv" data-tema={tema}><div className="vacio">No hay restaurantes configurados en tu cuenta.</div></div>;
  }

  const Sec = actual.Sec;
  const esHoy = fecha === hoyISO();

  return (
    <div className="rsp rv" data-tema={tema}>
      {/* ---------- barra superior ---------- */}
      <div className="barra" role="toolbar" aria-label="Barra de reservas">
        <select className="rest" value={restId} onChange={(e) => cambiarRestaurante(e.target.value)} aria-label="Restaurante" title="Restaurante">
          {rests.map((r) => (
            <option key={r.id} value={r.id}>{r.nombre}</option>
          ))}
        </select>

        <BuscadorGlobal
          inputRef={buscadorRef}
          restaurantes={rests}
          onReserva={(id) => abrirReservaPorId(id)}
          onCliente={(id) => setFicha(id)}
        />

        <div className="espacio" />

        {conFecha ? (
          <div className="turnos" aria-label="Turnos del día">
            {contadores.length === 0 ? (
              <span className="turno-vacio">Sin turnos este día</span>
            ) : (
              contadores.map((c) => (
                <div key={c.turno_id} className={"turno" + (turnoActivo === c.turno_id ? " activo" : "") + (c.cerrado ? " cerrado" : "")}>
                  <button
                    type="button"
                    className="turno-nombre"
                    onClick={() => elegirTurno(c.turno_id)}
                    title={`${c.nombre} ${c.hora_inicio}–${c.hora_fin}. Pulsa para filtrar por este turno.`}
                  >
                    {c.color ? <i className="turno-punto" style={{ background: c.color }} /> : null}
                    {c.nombre}
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!c.cerrado}
                    aria-label={c.cerrado ? `${c.nombre}: cupo cerrado. Pulsa para abrir.` : `${c.nombre}: cupo abierto. Pulsa para cerrar.`}
                    title={c.cerrado_dia ? "Día cerrado por completo (abrirlo desde Mes o Día)" : c.cerrado ? "Cupo cerrado · pulsa para abrir" : "Cupo abierto · pulsa para cerrar"}
                    className={"switch" + (c.cerrado ? "" : " on")}
                    disabled={cupoOcupado === c.turno_id || c.cerrado_dia}
                    onClick={() => alternarCupo(c)}
                  >
                    <i />
                    <span>{c.cerrado ? "OFF" : "ON"}</span>
                  </button>
                  <span className={"cifra " + nivel(c.pax, c.aforo)} title="Comensales reservados / aforo">
                    <IcoPax /> {c.pax}<small>/{c.aforo || "–"}</small>
                  </span>
                  <span
                    className={"cifra " + nivel(c.mesas_ocupadas, c.mesas)}
                    title={`Mesas ocupadas / mesas activas · ${c.reservas} ${c.reservas === 1 ? "reserva" : "reservas"}`}
                  >
                    <IcoMesas /> {c.mesas_ocupadas}<small>/{c.mesas || "–"}</small>
                  </span>
                </div>
              ))
            )}
          </div>
        ) : null}

        {conFecha ? (
          <div className="fechas">
            <button type="button" className="nav" onClick={() => moverDia(-1)} aria-label="Día anterior (←)" title="Día anterior (←)">‹</button>
            <button type="button" className={"fecha" + (esHoy ? " eshoy" : "")} onClick={abrirCalendario} title="Elegir fecha" aria-label={`Fecha: ${fmtFechaBarra(fecha)}. Pulsa para elegir otra.`}>
              <span className="larga">{fmtFechaBarra(fecha)}</span>
              <span className="corta">{fmtFechaCorta(fecha)}</span>
            </button>
            <input
              ref={fechaRef}
              className="fecha-input"
              type="date"
              value={fecha}
              onChange={(e) => e.target.value && setFecha(e.target.value)}
              tabIndex={-1}
              aria-hidden="true"
            />
            <button type="button" className="nav" onClick={() => moverDia(1)} aria-label="Día siguiente (→)" title="Día siguiente (→)">›</button>
            <button type="button" className="hoy" onClick={irHoy} disabled={esHoy} title="Ir a hoy (T)">Hoy</button>
          </div>
        ) : null}

        <button type="button" className="nueva" onClick={() => abrirNueva()} title="Nueva reserva (N)" aria-label="Nueva reserva (N)">
          <span aria-hidden="true">+</span> <span className="larga">Nueva reserva</span><span className="corta">Nueva</span>
        </button>
        <button type="button" className="tema-toggle" onClick={alternarTema} aria-label={tema === "oscuro" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"} title={tema === "oscuro" ? "Tema claro" : "Tema oscuro"}>
          {tema === "oscuro" ? <IcoSol /> : <IcoLuna />}
        </button>
      </div>

      {/* ---------- pestañas ---------- */}
      <div className="tabsbar" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={actual.id === t.id} className={actual.id === t.id ? "activo" : ""} onClick={() => cambiarTab(t.id)}>
            {t.nombre}
            {t.id === "inbox" && inboxN > 0 ? <span className="badge" aria-label={`${inboxN} sin leer`}>{inboxN > 99 ? "99+" : inboxN}</span> : null}
          </button>
        ))}
      </div>

      <main>
        <Sec key={`${actual.id}:${rest.id}`} ctx={ctx} rest={rest} fecha={fecha} setFecha={setFecha} avisar={avisar} />
      </main>

      {modal ? (
        <ModalReserva
          rest={modal.rest}
          fecha={modal.fecha}
          salas={modal.salas}
          turnos={modal.turnos}
          reserva={modal.reserva}
          mesaInicial={modal.mesaInicial}
          horaInicial={modal.horaInicial}
          clienteInicial={modal.clienteInicial}
          cerrar={() => setModal(null)}
          guardado={(r) => {
            const nueva = !modal.reserva;
            setModal(null);
            avisar(nueva ? "Reserva creada." : "Reserva guardada.");
            if (conFecha && r.fecha !== fecha && modal.rest.id === rest.id) setFecha(r.fecha);
            else pedirRecarga();
          }}
        />
      ) : null}

      {/* Con el modal abierto la ficha se oculta pero sigue montada, para no perder cambios sin
          guardar. Los dos escuchan Esc en window: mientras haya modal, el cierre y los avisos de
          la ficha se ignoran (Esc solo cierra el modal). */}
      {ficha ? (
        <div style={{ display: modal ? "none" : undefined }}>
          <FichaCliente
            clienteId={ficha}
            restaurantes={rests}
            cerrar={() => { if (!modalRef.current) setFicha(null); }}
            avisar={(m) => { if (!modalRef.current) avisar(m); }}
            guardado={() => pedirRecarga()}
          />
        </div>
      ) : null}

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}

/* ==================== Buscador global ==================== */

type ItemBusqueda = { tipo: "reserva"; id: string } | { tipo: "cliente"; id: string };

function BuscadorGlobal(props: {
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  restaurantes: Restaurante[];
  onReserva: (id: string) => void;
  onCliente: (id: string) => void;
}) {
  const { inputRef, restaurantes, onReserva, onCliente } = props;
  const [q, setQ] = useState("");
  const [res, setRes] = useState<ResultadoBusqueda | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [foco, setFoco] = useState(-1);
  const cajaRef = useRef<HTMLDivElement | null>(null);
  const peticion = useRef(0);

  const nombreRest = useCallback((id: string) => restaurantes.find((r) => r.id === id)?.nombre ?? "", [restaurantes]);

  // Búsqueda con retardo corto; se descartan respuestas que llegan tarde.
  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) { setRes(null); setCargando(false); return; }
    setCargando(true);
    const n = ++peticion.current;
    const t = setTimeout(async () => {
      try {
        const r = await comunes.buscarGlobal(texto);
        if (n !== peticion.current) return;
        setRes(r);
        setFoco(-1);
      } catch {
        if (n === peticion.current) setRes({ reservas: [], clientes: [] });
      } finally {
        if (n === peticion.current) setCargando(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  // Clic fuera → cierra el desplegable.
  useEffect(() => {
    if (!abierto) return;
    const h = (e: MouseEvent) => { if (cajaRef.current && !cajaRef.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [abierto]);

  const items: ItemBusqueda[] = useMemo(
    () => [...(res?.reservas ?? []).map((r) => ({ tipo: "reserva" as const, id: r.id })), ...(res?.clientes ?? []).map((c) => ({ tipo: "cliente" as const, id: c.id }))],
    [res],
  );

  function elegir(it: ItemBusqueda) {
    setAbierto(false);
    setQ("");
    setRes(null);
    inputRef.current?.blur();
    if (it.tipo === "reserva") onReserva(it.id);
    else onCliente(it.id);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { setAbierto(false); setQ(""); setRes(null); inputRef.current?.blur(); return; }
    if (!items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setAbierto(true); setFoco((f) => (f + 1) % items.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAbierto(true); setFoco((f) => (f <= 0 ? items.length - 1 : f - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); elegir(items[foco >= 0 ? foco : 0]); }
  }

  const mostrar = abierto && q.trim().length >= 2;
  const hoy = hoyISO();
  let idx = -1;

  return (
    <div className={"buscador" + (mostrar ? " abierto" : "")} ref={cajaRef}>
      <span className="lupa" aria-hidden="true"><IcoLupa /></span>
      <input
        ref={inputRef}
        type="search"
        placeholder="Buscar cliente o localizador…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setAbierto(true); }}
        onFocus={() => setAbierto(true)}
        onKeyDown={onKey}
        aria-label="Buscar cliente o localizador (/)"
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={mostrar}
        aria-controls="rsv-busqueda"
      />
      <kbd aria-hidden="true">/</kbd>
      {mostrar ? (
        <div className="resultados" id="rsv-busqueda" role="listbox">
          {cargando && !res ? <div className="res-vacio">Buscando…</div> : null}
          {res && !res.reservas.length && !res.clientes.length && !cargando ? <div className="res-vacio">Nada con «{q.trim()}».</div> : null}
          {res?.reservas.length ? (
            <>
              <div className="res-grupo">Reservas</div>
              {res.reservas.map((r) => {
                idx += 1;
                const i = idx;
                const e = estadoDe(r.estado);
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="option"
                    aria-selected={foco === i}
                    className={"res-item" + (foco === i ? " foco" : "") + (r.fecha < hoy ? " pasada" : "")}
                    onMouseEnter={() => setFoco(i)}
                    onClick={() => elegir({ tipo: "reserva", id: r.id })}
                  >
                    <span className="res-fecha">
                      <b>{fmtFechaCorta(r.fecha)}</b>
                      <small>{r.hora}</small>
                    </span>
                    <span className="res-texto">
                      <b>{r.nombre}</b>
                      <small>
                        {r.pax} pax{r.mesa ? ` · mesa ${r.mesa}` : ""}{restaurantes.length > 1 ? ` · ${nombreRest(r.restaurante_id)}` : ""}
                        {r.telefono ? ` · ${r.telefono}` : ""}
                      </small>
                    </span>
                    <span className="res-estado" style={{ background: e.color, color: e.borde ? "#1a1a1a" : "#fff", borderColor: e.borde ?? e.color }}>
                      {EST[r.estado]?.txt ?? e.texto}
                    </span>
                    <code className="res-loc">{r.localizador}</code>
                  </button>
                );
              })}
            </>
          ) : null}
          {res?.clientes.length ? (
            <>
              <div className="res-grupo">Clientes</div>
              {res.clientes.map((c) => {
                idx += 1;
                const i = idx;
                const nombre = [c.nombre, c.apellidos].filter(Boolean).join(" ").trim() || "—";
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={foco === i}
                    className={"res-item cliente" + (foco === i ? " foco" : "")}
                    onMouseEnter={() => setFoco(i)}
                    onClick={() => elegir({ tipo: "cliente", id: c.id })}
                  >
                    <span className="res-avatar" aria-hidden="true">{nombre.slice(0, 1).toUpperCase()}</span>
                    <span className="res-texto">
                      <b>
                        {nombre}
                        {c.vip ? <span className="chip vip">VIP</span> : null}
                        {c.lista_negra ? <span className="chip noshows">Lista negra</span> : null}
                      </b>
                      <small>
                        {[c.telefono, c.email].filter(Boolean).join(" · ") || "Sin contacto"}
                        {c.visitas ? ` · ${c.visitas} visita${c.visitas === 1 ? "" : "s"}` : ""}
                        {c.ultima_visita ? ` · última ${fmtFechaCorta(c.ultima_visita)}` : ""}
                      </small>
                    </span>
                    <span className="res-ir">Ficha ›</span>
                  </button>
                );
              })}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
