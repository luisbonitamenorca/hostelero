"use client";

/* Armazón de /pedidos: selector de centro (recordado), pestañas Nuevo · Catálogo · Pedidos ·
   Ajustes (solo dirección y responsables) y la ficha de un pedido encima de todo.
   - Las pestañas visitadas se quedan montadas (ocultas): un dictado a medias no se pierde al
     mirar el catálogo o abrir un pedido.
   - La ficha va en la URL (?pedido=<id>) con history.pushState (Next la integra): el botón
     atrás del móvil la cierra y un enlace o una recarga la vuelven a abrir.
   - Las secciones avisan de pedidos nuevos con window.dispatchEvent(new CustomEvent("ped:cambio")):
     sube `version` y la lista se recarga.
   Contrato: docs/pedidos-contratos.md §1 y §5 (B). */

import { useCallback, useEffect, useRef, useState } from "react";
import SelectorCentro from "./componentes/SelectorCentro";
import SecNuevo from "./secciones/nuevo";
import SecCatalogo from "./secciones/catalogo";
import SecLista from "./secciones/lista";
import SecFicha from "./secciones/ficha";
import SecAjustes from "./secciones/ajustes";
import { esUuid, guardarPref, leerPref } from "./lib-pedidos";
import type { Avisar, ContextoPedidos, PropsSeccionBase, ProveedorPedido } from "./tipos";

const TABS = [
  { id: "nuevo", nombre: "Nuevo", soloGestion: false },
  { id: "catalogo", nombre: "Catálogo", soloGestion: false },
  { id: "pedidos", nombre: "Pedidos", soloGestion: false },
  { id: "ajustes", nombre: "Ajustes", soloGestion: true },
] as const;

type Tab = (typeof TABS)[number]["id"];
const esTab = (v: unknown): v is Tab => typeof v === "string" && TABS.some((t) => t.id === v);

/** Evento que cualquier sección puede lanzar cuando crea o cambia pedidos (Nuevo y Catálogo lo
    lanzan con el literal: importar de aquí haría una dependencia circular). */
const EVENTO_CAMBIO = "ped:cambio";

const pedidoDeLaUrl = (): string | null => {
  const id = new URLSearchParams(window.location.search).get("pedido");
  return esUuid(id) ? id : null;
};

type Toast = { texto: string; tipo: "ok" | "error" };

export default function PanelPedidos({ ctx }: { ctx: ContextoPedidos }) {
  const visibles = TABS.filter((t) => !t.soloGestion || ctx.puedeGestionar);

  const [listo, setListo] = useState(false);
  const [tab, setTab] = useState<Tab>("nuevo");
  const [visitadas, setVisitadas] = useState<Set<Tab>>(() => new Set<Tab>(["nuevo"]));
  const [centroId, setCentroId] = useState(ctx.centros[0]?.id ?? "");
  const [proveedores, setProveedores] = useState<ProveedorPedido[]>(ctx.proveedores);
  const [pedidoAbierto, setPedidoAbierto] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** true si la ficha abierta tiene su propia entrada en el historial (se cierra con back()). */
  const empujado = useRef(false);
  const scrollAntes = useRef(0);

  // Preferencias y pedido de la URL, después de montar (localStorage no existe en el servidor).
  // Solo la primera vez: si el servidor vuelve a mandar ctx (router.refresh), no se resetea nada.
  const iniciado = useRef(false);
  useEffect(() => {
    if (iniciado.current) return;
    iniciado.current = true;
    const t = leerPref<string>("tab", "nuevo");
    const inicial: Tab = esTab(t) && (t !== "ajustes" || ctx.puedeGestionar) ? t : "nuevo";
    setTab(inicial);
    setVisitadas(new Set<Tab>([inicial]));
    const c = leerPref<string>("centro", "");
    if (ctx.centros.some((x) => x.id === c)) setCentroId(c);
    setPedidoAbierto(pedidoDeLaUrl());
    setListo(true);
  }, [ctx.centros, ctx.puedeGestionar]);

  const restaurarScroll = useCallback(() => {
    const y = scrollAntes.current;
    requestAnimationFrame(() => window.scrollTo({ top: y }));
  }, []);

  // Atrás / adelante del navegador abren y cierran la ficha.
  useEffect(() => {
    const alVolver = () => {
      const id = pedidoDeLaUrl();
      empujado.current = !!id;
      setPedidoAbierto(id);
      if (!id) restaurarScroll();
    };
    window.addEventListener("popstate", alVolver);
    return () => window.removeEventListener("popstate", alVolver);
  }, [restaurarScroll]);

  // Pedidos creados o cambiados desde cualquier sección: la lista se recarga.
  useEffect(() => {
    const alCambiarPedidos = () => setVersion((v) => v + 1);
    window.addEventListener(EVENTO_CAMBIO, alCambiarPedidos);
    return () => window.removeEventListener(EVENTO_CAMBIO, alCambiarPedidos);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const avisar: Avisar = useCallback((mensaje, tipo = "ok") => {
    setToast({ texto: mensaje, tipo });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), tipo === "error" ? 5000 : 3000);
  }, []);

  const abrirPedido = useCallback((id: string) => {
    if (!esUuid(id)) return;
    if (!pedidoDeLaUrl()) scrollAntes.current = window.scrollY;
    window.history.pushState({ pedido: id }, "", `${window.location.pathname}?pedido=${encodeURIComponent(id)}`);
    empujado.current = true;
    setPedidoAbierto(id);
    setVersion((v) => v + 1);
    window.scrollTo({ top: 0 });
  }, []);

  const cerrar = useCallback(() => {
    if (empujado.current) {
      window.history.back(); // el popstate cierra la ficha
      return;
    }
    // Ficha abierta desde un enlace o una recarga: no hay a dónde volver en el historial.
    window.history.replaceState(null, "", window.location.pathname);
    setPedidoAbierto(null);
    restaurarScroll();
  }, [restaurarScroll]);

  const alCambiar = useCallback(() => setVersion((v) => v + 1), []);

  const alGuardarProveedor = useCallback((p: ProveedorPedido) => {
    setProveedores((lista) => {
      const existe = lista.some((x) => x.id === p.id);
      if (!p.pedible) return existe ? lista.filter((x) => x.id !== p.id) : lista;
      if (existe) return lista.map((x) => (x.id === p.id ? p : x));
      return [...lista, p].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    });
  }, []);

  const cambiarTab = (id: Tab) => {
    setTab(id);
    guardarPref("tab", id);
    setVisitadas((v) => (v.has(id) ? v : new Set(v).add(id)));
    if (id === "pedidos") setVersion((v) => v + 1); // al volver a la lista, datos frescos
  };

  const cambiarCentro = (id: string) => {
    if (!ctx.centros.some((c) => c.id === id)) return;
    setCentroId(id);
    guardarPref("centro", id);
  };

  if (!listo) {
    return (
      <div className="ped">
        <p className="ped-vacio">Cargando…</p>
      </div>
    );
  }

  const actual = visibles.find((t) => t.id === tab) ?? visibles[0];
  const base: PropsSeccionBase = { ctx, proveedores, centroId, avisar, abrirPedido };
  const panel = (id: Tab, contenido: React.ReactNode) =>
    visitadas.has(id) || actual.id === id ? (
      <div key={id} id={`ped-panel-${id}`} role="tabpanel" aria-labelledby={`ped-tab-${id}`} hidden={actual.id !== id}>
        {contenido}
      </div>
    ) : null;

  return (
    <div className="ped">
      {/* Con la ficha abierta no hay pestañas ni selector: pantalla completa; el «← Volver» lo pinta
          la propia ficha (SecFicha) con `cerrar`. */}
      {pedidoAbierto ? null : (
        <>
          {/* Hermanos directos de .ped (sin envoltorio) para que las pestañas puedan ir pegadas arriba. */}
          {/* En Ajustes no hay centro; en Pedidos manda el filtro propio de la lista (con «Todos los
              centros»): un solo control de centro por pantalla. */}
          {actual.id !== "ajustes" && actual.id !== "pedidos" ? (
            <div className="ped-arriba-centro">
              <SelectorCentro centros={ctx.centros} valor={centroId} onCambio={cambiarCentro} />
            </div>
          ) : null}
          <nav className="ped-tabs" role="tablist" aria-label="Secciones de pedidos">
            {visibles.map((t) => (
              <button
                key={t.id}
                id={`ped-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={actual.id === t.id}
                aria-controls={`ped-panel-${t.id}`}
                className={`ped-tab${actual.id === t.id ? " ped-tab--activa" : ""}`}
                onClick={() => cambiarTab(t.id)}
              >
                {t.nombre}
              </button>
            ))}
          </nav>
        </>
      )}

      <main className="ped-main">
        <div hidden={!!pedidoAbierto}>
          {panel("nuevo", <SecNuevo {...base} version={version} />)}
          {panel("catalogo", <SecCatalogo {...base} />)}
          {panel("pedidos", <SecLista {...base} version={version} />)}
          {ctx.puedeGestionar
            ? panel(
                "ajustes",
                <SecAjustes ctx={ctx} proveedores={proveedores} avisar={avisar} alGuardarProveedor={alGuardarProveedor} />,
              )
            : null}
        </div>
        {pedidoAbierto ? (
          <SecFicha
            key={pedidoAbierto}
            ctx={ctx}
            proveedores={proveedores}
            pedidoId={pedidoAbierto}
            avisar={avisar}
            cerrar={cerrar}
            alCambiar={alCambiar}
          />
        ) : null}
      </main>

      <div className={`ped-toast ped-toast--${toast?.tipo ?? "ok"}`} role="status" aria-live="polite">
        {toast?.texto ?? ""}
      </div>
    </div>
  );
}
