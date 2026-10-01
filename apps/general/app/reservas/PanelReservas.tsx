"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./acciones";
import { hoyISO, type Reserva, type Restaurante, type Sala, type Turno } from "./tipos";
import { guardarPref, leerPref, pedirRecarga, useRestauranteRecordado, useTema, type Ctx } from "./lib-reservas";
import { ModalReserva } from "./componentes/modal-reserva";
import SecDia from "./secciones/dia";
import SecCronograma from "./secciones/cronograma";
import SecMes from "./secciones/mes";
import SecInbox from "./secciones/inbox";
import SecClientes from "./secciones/clientes";
import SecEspera from "./secciones/espera";
import SecInformes from "./secciones/informes";
import SecAjustes from "./secciones/ajustes";
import "./secciones/tema.css";

/* Registro de pestañas (orden y nombres que Sonia reconoce de Cover). */
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

/* Pestañas en las que la fecha de la barra tiene sentido. */
const CON_FECHA: Tab[] = ["dia", "cronograma", "mes", "espera"];

export default function PanelReservas(props: { restaurantes: Restaurante[]; userId: string; esDireccion: boolean }) {
  const [rests, setRests] = useState(props.restaurantes);
  const [restId, setRestId] = useRestauranteRecordado(props.restaurantes);
  const rest = rests.find((r) => r.id === restId) ?? rests[0];
  const [fecha, setFecha] = useState(hoyISO());
  const [tab, setTab] = useState<Tab>("dia");
  const [busqueda, setBusqueda] = useState("");
  const [tema, alternarTema] = useTema();
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // «Nueva reserva» desde la barra: carga lo mínimo para el modal
  const [nueva, setNueva] = useState<{ salas: Sala[]; turnos: Turno[]; reservas: Reserva[] } | null>(null);

  const ctx: Ctx = { restaurantes: rests, userId: props.userId, esDireccion: props.esDireccion };

  const avisar = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    const ultima = leerPref<string>("tab", "dia");
    if (esTab(ultima)) setTab(ultima);
  }, []);

  const cambiarTab = (id: Tab) => {
    setTab(id);
    guardarPref("tab", id);
  };

  /* Otras secciones pueden pedir un cambio de pestaña:
     window.dispatchEvent(new CustomEvent("rsv:tab", { detail: "dia", cancelable: true })) */
  useEffect(() => {
    const onTab = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail;
      if (typeof id === "string" && esTab(id)) { e.preventDefault(); cambiarTab(id); }
    };
    window.addEventListener("rsv:tab", onTab);
    return () => window.removeEventListener("rsv:tab", onTab);
  }, []);

  /* Ajustes guarda el restaurante → actualizamos nuestra copia. */
  useEffect(() => {
    const onRest = (e: Event) => {
      const r = (e as CustomEvent<Restaurante>).detail;
      if (r?.id) setRests((xs) => xs.map((x) => (x.id === r.id ? r : x)));
    };
    window.addEventListener("rsv:restaurante", onRest);
    return () => window.removeEventListener("rsv:restaurante", onRest);
  }, []);

  function moverDia(d: number) {
    const dt = new Date(fecha + "T12:00:00");
    dt.setDate(dt.getDate() + d);
    setFecha(dt.toISOString().slice(0, 10));
  }

  async function abrirNueva() {
    const [{ salas, turnos }, dia] = await Promise.all([api.cargarLocal(rest.id), api.cargarDia(rest.id, fecha, hoyISO())]);
    setNueva({ salas: (salas as unknown as Sala[]).filter((s) => s.activa), turnos: turnos as Turno[], reservas: dia.reservas });
  }

  if (!rests.length) {
    return <div className="rsp rv" data-tema={tema}><div className="vacio">No hay restaurantes configurados en tu cuenta.</div></div>;
  }

  const actual = TABS.find((t) => t.id === tab) ?? TABS[0];
  const Sec = actual.Sec;
  const conFecha = CON_FECHA.includes(actual.id);

  return (
    <div className="rsp rv" data-tema={tema}>
      {/* barra superior */}
      <div className="barra">
        <select className="rest" value={restId} onChange={(e) => setRestId(e.target.value)}>
          {rests.map((r) => (
            <option key={r.id} value={r.id}>{r.nombre}</option>
          ))}
        </select>
        {conFecha ? (
          <>
            <button className="nav" onClick={() => moverDia(-1)} aria-label="Día anterior">‹</button>
            <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
            <button className="nav" onClick={() => moverDia(1)} aria-label="Día siguiente">›</button>
            <button className="hoy" onClick={() => setFecha(hoyISO())}>Hoy</button>
          </>
        ) : null}
        <div className="buscador">
          <input
            placeholder="Buscar cliente o localizador…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && busqueda.trim()) avisar("El buscador global llega en la siguiente entrega."); }}
            aria-label="Buscar cliente o localizador"
          />
        </div>
        <button className="nueva" onClick={abrirNueva}>+ Nueva reserva</button>
        <button className="tema-toggle" onClick={alternarTema} aria-label="Cambiar tema">
          {tema === "oscuro" ? "☀ Claro" : "☾ Oscuro"}
        </button>
      </div>

      {/* pestañas */}
      <div className="tabsbar">
        {TABS.map((t) => (
          <button key={t.id} className={actual.id === t.id ? "activo" : ""} onClick={() => cambiarTab(t.id)}>{t.nombre}</button>
        ))}
      </div>

      <main>
        <Sec key={`${actual.id}:${rest.id}`} ctx={ctx} rest={rest} fecha={fecha} setFecha={setFecha} avisar={avisar} />
      </main>

      {nueva ? (
        <ModalReserva
          rest={rest}
          fecha={fecha}
          salas={nueva.salas}
          turnos={nueva.turnos}
          reservas={nueva.reservas}
          reserva={null}
          cerrar={() => setNueva(null)}
          guardado={(nuevaFecha) => {
            setNueva(null);
            avisar("Reserva creada.");
            if (nuevaFecha !== fecha) setFecha(nuevaFecha);
            else pedirRecarga();
          }}
        />
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
