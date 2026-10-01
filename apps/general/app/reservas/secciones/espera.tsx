"use client";

import { useCallback, useEffect, useState } from "react";
import * as api from "../acciones";
import { fmtF, fmtFC, hoyISO, telWA, type Cliente, type Espera, type Reserva, type Restaurante, type Sala, type Turno } from "../tipos";
import { useRecargaExterna, type SecProps } from "../lib-reservas";
import { Marco, ModalReserva, type Prellenar } from "../componentes/modal-reserva";
import "./espera.css";

type Modal =
  | { tipo: "espera" }
  | { tipo: "reserva"; prellenar: Prellenar }
  | null;

/* Lista de espera del día seleccionado. */
export default function SecEspera({ rest, fecha, setFecha, avisar }: SecProps) {
  const restId = rest.id;
  const [espera, setEspera] = useState<Espera[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [cargado, setCargado] = useState(false);

  const recargarDia = useCallback(async () => {
    const d = await api.cargarDia(restId, fecha, hoyISO());
    setEspera(d.espera);
    setReservas(d.reservas);
    setCargado(true);
  }, [restId, fecha]);

  useEffect(() => {
    api.cargarLocal(restId).then(({ salas: s, turnos: t }) => {
      setSalas(s as unknown as Sala[]);
      setTurnos(t as Turno[]);
    });
  }, [restId]);

  useEffect(() => {
    setCargado(false);
    recargarDia();
  }, [recargarDia]);

  useRecargaExterna(recargarDia);

  async function correr(p: Promise<{ ok: boolean; error?: string }>) {
    const r = await p;
    if (!r.ok) {
      avisar(r.error || "No se ha podido guardar. Revisa la conexión.");
      return false;
    }
    await recargarDia();
    return true;
  }

  if (!cargado) return <div className="spinner" />;

  return (
    <>
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
            prellenar: { cliente, pax: e.pax, notaInterna: e.notas ? "De lista de espera: " + e.notas : undefined },
          });
        }}
      />

      {modal?.tipo === "espera" ? (
        <ModalEspera
          fecha={fecha}
          avisar={avisar}
          cerrar={() => setModal(null)}
          crear={async (datos) => {
            const ok = await correr(api.crearEspera({ restauranteId: restId, fecha, ...datos }));
            if (ok) setModal(null);
          }}
        />
      ) : null}
      {modal?.tipo === "reserva" ? (
        <ModalReserva
          rest={rest}
          fecha={fecha}
          salas={salas.filter((s) => s.activa)}
          turnos={turnos}
          reservas={reservas}
          reserva={null}
          prellenar={modal.prellenar}
          cerrar={() => setModal(null)}
          guardado={async (nuevaFecha) => {
            setModal(null);
            avisar("Reserva creada.");
            if (nuevaFecha !== fecha) setFecha(nuevaFecha);
            else await recargarDia();
          }}
        />
      ) : null}
    </>
  );
}

/* ---- Lista de espera ---- */
export function TabEspera(props: {
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

export function ModalEspera({ fecha, avisar, cerrar, crear }: {
  fecha: string;
  avisar: (m: string) => void;
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
          if (!nombre.trim()) { avisar("Falta el nombre."); return; }
          crear({ nombre: nombre.trim(), telefono: tel.trim() || null, pax: parseInt(pax) || 2, notas: notas.trim() || null });
        }}
      >
        Añadir
      </button>
    </Marco>
  );
}
