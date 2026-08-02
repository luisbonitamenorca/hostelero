import type { Metadata } from "next";
import KioscoApp from "./KioscoApp";
import "./kiosco.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Fichaje · Bonita Menorca",
  robots: { index: false },
};

export default function KioscoPage() {
  return <KioscoApp />;
}
