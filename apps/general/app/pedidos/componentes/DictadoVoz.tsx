"use client";

/* Dictado continuo con la Web Speech API del navegador + campo de texto SIEMPRE editable.
   Claude no recibe audio: aquí la voz se pasa a texto y lo que viaja al servidor es el texto.
   - Idioma es-ES / ca-ES (lo recuerda PanelPedidos/Nuevo en «ped:idioma»).
   - Lo provisional se pinta en gris debajo; lo final se añade al texto (valor).
   - Si el navegador corta la escucha (silencios, límite de tiempo) mientras se graba, se reinicia.
   - Sin soporte (Firefox, algunos iPhone antiguos) se oculta el micro y se sugiere el dictado del
     teclado del móvil. */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { normalizarTexto } from "../lib-pedidos";
import { IDIOMA_TXT } from "../tipos";
import type { IdiomaDictado, PropsDictadoVoz } from "../tipos";

/* La API no está en lib.dom de TypeScript (solo sus resultados): tipos mínimos locales. */
type EventoResultado = { resultIndex: number; results: SpeechRecognitionResultList };
type EventoError = { error: string; message?: string };
type Reconocedor = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: EventoResultado) => void) | null;
  onerror: ((e: EventoError) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type ConstructorReconocedor = new () => Reconocedor;

const LANG: Record<IdiomaDictado, string> = { es: "es-ES", ca: "ca-ES" };
const IDIOMAS: IdiomaDictado[] = ["es", "ca"];

function constructorReconocedor(): ConstructorReconocedor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: ConstructorReconocedor;
    webkitSpeechRecognition?: ConstructorReconocedor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Añade un trozo dictado al final del texto, con un espacio si hace falta. */
function unir(a: string, b: string): string {
  const t = b.trim();
  if (!t) return a;
  if (!a.trim()) return t;
  return /\s$/.test(a) ? a + t : `${a} ${t}`;
}

/** Errores tras los que no tiene sentido volver a tocar el micro: se apaga y se escribe. */
const ERRORES_SIN_MICRO = new Set(["not-allowed", "service-not-allowed"]);

function mensajeError(codigo: string, idioma: IdiomaDictado): string {
  switch (codigo) {
    case "not-allowed":
      return "El navegador no deja usar el micrófono: actívalo en los permisos de esta web o escribe el pedido.";
    case "service-not-allowed":
      return "Este móvil no deja dictar aquí (en iPhone: Ajustes › General › Teclado › Dictado). Puedes escribir el pedido.";
    case "audio-capture":
      return "No se encuentra el micrófono.";
    case "network":
      return "El dictado necesita conexión a internet.";
    case "language-not-supported":
      return idioma === "ca"
        ? "Este navegador no dicta en menorquí: prueba en castellano."
        : "Este navegador no dicta en este idioma.";
    default:
      return "El dictado se ha parado. Prueba otra vez o escribe el pedido.";
  }
}

const IcoMicro = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
    <rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor" />
    <path d="M5 11a7 7 0 0 0 14 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M12 18v3.5M8.5 21.5h7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IcoParar = () => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
  </svg>
);

export default function DictadoVoz({
  valor,
  onCambio,
  idioma,
  onIdioma,
  onOrigen,
  desactivado,
  placeholder,
  onGrabando,
  control,
}: PropsDictadoVoz) {
  const idTexto = useId();
  const [soporte, setSoporte] = useState<boolean | null>(null);
  const [grabando, setGrabando] = useState(false);
  const [provisional, setProvisionalEstado] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** El navegador o el sistema no dejan dictar: el micro se apaga y queda el campo de texto. */
  const [sinMicro, setSinMicro] = useState(false);
  const textoRef = useRef<HTMLTextAreaElement>(null);
  const provisionalRef = useRef("");
  const setProvisional = useCallback((t: string) => {
    provisionalRef.current = t;
    setProvisionalEstado(t);
  }, []);
  /** Reconocedores terminados a mano: lo que manden después se ignora (ya se pasó lo provisional). */
  const ignorados = useRef(new WeakSet<Reconocedor>());

  const recRef = useRef<Reconocedor | null>(null);
  /** El usuario quiere seguir grabando (si el navegador corta, se reinicia). */
  const quiereGrabarRef = useRef(false);
  const valorRef = useRef(valor);
  const idiomaRef = useRef(idioma);
  const onCambioRef = useRef(onCambio);
  const onOrigenRef = useRef(onOrigen);
  const usoRef = useRef({ voz: false, teclado: false });
  const cortesRef = useRef({ seguidos: 0, inicio: 0 });

  useEffect(() => {
    valorRef.current = valor;
    // Texto vaciado desde fuera (pedido guardado o «empezar de nuevo»): el origen vuelve a cero.
    if (!valor) usoRef.current = { voz: false, teclado: false };
  }, [valor]);
  useEffect(() => {
    idiomaRef.current = idioma;
  }, [idioma]);
  useEffect(() => {
    onCambioRef.current = onCambio;
    onOrigenRef.current = onOrigen;
  }, [onCambio, onOrigen]);

  useEffect(() => {
    setSoporte(!!constructorReconocedor());
  }, []);

  const avisarOrigen = useCallback(() => {
    const u = usoRef.current;
    onOrigenRef.current?.(u.voz && u.teclado ? "mixto" : u.voz ? "voz" : "texto");
  }, []);

  const cambiarTexto = useCallback(
    (nuevo: string, porVoz: boolean) => {
      valorRef.current = nuevo;
      if (porVoz) usoRef.current.voz = true;
      else usoRef.current.teclado = true;
      onCambioRef.current(nuevo);
      avisarOrigen();
    },
    [avisarOrigen],
  );

  const arrancar = useCallback(() => {
    const C = constructorReconocedor();
    if (!C) return;
    const rec = new C();
    rec.lang = LANG[idiomaRef.current];
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    const procesados = new Set<number>();
    let ultimoFinal = "";

    rec.onresult = (e) => {
      if (ignorados.current.has(rec)) return;
      let interino = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r?.[0]?.transcript ?? "";
        if (!r.isFinal) {
          interino += t;
          continue;
        }
        if (procesados.has(i)) continue;
        procesados.add(i);
        const limpio = t.trim();
        if (!limpio) continue;
        const actual = valorRef.current;
        const nAnterior = normalizarTexto(ultimoFinal);
        const nNuevo = normalizarTexto(limpio);
        let nuevo: string;
        if (nAnterior && nNuevo && nNuevo.startsWith(nAnterior) && actual.endsWith(ultimoFinal)) {
          // Chrome de Android a veces repite lo anterior en cada resultado final: se sustituye.
          nuevo = actual.slice(0, actual.length - ultimoFinal.length) + limpio;
        } else {
          nuevo = unir(actual, limpio);
        }
        ultimoFinal = limpio;
        cambiarTexto(nuevo, true);
      }
      setProvisional(interino.trim());
    };

    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // silencio: onend lo reinicia
      if (ignorados.current.has(rec)) return;
      quiereGrabarRef.current = false;
      setGrabando(false);
      setError(mensajeError(e.error, idiomaRef.current));
      if (ERRORES_SIN_MICRO.has(e.error)) {
        setSinMicro(true);
        requestAnimationFrame(() => textoRef.current?.focus());
      }
    };

    rec.onend = () => {
      if (recRef.current !== rec) return; // ya hay otro reconocedor (cambio de idioma) o se terminó a mano
      setProvisional("");
      if (quiereGrabarRef.current) {
        const c = cortesRef.current;
        c.seguidos = Date.now() - c.inicio < 1500 ? c.seguidos + 1 : 0;
        if (c.seguidos >= 4) {
          quiereGrabarRef.current = false;
          recRef.current = null;
          setGrabando(false);
          setError("El dictado se corta todo el rato. Escribe el pedido o prueba otra vez.");
          return;
        }
        arrancar();
        return;
      }
      recRef.current = null;
      setGrabando(false);
    };

    recRef.current = rec;
    cortesRef.current.inicio = Date.now();
    try {
      rec.start();
    } catch {
      quiereGrabarRef.current = false;
      recRef.current = null;
      setGrabando(false);
      setError("No se ha podido empezar a dictar. Prueba otra vez.");
    }
  }, [cambiarTexto, setProvisional]);

  const empezar = () => {
    if (desactivado || sinMicro) return;
    setError(null);
    cortesRef.current = { seguidos: 0, inicio: Date.now() };
    quiereGrabarRef.current = true;
    setGrabando(true);
    arrancar();
  };

  const parar = useCallback(() => {
    quiereGrabarRef.current = false;
    setGrabando(false);
    try {
      recRef.current?.stop(); // los últimos resultados finales aún llegan después
    } catch {
      /* ya estaba parado */
    }
  }, []);

  /** Termina el dictado YA (antes de interpretar): lo provisional pasa al texto y lo que mande
      después ese reconocedor se ignora, para que no se pierda ni se cuele la última frase. */
  const terminar = useCallback(() => {
    const rec = recRef.current;
    if (rec || quiereGrabarRef.current) {
      quiereGrabarRef.current = false;
      recRef.current = null;
      setGrabando(false);
      if (rec) {
        ignorados.current.add(rec);
        try {
          rec.abort();
        } catch {
          /* ya estaba parado */
        }
      }
      const pendiente = provisionalRef.current.trim();
      setProvisional("");
      if (pendiente) cambiarTexto(unir(valorRef.current, pendiente), true);
    }
    const u = usoRef.current;
    return {
      texto: valorRef.current,
      origen: (u.voz && u.teclado ? "mixto" : u.voz ? "voz" : "texto") as "voz" | "texto" | "mixto",
    };
  }, [cambiarTexto, setProvisional]);

  // El control queda a mano de quien usa el componente (solo uno montado a la vez en Nuevo).
  useEffect(() => {
    if (!control) return;
    const propio = { terminar };
    control.current = propio;
    return () => {
      if (control.current === propio) control.current = null;
    };
  }, [control, terminar]);

  const onGrabandoRef = useRef(onGrabando);
  useEffect(() => {
    onGrabandoRef.current = onGrabando;
  }, [onGrabando]);
  useEffect(() => {
    onGrabandoRef.current?.(grabando);
  }, [grabando]);
  useEffect(
    () => () => {
      onGrabandoRef.current?.(false);
    },
    [],
  );

  // Al desactivar (p. ej. mientras se interpreta) se deja de escuchar.
  useEffect(() => {
    if (desactivado && quiereGrabarRef.current) parar();
  }, [desactivado, parar]);

  // Si la pantalla deja de verse (otra pestaña de Pedidos, que la oculta con display:none, o el
  // móvil se bloquea), se deja de escuchar: nada de micro abierto a escondidas.
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = raiz.current;
    const alOcultarPagina = () => {
      if (document.visibilityState === "hidden" && quiereGrabarRef.current) parar();
    };
    document.addEventListener("visibilitychange", alOcultarPagina);
    let obs: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== "undefined") {
      obs = new ResizeObserver((entradas) => {
        const r = entradas[0]?.contentRect;
        if (r && r.width === 0 && r.height === 0 && quiereGrabarRef.current) parar();
      });
      obs.observe(el);
    }
    return () => {
      document.removeEventListener("visibilitychange", alOcultarPagina);
      obs?.disconnect();
    };
  }, [parar]);

  // Al desmontar, se corta sin esperar resultados.
  useEffect(() => {
    return () => {
      quiereGrabarRef.current = false;
      try {
        recRef.current?.abort();
      } catch {
        /* nada */
      }
      recRef.current = null;
    };
  }, []);

  const elegirIdioma = (n: IdiomaDictado) => {
    if (n === idioma) return;
    idiomaRef.current = n;
    onIdioma(n);
    // Grabando: se para el reconocedor actual y onend lo reinicia con el idioma nuevo.
    if (quiereGrabarRef.current) {
      try {
        recRef.current?.stop();
      } catch {
        /* nada */
      }
    }
  };

  return (
    <div className="ped-dictado" ref={raiz}>
      <div className="ped-segmento" role="group" aria-label="Idioma del dictado">
        {IDIOMAS.map((i) => (
          <button
            key={i}
            type="button"
            className={i === idioma ? "activo" : ""}
            aria-pressed={i === idioma}
            onClick={() => elegirIdioma(i)}
            disabled={desactivado}
          >
            {IDIOMA_TXT[i]}
          </button>
        ))}
      </div>

      {soporte && !sinMicro ? (
        <button
          type="button"
          className={`ped-micro${grabando ? " ped-micro--grabando" : ""}`}
          aria-pressed={grabando}
          onClick={grabando ? parar : empezar}
          disabled={desactivado}
        >
          <span className="ped-micro-icono">{grabando ? <IcoParar /> : <IcoMicro />}</span>
          <span className="ped-micro-texto">{grabando ? "Escuchando… toca para parar" : "Toca y dicta el pedido"}</span>
        </button>
      ) : null}
      {soporte === false ? (
        <p className="ped-nota">Usa el micrófono del teclado del móvil para dictar.</p>
      ) : null}
      {error ? (
        <p className="ped-dictado-error" role="alert">
          {error}
        </p>
      ) : null}

      <label className="ped-sr" htmlFor={idTexto}>
        Texto del pedido
      </label>
      <textarea
        ref={textoRef}
        id={idTexto}
        className="ped-dictado-texto"
        value={valor}
        onChange={(e) => cambiarTexto(e.target.value, false)}
        placeholder={placeholder ?? "Ej.: «Dos cajas de tomate, una caixa de pa blanc i mitja de llet per demà»"}
        rows={4}
        disabled={desactivado}
        spellCheck
        autoCapitalize="sentences"
      />
      <p className={`ped-provisional${provisional ? "" : " ped-provisional--vacio"}`} aria-live="polite">
        {provisional}
      </p>
    </div>
  );
}
