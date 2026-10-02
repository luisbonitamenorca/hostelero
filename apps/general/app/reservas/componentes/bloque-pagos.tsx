"use client";

/* Bloque «Pago» del modal de reserva (docs/reservas-v2-pagos.md §5). Lo entrega la pieza de
   pagos para que el integrador solo tenga que montarlo: <BloquePagos reservaId={r.id} />.
   Enseña el estado de pago, la tarjeta registrada y el historial; a dirección le deja cobrar la
   garantía (no-show o cancelación tardía del cliente), devolver cobros y resolver operaciones
   que se quedaron sin respuesta del banco. Todo lo que mueve dinero pide confirmación. */

import "./bloque-pagos.css";
import { useCallback, useEffect, useState } from "react";
import { cobrarNoShow, darCobroPorRevisado, devolver, estadoPagos, resolverPagoIncierto, type EstadoPagos, type FilaPago } from "../acciones/pagos";

const euros = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

/** Caducidad AAMM del banco → MM/AA. */
const caducidad = (c: string | null) => (c && /^\d{4}$/.test(c) ? `${c.slice(2)}/${c.slice(0, 2)}` : c ?? "");

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Clase de chip (reservas.css) según estado_pago. */
const CHIP: Record<string, string> = {
  garantizada: "ok",
  pagada: "ok",
  pendiente_tarjeta: "sinmesa",
  cobrado_noshow: "info",
  fallido: "alerg",
  devuelto: "nota",
  no_requerido: "nota",
};

/** Lectura de un importe escrito a mano («12,50» o «12.50»). */
const leerImporte = (s: string) => {
  const n = Number(s.replace(/\s|€/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

type Confirmar =
  | { tipo: "cobrar"; importe: number }
  | { tipo: "devolver"; pago: FilaPago; importe: number }
  | { tipo: "resolver"; pago: FilaPago; hecho: boolean }
  | { tipo: "revisado"; pago: FilaPago };

export function BloquePagos({ reservaId, onCambio }: { reservaId: string; onCambio?: () => void }) {
  const [datos, setDatos] = useState<EstadoPagos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [importeCobro, setImporteCobro] = useState("");
  const [importesDev, setImportesDev] = useState<Record<string, string>>({});
  const [confirmar, setConfirmar] = useState<Confirmar | null>(null);
  const [copiado, setCopiado] = useState(false);

  const cargar = useCallback(async () => {
    const res = await estadoPagos(reservaId);
    if (!res.ok || !res.data) {
      setError(res.error ?? "No se pudo leer el pago de la reserva.");
      return;
    }
    setDatos(res.data);
    setImporteCobro(res.data.cobro_max > 0 ? String(res.data.cobro_max).replace(".", ",") : "");
  }, [reservaId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Ejecuta la acción confirmada, enseña el resultado y recarga.
  const ejecutar = async (c: Confirmar) => {
    setOcupado(true);
    setError(null);
    setOk(null);
    try {
      const res =
        c.tipo === "cobrar"
          ? await cobrarNoShow(reservaId, datos?.motivo_cargo ?? "no_show", c.importe)
          : c.tipo === "devolver"
            ? await devolver(c.pago.id, c.importe)
            : c.tipo === "resolver"
              ? await resolverPagoIncierto(c.pago.id, c.hecho)
              : await darCobroPorRevisado(c.pago.id);
      if (!res.ok) setError(res.error ?? "Operación rechazada.");
      else
        setOk(
          c.tipo === "cobrar"
            ? `Cobrados ${euros(c.importe)}.`
            : c.tipo === "devolver"
              ? `Devueltos ${euros(c.importe)}.`
              : c.tipo === "resolver"
                ? "Operación resuelta."
                : "Cobro marcado como revisado.",
        );
    } catch {
      setError("No se pudo completar la operación. Vuelve a mirar el estado antes de reintentar.");
    } finally {
      setConfirmar(null);
      setOcupado(false);
      await cargar();
      onCambio?.();
    }
  };

  const pedirCobro = () => {
    if (!datos) return;
    const imp = leerImporte(importeCobro);
    if (!(imp > 0) || imp > datos.cobro_max) {
      setError(`El importe tiene que ser mayor que cero y como mucho ${euros(datos.cobro_max)}.`);
      return;
    }
    setError(null);
    setConfirmar({ tipo: "cobrar", importe: imp });
  };

  const pedirDevolucion = (p: FilaPago) => {
    const imp = leerImporte(importesDev[p.id] ?? String(p.devolvible));
    if (!(imp > 0) || imp > p.devolvible) {
      setError(`El importe a devolver tiene que ser mayor que cero y como mucho ${euros(p.devolvible)}.`);
      return;
    }
    setError(null);
    setConfirmar({ tipo: "devolver", pago: p, importe: imp });
  };

  const copiarEnlace = async () => {
    if (!datos?.enlace_pago) return;
    try {
      await navigator.clipboard.writeText(datos.enlace_pago);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      setError("No se pudo copiar. Enlace: " + datos.enlace_pago);
    }
  };

  if (!datos) {
    return error ? (
      <section className="bp">
        <div className="aviso err">{error}</div>
      </section>
    ) : (
      <section className="bp bp-cargando" aria-busy="true">Cargando pago…</section>
    );
  }

  // Reserva sin nada que ver con pagos: el modal queda limpio.
  const conGarantia = Number(datos.importe_garantia ?? 0) > 0;
  const conPrepago = Number(datos.importe_prepago ?? 0) > 0;
  if (datos.estado_pago === "no_requerido" && !datos.pagos.length && !conGarantia && !conPrepago) return null;

  const tarjeta = datos.tarjeta?.mascara ? `•••• ${datos.tarjeta.mascara.slice(-4)}${datos.tarjeta.caducidad ? ` · ${caducidad(datos.tarjeta.caducidad)}` : ""}` : null;
  const dir = datos.es_direccion;
  const textoConfirmar = (c: Confirmar) =>
    c.tipo === "cobrar"
      ? `¿Cobrar ${euros(c.importe)} ${tarjeta ? `con la tarjeta ${tarjeta}` : "con la tarjeta registrada"} por ${datos.motivo_cargo === "cancelacion_tardia" ? "cancelación tardía" : "no-show"}?`
      : c.tipo === "devolver"
        ? `¿Devolver ${euros(c.importe)} a la tarjeta del cliente?`
        : c.tipo === "resolver"
          ? c.hecho
            ? "¿Confirmas que en el portal del TPV la operación aparece AUTORIZADA?"
            : "¿Confirmas que en el portal del TPV la operación NO aparece (o aparece denegada)?"
          : "¿Dejar este cobro como está, sin devolverlo? Dejará de salir como pendiente de revisar.";

  return (
    <section className="bp" aria-label="Pago">
      <header className="bp-cab">
        <span className="bp-tit">Pago</span>
        <span className={`chip ${CHIP[datos.estado_pago] ?? "nota"}`}>{datos.estado_pago_txt}</span>
        {tarjeta ? <span className="bp-tarjeta" title="Tarjeta registrada">{tarjeta}</span> : null}
        <span className="bp-importes">
          {conGarantia ? <span>Garantía {euros(Number(datos.importe_garantia))}</span> : null}
          {conPrepago ? <span>Prepago {euros(Number(datos.importe_prepago))}</span> : null}
        </span>
      </header>

      {datos.hay_revision ? (
        <div className="aviso err">
          Hay operaciones sin respuesta del banco. Búscalas en el portal del TPV de CaixaBank y márcalas como hechas o no hechas antes de
          reintentar.
        </div>
      ) : null}
      {datos.hay_por_devolver ? <div className="aviso info">Hay cobros que probablemente hay que devolver: mira las filas marcadas.</div> : null}

      {datos.enlace_pago ? (
        <div className="bp-enlace">
          <span>Pendiente de que el cliente {conPrepago ? "pague" : "registre la tarjeta"}.</span>
          <button type="button" className="btn mini fantasma" onClick={copiarEnlace}>
            {copiado ? "Copiado" : "Copiar enlace de pago"}
          </button>
        </div>
      ) : null}

      {datos.pagos.length ? (
        <ul className="bp-lista">
          {datos.pagos.map((p) => (
            <li key={p.id} className={`bp-fila${p.revisar ? " revisar" : ""}${p.aviso ? " aviso-fila" : ""}`}>
              <div className="bp-linea">
                <span className="bp-fecha">{fechaCorta(p.creado_en)}</span>
                <span className="bp-tipo">{p.tipo_txt}</span>
                <span className="bp-imp">{Number(p.importe) > 0 ? euros(Number(p.importe)) : "0 €"}</span>
                <span className={`bp-estado e-${p.revisar ? "revisar" : p.estado}`}>{p.estado_txt}</span>
              </div>
              {p.aviso ? <div className="bp-nota">{p.aviso}</div> : null}
              {dir && p.revisar ? (
                <div className="bp-acc">
                  <span className="bp-ayuda">¿Aparece autorizada en el portal del TPV?</span>
                  <button type="button" className="btn mini sec" disabled={ocupado} onClick={() => setConfirmar({ tipo: "resolver", pago: p, hecho: true })}>
                    {p.tipo === "devolucion" ? "Sí se devolvió" : "Sí se cobró"}
                  </button>
                  <button type="button" className="btn mini fantasma" disabled={ocupado} onClick={() => setConfirmar({ tipo: "resolver", pago: p, hecho: false })}>
                    {p.tipo === "devolucion" ? "No se devolvió" : "No se cobró"}
                  </button>
                </div>
              ) : null}
              {dir && p.devolvible > 0 ? (
                <div className="bp-acc">
                  <label className="bp-campo">
                    <span>Devolver</span>
                    <input
                      inputMode="decimal"
                      value={importesDev[p.id] ?? String(p.devolvible).replace(".", ",")}
                      onChange={(e) => setImportesDev((m) => ({ ...m, [p.id]: e.target.value }))}
                      aria-label="Importe a devolver"
                    />
                    <em>€ de {euros(p.devolvible)}</em>
                  </label>
                  <button type="button" className="btn mini sec" disabled={ocupado} onClick={() => pedirDevolucion(p)}>
                    Devolver
                  </button>
                  {p.aviso ? (
                    <button type="button" className="btn mini fantasma" disabled={ocupado} onClick={() => setConfirmar({ tipo: "revisado", pago: p })}>
                      No devolver
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="bp-vacio">Sin operaciones todavía.</p>
      )}

      {dir && conGarantia ? (
        <div className="bp-cobro">
          <label className="bp-campo">
            <span>Cobrar garantía</span>
            <input
              inputMode="decimal"
              value={importeCobro}
              onChange={(e) => setImporteCobro(e.target.value)}
              disabled={!datos.puede_cobrar || ocupado}
              aria-label="Importe a cobrar"
            />
            <em>€ (máx. {euros(datos.cobro_max)})</em>
          </label>
          <button
            type="button"
            className="btn mini peligro"
            disabled={!datos.puede_cobrar || ocupado}
            title={datos.motivo_no_cobrar ?? undefined}
            onClick={pedirCobro}
          >
            Cobrar garantía
          </button>
          {!datos.puede_cobrar && datos.motivo_no_cobrar ? <p className="bp-ayuda bloque">{datos.motivo_no_cobrar}</p> : null}
        </div>
      ) : null}

      {confirmar ? (
        <div className="bp-confirmar" role="alertdialog" aria-live="assertive">
          <p>{textoConfirmar(confirmar)}</p>
          <div className="bp-acc">
            <button type="button" className="btn mini fantasma" disabled={ocupado} onClick={() => setConfirmar(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className={`btn mini ${confirmar.tipo === "cobrar" ? "peligro" : ""}`}
              disabled={ocupado}
              onClick={() => void ejecutar(confirmar)}
            >
              {ocupado ? "Un momento…" : confirmar.tipo === "cobrar" ? "Sí, cobrar" : confirmar.tipo === "devolver" ? "Sí, devolver" : "Sí"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="aviso err">{error}</div> : null}
      {ok ? <div className="aviso ok">{ok}</div> : null}
    </section>
  );
}
