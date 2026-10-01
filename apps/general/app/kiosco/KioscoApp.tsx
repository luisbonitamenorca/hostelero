"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Kiosco de fichaje para tablet: sin sesión. El código del dispositivo vive en
// localStorage (misma llave que el legado) y todo pasa por /api/rrhh/fichar.
const LLAVE = "bonita_token_tablet";
// Cola de fichajes que no se pudieron enviar (sin conexión). OJO: cada apunte guarda el PIN
// del empleado en localStorage, que es un dato sensible. Solo vive ahí mientras el fichaje
// está pendiente: en cuanto el servidor responde (bien o con error definitivo) se borra.
// La alternativa (guardar solo un id de empleado) no sirve porque la tablet no conoce al
// empleado hasta que el servidor valida el PIN.
const LLAVE_COLA = "bonita_cola_fichajes";
// Fichajes de la cola que el servidor rechazó (PIN no reconocido, sin asignación, tablet
// desactivada…). Se guardan SIN el PIN para que el encargado los vea en la pantalla de
// configuración y los anote a mano en Fichajes. Un toast de 5 s en una tablet colgada en la
// pared no lo ve nadie.
const LLAVE_FALLIDOS = "bonita_fichajes_fallidos";
const REINTENTO_MS = 30_000;
const TIMEOUT_MS = 12_000;

const NT: Record<string, string> = { entrada: "Entrada", salida: "Salida", pausa_inicio: "Inicio de pausa", pausa_fin: "Vuelta de pausa" };

type Tipo = "entrada" | "salida" | "pausa_inicio" | "pausa_fin";
type Pendiente = { id: string; pin: string; tipo: Tipo; ts_dispositivo: string; token: string };
type Fallido = { id: string; tipo: Tipo; ts_dispositivo: string; error: string };
type Resumen = {
  fichajes: { tipo: Tipo; hora: string }[];
  horas: number;
  enCurso: boolean;
  enPausa: boolean;
  incidencias: string[];
  turnos: { inicio: string; fin: string; pausa_min: number; este_centro: boolean }[];
};
type Overlay = {
  clase: "ok" | "mal" | "aviso";
  icono: string;
  titulo: string;
  detalle: string;
  resumen?: Resumen | null;
  ms: number;
};

const fmtH = (h: number) => h.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " h";

/** «entrada 09:02 · pausa 13:00–13:30 · llevas 5,4 h · turno 09:00–17:00». */
function lineaHoy(r: Resumen) {
  const partes: string[] = [];
  let pausaAbierta: string | null = null;
  for (const f of r.fichajes) {
    if (f.tipo === "entrada") partes.push(`entrada ${f.hora}`);
    else if (f.tipo === "salida") partes.push(`salida ${f.hora}`);
    else if (f.tipo === "pausa_inicio") pausaAbierta = f.hora;
    else if (f.tipo === "pausa_fin") {
      partes.push(pausaAbierta ? `pausa ${pausaAbierta}–${f.hora}` : `vuelta ${f.hora}`);
      pausaAbierta = null;
    }
  }
  if (pausaAbierta) partes.push(`pausa ${pausaAbierta}–…`);
  if (r.fichajes.length) partes.push(`${r.enCurso ? "llevas" : "total"} ${fmtH(r.horas)}`);
  else partes.push("aún sin fichajes");
  if (r.turnos.length) partes.push(`turno ${r.turnos.map((t) => `${t.inicio}–${t.fin}`).join(" y ")}`);
  return "Hoy: " + partes.join(" · ");
}

function leerLista<T>(llave: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(llave) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function guardarLista<T>(llave: string, c: T[]) {
  try {
    if (c.length) localStorage.setItem(llave, JSON.stringify(c));
    else localStorage.removeItem(llave);
  } catch {
    /* almacenamiento bloqueado: la lista vive solo en memoria */
  }
}
const leerCola = () => leerLista<Pendiente>(LLAVE_COLA);
const guardarCola = (c: Pendiente[]) => guardarLista(LLAVE_COLA, c);
const leerFallidos = () => leerLista<Fallido>(LLAVE_FALLIDOS);
const guardarFallidos = (c: Fallido[]) => guardarLista(LLAVE_FALLIDOS, c);

/** POST al handler con tiempo máximo. Lanza TypeError (red) o AbortError (sin respuesta). */
async function post(body: Record<string, unknown>) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch("/api/rrhh/fichar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const d = await r.json().catch(() => ({}));
    return { r, d };
  } finally {
    clearTimeout(t);
  }
}

/** ¿El fallo es de red/servidor caído (encolable) o una respuesta definitiva? */
const esFalloRed = (e: unknown) => e instanceof TypeError || (e instanceof DOMException && e.name === "AbortError");
const esServidorCaido = (status: number) => status === 502 || status === 503 || status === 504;
const pideEncargado = (status: number) => status === 401 || status === 403 || status === 409;

export default function KioscoApp() {
  const [pantalla, setPantalla] = useState<"cargando" | "config" | "fichar">("cargando");
  const [nombreLocal, setNombreLocal] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [configMsg, setConfigMsg] = useState("");
  const [pin, setPin] = useState("");
  const [reloj, setReloj] = useState("");
  const [fecha, setFecha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [toast, setToast] = useState("");
  const [pendientes, setPendientes] = useState(0);
  const [fallidos, setFallidos] = useState<Fallido[]>([]);
  const [online, setOnline] = useState(true);
  const toques = useRef(0);
  const toquesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enviandoCola = useRef(false);
  // ¿El ping inicial consiguió el nombre del local? Si no, se reintenta con la cola.
  const localOk = useRef(false);

  const token = () => (typeof window !== "undefined" ? localStorage.getItem(LLAVE) || "" : "");

  useEffect(() => {
    const tic = () => {
      const n = new Date();
      setReloj(n.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }));
      setFecha(n.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }));
    };
    tic();
    const t = setInterval(tic, 5000);
    return () => clearInterval(t);
  }, []);

  const comprobarToken = useCallback(async (t: string) => {
    const { r, d } = await post({ token: t, accion: "ping" });
    if (!r.ok) throw new Error(d.error || "Sin respuesta del servidor");
    return d.local as string;
  }, []);

  useEffect(() => {
    const t = token();
    if (!t) { setPantalla("config"); return; }
    comprobarToken(t)
      .then((local) => { localOk.current = true; setNombreLocal(local); setPantalla("fichar"); })
      .catch(() => { localOk.current = false; setNombreLocal(""); setPantalla("fichar"); });
  }, [comprobarToken]);

  function avisar(texto: string, ms = 5000) {
    setToast(texto);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  }

  function mostrarOverlay(o: Omit<Overlay, "ms"> & { ms?: number }) {
    const ms = o.ms ?? 2800;
    setOverlay({ ...o, ms });
    if (overlayTimer.current) clearTimeout(overlayTimer.current);
    overlayTimer.current = setTimeout(() => setOverlay(null), ms);
  }
  function cerrarOverlay() {
    if (overlayTimer.current) clearTimeout(overlayTimer.current);
    setOverlay(null);
  }

  // ---- cola sin conexión ----
  const encolar = useCallback((p: Omit<Pendiente, "id">) => {
    const cola = leerCola();
    cola.push({ ...p, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
    guardarCola(cola);
    setPendientes(cola.length);
  }, []);

  const vaciarCola = useCallback(async () => {
    if (enviandoCola.current) return;
    const cola = leerCola();
    setPendientes(cola.length);
    if (!cola.length) return;
    enviandoCola.current = true;
    // Saca un apunte releyendo localStorage: mientras el POST estaba en vuelo puede haberse
    // encolado otro fichaje y escribir la foto antigua lo borraría sin aviso.
    const quitarDeCola = (id: string) => {
      const nueva = leerCola().filter((x) => x.id !== id);
      guardarCola(nueva);
      setPendientes(nueva.length);
    };
    const enviados: string[] = [];
    let nuevosFallidos = 0;
    try {
      for (const p of cola) {
        try {
          const { r, d } = await post({ token: p.token, pin: p.pin, tipo: p.tipo, ts_dispositivo: p.ts_dispositivo });
          if (esServidorCaido(r.status)) break; // seguimos sin servidor: lo intentamos más tarde
          // Respuesta definitiva (ok, duplicado o error 4xx): fuera de la cola (y el PIN con él).
          quitarDeCola(p.id);
          if (r.ok && d.ok) {
            const quien = d.nombre ? `${d.nombre} · ` : "";
            const horaTablet = horaDispositivo(p.ts_dispositivo);
            const horaServidor: string = d.hora || "";
            // La hora legal es la del servidor: si no coincide con la de la tablet se dice, no se esconde.
            const cuando =
              horaServidor && horaServidor !== horaTablet
                ? `fichada a las ${horaTablet} en la tablet, registrada a las ${horaServidor}`
                : `a las ${horaTablet}`;
            enviados.push(`${quien}${NT[p.tipo]} ${cuando}${d.duplicado ? " (ya constaba)" : ""}`);
          } else {
            const lista = leerFallidos();
            lista.push({ id: p.id, tipo: p.tipo, ts_dispositivo: p.ts_dispositivo, error: d.error || `Error ${r.status}` });
            guardarFallidos(lista);
            setFallidos(lista);
            nuevosFallidos++;
          }
        } catch (e) {
          if (esFalloRed(e)) break; // sigue sin red: reintento más tarde
          throw e;
        }
      }
    } catch {
      /* nada: se reintenta en el siguiente ciclo */
    } finally {
      enviandoCola.current = false;
    }
    const partes: string[] = [];
    if (enviados.length === 1) partes.push(`Enviado ${enviados[0]}`);
    else if (enviados.length > 1) partes.push(`Enviados ${enviados.length} fichajes pendientes: ${enviados.join(", ")}`);
    if (nuevosFallidos) {
      partes.push(
        `${nuevosFallidos === 1 ? "Un fichaje pendiente no se pudo registrar" : `${nuevosFallidos} fichajes pendientes no se pudieron registrar`}. Avisa a tu encargado.`
      );
    }
    if (partes.length) avisar(partes.join(" · "), enviados.length + nuevosFallidos > 1 ? 9000 : 5000);
  }, []);

  useEffect(() => {
    setPendientes(leerCola().length);
    setFallidos(leerFallidos());
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    // Si el ping inicial falló, el nombre del local se recupera en cuanto vuelva la red.
    const recuperarLocal = () => {
      const t = token();
      if (localOk.current || !t) return;
      comprobarToken(t)
        .then((local) => { localOk.current = true; setNombreLocal(local); })
        .catch(() => { /* seguimos sin red: se reintenta en el siguiente ciclo */ });
    };
    const ciclo = () => { recuperarLocal(); void vaciarCola(); };
    const alOnline = () => { setOnline(true); ciclo(); };
    const alOffline = () => setOnline(false);
    window.addEventListener("online", alOnline);
    window.addEventListener("offline", alOffline);
    const t = setInterval(ciclo, REINTENTO_MS);
    void vaciarCola();
    return () => {
      window.removeEventListener("online", alOnline);
      window.removeEventListener("offline", alOffline);
      clearInterval(t);
    };
  }, [vaciarCola, comprobarToken]);

  // ---- fichar ----
  async function fichar(tipo: Tipo) {
    if (pin.length !== 4 || enviando) return;
    setEnviando(true);
    const tsDispositivo = new Date().toISOString();
    const pinActual = pin;
    const tok = token();
    const guardarEnCola = () => {
      encolar({ pin: pinActual, tipo, ts_dispositivo: tsDispositivo, token: tok });
      mostrarOverlay({
        clase: "aviso",
        icono: "⏳",
        titulo: "Guardado",
        detalle: `${NT[tipo]} · ${horaDispositivo(tsDispositivo)}\nSe enviará al recuperar la conexión.`,
        ms: 3500,
      });
    };
    try {
      const { r, d } = await post({ token: tok, pin: pinActual, tipo, ts_dispositivo: tsDispositivo });
      if (r.ok && d.ok) {
        let detalle = `${NT[d.tipo]} · ${d.hora}`;
        if (d.duplicado) detalle += "\n(Ya estaba registrado hace un momento)";
        else if (tipo === "entrada" && d.anterior?.tipo === "entrada") detalle += "\n(Ojo: tu último fichaje ya era una entrada)";
        mostrarOverlay({ clase: "ok", icono: "✓", titulo: d.nombre, detalle, resumen: d.resumen ?? null, ms: 5000 });
        void vaciarCola();
      } else if (esServidorCaido(r.status)) {
        guardarEnCola();
      } else {
        mostrarOverlay({
          clase: "mal",
          icono: "✕",
          titulo: "No registrado",
          detalle: (d.error || "Inténtalo otra vez.") + (pideEncargado(r.status) ? "\nAvisa a tu encargado." : ""),
        });
      }
    } catch (e) {
      if (esFalloRed(e)) guardarEnCola();
      else mostrarOverlay({ clase: "mal", icono: "✕", titulo: "No registrado", detalle: "Inténtalo otra vez. Si sigue fallando, avisa a tu encargado." });
    } finally {
      setPin("");
      setEnviando(false);
    }
  }

  // ---- ver mis horas (sin fichar) ----
  async function verHoras() {
    if (pin.length !== 4 || enviando) return;
    setEnviando(true);
    try {
      const { r, d } = await post({ token: token(), pin, accion: "resumen" });
      if (r.ok && d.ok) {
        mostrarOverlay({ clase: "ok", icono: "⏱", titulo: d.nombre, detalle: "Tus horas de hoy", resumen: d.resumen ?? null, ms: 9000 });
      } else {
        mostrarOverlay({
          clase: "mal",
          icono: "✕",
          titulo: "No disponible",
          detalle: (d.error || "Inténtalo otra vez.") + (pideEncargado(r.status) ? "\nAvisa a tu encargado." : ""),
        });
      }
    } catch {
      mostrarOverlay({ clase: "mal", icono: "✕", titulo: "Sin conexión", detalle: "Ahora mismo no puedo consultar tus horas." });
    } finally {
      setPin("");
      setEnviando(false);
    }
  }

  function borrarFallidos() {
    guardarFallidos([]);
    setFallidos([]);
  }

  return (
    <div className="kio">
      <header
        onClick={() => {
          toques.current++;
          if (toquesTimer.current) clearTimeout(toquesTimer.current);
          toquesTimer.current = setTimeout(() => (toques.current = 0), 1500);
          if (toques.current >= 5) {
            toques.current = 0;
            setTokenInput(token());
            setConfigMsg("");
            setPantalla("config");
          }
        }}
      >
        <div className="marca">Bonita Menorca · Fichaje</div>
        <div className="estado">
          {pendientes > 0 ? (
            <span className="badge pendientes">
              {pendientes} {pendientes === 1 ? "fichaje por enviar" : "fichajes por enviar"}
            </span>
          ) : null}
          {fallidos.length > 0 ? (
            <span className="badge fallidos">
              {fallidos.length} {fallidos.length === 1 ? "no enviado" : "no enviados"}
            </span>
          ) : null}
          {!online ? <span className="badge offline">Sin conexión</span> : null}
          <span className="local">{pantalla === "fichar" ? nombreLocal : ""}</span>
        </div>
      </header>

      {pantalla === "cargando" ? <div className="centro-msg">Cargando…</div> : null}

      {pantalla === "config" ? (
        <div className="config">
          <h2>Configurar tablet</h2>
          <p>Pega el código del dispositivo que te ha dado dirección.</p>
          <input
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Código del dispositivo"
            autoComplete="off"
          />
          <button
            onClick={async () => {
              const t = tokenInput.trim();
              if (!t) { setConfigMsg("Pega el código antes de guardar."); return; }
              setConfigMsg("Comprobando…");
              try {
                const local = await comprobarToken(t);
                localStorage.setItem(LLAVE, t);
                localOk.current = true;
                setNombreLocal(local);
                setConfigMsg("");
                setPantalla("fichar");
              } catch (e) {
                setConfigMsg("✕ " + (e as Error).message);
              }
            }}
          >
            Comprobar y guardar
          </button>
          <div className="msg">{configMsg}</div>
          {pendientes > 0 ? (
            <p className="nota-cola">
              Hay {pendientes} {pendientes === 1 ? "fichaje pendiente" : "fichajes pendientes"} de enviar. Se enviarán solos al recuperar la conexión.
            </p>
          ) : null}
          {fallidos.length > 0 ? (
            <div className="fallidos-lista">
              <h3>{fallidos.length === 1 ? "Un fichaje no se pudo registrar" : `${fallidos.length} fichajes no se pudieron registrar`}</h3>
              <p>Anótalos a mano en Fichajes antes de borrarlos de aquí.</p>
              <ul>
                {fallidos.map((f) => (
                  <li key={f.id}>
                    <span className="f-tipo">{NT[f.tipo]} {fechaHoraDispositivo(f.ts_dispositivo)}</span>
                    <span className="f-error">{f.error}</span>
                  </li>
                ))}
              </ul>
              <button className="secundario" onClick={borrarFallidos}>
                Entendido, borrar
              </button>
            </div>
          ) : null}
          {token() ? (
            <button className="secundario" onClick={() => setPantalla("fichar")}>
              Volver al fichaje
            </button>
          ) : null}
        </div>
      ) : null}

      {pantalla === "fichar" ? (
        <div className="fichar">
          <div className="reloj">{reloj}</div>
          <div className="fecha">{fecha}</div>
          <div className="puntos">
            {[0, 1, 2, 3].map((i) => <div key={i} className={`punto ${i < pin.length ? "lleno" : ""}`} />)}
          </div>
          <div className="teclado">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "<"].map((n) => (
              <button
                key={n}
                onClick={() => {
                  if (n === "C") setPin("");
                  else if (n === "<") setPin(pin.slice(0, -1));
                  else if (pin.length < 4) setPin(pin + n);
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <div className={`acciones ${pin.length === 4 && !enviando ? "activas" : ""}`}>
            <button className="b-entrada" onClick={() => fichar("entrada")}>Entrada</button>
            <button className="b-salida" onClick={() => fichar("salida")}>Salida</button>
            <button className="b-pausa" onClick={() => fichar("pausa_inicio")}>Empiezo pausa</button>
            <button className="b-pausa" onClick={() => fichar("pausa_fin")}>Vuelvo de pausa</button>
            <button className="b-horas" onClick={() => verHoras()}>Ver mis horas</button>
          </div>
          <div className="pista">{pin.length === 4 ? "Elige qué quieres hacer" : "Marca tu PIN de 4 cifras"}</div>
        </div>
      ) : null}

      {overlay ? (
        <div className={`overlay visible ${overlay.clase}`} onClick={cerrarOverlay}>
          <div className="icono">{overlay.icono}</div>
          <h2>{overlay.titulo}</h2>
          <div className="detalle">{overlay.detalle}</div>
          {overlay.resumen ? <ResumenHoy r={overlay.resumen} /> : null}
          <div className="cerrar">Toca para cerrar</div>
        </div>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function ResumenHoy({ r }: { r: Resumen }) {
  return (
    <div className="hoy">
      <div className="hoy-linea">{lineaHoy(r)}</div>
      {r.fichajes.length ? (
        <div className="hoy-lista">
          {r.fichajes.map((f, i) => (
            <span key={i} className={`chip ${f.tipo}`}>
              {NT[f.tipo]} {f.hora}
            </span>
          ))}
        </div>
      ) : null}
      {r.enCurso ? (
        <div className="hoy-estado">{r.enPausa ? "Estás en pausa" : "Jornada en curso"}</div>
      ) : null}
      {r.incidencias.length ? <div className="hoy-inc">Revisar: {r.incidencias.join(", ")}</div> : null}
    </div>
  );
}

function horaDispositivo(iso: string) {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

/** «30/09 09:02» para la lista de fallidos (pueden ser de otro día). */
function fechaHoraDispositivo(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }) + " " + horaDispositivo(iso);
}
