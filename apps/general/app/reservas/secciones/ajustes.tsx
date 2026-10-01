"use client";

import { useCallback, useEffect, useState } from "react";
import * as api from "../acciones";
import { DIAS, fmtFC, h5, hoyISO, type Mesa, type Restaurante, type Sala, type Turno } from "../tipos";
import { anunciarRestaurante, type SecProps } from "../lib-reservas";
import { Marco } from "../componentes/modal-reserva";
import "./ajustes.css";

type Modal =
  | { tipo: "turno"; turnoId: string | null }
  | { tipo: "sala"; salaId: string | null }
  | { tipo: "email"; emailId: string }
  | null;

export default function SecAjustes({ rest, fecha, avisar }: SecProps) {
  const [salas, setSalas] = useState<Sala[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [cargado, setCargado] = useState(false);

  const recargarLocal = useCallback(async () => {
    const { salas: s, turnos: t } = await api.cargarLocal(rest.id);
    setSalas(s as unknown as Sala[]);
    setTurnos(t as Turno[]);
    setCargado(true);
  }, [rest.id]);

  useEffect(() => {
    setCargado(false);
    recargarLocal();
  }, [recargarLocal]);

  async function correr(p: Promise<{ ok: boolean; error?: string }>) {
    const r = await p;
    if (!r.ok) {
      avisar(r.error || "No se ha podido guardar. Revisa la conexión.");
      return false;
    }
    await recargarLocal();
    return true;
  }

  if (!cargado) return <div className="spinner" />;

  return (
    <>
      <TabAjustes
        rest={rest}
        fecha={fecha}
        turnos={turnos}
        salas={salas}
        avisar={avisar}
        onRestGuardado={(r) => anunciarRestaurante(r)}
        abrirTurno={(id) => setModal({ tipo: "turno", turnoId: id })}
        abrirSala={(id) => setModal({ tipo: "sala", salaId: id })}
        abrirEmail={(id) => setModal({ tipo: "email", emailId: id })}
        recargar={recargarLocal}
      />
      <TabFront />

      {modal?.tipo === "turno" ? (
        <ModalTurno
          turno={modal.turnoId ? turnos.find((t) => t.id === modal.turnoId) ?? null : null}
          cerrar={() => setModal(null)}
          guardar={async (fila) => {
            const ok = await correr(api.guardarTurno(modal.turnoId, rest.id, fila));
            if (ok) setModal(null);
          }}
        />
      ) : null}
      {modal?.tipo === "sala" ? (
        <ModalSala
          sala={modal.salaId ? salas.find((s) => s.id === modal.salaId) ?? null : null}
          cerrar={() => setModal(null)}
          guardar={async (nombre, activa) => {
            const ok = await correr(api.guardarSala(modal.salaId, rest.id, nombre, activa, salas.length));
            if (ok) setModal(null);
          }}
        />
      ) : null}
      {modal?.tipo === "email" ? <ModalEmail emailId={modal.emailId} cerrar={() => setModal(null)} /> : null}
    </>
  );
}

/* ---- Ajustes ---- */
export function TabAjustes(props: {
  rest: Restaurante;
  fecha: string;
  turnos: Turno[];
  salas: Sala[];
  avisar: (m: string) => void;
  onRestGuardado: (r: Restaurante) => void;
  abrirTurno: (id: string | null) => void;
  abrirSala: (id: string | null) => void;
  abrirEmail: (id: string) => void;
  recargar: () => Promise<void>;
}) {
  const { rest, fecha, turnos, salas, avisar, onRestGuardado, abrirTurno, abrirSala, abrirEmail, recargar } = props;
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
            if (!r.ok) { avisar(r.error || "No se ha podido guardar."); return; }
            onRestGuardado({ ...rest, ...campos });
            avisar("Guardado.");
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
                if (!r.ok) { avisar(r.error || "No se ha podido guardar."); return; }
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
      <div className="aviso info">Las mesas se gestionan desde la pestaña <b>Día</b> → «Editar plano».</div>

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

/* ---- Front público embebido: reservar como un cliente ---- */
export function TabFront() {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <h3 className="seccion">Front público</h3>
      <div className="stats" style={{ alignItems: "center" }}>
        <span>La misma página que ve el cliente (/reservar-mesa). Lo que reserves aquí es real: gestiónalo después desde Día.</span>
        <a href="/reservar-mesa" target="_blank" rel="noopener noreferrer" style={{ fontWeight: 700 }}>Abrir en pestaña nueva ↗</a>
        <button className="btn mini sec" onClick={() => setAbierto(!abierto)}>{abierto ? "Ocultar vista previa" : "Ver aquí"}</button>
      </div>
      {abierto ? (
        <div className="aj-front">
          <iframe
            src="/reservar-mesa"
            title="Front público de Reservas"
            style={{ width: "100%", height: "calc(100vh - 250px)", minHeight: 600, border: 0, display: "block" }}
          />
        </div>
      ) : null}
    </>
  );
}

/* ================= Modales ================= */

export function ModalMesaForm(props: {
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

export function ModalTurno({ turno: t, cerrar, guardar }: {
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

export function ModalSala({ sala, cerrar, guardar }: {
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

export function ModalEmail({ emailId, cerrar }: { emailId: string; cerrar: () => void }) {
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
            style={{ background: "#fff", color: "#1A2226", border: "1px solid var(--borde)", borderRadius: 12, padding: 14, marginTop: 10 }}
            dangerouslySetInnerHTML={{ __html: email.cuerpo }}
          />
        </>
      )}
    </Marco>
  );
}
