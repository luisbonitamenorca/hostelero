"use client";

/* Cotejo pedido ↔ albarán ↔ factura (constructor C). Pinta el jsonb de pedidos_cotejar():
   avisos arriba, resumen, tabla por línea con el estado coloreado (ok verde, cantidad/precio
   ámbar, falta coral, sustituido gris, sin dato tenue), notas debajo de cada línea, «no pedido»
   (sobras) y diferencias de precio con importes. OJO: los campos opcionales llegan AUSENTES (la
   función hace jsonb_strip_nulls), nunca null. Estilos en ../secciones/ficha.css (prefijo pedf-). */

import { formatoCantidad, formatoEuros, formatoFecha, formatoMomento, formatoNumero, redondear } from "../lib-pedidos";
import { ESTADO_COTEJO_LINEA_TXT } from "../tipos";
import type { CotejoDiferenciaPrecio, CotejoLado, CotejoLinea, LineaPedido, PropsTablaCotejo } from "../tipos";
import "../secciones/ficha.css";

const COMPARACION_TXT: Record<CotejoDiferenciaPrecio["comparacion"], string> = {
  pedido_albaran: "Pedido → albarán",
  pedido_factura: "Pedido → factura",
  albaran_factura: "Albarán → factura",
};

const CASADO_TXT: Record<NonNullable<CotejoLado["casado_por"]>, string> = {
  producto: "mismo producto",
  referencia: "por código",
  nombre: "por nombre",
};

const igual = (a: number | undefined, b: number | undefined) => a != null && b != null && redondear(a) === redondear(b);

function Lado({
  lado,
  titulo,
  difCantidad,
  difPrecio,
  ausente,
}: {
  lado: CotejoLado | undefined;
  titulo: string;
  difCantidad: boolean;
  difPrecio: boolean;
  ausente: string;
}) {
  if (!lado || (lado.cantidad == null && lado.precio == null)) {
    return (
      <td data-th={titulo} className="pedf-c-lado pedf-c-vacio">
        {ausente}
      </td>
    );
  }
  return (
    <td data-th={titulo} className="pedf-c-lado">
      <span className={`pedf-cant${difCantidad ? " pedf-dif" : ""}`}>{lado.cantidad != null ? formatoNumero(lado.cantidad) : "¿?"}</span>
      {lado.precio != null ? (
        <span className={`pedf-precio${difPrecio ? " pedf-dif-precio" : ""}`}>{formatoEuros(lado.precio)}/u</span>
      ) : null}
      {lado.importe != null ? <span className="pedf-importe">{formatoEuros(lado.importe)}</span> : null}
      {lado.casado_por && lado.casado_por !== "producto" ? (
        <span className="pedf-casado">{CASADO_TXT[lado.casado_por]}</span>
      ) : null}
    </td>
  );
}

export default function TablaCotejo({ cotejo, lineas, editable, onSustituido, ocupado }: PropsTablaCotejo) {
  const porId = new Map<string, LineaPedido>(lineas.map((l) => [l.id, l]));
  const r = cotejo.resumen ?? { n_lineas: 0 };
  const filas: CotejoLinea[] = cotejo.lineas ?? [];
  const sobras = cotejo.sobras ?? [];
  const difs = cotejo.diferencias_precio ?? [];
  const avisos = cotejo.avisos ?? [];
  const alb = cotejo.documentos?.albaran;
  const fac = cotejo.documentos?.factura;
  const conAlbaran = !!alb;
  const conFactura = !!fac;

  const difPrecio = new Set(difs.map((d) => `${d.linea_id}|${d.comparacion === "pedido_albaran" ? "a" : "f"}`));

  const n = (x: number | undefined) => x ?? 0;
  const resumen: { clase: string; txt: string }[] = [];
  if (n(r.n_ok)) resumen.push({ clase: "ok", txt: `${r.n_ok} ${r.n_ok === 1 ? "correcta" : "correctas"}` });
  if (n(r.n_faltas)) resumen.push({ clase: "falta", txt: `${r.n_faltas} ${r.n_faltas === 1 ? "falta" : "faltan"}` });
  if (n(r.n_cantidad)) resumen.push({ clase: "cantidad", txt: `${r.n_cantidad} con otra cantidad` });
  if (n(r.n_precio)) resumen.push({ clase: "precio", txt: `${r.n_precio} con otro precio` });
  if (n(r.n_sustituidos)) resumen.push({ clase: "sustituido", txt: `${r.n_sustituidos} ${r.n_sustituidos === 1 ? "sustituido" : "sustituidos"}` });
  if (n(r.n_sin_dato)) resumen.push({ clase: "sin_dato", txt: `${r.n_sin_dato} sin dato` });
  const nSobras = n(r.n_sobras) + n(r.n_sobras_factura);
  if (nSobras) resumen.push({ clase: "sobra", txt: `${nSobras} no ${nSobras === 1 ? "pedido" : "pedidos"}` });

  const sinComparacion = !cotejo.referencia;

  return (
    <div className="pedf-cotejo">
      {avisos.length || n(r.n_unidad_desconocida) > 0 ? (
        <ul className="pedf-avisos">
          {avisos.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
          {n(r.n_unidad_desconocida) > 0 ? (
            <li>Algunas diferencias pueden ser de unidades: define la unidad del producto en Compras.</li>
          ) : null}
        </ul>
      ) : null}

      {cotejo.motivo ? <p className="pedf-motivo">{cotejo.motivo}</p> : null}

      {(alb || fac) && !sinComparacion ? (
        <p className="pedf-referencia">
          Comparado producto a producto con {cotejo.referencia === "albaran" ? "el albarán" : "la factura"}
          {cotejo.referencia === "albaran" && alb?.num ? ` nº ${alb.num}` : ""}
          {cotejo.referencia === "factura" && fac?.num ? ` nº ${fac.num}` : ""}
          {cotejo.referencia === "albaran" && alb?.fecha ? ` (${formatoFecha(alb.fecha)})` : ""}
          {cotejo.referencia === "factura" && fac?.fecha ? ` (${formatoFecha(fac.fecha)})` : ""}.
          {fac && alb ? (
            fac.incluye_albaran === true ? (
              <> La factura recoge este albarán{fac.cuadra_importe === false ? ", pero con otro importe" : ""}.</>
            ) : fac.incluye_albaran === false ? (
              <> La factura no recoge este albarán.</>
            ) : null
          ) : null}
        </p>
      ) : null}

      {resumen.length ? (
        <div className="pedf-resumen">
          {resumen.map((x) => (
            <span key={x.clase} className={`pedf-res pedf-res--${x.clase}`}>
              {x.txt}
            </span>
          ))}
        </div>
      ) : null}

      {r.importe_pedido != null || r.importe_albaran != null || r.importe_factura != null ? (
        <dl className="pedf-importes">
          <div>
            <dt>Pedido</dt>
            <dd>{formatoEuros(r.importe_pedido)}</dd>
          </div>
          {conAlbaran ? (
            <div>
              <dt>Albarán</dt>
              <dd>{formatoEuros(r.importe_albaran)}</dd>
            </div>
          ) : null}
          {conFactura ? (
            <div>
              <dt>Factura{fac?.base != null ? " (base)" : ""}</dt>
              <dd>{formatoEuros(r.importe_factura)}</dd>
            </div>
          ) : null}
          {n(r.n_diferencias_precio) > 0 ? (
            <div className={n(r.importe_diferencias_precio) > 0 ? "pedf-imp-mal" : "pedf-imp-bien"}>
              <dt>Diferencia de precios</dt>
              <dd>
                {n(r.importe_diferencias_precio) > 0 ? "+" : ""}
                {formatoEuros(r.importe_diferencias_precio)}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {filas.length ? (
        <div className="pedf-tabla-caja">
          <table className="pedf-tabla">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Pedido</th>
                {conAlbaran ? <th>Albarán</th> : null}
                {conFactura ? <th>Factura</th> : null}
                <th>Estado</th>
              </tr>
            </thead>
            {filas.map((c) => {
              const l = porId.get(c.linea_id);
              const nombre = c.nombre || l?.producto?.nombre || l?.descripcion || l?.texto_original || "(sin nombre)";
              const ref = l?.producto?.ref_proveedor ?? null;
              const cantPedido = c.agrupada?.cantidad_total ?? c.pedido.cantidad;
              const esCantidad = c.estado === "cantidad";
              const difAlb = esCantidad && c.albaran?.cantidad != null && !igual(c.albaran.cantidad, cantPedido);
              const difFac =
                esCantidad &&
                c.factura?.cantidad != null &&
                !igual(c.factura.cantidad, c.albaran?.cantidad != null ? c.albaran.cantidad : cantPedido);
              const ausenteAlb = cotejo.referencia === "albaran" && c.estado === "falta" ? "No viene" : "—";
              const ausenteFac =
                cotejo.referencia === "factura" && c.estado === "falta"
                  ? "No viene"
                  : alb && fac && fac.tiene_lineas && c.albaran
                    ? "No facturado"
                    : "—";
              const puedeMarcar = editable && !!onSustituido && (c.estado === "falta" || c.estado === "sustituido");
              const notas = c.notas ?? [];
              return (
                <tbody key={c.linea_id} className={`pedf-fila pedf-fila--${c.estado}`}>
                  <tr>
                    <td data-th="Producto" className="pedf-c-producto">
                      <span className="pedf-nombre">{nombre}</span>
                      {ref ? <span className="pedf-ref">{ref}</span> : null}
                    </td>
                    <td data-th="Pedido" className="pedf-c-lado">
                      <span className="pedf-cant">{formatoCantidad(c.pedido.cantidad, c.pedido.unidad ?? l?.unidad ?? null)}</span>
                      {c.pedido.precio != null ? <span className="pedf-precio">{formatoEuros(c.pedido.precio)}/u</span> : null}
                      {c.agrupada?.principal && c.agrupada.n_lineas > 1 ? (
                        <span className="pedf-casado">
                          en {c.agrupada.n_lineas} líneas: {formatoNumero(c.agrupada.cantidad_total)}
                        </span>
                      ) : null}
                    </td>
                    {conAlbaran ? (
                      <Lado
                        lado={c.albaran}
                        titulo="Albarán"
                        difCantidad={difAlb}
                        difPrecio={difPrecio.has(`${c.linea_id}|a`)}
                        ausente={ausenteAlb}
                      />
                    ) : null}
                    {conFactura ? (
                      <Lado
                        lado={c.factura}
                        titulo="Factura"
                        difCantidad={difFac}
                        difPrecio={difPrecio.has(`${c.linea_id}|f`)}
                        ausente={ausenteFac}
                      />
                    ) : null}
                    <td data-th="Estado" className="pedf-c-estado">
                      <span className={`pedf-estado pedf-estado--${c.estado}`}>{ESTADO_COTEJO_LINEA_TXT[c.estado]}</span>
                      {puedeMarcar ? (
                        <button
                          type="button"
                          className={`pedf-sust${c.estado === "sustituido" ? " pedf-sust--on" : ""}`}
                          aria-pressed={c.estado === "sustituido"}
                          disabled={ocupado}
                          onClick={() => onSustituido!(c.linea_id, c.estado !== "sustituido")}
                        >
                          {c.estado === "sustituido" ? "Quitar «sustituido»" : "Lo trajeron cambiado"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {notas.length ? (
                    <tr className="pedf-notas-fila">
                      <td colSpan={3 + (conAlbaran ? 1 : 0) + (conFactura ? 1 : 0)}>
                        <ul className="pedf-notas">
                          {notas.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              );
            })}
          </table>
        </div>
      ) : null}

      {sobras.length ? (
        <div className="pedf-bloque-cotejo">
          <h4 className="pedf-h4">
            No pedido{" "}
            <span className="pedf-h4-detalle">
              viene en el documento y no en el pedido
              {n(r.importe_sobras) + n(r.importe_sobras_factura) ? ` · ${formatoEuros(n(r.importe_sobras) + n(r.importe_sobras_factura))}` : ""}
            </span>
          </h4>
          <ul className="pedf-sobras">
            {sobras.map((s) => (
              <li key={`${s.doc}-${s.linea_id}`}>
                <span className="pedf-sobra-nombre">
                  {s.producto || "(sin nombre)"}
                  {s.ref ? <span className="pedf-ref"> {s.ref}</span> : null}
                </span>
                <span className="pedf-sobra-datos">
                  {s.doc === "albaran" ? "Albarán" : "Factura"}
                  {s.cantidad != null ? ` · ${formatoNumero(s.cantidad)}` : ""}
                  {s.precio_unit != null ? ` × ${formatoEuros(s.precio_unit)}` : ""}
                  {s.importe != null ? ` = ${formatoEuros(s.importe)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {difs.length ? (
        <div className="pedf-bloque-cotejo">
          <h4 className="pedf-h4">Diferencias de precio</h4>
          <ul className="pedf-difs">
            {difs.map((d, i) => (
              <li key={`${d.linea_id}-${d.comparacion}-${i}`}>
                <span className="pedf-sobra-nombre">{d.nombre || porId.get(d.linea_id)?.producto?.nombre || "(sin nombre)"}</span>
                <span className="pedf-sobra-datos">
                  {COMPARACION_TXT[d.comparacion]}: {formatoEuros(d.precio_esperado)} → {formatoEuros(d.precio_documento)} (
                  {d.diferencia_pct > 0 ? "+" : ""}
                  {formatoNumero(d.diferencia_pct)} %)
                </span>
                <span className={`pedf-dif-imp ${d.importe > 0 ? "pedf-imp-mal" : "pedf-imp-bien"}`}>
                  {d.importe > 0 ? "+" : ""}
                  {formatoEuros(d.importe)}
                  <small>{d.importe > 0 ? " pagamos de más" : d.importe < 0 ? " pagamos de menos" : ""}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="pedf-cotejado">Cotejado {formatoMomento(cotejo.cotejado_en)}</p>
    </div>
  );
}
