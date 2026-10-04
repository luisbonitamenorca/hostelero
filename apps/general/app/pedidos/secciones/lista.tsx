"use client";

/* Pestaña «Pedidos» (constructor C): tarjetas de pedidos con filtros por estado, centro y
   proveedor. Tocar una tarjeta abre la ficha (PanelPedidos la pinta encima).
   Contrato: docs/pedidos-contratos.md §5 (C) · acciones: ../acciones/seguimiento. */

import { useEffect, useMemo, useRef, useState } from "react";
import { listarPedidos } from "../acciones/seguimiento";
import { formatoEuros, formatoFechaRelativa, formatoMomento, guardarPref, leerPref } from "../lib-pedidos";
import { CANAL_TXT, ESTADO_COTEJO_PEDIDO_TXT, ESTADO_PEDIDO_TXT, ESTADOS_ENVIADOS } from "../tipos";
import type { EstadoPedido, PedidoResumen, PropsSecLista } from "../tipos";
import "./lista.css";

const FILTROS: { id: string; txt: string; estados: EstadoPedido[] }[] = [
  { id: "borradores", txt: "Borradores", estados: ["borrador"] },
  { id: "enviados", txt: "Enviados", estados: ["enviado", "confirmado", "recibido_parcial"] },
  { id: "recibidos", txt: "Recibidos", estados: ["recibido"] },
  { id: "todos", txt: "Todos", estados: [] },
  { id: "cancelados", txt: "Cancelados", estados: ["cancelado"] },
];

const TODOS = "";

export default function SecLista({ ctx, proveedores, centroId, abrirPedido, version }: PropsSecLista) {
  const [filtro, setFiltro] = useState<string>(() => {
    const v = leerPref<string>("lista_estado", "todos");
    return FILTROS.some((f) => f.id === v) ? v : "todos";
  });
  const [centro, setCentro] = useState<string>(centroId);
  const [proveedor, setProveedor] = useState<string>(TODOS);
  const [limite, setLimite] = useState(100);
  const [pedidos, setPedidos] = useState<PedidoResumen[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reintento, setReintento] = useState(0);
  const peticion = useRef(0);

  // El selector de centro de arriba manda: si cambia, la lista lo sigue.
  useEffect(() => {
    setCentro(centroId);
  }, [centroId]);

  useEffect(() => {
    const n = ++peticion.current;
    const estados = FILTROS.find((f) => f.id === filtro)?.estados ?? [];
    setCargando(true);
    listarPedidos({ centro_id: centro || null, proveedor_id: proveedor || null, estados, limite })
      .then((r) => {
        if (n !== peticion.current) return;
        if (r.ok) {
          setPedidos(r.pedidos);
          setError(null);
        } else {
          setError(r.error);
        }
      })
      .catch(() => {
        if (n === peticion.current) setError("No hay conexión con el servidor. Prueba otra vez.");
      })
      .finally(() => {
        if (n === peticion.current) setCargando(false);
      });
  }, [filtro, centro, proveedor, limite, version, reintento]);

  const elegirFiltro = (id: string) => {
    setFiltro(id);
    setLimite(100);
    guardarPref("lista_estado", id);
  };

  // Proveedores del desplegable: los pedibles y, además, los que salgan en la lista (por si alguno
  // dejó de ser pedible y aún tiene pedidos).
  const opcionesProveedor = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of proveedores) m.set(p.id, p.nombre);
    for (const p of pedidos ?? []) if (p.proveedor_id && p.proveedor_nombre) m.set(p.proveedor_id, p.proveedor_nombre);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [proveedores, pedidos]);

  const nombreCentro = (id: string) => ctx.centros.find((c) => c.id === id)?.nombre ?? "";
  const mostrarCentro = centro === TODOS && ctx.centros.length > 1;

  return (
    <section className="pedl">
      <div className="pedl-filtros">
        <div className="pedl-chips" role="tablist" aria-label="Estado de los pedidos">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filtro === f.id}
              className={`pedl-chip${filtro === f.id ? " pedl-chip--activo" : ""}`}
              onClick={() => elegirFiltro(f.id)}
            >
              {f.txt}
            </button>
          ))}
        </div>
        <div className="pedl-selects">
          {ctx.centros.length > 1 ? (
            <label className="pedl-select">
              <span>Centro</span>
              <select value={centro} onChange={(e) => setCentro(e.target.value)}>
                <option value={TODOS}>Todos los centros</option>
                {ctx.centros.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="pedl-select">
            <span>Proveedor</span>
            <select value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
              <option value={TODOS}>Todos los proveedores</option>
              {opcionesProveedor.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <div className="aviso-error pedl-error">
          {error}{" "}
          <button type="button" className="pedl-reintentar" onClick={() => setReintento((x) => x + 1)}>
            Reintentar
          </button>
        </div>
      ) : null}

      {pedidos === null ? (
        <div className="ped-vacio pedl-vacio">{cargando ? "Cargando pedidos…" : ""}</div>
      ) : pedidos.length === 0 ? (
        <div className="ped-vacio pedl-vacio">
          {filtro === "borradores"
            ? "No hay borradores. Haz un pedido en «Nuevo» o «Catálogo»."
            : filtro === "cancelados"
              ? "No hay pedidos cancelados."
              : "No hay pedidos con estos filtros."}
        </div>
      ) : (
        <>
          <div className="pedl-cuenta" aria-live="polite">
            {pedidos.length === 1 ? "1 pedido" : `${pedidos.length} pedidos`}
            {cargando ? " · actualizando…" : ""}
          </div>
          <ul className="pedl-lista">
            {pedidos.map((p) => {
              const enviado = ESTADOS_ENVIADOS.includes(p.estado);
              const fechaPasada = p.estado === "borrador" && !!p.fecha_entrega && p.fecha_entrega < ctx.hoy;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`ped-tarjeta pedl-tarjeta pedl-tarjeta--${p.estado}`}
                    onClick={() => abrirPedido(p.id)}
                  >
                    <span className="pedl-arriba">
                      <span className="pedl-numero">{p.numero}</span>
                      <span className={`ped-chip ped-chip--${p.estado}`}>{ESTADO_PEDIDO_TXT[p.estado]}</span>
                    </span>
                    <span className="pedl-proveedor">{p.proveedor_nombre ?? "Sin proveedor"}</span>
                    <span className="pedl-meta">
                      {mostrarCentro ? <span>{p.centro_nombre || nombreCentro(p.centro_id)}</span> : null}
                      <span className={fechaPasada ? "pedl-alerta" : undefined}>
                        Entrega: {formatoFechaRelativa(p.fecha_entrega, ctx.hoy)}
                        {fechaPasada ? " (ya pasó)" : ""}
                      </span>
                      <span>{p.n_lineas === 1 ? "1 línea" : `${p.n_lineas} líneas`}</span>
                      <span className="pedl-total">{p.total_estimado != null ? formatoEuros(p.total_estimado) : "Sin precio"}</span>
                    </span>
                    <span className="pedl-abajo">
                      <span className="pedl-cuando">
                        {p.estado === "borrador" || !p.enviado_en
                          ? `Creado ${formatoMomento(p.creado_en, ctx.hoy)}`
                          : `Enviado ${formatoMomento(p.enviado_en, ctx.hoy)}${p.canal_envio ? ` · ${CANAL_TXT[p.canal_envio]}` : ""}`}
                      </span>
                      {enviado ? (
                        <span className={`ped-chip ped-chip--cotejo-${p.cotejo_estado}`}>{ESTADO_COTEJO_PEDIDO_TXT[p.cotejo_estado]}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {pedidos.length >= limite && limite < 300 ? (
            <button type="button" className="boton-secundario pedl-mas" onClick={() => setLimite(300)} disabled={cargando}>
              Ver más pedidos
            </button>
          ) : pedidos.length >= 300 ? (
            <p className="pedl-nota">Se ven los 300 más recientes. Filtra por centro o proveedor para encontrar otros.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
