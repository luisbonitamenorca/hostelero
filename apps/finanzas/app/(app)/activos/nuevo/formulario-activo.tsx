"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { aNumero, euros } from "@/lib/importes";
import { calcularCuadro, cuentasSugeridas } from "@/lib/amortizacion";
import { crearActivo } from "../../../acciones-activos";

type Cuenta = { id: string; codigo: string; nombre: string };

export default function FormularioActivo({
  cuentasActivo,
  cuentasAmortizacion,
  cuentasDotacion,
  centros,
}: {
  cuentasActivo: Cuenta[];
  cuentasAmortizacion: Cuenta[];
  cuentasDotacion: Cuenta[];
  centros: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [cuentaActivoId, setCuentaActivoId] = useState(cuentasActivo[0]?.id ?? "");
  const [centroId, setCentroId] = useState("");
  const [fechaAlta, setFechaAlta] = useState(new Date().toISOString().slice(0, 10));
  const [valor, setValor] = useState("");
  const [residual, setResidual] = useState("0");
  const [anios, setAnios] = useState("10");
  const [proveedor, setProveedor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const codigoElegido = cuentasActivo.find((c) => c.id === cuentaActivoId)?.codigo ?? "";
  const sugeridas = cuentasSugeridas(codigoElegido);

  // Las cuentas de amortización y dotación se proponen desde la del activo
  // (213000700 → 281300700 y 681000700), conservando el sufijo de centro,
  // que es como Lucía desglosa el plan real de A3.
  const idAmortizacion = useMemo(
    () => cuentasAmortizacion.find((c) => c.codigo === sugeridas?.acumulada)?.id ?? null,
    [cuentasAmortizacion, sugeridas],
  );
  const idDotacion = useMemo(
    () => cuentasDotacion.find((c) => c.codigo === sugeridas?.dotacion)?.id ?? null,
    [cuentasDotacion, sugeridas],
  );

  // Vista previa: cuánto se lleva a gasto cada mes y cuándo termina.
  const previa = useMemo(() => {
    const v = aNumero(valor);
    const r = aNumero(residual);
    const a = aNumero(anios);
    if (!(v > 0) || !(a > 0) || r > v) return null;
    const cuadro = calcularCuadro({ fechaAlta, valorAdquisicion: v, valorResidual: r, aniosVidaUtil: a });
    if (cuadro.length === 0) return null;
    const ultimo = cuadro.at(-1)!;
    const cuotaTipica = cuadro.length > 1 ? cuadro[1].importe : cuadro[0].importe;
    return { meses: cuadro.length, cuotaTipica, hasta: `${ultimo.periodo}/${ultimo.ejercicio}`, base: ultimo.acumulado };
  }, [valor, residual, anios, fechaAlta]);

  return (
    <>
      <fieldset className="bloque">
        <legend>Qué es</legend>
        <div className="rejilla">
          <label className="campo ancho-2">
            <span>Nombre *</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Horno de convección Rational" autoFocus />
          </label>
          <label className="campo ancho-2">
            <span>Proveedor</span>
            <input value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
          </label>
          <label className="campo ancho-4">
            <span>Descripción</span>
            <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset className="bloque">
        <legend>Dónde va</legend>
        <div className="rejilla">
          <label className="campo ancho-2">
            <span>Cuenta contable *</span>
            <select value={cuentaActivoId} onChange={(e) => setCuentaActivoId(e.target.value)}>
              {cuentasActivo.map((c) => (
                <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
              ))}
            </select>
            {sugeridas && (
              <em className="pista">
                Amortización acumulada en {sugeridas.acumulada}
                {idAmortizacion ? "" : " (no está en el plan)"} y dotación en {sugeridas.dotacion}
                {idDotacion ? "" : " (no está en el plan)"}.
              </em>
            )}
          </label>
          <label className="campo ancho-2">
            <span>Centro de coste</span>
            <select value={centroId} onChange={(e) => setCentroId(e.target.value)}>
              <option value="">— sin asignar —</option>
              {centros.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
            <em className="pista">Es lo que hace que el gasto aparezca en el resultado de ese centro.</em>
          </label>
        </div>
      </fieldset>

      <fieldset className="bloque">
        <legend>Cuánto y durante cuánto</legend>
        <div className="rejilla">
          <label className="campo">
            <span>Puesta en servicio *</span>
            <input className="dato" type="date" value={fechaAlta} onChange={(e) => setFechaAlta(e.target.value)} />
            <em className="pista">Desde esta fecha se amortiza, no desde la compra.</em>
          </label>
          <label className="campo">
            <span>Valor de adquisición *</span>
            <input className="dato a-derecha" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="12.000,00" />
          </label>
          <label className="campo">
            <span>Valor residual</span>
            <input className="dato a-derecha" value={residual} onChange={(e) => setResidual(e.target.value)} inputMode="decimal" />
            <em className="pista">Lo que valdrá al final. Casi siempre 0.</em>
          </label>
          <label className="campo">
            <span>Años de vida útil *</span>
            <input className="dato a-derecha" value={anios} onChange={(e) => setAnios(e.target.value)} inputMode="decimal" />
          </label>
        </div>

        {previa && (
          <div className="aviso-banda" style={{ marginTop: 12, background: "var(--blanco)", borderColor: "var(--borde)" }}>
            Se amortizarán <strong>{euros(previa.base)}</strong> en <strong>{previa.meses} meses</strong>,
            a razón de <strong>{euros(previa.cuotaTipica)}</strong> al mes, hasta <strong>{previa.hasta}</strong>.
          </div>
        )}
      </fieldset>

      {error && <p className="error-texto">{error}</p>}

      <div className="acciones">
        <button
          className="boton boton-auto"
          disabled={pendiente}
          onClick={() => {
            setError(null);
            iniciar(async () => {
              const r = await crearActivo({
                nombre,
                descripcion: descripcion || null,
                centroId: centroId || null,
                cuentaActivoId,
                cuentaAmortizacionId: idAmortizacion,
                cuentaDotacionId: idDotacion,
                fechaAlta,
                valorAdquisicion: aNumero(valor),
                valorResidual: aNumero(residual),
                aniosVidaUtil: aNumero(anios),
                proveedor: proveedor || null,
              });
              if (r?.error) { setError(r.error); return; }
              if (r?.id) { router.push(`/activos/${r.id}`); router.refresh(); }
            });
          }}
        >
          {pendiente ? "Creando…" : "Crear activo"}
        </button>
        <Link className="boton-secundario" href="/activos">Cancelar</Link>
      </div>
    </>
  );
}
