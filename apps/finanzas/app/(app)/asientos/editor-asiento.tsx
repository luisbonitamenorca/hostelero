"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { aNumero, euros } from "@/lib/importes";
import type { CuentaPlan } from "@/lib/diario";
import { borrarAsiento, confirmarAsiento, guardarAsiento } from "../../acciones-diario";

export type ApunteGuardado = {
  cuenta_plan_id: string;
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

type LineaForm = { clave: string; cuentaPlanId: string; descripcion: string; debe: string; haber: string };

let contador = 0;
function lineaVacia(): LineaForm {
  contador += 1;
  return { clave: `a${contador}`, cuentaPlanId: "", descripcion: "", debe: "", haber: "" };
}

function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function EditorAsiento({
  cuentas,
  borrador,
}: {
  cuentas: CuentaPlan[];
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
    setLineas((ls) => [...ls, lineaVacia()]);
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
