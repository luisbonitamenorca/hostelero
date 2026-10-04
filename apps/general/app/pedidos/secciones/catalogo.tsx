"use client";

/* Pestaña «Catálogo»: el pedido clásico. Elegir proveedor (los más pedidos en el centro arriba) →
   productos con lo que se pide aquí primero, buscador, −/+ con la última cantidad como pista →
   resumen fijo abajo (productos, total estimado, pedido mínimo) → «Crear borrador» → ficha.
   Contrato: docs/pedidos-contratos.md §5 (B). */

import { useEffect, useMemo, useState } from "react";
import { ControlCantidad } from "../componentes/RevisionLineas";
import { cargarCatalogo, guardarBorradores } from "../acciones/borradores";
import {
  estadoMinimo,
  fechaEntregaPorDefecto,
  formatoCantidad,
  formatoEuros,
  formatoFechaRelativa,
  horaCorta,
  hoyMadrid,
  isoDiaSemana,
  lineaAGuardar,
  lineaDesdeProducto,
  limpiarTextoLargo,
  nombreUnidad,
  normalizarTexto,
  precioReferencia,
  textoDiasReparto,
  totalEstimado,
} from "../lib-pedidos";
import type { ProductoCatalogo, PropsSecCatalogo, ProveedorPedido } from "../tipos";

type Elegido = { p: ProductoCatalogo; cantidad: number };

const PAGINA_RESTO = 100;

const casa = (texto: string, palabras: string[]) => palabras.every((w) => texto.includes(w));

function textoProducto(p: ProductoCatalogo): string {
  return normalizarTexto([p.nombre, p.ref_proveedor, p.codigo_interno, p.categoria, ...(p.alias ?? [])].filter(Boolean).join(" ")) ?? "";
}

function resumenProveedor(p: ProveedorPedido): string {
  const partes = [`Reparte ${textoDiasReparto(p.pedido_dias_reparto).toLowerCase()}`];
  if (p.pedido_minimo) partes.push(`mínimo ${formatoEuros(p.pedido_minimo)}`);
  return partes.join(" · ");
}

function FilaProducto({
  p,
  cantidad,
  onCantidad,
}: {
  p: ProductoCatalogo;
  cantidad: number;
  onCantidad: (n: number) => void;
}) {
  const precio = precioReferencia(p);
  const sugerida = p.ultima_cantidad && p.ultima_cantidad > 0 ? p.ultima_cantidad : 1;
  const detalle = [
    p.ref_proveedor ? `Ref. ${p.ref_proveedor}` : null,
    p.formato,
    precio != null ? `${formatoEuros(precio)}${p.unidad ? ` / ${nombreUnidad(p.unidad)}` : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className={`ped-producto${cantidad > 0 ? " ped-producto--elegido" : ""}`}>
      <div className="ped-producto-info">
        <span className="ped-producto-nombre">{p.nombre}</span>
        {detalle ? <span className="ped-producto-detalle">{detalle}</span> : null}
        {p.ultima_cantidad != null ? (
          <span className="ped-producto-pista">Última vez: {formatoCantidad(p.ultima_cantidad, p.unidad)}</span>
        ) : null}
      </div>
      <div className="ped-producto-control">
        {cantidad > 0 ? (
          <>
            <ControlCantidad valor={cantidad} onValor={onCantidad} unidad={p.unidad} nombre={p.nombre} permitirCero />
            {p.unidad ? <span className="ped-producto-unidad">{nombreUnidad(p.unidad, cantidad)}</span> : null}
          </>
        ) : (
          <button
            type="button"
            className="ped-anadir"
            onClick={() => onCantidad(sugerida)}
            aria-label={`Añadir ${formatoCantidad(sugerida, p.unidad)} de ${p.nombre}`}
          >
            ＋
          </button>
        )}
      </div>
    </li>
  );
}

export default function SecCatalogo({ ctx, proveedores, centroId, avisar, abrirPedido }: PropsSecCatalogo) {
  // Uso de cada proveedor en el centro (Σ veces de sus productos), para ordenar la elección.
  const [usoCentro, setUsoCentro] = useState<Map<string, number>>(() => new Map());
  const [filtroProv, setFiltroProv] = useState("");
  const [proveedorId, setProveedorId] = useState<string | null>(null);

  const [productos, setProductos] = useState<ProductoCatalogo[]>([]);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [verResto, setVerResto] = useState(PAGINA_RESTO);

  const [elegidos, setElegidos] = useState<Record<string, Elegido>>({});
  const [fecha, setFecha] = useState<string | null>(null);
  const [notas, setNotas] = useState("");
  const [notaAbierta, setNotaAbierta] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proveedor = proveedorId ? (proveedores.find((p) => p.id === proveedorId) ?? null) : null;
  const lista = Object.values(elegidos);
  const centro = ctx.centros.find((c) => c.id === centroId) ?? null;

  // Frecuencia por proveedor en este centro.
  useEffect(() => {
    let vivo = true;
    cargarCatalogo({ centro_id: centroId })
      .then((r) => {
        if (!vivo || !r.ok) return;
        const m = new Map<string, number>();
        for (const p of r.productos) if (p.veces > 0) m.set(p.proveedor_id, (m.get(p.proveedor_id) ?? 0) + p.veces);
        setUsoCentro(m);
      })
      .catch(() => {
        /* sin frecuencias: orden alfabético */
      });
    return () => {
      vivo = false;
    };
  }, [centroId]);

  // Catálogo del proveedor elegido (con la frecuencia de este centro).
  useEffect(() => {
    if (!proveedorId) {
      setProductos([]);
      return;
    }
    let vivo = true;
    setCargando(true);
    setErrorCarga(null);
    cargarCatalogo({ centro_id: centroId, proveedor_id: proveedorId })
      .then((r) => {
        if (!vivo) return;
        if (r.ok) setProductos(r.productos);
        else {
          setProductos([]);
          setErrorCarga(r.error);
        }
      })
      .catch(() => {
        if (!vivo) return;
        setProductos([]);
        setErrorCarga("No se ha podido cargar el catálogo. Prueba otra vez.");
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [centroId, proveedorId]);

  // Si Ajustes quita el proveedor elegido de los pedibles, se vuelve a elegir.
  useEffect(() => {
    if (proveedorId && !proveedores.some((p) => p.id === proveedorId)) {
      setProveedorId(null);
      setElegidos({});
    }
  }, [proveedores, proveedorId]);

  // Aviso del navegador si se sale con productos elegidos.
  const hayElegidos = lista.length > 0;
  useEffect(() => {
    if (!hayElegidos) return;
    const alSalir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [hayElegidos]);

  /* ─── Elección de proveedor ─── */

  const proveedoresOrdenados = useMemo(() => {
    const palabras = (normalizarTexto(filtroProv) ?? "").split(" ").filter(Boolean);
    const filtrados = palabras.length
      ? proveedores.filter((p) => casa(normalizarTexto(p.nombre) ?? "", palabras))
      : proveedores;
    const usados = filtrados
      .filter((p) => (usoCentro.get(p.id) ?? 0) > 0)
      .sort((a, b) => (usoCentro.get(b.id) ?? 0) - (usoCentro.get(a.id) ?? 0) || a.nombre.localeCompare(b.nombre, "es"));
    const resto = filtrados.filter((p) => !(usoCentro.get(p.id) ?? 0));
    return { usados, resto, filtrando: palabras.length > 0 };
  }, [proveedores, usoCentro, filtroProv]);

  const elegirProveedor = (p: ProveedorPedido) => {
    setProveedorId(p.id);
    setElegidos({});
    setFiltro("");
    setVerResto(PAGINA_RESTO);
    setFecha(fechaEntregaPorDefecto(p));
    setNotas("");
    setNotaAbierta(false);
    setError(null);
    window.scrollTo({ top: 0 });
  };

  const cambiarProveedor = () => {
    if (lista.length && !window.confirm(`Tienes ${lista.length} ${lista.length === 1 ? "producto elegido" : "productos elegidos"}. ¿Cambiar de proveedor y perderlos?`)) {
      return;
    }
    setProveedorId(null);
    setElegidos({});
    setError(null);
  };

  /* ─── Productos ─── */

  const indice = useMemo(() => productos.map((p) => ({ p, texto: textoProducto(p) })), [productos]);

  const { favoritos, resto } = useMemo(() => {
    const palabras = (normalizarTexto(filtro) ?? "").split(" ").filter(Boolean);
    const visibles = palabras.length ? indice.filter((x) => casa(x.texto, palabras)).map((x) => x.p) : productos;
    return {
      favoritos: visibles.filter((p) => p.veces > 0),
      resto: visibles.filter((p) => p.veces <= 0).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    };
  }, [indice, productos, filtro]);

  const ponerCantidad = (p: ProductoCatalogo, n: number) =>
    setElegidos((e) => {
      const x = { ...e };
      if (n > 0) x[p.producto_id] = { p, cantidad: n };
      else delete x[p.producto_id];
      return x;
    });

  const total = totalEstimado(lista.map(({ p, cantidad }) => ({ cantidad, precio_estimado: precioReferencia(p) })));
  const minimo = estadoMinimo(proveedor, total);

  const crear = async () => {
    if (!proveedor || !lista.length || guardando) return;
    if (fecha && fecha < hoyMadrid()) {
      setError("La fecha de entrega ya ha pasado.");
      return;
    }
    setError(null);
    setGuardando(true);
    try {
      const r = await guardarBorradores({
        centro_id: centroId,
        origen: "catalogo",
        transcripcion: null,
        idioma: null,
        interpretacion: null,
        grupos: [
          {
            proveedor_id: proveedor.id,
            fecha_entrega: fecha,
            notas: limpiarTextoLargo(notas, 1000),
            lineas: lista.map(({ p, cantidad }) => lineaAGuardar(lineaDesdeProducto(p, cantidad))),
          },
        ],
        unir_a_borrador: true,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const c = r.pedidos[0];
      setElegidos({});
      setNotas("");
      setNotaAbierta(false);
      window.dispatchEvent(new CustomEvent("ped:cambio"));
      if (c) {
        avisar(c.unido ? `Añadido al borrador ${c.numero} que ya tenías` : `Borrador ${c.numero} creado`);
        abrirPedido(c.id);
      } else {
        avisar("Borrador creado");
      }
    } catch {
      setError("No se ha podido crear el borrador. Prueba otra vez.");
    } finally {
      setGuardando(false);
    }
  };

  /* ─── Pintar ─── */

  if (!proveedor) {
    const { usados, resto: otros, filtrando } = proveedoresOrdenados;
    const boton = (p: ProveedorPedido) => (
      <li key={p.id}>
        <button type="button" className="ped-fila ped-proveedor" onClick={() => elegirProveedor(p)}>
          <span className="ped-proveedor-nombre">{p.nombre}</span>
          <span className="ped-proveedor-detalle">{resumenProveedor(p)}</span>
        </button>
      </li>
    );
    return (
      <div className="ped-seccion ped-catalogo">
        <section className="ped-tarjeta ped-paso">
          <h2 className="ped-titulo">Pedir por catálogo</h2>
          <p className="ped-ayuda">Elige el proveedor.</p>
          {proveedores.length ? (
            <>
              <input
                type="search"
                className="ped-buscador-entrada"
                value={filtroProv}
                onChange={(e) => setFiltroProv(e.target.value)}
                placeholder="Buscar proveedor"
                aria-label="Buscar proveedor"
                autoComplete="off"
              />
              {usados.length ? (
                <>
                  <p className="ped-rotulo">{filtrando ? "Pedidos aquí" : "Los que más pedís aquí"}</p>
                  <ul className="ped-lista-simple">{usados.map(boton)}</ul>
                </>
              ) : null}
              {otros.length ? (
                <>
                  <p className="ped-rotulo">{usados.length ? "Resto de proveedores" : "Proveedores"}</p>
                  <ul className="ped-lista-simple">{otros.map(boton)}</ul>
                </>
              ) : null}
              {!usados.length && !otros.length ? <p className="ped-vacio">Ningún proveedor con ese nombre.</p> : null}
            </>
          ) : (
            <p className="ped-vacio">No hay proveedores para pedir. Dirección puede activarlos en Ajustes.</p>
          )}
        </section>
      </div>
    );
  }

  const hoy = ctx.hoy;
  const dias = proveedor.pedido_dias_reparto ?? [];
  const corte = horaCorta(proveedor.pedido_hora_corte);
  const fechaPasada = !!fecha && fecha < hoy;
  const noReparte = !!fecha && !fechaPasada && dias.length > 0 && !dias.includes(isoDiaSemana(fecha));
  const restoVisible = resto.slice(0, verResto);

  return (
    <div className="ped-seccion ped-catalogo">
      <section className="ped-tarjeta ped-paso">
        <div className="ped-fila-titulo">
          <h2 className="ped-titulo">{proveedor.nombre}</h2>
          <button type="button" className="ped-boton-texto" onClick={cambiarProveedor}>
            Cambiar
          </button>
        </div>
        <p className="ped-ayuda">
          Reparte {textoDiasReparto(dias).toLowerCase()}
          {corte ? ` · pedir antes de las ${corte}` : ""}
          {proveedor.pedido_notas ? ` · ${proveedor.pedido_notas}` : ""}
        </p>
        <div className="ped-grupo-meta">
          <label className="ped-campo-fecha">
            <span>Entrega</span>
            <input type="date" value={fecha ?? ""} min={hoy} onChange={(e) => setFecha(e.target.value || null)} />
            <span className="ped-fecha-relativa">{formatoFechaRelativa(fecha, hoy)}</span>
          </label>
          {fechaPasada ? <p className="ped-aviso ped-aviso--error">Esa fecha ya ha pasado.</p> : null}
          {noReparte ? <p className="ped-aviso">Ese día no reparte (reparte {textoDiasReparto(dias)}).</p> : null}
          {notaAbierta || notas ? (
            <label className="ped-campo-nota">
              <span>Nota para el proveedor</span>
              <input
                type="text"
                value={notas}
                maxLength={1000}
                placeholder="Ej.: entregar antes de las 10"
                onChange={(e) => setNotas(e.target.value)}
              />
            </label>
          ) : (
            <button type="button" className="ped-boton-texto" onClick={() => setNotaAbierta(true)}>
              ＋ Nota para el proveedor
            </button>
          )}
        </div>
      </section>

      <input
        type="search"
        className="ped-buscador-entrada ped-catalogo-filtro"
        value={filtro}
        onChange={(e) => {
          setFiltro(e.target.value);
          setVerResto(PAGINA_RESTO);
        }}
        placeholder={`Buscar en ${proveedor.nombre}`}
        aria-label="Buscar en el catálogo"
        autoComplete="off"
      />

      {cargando ? <p className="ped-vacio">Cargando el catálogo…</p> : null}
      {errorCarga ? (
        <p className="aviso-error ped-error" role="alert">
          {errorCarga}
        </p>
      ) : null}

      {!cargando && !errorCarga ? (
        <>
          {favoritos.length ? (
            <section className="ped-tarjeta ped-bloque-productos" aria-label="Lo que pedís aquí">
              <p className="ped-rotulo">Lo que pedís aquí</p>
              <ul className="ped-productos">
                {favoritos.map((p) => (
                  <FilaProducto
                    key={p.producto_id}
                    p={p}
                    cantidad={elegidos[p.producto_id]?.cantidad ?? 0}
                    onCantidad={(n) => ponerCantidad(p, n)}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {resto.length ? (
            <section className="ped-tarjeta ped-bloque-productos" aria-label="Resto del catálogo">
              <p className="ped-rotulo">{favoritos.length ? "Resto del catálogo" : "Catálogo"}</p>
              <ul className="ped-productos">
                {restoVisible.map((p) => (
                  <FilaProducto
                    key={p.producto_id}
                    p={p}
                    cantidad={elegidos[p.producto_id]?.cantidad ?? 0}
                    onCantidad={(n) => ponerCantidad(p, n)}
                  />
                ))}
              </ul>
              {resto.length > restoVisible.length ? (
                <button type="button" className="ped-boton-grande ped-boton-grande--secundario" onClick={() => setVerResto((v) => v + PAGINA_RESTO)}>
                  Ver más ({resto.length - restoVisible.length})
                </button>
              ) : null}
            </section>
          ) : null}
          {!favoritos.length && !resto.length ? (
            <p className="ped-vacio">
              {filtro ? "No hay productos con ese nombre o código." : "Este proveedor aún no tiene productos para pedir."}
            </p>
          ) : null}
        </>
      ) : null}

      {error ? (
        <p className="aviso-error ped-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="ped-barra-fija">
        {minimo && !minimo.cumple && lista.length ? (
          <p className="ped-aviso ped-aviso--barra">
            Pedido mínimo {formatoEuros(minimo.minimo)}:{" "}
            {minimo.total == null ? "no hay precios para calcular el total" : `llevas ${formatoEuros(minimo.total)}`}
          </p>
        ) : null}
        <p className="ped-barra-resumen">
          <span>
            {lista.length} {lista.length === 1 ? "producto" : "productos"}
            {total != null ? ` · ${formatoEuros(total)}` : ""}
          </span>
          {centro ? <span className="ped-barra-centro">{centro.nombre}</span> : null}
        </p>
        <button type="button" className="ped-boton-grande" onClick={crear} disabled={!lista.length || guardando}>
          {guardando ? "Creando…" : "Crear borrador"}
        </button>
      </div>
    </div>
  );
}
