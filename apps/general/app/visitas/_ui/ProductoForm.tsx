"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Modal from "./Modal";
import { IDIOMAS } from "../comun";
import { guardarProducto } from "../acciones";

export type ProductoVista = {
  id: string;
  tipo: string;
  nombre_es: string;
  nombre_en: string | null;
  nombre_fr: string | null;
  descripcion_es: string | null;
  idioma: string | null;
  duracion_min: number | null;
  aforo_default: number | null;
  tipo_bono: string | null;
  caducidad_meses: number | null;
  precio: number;
  activo: boolean;
};

export default function ProductoForm({ producto }: { producto?: ProductoVista }) {
  const e = producto;
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState(e?.tipo ?? "visita_experiencia");
  const [nombreEs, setNombreEs] = useState(e?.nombre_es ?? "");
  const [nombreEn, setNombreEn] = useState(e?.nombre_en ?? "");
  const [nombreFr, setNombreFr] = useState(e?.nombre_fr ?? "");
  const [descEs, setDescEs] = useState(e?.descripcion_es ?? "");
  const [idioma, setIdioma] = useState(e?.idioma ?? "es");
  const [duracion, setDuracion] = useState(e?.duracion_min ? String(e.duracion_min) : "");
  const [aforo, setAforo] = useState(e?.aforo_default ? String(e.aforo_default) : "");
  const [tipoBono, setTipoBono] = useState(e?.tipo_bono ?? "visita");
  const [caducidad, setCaducidad] = useState(String(e?.caducidad_meses ?? 12));
  const [precio, setPrecio] = useState(e?.precio != null ? String(e.precio) : "");
  const [activo, setActivo] = useState(e?.activo !== false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const esBono = tipo === "bono";

  function guardar() {
    startTransition(async () => {
      const r = await guardarProducto(producto?.id ?? null, {
        tipo: tipo as ProductoVista["tipo"] & ("visita_experiencia" | "bono"),
        nombre_es: nombreEs.trim(),
        nombre_en: nombreEn.trim() || null,
        nombre_fr: nombreFr.trim() || null,
        descripcion_es: descEs.trim() || null,
        precio: parseFloat(precio) || 0,
        activo,
        idioma: esBono ? null : ((idioma || null) as "es" | "en" | "fr" | null),
        duracion_min: esBono ? null : parseInt(duracion) || null,
        aforo_default: esBono ? null : parseInt(aforo) || null,
        tipo_bono: esBono ? (tipoBono as "visita" | "maridaje" | "importe") : null,
        caducidad_meses: esBono ? parseInt(caducidad) || 12 : null,
      });
      if (!r.ok) {
        alert(r.error || "No se pudo guardar.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {producto ? (
        <button className="btn sm" onClick={() => setOpen(true)}>Editar</button>
      ) : (
        <button className="btn primary" onClick={() => setOpen(true)}>+ Nuevo producto</button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={producto ? "Editar producto" : "Nuevo producto"}
        footer={
          <>
            <button className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="btn primary" disabled={pending} onClick={guardar}>Guardar</button>
          </>
        }
      >
        <div className="field">
          <label>Tipo</label>
          <select value={tipo} onChange={(e2) => setTipo(e2.target.value)}>
            <option value="visita_experiencia">Visita / experiencia</option>
            <option value="bono">Bono regalo</option>
          </select>
        </div>
        <div className="row2">
          <div className="field"><label>Nombre (ES)</label><input value={nombreEs} onChange={(e2) => setNombreEs(e2.target.value)} /></div>
          <div className="field"><label>Nombre (EN)</label><input value={nombreEn} onChange={(e2) => setNombreEn(e2.target.value)} /></div>
        </div>
        <div className="field"><label>Nombre (FR)</label><input value={nombreFr} onChange={(e2) => setNombreFr(e2.target.value)} /></div>
        <div className="field"><label>Descripción (ES)</label><textarea rows={2} value={descEs} onChange={(e2) => setDescEs(e2.target.value)} /></div>

        {!esBono ? (
          <>
            <div className="row2">
              <div className="field">
                <label>Idioma de la visita</label>
                <select value={idioma ?? ""} onChange={(e2) => setIdioma(e2.target.value)}>
                  <option value="">—</option>
                  {Object.entries(IDIOMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div className="field"><label>Duración (min)</label><input type="number" value={duracion} onChange={(e2) => setDuracion(e2.target.value)} /></div>
            </div>
            <div className="field"><label>Aforo por defecto</label><input type="number" value={aforo} onChange={(e2) => setAforo(e2.target.value)} /></div>
          </>
        ) : (
          <div className="row2">
            <div className="field">
              <label>Tipo de bono</label>
              <select value={tipoBono} onChange={(e2) => setTipoBono(e2.target.value)}>
                <option value="visita">Visita</option>
                <option value="maridaje">Menú maridaje</option>
                <option value="importe">Importe fijo</option>
              </select>
            </div>
            <div className="field"><label>Caducidad (meses)</label><input type="number" value={caducidad} onChange={(e2) => setCaducidad(e2.target.value)} /></div>
          </div>
        )}

        <div className="row2">
          <div className="field"><label>Precio (€)</label><input type="number" step="0.01" value={precio} onChange={(e2) => setPrecio(e2.target.value)} /></div>
          <div className="field">
            <label>Estado</label>
            <select value={activo ? "true" : "false"} onChange={(e2) => setActivo(e2.target.value === "true")}>
              <option value="true">Activo</option>
              <option value="false">Inactivo</option>
            </select>
          </div>
        </div>
      </Modal>
    </>
  );
}
