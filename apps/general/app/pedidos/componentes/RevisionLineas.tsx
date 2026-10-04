"use client";

/* Revisión de lo interpretado antes de guardar: «Sin identificar» arriba y un grupo por proveedor
   (fecha de entrega, nota, total y aviso de pedido mínimo). Cada línea: cantidad con −/+ y edición
   directa, unidad, chip de confianza, alternativas como botones rápidos, «Cambiar» (buscador) y
   quitar. Al cambiar el producto la línea puede saltar de grupo (se reagrupa en cada render).
   También exporta ControlCantidad / SelectorUnidad / pasoCantidad, que usa la sección Catálogo. */

import { useEffect, useMemo, useState } from "react";
import BuscadorProducto from "./BuscadorProducto";
import {
  agruparRevision,
  cambiarProductoLinea,
  estadoMinimo,
  formatoEuros,
  formatoFechaRelativa,
  formatoNumero,
  horaCorta,
  isoDiaSemana,
  lineaDesdeProducto,
  metaPorDefecto,
  nivelConfianza,
  normalizarUnidad,
  parsearNumero,
  precioReferencia,
  redondear,
  textoDiasReparto,
} from "../lib-pedidos";
import { SIN_PROVEEDOR, UNIDADES } from "../tipos";
import type { LineaRevision, MetaGrupo, ProductoCatalogo, PropsRevisionLineas, ProveedorPedido } from "../tipos";

/* ═══════════════════════ Piezas reutilizables (también en Catálogo) ═══════════════════════ */

const MAX_CANTIDAD = 100000;

/** Paso del −/+: 1; 0,5 si la unidad es kg o caja y la cantidad ya lleva decimales. */
export function pasoCantidad(cantidad: number, unidad: string | null | undefined): number {
  const u = normalizarUnidad(unidad);
  return (u === "kg" || u === "caja") && !Number.isInteger(cantidad) ? 0.5 : 1;
}

/** Campo numérico con coma decimal: se edita como texto y se confirma al salir o con Intro. */
function CampoCantidad({
  valor,
  onValor,
  permitirCero,
  etiqueta,
}: {
  valor: number;
  onValor: (n: number) => void;
  permitirCero?: boolean;
  etiqueta: string;
}) {
  const [texto, setTexto] = useState<string | null>(null); // null = no se está editando

  const confirmar = () => {
    if (texto === null) return;
    const n = parsearNumero(texto);
    setTexto(null);
    if (n == null || !Number.isFinite(n)) return;
    if (n < 0 || (!permitirCero && n === 0) || n > MAX_CANTIDAD) return;
    const r = redondear(n, 3);
    if (r !== valor) onValor(r);
  };

  return (
    <input
      className="ped-cantidad-entrada"
      inputMode="decimal"
      enterKeyHint="done"
      aria-label={etiqueta}
      value={texto ?? formatoNumero(valor)}
      onFocus={(e) => {
        setTexto(formatoNumero(valor));
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setTexto(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** − cantidad +. Con permitirCero, el − desde el paso deja 0 (Catálogo: quitar el producto). */
export function ControlCantidad({
  valor,
  onValor,
  unidad,
  nombre,
  permitirCero,
}: {
  valor: number;
  onValor: (n: number) => void;
  unidad: string | null | undefined;
  /** Nombre del producto, para las etiquetas accesibles. */
  nombre: string;
  permitirCero?: boolean;
}) {
  const paso = pasoCantidad(valor, unidad);
  const menos = redondear(valor - paso, 3);
  const puedeMenos = menos > 0 || (permitirCero && valor > 0);
  return (
    <div className="ped-cantidad">
      <button
        type="button"
        className="ped-cantidad-boton"
        onClick={() => onValor(menos > 0 ? menos : 0)}
        disabled={!puedeMenos}
        aria-label={`Menos ${nombre}`}
      >
        −
      </button>
      <CampoCantidad valor={valor} onValor={onValor} permitirCero={permitirCero} etiqueta={`Cantidad de ${nombre}`} />
      <button
        type="button"
        className="ped-cantidad-boton"
        onClick={() => onValor(Math.min(redondear(valor + paso, 3), MAX_CANTIDAD))}
        aria-label={`Más ${nombre}`}
      >
        +
      </button>
    </div>
  );
}

/** Desplegable de unidad (canónicas; si la línea trae otra, también aparece). */
export function SelectorUnidad({
  valor,
  onValor,
  nombre,
}: {
  valor: string | null;
  onValor: (u: string | null) => void;
  nombre: string;
}) {
  const actual = normalizarUnidad(valor) ?? "";
  const extra = actual && !(UNIDADES as readonly string[]).includes(actual) ? actual : null;
  return (
    <select
      className="ped-unidad"
      value={actual}
      onChange={(e) => onValor(e.target.value || null)}
      aria-label={`Unidad de ${nombre}`}
    >
      <option value="">—</option>
      {UNIDADES.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
      {extra ? <option value={extra}>{extra}</option> : null}
    </select>
  );
}

const CONFIANZA_TXT = { alta: "Seguro", media: "Revisar", baja: "Dudoso" } as const;

function ChipConfianza({ confianza }: { confianza: number | null }) {
  const n = nivelConfianza(confianza);
  if (!n) return null;
  return (
    <span className={`ped-chip ped-confianza--${n}`} title={`Confianza de la IA: ${Math.round((confianza ?? 0) * 100)} %`}>
      {CONFIANZA_TXT[n]}
    </span>
  );
}

/* ═══════════════════════ Revisión ═══════════════════════ */

/** Cambia el producto y deja el anterior como alternativa (para deshacer con un toque). */
function conProducto(l: LineaRevision, p: ProductoCatalogo): LineaRevision {
  const n = cambiarProductoLinea(l, p);
  const anterior = l.producto;
  if (anterior && anterior.producto_id !== p.producto_id) {
    n.alternativas = [anterior, ...n.alternativas.filter((a) => a.producto_id !== anterior.producto_id)].slice(0, 3);
  }
  return n;
}

function detalleProducto(p: ProductoCatalogo): string {
  const precio = precioReferencia(p);
  return [p.ref_proveedor ? `Ref. ${p.ref_proveedor}` : null, p.formato, precio != null ? formatoEuros(precio) : null]
    .filter(Boolean)
    .join(" · ");
}

export default function RevisionLineas({
  lineas,
  onLineas,
  meta,
  onMeta,
  proveedores,
  centroId,
  catalogo,
  hoy,
  fechaDicha,
  notasDichas,
  desactivado,
}: PropsRevisionLineas) {
  const rev = useMemo(() => agruparRevision(lineas, proveedores), [lineas, proveedores]);
  const porId = useMemo(() => new Map(proveedores.map((p) => [p.id, p])), [proveedores]);
  /** Clave de la línea con el buscador abierto, o "nueva" para «Añadir un producto». */
  const [buscandoEn, setBuscandoEn] = useState<string | null>(null);
  const [notasAbiertas, setNotasAbiertas] = useState<Set<string>>(() => new Set());

  // Si la línea con el buscador abierto desaparece, se cierra.
  useEffect(() => {
    if (buscandoEn && buscandoEn !== "nueva" && !lineas.some((l) => l.clave === buscandoEn)) setBuscandoEn(null);
  }, [lineas, buscandoEn]);

  const cambiar = (clave: string, f: (l: LineaRevision) => LineaRevision) =>
    onLineas(lineas.map((l) => (l.clave === clave ? f(l) : l)));
  const quitar = (clave: string) => onLineas(lineas.filter((l) => l.clave !== clave));
  const elegir = (clave: string, p: ProductoCatalogo) => {
    cambiar(clave, (l) => conProducto(l, p));
    setBuscandoEn(null);
  };
  const anadir = (p: ProductoCatalogo) => {
    onLineas([...lineas, lineaDesdeProducto(p, 1)]);
    setBuscandoEn(null);
  };

  const metaDe = (clave: string, p: ProveedorPedido | null): MetaGrupo =>
    Object.prototype.hasOwnProperty.call(meta, clave) ? meta[clave] : metaPorDefecto(p, fechaDicha, undefined, notasDichas);

  // Proveedores que solo tienen líneas sin identificar: también necesitan fecha y nota.
  const gruposSoloSin = useMemo(() => {
    const conLineas = new Set(rev.grupos.map((g) => g.clave));
    const ids: string[] = [];
    for (const l of rev.sin_identificar) {
      if (l.proveedor_id && !conLineas.has(l.proveedor_id) && !ids.includes(l.proveedor_id)) ids.push(l.proveedor_id);
    }
    return ids;
  }, [rev]);

  const buscador = (clave: string, proveedorId?: string | null) => (
    <div className="ped-linea-buscador">
      <BuscadorProducto
        centroId={centroId}
        proveedorId={proveedorId ?? null}
        catalogo={catalogo}
        onElegir={(p) => (clave === "nueva" ? anadir(p) : elegir(clave, p))}
        onCerrar={() => setBuscandoEn(null)}
        autoFocus
      />
    </div>
  );

  const alternativas = (l: LineaRevision, rotulo: string) =>
    l.alternativas.length ? (
      <div className="ped-alternativas">
        <span className="ped-alternativas-rotulo">{rotulo}</span>
        {l.alternativas.map((a) => (
          <button key={a.producto_id} type="button" className="ped-alternativa" onClick={() => elegir(l.clave, a)}>
            {a.nombre}
            {a.formato ? <small> · {a.formato}</small> : null}
          </button>
        ))}
      </div>
    ) : null;

  const cabeceraGrupo = (clave: string, p: ProveedorPedido | null, nombre: string, total: number | null, soloSin: number) => {
    const m = metaDe(clave, p);
    const dias = p?.pedido_dias_reparto ?? [];
    const corte = horaCorta(p?.pedido_hora_corte);
    const fecha = m.fecha_entrega;
    const pasada = !!fecha && fecha < hoy;
    const noReparte = !!fecha && !pasada && dias.length > 0 && !dias.includes(isoDiaSemana(fecha));
    const min = soloSin ? null : estadoMinimo(p, total);
    const notaAbierta = notasAbiertas.has(clave) || !!m.notas;
    return (
      <>
        <header className="ped-grupo-cabeza">
          <h3 className="ped-grupo-nombre">{nombre}</h3>
          {p ? (
            <p className="ped-grupo-dias">
              Reparte {textoDiasReparto(dias).toLowerCase()}
              {corte ? ` · pedir antes de las ${corte}` : ""}
            </p>
          ) : null}
        </header>
        <div className="ped-grupo-meta">
          <label className="ped-campo-fecha">
            <span>Entrega</span>
            <input
              type="date"
              value={fecha ?? ""}
              min={hoy}
              onChange={(e) => onMeta(clave, { ...m, fecha_entrega: e.target.value || null })}
            />
            <span className="ped-fecha-relativa">{formatoFechaRelativa(fecha, hoy)}</span>
          </label>
          {pasada ? <p className="ped-aviso ped-aviso--error">Esa fecha ya ha pasado.</p> : null}
          {noReparte ? (
            <p className="ped-aviso">Ese día no reparte (reparte {textoDiasReparto(dias)}).</p>
          ) : null}
          {notaAbierta ? (
            <label className="ped-campo-nota">
              <span>Nota para el proveedor</span>
              <input
                type="text"
                value={m.notas}
                maxLength={1000}
                placeholder="Ej.: entregar antes de las 10"
                onChange={(e) => onMeta(clave, { ...m, notas: e.target.value })}
              />
            </label>
          ) : (
            <button
              type="button"
              className="ped-boton-texto"
              onClick={() => setNotasAbiertas((s) => new Set(s).add(clave))}
            >
              ＋ Nota para el proveedor
            </button>
          )}
        </div>
        {soloSin ? (
          <p className="ped-grupo-solo-sin">
            {soloSin === 1 ? "1 línea sin identificar irá" : `${soloSin} líneas sin identificar irán`} en este pedido.
          </p>
        ) : null}
        {min && !min.cumple ? (
          <p className="ped-aviso">
            Pedido mínimo {formatoEuros(min.minimo)}:{" "}
            {min.total == null ? "no hay precios para calcular el total" : `llevas ${formatoEuros(min.total)}`}
          </p>
        ) : null}
      </>
    );
  };

  return (
    <fieldset className="ped-fieldset ped-revision" disabled={desactivado}>
      <legend className="ped-sr">Revisión del pedido</legend>

      {rev.sin_identificar.length ? (
        <section className="ped-grupo ped-grupo--sin" aria-label="Sin identificar">
          <header className="ped-grupo-cabeza">
            <h3 className="ped-grupo-nombre">Sin identificar ({rev.sin_identificar.length})</h3>
            <p className="ped-grupo-dias">Elige el producto o se pedirán con su descripción.</p>
          </header>
          <ul className="ped-lineas">
            {rev.sin_identificar.map((l) => {
              const dicho = l.texto_original ?? l.descripcion ?? "";
              const nombre = l.descripcion ?? l.texto_original ?? "línea";
              return (
                <li key={l.clave} className="ped-linea ped-linea--sin">
                  <div className="ped-linea-cabeza">
                    <p className="ped-linea-dicho-grande">«{dicho}»</p>
                    <button type="button" className="ped-quitar" onClick={() => quitar(l.clave)} aria-label={`Quitar «${nombre}»`}>
                      ✕
                    </button>
                  </div>
                  {l.nota ? <p className="ped-linea-nota">{l.nota}</p> : null}
                  {alternativas(l, "¿Es alguno de estos?")}
                  <div className="ped-linea-acciones">
                    <button type="button" className="ped-boton ped-boton--principal" onClick={() => setBuscandoEn(l.clave)}>
                      Elegir producto
                    </button>
                  </div>
                  {buscandoEn === l.clave ? buscador(l.clave) : null}
                  <div className="ped-linea-controles">
                    <ControlCantidad
                      valor={l.cantidad}
                      unidad={l.unidad}
                      nombre={nombre}
                      onValor={(n) => cambiar(l.clave, (x) => ({ ...x, cantidad: n }))}
                    />
                    <SelectorUnidad valor={l.unidad} nombre={nombre} onValor={(u) => cambiar(l.clave, (x) => ({ ...x, unidad: u }))} />
                  </div>
                  <label className="ped-campo">
                    <span>Se pedirá como</span>
                    <input
                      type="text"
                      value={l.descripcion ?? ""}
                      maxLength={300}
                      placeholder={l.texto_original ?? "Descripción"}
                      onChange={(e) => cambiar(l.clave, (x) => ({ ...x, descripcion: e.target.value || null }))}
                    />
                  </label>
                  <label className="ped-campo">
                    <span>Proveedor</span>
                    <select
                      value={l.proveedor_id ?? SIN_PROVEEDOR}
                      onChange={(e) => cambiar(l.clave, (x) => ({ ...x, proveedor_id: e.target.value || null }))}
                    >
                      <option value={SIN_PROVEEDOR}>Sin proveedor (lo eliges después)</option>
                      {l.proveedor_id && !porId.has(l.proveedor_id) ? (
                        <option value={l.proveedor_id}>Proveedor actual</option>
                      ) : null}
                      {proveedores.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {rev.grupos.map((g) => {
        const nombre = g.proveedor?.nombre ?? g.lineas[0]?.producto?.proveedor_nombre ?? "Sin proveedor";
        return (
          <section key={g.clave || "sin"} className="ped-grupo" aria-label={nombre}>
            {cabeceraGrupo(g.clave, g.proveedor, nombre, g.total, 0)}
            <ul className="ped-lineas">
              {g.lineas.map((l) => {
                const p = l.producto!;
                const detalle = detalleProducto(p);
                return (
                  <li key={l.clave} className="ped-linea">
                    <div className="ped-linea-cabeza">
                      <div className="ped-linea-titulo">
                        <span className="ped-linea-nombre">{p.nombre}</span>
                        <ChipConfianza confianza={l.confianza} />
                      </div>
                      <button type="button" className="ped-quitar" onClick={() => quitar(l.clave)} aria-label={`Quitar ${p.nombre}`}>
                        ✕
                      </button>
                    </div>
                    {detalle ? <p className="ped-linea-detalle">{detalle}</p> : null}
                    {l.texto_original ? <p className="ped-linea-dicho">Dicho: «{l.texto_original}»</p> : null}
                    {l.nota ? <p className="ped-linea-nota">{l.nota}</p> : null}
                    <div className="ped-linea-controles">
                      <ControlCantidad
                        valor={l.cantidad}
                        unidad={l.unidad}
                        nombre={p.nombre}
                        onValor={(n) => cambiar(l.clave, (x) => ({ ...x, cantidad: n }))}
                      />
                      <SelectorUnidad valor={l.unidad} nombre={p.nombre} onValor={(u) => cambiar(l.clave, (x) => ({ ...x, unidad: u }))} />
                      <button
                        type="button"
                        className="ped-boton"
                        onClick={() => setBuscandoEn(buscandoEn === l.clave ? null : l.clave)}
                        aria-expanded={buscandoEn === l.clave}
                      >
                        Cambiar
                      </button>
                    </div>
                    {alternativas(l, "¿O era…?")}
                    {buscandoEn === l.clave ? buscador(l.clave) : null}
                  </li>
                );
              })}
            </ul>
            <div className="ped-grupo-pie">
              <span>Total estimado</span>
              <b>{g.total == null ? "Sin precios" : formatoEuros(g.total)}</b>
            </div>
          </section>
        );
      })}

      {gruposSoloSin.map((id) => {
        const p = porId.get(id) ?? null;
        const n = rev.sin_identificar.filter((l) => l.proveedor_id === id).length;
        return (
          <section key={id} className="ped-grupo" aria-label={p?.nombre ?? "Proveedor"}>
            {cabeceraGrupo(id, p, p?.nombre ?? "Proveedor", null, n)}
          </section>
        );
      })}

      {!lineas.length ? <p className="ped-vacio">No hay productos. Añádelos con el buscador.</p> : null}

      {buscandoEn === "nueva" ? (
        buscador("nueva")
      ) : (
        <button type="button" className="ped-boton-grande ped-boton-grande--secundario" onClick={() => setBuscandoEn("nueva")}>
          ＋ Añadir un producto
        </button>
      )}
    </fieldset>
  );
}
