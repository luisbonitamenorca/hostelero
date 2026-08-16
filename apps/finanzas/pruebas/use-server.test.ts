/**
 * Guardia contra un fallo que ni TypeScript ni `next build` detectan.
 *
 * Un fichero con "use server" solo puede exportar funciones async. Si exporta
 * cualquier otra cosa (un array de constantes, por ejemplo), compila y despliega
 * sin una sola queja, y revienta EN PRODUCCIÓN al cargar el módulo:
 *
 *   Error: A "use server" file can only export async functions, found object.
 *
 * Y no cae solo la pantalla culpable: cae toda pantalla que importe ese fichero.
 * Pasó el 16-08-2026 con CAUSAS_RECTIFICACION en app/acciones.ts, y tumbó
 * /facturas/nueva y /facturas-recibidas con un "Application error" a secas.
 *
 * Los tipos no cuentan: desaparecen al compilar.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

let fallos = 0;
function comprueba(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}${ok ? "" : " -> " + detalle}`);
}

const RAIZ = join(import.meta.dirname, "..");
const IGNORADAS = new Set(["node_modules", ".next", ".git", "supabase"]);

function ficheros(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    if (IGNORADAS.has(entrada)) continue;
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...ficheros(ruta));
    else if (/\.tsx?$/.test(entrada)) salida.push(ruta);
  }
  return salida;
}

/** Exportaciones que sí valen: tipos (se borran) y funciones async. */
const PERMITIDA = /^export\s+(type\b|interface\b|async\s+function\b|default\s+async\s+function\b)/;

const conUseServer = ficheros(RAIZ).filter((f) => {
  const primera = readFileSync(f, "utf8").split("\n", 1)[0].trim();
  return primera === '"use server";' || primera === "'use server';";
});

comprueba("se encuentran ficheros de acciones que revisar", conUseServer.length > 0, String(conUseServer.length));

for (const fichero of conUseServer) {
  const corto = fichero.slice(RAIZ.length + 1);
  const malas = readFileSync(fichero, "utf8")
    .split("\n")
    .map((linea, i) => ({ linea: linea.trimEnd(), n: i + 1 }))
    .filter(({ linea }) => linea.startsWith("export") && !PERMITIDA.test(linea));

  comprueba(
    `${corto} solo exporta funciones async`,
    malas.length === 0,
    malas.map((m) => `línea ${m.n}: ${m.linea}`).join(" | "),
  );
}

console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} fallo(s).`);
process.exit(fallos === 0 ? 0 : 1);
