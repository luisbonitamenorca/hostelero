"use client";

/* Buscador de productos pedibles.
   - Filtro LOCAL inmediato sobre el catálogo que se le pase (nombre, referencia, código, alias),
     en el orden del catálogo (lo más pedido en el centro primero).
   - Con ≥ 2 letras y 300 ms de pausa, completa con buscarProductos (servidor) detrás, sin repetir.
   - Sin texto: «Lo más pedido» del catálogo local (si lo hay).
   Lo usan Nuevo (revisión), y la ficha del pedido de C (limitado al proveedor). */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { buscarProductos } from "../acciones/borradores";
import { formatoCantidad, formatoEuros, normalizarTexto, precioReferencia } from "../lib-pedidos";
import type { ProductoCatalogo, PropsBuscadorProducto } from "../tipos";

const MAX_LOCALES = 30;
const MAX_FAVORITOS = 8;
const PAUSA_MS = 300;

type Indexado = { p: ProductoCatalogo; texto: string; nombre: string };

function indexar(p: ProductoCatalogo): Indexado {
  const texto = normalizarTexto([p.nombre, p.ref_proveedor, p.codigo_interno, ...(p.alias ?? [])].filter(Boolean).join(" ")) ?? "";
  return { p, texto, nombre: normalizarTexto(p.nombre) ?? "" };
}

/** Productos locales que casan con TODAS las palabras; primero los que empiezan por la búsqueda. */
function filtrarLocales(indice: Indexado[], consulta: string): ProductoCatalogo[] {
  const palabras = consulta.split(" ").filter(Boolean);
  if (!palabras.length) return [];
  const empiezan: ProductoCatalogo[] = [];
  const resto: ProductoCatalogo[] = [];
  for (const x of indice) {
    if (!palabras.every((w) => x.texto.includes(w))) continue;
    if (x.nombre.startsWith(consulta)) empiezan.push(x.p);
    else resto.push(x.p);
    if (empiezan.length >= MAX_LOCALES) break;
  }
  return [...empiezan, ...resto].slice(0, MAX_LOCALES);
}

export default function BuscadorProducto({
  centroId,
  proveedorId,
  catalogo,
  onElegir,
  onCerrar,
  placeholder,
  autoFocus,
}: PropsBuscadorProducto) {
  const idLista = useId();
  const [texto, setTexto] = useState("");
  const [remotos, setRemotos] = useState<ProductoCatalogo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [errorRemoto, setErrorRemoto] = useState<string | null>(null);
  const [activo, setActivo] = useState(0);
  const peticion = useRef(0);
  const entrada = useRef<HTMLInputElement>(null);

  const consulta = normalizarTexto(texto) ?? "";

  const indice = useMemo(
    () => (catalogo ?? []).filter((p) => !proveedorId || p.proveedor_id === proveedorId).map(indexar),
    [catalogo, proveedorId],
  );

  const locales = useMemo(() => filtrarLocales(indice, consulta), [indice, consulta]);

  const favoritos = useMemo(
    () => (consulta ? [] : indice.filter((x) => x.p.veces > 0).slice(0, MAX_FAVORITOS).map((x) => x.p)),
    [indice, consulta],
  );

  // Búsqueda en el servidor con pausa; las respuestas viejas se descartan.
  useEffect(() => {
    const n = ++peticion.current;
    if (consulta.length < 2) {
      setRemotos([]);
      setBuscando(false);
      setErrorRemoto(null);
      return;
    }
    setBuscando(true);
    const t = setTimeout(async () => {
      try {
        const r = await buscarProductos({ centro_id: centroId, texto, proveedor_id: proveedorId ?? null, limite: 20 });
        if (n !== peticion.current) return;
        if (r.ok) {
          setRemotos(r.productos.filter((p) => !proveedorId || p.proveedor_id === proveedorId));
          setErrorRemoto(null);
        } else {
          setRemotos([]);
          setErrorRemoto(r.error);
        }
      } catch {
        if (n !== peticion.current) return;
        setRemotos([]);
        setErrorRemoto("No se ha podido buscar en el servidor.");
      } finally {
        if (n === peticion.current) setBuscando(false);
      }
    }, PAUSA_MS);
    return () => clearTimeout(t);
  }, [consulta, texto, centroId, proveedorId]);

  /** Productos del catálogo local por id: solo de ellos se sabe cuántas veces se pidieron aquí
      (los del servidor llegan sin frecuencia, no «nunca pedidos»). */
  const porId = useMemo(() => new Map(indice.map((x) => [x.p.producto_id, x.p])), [indice]);

  const resultados = useMemo(() => {
    if (!consulta) return favoritos;
    const vistos = new Set(locales.map((p) => p.producto_id));
    return [
      ...locales,
      ...remotos.filter((p) => !vistos.has(p.producto_id)).map((p) => porId.get(p.producto_id) ?? p),
    ];
  }, [consulta, favoritos, locales, remotos, porId]);

  useEffect(() => {
    setActivo(0);
  }, [consulta]);

  useEffect(() => {
    if (autoFocus) entrada.current?.focus();
  }, [autoFocus]);

  const elegir = (p: ProductoCatalogo) => {
    onElegir(p);
    setTexto("");
  };

  const alTeclear = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && onCerrar) {
      e.preventDefault();
      onCerrar();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActivo((a) => Math.min(a + 1, Math.max(resultados.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActivo((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = resultados[activo];
      if (p) elegir(p);
    }
  };

  return (
    <div className="ped-buscador">
      <div className="ped-buscador-barra">
        <input
          ref={entrada}
          type="search"
          className="ped-buscador-entrada"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={alTeclear}
          placeholder={placeholder ?? "Busca por nombre o código"}
          aria-label="Buscar producto"
          aria-controls={idLista}
          autoComplete="off"
          enterKeyHint="search"
        />
        {onCerrar ? (
          <button type="button" className="ped-boton-texto" onClick={onCerrar}>
            Cerrar
          </button>
        ) : null}
      </div>

      {!consulta && favoritos.length ? <p className="ped-buscador-rotulo">Lo más pedido</p> : null}
      {!consulta && !favoritos.length ? <p className="ped-buscador-ayuda">Escribe al menos 2 letras.</p> : null}

      <ul className="ped-buscador-lista" id={idLista} aria-label="Resultados">
        {resultados.map((p, i) => {
          const precio = precioReferencia(p);
          const conocido = porId.has(p.producto_id);
          const pista = [
            conocido ? (p.veces > 0 ? `Pedido ${p.veces} ${p.veces === 1 ? "vez" : "veces"}` : "Nunca pedido aquí") : null,
            p.ultima_cantidad != null ? `última: ${formatoCantidad(p.ultima_cantidad, p.unidad)}` : null,
            precio != null ? formatoEuros(precio) : null,
          ]
            .filter(Boolean)
            .join(" · ");
          const detalle = [
            !proveedorId ? p.proveedor_nombre : null,
            p.ref_proveedor ? `Ref. ${p.ref_proveedor}` : null,
            p.formato,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={p.producto_id}>
              <button
                type="button"
                className={`ped-resultado${i === activo ? " ped-resultado--activo" : ""}`}
                onClick={() => elegir(p)}
                onMouseEnter={() => setActivo(i)}
              >
                <span className="ped-resultado-nombre">{p.nombre}</span>
                {detalle ? <span className="ped-resultado-detalle">{detalle}</span> : null}
                {pista ? <span className="ped-resultado-pista">{pista}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>

      {consulta && buscando ? <p className="ped-buscador-ayuda">Buscando más…</p> : null}
      {consulta && !buscando && !resultados.length ? (
        <p className="ped-buscador-ayuda">
          {consulta.length < 2 ? "Escribe al menos 2 letras." : "No hay productos con ese nombre o código."}
        </p>
      ) : null}
      {consulta && errorRemoto && !buscando ? <p className="ped-buscador-ayuda ped-texto-error">{errorRemoto}</p> : null}
    </div>
  );
}
