import { crearClienteServidor } from "@/lib/supabase/server";
import PanelReservas from "./PanelReservas";
import type { Restaurante } from "./tipos";

export const dynamic = "force-dynamic";

export default async function ReservasPage() {
  const sb = await crearClienteServidor();
  const { data } = await sb.from("reservas_restaurantes").select("*").order("orden");
  const restaurantes = (data ?? []) as Restaurante[];

  if (!restaurantes.length) {
    return (
      <main className="contenido">
        <div className="tarjeta">
          <p className="vacio">No hay restaurantes configurados en tu cuenta.</p>
        </div>
      </main>
    );
  }

  return <PanelReservas restaurantes={restaurantes} />;
}
