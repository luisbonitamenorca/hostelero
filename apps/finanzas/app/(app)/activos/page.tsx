import Link from "next/link";
import { exigirModulo } from "@/lib/supabase/server";
import { euros, fecha } from "@/lib/importes";
import { type Activo } from "@/lib/activos";

export const dynamic = "force-dynamic";

export default async function Activos() {
  const { supabase } = await exigirModulo("contabilidad");
  const db = supabase;

  const [{ data, error }, { data: centros }, { data: cuentas }] = await Promise.all([
    db.from("fin_activos")
      .select("id, codigo, nombre, descripcion, centro_id, cuenta_activo_id, cuenta_amortizacion_id, cuenta_dotacion_id, fecha_alta, valor_adquisicion, valor_residual, anios_vida_util, proveedor, estado, fecha_baja, notas")
      .order("fecha_alta", { ascending: false }),
    supabase.from("centros").select("id, nombre"),
    supabase.from("fin_plan_cuentas").select("id, codigo, nombre"),
  ]);

  const activos = (data ?? []) as Activo[];
  const nombreCentro = new Map((centros ?? []).map((c) => [c.id, c.nombre]));
  const cuentaPorId = new Map((cuentas ?? []).map((c) => [c.id, c.codigo]));

  // Lo amortizado a día de hoy, para saber cuánto vale cada cosa en libros.
  const { data: acumulados } = activos.length
    ? await db
        .from("fin_amortizaciones")
        .select("activo_id, acumulado, ejercicio, periodo")
        .in("activo_id", activos.map((a) => a.id))
    : { data: [] };

  const hoy = new Date();
  const amortizado = new Map<string, number>();
  for (const f of (acumulados ?? []) as { activo_id: string; acumulado: number; ejercicio: number; periodo: number }[]) {
    const pasado = f.ejercicio < hoy.getFullYear() || (f.ejercicio === hoy.getFullYear() && f.periodo <= hoy.getMonth() + 1);
    if (!pasado) continue;
    const previo = amortizado.get(f.activo_id) ?? 0;
    if (Number(f.acumulado) > previo) amortizado.set(f.activo_id, Number(f.acumulado));
  }

  const enAlta = activos.filter((a) => a.estado === "alta");
  const valorBruto = enAlta.reduce((s, a) => s + Number(a.valor_adquisicion), 0);
  const yaAmortizado = enAlta.reduce((s, a) => s + (amortizado.get(a.id) ?? 0), 0);

  return (
    <>
      <div className="cabecera-pagina con-accion">
        <div>
          <h1>Activos</h1>
          <p className="sub">Lo que se compra una vez y se gasta a lo largo de varios años</p>
        </div>
        <Link className="boton boton-auto" href="/activos/nuevo">Nuevo activo</Link>
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudieron cargar los activos</strong>
          Si acaba de aplicarse la migración F2c, recarga.
        </div>
      )}

      {!error && activos.length === 0 && (
        <div className="estado-vacio">
          <strong>Aún no hay activos</strong>
          Un horno, una furgoneta, la reforma de una sala. Todo lo que no se gasta en el año en que
          se compra.
        </div>
      )}

      {!error && activos.length > 0 && (
        <>
          <div className="tarjetas" style={{ marginBottom: 16 }}>
            <div className="tarjeta">
              <p className="etiqueta">Activos en alta</p>
              <p className="valor dato">{enAlta.length}</p>
            </div>
            <div className="tarjeta">
              <p className="etiqueta">Valor de adquisición</p>
              <p className="valor dato">{euros(valorBruto)}</p>
            </div>
            <div className="tarjeta">
              <p className="etiqueta">Amortizado a hoy</p>
              <p className="valor dato">{euros(yaAmortizado)}</p>
            </div>
            <div className="tarjeta">
              <p className="etiqueta">Valor contable</p>
              <p className="valor dato">{euros(valorBruto - yaAmortizado)}</p>
              <p className="detalle">Lo que aún queda por llevar a gasto.</p>
            </div>
          </div>

          <div className="tabla-envoltura">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Activo</th>
                  <th>Cuenta</th>
                  <th>Centro</th>
                  <th>Alta</th>
                  <th className="a-derecha">Años</th>
                  <th className="a-derecha">Adquisición</th>
                  <th className="a-derecha">Amortizado</th>
                  <th className="a-derecha">Valor contable</th>
                </tr>
              </thead>
              <tbody>
                {activos.map((a) => {
                  const amort = amortizado.get(a.id) ?? 0;
                  return (
                    <tr key={a.id} className={a.estado === "baja" ? "fila-inactiva" : undefined}>
                      <td>
                        <Link className="enlace" href={`/activos/${a.id}`}>{a.nombre}</Link>
                        {a.estado === "baja" && <span className="etiqueta-estado">de baja</span>}
                        {a.proveedor && <span className="secundario">{a.proveedor}</span>}
                      </td>
                      <td className="dato">{cuentaPorId.get(a.cuenta_activo_id) ?? "—"}</td>
                      <td>{a.centro_id ? (nombreCentro.get(a.centro_id) ?? "—") : "—"}</td>
                      <td className="dato">{fecha(a.fecha_alta)}</td>
                      <td className="numero">{Number(a.anios_vida_util)}</td>
                      <td className="numero">{euros(Number(a.valor_adquisicion))}</td>
                      <td className="numero">{euros(amort)}</td>
                      <td className="numero">{euros(Number(a.valor_adquisicion) - amort)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="pista">
            La amortización se calcula sola al dar de alta el activo, mes a mes y prorrateando el
            primero por días. Todavía no genera el asiento contable: eso llega cuando el diario esté
            montado.
          </p>
        </>
      )}
    </>
  );
}
