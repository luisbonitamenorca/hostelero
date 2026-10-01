"use client";

import { useEffect, useState } from "react";
import * as api from "../acciones";
import { EST, fmtFC, h5, type Cliente, type Restaurante } from "../tipos";
import type { SecProps } from "../lib-reservas";
import { Marco } from "../componentes/modal-reserva";
import "./clientes.css";

/* Clientes: buscador y ficha. */
export default function SecClientes({ ctx, avisar }: SecProps) {
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  return (
    <>
      <TabClientes key={version} abrirCliente={setClienteId} />
      {clienteId ? (
        <ModalCliente
          clienteId={clienteId}
          rests={ctx.restaurantes}
          avisar={avisar}
          cerrar={() => setClienteId(null)}
          guardado={() => { setClienteId(null); setVersion((v) => v + 1); }}
        />
      ) : null}
    </>
  );
}

/* ---- Clientes ---- */
export function TabClientes({ abrirCliente }: { abrirCliente: (id: string) => void }) {
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

export function ModalCliente({ clienteId, rests, avisar, cerrar, guardado }: {
  clienteId: string;
  rests: Restaurante[];
  avisar: (m: string) => void;
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
          if (!r.ok) { avisar("No se ha podido guardar (¿teléfono repetido?)."); return; }
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
