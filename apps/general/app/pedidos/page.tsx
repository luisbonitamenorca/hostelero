import PanelPedidos from "./PanelPedidos";
import { comoProveedor, hoyMadrid } from "./lib-pedidos";
import { errorLegible, exigirPedidos } from "./servidor";
import { SELECT_PROVEEDOR } from "./tipos";
import type { Centro, ContextoPedidos, ProveedorPedido } from "./tipos";

export const dynamic = "force-dynamic";
/* La interpretación por IA (acciones/interpretar.ts) puede tardar 10-20 s: las acciones que se
   invocan desde esta ruta heredan este límite. */
export const maxDuration = 60;

const PAGINA = 1000;

export default async function PedidosPage() {
  const ctx = await exigirPedidos();
  const { supabase, perfil, cuenta, cuentaId } = ctx;

  const { data: filasCentros, error: errorCentros } = await supabase
    .from("centros")
    .select("id, nombre, direccion")
    .eq("cuenta_id", cuentaId)
    .order("nombre");

  // Proveedores pedibles de la cuenta, por nombre (paginado: PostgREST da 1.000 filas como mucho).
  const proveedores: ProveedorPedido[] = [];
  let errorProveedores: string | null = null;
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await supabase
      .from("compras_proveedor")
      .select(SELECT_PROVEEDOR)
      .eq("cuenta_id", cuentaId)
      .eq("pedible", true)
      .order("nombre")
      .order("id")
      .range(desde, desde + PAGINA - 1);
    if (error) {
      errorProveedores = errorLegible(error, "No se han podido leer los proveedores.");
      break;
    }
    const filas = data ?? [];
    proveedores.push(...filas.map(comoProveedor));
    if (filas.length < PAGINA) break;
  }

  if (errorCentros || errorProveedores) {
    return (
      <main className="contenido">
        <div className="aviso-error">
          {errorCentros ? errorLegible(errorCentros, "No se han podido leer los centros.") : errorProveedores}
        </div>
        <p className="vacio">Recarga la página en un momento.</p>
      </main>
    );
  }

  const centros: Centro[] = (filasCentros ?? []).map((c) => ({ id: c.id, nombre: c.nombre, direccion: c.direccion }));

  if (!centros.length) {
    return (
      <main className="contenido">
        <div className="tarjeta">
          <p className="vacio">No hay centros en tu cuenta.</p>
        </div>
      </main>
    );
  }

  const contexto: ContextoPedidos = {
    perfil: { id: perfil.id, nombre: perfil.nombre, correo: perfil.correo, rol: perfil.rol },
    cuenta: { id: cuenta.id, nombre: cuenta.nombre },
    centros,
    proveedores,
    puedeGestionar: ctx.gestiona,
    iaDisponible: !!process.env.ANTHROPIC_API_KEY,
    hoy: hoyMadrid(),
  };

  return <PanelPedidos ctx={contexto} />;
}
