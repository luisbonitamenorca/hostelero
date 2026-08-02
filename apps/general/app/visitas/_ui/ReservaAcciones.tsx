"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Modal from "./Modal";
import { euro, fDate, fHora, PAGO_LABEL } from "../comun";
import { cancelarReserva, marcarEntrada } from "../acciones";

export type ReservaVista = {
  id: string;
  codigo_reserva: string;
  cliente_nombre: string;
  cliente_email: string | null;
  cliente_telefono: string | null;
  cliente_pais: string | null;
  num_personas: number;
  importe_total: number;
  metodo_pago: string;
  estado: string;
  check_in_at: string | null;
  visitas_sesiones: {
    fecha: string;
    hora_inicio: string;
    visitas_productos: { nombre_es: string } | null;
  } | null;
};

const PILL: Record<string, string> = { pagada: "green", pendiente_pago: "amber", cancelada: "red" };

export default function ReservaAcciones({ reserva: r }: { reserva: ReservaVista }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const s = r.visitas_sesiones;

  function correr(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        alert(res.error || "No se pudo completar la acción.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button className="btn sm" onClick={() => setOpen(true)}>Ver</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Reserva ${r.codigo_reserva}`}
        footer={<button className="btn ghost" onClick={() => setOpen(false)}>Cerrar</button>}
      >
        <table style={{ width: "100%" }}>
          <tbody style={{ fontSize: 14 }}>
            <tr><td className="muted" style={{ width: 140 }}>Nº de comanda</td><td><code>{r.codigo_reserva}</code></td></tr>
            <tr><td className="muted">Cliente</td><td>{r.cliente_nombre || "—"}</td></tr>
            <tr><td className="muted">Email</td><td>{r.cliente_email || "—"}</td></tr>
            <tr><td className="muted">Teléfono</td><td>{r.cliente_telefono || "—"}</td></tr>
            <tr><td className="muted">País</td><td>{r.cliente_pais || "—"}</td></tr>
            <tr><td className="muted">Visita</td><td>{s?.visitas_productos?.nombre_es || "—"}</td></tr>
            <tr><td className="muted">Sesión</td><td>{s ? `${fDate(s.fecha)} · ${fHora(s.hora_inicio)}` : "—"}</td></tr>
            <tr><td className="muted">Personas</td><td>{r.num_personas}</td></tr>
            <tr><td className="muted">Importe</td><td>{euro(r.importe_total)}</td></tr>
            <tr><td className="muted">Pago</td><td>{PAGO_LABEL[r.metodo_pago] || r.metodo_pago}</td></tr>
            <tr><td className="muted">Estado</td><td><span className={`pill ${PILL[r.estado] || "grey"}`}>{r.estado.replace("_", " ")}</span></td></tr>
            <tr><td className="muted">Entrada</td><td>{r.check_in_at ? `✓ Escaneada · ${fDate(r.check_in_at.slice(0, 10))}` : "No escaneada"}</td></tr>
          </tbody>
        </table>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          {r.estado !== "cancelada" && !r.check_in_at ? (
            <button className="btn" disabled={pending} onClick={() => correr(() => marcarEntrada(r.id, true))}>
              Marcar entrada
            </button>
          ) : null}
          {r.check_in_at ? (
            <button className="btn ghost" disabled={pending} onClick={() => correr(() => marcarEntrada(r.id, false))}>
              Quitar entrada
            </button>
          ) : null}
          {r.estado !== "cancelada" ? (
            <button
              className="btn danger"
              disabled={pending}
              onClick={() => {
                if (confirm(`¿Cancelar la reserva ${r.codigo_reserva}? Se liberará la plaza.`)) {
                  correr(() => cancelarReserva(r.codigo_reserva));
                }
              }}
            >
              Cancelar reserva
            </button>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
