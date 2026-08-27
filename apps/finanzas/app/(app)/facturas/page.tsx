import Link from "next/link";
import { exigirFacturacion } from "@/lib/supabase/server";
import { euros, fecha } from "@/lib/importes";

export const dynamic = "force-dynamic";

export default async function Facturas({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; orden?: string; dir?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const orden = ["numero", "cliente", "fecha", "total", "estado"].includes(sp.orden ?? "") ? sp.orden! : "fecha";
  const dir = sp.dir === "asc" ? 1 : -1;
  const { supabase } = await exigirFacturacion();

  const { data, error } = await supabase
    .from("fin_facturas")
    .select(
      "id, numero_completo, tipo, estado, fecha_expedicion, fecha_operacion, total, estado_cobro, fin_clientes(nombre_fiscal)",
    )
    .order("creado_en", { ascending: false })
    .limit(500);

  // Pocas filas: buscar y ordenar aquí mismo, sin más viajes a la base.
  const nombreDe = (f: NonNullable<typeof data>[number]) => {
    const c = Array.isArray(f.fin_clientes) ? f.fin_clientes[0] : f.fin_clientes;
    return c?.nombre_fiscal ?? "";
  };
  let filas = (data ?? []).filter(
    (f) => !q || (f.numero_completo ?? "").toLowerCase().includes(q) || nombreDe(f).toLowerCase().includes(q),
  );
  const clave = (f: (typeof filas)[number]): string | number => {
    if (orden === "numero") return f.numero_completo ?? "";
    if (orden === "cliente") return nombreDe(f);
    if (orden === "total") return Number(f.total ?? 0);
    if (orden === "estado") return f.estado ?? "";
    return f.fecha_expedicion ?? f.fecha_operacion ?? "";
  };
  filas = filas.sort((a, b) => (clave(a) < clave(b) ? -dir : clave(a) > clave(b) ? dir : 0));

  const enlaceOrden = (campo: string) =>
    `?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), orden: campo, dir: orden === campo && sp.dir !== "asc" ? "asc" : "desc" }).toString()}`;

  return (
    <>
      <div className="cabecera-pagina con-accion">
        <div>
          <h1>Facturas</h1>
          <p className="sub">Facturas emitidas por la sociedad</p>
        </div>
        <Link className="boton boton-auto" href="/facturas/nueva">
          Nueva factura
        </Link>
      </div>

      {error && (
        <div className="estado-vacio">
          <strong>No se pudieron cargar las facturas</strong>
          Recarga la página. Si persiste, revisar la sesión y los permisos.
        </div>
      )}

      <form method="get" style={{ margin: "0 0 14px" }}>
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Buscar por número o cliente…"
          style={{ width: "100%", maxWidth: 420, padding: "8px 12px", border: "1px solid #DDE2DF", borderRadius: 8 }}
        />
      </form>

      {!error && filas.length === 0 && (
        <div className="estado-vacio">
          <strong>{q ? `Ninguna factura coincide con «${sp.q}»` : "Aún no hay facturas"}</strong>
          {q
            ? "Prueba con parte del número o del cliente."
            : "Llegarán del TPV; también puedes empezar por un borrador manual."}
        </div>
      )}

      {!error && filas.length > 0 && (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead>
              <tr>
                {(
                  [
                    ["numero", "Número", ""],
                    ["cliente", "Cliente", ""],
                    ["", "Tipo", ""],
                    ["estado", "Estado", ""],
                    ["fecha", "Fecha", ""],
                    ["total", "Total", "a-derecha"],
                  ] as const
                ).map(([campo, titulo, clase]) => (
                  <th key={titulo} className={clase || undefined}>
                    {campo ? (
                      <a href={enlaceOrden(campo)} style={{ color: "inherit", textDecoration: "none" }} title={`Ordenar por ${titulo.toLowerCase()}`}>
                        {titulo}
                        {orden === campo ? (dir === 1 ? " ↑" : " ↓") : ""}
                      </a>
                    ) : (
                      titulo
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const cliente = Array.isArray(f.fin_clientes) ? f.fin_clientes[0] : f.fin_clientes;
                return (
                  <tr key={f.id}>
                    <td className="dato">
                      <Link className="enlace" href={`/facturas/${f.id}`}>
                        {f.estado === "borrador" ? "borrador" : (f.numero_completo ?? "—")}
                      </Link>
                    </td>
                    <td>{cliente?.nombre_fiscal ?? "—"}</td>
                    <td>{f.tipo}</td>
                    <td>
                      {f.estado === "borrador" && <span className="etiqueta-estado">borrador</span>}
                      {f.estado === "expedida" && "expedida"}
                      {f.estado === "anulada" && <span className="etiqueta-estado">anulada</span>}
                    </td>
                    <td className="dato">{fecha(f.fecha_expedicion ?? f.fecha_operacion)}</td>
                    <td className="numero">{euros(Number(f.total))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
