"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../acciones";
import {
  EST,
  ORIGEN,
  dowDe,
  enTurno,
  fmtF,
  fmtFC,
  h5,
  hoyISO,
  mesasDe,
  solapan,
  telWA,
  turnoDe,
  type Espera,
  type Mesa,
  type Reserva,
  type Restaurante,
  type Sala,
  type Turno,
} from "../tipos";
import { VIVAS, useRecargaExterna, type SecProps } from "../lib-reservas";
import { Plano, type Posiciones } from "../componentes/plano";
import { ModalMesaSheet, ModalReserva, ModalWalkin } from "../componentes/modal-reserva";
import { ModalMesaForm } from "./ajustes";
import "./dia.css";

type Modal =
  | { tipo: "reserva"; reserva: Reserva | null }
  | { tipo: "mesaSheet"; mesaId: string }
  | { tipo: "walkin"; mesaId: string }
  | { tipo: "mesaForm"; mesaId: string | null }
  | null;

/* Vista Día: turnos del día, estadísticas, libro (lista) y plano de sala. */
export default function SecDia({ ctx, rest, fecha, setFecha, avisar }: SecProps) {
  const restId = rest.id;
  const [salas, setSalas] = useState<Sala[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [espera, setEspera] = useState<Espera[]>([]);
  const [cierres, setCierres] = useState<{ id: string; motivo: string | null }[]>([]);
  const [proximas, setProximas] = useState<{ fecha: string; restaurante_id: string }[]>([]);
  const [turnoSel, setTurnoSel] = useState<string>("");
  const [salaSel, setSalaSel] = useState<string>("");
  const [edicion, setEdicion] = useState(false);
  const [posCambiadas, setPosCambiadas] = useState<Posiciones>({});
  const [modal, setModal] = useState<Modal>(null);
  const [cargado, setCargado] = useState(false);
  const edicionRef = useRef(edicion);
  edicionRef.current = edicion;

  const mesas: Mesa[] = useMemo(
    () => salas.flatMap((s) => (s.mesas || []).map((m) => ({ ...m, sala_nombre: s.nombre }))),
    [salas],
  );

  const recargarLocal = useCallback(async (id: string) => {
    const { salas: s, turnos: t } = await api.cargarLocal(id);
    setSalas(s as unknown as Sala[]);
    setTurnos(t as Turno[]);
  }, []);

  const recargarDia = useCallback(async (id: string, f: string) => {
    const d = await api.cargarDia(id, f, hoyISO());
    setReservas(d.reservas);
    setEspera(d.espera);
    setCierres(d.cierres as { id: string; motivo: string | null }[]);
    setProximas(d.proximas);
    setCargado(true);
  }, []);

  useEffect(() => {
    setCargado(false);
    setTurnoSel("");
    setSalaSel("");
    recargarLocal(restId).then(() => recargarDia(restId, fecha));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restId]);

  useEffect(() => {
    recargarDia(restId, fecha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha]);

  // Sondeo de 60 s (igual que el legado; sin realtime)
  useEffect(() => {
    const int = setInterval(() => {
      if (!document.hidden && !edicionRef.current) recargarDia(restId, fecha);
    }, 60000);
    return () => clearInterval(int);
  }, [recargarDia, restId, fecha]);

  // «Nueva reserva» desde la barra superior u otra sección
  useRecargaExterna(useCallback(() => { recargarDia(restId, fecha); }, [recargarDia, restId, fecha]));

  // ---- turnos del día y selección ----
  const dow = dowDe(fecha);
  const turnosDia = turnos.filter((t) => t.activo && (t.dias_semana || []).includes(dow));
  const turnoActivo: string = useMemo(() => {
    if (turnoSel === "dia") return "dia";
    if (turnoSel && turnosDia.some((t) => t.id === turnoSel)) return turnoSel;
    let elegido = turnosDia[0]?.id ?? "dia";
    if (fecha === hoyISO()) {
      const d = new Date();
      const ahora = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const enCurso = turnosDia.find((t) => ahora <= h5(t.hora_fin));
      if (enCurso) elegido = enCurso.id;
    }
    return elegido;
  }, [turnoSel, turnosDia, fecha]);
  const turnoPlano = turnoActivo === "dia" ? null : turnos.find((t) => t.id === turnoActivo) ?? null;

  const visibles = turnoPlano ? reservas.filter((r) => enTurno(r, turnoPlano)) : reservas;

  // ---- sala seleccionada del plano ----
  const salasActivas = salas.filter((s) => s.activa);
  const salaPlano: string = useMemo(() => {
    if (salaSel && salasActivas.some((s) => s.id === salaSel)) return salaSel;
    const conPax = salasActivas.find((s) => {
      const ids = (s.mesas || []).filter((m) => m.activa).map((m) => m.id);
      return reservas.some(
        (r) => ids.includes(r.mesa_id ?? "") && VIVAS.includes(r.estado) && (!turnoPlano || enTurno(r, turnoPlano)),
      );
    });
    return (conPax ?? salasActivas[0])?.id ?? "";
  }, [salaSel, salasActivas, reservas, turnoPlano]);

  function resMesaTurno(mesaId: string) {
    return reservas
      .filter(
        (r) =>
          mesasDe(r).includes(mesaId) &&
          VIVAS.includes(r.estado) &&
          (!turnoPlano || enTurno(r, turnoPlano)),
      )
      .sort((a, b) => (a.hora < b.hora ? -1 : 1));
  }

  async function correr(p: Promise<{ ok: boolean; error?: string }>, recargaLocal = false) {
    const r = await p;
    if (!r.ok) {
      avisar(r.error || "No se ha podido guardar. Revisa la conexión.");
      return false;
    }
    if (recargaLocal) await recargarLocal(restId);
    await recargarDia(restId, fecha);
    return true;
  }

  const setEstado = (id: string, estado: string) => correr(api.setEstadoReserva(id, estado));

  if (!cargado) return <div className="spinner" />;

  return (
    <>
      <div className="turnos-bar">
        {turnosDia.map((t) => {
          const pax = reservas
            .filter((r) => enTurno(r, t) && !["cancelada", "no_show"].includes(r.estado))
            .reduce((a, r) => a + r.pax, 0);
          return (
            <button key={t.id} className={turnoActivo === t.id ? "activo" : ""} onClick={() => setTurnoSel(t.id)}>
              {t.nombre} · {pax} pax
            </button>
          );
        })}
        <button className={turnoActivo === "dia" ? "activo" : ""} onClick={() => setTurnoSel("dia")}>
          Día completo
        </button>
      </div>

      <Stats
        rest={rest}
        rests={ctx.restaurantes}
        fecha={fecha}
        visibles={visibles}
        reservas={reservas}
        espera={espera}
        cierres={cierres}
        proximas={proximas}
        turnoPlano={turnoPlano}
        irADia={setFecha}
      />

      <div className="sala-grid">
        <div id="col-plano">
          <div className="plano-controles">
            <select value={salaPlano} onChange={(e) => setSalaSel(e.target.value)}>
              {salasActivas.map((s) => {
                const ids = (s.mesas || []).filter((m) => m.activa).map((m) => m.id);
                const pax = reservas
                  .filter(
                    (r) => ids.includes(r.mesa_id ?? "") && VIVAS.includes(r.estado) && (!turnoPlano || enTurno(r, turnoPlano)),
                  )
                  .reduce((a, r) => a + r.pax, 0);
                const plazas = (s.mesas || []).filter((m) => m.activa).reduce((a, m) => a + m.cap_max, 0);
                return (
                  <option key={s.id} value={s.id}>{s.nombre} · {pax}/{plazas} pax</option>
                );
              })}
            </select>
            <button
              className="btn mini sec"
              onClick={() => { setEdicion(!edicion); setPosCambiadas({}); }}
            >
              {edicion ? "Salir de edición" : "Editar plano"}
            </button>
          </div>
          {edicion ? (
            <div className="modo-edicion">
              Modo edición: arrastra las mesas para recolocarlas y toca una mesa para cambiar sus datos.
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button
                  className="btn mini"
                  onClick={async () => {
                    if (Object.keys(posCambiadas).length) {
                      const ok = await correr(api.guardarPosiciones(posCambiadas), true);
                      if (!ok) return;
                    }
                    setPosCambiadas({});
                    setEdicion(false);
                  }}
                >
                  Guardar posiciones
                </button>
                <button className="btn mini sec" onClick={() => setModal({ tipo: "mesaForm", mesaId: null })}>
                  + Añadir mesa
                </button>
              </div>
            </div>
          ) : null}
          <Plano
            mesas={mesas.filter((m) => m.sala_id === salaPlano && m.activa)}
            resMesaTurno={resMesaTurno}
            edicion={edicion}
            posCambiadas={posCambiadas}
            setPosCambiadas={setPosCambiadas}
            onMesa={(id) => setModal(edicion ? { tipo: "mesaForm", mesaId: id } : { tipo: "mesaSheet", mesaId: id })}
          />
          <div className="leyenda">
            <span><i style={{ background: "#fff", border: "1.5px solid #B9C6CA" }} />Libre el turno</span>
            <span><i style={{ background: "var(--e-confirmada)" }} />1 reserva</span>
            <span><i style={{ background: "var(--vi)" }} />Doblada</span>
            <span><i style={{ background: "var(--e-sentada)" }} />En mesa ahora</span>
            <span><i style={{ background: "#EFEFEF", border: "1px dashed #B9C6CA" }} />No online</span>
          </div>
        </div>

        <div id="col-libro">
          <Libro
            rest={rest}
            fecha={fecha}
            visibles={visibles}
            turnos={turnos}
            turnoPlano={turnoPlano}
            mesas={mesas}
            setEstado={setEstado}
            editar={(r) => setModal({ tipo: "reserva", reserva: r })}
          />
        </div>
      </div>

      {!edicion ? (
        <button className="fab" onClick={() => setModal({ tipo: "reserva", reserva: null })} aria-label="Nueva reserva">+</button>
      ) : null}

      {/* ============ modales ============ */}
      {modal?.tipo === "reserva" ? (
        <ModalReserva
          rest={rest}
          fecha={fecha}
          salas={salasActivas}
          turnos={turnos}
          reservas={reservas}
          reserva={modal.reserva}
          cerrar={() => setModal(null)}
          guardado={async (nuevaFecha) => {
            setModal(null);
            if (nuevaFecha !== fecha) setFecha(nuevaFecha);
            else await recargarDia(restId, fecha);
          }}
        />
      ) : null}
      {modal?.tipo === "mesaSheet" ? (
        <ModalMesaSheet
          mesa={mesas.find((m) => m.id === modal.mesaId)!}
          rs={resMesaTurno(modal.mesaId)}
          turnoPlano={turnoPlano}
          fecha={fecha}
          sinMesa={reservas.filter((r) => !r.mesa_id && ["pendiente", "confirmada"].includes(r.estado))}
          cerrar={() => setModal(null)}
          setEstado={async (id, e) => { await setEstado(id, e); setModal(null); }}
          editar={(r) => setModal({ tipo: "reserva", reserva: r })}
          walkin={() => setModal({ tipo: "walkin", mesaId: modal.mesaId })}
          asignar={async (rid) => {
            const r = reservas.find((x) => x.id === rid)!;
            const conflicto = reservas.find(
              (o) =>
                o.id !== rid &&
                mesasDe(o).includes(modal.mesaId) &&
                VIVAS.includes(o.estado) &&
                solapan(o.hora, o.duracion_min || 120, r.hora, r.duracion_min || 120),
            );
            if (conflicto && !confirm("Ojo: se solapa con otra reserva de esta mesa. ¿Asignar igualmente?")) return;
            await correr(api.asignarMesa(rid, modal.mesaId));
            setModal(null);
          }}
        />
      ) : null}
      {modal?.tipo === "walkin" ? (
        <ModalWalkin
          mesa={mesas.find((m) => m.id === modal.mesaId)!}
          cerrar={() => setModal(null)}
          crear={async (pax, nombre) => {
            const d = new Date();
            const hora = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
            const t = turnoDe(turnos, hoyISO(), hora);
            const ok = await correr(
              api.crearWalkin({
                restauranteId: restId,
                mesaId: modal.mesaId,
                pax,
                nombre,
                fecha: hoyISO(),
                hora,
                turnoId: t?.id ?? null,
                duracionMin: t?.duracion_min ?? 120,
              }),
            );
            if (ok) { setModal(null); setFecha(hoyISO()); }
          }}
        />
      ) : null}
      {modal?.tipo === "mesaForm" ? (
        <ModalMesaForm
          mesa={modal.mesaId ? mesas.find((m) => m.id === modal.mesaId) ?? null : null}
          salas={salas}
          cerrar={() => setModal(null)}
          guardar={async (fila) => {
            const ok = await correr(api.guardarMesa(modal.mesaId, fila), true);
            if (ok) setModal(null);
          }}
        />
      ) : null}
    </>
  );
}

/* ================= Subcomponentes ================= */

function Stats(props: {
  rest: Restaurante;
  rests: Restaurante[];
  fecha: string;
  visibles: Reserva[];
  reservas: Reserva[];
  espera: Espera[];
  cierres: { motivo: string | null }[];
  proximas: { fecha: string; restaurante_id: string }[];
  turnoPlano: Turno | null;
  irADia: (f: string) => void;
}) {
  const { rest, rests, fecha, visibles, reservas, espera, cierres, proximas, turnoPlano, irADia } = props;
  const activas = visibles.filter((r) => r.estado !== "cancelada");
  const vivas = activas.filter((r) => !["no_show", "terminada"].includes(r.estado));
  const paxTot = vivas.reduce((a, r) => a + r.pax, 0);
  const online = activas.filter((r) => r.origen === "online").length;
  const esperando = espera.filter((e) => e.estado === "esperando").length;

  const porDia: Record<string, number> = {};
  proximas
    .filter((p) => p.restaurante_id === rest.id && p.fecha !== fecha)
    .forEach((p) => { porDia[p.fecha] = (porDia[p.fecha] || 0) + 1; });
  const dias = Object.keys(porDia).sort().slice(0, 8);

  const otros: Record<string, number> = {};
  proximas
    .filter((p) => p.fecha === fecha && p.restaurante_id !== rest.id)
    .forEach((p) => {
      const n = rests.find((x) => x.id === p.restaurante_id)?.nombre || "otro local";
      otros[n] = (otros[n] || 0) + 1;
    });
  const fuera = turnoPlano ? reservas.length - visibles.length : 0;

  return (
    <>
      <div className="stats">
        <span><b>{vivas.length}</b> reservas</span>
        <span><b>{paxTot}</b> pax</span>
        <span><b>{online}</b> online</span>
        {esperando ? <span style={{ borderColor: "var(--e-pendiente)" }}><b>{esperando}</b> en espera</span> : null}
        {cierres.length ? (
          <span style={{ borderColor: "var(--e-noshow)", color: "var(--e-noshow)" }}>
            Cierre: {cierres.map((c) => c.motivo || "sin motivo").join(", ")}
          </span>
        ) : null}
      </div>
      {dias.length ? (
        <div className="stats" style={{ marginTop: -4 }}>
          {dias.map((f) => (
            <span key={f} style={{ cursor: "pointer", borderColor: "var(--mar)", color: "var(--mar)" }} onClick={() => irADia(f)}>
              {fmtFC(f).slice(0, 5)} · <b>{porDia[f]}</b>
            </span>
          ))}
        </div>
      ) : null}
      {Object.keys(otros).length ? (
        <div className="aviso info">
          Ese día hay reservas en {Object.entries(otros).map(([n, c]) => `${n} (${c})`).join(", ")}. Cambia de local arriba para verlas.
        </div>
      ) : null}
      {fuera > 0 ? (
        <div className="aviso info">
          Hay {fuera} reserva{fuera > 1 ? "s" : ""} en otro turno de este día — mira los otros turnos o «Día completo».
        </div>
      ) : null}
    </>
  );
}

function Libro(props: {
  rest: Restaurante;
  fecha: string;
  visibles: Reserva[];
  turnos: Turno[];
  turnoPlano: Turno | null;
  mesas: Mesa[];
  setEstado: (id: string, e: string) => void;
  editar: (r: Reserva) => void;
}) {
  const { rest, fecha, visibles, turnos, turnoPlano, mesas, setEstado, editar } = props;
  if (!visibles.length) {
    return (
      <div className="vacio">
        Sin reservas en {rest.nombre}{turnoPlano ? ` en ${turnoPlano.nombre.toLowerCase()}` : ""} para el {fmtF(fecha)}.
        <br />Añade una con el botón +.
      </div>
    );
  }
  const nombresMesas = (r: Reserva) => {
    const ids = mesasDe(r);
    if (!ids.length) return null;
    return ids.map((id) => mesas.find((x) => x.id === id)?.nombre ?? "?").sort().join("+");
  };

  const tarjeta = (r: Reserva) => {
    const c = r.reservas_clientes;
    const e = EST[r.estado] ?? { txt: r.estado, color: "var(--gris)" };
    const nm = nombresMesas(r);
    const msgConfirmar = c?.telefono
      ? `Hola ${c.nombre}, te confirmamos tu reserva en ${rest.nombre} el ${fmtFC(r.fecha)} a las ${h5(r.hora)} para ${r.pax} personas. Localizador ${r.localizador}. ¡Te esperamos!`
      : "";
    const msgRecordar = c?.telefono
      ? `Hola ${c.nombre}, te recordamos tu reserva de hoy en ${rest.nombre} a las ${h5(r.hora)} para ${r.pax} personas. Si no puedes venir, avísanos respondiendo a este mensaje. ¡Gracias!`
      : "";
    return (
      <div key={r.id} className="tarjeta res">
        <div className="hora">{h5(r.hora)}</div>
        <div className="cuerpo">
          <div className="nombre">{c?.nombre || "Sin nombre"} · {r.pax} pax</div>
          <div className="meta">
            {nm ? <>{mesasDe(r).length > 1 ? "Mesas" : "Mesa"} <b>{nm}</b></> : <b>Sin mesa asignada</b>} · {ORIGEN[r.origen] || r.origen} · <code>{r.localizador}</code>
            {c?.telefono ? ` · ${c.telefono}` : ""}
          </div>
          <div className="chips">
            <span className="chip estado" style={{ background: e.color }}>{e.txt}</span>
            {c?.vip ? <span className="chip vip">VIP</span> : null}
            {!r.mesa_id && !["cancelada", "no_show", "terminada"].includes(r.estado) ? (
              <span className="chip sinmesa">Asignar mesa</span>
            ) : null}
            {c?.alergias ? <span className="chip alerg">⚠ {c.alergias}</span> : null}
            {r.notas_cliente ? <span className="chip nota">{r.notas_cliente}</span> : null}
            {r.notas_internas ? <span className="chip nota">🗒 {r.notas_internas}</span> : null}
          </div>
          <div className="acciones">
            {r.estado === "pendiente" ? (
              <>
                <button className="primaria" onClick={() => setEstado(r.id, "confirmada")}>Confirmar</button>
                {c?.telefono ? (
                  <a className="wa" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${telWA(c.telefono)}?text=${encodeURIComponent(msgConfirmar)}`}>WhatsApp</a>
                ) : null}
              </>
            ) : null}
            {r.estado === "confirmada" ? (
              <>
                <button className="primaria" onClick={() => setEstado(r.id, "sentada")}>Sentar</button>
                {c?.telefono ? (
                  <a className="wa" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${telWA(c.telefono)}?text=${encodeURIComponent(msgRecordar)}`}>WhatsApp</a>
                ) : null}
              </>
            ) : null}
            {r.estado === "sentada" ? (
              <button className="primaria" onClick={() => setEstado(r.id, "terminada")}>Terminar</button>
            ) : null}
            {["pendiente", "confirmada"].includes(r.estado) ? (
              <>
                <button className="peligro" onClick={() => { if (confirm("¿Marcar como no-show? Quedará registrado en la ficha del cliente.")) setEstado(r.id, "no_show"); }}>No-show</button>
                <button className="peligro" onClick={() => { if (confirm("¿Cancelar esta reserva?")) setEstado(r.id, "cancelada"); }}>Cancelar</button>
              </>
            ) : null}
            <button onClick={() => editar(r)}>Editar</button>
          </div>
        </div>
      </div>
    );
  };

  if (turnoPlano) return <>{visibles.map(tarjeta)}</>;

  const grupos: Record<string, Reserva[]> = {};
  visibles.forEach((r) => {
    const tt = turnoDe(turnos, fecha, r.hora);
    const clave = tt ? tt.nombre : "Fuera de turno";
    (grupos[clave] = grupos[clave] || []).push(r);
  });
  return (
    <>
      {Object.entries(grupos).map(([nom, arr]) => (
        <div key={nom}>
          <h3 className="seccion">
            {nom} · {arr.filter((r) => !["cancelada", "no_show"].includes(r.estado)).reduce((a, r) => a + r.pax, 0)} pax
          </h3>
          {arr.map(tarjeta)}
        </div>
      ))}
    </>
  );
}
