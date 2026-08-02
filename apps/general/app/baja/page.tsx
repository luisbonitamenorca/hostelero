import type { Metadata } from "next";
import BajaApp from "./BajaApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Baja de comunicaciones · Bonita Menorca",
  robots: { index: false },
};

export default async function BajaPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; t?: string }>;
}) {
  const sp = await searchParams;
  return <BajaApp email={(sp.e || "").trim().toLowerCase()} token={(sp.t || "").trim()} />;
}
