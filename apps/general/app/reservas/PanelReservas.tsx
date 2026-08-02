"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./acciones";
import {
  DIAS,
  EST,
  NOMBRES_DIA,
  ORIGEN,
  dowDe,
  enTurno,
  fmtF,
  fmtFC,
  h5,
  hoyISO,
  mesasDe,
  minutos,
  solapan,
  telWA,
  turnoDe,
  type Cliente,
  type Espera,
  type Mesa,
  type Reserva,
  type Restaurante,
  type Sala,
  type Turno,
} from "./tipos";

type Tab = "sala" | "espera" | "clientes" | "datos" | "ajustes";
type Modal =
  | { tipo: "reserva"; reserva: Reserva | null; prellenar?: { cliente?: Cliente | null; pax?: number; notaInterna?: string } }
  | { tipo: "mesaSheet"; mesaId: string }
  | { tipo: "walkin"; mesaId: string }
  | { tipo: "mesaForm"; mesaId: string | null }
  | { tipo: "espera" }
  | { tipo: "cliente"; clienteId: string }
  | { tipo: "turno"; turnoId: string | null }
  | { tipo: "sala"; salaId: string | null }
  | { tipo: "email"; emailId: string }
  | null;

const VIVAS = ["pendiente", "confirmada", "sentada"];

export default function PanelReservas({ restaurantes }: { restaurantes: Restaurante[] }) {
  const [rests, setRests] = useState(restaurantes);
  const [restId, setRestId] = useState(restaurantes[0].id);
  const rest = rests.find((r) => r.id === restId) ?? rests[0];
  const [fecha, setFecha] = useState(hoyISO());
  const [tab, setTab] = useState<Tab>("sala");
  const [salas, setSalas] = useState<Sala[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [espera, setEspera] = useState<Espera[]>([]);
  const [cierres, setCierres] = useState<{ id: string; motivo: string | null }[]>([]);
  const [proximas, setProximas] = useState<{ fecha: string; restaurante_id: string }[]>([]);
  const [turnoSel, setTurnoSel] = useState<string>("");
  const [salaSel, setSalaSel] = useState<string>("");
  const [edicion, setEdicion] = useState(false);
  const [posCambiadas, setPosCambiadas] = useState<Record<string, { pos_x: number; pos_y: number }>>({});
  const [vistaMes, setVistaMes] = useState(false);
  const [mesAncla, setMesAncla] = useState(hoyISO().slice(0, 7));
  const [modal, setModal] = useState<Modal>(null);
  const [cargado, setCargado] = useState(false);
  const edicionRef = useRef(edicion);
  edicionRef.current = edicion;

  const mesas: Mesa[] = useMemo(
    () => salas.flatMap((s) => (s.mesas || []).map((m) => ({ ...m, sala_nombre: s.nombre }))),
    [salas],
  );

  // localStorage: restaurante recordado
  useEffect(() => {
    const guardado = typeof window !== "undefined" ? localStorage.getItem("rest_actual") : null;
    if (guardado && restaurantes.some((r) => r.id === guardado)) setRestId(guardado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const recargarTodo = useCallback(async () => {
    await recargarLocal(restId);
    await recargarDia(restId, fecha);
  }, [recargarLocal, recargarDia, restId, fecha]);

  useEffect(() => {
    setCargado(false);
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

  function cambiarRest(id: string) {
    localStorage.setItem("rest_actual", id);
    setRestId(id);
    setTurnoSel("");
    setSalaSel("");
  }
  function moverDia(d: number) {
    const dt = new Date(fecha + "T12:00:00");
    dt.setDate(dt.getDate() + d);
    setFecha(dt.toISOString().slice(0, 10));
  }

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
      alert(r.error || "No se ha podido guardar. Revisa la conexión.");
      return false;
    }
    if (recargaLocal) await recargarLocal(restId);
    await recargarDia(restId, fecha);
    return true;
  }

  const setEstado = (id: string, estado: string) => correr(api.setEstadoReserva(id, estado));

  return (
    <div className="rsp">
      {/* barra superior */}
      <div className="barra">
        <select className="rest" value={restId} onChange={(e) => cambiarRest(e.target.value)}>
          {rests.map((r) => (
            <option key={r.id} value={r.id}>{r.nombre}</option>
          ))}
        </select>
        <button className="nav" onClick={() => moverDia(-1)} aria-label="Día anterior">‹</button>
        <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        <button className="nav" onClick={() => moverDia(1)} aria-label="Día siguiente">›</button>
        <button className="hoy" onClick={() => setFecha(hoyISO())}>Hoy</button>
        <button className="hoy" onClick={() => { setVistaMes(!vistaMes); setMesAncla(fecha.slice(0, 7)); setTab("sala"); }}>
          {vistaMes ? "Día" : "Mes"}
        </button>
      </div>

      {/* pestañas */}
      <div className="tabsbar">
        {(["sala", "espera", "clientes", "datos", "ajustes"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "activo" : ""} onClick={() => { setTab(t); setVistaMes(false); }}>
            {{ sala: "Sala", espera: "Lista de espera", clientes: "Clientes", datos: "Datos", ajustes: "Ajustes" }[t]}
          </button>
        ))}
      </div>

      <main>
        {!cargado ? (
          <div className="spinner" />
        ) : tab === "sala" && vistaMes ? (
          <VistaMes
            rest={rest}
            mesAncla={mesAncla}
            setMesAncla={setMesAncla}
            turnos={turnos}
            mesas={mesas}
            irADia={(f) => { setFecha(f); setVistaMes(false); }}
          />
        ) : tab === "sala" ? (
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
              rests={rests}
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
          </>
        ) : tab === "espera" ? (
          <TabEspera
            rest={rest}
            fecha={fecha}
            espera={espera}
            abrirForm={() => setModal({ tipo: "espera" })}
            setEsperaEstado={(id, e) => correr(api.setEspera(id, e))}
            convertir={async (e) => {
              await correr(api.setEspera(e.id, "convertida"));
              let cliente: Cliente | null = null;
              if (e.telefono) cliente = await api.buscarClientePorTelefono(e.telefono);
              if (!cliente) {
                const r = await api.crearClienteRapido(e.nombre, e.telefono);
                cliente = r.data ?? null;
              }
              setModal({
                tipo: "reserva",
                reserva: null,
                prellenar: { cliente, pax: e.pax, notaInterna: e.notas ? "De lista de espera: " + e.notas : undefined },
              });
            }}
          />
        ) : tab === "clientes" ? (
          <TabClientes abrirCliente={(id) => setModal({ tipo: "cliente", clienteId: id })} />
        ) : tab === "datos" ? (
          <TabDatos rest={rest} />
        ) : (
          <TabAjustes
            rest={rest}
            fecha={fecha}
            turnos={turnos}
            salas={salas}
            onRestGuardado={(r) => setRests(rests.map((x) => (x.id === r.id ? r : x)))}
            abrirTurno={(id) => setModal({ tipo: "turno", turnoId: id })}
            abrirSala={(id) => setModal({ tipo: "sala", salaId: id })}
            abrirEmail={(id) => setModal({ tipo: "email", emailId: id })}
            recargar={recargarTodo}
          />
        )}
      </main>

      {tab === "sala" && !vistaMes && !edicion ? (
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
          prellenar={modal.prellenar}
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
      {modal?.tipo === "espera" ? (
        <ModalEspera
          fecha={fecha}
          cerrar={() => setModal(null)}
          crear={async (datos) => {
            const ok = await correr(api.crearEspera({ restauranteId: restId, fecha, ...datos }));
            if (ok) setModal(null);
          }}
        />
      ) : null}
      {modal?.tipo === "cliente" ? (
        <ModalCliente
          clienteId={modal.clienteId}
          rests={rests}
          cerrar={() => setModal(null)}
          guardado={async () => { setModal(null); await recargarDia(restId, fecha); }}
        />
      ) : null}
      {modal?.tipo === "turno" ? (
        <ModalTurno
          turno={modal.turnoId ? turnos.find((t) => t.id === modal.turnoId) ?? null : null}
          cerrar={() => setModal(null)}
          guardar={async (fila) => {
            const ok = await correr(api.guardarTurno(modal.turnoId, restId, fila), true);
            if (ok) setModal(null);
          }}
        />
      ) : null}
      {modal?.tipo === "sala" ? (
        <ModalSala
          sala={modal.salaId ? salas.find((s) => s.id === modal.salaId) ?? null : null}
          cerrar={() => setModal(null)}
          guardar={async (nombre, activa) => {
            const ok = await correr(api.guardarSala(modal.salaId, restId, nombre, activa, salas.length), true);
            if (ok) setModal(null);
          }}
        />
      ) : null}
      {modal?.tipo === "email" ? <ModalEmail emailId={modal.emailId} cerrar={() => setModal(null)} /> : null}
    </div>
  );
}

/* ================= Subcomponentes ================= */

function Marco({ cerrar, children }: { cerrar: () => void; children: React.ReactNode }) {
  return (
    <div className="rsp-modal" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <div className="modal">
        <button className="cerrar" onClick={cerrar}>✕</button>
        {children}
      </div>
    </div>
  );
}

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

function Plano(props: {
  mesas: Mesa[];
  resMesaTurno: (mesaId: string) => Reserva[];
  edicion: boolean;
  posCambiadas: Record<string, { pos_x: number; pos_y: number }>;
  setPosCambiadas: (p: Record<string, { pos_x: number; pos_y: number }>) => void;
  onMesa: (id: string) => void;
}) {
  const { mesas, resMesaTurno, edicion, posCambiadas, setPosCambiadas, onMesa } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; movido: boolean } | null>(null);

  function coords(ev: React.PointerEvent) {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = ev.clientX;
    p.y = ev.clientY;
    return p.matrixTransform(svg.getScreenCTM()!.inverse());
  }

  return (
    <svg
      ref={svgRef}
      className="plano"
      viewBox="0 0 100 70"
      xmlns="http://www.w3.org/2000/svg"
      onPointerMove={(ev) => {
        if (!edicion || !drag.current) return;
        drag.current.movido = true;
        const c = coords(ev);
        const x = Math.min(95, Math.max(5, c.x));
        const y = Math.min(65, Math.max(5, c.y));
        setPosCambiadas({ ...posCambiadas, [drag.current.id]: { pos_x: Math.round(x * 10) / 10, pos_y: Math.round(y * 10) / 10 } });
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        const { id, movido } = drag.current;
        drag.current = null;
        if (edicion && !movido) onMesa(id);
      }}
    >
      {mesas.map((m) => {
        const rs = resMesaTurno(m.id);
        const sentada = rs.find((r) => r.estado === "sentada");
        let fill = "#FFFFFF", stroke = "#B9C6CA", texto = "#1A2226";
        if (sentada) { fill = "#2F7D46"; stroke = "#256A3A"; texto = "#fff"; }
        else if (rs.length >= 2) { fill = "#7C2D3E"; stroke = "#5E2230"; texto = "#fff"; }
        else if (rs.length === 1) { fill = "#0F4C5C"; stroke = "#0C3E4B"; texto = "#fff"; }
        else if (!m.reservable_online) { fill = "#EFEFEF"; }
        const pos = posCambiadas[m.id];
        const x = Math.min(95, Math.max(5, Number(pos?.pos_x ?? m.pos_x)));
        const y = Math.min(66, Math.max(4, Number(pos?.pos_y ?? m.pos_y)));
        let forma: React.ReactNode;
        let br: number;
        if (m.forma === "redonda") {
          const rr = m.cap_max >= 7 ? 4.1 : m.cap_max >= 5 ? 3.6 : 3.1;
          forma = <circle cx={0} cy={0} r={rr} fill={fill} stroke={stroke} strokeWidth={0.55} />;
          br = rr;
        } else if (m.forma === "rectangular") {
          const w = m.cap_max >= 10 ? 12 : m.cap_max >= 6 ? 10 : 8.5;
          const h = m.cap_max >= 10 ? 7 : 6;
          forma = <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={1.1} fill={fill} stroke={stroke} strokeWidth={0.55} />;
          br = w / 2;
        } else {
          const l = m.cap_max >= 5 ? 8 : 7;
          forma = <rect x={-l / 2} y={-l / 2} width={l} height={l} rx={1} fill={fill} stroke={stroke} strokeWidth={0.55} />;
          br = l / 2;
        }
        const sub = rs.length ? rs.map((r) => h5(r.hora)).join("·") : `${m.cap_min}-${m.cap_max}`;
        return (
          <g
            key={m.id}
            className="mesa-g"
            transform={`translate(${x},${y})`}
            onPointerDown={(ev) => {
              if (edicion) {
                drag.current = { id: m.id, movido: false };
                (ev.target as Element).setPointerCapture?.(ev.pointerId);
              }
            }}
            onClick={() => { if (!edicion) onMesa(m.id); }}
          >
            {forma}
            <text y={-0.3} textAnchor="middle" fontSize={1.8} fill={texto}>{m.nombre}</text>
            <text y={2} textAnchor="middle" fontSize={1.3} fill={rs.length ? "#ffffffcc" : "#6B7280"}>{sub}</text>
            {rs.length >= 2 ? (
              <>
                <circle cx={br} cy={-br} r={1.7} fill="#fff" stroke="#7C2D3E" strokeWidth={0.4} />
                <text x={br} y={-br + 0.8} textAnchor="middle" fontSize={2} fill="#7C2D3E" fontWeight={700}>{rs.length}</text>
              </>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function VistaMes(props: {
  rest: Restaurante;
  mesAncla: string;
  setMesAncla: (m: string) => void;
  turnos: Turno[];
  mesas: Mesa[];
  irADia: (f: string) => void;
}) {
  const { rest, mesAncla, setMesAncla, turnos, mesas, irADia } = props;
  const [datos, setDatos] = useState<{ reservas: { fecha: string; hora: string; pax: number; mesa_id: string | null }[]; cierres: { fecha: string; turno_id: string | null }[] } | null>(null);

  const [a, m] = mesAncla.split("-").map(Number);
  const finD = new Date(a, m, 0).getDate();

  useEffect(() => {
    setDatos(null);
    api.mesDatos(rest.id, `${mesAncla}-01`, `${mesAncla}-${String(finD).padStart(2, "0")}`).then((d) => setDatos(d));
  }, [rest.id, mesAncla, finD]);

  function nav(d: number) {
    let [ya, ym] = mesAncla.split("-").map(Number);
    ym += d;
    if (ym < 1) { ym = 12; ya--; }
    if (ym > 12) { ym = 1; ya++; }
    setMesAncla(`${ya}-${String(ym).padStart(2, "0")}`);
  }

  if (!datos) return <div className="spinner" />;

  const mesasAct = mesas.filter((x) => x.activa);
  const plazas = mesasAct.reduce((s, x) => s + x.cap_max, 0) || 1;
  const nMesas = mesasAct.length;

  const agg: Record<string, { pax: number; n: number; mesas: Set<string> }> = {};
  let totPax = 0, totRes = 0;
  datos.reservas.forEach((r) => {
    totPax += r.pax;
    totRes++;
    const rDow = dowDe(r.fecha);
    const t = turnos.find((tt) => tt.activo && (tt.dias_semana || []).includes(rDow) && enTurno(r as { hora: string }, tt));
    const clave = r.fecha + "|" + (t ? t.id : "x");
    const d = (agg[clave] = agg[clave] || { pax: 0, n: 0, mesas: new Set() });
    d.pax += r.pax;
    d.n++;
    if (r.mesa_id) d.mesas.add(r.mesa_id);
  });
  const cierresMap: Record<string, (string | null)[]> = {};
  datos.cierres.forEach((c) => { (cierresMap[c.fecha] = cierresMap[c.fecha] || []).push(c.turno_id); });

  const celdas: React.ReactNode[] = DIAS.map((d) => <div key={"h" + d} className="dsem">{d}</div>);
  const blancos = dowDe(`${mesAncla}-01`) - 1;
  for (let i = 0; i < blancos; i++) celdas.push(<div key={"b" + i} className="mes-celda vacia" />);
  const hoy = hoyISO();
  for (let dia = 1; dia <= finD; dia++) {
    const f = `${mesAncla}-${String(dia).padStart(2, "0")}`;
    const fDow = dowDe(f);
    const ts = turnos
      .filter((t) => t.activo && (t.dias_semana || []).includes(fDow))
      .sort((x, y) => (x.hora_inicio < y.hora_inicio ? -1 : 1));
    const cerradoDia = (cierresMap[f] || []).includes(null);
    celdas.push(
      <div key={f} className={`mes-celda ${f === hoy ? "eshoy" : ""}`} onClick={() => irADia(f)}>
        <div className="num">{dia}</div>
        {cerradoDia ? (
          <div className="mes-turno cerrado">Cerrado</div>
        ) : (
          ts.map((t, i) => {
            const icono = i === 0 ? "☀" : "☾";
            if ((cierresMap[f] || []).includes(t.id)) {
              return <div key={t.id} className="mes-turno cerrado"><span className="icono">{icono}</span>Cerrado</div>;
            }
            const d = agg[f + "|" + t.id] || { pax: 0, n: 0, mesas: new Set() };
            const pct = Math.round((d.pax / plazas) * 100);
            return (
              <div key={t.id} className={`mes-turno ${pct >= 100 ? "lleno" : ""}`}>
                <span className="icono">{icono}</span>
                <span className="pct">{pct}%</span>
                <span className="detalle">{d.pax}/{plazas} · {d.mesas.size}/{nMesas}</span>
              </div>
            );
          })
        )}
      </div>,
    );
  }

  return (
    <>
      <div className="mes-cab">
        <button className="nav" style={{ width: 38, height: 38, border: "1px solid var(--borde)", background: "#fff", borderRadius: 9, fontSize: 17, color: "var(--mar)", cursor: "pointer" }} onClick={() => nav(-1)}>‹</button>
        <div className="titulo">{new Date(a, m - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" })}</div>
        <button className="nav" style={{ width: 38, height: 38, border: "1px solid var(--borde)", background: "#fff", borderRadius: 9, fontSize: 17, color: "var(--mar)", cursor: "pointer" }} onClick={() => nav(1)}>›</button>
        <div className="tot"><b>{totPax}</b> pax · <b>{totRes}</b> reservas</div>
      </div>
      <div className="mes-grid">{celdas}</div>
      <div className="leyenda" style={{ marginTop: 10 }}>
        <span>☀ comida · ☾ cena</span>
        <span>% ocupación sobre plazas totales</span>
        <span>pax / plazas · mesas / mesas</span>
      </div>
    </>
  );
}

/* ---- Lista de espera ---- */
function TabEspera(props: {
  rest: Restaurante;
  fecha: string;
  espera: Espera[];
  abrirForm: () => void;
  setEsperaEstado: (id: string, e: string) => void;
  convertir: (e: Espera) => void;
}) {
  const { rest, fecha, espera, abrirForm, setEsperaEstado, convertir } = props;
  const lista = espera.filter((e) => e.estado !== "descartada");
  return (
    <>
      <button className="btn mini" onClick={abrirForm}>+ Añadir a la lista</button>
      <div style={{ marginTop: 12 }}>
        {!lista.length ? (
          <div className="vacio">Nadie en lista de espera para el {fmtF(fecha)}.</div>
        ) : (
          lista.map((e) => {
            const msg = `Hola ${e.nombre}, se ha liberado una mesa en ${rest.nombre} para hoy (${e.pax} pax). Responde a este mensaje si la quieres y te la guardamos.`;
            return (
              <div key={e.id} className="tarjeta">
                <div style={{ fontWeight: 700 }}>
                  {e.nombre} · {e.pax} pax
                  {e.estado === "avisado" ? <span className="chip nota" style={{ marginLeft: 6 }}>Avisado</span> : null}
                  {e.estado === "convertida" ? <span className="chip estado" style={{ background: "var(--e-sentada)", marginLeft: 6 }}>Convertida</span> : null}
                </div>
                <div style={{ color: "var(--gris)", fontSize: 13 }}>
                  {e.telefono || "sin teléfono"}{e.notas ? ` · ${e.notas}` : ""}
                </div>
                {e.estado !== "convertida" ? (
                  <div className="acciones">
                    {e.telefono ? (
                      <a className="wa" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${telWA(e.telefono)}?text=${encodeURIComponent(msg)}`} onClick={() => setEsperaEstado(e.id, "avisado")}>Avisar</a>
                    ) : null}
                    <button className="primaria" onClick={() => convertir(e)}>Convertir en reserva</button>
                    <button className="peligro" onClick={() => setEsperaEstado(e.id, "descartada")}>Descartar</button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

/* ---- Clientes ---- */
function TabClientes({ abrirCliente }: { abrirCliente: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<Cliente[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { api.buscarClientes(q).then(setLista); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <>
      <input placeholder="Buscar por nombre o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ marginTop: 12 }}>
        {lista === null ? (
          <div className="spinner" />
        ) : !lista.length ? (
          <div className="vacio">Sin resultados.</div>
        ) : (
          lista.map((c) => (
            <div key={c.id} className="tarjeta" style={{ cursor: "pointer" }} onClick={() => abrirCliente(c.id)}>
              <div style={{ fontWeight: 700 }}>{c.nombre} {c.vip ? "⭐" : ""}</div>
              <div style={{ fontSize: 13, color: "var(--gris)" }}>
                {c.telefono || "sin teléfono"}{c.email ? ` · ${c.email}` : ""}
              </div>
              {c.alergias ? <div className="chips"><span className="chip alerg">⚠ {c.alergias}</span></div> : null}
            </div>
          ))
        )}
      </div>
    </>
  );
}

/* ---- Datos ---- */
function TabDatos({ rest }: { rest: Restaurante }) {
  const [rango, setRango] = useState("mes");
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof api.datosRango>> | null>(null);

  useEffect(() => {
    setDatos(null);
    const hoy = new Date(hoyISO() + "T12:00:00");
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    let ini: string, fin: string;
    if (rango === "mes") { ini = hoyISO().slice(0, 8) + "01"; fin = hoyISO(); }
    else if (rango === "mes-1") {
      ini = iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1));
      fin = iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0));
    } else if (rango === "todo") { ini = "2000-01-01"; fin = "2099-12-31"; }
    else {
      const d = new Date(hoy);
      d.setDate(d.getDate() - parseInt(rango));
      ini = iso(d);
      fin = hoyISO();
    }
    api.datosRango(rest.id, ini, fin).then(setDatos);
  }, [rest.id, rango]);

  const barra = (eti: string, segs: { v: number; c: string }[], val: number, max: number) => (
    <div className="fila-bar" key={eti}>
      <div className="eti">{eti}</div>
      <div className="pista">
        {segs.map((s, i) => (
          <div key={i} className="seg" style={{ width: `${max ? (s.v / max) * 100 : 0}%`, background: s.c }} />
        ))}
      </div>
      <div className="val">{val}</div>
    </div>
  );

  return (
    <>
      <select value={rango} onChange={(e) => setRango(e.target.value)} style={{ maxWidth: 230 }}>
        <option value="mes">Este mes</option>
        <option value="mes-1">Mes anterior</option>
        <option value="30">Últimos 30 días</option>
        <option value="90">Últimos 90 días</option>
        <option value="todo">Toda la temporada</option>
      </select>
      <div style={{ marginTop: 12 }}>
        {!datos ? (
          <div className="spinner" />
        ) : !datos.ok ? (
          <div className="aviso err">No se han podido cargar los datos.</div>
        ) : !datos.rows.length ? (
          <div className="vacio">Sin reservas de {rest.nombre} en ese periodo.</div>
        ) : (
          (() => {
            const rows = datos.rows;
            const vivas = rows.filter((r) => r.estado !== "cancelada");
            const asistidas = rows.filter((r) => ["terminada", "sentada"].includes(r.estado));
            const noshows = rows.filter((r) => r.estado === "no_show");
            const canceladas = rows.length - vivas.length;
            const paxAsistidos = asistidas.reduce((a, r) => a + r.pax, 0);
            const paxFuturos = vivas.filter((r) => ["pendiente", "confirmada"].includes(r.estado)).reduce((a, r) => a + r.pax, 0);
            const online = vivas.filter((r) => r.origen === "online").length;
            const pctNoShow = noshows.length + asistidas.length ? Math.round((noshows.length / (noshows.length + asistidas.length)) * 100) : 0;

            const dias = Array.from({ length: 7 }, () => ({ c: 0, n: 0 }));
            vivas.filter((r) => r.estado !== "no_show").forEach((r) => {
              const d = dias[dowDe(r.fecha) - 1];
              if (h5(r.hora) < "17:00") d.c += r.pax;
              else d.n += r.pax;
            });
            const maxDia = Math.max(...dias.map((d) => d.c + d.n), 1);

            const canales: Record<string, number> = {};
            vivas.forEach((r) => {
              const c = r.canal || r.origen;
              canales[c] = (canales[c] || 0) + r.pax;
            });
            const topCanales = Object.entries(canales).sort((a, b) => b[1] - a[1]).slice(0, 7);
            const maxCanal = topCanales.length ? topCanales[0][1] : 1;

            const porCliente: Record<string, number> = {};
            asistidas.forEach((r) => { if (r.cliente_id) porCliente[r.cliente_id] = (porCliente[r.cliente_id] || 0) + 1; });
            const topIds = Object.entries(porCliente).sort((a, b) => b[1] - a[1]).slice(0, 8);

            return (
              <>
                <div className="kpis">
                  <div className="kpi"><b>{rows.length}</b><span>reservas</span></div>
                  <div className="kpi"><b>{paxAsistidos}</b><span>pax servidos</span></div>
                  <div className="kpi"><b>{paxFuturos}</b><span>pax por venir</span></div>
                  <div className="kpi"><b>{pctNoShow}%</b><span>no-show</span></div>
                  <div className="kpi"><b>{rows.length ? Math.round((canceladas / rows.length) * 100) : 0}%</b><span>cancelación</span></div>
                  <div className="kpi"><b>{vivas.length ? Math.round((online / vivas.length) * 100) : 0}%</b><span>reservas online</span></div>
                </div>
                <div className="grafica">
                  <h4>Pax por día de la semana</h4>
                  {dias.map((d, i) => barra(NOMBRES_DIA[i], [{ v: d.c, c: "var(--mar)" }, { v: d.n, c: "var(--vi)" }], d.c + d.n, maxDia))}
                  <div className="mini-leyenda">
                    <span><i style={{ background: "var(--mar)" }} />Comida</span>
                    <span><i style={{ background: "var(--vi)" }} />Cena</span>
                  </div>
                </div>
                <div className="grafica">
                  <h4>Pax por canal</h4>
                  {topCanales.map(([c, v]) => barra(c, [{ v, c: "var(--mar)" }], v, maxCanal))}
                </div>
                {topIds.length ? (
                  <div className="grafica">
                    <h4>Clientes más fieles del periodo</h4>
                    <div className="lista-simple">
                      {topIds.map(([id, n]) => {
                        const c = datos.nombres[id];
                        return (
                          <div key={id} className="item">
                            <div className="tit">{c?.nombre || "—"} {c?.vip ? "⭐" : ""}</div>
                            <div className="det">{n} visita{n > 1 ? "s" : ""}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </>
            );
          })()
        )}
      </div>
    </>
  );
}

/* ---- Ajustes ---- */
function TabAjustes(props: {
  rest: Restaurante;
  fecha: string;
  turnos: Turno[];
  salas: Sala[];
  onRestGuardado: (r: Restaurante) => void;
  abrirTurno: (id: string | null) => void;
  abrirSala: (id: string | null) => void;
  abrirEmail: (id: string) => void;
  recargar: () => Promise<void>;
}) {
  const { rest, fecha, turnos, salas, onRestGuardado, abrirTurno, abrirSala, abrirEmail, recargar } = props;
  const [online, setOnline] = useState(rest.online_activo);
  const [antMin, setAntMin] = useState(String(rest.antelacion_min_horas));
  const [antMax, setAntMax] = useState(String(rest.antelacion_max_dias));
  const [tel, setTel] = useState(rest.telefono ?? "");
  const [emailR, setEmailR] = useState(rest.email_reservas ?? "");
  const [desc, setDesc] = useState(rest.descripcion ?? "");
  const [cierres, setCierres] = useState<Awaited<ReturnType<typeof api.cierresFuturos>> | null>(null);
  const [emails, setEmails] = useState<Awaited<ReturnType<typeof api.emailsRecientes>> | null>(null);
  const [ciFecha, setCiFecha] = useState(fecha);
  const [ciTurno, setCiTurno] = useState("");
  const [ciMotivo, setCiMotivo] = useState("");

  useEffect(() => {
    setOnline(rest.online_activo);
    setAntMin(String(rest.antelacion_min_horas));
    setAntMax(String(rest.antelacion_max_dias));
    setTel(rest.telefono ?? "");
    setEmailR(rest.email_reservas ?? "");
    setDesc(rest.descripcion ?? "");
  }, [rest]);

  const cargarCierres = useCallback(() => {
    api.cierresFuturos(rest.id, hoyISO()).then(setCierres);
  }, [rest.id]);
  useEffect(() => {
    cargarCierres();
    api.emailsRecientes(rest.id).then(setEmails);
  }, [rest.id, cargarCierres]);

  return (
    <>
      <h3 className="seccion">Restaurante · {rest.nombre}</h3>
      <div className="tarjeta">
        <label>Reservas online</label>
        <select value={online ? "true" : "false"} onChange={(e) => setOnline(e.target.value === "true")}>
          <option value="true">Activadas</option>
          <option value="false">Desactivadas</option>
        </select>
        <div className="fila">
          <div><label>Antelación mínima (horas)</label><input type="number" min={0} value={antMin} onChange={(e) => setAntMin(e.target.value)} /></div>
          <div><label>Antelación máxima (días)</label><input type="number" min={1} value={antMax} onChange={(e) => setAntMax(e.target.value)} /></div>
        </div>
        <label>Teléfono</label><input value={tel} onChange={(e) => setTel(e.target.value)} />
        <label>Email de reservas (remitente de los correos al cliente)</label>
        <input type="email" value={emailR} onChange={(e) => setEmailR(e.target.value)} placeholder="reservas@bonitamenorca.com" />
        <label>Descripción (visible en la web)</label><input value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button
          className="btn mini"
          style={{ marginTop: 14 }}
          onClick={async () => {
            const campos = {
              online_activo: online,
              antelacion_min_horas: parseInt(antMin) || 0,
              antelacion_max_dias: parseInt(antMax) || 60,
              telefono: tel.trim() || null,
              email_reservas: emailR.trim() || null,
              descripcion: desc.trim() || null,
            };
            const r = await api.guardarRestaurante(rest.id, campos);
            if (!r.ok) { alert(r.error || "No se ha podido guardar."); return; }
            onRestGuardado({ ...rest, ...campos });
          }}
        >
          Guardar
        </button>
      </div>

      <h3 className="seccion">Turnos</h3>
      <div className="tarjeta lista-simple">
        {turnos.map((t) => (
          <div key={t.id} className="item">
            <div>
              <div className="tit">{t.nombre} {t.activo ? "" : "· inactivo"}</div>
              <div className="det">
                {h5(t.hora_inicio)}–{h5(t.hora_fin)} · cada {t.intervalo_min} min · {t.duracion_min} min/mesa · máx {t.max_pax_online} pax online · {(t.dias_semana || []).map((d) => DIAS[d - 1]).join("")}
              </div>
            </div>
            <button className="btn mini sec" onClick={() => abrirTurno(t.id)}>Editar</button>
          </div>
        ))}
        {!turnos.length ? <div className="vacio">Sin turnos.</div> : null}
        <button className="btn mini" style={{ marginTop: 12 }} onClick={() => abrirTurno(null)}>+ Añadir turno</button>
      </div>

      <h3 className="seccion">Cierres y días especiales</h3>
      <div className="tarjeta">
        {cierres === null ? (
          <div className="spinner" />
        ) : (
          <>
            <div className="lista-simple">
              {cierres.map((c) => (
                <div key={c.id} className="item">
                  <div>
                    <div className="tit">{fmtFC(c.fecha)} · {c.reservas_turnos?.nombre ?? "Día completo"}</div>
                    <div className="det">{c.motivo || ""}</div>
                  </div>
                  <button
                    className="btn mini sec"
                    onClick={async () => {
                      const r = await api.borrarCierre(c.id);
                      if (r.ok) { cargarCierres(); await recargar(); }
                    }}
                  >
                    Quitar
                  </button>
                </div>
              ))}
              {!cierres.length ? <div className="vacio">Sin cierres programados.</div> : null}
            </div>
            <div className="fila" style={{ marginTop: 12, alignItems: "flex-end" }}>
              <div><label>Día</label><input type="date" value={ciFecha} onChange={(e) => setCiFecha(e.target.value)} /></div>
              <div>
                <label>Alcance</label>
                <select value={ciTurno} onChange={(e) => setCiTurno(e.target.value)}>
                  <option value="">Día completo</option>
                  {turnos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
              </div>
            </div>
            <label>Motivo</label>
            <input value={ciMotivo} onChange={(e) => setCiMotivo(e.target.value)} placeholder="Evento privado, descanso, festivo…" />
            <button
              className="btn mini"
              style={{ marginTop: 12 }}
              onClick={async () => {
                if (!ciFecha) return;
                const r = await api.crearCierre({ restauranteId: rest.id, fecha: ciFecha, turnoId: ciTurno || null, motivo: ciMotivo.trim() || null });
                if (!r.ok) { alert(r.error || "No se ha podido guardar."); return; }
                setCiMotivo("");
                cargarCierres();
                await recargar();
              }}
            >
              Cerrar ese día/turno
            </button>
          </>
        )}
      </div>

      <h3 className="seccion">Salas</h3>
      <div className="tarjeta lista-simple">
        {salas.map((s) => (
          <div key={s.id} className="item">
            <div>
              <div className="tit">{s.nombre} {s.activa ? "" : "· inactiva"}</div>
              <div className="det">{(s.mesas || []).filter((m) => m.activa).length} mesas activas</div>
            </div>
            <button className="btn mini sec" onClick={() => abrirSala(s.id)}>Editar</button>
          </div>
        ))}
        <button className="btn mini" style={{ marginTop: 12 }} onClick={() => abrirSala(null)}>+ Añadir sala</button>
      </div>
      <div className="aviso info">Las mesas se gestionan desde la pestaña <b>Sala</b> → «Editar plano».</div>

      <h3 className="seccion">Correos a clientes · modo prueba</h3>
      <div className="tarjeta">
        <div className="aviso info">
          El envío real está desactivado: cada correo que el sistema mandaría (al reservar online, confirmar o cancelar) se guarda aquí para revisar los textos.
        </div>
        {emails === null ? (
          <div className="spinner" />
        ) : (
          <div className="lista-simple">
            {emails.map((e) => (
              <div key={e.id} className="item">
                <div style={{ minWidth: 0 }}>
                  <div className="tit" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.asunto}</div>
                  <div className="det">
                    {e.destinatario} · {new Date(e.creado_en).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {e.estado}
                  </div>
                </div>
                <button className="btn mini sec" onClick={() => abrirEmail(e.id)}>Ver</button>
              </div>
            ))}
            {!emails.length ? <div className="vacio">Aún no se ha generado ningún correo.</div> : null}
          </div>
        )}
      </div>
    </>
  );
}

/* ================= Modales ================= */

function ModalReserva(props: {
  rest: Restaurante;
  fecha: string;
  salas: Sala[];
  turnos: Turno[];
  reservas: Reserva[];
  reserva: Reserva | null;
  prellenar?: { cliente?: Cliente | null; pax?: number; notaInterna?: string };
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

  const opcionesMesa = (actual: string, esExtra: boolean) => (
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
          {opcionesMesa(sel, i > 0)}
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

function ModalMesaSheet(props: {
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

function ModalWalkin({ mesa, cerrar, crear }: { mesa: Mesa; cerrar: () => void; crear: (pax: number, nombre: string) => void }) {
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

function ModalMesaForm(props: {
  mesa: Mesa | null;
  salas: Sala[];
  cerrar: () => void;
  guardar: (fila: { nombre: string; sala_id: string; cap_min: number; cap_max: number; forma: string; reservable_online: boolean; activa?: boolean }) => void;
}) {
  const { mesa: m, salas, cerrar, guardar } = props;
  const [nombre, setNombre] = useState(m?.nombre ?? "");
  const [salaId, setSalaId] = useState(m?.sala_id ?? salas[0]?.id ?? "");
  const [capMin, setCapMin] = useState(String(m?.cap_min ?? 1));
  const [capMax, setCapMax] = useState(String(m?.cap_max ?? 4));
  const [forma, setForma] = useState(m?.forma ?? "cuadrada");
  const [online, setOnline] = useState(m ? m.reservable_online : true);
  const [activa, setActiva] = useState(m ? m.activa : true);
  const [error, setError] = useState("");
  return (
    <Marco cerrar={cerrar}>
      <h2>{m ? `Mesa ${m.nombre}` : "Nueva mesa"}</h2>
      <div className="fila">
        <div><label>Nombre</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="p. ej. T5" /></div>
        <div>
          <label>Sala</label>
          <select value={salaId} onChange={(e) => setSalaId(e.target.value)}>
            {salas.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
      </div>
      <div className="fila">
        <div><label>Capacidad mín.</label><input type="number" min={1} value={capMin} onChange={(e) => setCapMin(e.target.value)} /></div>
        <div><label>Capacidad máx.</label><input type="number" min={1} value={capMax} onChange={(e) => setCapMax(e.target.value)} /></div>
      </div>
      <div className="fila">
        <div>
          <label>Forma</label>
          <select value={forma} onChange={(e) => setForma(e.target.value)}>
            {["cuadrada", "redonda", "rectangular"].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div>
          <label>Reservable online</label>
          <select value={online ? "true" : "false"} onChange={(e) => setOnline(e.target.value === "true")}>
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        </div>
      </div>
      {m ? (
        <>
          <label>Activa</label>
          <select value={activa ? "true" : "false"} onChange={(e) => setActiva(e.target.value === "true")}>
            <option value="true">Sí</option>
            <option value="false">No (retirada)</option>
          </select>
        </>
      ) : null}
      {error ? <div className="aviso err">{error}</div> : null}
      <button
        className="btn"
        onClick={() => {
          const min = parseInt(capMin) || 1;
          const max = parseInt(capMax) || 4;
          if (!nombre.trim()) { setError("La mesa necesita un nombre."); return; }
          if (min > max) { setError("La capacidad mínima no puede superar la máxima."); return; }
          guardar({ nombre: nombre.trim(), sala_id: salaId, cap_min: min, cap_max: max, forma, reservable_online: online, ...(m ? { activa } : {}) });
        }}
      >
        {m ? "Guardar" : "Crear mesa"}
      </button>
    </Marco>
  );
}

function ModalEspera({ fecha, cerrar, crear }: {
  fecha: string;
  cerrar: () => void;
  crear: (d: { nombre: string; telefono: string | null; pax: number; notas: string | null }) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [tel, setTel] = useState("");
  const [pax, setPax] = useState("2");
  const [notas, setNotas] = useState("");
  return (
    <Marco cerrar={cerrar}>
      <h2>Añadir a lista de espera · {fmtFC(fecha)}</h2>
      <label>Nombre</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <div className="fila">
        <div><label>Teléfono</label><input type="tel" value={tel} onChange={(e) => setTel(e.target.value)} /></div>
        <div><label>Pax</label><input type="number" min={1} value={pax} onChange={(e) => setPax(e.target.value)} /></div>
      </div>
      <label>Notas</label><input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Franja preferida…" />
      <button
        className="btn"
        onClick={() => {
          if (!nombre.trim()) { alert("Falta el nombre."); return; }
          crear({ nombre: nombre.trim(), telefono: tel.trim() || null, pax: parseInt(pax) || 2, notas: notas.trim() || null });
        }}
      >
        Añadir
      </button>
    </Marco>
  );
}

function ModalCliente({ clienteId, rests, cerrar, guardado }: {
  clienteId: string;
  rests: Restaurante[];
  cerrar: () => void;
  guardado: () => void;
}) {
  const [ficha, setFicha] = useState<Awaited<ReturnType<typeof api.fichaCliente>> | null>(null);
  const [nombre, setNombre] = useState("");
  const [tel, setTel] = useState("");
  const [email, setEmail] = useState("");
  const [alergias, setAlergias] = useState("");
  const [notas, setNotas] = useState("");
  const [vip, setVip] = useState(false);

  useEffect(() => {
    api.fichaCliente(clienteId).then((f) => {
      setFicha(f);
      if (f.cliente) {
        setNombre(f.cliente.nombre ?? "");
        setTel(f.cliente.telefono ?? "");
        setEmail(f.cliente.email ?? "");
        setAlergias(f.cliente.alergias ?? "");
        setNotas(f.cliente.notas ?? "");
        setVip(!!f.cliente.vip);
      }
    });
  }, [clienteId]);

  if (!ficha?.cliente) {
    return <Marco cerrar={cerrar}><div className="spinner" /></Marco>;
  }
  const hist = ficha.historial;
  const noshows = hist.filter((r) => r.estado === "no_show").length;
  const visitas = hist.filter((r) => ["terminada", "sentada"].includes(r.estado)).length;
  return (
    <Marco cerrar={cerrar}>
      <h2>{ficha.cliente.nombre}</h2>
      <div className="chips" style={{ margin: "6px 0 2px" }}>
        <span className="chip nota">{visitas} visitas</span>
        {noshows ? <span className="chip noshows">{noshows} no-show{noshows > 1 ? "s" : ""}</span> : null}
        {ficha.cliente.vip ? <span className="chip vip">VIP</span> : null}
      </div>
      <div className="fila">
        <div><label>Nombre</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
        <div><label>Teléfono</label><input value={tel} onChange={(e) => setTel(e.target.value)} /></div>
      </div>
      <label>Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} />
      <label>Alergias</label><input value={alergias} onChange={(e) => setAlergias(e.target.value)} placeholder="Marisco, gluten…" />
      <label>Notas internas</label><textarea value={notas} onChange={(e) => setNotas(e.target.value)} />
      <label>VIP</label>
      <select value={vip ? "true" : "false"} onChange={(e) => setVip(e.target.value === "true")}>
        <option value="false">No</option>
        <option value="true">Sí</option>
      </select>
      <button
        className="btn"
        onClick={async () => {
          const r = await api.guardarCliente(clienteId, {
            nombre: nombre.trim(),
            telefono: tel.replace(/\D/g, "") || null,
            email: email.trim() || null,
            alergias: alergias.trim() || null,
            notas: notas.trim() || null,
            vip,
          });
          if (!r.ok) { alert("No se ha podido guardar (¿teléfono repetido?)."); return; }
          guardado();
        }}
      >
        Guardar ficha
      </button>
      {hist.length ? (
        <>
          <label style={{ marginTop: 18 }}>Historial</label>
          <div className="lista-simple">
            {hist.map((r, i) => {
              const restN = rests.find((x) => x.id === r.restaurante_id)?.nombre ?? "";
              const e = EST[r.estado] ?? { txt: r.estado, color: "var(--gris)" };
              return (
                <div key={i} className="item">
                  <div>
                    <div className="tit">{fmtFC(r.fecha)} · {h5(r.hora)}</div>
                    <div className="det">{restN} · {r.pax} pax</div>
                  </div>
                  <span className="chip estado" style={{ background: e.color }}>{e.txt}</span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </Marco>
  );
}

function ModalTurno({ turno: t, cerrar, guardar }: {
  turno: Turno | null;
  cerrar: () => void;
  guardar: (fila: { nombre: string; hora_inicio: string; hora_fin: string; intervalo_min: number; duracion_min: number; max_pax_online: number; dias_semana: number[]; activo?: boolean }) => void;
}) {
  const [nombre, setNombre] = useState(t?.nombre ?? "");
  const [ini, setIni] = useState(t ? h5(t.hora_inicio) : "13:00");
  const [fin, setFin] = useState(t ? h5(t.hora_fin) : "15:30");
  const [intv, setIntv] = useState(String(t?.intervalo_min ?? 15));
  const [dur, setDur] = useState(String(t?.duracion_min ?? 120));
  const [maxPax, setMaxPax] = useState(String(t?.max_pax_online ?? 8));
  const [dias, setDias] = useState<number[]>(t?.dias_semana ?? [1, 2, 3, 4, 5, 6, 7]);
  const [activo, setActivo] = useState(t ? t.activo : true);
  const [error, setError] = useState("");
  return (
    <Marco cerrar={cerrar}>
      <h2>{t ? "Editar turno" : "Nuevo turno"}</h2>
      <label>Nombre</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Comida / Cena" />
      <div className="fila">
        <div><label>Primera hora</label><input type="time" value={ini} onChange={(e) => setIni(e.target.value)} /></div>
        <div><label>Última hora</label><input type="time" value={fin} onChange={(e) => setFin(e.target.value)} /></div>
      </div>
      <div className="fila">
        <div><label>Intervalo (min)</label><input type="number" step={5} min={5} value={intv} onChange={(e) => setIntv(e.target.value)} /></div>
        <div><label>Duración mesa (min)</label><input type="number" step={15} min={30} value={dur} onChange={(e) => setDur(e.target.value)} /></div>
      </div>
      <label>Máximo pax por reserva online</label>
      <input type="number" min={1} value={maxPax} onChange={(e) => setMaxPax(e.target.value)} />
      <label>Días de la semana</label>
      <div className="dias">
        {DIAS.map((d, i) => (
          <label key={d}>
            <input
              type="checkbox"
              checked={dias.includes(i + 1)}
              onChange={(e) => setDias(e.target.checked ? [...dias, i + 1].sort() : dias.filter((x) => x !== i + 1))}
            />
            {d}
          </label>
        ))}
      </div>
      {t ? (
        <>
          <label>Activo</label>
          <select value={activo ? "true" : "false"} onChange={(e) => setActivo(e.target.value === "true")}>
            <option value="true">Sí</option>
            <option value="false">No</option>
          </select>
        </>
      ) : null}
      {error ? <div className="aviso err">{error}</div> : null}
      <button
        className="btn"
        onClick={() => {
          if (!nombre.trim() || !ini || !fin) { setError("Faltan datos del turno."); return; }
          if (!dias.length) { setError("Marca al menos un día."); return; }
          if (fin <= ini) { setError("La última hora debe ser posterior a la primera."); return; }
          guardar({
            nombre: nombre.trim(),
            hora_inicio: ini,
            hora_fin: fin,
            intervalo_min: parseInt(intv) || 15,
            duracion_min: parseInt(dur) || 120,
            max_pax_online: parseInt(maxPax) || 8,
            dias_semana: dias,
            ...(t ? { activo } : {}),
          });
        }}
      >
        {t ? "Guardar" : "Crear turno"}
      </button>
    </Marco>
  );
}

function ModalSala({ sala, cerrar, guardar }: {
  sala: Sala | null;
  cerrar: () => void;
  guardar: (nombre: string, activa: boolean) => void;
}) {
  const [nombre, setNombre] = useState(sala?.nombre ?? "");
  const [activa, setActiva] = useState(sala ? sala.activa : true);
  return (
    <Marco cerrar={cerrar}>
      <h2>{sala ? `Sala ${sala.nombre}` : "Nueva sala"}</h2>
      <label>Nombre</label><input value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <label>Activa</label>
      <select value={activa ? "true" : "false"} onChange={(e) => setActiva(e.target.value === "true")}>
        <option value="true">Sí</option>
        <option value="false">No</option>
      </select>
      <button
        className="btn"
        onClick={() => { if (nombre.trim()) guardar(nombre.trim(), activa); }}
      >
        {sala ? "Guardar" : "Crear sala"}
      </button>
    </Marco>
  );
}

function ModalEmail({ emailId, cerrar }: { emailId: string; cerrar: () => void }) {
  const [email, setEmail] = useState<Awaited<ReturnType<typeof api.verEmail>> | null>(null);
  useEffect(() => { api.verEmail(emailId).then(setEmail); }, [emailId]);
  return (
    <Marco cerrar={cerrar}>
      {!email ? (
        <div className="spinner" />
      ) : (
        <>
          <h2 style={{ fontSize: 16 }}>{email.asunto}</h2>
          <p style={{ fontSize: 12, color: "var(--gris)" }}>Para: {email.destinatario} · estado: {email.estado}</p>
          <div
            style={{ background: "#fff", border: "1px solid var(--borde)", borderRadius: 12, padding: 14, marginTop: 10 }}
            dangerouslySetInnerHTML={{ __html: email.cuerpo }}
          />
        </>
      )}
    </Marco>
  );
}
