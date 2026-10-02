import "./reservar-mesa.css";
import type { Metadata } from "next";
import ReservarMesaApp from "./ReservarMesaApp";
import { leerParametros, type ParametrosWidget } from "./parametros";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reserva tu mesa",
  description: "Reserva online en nuestros restaurantes: elige día, hora y comensales.",
  robots: { index: true },
};

/**
 * Widget público. Admite ?r=<slug> (restaurante fijado), ?lang=es|en|ca|fr|de, ?p=<prescriptor>,
 * y los parámetros del aviso de lista de espera (?fecha&hora&pax&espera=<token>).
 */
export default async function ReservarMesaPage({ searchParams }: { searchParams: Promise<ParametrosWidget> }) {
  const sp = await searchParams;
  const p = leerParametros(sp);
  return <ReservarMesaApp slugFijo={p.slug} lang={p.lang} prescriptor={p.prescriptor} inicial={p.inicial} />;
}
