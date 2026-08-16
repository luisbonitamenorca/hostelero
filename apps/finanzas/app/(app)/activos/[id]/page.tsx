import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirModulo } from "@/lib/supabase/server";
import { euros, fecha } from "@/lib/importes";
import { MESES, type Activo, type FilaAmortizacion } from "@/lib/activos";
import BotonBaja from "./boton-baja";

export const dynamic = "force-dynamic";

export default async function DetalleActivo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await exigirModulo("contabilidad");
  const db = supabase;

  const { data: fila } = await db
    .from("fin_activos")
    .select("id, codigo, nombre, descripcion, centro_id, cuenta_activo_id, cuenta_amortizacion_id, cuenta_dotacion_id, fecha_alta, valor_adquisicion, valor_residual, anios_vida_util, proveedor, estado, fecha_baja, notas")
    .eq("id", id)
    .maybeSingle();

  if (!fila) notFound();
  const a = fila as Activo;

  const [{ data: cuadro }, { data: centro }, { data: cuentas }] = await Promise.all([
    db.from("fin_amortizaciones")
      .select("id, ejercicio, periodo, importe, acumulado, contabilizado")
      .eq("activo_id", id)
      .order("ejercicio")
      .order("periodo"),
    a.centro_id ? supabase.from("centros").select("nombre").eq("id", a.centro_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("fin_plan_cuentas").select("id, codigo, nombre"),
  ]);

  const filas = (cuadro ?? []) as FilaAmortizacion[];
  const porId = new Map((cuentas ?? []).map((c) => [c.id, `${c.codigo} · ${c.nombre}`]));

  const hoy = new Date();
  const pasadas = filas.filter((f) => f.ejercicio < hoy.getFullYear() || (f.ejercicio === hoy.getFullYear() && f.periodo <= hoy.getMonth() + 1));
  const amortizado = pasadas.length > 0 ? Number(pasadas[pasadas.length - 1].acumulado) : 0;
  const contable = Number(a.valor_adquisicion) - amortizado;

  // Resumen por año, que es como se mira de verdad.
  const porAnio = new Map<number, number>();
  for (const f of filas) porAnio.set(f.ejercicio, (porAnio.get(f.ejercicio) ?? 0) + Number(f.importe));

  return (
    <>
      <div className="cabecera-pagina">
        <p className="miga">
          <Link className="enlace" href="/activos">Activos</Link> / Ficha
        </p>
        <h1>{a.nombre}</h1>
        <p className="sub">
          {a.descripcion ?? "Sin descripción"}
          {a.estado === "baja" && ` · dado de baja el ${fecha(a.fecha_baja)}`}
        </p>
      </div>

      <div className="tarjetas" style={{ marginBottom: 16 }}>
        <div className="tarjeta">
          <p className="etiqueta">Adquisición</p>
          <p className="valor dato">{euros(Number(a.valor_adquisicion))}</p>
          <p className="detalle">{fecha(a.fecha_alta)}</p>
        </div>
        <div className="tarjeta">
          <p className="etiqueta">Amortizado a hoy</p>
          <p className="valor dato">{euros(amortizado)}</p>
          <p className="detalle">{pasadas.length} de {filas.length} meses</p>
        </div>
        <div className="tarjeta">
          <p className="etiqueta">Valor contable</p>
          <p className="valor dato">{euros(contable)}</p>
        </div>
        <div className="tarjeta">
          <p className="etiqueta">Vida útil</p>
          <p className="valor dato">{Number(a.anios_vida_util)} años</p>
          <p className="detalle">{centro?.nombre ?? "Sin centro asignado"}</p>
        </div>
      </div>

      <div className="bloque">
        <div className="rejilla">
          <div className="campo ancho-2">
            <span>Cuenta del activo</span>
            <p className="valor dato">{porId.get(a.cuenta_activo_id) ?? "—"}</p>
          </div>
          <div className="campo ancho-2">
            <span>Amortización acumulada</span>
            <p className="valor dato">{a.cuenta_amortizacion_id ? (porId.get(a.cuenta_amortizacion_id) ?? "—") : "sin asignar"}</p>
          </div>
          <div className="campo ancho-2">
            <span>Dotación del ejercicio</span>
            <p className="valor dato">{a.cuenta_dotacion_id ? (porId.get(a.cuenta_dotacion_id) ?? "—") : "sin asignar"}</p>
          </div>
          <div className="campo ancho-2">
            <span>Valor residual</span>
            <p className="valor dato">{euros(Number(a.valor_residual))}</p>
          </div>
        </div>
      </div>

      <fieldset className="bloque" style={{ marginTop: 16 }}>
        <legend>Por ejercicio</legend>
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr><th>Ejercicio</th><th className="a-derecha">Dotación del año</th></tr>
            </thead>
            <tbody>
              {[...porAnio.entries()].map(([anio, importe]) => (
                <tr key={anio}>
                  <td className="dato">{anio}</td>
                  <td className="numero">{euros(importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>

      <fieldset className="bloque" style={{ marginTop: 16 }}>
        <legend>Cuadro mes a mes ({filas.length} periodos)</legend>
        <div className="tabla-envoltura" style={{ maxHeight: 420, overflowY: "auto" }}>
          <table className="tabla">
            <thead>
              <tr>
                <th>Periodo</th>
                <th className="a-derecha">Dotación</th>
                <th className="a-derecha">Acumulado</th>
                <th className="a-derecha">Pendiente</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id}>
                  <td className="dato">{MESES[f.periodo]} {f.ejercicio}</td>
                  <td className="numero">{euros(Number(f.importe))}</td>
                  <td className="numero">{euros(Number(f.acumulado))}</td>
                  <td className="numero">{euros(Number(a.valor_adquisicion) - Number(a.valor_residual) - Number(f.acumulado))}</td>
                  <td className="a-derecha">
                    {f.contabilizado ? "contabilizado" : <span className="texto-suave">pendiente</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>

      {a.estado === "alta" && <BotonBaja id={a.id} nombre={a.nombre} />}
    </>
  );
}
