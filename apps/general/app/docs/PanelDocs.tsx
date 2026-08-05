"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  urlFirmada,
  prepararSubida,
  registrarDocumento,
  borrarDocumento,
  crearCategoria,
  renombrarCategoria,
  borrarCategoria,
  moverCategoria,
  crearSubcategoria,
  renombrarSubcategoria,
  borrarSubcategoria,
  moverSubcategoria,
} from "./acciones";

export type Categoria = { id: string; nombre: string; orden: number };
export type Subcategoria = { id: string; categoria_id: string; nombre: string; orden: number };
export type Documento = {
  id: string;
  categoria_id: string;
  subcategoria_id: string | null;
  centro_id: string | null;
  nombre: string;
  descripcion: string | null;
  archivo_nombre: string;
  archivo_tipo: string | null;
  archivo_tamano: number | null;
  actualizado_en: string;
};
type Centro = { id: string; nombre: string };

function fmtTamano(b: number | null) {
  const n = Number(b) || 0;
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
function fmtFecha(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function icono(tipo: string | null) {
  const t = (tipo || "").toLowerCase();
  if (t === "pdf") return "📄";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(t)) return "🖼️";
  if (["xls", "xlsx", "csv"].includes(t)) return "📊";
  if (["doc", "docx"].includes(t)) return "📝";
  if (["ppt", "pptx"].includes(t)) return "📽️";
  if (["zip", "rar", "7z"].includes(t)) return "🗜️";
  return "📎";
}

export default function PanelDocs({
  categorias,
  subcategorias,
  documentos,
  centros,
}: {
  categorias: Categoria[];
  subcategorias: Subcategoria[];
  documentos: Documento[];
  centros: Centro[];
}) {
  const router = useRouter();
  const [catActiva, setCatActiva] = useState<string | null>(categorias[0]?.id ?? null);
  const [subActiva, setSubActiva] = useState<string>("all");
  const [centroFiltro, setCentroFiltro] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [gestion, setGestion] = useState(false);
  const [modalSubida, setModalSubida] = useState(false);
  const [aviso, setAviso] = useState("");

  const nombreCentro = useMemo(
    () => Object.fromEntries(centros.map((c) => [c.id, c.nombre])),
    [centros]
  );
  const catPorId = useMemo(
    () => Object.fromEntries(categorias.map((c) => [c.id, c.nombre])),
    [categorias]
  );
  const subPorId = useMemo(
    () => Object.fromEntries(subcategorias.map((s) => [s.id, s.nombre])),
    [subcategorias]
  );

  const buscando = busqueda.trim() !== "";
  const subsDeCat = subcategorias.filter((s) => s.categoria_id === catActiva);

  const lista = useMemo(() => {
    let docs = [...documentos];
    if (buscando) {
      const q = busqueda.trim().toLowerCase();
      docs = docs.filter((d) =>
        `${d.nombre} ${d.descripcion ?? ""} ${d.archivo_nombre}`.toLowerCase().includes(q)
      );
    } else {
      docs = docs.filter((d) => d.categoria_id === catActiva);
      if (subActiva !== "all") docs = docs.filter((d) => d.subcategoria_id === subActiva);
    }
    // El filtro de centro muestra los del centro elegido + los generales (sin centro)
    if (centroFiltro) docs = docs.filter((d) => !d.centro_id || d.centro_id === centroFiltro);
    return docs;
  }, [documentos, buscando, busqueda, catActiva, subActiva, centroFiltro]);

  async function abrir(id: string, descargar: boolean) {
    setAviso("");
    const r = await urlFirmada(id, descargar);
    if (!r.ok || !r.data) {
      setAviso(r.error ?? "Error");
      return;
    }
    window.open(r.data.url, "_blank", "noopener");
  }

  async function eliminar(d: Documento) {
    if (!confirm(`¿Eliminar "${d.nombre}"? Esta acción no se puede deshacer.`)) return;
    const r = await borrarDocumento(d.id);
    setAviso(r.error ?? "");
    router.refresh();
  }

  // ---- gestión de carpetas ----
  async function accionCarpeta(fn: () => Promise<{ ok: boolean; error?: string }>) {
    const r = await fn();
    if (!r.ok && r.error) alert(r.error);
    router.refresh();
  }

  return (
    <main className="contenido docs-panel">
      <div className="docs-cabecera-fila">
        <h1 className="titulo">Documentos</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="boton-secundario" onClick={() => setGestion(!gestion)}>
            ⚙ Carpetas
          </button>
          <button className="boton-secundario" onClick={() => setModalSubida(true)}>
            ＋ Subir documento
          </button>
        </div>
      </div>

      <div className="docs-filtros">
        <input
          type="text"
          placeholder="Buscar en todos los documentos..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <select value={centroFiltro} onChange={(e) => setCentroFiltro(e.target.value)}>
          <option value="">Todos los centros</option>
          {centros.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="docs-tabs" style={buscando ? { opacity: 0.45 } : undefined}>
        {categorias.map((c) => (
          <button
            key={c.id}
            className={`docs-tab ${!buscando && c.id === catActiva ? "activa" : ""}`}
            onClick={() => {
              setBusqueda("");
              setCatActiva(c.id);
              setSubActiva("all");
            }}
          >
            {c.nombre}
          </button>
        ))}
      </div>

      {!buscando && subsDeCat.length > 0 && (
        <div className="docs-pildoras">
          <button
            className={`docs-pildora ${subActiva === "all" ? "activa" : ""}`}
            onClick={() => setSubActiva("all")}
          >
            Todas
          </button>
          {subsDeCat.map((s) => (
            <button
              key={s.id}
              className={`docs-pildora ${subActiva === s.id ? "activa" : ""}`}
              onClick={() => setSubActiva(s.id)}
            >
              {s.nombre}
            </button>
          ))}
        </div>
      )}

      {gestion && (
        <GestionCarpetas
          categorias={categorias}
          subcategorias={subcategorias}
          catActiva={catActiva}
          setCatActiva={setCatActiva}
          accion={accionCarpeta}
        />
      )}

      {aviso && <div className="docs-aviso">{aviso}</div>}

      <div className="docs-tabla-envoltorio">
        {lista.length === 0 ? (
          <div className="docs-vacio">
            {buscando
              ? "Ningún documento coincide con la búsqueda."
              : 'No hay documentos en esta carpeta todavía. Usa "＋ Subir documento" para añadir el primero.'}
          </div>
        ) : (
          <table className="docs-tabla">
            <thead>
              <tr>
                <th></th>
                <th>Documento</th>
                <th>Ubicación</th>
                <th>Centro</th>
                <th className="tr">Tamaño</th>
                <th className="tr">Fecha</th>
                <th className="tr">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontSize: 18 }}>{icono(d.archivo_tipo)}</td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{d.nombre}</div>
                    {d.descripcion && <div className="docs-suave">{d.descripcion}</div>}
                  </td>
                  <td className="docs-suave">
                    {buscando
                      ? `${catPorId[d.categoria_id] ?? ""}${
                          d.subcategoria_id ? " · " + (subPorId[d.subcategoria_id] ?? "") : ""
                        }`
                      : d.subcategoria_id
                        ? (subPorId[d.subcategoria_id] ?? "—")
                        : "—"}
                  </td>
                  <td className="docs-suave">
                    {d.centro_id ? (nombreCentro[d.centro_id] ?? "—") : "General"}
                  </td>
                  <td className="tr docs-suave">{fmtTamano(d.archivo_tamano)}</td>
                  <td className="tr docs-suave">{fmtFecha(d.actualizado_en)}</td>
                  <td className="tr" style={{ whiteSpace: "nowrap" }}>
                    <button className="docs-boton-mini" onClick={() => abrir(d.id, false)}>
                      👁 Ver
                    </button>{" "}
                    <button className="docs-boton-mini" onClick={() => abrir(d.id, true)}>
                      ⬇
                    </button>{" "}
                    <button
                      className="docs-boton-mini docs-rojo"
                      title="Eliminar documento"
                      onClick={() => eliminar(d)}
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalSubida && (
        <ModalSubida
          categorias={categorias}
          subcategorias={subcategorias}
          centros={centros}
          catInicial={catActiva}
          subInicial={subActiva}
          cerrar={() => setModalSubida(false)}
          hecho={() => {
            setModalSubida(false);
            router.refresh();
          }}
        />
      )}
    </main>
  );
}

/* ================= Gestión de carpetas ================= */

function GestionCarpetas({
  categorias,
  subcategorias,
  catActiva,
  setCatActiva,
  accion,
}: {
  categorias: Categoria[];
  subcategorias: Subcategoria[];
  catActiva: string | null;
  setCatActiva: (id: string) => void;
  accion: (fn: () => Promise<{ ok: boolean; error?: string }>) => Promise<void>;
}) {
  const subs = subcategorias.filter((s) => s.categoria_id === catActiva);
  const nombreCat = categorias.find((c) => c.id === catActiva)?.nombre ?? "—";

  return (
    <div className="docs-gestion">
      <div>
        <div className="docs-gestion-titulo">
          Categorías{" "}
          <button
            className="docs-boton-mini"
            onClick={() => {
              const n = (prompt("Nombre de la nueva categoría:") || "").trim();
              if (n) accion(() => crearCategoria(n));
            }}
          >
            ＋
          </button>
        </div>
        {categorias.map((c) => (
          <div key={c.id} className="docs-gestion-fila">
            <span>
              {c.id === catActiva ? "▸ " : ""}
              {c.nombre}
            </span>
            <span>
              <button className="docs-boton-mini" onClick={() => accion(() => moverCategoria(c.id, -1))}>↑</button>
              <button className="docs-boton-mini" onClick={() => accion(() => moverCategoria(c.id, 1))}>↓</button>
              <button
                className="docs-boton-mini"
                onClick={() => {
                  const n = (prompt("Nuevo nombre:", c.nombre) || "").trim();
                  if (n && n !== c.nombre) accion(() => renombrarCategoria(c.id, n));
                }}
              >
                ✎
              </button>
              <button
                className="docs-boton-mini docs-rojo"
                onClick={() => {
                  if (confirm(`¿Eliminar la categoría "${c.nombre}"?`))
                    accion(() => borrarCategoria(c.id));
                }}
              >
                🗑
              </button>
              <button className="docs-boton-mini" onClick={() => setCatActiva(c.id)}>▸</button>
            </span>
          </div>
        ))}
      </div>
      <div>
        <div className="docs-gestion-titulo">
          Subcategorías de {nombreCat}{" "}
          <button
            className="docs-boton-mini"
            onClick={() => {
              if (!catActiva) return;
              const n = (prompt("Nombre de la nueva subcategoría:") || "").trim();
              if (n) accion(() => crearSubcategoria(catActiva, n));
            }}
          >
            ＋
          </button>
        </div>
        {subs.length === 0 && (
          <div className="docs-suave" style={{ padding: "4px 0" }}>
            Esta categoría no tiene subcategorías.
          </div>
        )}
        {subs.map((s) => (
          <div key={s.id} className="docs-gestion-fila">
            <span>{s.nombre}</span>
            <span>
              <button className="docs-boton-mini" onClick={() => accion(() => moverSubcategoria(s.id, -1))}>↑</button>
              <button className="docs-boton-mini" onClick={() => accion(() => moverSubcategoria(s.id, 1))}>↓</button>
              <button
                className="docs-boton-mini"
                onClick={() => {
                  const n = (prompt("Nuevo nombre:", s.nombre) || "").trim();
                  if (n && n !== s.nombre) accion(() => renombrarSubcategoria(s.id, n));
                }}
              >
                ✎
              </button>
              <button
                className="docs-boton-mini docs-rojo"
                onClick={() => {
                  if (confirm(`¿Eliminar la subcategoría "${s.nombre}"?`))
                    accion(() => borrarSubcategoria(s.id));
                }}
              >
                🗑
              </button>
            </span>
          </div>
        ))}
        <div className="docs-suave" style={{ marginTop: 8, fontSize: 11 }}>
          Las carpetas con documentos no se pueden eliminar: mueve o elimina antes sus documentos.
        </div>
      </div>
    </div>
  );
}

/* ================= Modal de subida ================= */

function ModalSubida({
  categorias,
  subcategorias,
  centros,
  catInicial,
  subInicial,
  cerrar,
  hecho,
}: {
  categorias: Categoria[];
  subcategorias: Subcategoria[];
  centros: Centro[];
  catInicial: string | null;
  subInicial: string;
  cerrar: () => void;
  hecho: () => void;
}) {
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [categoriaId, setCategoriaId] = useState(catInicial ?? categorias[0]?.id ?? "");
  const [subcategoriaId, setSubcategoriaId] = useState(
    subInicial !== "all" ? subInicial : ""
  );
  const [centroId, setCentroId] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const inputFichero = useRef<HTMLInputElement>(null);

  const subs = subcategorias.filter((s) => s.categoria_id === categoriaId);

  async function subir() {
    setMensaje("");
    const fichero = inputFichero.current?.files?.[0];
    if (!nombre.trim()) return setMensaje("Introduce un nombre para el documento.");
    if (!categoriaId) return setMensaje("Selecciona una categoría.");
    if (!fichero) return setMensaje("Selecciona un archivo.");

    setSubiendo(true);
    try {
      const prep = await prepararSubida({
        categoriaId,
        nombreFichero: fichero.name,
        tamano: fichero.size,
      });
      if (!prep.ok || !prep.data) throw new Error(prep.error);

      const up = await fetch(prep.data.urlSubida, {
        method: "PUT",
        headers: { "Content-Type": fichero.type || "application/octet-stream" },
        body: fichero,
      });
      if (!up.ok) throw new Error("La subida al almacenamiento ha fallado.");

      const ext = fichero.name.includes(".")
        ? fichero.name.split(".").pop()!.toLowerCase()
        : null;
      const reg = await registrarDocumento({
        nombre,
        descripcion: descripcion || null,
        categoriaId,
        subcategoriaId: subcategoriaId || null,
        centroId: centroId || null,
        path: prep.data.path,
        nombreFichero: fichero.name,
        tamano: fichero.size,
        tipo: ext,
      });
      if (!reg.ok) throw new Error(reg.error);
      hecho();
    } catch (e) {
      setMensaje(e instanceof Error && e.message ? e.message : "Error al subir.");
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className="docs-modal-fondo" onClick={cerrar}>
      <div className="docs-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Subir documento</h2>
        <label>Nombre *</label>
        <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <label>Descripción</label>
        <input
          type="text"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
        <div className="docs-modal-fila">
          <div>
            <label>Categoría *</label>
            <select
              value={categoriaId}
              onChange={(e) => {
                setCategoriaId(e.target.value);
                setSubcategoriaId("");
              }}
            >
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Subcategoría</label>
            <select
              value={subcategoriaId}
              onChange={(e) => setSubcategoriaId(e.target.value)}
            >
              <option value="">— Sin subcategoría —</option>
              {subs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label>Centro</label>
        <select value={centroId} onChange={(e) => setCentroId(e.target.value)}>
          <option value="">— General —</option>
          {centros.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <label>Archivo * (máx. 25 MB)</label>
        <input type="file" ref={inputFichero} />
        {mensaje && <div className="docs-aviso">{mensaje}</div>}
        <div className="docs-modal-acciones">
          <button className="boton-secundario" onClick={cerrar} disabled={subiendo}>
            Cancelar
          </button>
          <button className="boton-secundario docs-primario" onClick={subir} disabled={subiendo}>
            {subiendo ? "Subiendo..." : "Subir"}
          </button>
        </div>
      </div>
    </div>
  );
}
