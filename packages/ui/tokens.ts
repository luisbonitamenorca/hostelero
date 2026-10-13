// Identidad Jano · ficha «Pizarra y Salvia» (octubre 2026).
// Jano es la plataforma; Atenea, su asistente de IA. Paleta serena y sobria.
// Las apps replican estos valores como variables CSS en su globals.css.
export const color = {
  // Paleta de la ficha
  pizarra: "#2F3A45", // color principal: cabeceras, botones, texto de marca
  salvia: "#8FAE8B", // acento: núcleo del logo, etiquetas, botones secundarios
  cal: "#F3F4F0", // fondo de página
  niebla: "#DEDFE1", // bordes y superficies suaves
  blanco: "#FFFFFF",
  // Derivados (no están en la ficha; salen de pizarra y salvia)
  pizarraOscura: "#242D36", // hover de botones, texto
  salviaOscura: "#5E7D5A", // salvia legible como texto sobre fondo claro
  gris: "#5C6872",
  grisClaro: "#8A949C",
  // Alias históricos (la plataforma nació verde/coral; se mantienen los nombres)
  verde: "#2F3A45",
  coral: "#D85A30", // ya no es marca: solo avisos y diferencias (Pedidos)
  grafito: "#2F3A45",
  papel: "#F3F4F0",
  tinta: "#242D36",
  borde: "#DEDFE1",
} as const;

export const tipografia = {
  sans: "'Plus Jakarta Sans', system-ui, sans-serif", // titulares 800 · texto 400
  mono: "'IBM Plex Mono', ui-monospace, monospace",
} as const;
