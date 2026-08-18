"use client";

import { useEffect, useRef, useState } from "react";
import AvisoVersion from "../aviso-version";

/**
 * Carga de facturas y albaranes desde el móvil — el segundo camino de entrada
 * a Compras (el primero es la propia app, que no cambia). Público como los
 * fronts de reservas y visitas: Dakota no tiene usuario de Hostelero todavía
 * y esta página no enseña ningún dato, solo deja ficheros.
 *
 * Cómo encaja con la app de Compras SIN que Lucía note nada distinto: cada
 * fichero va al mismo bucket ('documentos' del Supabase de compras) y deja
 * una fila PENDIENTE en compras_correo_adjunto con correo_id nulo — la misma
 * bandeja que llena la ingesta de correo. La app los procesa exactamente
 * igual que un adjunto llegado por email. La clave de abajo es la publicable
 * (anon), la misma que ya vive en el repo público de compras-bonita.
 */
const SB_URL = "https://qjfraquadsvtfwolfbkb.supabase.co";
const SB_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqZnJhcXVhZHN2dGZ3b2xmYmtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNTYxNzIsImV4cCI6MjA5NTYzMjE3Mn0.3XidwXSbZPWKdlQD7vPOnqc96oY7sEVq7Bc74KF3okk";
const BUCKET = "documentos";

// Los mismos tipos que admite la ingesta de correo de Compras.
const TIPOS_OK = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];
const EXT_OK = ["pdf", "jpg", "jpeg", "png", "webp", "heic"];

type Subida = {
  nombre: string;
  estado: "subiendo" | "ok" | "error";
  detalle?: string;
  /** id de la fila en la bandeja de Compras: permite enseñar su estado en vivo. */
  idBandeja?: number;
  /** PENDIENTE → PROCESANDO → PROCESADO / DESCARTADO / ERROR, según la app. */
  estadoBandeja?: string;
  notaBandeja?: string;
};

export default function SubirFacturas() {
  const [subidas, setSubidas] = useState<Subida[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [quien, setQuien] = useState("");
  // El nombre se recuerda en el navegador; se lee en un efecto y no en el
  // estado inicial para que el HTML del servidor y el del cliente coincidan.
  useEffect(() => setQuien(localStorage.getItem("compras_quien") ?? ""), []);
  const entrada = useRef<HTMLInputElement>(null);

  function apunta(nombre: string, cambio: Partial<Subida>) {
    setSubidas((s) => s.map((x) => (x.nombre === nombre ? { ...x, ...cambio } : x)));
  }

  async function subir(ficheros: FileList | null) {
    if (!ficheros || ficheros.length === 0) return;
    setOcupado(true);
    localStorage.setItem("compras_quien", quien);

    for (const f of Array.from(ficheros)) {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      setSubidas((s) => [...s, { nombre: f.name, estado: "subiendo" }]);

      if (!TIPOS_OK.includes(f.type) && !EXT_OK.includes(ext)) {
        apunta(f.name, { estado: "error", detalle: "Solo PDF o foto (jpg, png, webp, heic)" });
        continue;
      }

      try {
        // 1) el fichero, al mismo bucket que usa la app de Compras
        const ruta = `movil_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext || "bin"}`;
        const r1 = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${ruta}`, {
          method: "POST",
          headers: {
            apikey: SB_KEY,
            Authorization: `Bearer ${SB_KEY}`,
            "Content-Type": f.type || "application/octet-stream",
          },
          body: f,
        });
        if (!r1.ok) throw new Error(`no se pudo guardar (${r1.status})`);

        // 2) la fila PENDIENTE en la bandeja que la app ya procesa sola
        const url = `${SB_URL}/storage/v1/object/public/${BUCKET}/${ruta}`;
        const r2 = await fetch(`${SB_URL}/rest/v1/compras_correo_adjunto`, {
          method: "POST",
          headers: {
            apikey: SB_KEY,
            Authorization: `Bearer ${SB_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            correo_id: null,
            nombre_archivo: `${quien ? `[móvil · ${quien}] ` : "[móvil] "}${f.name}`,
            mime: f.type || null,
            url,
            storage_path: ruta,
            estado: "PENDIENTE",
            error: null,
          }),
        });
        if (!r2.ok) throw new Error(`guardado, pero sin apuntar en la bandeja (${r2.status})`);
        const filas = (await r2.json()) as { id: number }[];

        apunta(f.name, { estado: "ok", idBandeja: filas[0]?.id, estadoBandeja: "PENDIENTE" });
      } catch (e) {
        apunta(f.name, { estado: "error", detalle: e instanceof Error ? e.message : "fallo de red" });
      }
    }

    setOcupado(false);
    if (entrada.current) entrada.current.value = "";
  }

  // Mientras la página siga abierta, se consulta cada pocos segundos cómo van
  // los ficheros en la bandeja. El OCR corre en el navegador de quien tenga
  // abierta la app de Compras, así que desde aquí puede tardar: lo importante
  // es que se VEA — «en cola» no es «perdido». Cerrar la página no corta nada.
  useEffect(() => {
    const enVuelo = subidas.filter(
      (x) => x.idBandeja && (x.estadoBandeja === "PENDIENTE" || x.estadoBandeja === "PROCESANDO"),
    );
    if (enVuelo.length === 0) return;
    const temporizador = setTimeout(async () => {
      try {
        const ids = enVuelo.map((x) => x.idBandeja).join(",");
        const r = await fetch(
          `${SB_URL}/rest/v1/compras_correo_adjunto?id=in.(${ids})&select=id,estado,error`,
          { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } },
        );
        if (!r.ok) return;
        const filas = (await r.json()) as { id: number; estado: string; error: string | null }[];
        setSubidas((lista) =>
          lista.map((x) => {
            const f = filas.find((y) => y.id === x.idBandeja);
            return f ? { ...x, estadoBandeja: f.estado, notaBandeja: f.error ?? undefined } : x;
          }),
        );
      } catch {
        /* sin red un rato: se reintenta en el siguiente ciclo */
      }
    }, 5000);
    return () => clearTimeout(temporizador);
  }, [subidas]);

  const correctas = subidas.filter((s) => s.estado === "ok").length;

  function pintaBandeja(x: Subida): { icono: string; texto: string } {
    if (x.estado === "subiendo") return { icono: "⏳", texto: "subiendo…" };
    if (x.estado === "error") return { icono: "⚠️", texto: x.detalle ?? "error" };
    switch (x.estadoBandeja) {
      case "PENDIENTE":
        return { icono: "📥", texto: "en cola" };
      case "PROCESANDO":
        return { icono: "⚙️", texto: "procesando…" };
      case "PROCESADO":
        return x.notaBandeja
          ? { icono: "✅", texto: x.notaBandeja }
          : { icono: "✅", texto: "procesado" };
      case "DESCARTADO":
        return { icono: "🚫", texto: x.notaBandeja ?? "descartado" };
      case "ERROR":
        return { icono: "⚠️", texto: x.notaBandeja ?? "error al procesar — se reintentará" };
      default:
        return { icono: "✅", texto: "guardado" };
    }
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px 48px", fontFamily: "system-ui, sans-serif" }}>
      <AvisoVersion />
      <h1 style={{ fontSize: 22, marginBottom: 2 }}>Subir facturas</h1>
      <p style={{ color: "#666", fontSize: 14, marginBottom: 20 }}>
        Compras · Bonita Menorca. Haz foto o elige el PDF: entra solo en la
        bandeja de Compras, como si llegara por correo.
      </p>

      <label style={{ display: "block", fontSize: 13, marginBottom: 16 }}>
        <span style={{ display: "block", marginBottom: 4, color: "#444" }}>¿Quién sube? (se guarda para la próxima)</span>
        <input
          type="text"
          value={quien}
          onChange={(e) => setQuien(e.target.value)}
          placeholder="Dakota"
          style={{ width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 16 }}
        />
      </label>

      <input
        ref={entrada}
        type="file"
        multiple
        accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
        onChange={(e) => subir(e.target.files)}
        style={{ display: "none" }}
      />
      <button
        type="button"
        disabled={ocupado}
        onClick={() => entrada.current?.click()}
        style={{
          width: "100%", padding: "22px 16px", fontSize: 18, fontWeight: 600,
          background: ocupado ? "#9bb5ac" : "#0F6E56", color: "#fff",
          border: "none", borderRadius: 12, cursor: "pointer",
        }}
      >
        {ocupado ? "Subiendo…" : "📷 Hacer foto o elegir ficheros"}
      </button>

      {subidas.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 20 }}>
          {subidas.map((s, i) => {
            const b = pintaBandeja(s);
            return (
              <li key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "8px 2px", borderBottom: "1px solid #eee", fontSize: 14 }}>
                <span>{b.icono}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.nombre}</span>
                <span style={{ color: s.estado === "error" ? "#B42318" : "#5F6B65", fontSize: 12, maxWidth: "45%" }}>{b.texto}</span>
              </li>
            );
          })}
        </ul>
      )}

      {correctas > 0 && !ocupado && (
        <p style={{ marginTop: 16, padding: "12px 14px", background: "#E1F5EE", borderRadius: 10, fontSize: 14 }}>
          {correctas === 1 ? "1 fichero" : `${correctas} ficheros`} en la bandeja de
          Compras. <strong>Puedes cerrar esta página tranquilamente</strong>: quedan en
          cola y se procesan en cuanto alguien tiene abierta la app de Compras. Si la
          dejas abierta, aquí verás cómo avanzan.
        </p>
      )}
    </main>
  );
}
