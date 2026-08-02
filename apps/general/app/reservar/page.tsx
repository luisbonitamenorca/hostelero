import "./reservar.css";
import type { Metadata } from "next";
import ReservarApp from "./ReservarApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reserva de visitas · Binifadet",
  description: "Elige el día y reserva tu experiencia.",
};

export default async function ReservarPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const sp = await searchParams;
  const lang = sp.lang === "en" ? "en" : sp.lang === "fr" ? "fr" : "es";
  return <ReservarApp initialLang={lang} />;
}
