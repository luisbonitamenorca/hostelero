"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Modal from "./Modal";
import { euro, fDate, todayISO, type ResultadoBono, type SesionDia } from "../comun";
import { canjearBono, sesionesActivasDia, validarBono, venderBono } from "../acciones";

type BonoProd = { id: string; nombre_es: string; precio: number; tipo_bono: string | null };

/* -------- Validar y canjear (validar NO gasta el bono) -------- */
export function ValidarCanje() {
  const [codigo, setCodigo] = useState("");
  const [res, setRes] = useState<ResultadoBono | null>(null);
  const [fecha, setFecha] = useState(todayISO());
  const [personas, setPersonas] = useState(1);
  const [nombre, setNombre] = useState("");
  const [sesiones, setSesiones] = useState<SesionDia[]>([]);
  const [sesionId, setSesionId] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const valido = res?.ok && res.valido;

  useEffect(() => {
    if (!valido) return;
    sesionesActivasDia(fecha).then((ss) => {
      setSesiones(ss);
      setSesionId(ss[0]?.id ?? "");
    });
  }, [valido, fecha]);

  function validar() {
    startTransition(async () => {
      const r = await validarBono(codigo);
      setRes(r);
      if (r.ok && r.valido && r.unidades) setPersonas(r.unidades);
    });
  }

  function canjear() {
    if (!sesionId) {
      alert("Selecciona una sesión válida");
      return;
    }
    startTransition(async () => {
      const r = await canjearBono({ codigo: codigo.trim().toUpperCase(), sesionId, personas, nombre: nombre.trim() || null });
      if (!r.ok) {
        alert(r.error || "No se pudo canjear.");
        return;
      }
      setRes(null);
      setCodigo("");
      setNombre("");
      router.refresh();
    });
  }

  return (
    <div className="card">
      <div className="card-h"><h3>Validar y canjear</h3></div>
      <div className="card-body">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Código del bono</label>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej. AB12CD34EF"
              style={{ textTransform: "uppercase" }}
            />
          </div>
          <button className="btn" disabled={pending} onClick={validar}>Validar</button>
        </div>

        <div style={{ marginTop: 16 }}>
          {res && !res.ok ? <div className="hint err">Error: {res.error}</div> : null}
          {res?.ok && !res.valido ? <div className="hint err">❌ {res.motivo}</div> : null}
          {valido ? (
            <>
              <div className="hint ok">
                ✅ Bono válido · {res?.concepto || ""}
                {res?.unidades && res.unidades > 1 ? ` (${res.unidades} uds.)` : ""} · caduca{" "}
                {res?.caduca_at ? fDate(res.caduca_at.slice(0, 10)) : "—"}
              </div>
              <div className="row2">
                <div className="field">
                  <label>Fecha de la visita</label>
                  <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
                </div>
                <div className="field">
                  <label>Nº de personas</label>
                  <input type="number" min={1} value={personas} onChange={(e) => setPersonas(parseInt(e.target.value) || 1)} />
                </div>
              </div>
              <div className="field">
                <label>Sesión</label>
                <select value={sesionId} onChange={(e) => setSesionId(e.target.value)}>
                  {sesiones.length ? (
                    sesiones.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.hora} · {s.nombre}{s.idioma ? ` (${s.idioma.toUpperCase()})` : ""}
                      </option>
                    ))
                  ) : (
                    <option value="">— No hay sesiones activas ese día —</option>
                  )}
                </select>
              </div>
              <div className="field">
                <label>Nombre (opcional)</label>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Beneficiario del bono" />
              </div>
              <button className="btn primary" disabled={pending} onClick={canjear}>Canjear bono</button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* -------- Vender bono -------- */
export function VenderBono({ productos }: { productos: BonoProd[] }) {
  const [open, setOpen] = useState(false);
  const [prodId, setProdId] = useState(productos[0]?.id ?? "");
  const [uds, setUds] = useState(1);
  const [importe, setImporte] = useState<string>(productos[0] ? String(productos[0].precio) : "");
  const [comprador, setComprador] = useState("");
  const [email, setEmail] = useState("");
  const [benef, setBenef] = useState("");
  const [caduca, setCaduca] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const prod = productos.find((p) => p.id === prodId);

  function recalcular(nUds: number, id: string) {
    const p = productos.find((x) => x.id === id);
    if (p) setImporte((p.precio * nUds).toFixed(2));
  }

  function abrir() {
    if (!productos.length) {
      alert("Crea primero un producto de tipo bono");
      return;
    }
    setOpen(true);
  }

  function guardar() {
    startTransition(async () => {
      const r = await venderBono({
        producto_id: prodId,
        comprador_nombre: comprador,
        comprador_email: email,
        beneficiario_nombre: benef.trim() || null,
        unidades: uds,
        importe: parseFloat(importe) || 0,
        caduca_at: caduca ? `${caduca}T23:59:59` : null,
      });
      if (!r.ok) {
        alert(r.error || "No se pudo emitir el bono.");
        return;
      }
      setOpen(false);
      setComprador("");
      setEmail("");
      setBenef("");
      setCaduca("");
      router.refresh();
    });
  }

  return (
    <>
      <button className="btn primary" onClick={abrir}>+ Vender bono</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Vender bono"
        footer={
          <>
            <button className="btn ghost" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="btn primary" disabled={pending} onClick={guardar}>Emitir bono</button>
          </>
        }
      >
        <div className="hint">Registra un bono vendido en recepción. El online vendrá con la pasarela de pago.</div>
        <div className="field">
          <label>Producto (bono)</label>
          <select
            value={prodId}
            onChange={(e) => { setProdId(e.target.value); recalcular(uds, e.target.value); }}
          >
            {productos.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre_es} · {euro(p.precio)}</option>
            ))}
          </select>
        </div>
        <div className="row2">
          <div className="field">
            <label>Cantidad</label>
            <input
              type="number"
              min={1}
              value={uds}
              onChange={(e) => { const n = Math.max(1, parseInt(e.target.value) || 1); setUds(n); recalcular(n, prodId); }}
            />
          </div>
          <div className="field">
            <label>Importe total (€)</label>
            <input type="number" step="0.01" value={importe} onChange={(e) => setImporte(e.target.value)} />
          </div>
        </div>
        {uds > 1 && prod ? <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>{uds} × {euro(prod.precio)} = {euro(prod.precio * uds)}</p> : null}
        <div className="row2">
          <div className="field"><label>Comprador</label><input value={comprador} onChange={(e) => setComprador(e.target.value)} /></div>
          <div className="field"><label>Email comprador</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div className="field"><label>Beneficiario (para el regalo)</label><input value={benef} onChange={(e) => setBenef(e.target.value)} placeholder="Nombre de quien recibe el regalo" /></div>
        <div className="field"><label>Caducidad (opcional, vacío = automática)</label><input type="date" value={caduca} onChange={(e) => setCaduca(e.target.value)} /></div>
      </Modal>
    </>
  );
}
