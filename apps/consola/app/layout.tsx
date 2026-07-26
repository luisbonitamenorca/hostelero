import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Consola Hostelero",
  description: "Administración interna de cuentas de Hostelero",
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
