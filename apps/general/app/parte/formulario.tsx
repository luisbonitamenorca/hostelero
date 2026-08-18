"use client";

import { useEffect, useRef, useState } from "react";
import AvisoVersion from "../aviso-version";

/**
 * El mismo formulario «Nueva petición» de la app de mantenimiento, en versión
 * móvil y pública. Desde el port al esqueleto (18-08-2026) NO toca la base:
 * envía a /api/publico/parte, que valida y escribe en mant_partes del
 * Supabase de Hostelero con la service key — el patrón de la casa para
 * fronts sin sesión. Para Marcos, un parte del móvil y uno del panel son
 * indistinguibles. Las fotos van comprimidas en base64 dentro de `medios`.
 */

// Las mismas listas que la app de mantenimiento (su pestaña Personas guarda
// cambios solo en el navegador de cada uno, así que este es el punto de partida
// común; si algún día pasan a tabla, este front la leerá de ahí).
const RESPONSABLES = ["Xiscu", "Sonia", "Rafa", "Dani", "Vanesa", "Lena", "Mabel", "Matías",
  "Marta", "Charo", "Toret", "Lucía", "Sílvia", "Dakota", "Nuria", "Luis", "Patricia"];
const CENTROS = ["Bodega Binifadet", "Restaurante Binifadet", "Tienda Binifadet",
  "Restaurante Tamarindos", "Bar Tamarindos", "Casa Tirant", "Producción", "Estructura / General"];
const TIPOS = ["Mantenimiento general", "Jardinería / Campo", "Fontanería", "Electricidad",
  "Climatización", "Limpieza especial", "Instalaciones", "Otro"];
const URGENCIAS = ["Normal", "Urgente", "Crítico"] as const;

type Medio = { dataUrl: string; isVideo: boolean; name: string };

/** Fotos comprimidas como en la app: canvas a máx. 1400 px, JPEG al 80 %. */
function comprimirImagen(fichero: File): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onerror = () => rechazar(new Error("no se pudo leer la foto"));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => rechazar(new Error("formato de foto no reconocido"));
      img.onload = () => {
        const MAX = 1400;
        const factor = Math.min(1, MAX / Math.max(img.width, img.height));
        const lienzo = document.createElement("canvas");
        lienzo.width = Math.round(img.width * factor);
        lienzo.height = Math.round(img.height * factor);
        lienzo.getContext("2d")!.drawImage(img, 0, 0, lienzo.width, lienzo.height);
        resolver(lienzo.toDataURL("image/jpeg", 0.8));
      };
      img.src = String(lector.result);
    };
    lector.readAsDataURL(fichero);
  });
}

function leerVideo(fichero: File): Promise<string> {
  return new Promise((resolver, rechazar) => {
    if (fichero.size > 3 * 1024 * 1024) {
      rechazar(new Error("el vídeo pasa de 3 MB — graba unos segundos o mejor haz fotos"));
      return;
    }
    const lector = new FileReader();
    lector.onerror = () => rechazar(new Error("no se pudo leer el vídeo"));
    lector.onload = () => resolver(String(lector.result));
    lector.readAsDataURL(fichero);
  });
}

const hoy = () => new Date().toISOString().slice(0, 10);

const estiloCampo = {
  width: "100%", padding: "12px", border: "1px solid #D9D3C6", borderRadius: 8,
  fontSize: 16, background: "#FDFCF9", fontFamily: "inherit",
} as const;

export default function FormularioParte() {
  const [responsable, setResponsable] = useState("");
  const [centro, setCentro] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [tipo, setTipo] = useState("");
  const [urgencia, setUrgencia] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [medios, setMedios] = useState<Medio[]>([]);
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => setResponsable(localStorage.getItem("parte_quien") ?? ""), []);

  async function anadirFicheros(lista: FileList | null) {
    if (!lista) return;
    for (const f of Array.from(lista)) {
      try {
        const esVideo = f.type.startsWith("video/");
        const dataUrl = esVideo ? await leerVideo(f) : await comprimirImagen(f);
        setMedios((m) => [...m, { dataUrl, isVideo: esVideo, name: f.name }]);
      } catch (e) {
        setAviso({ texto: `${f.name}: ${e instanceof Error ? e.message : "no se pudo añadir"}`, error: true });
      }
    }
    if (entrada.current) entrada.current.value = "";
  }

  async function enviar() {
    if (!responsable || !centro || !descripcion.trim() || !fecha || !urgencia || !tipo) {
      setAviso({ texto: "Completa todos los campos (las fotos son opcionales).", error: true });
      return;
    }
    setEnviando(true);
    setAviso(null);
    localStorage.setItem("parte_quien", responsable);
    try {
      const r = await fetch("/api/publico/parte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responsable, centro, tipo, fecha,
          urgencia, descripcion: descripcion.trim(),
          medios,
        }),
      });
      if (!r.ok) {
        const cuerpo = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(cuerpo?.error ?? `respuesta ${r.status}`);
      }
      setAviso({ texto: "Parte enviado. Marcos y su equipo lo verán en el panel.", error: false });
      setCentro(""); setTipo(""); setUrgencia(""); setDescripcion(""); setMedios([]); setFecha(hoy());
    } catch (e) {
      setAviso({
        texto: e instanceof Error && e.message !== "Failed to fetch"
          ? `No se pudo enviar: ${e.message}`
          : "No se pudo enviar. Comprueba la conexión e inténtalo otra vez.",
        error: true,
      });
    }
    setEnviando(false);
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px 48px",
      fontFamily: "system-ui, sans-serif", background: "#F6F3ED", minHeight: "100vh" }}>
      <AvisoVersion />
      <h1 style={{ fontSize: 22, marginBottom: 2, color: "#1E1B16" }}>Parte de mantenimiento</h1>
      <p style={{ color: "#6B6456", fontSize: 14, marginBottom: 20 }}>
        Bonita Menorca. Cuéntanos qué hay que revisar o reparar: le llega a Marcos al momento.
      </p>

      <div style={{ display: "grid", gap: 14 }}>
        <label style={{ fontSize: 13, color: "#1E1B16" }}>
          <span style={{ display: "block", marginBottom: 4 }}>¿Quién eres? (se guarda para la próxima)</span>
          <select value={responsable} onChange={(e) => setResponsable(e.target.value)} style={estiloCampo}>
            <option value="">— Selecciona —</option>
            {RESPONSABLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>

        <label style={{ fontSize: 13 }}>
          <span style={{ display: "block", marginBottom: 4 }}>Centro</span>
          <select value={centro} onChange={(e) => setCentro(e.target.value)} style={estiloCampo}>
            <option value="">— Selecciona —</option>
            {CENTROS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ fontSize: 13 }}>
            <span style={{ display: "block", marginBottom: 4 }}>Fecha solicitada</span>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={estiloCampo} />
          </label>
          <label style={{ fontSize: 13 }}>
            <span style={{ display: "block", marginBottom: 4 }}>Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={estiloCampo}>
              <option value="">— Selecciona —</option>
              {TIPOS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        </div>

        <div style={{ fontSize: 13 }}>
          <span style={{ display: "block", marginBottom: 4 }}>Urgencia</span>
          <div style={{ display: "flex", gap: 8 }}>
            {URGENCIAS.map((u) => (
              <button key={u} type="button" onClick={() => setUrgencia(u)}
                style={{
                  flex: 1, padding: "12px 4px", borderRadius: 8, fontSize: 14, cursor: "pointer",
                  border: urgencia === u ? "2px solid #4A5A3E" : "1px solid #D9D3C6",
                  background: urgencia === u
                    ? (u === "Crítico" ? "#F8EBEB" : u === "Urgente" ? "#FBF4E0" : "#EBF0E6")
                    : "#FDFCF9",
                  fontWeight: urgencia === u ? 600 : 400,
                }}>
                {u}
              </button>
            ))}
          </div>
        </div>

        <label style={{ fontSize: 13 }}>
          <span style={{ display: "block", marginBottom: 4 }}>Descripción</span>
          <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={4}
            placeholder="Describe qué hay que revisar o reparar…" style={{ ...estiloCampo, resize: "vertical" }} />
        </label>

        <input ref={entrada} type="file" multiple accept="image/*,video/*"
          onChange={(e) => anadirFicheros(e.target.files)} style={{ display: "none" }} />
        <button type="button" onClick={() => entrada.current?.click()}
          style={{ ...estiloCampo, cursor: "pointer", textAlign: "center", color: "#6B6456", borderStyle: "dashed" }}>
          📷 Añadir fotos o un vídeo corto (opcional)
        </button>

        {medios.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {medios.map((m, i) => (
              <div key={i} style={{ position: "relative", width: 76, height: 76 }}>
                {m.isVideo ? (
                  <video src={m.dataUrl} muted style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} />
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={m.dataUrl} alt={m.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} />
                )}
                <button type="button" onClick={() => setMedios((x) => x.filter((_, j) => j !== i))}
                  style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%",
                    border: "none", background: "#1E1B16", color: "#fff", cursor: "pointer", fontSize: 12 }}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <button type="button" disabled={enviando} onClick={enviar}
          style={{ padding: "16px", fontSize: 17, fontWeight: 600, border: "none", borderRadius: 10,
            background: enviando ? "#8a9480" : "#4A5A3E", color: "#fff", cursor: "pointer" }}>
          {enviando ? "Enviando…" : "Enviar parte"}
        </button>

        {aviso && (
          <p style={{ padding: "12px 14px", borderRadius: 8, fontSize: 14,
            background: aviso.error ? "#F8EBEB" : "#EBF0E6",
            color: aviso.error ? "#A83232" : "#4A5A3E" }}>
            {aviso.texto}
          </p>
        )}
      </div>
    </main>
  );
}
