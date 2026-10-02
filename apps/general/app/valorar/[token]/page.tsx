import "../../reservar-mesa/reservar-mesa.css";
import type { Metadata } from "next";
import ValorarApp from "./ValorarApp";
import { esLang } from "../../reservar-mesa/textos";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "¿Qué tal fue?",
  robots: { index: false, follow: false },
};

/** Encuesta post-visita por token (/valorar/<token>): comida, atención, entorno, NPS y comentario. */
export default async function ValorarPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string }> }) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const t = /^[0-9a-f]{32}$/.test(token) ? token : "";
  const lang = esLang(sp.lang) ? sp.lang : null;
  return <ValorarApp token={t} lang={lang} />;
}
