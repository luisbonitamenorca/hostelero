"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Modal from "./Modal";
import { addDaysISO, DIAS, todayISO } from "../comun";
import { generarSesiones } from "../acciones";

type Prod = { id: string; nombre_es: string; idioma: string | null; aforo_default: number | null };
type Centro = { id: string; nombre: string };

export default function GenerarSesiones({
  productos,
  centros,
  centroDefecto,
}: {
  productos: Prod[];
  centros: Centro[];
  centroDefecto: string;
}) {
  const [open, setOpen] = useState(false);
  const [prodId, setProdId] = useState(productos[0]?.id ?? "");
  const [desde, setDesde] = useState(todayISO());
  const [hasta, setHasta] = useState(addDaysISO(todayISO(), 180));
  const [hora, setHora] = useState("11:30");
  const [aforo, setAforo] = useState("");
  const [centroId, setCentroId] = useState(centroDefecto);
  const [dias, setDias] = useState<number[]>(DIAS.map(([, n]) => n));
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggleDia(n: number) {
    setDias((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n]));
  }

  function abrir() {
    if (!productos.length) {
      alert("Crea primero un producto de tipo visita");
      return;
    }
    setOpen(true);
  }

  function generar() {
    if (!dias.length) { alert("Selecciona al menos un día"); return; }
    startTransition(async () => {
      const r = await generarSesiones({
        productoId: prodId,
        desde,
        hasta,
        hora,
        dias: [...dias].sort(),
        aforo: aforo ? parseInt(aforo) : null,
        centroId: centroId || null,
      });
      if (!r.ok) { alert(r.error || "No se pudieron generar las sesiones."); return; }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button className="btn primary" onClick={abrir}>+ Generar sesiones</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Generar sesiones"
        footer={
          <>
            <button className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="btn primary" disabled={pending} onClick={generar}>Generar</button>
          </>
        }
      >
        <div className="hint">Define la visita una vez y crea todas las sesiones de la temporada de golpe. Luego puedes ajustar o cancelar las que quieras.</div>
        <div className="field">
          <label>Producto</label>
          <select value={prodId} onChange={(e) => setProdId(e.target.value)}>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre_es}{p.idioma ? ` (${p.idioma.toUpperCase()})` : ""}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Centro</label>
          <select value={centroId} onChange={(e) => setCentroId(e.target.value)}>
            {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div className="row2">
          <div className="field"><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div className="field"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        </div>
        <div className="row2">
          <div className="field"><label>Hora</label><input type="time" value={hora} onChange={(e) => setHora(e.target.value)} /></div>
          <div className="field"><label>Aforo (vacío = el del producto)</label><input type="number" value={aforo} onChange={(e) => setAforo(e.target.value)} placeholder="por defecto" /></div>
        </div>
        <div className="field">
          <label>Días de la semana</label>
          <div className="days">
            {DIAS.map(([l, n]) => (
              <label key={n} className={dias.includes(n) ? "on" : ""}>
                <input type="checkbox" checked={dias.includes(n)} onChange={() => toggleDia(n)} />
                {l}
              </label>
            ))}
          </div>
        </div>
      </Modal>
    </>
  );
}
