"use client";

/* Ajustes (guía §11): contenedor con pestañas internas. Barra lateral en escritorio, select en
   móvil. Cada subpantalla vive en ./ajustes/<nombre>.tsx y recibe AjProps (ver ./ajustes/comunes). */

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import type { Restaurante, Sala, Turno } from "../tipos";
import { anunciarRestaurante, guardarPref, leerPref, type SecProps, type Tema } from "../lib-reservas";
import { cargarRestaurante, listarSalas, listarTurnos, quienSoy } from "../acciones/ajustes";
import { Confirmar, type AjProps } from "./ajustes/comunes";
import AjRestaurante from "./ajustes/restaurante";
import AjTurnos from "./ajustes/turnos";
import AjPlanos from "./ajustes/planos";
import AjMesas from "./ajustes/mesas";
import AjEtiquetas from "./ajustes/etiquetas";
import AjPrescriptores from "./ajustes/prescriptores";
import AjExperiencias from "./ajustes/experiencias";
import AjPoliticas from "./ajustes/politicas";
import AjMensajes from "./ajustes/mensajes";
import AjWidget from "./ajustes/widget";
import AjPreguntas from "./ajustes/preguntas";
import AjPermisos from "./ajustes/permisos";
import AjCodigos from "./ajustes/codigos";
import AjCamareros from "./ajustes/camareros";
import AjAutotags from "./ajustes/autotags";
import "./ajustes.css";

/** `cuenta`: catálogo común a todos los restaurantes (se edita con permiso de ajustes sin restricción de local). */
type Pestana = { id: string; nombre: string; ico: string; Sub: ComponentType<AjProps>; soloDireccion?: boolean; cuenta?: boolean };
type Grupo = { titulo: string; pestanas: Pestana[] };

const GRUPOS: Grupo[] = [
  {
    titulo: "Local",
    pestanas: [
      { id: "restaurante", nombre: "Restaurante", ico: "⌂", Sub: AjRestaurante },
      { id: "turnos", nombre: "Turnos y cupos", ico: "◷", Sub: AjTurnos },
      { id: "planos", nombre: "Salas y planos", ico: "▦", Sub: AjPlanos },
      { id: "mesas", nombre: "Mesas", ico: "▢", Sub: AjMesas },
      { id: "camareros", nombre: "Camareros", ico: "☺", Sub: AjCamareros },
    ],
  },
  {
    titulo: "Catálogos",
    pestanas: [
      { id: "etiquetas", nombre: "Etiquetas", ico: "◈", Sub: AjEtiquetas, cuenta: true },
      { id: "autotags", nombre: "Etiquetas automáticas", ico: "↻", Sub: AjAutotags, cuenta: true },
      { id: "prescriptores", nombre: "Prescriptores", ico: "⚑", Sub: AjPrescriptores, cuenta: true },
      { id: "experiencias", nombre: "Experiencias", ico: "✦", Sub: AjExperiencias },
      { id: "codigos", nombre: "Códigos promo", ico: "％", Sub: AjCodigos },
    ],
  },
  {
    titulo: "Cliente",
    pestanas: [
      { id: "politicas", nombre: "Políticas y pagos", ico: "▣", Sub: AjPoliticas },
      { id: "mensajes", nombre: "Mensajes", ico: "✉", Sub: AjMensajes },
      { id: "widget", nombre: "Widget / front", ico: "⧉", Sub: AjWidget },
      { id: "preguntas", nombre: "Preguntas", ico: "?", Sub: AjPreguntas },
    ],
  },
  {
    titulo: "Equipo",
    pestanas: [{ id: "permisos", nombre: "Usuarios y permisos", ico: "⚿", Sub: AjPermisos, soloDireccion: true }],
  },
];
const TODAS = GRUPOS.flatMap((g) => g.pestanas);
const esPestana = (v: string) => TODAS.some((p) => p.id === v);

/** Tema actual leído del contenedor .rv (lo cambia la barra del panel; aquí solo se observa). */
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

type Yo = { puedeAjustes: boolean; puedeAjustesCuenta: boolean; puedeEditarPlano: boolean; esDireccion: boolean };

export default function SecAjustes({ ctx, rest, fecha, avisar }: SecProps) {
  const raiz = useRef<HTMLDivElement>(null);
  const tema = useTemaDom(raiz);
  const [tab, setTab] = useState<string>("restaurante");
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [salas, setSalas] = useState<Sala[]>([]);
  // Restaurante que se está editando. Normalmente el de la barra; si se cambia en la barra con
  // cambios sin guardar, se queda en el anterior hasta que se guarde o se descarte.
  const [restLocal, setRestLocal] = useState<Restaurante>(rest);
  const restId = restLocal.id;
  const [yo, setYo] = useState<Yo | null>(null);
  const [cargado, setCargado] = useState(false);

  /* ---- cambios sin guardar ---- */
  const sucioRef = useRef(false);
  const [sucio, setSucio] = useState(false);
  const onSucio = useCallback((b: boolean) => { sucioRef.current = b; setSucio(b); }, []);
  const [pendiente, setPendiente] = useState<{ texto: string; hacer: () => void } | null>(null);
  /** Ejecuta `hacer` directamente o tras confirmar si hay cambios sin guardar. */
  const conConfirmacion = useCallback((texto: string, hacer: () => void) => {
    if (!sucioRef.current) { hacer(); return; }
    setPendiente({ texto, hacer: () => { sucioRef.current = false; setSucio(false); hacer(); } });
  }, []);

  // Cerrar o recargar la página con cambios: el navegador pregunta.
  useEffect(() => {
    if (!sucio) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [sucio]);

  useEffect(() => {
    const ultima = leerPref<string>("ajustes:tab", "restaurante");
    if (esPestana(ultima)) setTab(ultima);
  }, []);

  // Cambio de restaurante en la barra: se sigue si no hay nada a medias; si lo hay, se pregunta.
  const cambiarARest = useCallback((r: Restaurante) => {
    setRestLocal(r);
  }, []);
  useEffect(() => {
    if (rest.id === restId) { setRestLocal((x) => (x.id === rest.id ? x : rest)); return; }
    if (!sucioRef.current) { cambiarARest(rest); return; }
    setPendiente({
      texto: `Hay cambios sin guardar en ${restLocal.nombre}. ¿Descartarlos y pasar a ${rest.nombre}?`,
      hacer: () => { sucioRef.current = false; setSucio(false); cambiarARest(rest); },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rest]);
  // Si se guarda (ya no hay cambios) mientras la barra apunta a otro restaurante, se pasa a ese.
  useEffect(() => {
    if (!sucio && rest.id !== restId && !pendiente) cambiarARest(rest);
  }, [sucio, rest, restId, pendiente, cambiarARest]);

  const recargarBase = useCallback(async () => {
    const [t, s] = await Promise.all([listarTurnos(restId), listarSalas(restId)]);
    setTurnos(t);
    setSalas(s);
  }, [restId]);

  useEffect(() => {
    let vivo = true;
    setCargado(false);
    Promise.all([listarTurnos(restId), listarSalas(restId), quienSoy(restId), cargarRestaurante(restId)]).then(([t, s, q, r]) => {
      if (!vivo) return;
      setTurnos(t);
      setSalas(s);
      setYo({ puedeAjustes: q.puedeAjustes, puedeAjustesCuenta: q.puedeAjustesCuenta, puedeEditarPlano: q.puedeEditarPlano, esDireccion: q.esDireccion });
      if (r) setRestLocal(r);
      setCargado(true);
    });
    return () => { vivo = false; };
  }, [restId]);

  const aplicarTab = useCallback((id: string) => {
    setTab(id);
    guardarPref("ajustes:tab", id);
  }, []);
  const cambiarTab = useCallback((id: string) => {
    if (!esPestana(id)) return;
    conConfirmacion("Hay cambios sin guardar. Si cambias de apartado se pierden.", () => aplicarTab(id));
  }, [conConfirmacion, aplicarTab]);

  // Otras piezas pueden pedir una pestaña concreta (window 'rsv:ajustes-tab', detail = id).
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail;
      if (typeof id === "string") cambiarTab(id);
    };
    window.addEventListener("rsv:ajustes-tab", h);
    return () => window.removeEventListener("rsv:ajustes-tab", h);
  }, [cambiarTab]);

  const onRestaurante = useCallback((r: Restaurante) => {
    setRestLocal((x) => (x.id === r.id ? r : x));
    anunciarRestaurante(r);
  }, []);

  const esDireccion = yo?.esDireccion ?? ctx.esDireccion;
  const visibles = GRUPOS.map((g) => ({ ...g, pestanas: g.pestanas.filter((p) => !p.soloDireccion || esDireccion) })).filter((g) => g.pestanas.length);
  const actual = TODAS.find((p) => p.id === tab && (!p.soloDireccion || esDireccion)) ?? TODAS[0];
  const Sub = actual.Sub;
  const enEspera = rest.id !== restId;

  return (
    <div className="aj" ref={raiz}>
      <nav className="aj-nav" aria-label="Apartados de ajustes">
        {visibles.map((g) => (
          <div key={g.titulo}>
            <div className="aj-nav-grupo">{g.titulo}</div>
            {g.pestanas.map((p) => (
              <button key={p.id} className={actual.id === p.id ? "activo" : ""} onClick={() => cambiarTab(p.id)}>
                <span className="ico" aria-hidden>{p.ico}</span>
                {p.nombre}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="aj-contenido">
        <select className="aj-nav-select" value={actual.id} onChange={(e) => cambiarTab(e.target.value)} aria-label="Apartado de ajustes">
          {visibles.map((g) => (
            <optgroup key={g.titulo} label={g.titulo}>
              {g.pestanas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </optgroup>
          ))}
        </select>
        {enEspera && !pendiente ? (
          <div className="aj-aviso cambio">
            <span>Sigues editando <b>{restLocal.nombre}</b>. Guarda o descarta los cambios para pasar a <b>{rest.nombre}</b>.</span>
            <button type="button" className="aj-btn fantasma" onClick={() => { sucioRef.current = false; setSucio(false); cambiarARest(rest); }}>
              Descartar y pasar a {rest.nombre}
            </button>
          </div>
        ) : null}
        {!cargado || !yo ? (
          <div className="spinner" />
        ) : (
          <Sub
            key={`${actual.id}:${restId}`}
            ctx={ctx}
            rest={restLocal}
            fecha={fecha}
            avisar={avisar}
            turnos={turnos}
            salas={salas}
            recargarBase={recargarBase}
            puedeEditar={actual.cuenta ? yo.puedeAjustesCuenta : yo.puedeAjustes}
            puedeEditarCuenta={yo.puedeAjustesCuenta}
            puedeEditarPlano={yo.puedeEditarPlano}
            esDireccion={yo.esDireccion}
            tema={tema}
            onRestaurante={onRestaurante}
            onSucio={onSucio}
            irA={cambiarTab}
          />
        )}
      </div>
      {pendiente ? (
        <Confirmar
          texto={pendiente.texto}
          confirmarTexto="Descartar y salir"
          peligro
          onNo={() => setPendiente(null)}
          onSi={() => { const p = pendiente; setPendiente(null); p.hacer(); }}
        />
      ) : null}
    </div>
  );
}
