import "../reservar-mesa.css";
import type { Metadata } from "next";
import ReservarMesaApp from "../ReservarMesaApp";
import { leerParametros, type ParametrosWidget } from "../parametros";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reserva tu mesa",
  description: "Reserva online: elige día, hora y comensales.",
};

/** Widget con el restaurante fijado por ruta (/reservar-mesa/<slug>): es el enlace que se embebe y el del aviso de lista de espera. */
export default async function ReservarMesaSlugPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<ParametrosWidget> }) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const p = leerParametros(sp, slug);
  return <ReservarMesaApp slugFijo={p.slug} lang={p.lang} prescriptor={p.prescriptor} inicial={p.inicial} />;
}
