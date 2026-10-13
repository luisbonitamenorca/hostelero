import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jano",
  description: "Las dos caras de tu negocio, a la vista",
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
