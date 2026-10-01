"use client";

import { useRef, useState } from "react";
import * as api from "../acciones";
import { EST, ORIGEN, fmtFC, h5, mesasDe, solapan, turnoDe, type Cliente, type Mesa, type Reserva, type Restaurante, type Sala, type Turno } from "../tipos";
import { VIVAS } from "../lib-reservas";
import "./modal-reserva.css";

/* Marco común de todos los modales del panel (cierra al tocar fuera). */
export function Marco({ cerrar, children }: { cerrar: () => void; children: React.ReactNode }) {
  return (
    <div className="rsp-modal" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <div className="modal">
        <button className="cerrar" onClick={cerrar}>✕</button>
        {children}
      </div>
    </div>
  );
}

export type Prellenar = { cliente?: Cliente | null; pax?: number; notaInterna?: string };

export function ModalReserva(props: {
  rest: Restaurante;
  fecha: string;
  salas: Sala[];
  turnos: Turno[];
  reservas: Reserva[];
  reserva: Reserva | null;
  prellenar?: Prellenar;
  cerrar: () => void;
  guardado: (fecha: string) => void;
}) {
  const { rest, salas, turnos, reservas, reserva: r, prellenar, cerrar, guardado } = props;
  const [cliSel, setCliSel] = useState<Cliente | null>(r?.reservas_clientes ?? prellenar?.cliente ?? null);
  const [busqueda, setBusqueda] = useState(
    cliSel ? cliSel.nombre + (cliSel.telefono ? " · " + cliSel.telefono : "") : "",
  );
  const [sugerencias, setSugerencias] = useState<Cliente[] | null>(null);
  const [nuevoVisible, setNuevoVisible] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoTel, setNuevoTel] = useState("");
  const [f, setF] = useState(r?.fecha ?? props.fecha);
  const [hora, setHora] = useState(r ? h5(r.hora) : "13:30");
  const [pax, setPax] = useState(String(r?.pax ?? prellenar?.pax ?? 2));
  const [dur, setDur] = useState(String(r?.duracion_min ?? 120));
  const [mesaSels, setMesaSels] = useState<string[]>(r ? (mesasDe(r).length ? mesasDe(r) : [""]) : [""]);
  const [origen, setOrigen] = useState(r?.origen ?? "telefono");
  const [estado, setEstado] = useState(r?.estado ?? "confirmada");
  const [nc, setNc] = useState(r?.notas_cliente ?? "");
  const [ni, setNi] = useState(r?.notas_internas ?? prellenar?.notaInterna ?? "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function buscar(q: string) {
    setBusqueda(q);
    setCliSel(null);
    setNuevoVisible(false);
    if (tRef.current) clearTimeout(tRef.current);
    if (!q || q.length < 2) { setSugerencias(null); return; }
    tRef.current = setTimeout(async () => {
      setSugerencias(await api.sugerirClientes(q));
    }, 300);
  }

  async function guardar() {
    setError("");
    const paxN = parseInt(pax);
    const durN = parseInt(dur) || 120;
    if (!f || !hora || !paxN) { setError("Faltan día, hora o comensales."); return; }
    setGuardando(true);
    let clienteId = cliSel?.id ?? null;
    if (!clienteId && nuevoVisible) {
      const nom = nuevoNombre.trim();
      if (!nom) { setError("El cliente nuevo necesita un nombre."); setGuardando(false); return; }
      const res = await api.crearClienteRapido(nom, nuevoTel.trim() || null);
      if (!res.ok || !res.data) { setError("No se ha podido crear el cliente (¿teléfono repetido?)."); setGuardando(false); return; }
      clienteId = res.data.id;
    }
    if (!clienteId && !r) { setError("Elige un cliente o crea uno nuevo."); setGuardando(false); return; }

    const mesaIds = [...new Set(mesaSels.filter(Boolean))];
    if (mesaIds.length) {
      const conflicto = reservas.find(
        (o) =>
          o.id !== r?.id &&
          o.fecha === f &&
          VIVAS.includes(o.estado) &&
          mesasDe(o).some((id) => mesaIds.includes(id)) &&
          solapan(o.hora, o.duracion_min || 120, hora + ":00", durN),
      );
      if (conflicto && !confirm("Alguna de esas mesas tiene otra reserva que se solapa. ¿Guardar igualmente?")) {
        setGuardando(false);
        return;
      }
    }

    const t = turnoDe(turnos, f, hora + ":00");
    const fila = {
      restaurante_id: rest.id,
      fecha: f,
      hora: hora + ":00",
      pax: paxN,
      duracion_min: durN,
      mesa_id: mesaIds[0] || null,
      turno_id: t?.id ?? null,
      origen,
      estado,
      notas_cliente: nc.trim() || null,
      notas_internas: ni.trim() || null,
      ...(clienteId ? { cliente_id: clienteId } : {}),
    };
    const res = await api.guardarReserva(r?.id ?? null, fila, mesaIds);
    setGuardando(false);
    if (!res.ok) { setError("No se ha podido guardar la reserva."); return; }
    guardado(f);
  }

  const opcionesMesa = (esExtra: boolean) => (
    <>
      <option value="">{esExtra ? "— quitar esta mesa —" : "Sin mesa (asignar luego)"}</option>
      {salas.map((s) => (
        <optgroup key={s.id} label={s.nombre}>
          {(s.mesas || []).filter((m) => m.activa).map((m) => (
            <option key={m.id} value={m.id}>{m.nombre} ({m.cap_min}-{m.cap_max})</option>
          ))}
        </optgroup>
      ))}
    </>
  );

  return (
    <Marco cerrar={cerrar}>
      <h2>{r ? "Editar reserva" : "Nueva reserva"}</h2>
      {r ? (
        <p style={{ fontSize: 12, color: "var(--gris)", margin: "2px 0 0" }}>
          Localizador <code>{r.localizador}</code> · origen {ORIGEN[r.origen] || r.origen}
        </p>
      ) : null}
      <label>Cliente</label>
      <input placeholder="Buscar por nombre o teléfono…" autoComplete="off" value={busqueda} onChange={(e) => buscar(e.target.value)} />
      {sugerencias !== null ? (
        <div className="sugerencias">
          {sugerencias.map((c) => (
            <div key={c.id} onClick={() => { setCliSel(c); setBusqueda(c.nombre + (c.telefono ? " · " + c.telefono : "")); setSugerencias(null); }}>
              {c.nombre}{c.telefono ? ` · ${c.telefono}` : ""}{c.vip ? " ⭐" : ""}
            </div>
          ))}
          <div
            onClick={() => {
              setSugerencias(null);
              setNuevoVisible(true);
              const esTel = /^[\d\s+]+$/.test(busqueda);
              setNuevoNombre(esTel ? "" : busqueda);
              setNuevoTel(esTel ? busqueda : "");
            }}
          >
            ➕ Crear cliente nuevo
          </div>
        </div>
      ) : null}
      {nuevoVisible ? (
        <div className="fila">
          <div><label>Nombre</label><input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} /></div>
          <div><label>Teléfono</label><input type="tel" value={nuevoTel} onChange={(e) => setNuevoTel(e.target.value)} /></div>
        </div>
      ) : null}
      <div className="fila">
        <div><label>Día</label><input type="date" value={f} onChange={(e) => setF(e.target.value)} /></div>
        <div><label>Hora</label><input type="time" step={900} value={hora} onChange={(e) => setHora(e.target.value)} /></div>
      </div>
      <div className="fila">
        <div><label>Comensales</label><input type="number" min={1} value={pax} onChange={(e) => setPax(e.target.value)} /></div>
        <div><label>Duración (min)</label><input type="number" min={30} step={15} value={dur} onChange={(e) => setDur(e.target.value)} /></div>
      </div>
      <label>Mesa(s)</label>
      {mesaSels.map((sel, i) => (
        <select
          key={i}
          style={{ marginTop: i ? 6 : 0 }}
          value={sel}
          onChange={(e) => setMesaSels(mesaSels.map((x, j) => (j === i ? e.target.value : x)))}
        >
          {opcionesMesa(i > 0)}
        </select>
      ))}
      <button type="button" className="btn mini sec" style={{ marginTop: 6 }} onClick={() => setMesaSels([...mesaSels, ""])}>
        + Combinar otra mesa
      </button>
      <div className="fila">
        <div>
          <label>Origen</label>
          <select value={origen} onChange={(e) => setOrigen(e.target.value)}>
            {Object.entries(ORIGEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label>Estado</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value)}>
            {Object.entries(EST).map(([k, v]) => <option key={k} value={k}>{v.txt}</option>)}
          </select>
        </div>
      </div>
      <label>Nota del cliente</label><textarea value={nc} onChange={(e) => setNc(e.target.value)} />
      <label>Nota interna</label><textarea value={ni} onChange={(e) => setNi(e.target.value)} />
      {error ? <div className="aviso err">{error}</div> : null}
      <button className="btn" disabled={guardando} onClick={guardar}>{r ? "Guardar cambios" : "Crear reserva"}</button>
    </Marco>
  );
}

export function ModalMesaSheet(props: {
  mesa: Mesa;
  rs: Reserva[];
  turnoPlano: Turno | null;
  fecha: string;
  sinMesa: Reserva[];
  cerrar: () => void;
  setEstado: (id: string, e: string) => void;
  editar: (r: Reserva) => void;
  walkin: () => void;
  asignar: (reservaId: string) => void;
}) {
  const { mesa: m, rs, turnoPlano, fecha, sinMesa, cerrar, setEstado, editar, walkin, asignar } = props;
  return (
    <Marco cerrar={cerrar}>
      <h2>Mesa {m.nombre} · {m.sala_nombre}</h2>
      <p style={{ fontSize: 13, color: "var(--gris)" }}>
        {m.cap_min}–{m.cap_max} pax{turnoPlano ? ` · ${turnoPlano.nombre} del ${fmtFC(fecha)}` : ""}{m.reservable_online ? "" : " · no reservable online"}
      </p>
      {rs.length ? (
        rs.map((r) => {
          const c = r.reservas_clientes;
          return (
            <div key={r.id} className="aviso info" style={{ marginTop: 10 }}>
              <b>{h5(r.hora)} · {c?.nombre || ""}</b> · {r.pax} pax · {EST[r.estado]?.txt}{c?.alergias ? ` · ⚠ ${c.alergias}` : ""}
              <div className="acciones" style={{ marginTop: 8 }}>
                {["pendiente", "confirmada"].includes(r.estado) ? (
                  <button className="primaria" onClick={() => setEstado(r.id, "sentada")}>Sentar</button>
                ) : null}
                {r.estado === "sentada" ? (
                  <button className="primaria" onClick={() => setEstado(r.id, "terminada")}>Terminar / liberar</button>
                ) : null}
                <button onClick={() => editar(r)}>Editar</button>
              </div>
            </div>
          );
        })
      ) : (
        <div className="aviso ok" style={{ marginTop: 10 }}>Mesa libre todo el turno.</div>
      )}
      <button className="btn sec" onClick={walkin}>Sentar walk-in ahora</button>
      {sinMesa.length ? (
        <>
          <label style={{ marginTop: 16 }}>Asignar a esta mesa una reserva sin mesa</label>
          <div className="lista-simple">
            {sinMesa.map((r) => (
              <div key={r.id} className="item">
                <div>
                  <div className="tit">{h5(r.hora)} · {r.reservas_clientes?.nombre || ""}</div>
                  <div className="det">{r.pax} pax · {EST[r.estado]?.txt}</div>
                </div>
                <button className="btn mini" onClick={() => asignar(r.id)}>Asignar</button>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Marco>
  );
}

export function ModalWalkin({ mesa, cerrar, crear }: { mesa: Mesa; cerrar: () => void; crear: (pax: number, nombre: string) => void }) {
  const [pax, setPax] = useState("2");
  const [nombre, setNombre] = useState("");
  return (
    <Marco cerrar={cerrar}>
      <h2>Walk-in · Mesa {mesa.nombre}</h2>
      <label>Comensales</label>
      <input type="number" min={1} inputMode="numeric" value={pax} onChange={(e) => setPax(e.target.value)} />
      <label>Nombre (opcional)</label>
      <input placeholder="Cliente sin reserva" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <button className="btn" onClick={() => crear(parseInt(pax) || 2, nombre.trim() || "Walk-in")}>Sentar ahora</button>
    </Marco>
  );
}
