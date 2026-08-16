"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { aNumero, calcularLinea, calcularTotales, euros, numero } from "@/lib/importes";
import { TIPOS_IVA } from "@/lib/constantes";
import { borrarBorrador, guardarBorrador, guardarYExpedir } from "../../acciones";

export type SerieBreve = { id: string; codigo: string; ejercicio: number; tipo_defecto: string; activa: boolean };
export type ClienteBreve = { id: string; nombre_fiscal: string; nif: string | null; tipo_iva_defecto: number; retencion_pct: number };
export type CentroBreve = { id: string; nombre: string };

export type LineaGuardada = {
  concepto: string;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  tipo_iva: number;
  tipo_retencion: number;
};

export type BorradorExistente = {
  id: string;
  serie_id: string;
  tipo: string;
  cliente_id: string | null;
  centro_id: string | null;
  fecha_operacion: string | null;
  descripcion_operacion: string | null;
  notas_internas: string | null;
  lineas: LineaGuardada[];
};

type LineaForm = {
  clave: string;
  concepto: string;
  cantidad: string;
  precio_unitario: string;
  descuento_pct: string;
  tipo_iva: string;
  tipo_retencion: string;
};

let contador = 0;
function lineaVacia(tipo_iva = "21", tipo_retencion = "0"): LineaForm {
  contador += 1;
  return {
    clave: `l${contador}`,
    concepto: "",
    cantidad: "1",
    precio_unitario: "",
    descuento_pct: "0",
    tipo_iva,
    tipo_retencion,
  };
}

function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function EditorFactura({
  series,
  clientes,
  centros,
  serieDefecto,
  borrador,
}: {
  series: SerieBreve[];
  clientes: ClienteBreve[];
  centros: CentroBreve[];
  serieDefecto: string | null;
  borrador?: BorradorExistente;
}) {
  const router = useRouter();
  const esNueva = !borrador;
  const activas = series.filter((s) => s.activa);

  const [serieId, setSerieId] = useState(
    borrador?.serie_id ??
      (activas.find((s) => s.id === serieDefecto)?.id ?? activas[0]?.id ?? ""),
  );
  const [tipo, setTipo] = useState(
    borrador?.tipo ?? activas.find((s) => s.id === serieDefecto)?.tipo_defecto ?? "F1",
  );
  const [clienteId, setClienteId] = useState(borrador?.cliente_id ?? "");
  const [centroId, setCentroId] = useState(borrador?.centro_id ?? "");
  const [fechaOperacion, setFechaOperacion] = useState(borrador?.fecha_operacion ?? hoy());
  const [descripcion, setDescripcion] = useState(borrador?.descripcion_operacion ?? "");
  const [notas, setNotas] = useState(borrador?.notas_internas ?? "");
  const [lineas, setLineas] = useState<LineaForm[]>(() => {
    if (!borrador || borrador.lineas.length === 0) return [lineaVacia()];
    return borrador.lineas.map((l) => {
      contador += 1;
      return {
        clave: `l${contador}`,
        concepto: l.concepto,
        cantidad: numero(Number(l.cantidad), 3),
        precio_unitario: numero(Number(l.precio_unitario), 4),
        descuento_pct: numero(Number(l.descuento_pct)),
        tipo_iva: String(Number(l.tipo_iva)),
        tipo_retencion: String(Number(l.tipo_retencion)),
      };
    });
  });

  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const [borrando, iniciarBorrado] = useTransition();
  const [expidiendo, iniciarExpedicion] = useTransition();

  const lineasBrutas = useMemo(
    () =>
      lineas.map((l) => ({
        cantidad: aNumero(l.cantidad) || 0,
        precio_unitario: aNumero(l.precio_unitario) || 0,
        descuento_pct: aNumero(l.descuento_pct) || 0,
        tipo_iva: aNumero(l.tipo_iva) || 0,
        tipo_retencion: aNumero(l.tipo_retencion) || 0,
      })),
    [lineas],
  );

  const totales = useMemo(() => calcularTotales(lineasBrutas), [lineasBrutas]);

  function cambiarLinea(clave: string, campo: keyof LineaForm, valor: string) {
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, [campo]: valor } : l)));
  }

  function anadirLinea() {
    const ultima = lineas[lineas.length - 1];
    setLineas((ls) => [...ls, lineaVacia(ultima?.tipo_iva ?? "21", ultima?.tipo_retencion ?? "0")]);
  }

  function quitarLinea(clave: string) {
    setLineas((ls) => (ls.length === 1 ? [lineaVacia()] : ls.filter((l) => l.clave !== clave)));
  }

  /** Al elegir cliente se heredan sus condiciones en las líneas aún vacías. */
  function elegirCliente(id: string) {
    setClienteId(id);
    const c = clientes.find((x) => x.id === id);
    if (!c) return;
    setLineas((ls) =>
      ls.map((l) =>
        l.concepto.trim() === "" && !aNumero(l.precio_unitario)
          ? { ...l, tipo_iva: String(Number(c.tipo_iva_defecto)), tipo_retencion: String(Number(c.retencion_pct)) }
          : l,
      ),
    );
  }

  function guardar() {
    setError(null);
    iniciar(async () => {
      const resultado = await guardarBorrador(datosActuales());

      if (resultado?.error) {
        setError(resultado.error);
        return;
      }
      router.push("/facturas");
      router.refresh();
    });
  }

  function datosActuales() {
    return {
      id: borrador?.id,
      serie_id: serieId,
      tipo,
      cliente_id: clienteId || null,
      centro_id: centroId || null,
      fecha_operacion: fechaOperacion || null,
      descripcion_operacion: descripcion.trim() || null,
      notas_internas: notas.trim() || null,
      lineas: lineas.map((l, i) => ({
        concepto: l.concepto,
        cantidad: lineasBrutas[i].cantidad,
        precio_unitario: lineasBrutas[i].precio_unitario,
        descuento_pct: lineasBrutas[i].descuento_pct,
        tipo_iva: lineasBrutas[i].tipo_iva,
        tipo_retencion: lineasBrutas[i].tipo_retencion,
      })),
    };
  }

  function expedir() {
    setError(null);

    const serie = series.find((s) => s.id === serieId);
    const cliente = clientes.find((c) => c.id === clienteId);

    const aviso = [
      "EXPEDIR ES IRREVERSIBLE.",
      "",
      `Serie ${serie ? `${serie.codigo}-${serie.ejercicio}` : "?"} · ${euros(totales.total)}`,
      `Cliente: ${cliente?.nombre_fiscal ?? "(sin cliente)"}`,
      "",
      "Se asigna número, se congela el contenido y se genera el registro Verifactu",
      "encadenado. A partir de ahí la factura no se edita ni se borra: solo se",
      "anula o se rectifica.",
      "",
      "Solo facturas de PRUEBA hasta que se valide contra el entorno de la AEAT.",
      "",
      "¿Expedir?",
    ].join("\n");

    if (!confirm(aviso)) return;

    iniciarExpedicion(async () => {
      const resultado = await guardarYExpedir(datosActuales());
      if (resultado?.error) {
        setError(resultado.error);
        return;
      }
      router.push(`/facturas/${resultado.id}`);
      router.refresh();
    });
  }

  function borrar() {
    if (!borrador) return;
    if (!confirm("¿Borrar este borrador? Solo se pueden borrar borradores; una factura expedida jamás.")) return;
    setError(null);
    iniciarBorrado(async () => {
      const resultado = await borrarBorrador(borrador.id);
      if (resultado?.error) {
        setError(resultado.error);
        return;
      }
      router.push("/facturas");
      router.refresh();
    });
  }

  const faltaCliente = tipo !== "F2" && !clienteId;
  const sinLineas = totales.base_total === 0;

  return (
    <>
      <fieldset className="bloque">
        <legend>Cabecera</legend>
        <div className="rejilla">
          <label className="campo">
            <span>Serie *</span>
            <select
              className="dato"
              value={serieId}
              onChange={(e) => {
                setSerieId(e.target.value);
                const s = series.find((x) => x.id === e.target.value);
                if (s && esNueva) setTipo(s.tipo_defecto);
              }}
            >
              <option value="">—</option>
              {activas.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo}-{s.ejercicio}
                </option>
              ))}
            </select>
            {activas.length === 0 && (
              <em className="error-campo">
                No hay ninguna serie activa. <Link className="enlace" href="/series">Crea una</Link>.
              </em>
            )}
          </label>
          <label className="campo">
            <span>Tipo</span>
            <select className="dato" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="F1">F1 · completa</option>
              <option value="F2">F2 · simplificada</option>
            </select>
            <em className="pista">Las rectificativas (R1–R5) llegan con la expedición.</em>
          </label>
          <label className="campo">
            <span>Fecha de operación</span>
            <input className="dato" type="date" value={fechaOperacion} onChange={(e) => setFechaOperacion(e.target.value)} />
          </label>
          <label className="campo">
            <span>Centro</span>
            <select className="dato" value={centroId} onChange={(e) => setCentroId(e.target.value)}>
              <option value="">—</option>
              {centros.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="campo ancho-2">
            <span>Cliente {tipo === "F2" ? "(opcional en simplificada)" : "*"}</span>
            <select value={clienteId} onChange={(e) => elegirCliente(e.target.value)}>
              <option value="">—</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre_fiscal}
                  {c.nif ? ` · ${c.nif}` : ""}
                </option>
              ))}
            </select>
            {clientes.length === 0 && (
              <em className="pista">
                No hay clientes activos. <Link className="enlace" href="/clientes/nuevo">Crea uno</Link>.
              </em>
            )}
          </label>
          <label className="campo ancho-2">
            <span>Descripción de la operación</span>
            <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset className="bloque">
        <legend>Líneas</legend>
        <div className="tabla-envoltura">
          <table className="tabla tabla-lineas">
            <thead>
              <tr>
                <th className="col-concepto">Concepto</th>
                <th className="a-derecha">Cantidad</th>
                <th className="a-derecha">Precio</th>
                <th className="a-derecha">Dto %</th>
                <th className="a-derecha">IVA</th>
                <th className="a-derecha">Ret. %</th>
                <th className="a-derecha">Base</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={l.clave}>
                  <td>
                    <input
                      className="celda"
                      value={l.concepto}
                      onChange={(e) => cambiarLinea(l.clave, "concepto", e.target.value)}
                      placeholder="Concepto"
                      aria-label={`Concepto de la línea ${i + 1}`}
                    />
                  </td>
                  <td>
                    <input
                      className="celda dato a-derecha"
                      value={l.cantidad}
                      onChange={(e) => cambiarLinea(l.clave, "cantidad", e.target.value)}
                      inputMode="decimal"
                      aria-label={`Cantidad de la línea ${i + 1}`}
                    />
                  </td>
                  <td>
                    <input
                      className="celda dato a-derecha"
                      value={l.precio_unitario}
                      onChange={(e) => cambiarLinea(l.clave, "precio_unitario", e.target.value)}
                      inputMode="decimal"
                      placeholder="0,00"
                      aria-label={`Precio de la línea ${i + 1}`}
                    />
                  </td>
                  <td>
                    <input
                      className="celda dato a-derecha"
                      value={l.descuento_pct}
                      onChange={(e) => cambiarLinea(l.clave, "descuento_pct", e.target.value)}
                      inputMode="decimal"
                      aria-label={`Descuento de la línea ${i + 1}`}
                    />
                  </td>
                  <td>
                    <select
                      className="celda dato"
                      value={l.tipo_iva}
                      onChange={(e) => cambiarLinea(l.clave, "tipo_iva", e.target.value)}
                      aria-label={`IVA de la línea ${i + 1}`}
                    >
                      {TIPOS_IVA.map((t) => (
                        <option key={t} value={String(t)}>
                          {t} %
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="celda dato a-derecha"
                      value={l.tipo_retencion}
                      onChange={(e) => cambiarLinea(l.clave, "tipo_retencion", e.target.value)}
                      inputMode="decimal"
                      aria-label={`Retención de la línea ${i + 1}`}
                    />
                  </td>
                  <td className="numero">{euros(calcularLinea(lineasBrutas[i]).base)}</td>
                  <td className="a-derecha">
                    <button
                      className="boton-enlace"
                      type="button"
                      onClick={() => quitarLinea(l.clave)}
                      aria-label={`Quitar la línea ${i + 1}`}
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="acciones" style={{ marginTop: 12 }}>
          <button className="boton-secundario" type="button" onClick={anadirLinea}>
            Añadir línea
          </button>
        </div>
      </fieldset>

      <div className="bloque totales">
        <div className="desglose">
          {totales.desglose_iva.length === 0 && <p className="texto-suave">Sin líneas todavía.</p>}
          {totales.desglose_iva.map((d) => (
            <p key={d.tipo_pct}>
              <span>
                IVA {numero(d.tipo_pct, 0)} % sobre {euros(d.base)}
              </span>
              <strong className="dato">{euros(d.cuota)}</strong>
            </p>
          ))}
          {totales.cuota_retencion > 0 && (
            <p>
              <span>Retención</span>
              <strong className="dato">−{euros(totales.cuota_retencion)}</strong>
            </p>
          )}
        </div>
        <div className="resumen">
          <p>
            <span>Base imponible</span>
            <strong className="dato">{euros(totales.base_total)}</strong>
          </p>
          <p>
            <span>Cuota de IVA</span>
            <strong className="dato">{euros(totales.cuota_iva_total)}</strong>
          </p>
          <p className="gran-total">
            <span>Total</span>
            <strong className="dato">{euros(totales.total)}</strong>
          </p>
        </div>
      </div>

      <fieldset className="bloque">
        <legend>Notas internas</legend>
        <textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="No salen en la factura." />
      </fieldset>

      {(faltaCliente || sinLineas) && (
        <p className="aviso-texto">
          Se puede guardar así, pero para expedirla faltará{" "}
          {[faltaCliente && "el cliente", sinLineas && "al menos una línea con importe"].filter(Boolean).join(" y ")}.
        </p>
      )}

      {error && <p className="error-texto">{error}</p>}

      <div className="acciones">
        <button className="boton boton-auto" type="button" onClick={guardar} disabled={pendiente || expidiendo}>
          {pendiente ? "Guardando…" : esNueva ? "Guardar borrador" : "Guardar cambios"}
        </button>
        <button
          className="boton-secundario"
          type="button"
          onClick={expedir}
          disabled={expidiendo || pendiente || faltaCliente || sinLineas || !serieId}
          title={
            faltaCliente || sinLineas
              ? "Faltan datos obligatorios para expedir"
              : "Asigna número y genera el registro Verifactu"
          }
        >
          {expidiendo ? "Expidiendo…" : "Expedir"}
        </button>
        <Link className="boton-secundario" href="/facturas">
          Cancelar
        </Link>
        {!esNueva && (
          <button className="boton-enlace peligro" type="button" onClick={borrar} disabled={borrando}>
            {borrando ? "Borrando…" : "Borrar borrador"}
          </button>
        )}
      </div>
    </>
  );
}
