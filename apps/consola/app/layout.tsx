import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Consola Jano",
  description: "Administración interna de cuentas de Jano",
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
