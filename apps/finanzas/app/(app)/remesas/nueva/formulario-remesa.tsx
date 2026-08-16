"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { euros, fecha as formatoFecha } from "@/lib/importes";
import { crearRemesa } from "../../../acciones-remesas";
import type { CuentaBancaria } from "@/lib/remesas";

type Fila = { id: string; sentido: "cobro" | "pago"; fecha: string; pendiente: number; quien: string };

function dentroDe(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export default function FormularioRemesa({
  cuentas,
  vencimientos,
  hayIdentificador,
}: {
  cuentas: CuentaBancaria[];
  vencimientos: Fila[];
  hayIdentificador: boolean;
}) {
  const router = useRouter();
  const [sentido, setSentido] = useState<"cobro" | "pago">("pago");
  const [bancoId, setBancoId] = useState(cuentas[0]?.id ?? "");
  const [fechaEjecucion, setFechaEjecucion] = useState(dentroDe(5));
  const [concepto, setConcepto] = useState("");
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [pendiente, iniciar] = useTransition();

  const candidatos = useMemo(() => vencimientos.filter((v) => v.sentido === sentido), [vencimientos, sentido]);
  const total = candidatos.filter((v) => elegidos.has(v.id)).reduce((s, v) => s + v.pendiente, 0);

  function alternar(id: string) {
    setElegidos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  if (cuentas.length === 0) {
    return (
      <div className="estado-vacio">
        <strong>Primero hace falta una cuenta bancaria</strong>
        Una remesa sale de una cuenta concreta. Date de alta la operativa en Cuentas bancarias.
      </div>
    );
  }

  return (
    <>
      <fieldset className="bloque">
        <legend>Datos de la remesa</legend>
        <div className="rejilla">
          <label className="campo">
            <span>Tipo</span>
            <select
              className="dato"
              value={sentido}
              onChange={(e) => { setSentido(e.target.value as "cobro" | "pago"); setElegidos(new Set()); }}
            >
              <option value="pago">Pago · transferencias a proveedores</option>
              <option value="cobro">Cobro · adeudos domiciliados</option>
            </select>
          </label>
          <label className="campo ancho-2">
            <span>Cuenta</span>
            <select value={bancoId} onChange={(e) => setBancoId(e.target.value)}>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre} · {c.iban}</option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>{sentido === "cobro" ? "Fecha de cargo" : "Fecha de pago"}</span>
            <input className="dato" type="date" value={fechaEjecucion} onChange={(e) => setFechaEjecucion(e.target.value)} />
          </label>
          <label className="campo ancho-4">
            <span>Concepto</span>
            <input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Remesa agosto 2026" />
          </label>
        </div>

        {sentido === "cobro" && !hayIdentificador && (
          <p className="aviso-texto">
            No hay identificador de acreedor guardado. Puedes montar la remesa, pero el fichero no se
            podrá generar hasta que lo pongas: lo asigna tu banco al contratar los adeudos.
          </p>
        )}
      </fieldset>

      <fieldset className="bloque">
        <legend>Vencimientos ({candidatos.length} pendientes)</legend>
        {candidatos.length === 0 ? (
          <p className="texto-suave">
            No hay {sentido === "cobro" ? "cobros" : "pagos"} pendientes. Los cobros nacen al expedir una
            factura; los pagos se dan de alta desde Facturas recibidas.
          </p>
        ) : (
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead>
                <tr>
                  <th></th>
                  <th>Vence</th>
                  <th>{sentido === "cobro" ? "Cliente" : "Proveedor"}</th>
                  <th className="a-derecha">Pendiente</th>
                </tr>
              </thead>
              <tbody>
                {candidatos.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={elegidos.has(v.id)}
                        onChange={() => alternar(v.id)}
                        aria-label={`Incluir ${v.quien}`}
                      />
                    </td>
                    <td className="dato">{formatoFecha(v.fecha)}</td>
                    <td>{v.quien}</td>
                    <td className="numero">{euros(v.pendiente)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="pie-tabla">
          {elegidos.size} {elegidos.size === 1 ? "elegido" : "elegidos"} · {euros(total)}
        </p>
      </fieldset>

      {error && <p className="error-texto">{error}</p>}
      {avisos.length > 0 && (
        <div className="aviso-banda">
          <strong>Algunas líneas se quedaron fuera:</strong> {avisos.join(" ")}
        </div>
      )}

      <div className="acciones">
        <button
          className="boton boton-auto"
          disabled={pendiente || elegidos.size === 0}
          onClick={() => {
            setError(null);
            setAvisos([]);
            iniciar(async () => {
              const r = await crearRemesa({
                sentido,
                bancoCuentaId: bancoId,
                fechaEjecucion,
                concepto: concepto || null,
                vencimientoIds: [...elegidos],
              });
              if (r?.error) { setError(r.error); return; }
              if (r?.avisos && r.avisos.length > 0) setAvisos(r.avisos);
              if (r?.id) { router.push(`/remesas/${r.id}`); router.refresh(); }
            });
          }}
        >
          {pendiente ? "Creando…" : "Crear remesa"}
        </button>
      </div>
    </>
  );
}
