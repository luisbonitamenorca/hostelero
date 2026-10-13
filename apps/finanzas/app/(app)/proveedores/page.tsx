import Link from "next/link";
import { exigirModulo } from "@/lib/supabase/server";
import { euros } from "@/lib/importes";
import { paginarEnParalelo } from "@/lib/paginar";
import { formatearIban } from "@/lib/nif";
import { FORMAS_PAGO, describirPlazo, type CondicionesProveedor } from "@/lib/cartera";
import { COLUMNAS_PROVEEDOR, columnasDeAjustes } from "@/lib/proveedores";
import Buscador from "../clientes/buscador";

export const dynamic = "force-dynamic";

const LIMITE = 300;

/** PostgREST separa los filtros de `or` por comas: se limpian antes. */
function limpiarBusqueda(texto: string): string {
  return texto.replace(/[,()*%\\]/g, " ").trim();
}

type Cond = Partial<CondicionesProveedor & { telefono: string | null; email: string | null; contacto: string | null }>;

export default async function Proveedores({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  // Los proveedores son del módulo de compras: es su maestro, no lo duplicamos.
  const { supabase, cuenta } = await exigirModulo("compras");

  let consulta = supabase
    .from("compras_proveedor")
    .select("id, nombre, nif, categoria, cuenta_contable, cuenta_proveedor, departamento, critico, codigo_a3")
    .order("nombre")
    .limit(LIMITE);

  const termino = limpiarBusqueda(q);
  if (termino) {
    consulta = consulta.or(`nombre.ilike.%${termino}%,nif.ilike.%${termino}%,categoria.ilike.%${termino}%`);
  }

  // compras_doc pasa de las 1.000 filas (db-max-rows): sin paginar, los totales
  // por proveedor salían cojos. Solo las dos columnas que se suman.
  const [{ data, error }, { filas: docs }, { data: condiciones }, { data: ajustesFila }] = await Promise.all([
    consulta,
    paginarEnParalelo((d, h, contar) =>
      supabase
        .from("compras_doc")
        .select("proveedor_id, total", contar ? { count: "exact" } : undefined)
        .eq("tipo", "factura")
        .order("id")
        .range(d, h),
    ),
    // select('*'): si una migración aún no está aplicada, simplemente no vienen esas columnas.
    supabase.from("fin_proveedor_condiciones").select("*"),
    // Columnas elegidas en Ajustes. Si la tabla no existe todavía, las de defecto.
    supabase.from("fin_ajustes").select("ajustes").eq("cuenta_id", cuenta.id).maybeSingle(),
  ]);

  const cond = new Map((condiciones ?? []).map((c) => [c.proveedor_id, c as Cond]));
  const columnas = columnasDeAjustes(ajustesFila?.ajustes);
  const visibles = COLUMNAS_PROVEEDOR.filter((c) => columnas.includes(c.clave));

  // Cuántas facturas y cuánto lleva gastado cada proveedor.
  const resumen = new Map<string, { n: number; total: number }>();
  for (const d of docs ?? []) {
    if (!d.proveedor_id) continue;
    const r = resumen.get(d.proveedor_id) ?? { n: 0, total: 0 };
    r.n += 1;
    r.total += Number(d.total ?? 0);
    resumen.set(d.proveedor_id, r);
  }

  const filas = data ?? [];
  const etiquetaForma = (v: string | null | undefined) => (v ? (FORMAS_PAGO.find((f) => f.valor === v)?.etiqueta ?? v) : null);

  const celda = (clave: string, p: (typeof filas)[number]) => {
    const c = cond.get(p.id);
    const r = resumen.get(p.id);
    switch (clave) {
      case "nif":
        return <td className="dato">{p.nif ?? "—"}</td>;
      case "categoria":
        return <td>{p.categoria ?? "—"}</td>;
      case "departamento":
        return <td>{p.departamento ?? "—"}</td>;
      case "cuenta":
        return (
          <td className="dato">
            {p.cuenta_proveedor ? (
              <Link className="enlace" href={`/mayor?cuenta=${p.cuenta_proveedor}`} title="Ver el mayor de este proveedor">
                {p.cuenta_proveedor}
              </Link>
            ) : (
              (p.cuenta_contable ?? "—")
            )}
          </td>
        );
      case "codigo_a3":
        return <td className="dato">{p.codigo_a3 ?? "—"}</td>;
      case "pago":
        return (
          <td>
            {c && c.dias_pago != null ? (
              <>
                {describirPlazo(c as CondicionesProveedor)}
                {c.forma_pago && <span className="secundario">{etiquetaForma(c.forma_pago)}</span>}
              </>
            ) : (
              <span className="secundario">sin condiciones</span>
            )}
          </td>
        );
      case "iban":
        return <td className="dato">{c?.iban ? formatearIban(c.iban) : "—"}</td>;
      case "contacto":
        return <td>{c?.contacto ?? "—"}</td>;
      case "telefono":
        return <td className="dato">{c?.telefono ?? "—"}</td>;
      case "email":
        return <td>{c?.email ?? "—"}</td>;
      case "facturas":
        return <td className="numero">{r?.n ?? 0}</td>;
      case "facturado":
        return <td className="numero">{r ? euros(r.total) : "—"}</td>;
      default:
        return <td>—</td>;
    }
  };

  return (
    <>
      <div className="cabecera-pagina con-accion">
        <div>
          <h1>Proveedores</h1>
          <p className="sub">
            El maestro vive en el módulo de compras. Aquí se consulta, se ve lo que llevan facturado y
            cada proveedor tiene su ficha con forma y plazo de pago, cuenta bancaria y contacto.
          </p>
        </div>
        <Link className="boton-secundario boton-auto" href="/ajustes" title="Elegir qué columnas enseña este listado">
          Columnas del listado
        </Link>
      </div>

      <Buscador q={q} soloActivos={false} sinFiltroActivos />

      {error && (
        <div className="estado-vacio">
          <strong>No se pudieron cargar los proveedores</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      {!error && filas.length === 0 && (
        <div className="estado-vacio">
          <strong>{termino ? `Ningún proveedor coincide con «${termino}»` : "Aún no hay proveedores"}</strong>
          {termino ? "Prueba con parte del nombre o con el NIF." : "Se dan de alta desde el módulo de compras."}
        </div>
      )}

      {!error && filas.length > 0 && (
        <>
          <div className="tabla-envoltura">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Proveedor</th>
                  {visibles.map((c) => (
                    <th key={c.clave} className={c.numerica ? "a-derecha" : undefined}>
                      {c.etiqueta}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link className="enlace" href={`/proveedores/${p.id}`} title="Abrir la ficha">
                        {p.nombre}
                      </Link>
                      {p.critico && <span className="etiqueta-estado">crítico</span>}
                    </td>
                    {visibles.map((c) => (
                      <FragmentoCelda key={c.clave}>{celda(c.clave, p)}</FragmentoCelda>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pie-tabla">
            {filas.length === LIMITE
              ? `Mostrando los ${LIMITE} primeros. Afina la búsqueda para ver el resto.`
              : `${filas.length} proveedor${filas.length === 1 ? "" : "es"}.`}
          </p>
        </>
      )}
    </>
  );
}

/** Las celdas ya llevan su <td>: esto solo da la key. */
function FragmentoCelda({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
