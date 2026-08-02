import "./reservar-mesa.css";
import type { Metadata } from "next";
import ReservarMesaApp from "./ReservarMesaApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reservas · Bonita Menorca",
  description:
    "Reserva tu mesa en los restaurantes de Bonita Menorca: Binifadet, Tamarindos, Casa Tirant y El Bar de Tamarindos.",
};

export default function ReservarMesaPage() {
  return <ReservarMesaApp />;
}
