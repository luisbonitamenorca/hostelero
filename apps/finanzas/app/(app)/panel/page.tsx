import { exigirFacturacion } from "@/lib/supabase/server";
import { euros } from "@/lib/importes";

export const dynamic = "force-dynamic";

export default async function Panel() {
  const { supabase, cuenta, sociedad } = await exigirFacturacion();

  const [{ count: clientes }, { count: series }, { data: borradores }, { count: expedidas }] =
    await Promise.all([
      supabase.from("fin_clientes").select("id", { head: true, count: "exact" }).eq("activo", true),
      supabase.from("fin_series").select("id", { head: true, count: "exact" }).eq("activa", true),
      supabase.from("fin_facturas").select("total").eq("estado", "borrador"),
      supabase.from("fin_facturas").select("id", { head: true, count: "exact" }).eq("estado", "expedida"),
    ]);

  const sumaBorradores = (borradores ?? []).reduce((s, f) => s + Number(f.total), 0);

  return (
    <>
      <div className="cabecera-pagina">
        <h1>Panel</h1>
        <p className="sub">
          {sociedad ? `${sociedad.nombre} · ${sociedad.cif ?? "sin CIF"}` : cuenta.nombre}
        </p>
      </div>
      <div className="tarjetas">
        <div className="tarjeta">
          <p className="etiqueta">Clientes activos</p>
          <p className="valor dato">{clientes ?? 0}</p>
          <p className="detalle">Clientes fiscales con NIF y domicilio.</p>
        </div>
        <div className="tarjeta">
          <p className="etiqueta">Series activas</p>
          <p className="valor dato">{series ?? 0}</p>
          <p className="detalle">Sin serie activa no se puede expedir ninguna factura.</p>
        </div>
        <div className="tarjeta">
          <p className="etiqueta">Borradores</p>
          <p className="valor dato">{borradores?.length ?? 0}</p>
          <p className="detalle">
            {borradores && borradores.length > 0
              ? `${euros(sumaBorradores)} sin expedir.`
              : "Nada pendiente de expedir."}
          </p>
        </div>
        <div className="tarjeta">
          <p className="etiqueta">Expedidas</p>
          <p className="valor dato">{expedidas ?? 0}</p>
          <p className="detalle">
            {expedidas ? "Con registro Verifactu encadenado." : "Aún no se ha expedido ninguna."}
          </p>
        </div>
        <div className="tarjeta">
          <p className="etiqueta">Siguiente</p>
          <p className="valor">Expedición + Verifactu</p>
          <p className="detalle">
            Falta la migración F1a (funciones de expedir y anular) y el PDF con QR.
          </p>
        </div>
      </div>
    </>
  );
}
