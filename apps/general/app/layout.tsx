import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hostelero",
  description: "La gestión de tu negocio de hostelería, en un solo sitio",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
