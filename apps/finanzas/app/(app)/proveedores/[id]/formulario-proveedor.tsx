"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { guardarFichaProveedor } from "../../../acciones-proveedores";
import type { EstadoAccion } from "../../../acciones";
import { errorDeIban, formatearIban } from "@/lib/nif";
import { DIAS_SEMANA, FORMAS_PAGO, calcularVencimiento, describirPlazo, type CondicionesProveedor, type PlazoTipo } from "@/lib/cartera";

export default function FormularioProveedor({
  proveedorId,
  cond,
}: {
  proveedorId: string;
  cond: Partial<CondicionesProveedor & { telefono: string | null; email: string | null; contacto: string | null; notas: string | null }> | null;
}) {
  const router = useRouter();
  const [estado, accion, pendiente] = useActionState<EstadoAccion, FormData>(guardarFichaProveedor, null);

  useEffect(() => {
    if (estado?.ok && estado.ir) {
      router.push(estado.ir);
      router.refresh();
    }
  }, [estado, router]);

  const [iban, setIban] = useState(cond?.iban ? formatearIban(cond.iban) : "");
  const [tipo, setTipo] = useState<PlazoTipo>((cond?.plazo_tipo as PlazoTipo) ?? "dias");
  const [dias, setDias] = useState(String(cond?.dias_pago ?? 30));
  const [dia, setDia] = useState(String(cond?.plazo_dia ?? (cond?.plazo_tipo === "dia_mes" ? 10 : 1)));

  const avisoIban = iban.trim() ? errorDeIban(iban) : null;
  const n = Number(dias);
  const condPrueba = { dias_pago: Number.isFinite(n) ? n : 0, plazo_tipo: tipo, plazo_dia: tipo === "dias" ? null : Number(dia) || null };
  const hoy = new Date().toISOString().slice(0, 10);
  let ejemplo: string | null = null;
  try {
    ejemplo = calcularVencimiento(hoy, condPrueba);
  } catch {
    ejemplo = null;
  }

  return (
    <form className="formulario" action={accion} noValidate>
      <input type="hidden" name="proveedor_id" value={proveedorId} />

      <fieldset className="bloque">
        <legend>Pago</legend>
        <div className="rejilla">
          <label className="campo ancho-2">
            <span>Forma de pago</span>
            <select name="forma_pago" defaultValue={cond?.forma_pago ?? ""}>
              <option value="">— sin indicar —</option>
              {FORMAS_PAGO.map((f) => (
                <option key={f.valor} value={f.valor}>
                  {f.etiqueta}
                </option>
              ))}
              {cond?.forma_pago && !FORMAS_PAGO.some((f) => f.valor === cond.forma_pago) && (
                <option value={cond.forma_pago}>{cond.forma_pago}</option>
              )}
            </select>
          </label>
          <label className="campo ancho-2">
            <span>Tipo de plazo</span>
            <select name="plazo_tipo" value={tipo} onChange={(e) => setTipo(e.target.value as PlazoTipo)}>
              <option value="dias">A N días</option>
              <option value="dia_semana">Primer día de la semana tras N días</option>
              <option value="dia_mes">Día del mes tras N días</option>
            </select>
          </label>
          <label className="campo">
            <span>Días (N)</span>
            <input className="dato" type="number" name="dias_pago" min={0} max={365} value={dias} onChange={(e) => setDias(e.target.value)} />
          </label>
          {tipo === "dia_semana" && (
            <label className="campo">
              <span>Día de la semana</span>
              <select className="dato" name="plazo_dia" value={dia} onChange={(e) => setDia(e.target.value)}>
                {DIAS_SEMANA.map((nombre, i) => (
                  <option key={nombre} value={i + 1}>
                    {nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tipo === "dia_mes" && (
            <label className="campo">
              <span>Día del mes</span>
              <input className="dato" type="number" name="plazo_dia" min={1} max={31} value={dia} onChange={(e) => setDia(e.target.value)} />
            </label>
          )}
          <p className="pista ancho-4" style={{ gridColumn: "span 4", margin: 0 }}>
            Plazo: <strong>{describirPlazo(condPrueba)}</strong>
            {ejemplo && (
              <>
                {" "}
                · una factura de hoy vencería el {ejemplo.split("-").reverse().join("/")}.
              </>
            )}
          </p>
          <label className="campo ancho-4">
            <span>Cuenta bancaria (IBAN)</span>
            <input
              className="dato"
              name="iban"
              value={iban}
              onChange={(e) => setIban(e.target.value.toUpperCase())}
              onBlur={() => iban.trim() && setIban(formatearIban(iban))}
              aria-invalid={!!avisoIban}
              placeholder="ES91 2100 0418 4502 0005 1332"
            />
            {avisoIban ? <em className="error-campo">{avisoIban}</em> : <em className="pista">Para pagarle por transferencia o remesa SEPA.</em>}
          </label>
        </div>
      </fieldset>

      <fieldset className="bloque">
        <legend>Contacto</legend>
        <div className="rejilla">
          <label className="campo ancho-2">
            <span>Persona de contacto</span>
            <input name="contacto" defaultValue={cond?.contacto ?? ""} />
          </label>
          <label className="campo">
            <span>Teléfono</span>
            <input className="dato" name="telefono" defaultValue={cond?.telefono ?? ""} />
          </label>
          <label className="campo">
            <span>Correo</span>
            <input type="email" name="email" defaultValue={cond?.email ?? ""} />
          </label>
        </div>
      </fieldset>

      <fieldset className="bloque">
        <legend>Observaciones</legend>
        <div className="rejilla">
          <label className="campo ancho-4">
            <span>Observaciones</span>
            <textarea name="notas" rows={4} defaultValue={cond?.notas ?? ""} />
          </label>
        </div>
      </fieldset>

      {estado?.error && <p className="error-texto">{estado.error}</p>}

      <div className="acciones">
        <button className="boton boton-auto" type="submit" disabled={pendiente || estado?.ok}>
          {pendiente || estado?.ok ? "Guardando…" : "Guardar ficha"}
        </button>
        <Link className="boton-secundario" href="/proveedores">
          Volver al listado
        </Link>
      </div>
    </form>
  );
}
