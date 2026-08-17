"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { aNumero, euros } from "@/lib/importes";
import type { CentroBreve, CuentaPlan } from "@/lib/diario";
import { borrarAsiento, confirmarAsiento, guardarAsiento } from "../../acciones-diario";

export type ApunteGuardado = {
  cuenta_plan_id: string;
  centro_id: string | null;
  descripcion: string | null;
  debe: number;
  haber: number;
};

export type BorradorAsiento = {
  id: string;
  fecha: string;
  descripcion: string | null;
  apuntes: ApunteGuardado[];
};

type LineaForm = {
  clave: string;
  cuentaPlanId: string;
  centroId: string;
  descripcion: string;
  debe: string;
  haber: string;
};

let contador = 0;
function lineaVacia(centroId = ""): LineaForm {
  contador += 1;
  return { clave: `a${contador}`, cuentaPlanId: "", centroId, descripcion: "", debe: "", haber: "" };
}

/** Solo los grupos 6 y 7 llevan centro: son los que forman el resultado. Una
 *  cuenta de tesorería o de proveedores no tiene centro que valga, y ofrecerlo
 *  invita a rellenarlo por rellenar. */
function llevaCentro(codigo: string | undefined): boolean {
  return codigo?.[0] === "6" || codigo?.[0] === "7";
}

function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function EditorAsiento({
  cuentas,
  centros,
  borrador,
}: {
  cuentas: CuentaPlan[];
  centros: CentroBreve[];
  borrador?: BorradorAsiento;
}) {
  const router = useRouter();

  const [fecha, setFecha] = useState(borrador?.fecha ?? hoy());
  const [descripcion, setDescripcion] = useState(borrador?.descripcion ?? "");
  const [lineas, setLineas] = useState<LineaForm[]>(() => {
    if (!borrador || borrador.apuntes.length === 0) return [lineaVacia(), lineaVacia()];
    return borrador.apuntes.map((a) => {
      contador += 1;
      return {
        clave: `a${contador}`,
        cuentaPlanId: a.cuenta_plan_id,
        centroId: a.centro_id ?? "",
        descripcion: a.descripcion ?? "",
        debe: Number(a.debe) ? String(Number(a.debe)).replace(".", ",") : "",
        haber: Number(a.haber) ? String(Number(a.haber)).replace(".", ",") : "",
      };
    });
  });

  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  const [confirmando, iniciarConfirmacion] = useTransition();
  const [borrando, iniciarBorrado] = useTransition();

  const totales = useMemo(() => {
    const debe = lineas.reduce((s, l) => s + (aNumero(l.debe) || 0), 0);
    const haber = lineas.reduce((s, l) => s + (aNumero(l.haber) || 0), 0);
    return { debe, haber, diferencia: Math.round((debe - haber) * 100) / 100 };
  }, [lineas]);

  const cuadra = totales.diferencia === 0 && totales.debe > 0;

  const codigoPorId = useMemo(
    () => new Map(cuentas.map((c) => [c.id, c.codigo])),
    [cuentas],
  );
  const codigoDe = (id: string) => codigoPorId.get(id);

  // Solo se avisa, no se bloquea: hay asientos de resultado sin centro legítimos
  // (los de estructura), y quien contabiliza sabe mejor que el formulario.
  const sinCentro = lineas.filter(
    (l) => llevaCentro(codigoDe(l.cuentaPlanId)) && !l.centroId,
  ).length;

  function cambiar(clave: string, campo: keyof LineaForm, valor: string) {
    setLineas((ls) =>
      ls.map((l) => {
        if (l.clave !== clave) return l;
        // Un apunte va al debe o al haber. Escribir en una columna vacía la
        // otra, en vez de dejar que se guarden las dos y fallar al guardar.
        if (campo === "debe" && valor.trim() !== "") return { ...l, debe: valor, haber: "" };
        if (campo === "haber" && valor.trim() !== "") return { ...l, haber: valor, debe: "" };
        return { ...l, [campo]: valor };
      }),
    );
  }

  function anadir() {
    // Hereda el centro de la última línea que lo tenga: en un asiento de gastos
    // de un centro, lo normal es que todas las líneas de resultado sean del mismo.
    const ultimoCentro = [...lineas].reverse().find((l) => l.centroId)?.centroId ?? "";
    setLineas((ls) => [...ls, lineaVacia(ultimoCentro)]);
  }

  function quitar(clave: string) {
    setLineas((ls) => (ls.length <= 2 ? ls : ls.filter((l) => l.clave !== clave)));
  }

  /** Cuadra el asiento poniendo la diferencia en la línea que se pulse. */
  function cuadrarEn(clave: string) {
    const d = totales.diferencia;
    if (d === 0) return;
    setLineas((ls) =>
      ls.map((l) => {
        if (l.clave !== clave) return l;
        const propio = (aNumero(l.debe) || 0) - (aNumero(l.haber) || 0);
        const objetivo = Math.round((propio - d) * 100) / 100;
        return objetivo >= 0
          ? { ...l, debe: String(objetivo).replace(".", ","), haber: "" }
          : { ...l, haber: String(-objetivo).replace(".", ","), debe: "" };
      }),
    );
  }

  function datosActuales() {
    return {
      id: borrador?.id ?? null,
      fecha,
      descripcion,
      lineas: lineas.map((l) => ({
        cuentaPlanId: l.cuentaPlanId,
        // El centro solo viaja si la cuenta lo admite: si alguien elige centro y
        // luego cambia a una cuenta de balance, no se guarda un centro huérfano.
        centroId: llevaCentro(codigoDe(l.cuentaPlanId)) ? l.centroId || null : null,
        descripcion: l.descripcion.trim() || null,
        debe: aNumero(l.debe) || 0,
        haber: aNumero(l.haber) || 0,
      })),
    };
  }

  function guardar(luegoConfirmar: boolean) {
    setError(null);
    iniciar(async () => {
      const resultado = await guardarAsiento(datosActuales());
      if (resultado?.error) {
        setError(resultado.error);
        return;
      }
      if (!luegoConfirmar) {
        router.push(`/asientos/${resultado.id}`);
        router.refresh();
        return;
      }
      const confirmado = await confirmarAsiento(resultado.id!);
      if (confirmado?.error) {
        // El asiento SÍ se guardó: se avisa de dónde quedó para que no parezca
        // que se ha perdido lo escrito.
        setError(`Guardado como borrador, pero no se pudo confirmar: ${confirmado.error}`);
        router.push(`/asientos/${resultado.id}`);
        router.refresh();
        return;
      }
      router.push(`/asientos/${resultado.id}`);
      router.refresh();
    });
  }

  function confirmar() {
    if (!borrador) return;
    const aviso = [
      "CONFIRMAR UN ASIENTO ES IRREVERSIBLE.",
      "",
      `Fecha ${fecha} · ${euros(totales.debe)}`,
      "",
      "Recibe número correlativo y deja de poder editarse ni borrarse.",
      "Un error posterior se corrige con otro asiento, no tocando este.",
      "",
      "¿Confirmar?",
    ].join("\n");
    if (!confirm(aviso)) return;

    setError(null);
    iniciarConfirmacion(async () => {
      const resultado = await confirmarAsiento(borrador.id);
      if (resultado?.error) {
        setError(resultado.error);
        return;
      }
      router.refresh();
    });
  }

  function borrar() {
    if (!borrador) return;
    if (!confirm("¿Borrar este borrador? No se puede deshacer.")) return;
    setError(null);
    iniciarBorrado(async () => {
      const resultado = await borrarAsiento(borrador.id);
      if (resultado?.error) {
        setError(resultado.error);
        return;
      }
      router.push("/asientos");
      router.refresh();
    });
  }

  const ocupado = pendiente || confirmando || borrando;

  return (
    <>
      {cuentas.length === 0 && (
        <div className="estado-vacio">
          <strong>No hay cuentas contables donde imputar</strong>
          El plan actual solo tiene subcuentas de proveedor e inmovilizado. Crea las
          cuentas que necesites en <Link className="enlace" href="/plan-cuentas">Plan de cuentas</Link>.
        </div>
      )}

      <div className="formulario">
        <div className="rejilla">
          <label className="campo">
            <span>Fecha</span>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </label>
          <label className="campo ancho-2">
            <span>Concepto</span>
            <input
              type="text"
              value={descripcion}
              placeholder="Compra de género, nómina de marzo…"
              onChange={(e) => setDescripcion(e.target.value)}
            />
          </label>
        </div>

        <div className="tabla-envoltura">
          <table className="tabla tabla-lineas">
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Centro</th>
                <th>Concepto</th>
                <th className="dato">Debe</th>
                <th className="dato">Haber</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={l.clave}>
                  <td>
                    <select
                      value={l.cuentaPlanId}
                      onChange={(e) => cambiar(l.clave, "cuentaPlanId", e.target.value)}
                    >
                      <option value="">— elegir cuenta —</option>
                      {cuentas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.codigo} · {c.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {llevaCentro(codigoDe(l.cuentaPlanId)) ? (
                      <select
                        value={l.centroId}
                        onChange={(e) => cambiar(l.clave, "centroId", e.target.value)}
                      >
                        <option value="">— sin centro —</option>
                        {centros.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.nombre}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="texto-suave">—</span>
                    )}
                  </td>
                  <td>
                    <input
                      type="text"
                      value={l.descripcion}
                      placeholder="(opcional)"
                      onChange={(e) => cambiar(l.clave, "descripcion", e.target.value)}
                    />
                  </td>
                  <td className="dato">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={l.debe}
                      onChange={(e) => cambiar(l.clave, "debe", e.target.value)}
                    />
                  </td>
                  <td className="dato">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={l.haber}
                      onChange={(e) => cambiar(l.clave, "haber", e.target.value)}
                    />
                  </td>
                  <td className="acciones">
                    {totales.diferencia !== 0 && (
                      <button
                        type="button"
                        className="boton-enlace"
                        title="Poner aquí la diferencia que falta para cuadrar"
                        onClick={() => cuadrarEn(l.clave)}
                      >
                        cuadrar
                      </button>
                    )}
                    <button
                      type="button"
                      className="boton-enlace"
                      disabled={lineas.length <= 2}
                      onClick={() => quitar(l.clave)}
                    >
                      quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button type="button" className="boton-secundario boton-auto" onClick={anadir}>
          Añadir apunte
        </button>

        <div className="totales">
          <div>
            <span>Debe</span>
            <strong>{euros(totales.debe)}</strong>
          </div>
          <div>
            <span>Haber</span>
            <strong>{euros(totales.haber)}</strong>
          </div>
          <div>
            <span>Diferencia</span>
            <strong className={cuadra ? undefined : "error-texto"}>
              {euros(totales.diferencia)}
            </strong>
          </div>
        </div>

        {!cuadra && totales.debe + totales.haber > 0 && (
          <p className="pista">
            Mientras no cuadre no se puede guardar. Pulsa «cuadrar» en la línea donde
            deba ir la diferencia.
          </p>
        )}

        {sinCentro > 0 && (
          <p className="pista">
            {sinCentro === 1
              ? "Hay un apunte de resultado sin centro."
              : `Hay ${sinCentro} apuntes de resultado sin centro.`}{" "}
            No impide guardar — los gastos de estructura no llevan centro —, pero lo
            que quede sin centro no aparecerá en la PyG de ningún centro.
          </p>
        )}

        {error && <p className="error-texto">{error}</p>}

        <div className="pie-formulario">
          <button
            type="button"
            className="boton"
            disabled={ocupado || !cuadra}
            onClick={() => guardar(false)}
          >
            {pendiente ? "Guardando…" : "Guardar borrador"}
          </button>

          {borrador ? (
            <>
              <button
                type="button"
                className="boton-secundario"
                disabled={ocupado || !cuadra}
                onClick={confirmar}
              >
                {confirmando ? "Confirmando…" : "Confirmar asiento"}
              </button>
              <button type="button" className="boton-fantasma" disabled={ocupado} onClick={borrar}>
                {borrando ? "Borrando…" : "Borrar borrador"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="boton-secundario"
              disabled={ocupado || !cuadra}
              onClick={() => guardar(true)}
            >
              Guardar y confirmar
            </button>
          )}

          <Link className="boton-fantasma" href="/asientos">
            Cancelar
          </Link>
        </div>
      </div>
    </>
  );
}
