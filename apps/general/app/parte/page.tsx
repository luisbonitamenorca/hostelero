import type { Metadata, Viewport } from "next";
import FormularioParte from "./formulario";

/**
 * Parte de mantenimiento desde el móvil — front PÚBLICO e instalable (PWA
 * ligera: manifest + iconos, «Añadir a pantalla de inicio»). Es la mitad
 * «pedir» de la app de Mantenimiento: el mismo formulario, escribiendo en la
 * misma tabla `partes` del Supabase de mantenimiento. La mitad «gestionar»
 * (el panel de Marcos) vive en /mantenimiento dentro de Hostelero.
 */
export const metadata: Metadata = {
  title: "Partes · Bonita Menorca",
  description: "Enviar partes de mantenimiento a Marcos y su equipo",
  manifest: "/parte-manifest.json",
  icons: { apple: "/parte-icon-192.png" },
};

export const viewport: Viewport = { themeColor: "#4A5A3E" };

export default function Parte() {
  return <FormularioParte />;
}
