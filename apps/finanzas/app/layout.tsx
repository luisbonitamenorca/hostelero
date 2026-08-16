import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hostelero · Finanzas",
  description: "Facturación, contabilidad, bancos e impuestos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
