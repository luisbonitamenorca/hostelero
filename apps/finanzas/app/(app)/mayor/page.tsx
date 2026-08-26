import Link from "next/link";
import { exigirModulo } from "@/lib/supabase/server";
import { euros, fecha } from "@/lib/importes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Saldo = {
  codigo: string;
  nombre: string;
  debe: number;
  haber: number;
  saldo: number;
  apuntes: number;
  ultima_fecha: string;
};
type ApunteMayor = {
  debe: number;
  haber: number;
  fin_asientos: { id: string; numero: number | null; fecha: string; descripcion: string | null };
};

const PESTANAS = [
  { id: "clientes", titulo: "Clientes (430)", prefijos: ["430"] },
  { id: "proveedores", titulo: "Proveedores (400/410)", prefijos: ["400", "410"] },
] as const;

/**
 * Libro mayor: la vida de una cuenta, movimiento a movimiento y con saldo
 * corrido. La puerta de entrada son los mayores que se miran a diario —
 * clientes y proveedores — pero cualquier cuenta del plan tiene el suyo
 * (desde el buscador o desde el Plan de cuentas).
 */
export default async function Mayor({
  searchParams,
}: {
  searchParams: Promise<{ cuenta?: string; pestana?: string; q?: string; desde?: string; hasta?: string }>;
}) {
  const sp = await searchParams;
  const { supabase } = await exigirModulo("contabilidad");

  if (sp.cuenta) return <MayorDeCuenta supabase={supabase} sp={sp} />;

  const pestana = PESTANAS.find((p) => p.id === sp.pestana) ?? PESTANAS[0];
  const q = (sp.q ?? "").trim();

  const rpc = supabase as unknown as {
    rpc: (fn: "fin_mayor_saldos", args: { p_prefijos: string[] }) => PromiseLike<{ data: Saldo[] | null; error: { message: string } | null }>;
  };

  // Con búsqueda no hay pestaña que valga: se busca en TODO el plan, y solo
  // salen las cuentas con movimiento (las demás no tienen mayor que enseñar).
  let filas: Saldo[] = [];
  let error: { message: string } | null = null;
  if (q) {
    const { data: encontradas } = await supabase
      .from("fin_plan_cuentas")
      .select("codigo")
      .or(`codigo.ilike.%${q.replace(/[,()*%\\]/g, " ")}%,nombre.ilike.%${q.replace(/[,()*%\\]/g, " ")}%`)
      .limit(400);
    const codigos = (encontradas ?? []).map((c) => c.codigo);
    if (codigos.length) {
      const r = await rpc.rpc("fin_mayor_saldos", { p_prefijos: codigos });
      filas = r.data ?? [];
      error = r.error;
    }
  } else {
    const r = await rpc.rpc("fin_mayor_saldos", { p_prefijos: [...pestana.prefijos] });
    filas = r.data ?? [];
    error = r.error;
  }

  const totalSaldo = filas.reduce((s, f) => s + Number(f.saldo), 0);

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Libro mayor</h1>
        <p className="sub">
          La vida de cada cuenta con su saldo. Solo salen cuentas con movimiento en el diario.
        </p>
      </div>

      <div className="barra-filtros" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {!q &&
          PESTANAS.map((p) => (
            <Link
              key={p.id}
              href={`/mayor?pestana=${p.id}`}
              className="boton-secundario"
              style={{ padding: "5px 12px", fontSize: 13, ...(pestana.id === p.id ? { background: "#0F6E56", color: "#fff", borderColor: "#0F6E56" } : {}) }}
            >
              {p.titulo}
            </Link>
          ))}
        <form method="get" style={{ display: "flex", gap: 6, flex: "1 1 260px" }}>
          <input name="q" defaultValue={q} placeholder="Cualquier cuenta: código o nombre…" style={{ flex: 1, padding: "6px 10px", border: "1px solid #DDE2DF", borderRadius: 6 }} />
          <button className="boton-secundario" type="submit">Buscar</button>
          {q && (
            <Link className="boton-secundario" href="/mayor" style={{ padding: "6px 10px" }}>
              Limpiar
            </Link>
          )}
        </form>
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudieron cargar los saldos</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && filas.length === 0 && (
        <div className="estado-vacio">
          <strong>{q ? `Ninguna cuenta con movimiento coincide con «${q}»` : "Sin cuentas con movimiento"}</strong>
          {q ? "Prueba con parte del código o del nombre." : "Cuando el diario tenga apuntes, aparecerán aquí."}
        </div>
      )}

      {!error && filas.length > 0 && (
        <>
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th className="a-derecha">Debe</th>
                  <th className="a-derecha">Haber</th>
                  <th className="a-derecha">Saldo</th>
                  <th className="a-derecha">Apuntes</th>
                  <th>Último mov.</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.codigo}>
                    <td>
                      <span className="dato">{f.codigo}</span> {f.nombre}
                    </td>
                    <td className="numero">{euros(Number(f.debe))}</td>
                    <td className="numero">{euros(Number(f.haber))}</td>
                    <td className="numero" style={{ fontWeight: 600 }}>{euros(Number(f.saldo))}</td>
                    <td className="numero">{f.apuntes}</td>
                    <td className="dato">{fecha(f.ultima_fecha)}</td>
                    <td>
                      <Link className="boton-secundario" style={{ padding: "4px 10px", fontSize: 13 }} href={`/mayor?cuenta=${f.codigo}`}>
                        Mayor
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>Total ({filas.length} cuentas)</strong></td>
                  <td colSpan={2}></td>
                  <td className="numero"><strong>{euros(Math.round(totalSaldo * 100) / 100)}</strong></td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="pista">
            El saldo es debe − haber: en clientes (430), positivo = pendiente de cobrar; en
            proveedores (400/410), negativo = pendiente de pagar. El signo raro es el que merece un
            clic.
          </p>
        </>
      )}
    </>
  );
}

async function MayorDeCuenta({
  supabase,
  sp,
}: {
  supabase: Awaited<ReturnType<typeof exigirModulo>>["supabase"];
  sp: { cuenta?: string; desde?: string; hasta?: string; pestana?: string };
}) {
  const codigo = String(sp.cuenta);
  const esFecha = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "");
  const desde = esFecha(sp.desde) ? sp.desde! : "";
  const hasta = esFecha(sp.hasta) ? sp.hasta! : "";

  const { data: cuenta } = await supabase
    .from("fin_plan_cuentas")
    .select("id, codigo, nombre")
    .eq("codigo", codigo)
    .maybeSingle();

  if (!cuenta) {
    return (
      <div className="estado-vacio">
        <strong>La cuenta {codigo} no existe en el plan</strong>
        <Link href="/mayor">Volver al libro mayor</Link>
      </div>
    );
  }

  // TODOS los apuntes confirmados de la cuenta, en orden contable. El saldo
  // corrido exige la serie completa desde el origen: el filtro de fechas
  // decide qué se PINTA, no qué se suma (lo anterior queda como apertura).
  const { data, error } = await supabase
    .from("fin_apuntes")
    .select("debe, haber, fin_asientos!inner(id, numero, fecha, descripcion, estado)")
    .eq("cuenta_plan_id", cuenta.id)
    .eq("fin_asientos.estado", "confirmado")
    .order("fecha", { referencedTable: "fin_asientos", ascending: true })
    .limit(10000);

  const apuntes = ((data ?? []) as unknown as ApunteMayor[])
    .slice()
    .sort((x, y) => x.fin_asientos.fecha.localeCompare(y.fin_asientos.fecha) || (x.fin_asientos.numero ?? 0) - (y.fin_asientos.numero ?? 0));

  let saldo = 0;
  let apertura = 0;
  const visibles: { asientoId: string; numero: number | null; fecha: string; descripcion: string; debe: number; haber: number; saldo: number }[] = [];
  for (const ap of apuntes) {
    const f = ap.fin_asientos.fecha;
    saldo = Math.round((saldo + Number(ap.debe) - Number(ap.haber)) * 100) / 100;
    if (desde && f < desde) {
      apertura = saldo;
      continue;
    }
    if (hasta && f > hasta) break;
    visibles.push({
      asientoId: ap.fin_asientos.id,
      numero: ap.fin_asientos.numero,
      fecha: f,
      descripcion: ap.fin_asientos.descripcion ?? "",
      debe: Number(ap.debe),
      haber: Number(ap.haber),
      saldo,
    });
  }
  const saldoFinal = visibles.length ? visibles[visibles.length - 1].saldo : apertura;

  return (
    <>
      <div className="cabecera-pagina">
        <h1>
          Mayor · <span className="dato">{cuenta.codigo}</span> {cuenta.nombre}
        </h1>
        <p className="sub">
          {apuntes.length} apuntes en el diario · saldo actual {euros(saldoFinal)}
        </p>
      </div>

      <div className="barra-filtros" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link className="boton-secundario" href="/mayor" style={{ padding: "5px 12px", fontSize: 13 }}>
          ← Todas las cuentas
        </Link>
        <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="hidden" name="cuenta" value={cuenta.codigo} />
          <label className="campo" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}>
            <span>Desde</span>
            <input type="date" name="desde" defaultValue={desde} />
          </label>
          <label className="campo" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}>
            <span>Hasta</span>
            <input type="date" name="hasta" defaultValue={hasta} />
          </label>
          <button className="boton-secundario" type="submit">Aplicar</button>
        </form>
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudo cargar el mayor</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && visibles.length === 0 && (
        <div className="estado-vacio">
          <strong>Sin movimientos{desde || hasta ? " en el periodo elegido" : ""}</strong>
          {desde ? `El saldo de apertura a ${fecha(desde)} es ${euros(apertura)}.` : "La cuenta existe pero el diario no la ha movido."}
        </div>
      )}

      {!error && visibles.length > 0 && (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Asiento</th>
                <th>Concepto</th>
                <th className="a-derecha">Debe</th>
                <th className="a-derecha">Haber</th>
                <th className="a-derecha">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {desde && (
                <tr>
                  <td className="dato">{fecha(desde)}</td>
                  <td></td>
                  <td><em>Saldo de apertura</em></td>
                  <td></td>
                  <td></td>
                  <td className="numero"><em>{euros(apertura)}</em></td>
                </tr>
              )}
              {visibles.map((v, i) => (
                <tr key={i}>
                  <td className="dato">{fecha(v.fecha)}</td>
                  <td className="dato">
                    {v.numero != null ? <Link href={`/asientos/${v.asientoId}`} prefetch={false}>{v.numero}</Link> : "—"}
                  </td>
                  <td>{v.descripcion.slice(0, 80)}</td>
                  <td className="numero">{v.debe ? euros(v.debe) : ""}</td>
                  <td className="numero">{v.haber ? euros(v.haber) : ""}</td>
                  <td className="numero" style={{ fontWeight: 600 }}>{euros(v.saldo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}><strong>Saldo final{hasta ? ` a ${fecha(hasta)}` : ""}</strong></td>
                <td className="numero">{euros(visibles.reduce((s, v) => s + v.debe, 0))}</td>
                <td className="numero">{euros(visibles.reduce((s, v) => s + v.haber, 0))}</td>
                <td className="numero"><strong>{euros(saldoFinal)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
