"use client";

/**
 * Descarga el informe como CSV que Excel (es-ES) abre con doble clic: BOM
 * UTF-8 para que respete las tildes, punto y coma de separador y coma decimal,
 * que es lo que espera un Excel en español. No es un .xlsx con estilos: son
 * los datos limpios, que es lo que se quiere para seguir trabajándolos.
 *
 * Los números viajan como número (coma decimal, sin separador de miles) y no
 * como texto formateado: así Excel los suma sin pelearse.
 */
export type CeldaExcel = string | number | null;

function aCsv(filas: CeldaExcel[][]): string {
  const escapar = (c: CeldaExcel): string => {
    if (c === null) return "";
    if (typeof c === "number") return String(c).replace(".", ",");
    const necesitaComillas = /[";\n]/.test(c);
    return necesitaComillas ? `"${c.replace(/"/g, '""')}"` : c;
  };
  return filas.map((f) => f.map(escapar).join(";")).join("\r\n");
}

export default function DescargarExcel({
  nombre,
  filas,
}: {
  /** Nombre del fichero sin extensión, p. ej. "pyg-2026-meses". */
  nombre: string;
  filas: CeldaExcel[][];
}) {
  function descargar() {
    const blob = new Blob(["\uFEFF" + aCsv(filas)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nombre}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" className="boton boton-secundario" onClick={descargar}>
      Descargar (Excel)
    </button>
  );
}
