import "../../reservar-mesa/reservar-mesa.css";
import type { Metadata } from "next";
import GestionApp from "./GestionApp";
import { esLang } from "../../reservar-mesa/textos";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu reserva",
  robots: { index: false, follow: false },
};

/**
 * Ficha pública de una reserva por token (/reserva/<token>): ver, reconfirmar, modificar,
 * cancelar, añadir al calendario. El token es la única llave; no se pide nada más.
 * El subpaso de pago vive en /reserva/<token>/pago (pieza de pagos).
 */
export default async function ReservaTokenPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string; accion?: string }> }) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const t = /^[0-9a-f]{32}$/.test(token) ? token : "";
  const lang = esLang(sp.lang) ? sp.lang : null;
  const accion = sp.accion === "confirmar" || sp.accion === "cancelar" || sp.accion === "modificar" ? sp.accion : null;
  return <GestionApp token={t} lang={lang} accion={accion} />;
}
