"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Modal from "./Modal";
import {
  addDaysISO,
  chipEstado,
  DOW_FULL,
  euro,
  fDate,
  PAGO_LABEL,
  type QuienViene,
  type SesionVista,
} from "../comun";
import {
  ajustarAforo,
  cancelarSesion,
  crearReservaPresencial,
  duplicarSesion,
  eliminarSesion,
  guardarNota,
  reservasDeSesion,
  toggleVisibleWeb,
} from "../acciones";

type Modo = null | "gestion" | "reserva" | "aforo" | "nota" | "duplicar";

export default function Sesion({ s, variant }: { s: SesionVista; variant: "fila" | "chip" }) {
  const [modo, setModo] = useState<Modo>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // gestión
  const [quien, setQuien] = useState<QuienViene[] | null>(null);
  // reserva
  const [rNombre, setRNombre] = useState("");
  const [rPers, setRPers] = useState(1);
  const [rPais, setRPais] = useState("");
  const [rEmail, setREmail] = useState("");
  const [rTel, setRTel] = useState("");
  // aforo / nota / duplicar
  const [aforo, setAforo] = useState(s.aforo);
  const [nota, setNota] = useState(s.nota ?? "");
  const [dupFechas, setDupFechas] = useState(addDaysISO(s.fecha, 7));
  const [dupHora, setDupHora] = useState(s.hora);
  const [dupAforo, setDupAforo] = useState(s.aforo);

  useEffect(() => {
    if (modo === "gestion" && quien === null) reservasDeSesion(s.id).then(setQuien);
  }, [modo, quien, s.id]);

  function correr(fn: () => Promise<{ ok: boolean; error?: string }>, cerrar = true) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        alert(res.error || "No se pudo completar la acción.");
        return;
      }
      if (cerrar) setModo(null);
      setQuien(null);
      router.refresh();
    });
  }

  const dow = new Date(s.fecha + "T00:00:00").getDay();
  const cancelada = s.estado === "cancelada";

  const trigger =
    variant === "fila" ? (
      <>
        <button className="btn sm" onClick={() => setModo("gestion")}>Gestionar</button>
        {cancelada ? null : (
          <button className="btn sm primary" onClick={() => setModo("reserva")} style={{ marginLeft: 6 }}>
            + Reserva
          </button>
        )}
      </>
    ) : (
      <button className={`ses-chip ${chipEstado(s)}${s.maridaje ? " maridaje" : ""}`} onClick={() => setModo("gestion")}>
        {s.maridaje ? <span className="dot mar" /> : null}
        {s.nota ? <span className="dot note" /> : null}
        <b>{s.hora}</b> {s.idiomaLabel || s.nombre} · {s.oc}/{s.aforo}
      </button>
    );

  return (
    <>
      {trigger}

      {/* -------- Gestión -------- */}
      <Modal
        open={modo === "gestion"}
        onClose={() => setModo(null)}
        title={`${s.nombre}${s.idiomaLabel ? ` · ${s.idiomaLabel}` : ""}`}
        footer={<button className="btn ghost" onClick={() => setModo(null)}>Cerrar</button>}
      >
        <p style={{ marginTop: 0 }}>
          {DOW_FULL[dow === 0 ? 7 : dow]} {fDate(s.fecha)} · {s.hora}
          {s.maridaje ? " · Maridaje" : ""}
        </p>
        <p className="muted">
          Ocupación: <strong>{s.oc}/{s.aforo}</strong> · {s.libre} plazas libres ·{" "}
          {cancelada ? "Cancelada" : "Activa"} · {s.visible_web ? "Visible en web" : "Oculta en web"}
        </p>
        <div style={{ marginTop: 12, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 9, background: "#fcfaf6" }}>
          <strong style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)" }}>Comentario</strong>
          <div style={{ marginTop: 6 }}>{s.nota ? s.nota : <span className="muted">Sin comentarios.</span>}</div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)", marginBottom: 8 }}>
            Quién viene{quien ? ` (${quien.reduce((a, r) => a + r.personas, 0)} personas en ${quien.length} ${quien.length === 1 ? "reserva" : "reservas"})` : ""}
          </div>
          {quien === null ? (
            <p className="muted">Cargando…</p>
          ) : quien.length ? (
            quien.map((r) => (
              <div key={r.codigo} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--line)" }}>
                <span>{r.nombre} <span className="muted" style={{ fontSize: 12 }}>· {PAGO_LABEL[r.metodo] || r.metodo}</span></span>
                <strong>{r.personas} pers.</strong>
              </div>
            ))
          ) : (
            <p className="muted">Aún no hay reservas en esta sesión.</p>
          )}
        </div>

        {cancelada ? null : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
            <button className="btn primary" onClick={() => setModo("reserva")}>+ Añadir reserva</button>
            <button className="btn" onClick={() => { setAforo(s.aforo); setModo("aforo"); }}>Ajustar aforo</button>
            <button className="btn" onClick={() => { setNota(s.nota ?? ""); setModo("nota"); }}>Comentario</button>
            <button className="btn" onClick={() => setModo("duplicar")}>Duplicar</button>
            <button className="btn" disabled={pending} onClick={() => correr(() => toggleVisibleWeb(s.id, s.visible_web), false)}>
              {s.visible_web ? "Ocultar en web" : "Mostrar en web"}
            </button>
            <button className="btn danger" disabled={pending} onClick={() => { if (confirm("¿Cancelar esta sesión? Deja de venderse; las reservas no se borran.")) correr(() => cancelarSesion(s.id)); }}>Cancelar</button>
            <button className="btn danger" disabled={pending} onClick={() => { if (confirm("¿Eliminar definitivamente esta sesión?")) correr(() => eliminarSesion(s.id)); }}>Eliminar</button>
          </div>
        )}
      </Modal>

      {/* -------- Añadir reserva presencial -------- */}
      <Modal
        open={modo === "reserva"}
        onClose={() => setModo(null)}
        title="Añadir reserva"
        footer={
          <>
            <button className="btn ghost" onClick={() => setModo(null)}>Cancelar</button>
            <button className="btn primary" disabled={pending} onClick={() => correr(() => crearReservaPresencial({ sesionId: s.id, nombre: rNombre, personas: rPers, importe: rPers * s.precio, email: rEmail, telefono: rTel, pais: rPais }))}>
              Añadir reserva
            </button>
          </>
        }
      >
        <div className="hint">Reserva presencial: se cobra en el TPV de Ágora. Aquí solo ocupa plaza y cuenta en los informes. No genera ticket.</div>
        <p className="muted" style={{ marginTop: 0 }}>{s.nombre} · {fDate(s.fecha)} {s.hora} · {s.libre} plazas libres</p>
        <div className="row2">
          <div className="field"><label>Nombre del cliente</label><input value={rNombre} onChange={(e) => setRNombre(e.target.value)} placeholder="Opcional" /></div>
          <div className="field"><label>Nº de personas</label><input type="number" min={1} max={s.libre} value={rPers} onChange={(e) => setRPers(Math.max(1, parseInt(e.target.value) || 1))} /></div>
        </div>
        <div className="row2">
          <div className="field"><label>País (opcional)</label><input value={rPais} onChange={(e) => setRPais(e.target.value)} /></div>
          <div className="field"><label>Email (opcional)</label><input type="email" value={rEmail} onChange={(e) => setREmail(e.target.value)} /></div>
        </div>
        <div className="field"><label>Teléfono (opcional)</label><input value={rTel} onChange={(e) => setRTel(e.target.value)} /></div>
        <p className="muted">Importe estimado: <strong>{euro(rPers * s.precio)}</strong> <span style={{ fontSize: 12 }}>({euro(s.precio)}/persona)</span></p>
      </Modal>

      {/* -------- Ajustar aforo -------- */}
      <Modal
        open={modo === "aforo"}
        onClose={() => setModo(null)}
        title="Ajustar aforo"
        footer={
          <>
            <button className="btn ghost" onClick={() => setModo(null)}>Cancelar</button>
            <button className="btn primary" disabled={pending} onClick={() => { if (aforo < s.oc) { alert("El aforo no puede ser menor que la ocupación"); return; } correr(() => ajustarAforo(s.id, aforo)); }}>Guardar</button>
          </>
        }
      >
        <p className="muted">Ocupación actual: {s.oc} plazas. El nuevo aforo no puede ser menor.</p>
        <div className="field"><label>Aforo de esta sesión</label><input type="number" min={s.oc} value={aforo} onChange={(e) => setAforo(parseInt(e.target.value) || 0)} /></div>
      </Modal>

      {/* -------- Comentario -------- */}
      <Modal
        open={modo === "nota"}
        onClose={() => setModo(null)}
        title="Comentario de la sesión"
        footer={
          <>
            <button className="btn ghost" onClick={() => setModo(null)}>Cancelar</button>
            <button className="btn primary" disabled={pending} onClick={() => correr(() => guardarNota(s.id, nota))}>Guardar</button>
          </>
        }
      >
        <p className="muted" style={{ marginTop: 0 }}>{s.nombre} · {fDate(s.fecha)} {s.hora}</p>
        <div className="field"><label>Comentario (interno, no se muestra en la web)</label><textarea rows={4} value={nota} onChange={(e) => setNota(e.target.value)} /></div>
      </Modal>

      {/* -------- Duplicar -------- */}
      <Modal
        open={modo === "duplicar"}
        onClose={() => setModo(null)}
        title="Duplicar sesión"
        footer={
          <>
            <button className="btn ghost" onClick={() => setModo(null)}>Cancelar</button>
            <button
              className="btn primary"
              disabled={pending}
              onClick={() => {
                const fechas = [...new Set(dupFechas.split(/[\n,]+/).map((x) => x.trim()).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)))];
                if (!fechas.length) { alert("Pon al menos una fecha válida (AAAA-MM-DD)"); return; }
                correr(() => duplicarSesion({ productoId: s.producto_id, fechas, hora: dupHora, aforo: dupAforo, centroId: null }));
              }}
            >
              Crear sesiones
            </button>
          </>
        }
      >
        <div className="hint">Crea una copia de «{s.nombre}» ({s.hora}, aforo {s.aforo}) en las fechas que indiques.</div>
        <div className="field"><label>Fechas (una por línea o separadas por comas, AAAA-MM-DD)</label><textarea rows={3} value={dupFechas} onChange={(e) => setDupFechas(e.target.value)} /></div>
        <div className="row2">
          <div className="field"><label>Hora</label><input type="time" value={dupHora} onChange={(e) => setDupHora(e.target.value)} /></div>
          <div className="field"><label>Aforo</label><input type="number" value={dupAforo} onChange={(e) => setDupAforo(parseInt(e.target.value) || s.aforo)} /></div>
        </div>
      </Modal>
    </>
  );
}
