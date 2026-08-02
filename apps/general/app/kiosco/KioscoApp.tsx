"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Kiosco de fichaje para tablet: sin sesión. El código del dispositivo vive en
// localStorage (misma llave que el legado) y todo pasa por /api/rrhh/fichar.
const LLAVE = "bonita_token_tablet";
const NT: Record<string, string> = { entrada: "Entrada", salida: "Salida", pausa_inicio: "Inicio de pausa", pausa_fin: "Vuelta de pausa" };

export default function KioscoApp() {
  const [pantalla, setPantalla] = useState<"cargando" | "config" | "fichar">("cargando");
  const [nombreLocal, setNombreLocal] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [configMsg, setConfigMsg] = useState("");
  const [pin, setPin] = useState("");
  const [reloj, setReloj] = useState("");
  const [fecha, setFecha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [overlay, setOverlay] = useState<{ clase: string; icono: string; titulo: string; detalle: string } | null>(null);
  const toques = useRef(0);
  const toquesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const r = await fetch("/api/rrhh/fichar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: t, accion: "ping" }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Sin respuesta del servidor");
    return d.local as string;
  }, []);

  useEffect(() => {
    const t = token();
    if (!t) { setPantalla("config"); return; }
    comprobarToken(t)
      .then((local) => { setNombreLocal(local); setPantalla("fichar"); })
      .catch(() => { setNombreLocal("Sin conexión"); setPantalla("fichar"); });
  }, [comprobarToken]);

  function mostrarOverlay(clase: string, icono: string, titulo: string, detalle: string) {
    setOverlay({ clase, icono, titulo, detalle });
    if (overlayTimer.current) clearTimeout(overlayTimer.current);
    overlayTimer.current = setTimeout(() => setOverlay(null), 2800);
  }

  async function fichar(tipo: string) {
    if (pin.length !== 4 || enviando) return;
    setEnviando(true);
    try {
      const r = await fetch("/api/rrhh/fichar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token(), pin, tipo }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        let detalle = `${NT[d.tipo]} · ${d.hora}`;
        if (tipo === "entrada" && d.anterior?.tipo === "entrada") detalle += "\n(Ojo: tu último fichaje de hoy ya era una entrada)";
        mostrarOverlay("ok", "✓", d.nombre, detalle);
      } else {
        mostrarOverlay("mal", "✕", "No registrado", d.error || "Sin conexión. Inténtalo otra vez.");
      }
    } catch {
      mostrarOverlay("mal", "✕", "Sin conexión", "Avisa a tu encargado si sigue fallando.");
    } finally {
      setPin("");
      setEnviando(false);
    }
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
        <div className="local">{pantalla === "fichar" ? nombreLocal : ""}</div>
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
          <div className={`acciones ${pin.length === 4 ? "activas" : ""}`}>
            <button className="b-entrada" onClick={() => fichar("entrada")}>Entrada</button>
            <button className="b-salida" onClick={() => fichar("salida")}>Salida</button>
            <button className="b-pausa" onClick={() => fichar("pausa_inicio")}>Empiezo pausa</button>
            <button className="b-pausa" onClick={() => fichar("pausa_fin")}>Vuelvo de pausa</button>
          </div>
        </div>
      ) : null}

      {overlay ? (
        <div className={`overlay visible ${overlay.clase}`}>
          <div className="icono">{overlay.icono}</div>
          <h2>{overlay.titulo}</h2>
          <div className="detalle">{overlay.detalle}</div>
        </div>
      ) : null}
    </div>
  );
}
