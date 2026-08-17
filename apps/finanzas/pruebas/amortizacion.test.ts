import { calcularCuadro, amortizadoHasta, cuentasSugeridas, type Activo } from "../lib/amortizacion.ts";

let fallos = 0;
function comprueba(nombre: string, ok: boolean, detalle = "") {
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}${ok ? "" : " -> " + detalle}`);
}

// --- Caso limpio: alta el dia 1, 10 años ---
const horno: Activo = { fechaAlta: "2026-01-01", valorAdquisicion: 12000, valorResidual: 0, aniosVidaUtil: 10 };
const c1 = calcularCuadro(horno);
comprueba("10 años son 120 meses", c1.length === 120, String(c1.length));
comprueba("cuota mensual de 100", c1[0].importe === 100, String(c1[0].importe));
comprueba("empieza en enero de 2026", c1[0].ejercicio === 2026 && c1[0].periodo === 1);
comprueba("termina en diciembre de 2035", c1.at(-1)!.ejercicio === 2035 && c1.at(-1)!.periodo === 12);
comprueba("el acumulado final cuadra con la base", c1.at(-1)!.acumulado === 12000, String(c1.at(-1)!.acumulado));
comprueba("no queda nada pendiente", c1.at(-1)!.pendiente === 0);

// --- Prorrateo del primer mes ---
const marzo: Activo = { fechaAlta: "2026-03-20", valorAdquisicion: 12000, valorResidual: 0, aniosVidaUtil: 10 };
const c2 = calcularCuadro(marzo);
// Marzo tiene 31 dias; del 20 al 31 son 12 dias. 100 * 12/31 = 38,71
comprueba("primer mes prorrateado por dias", c2[0].importe === 38.71, String(c2[0].importe));
comprueba("el segundo mes ya es cuota entera", c2[1].importe === 100, String(c2[1].importe));
comprueba("el acumulado final sigue cuadrando", c2.at(-1)!.acumulado === 12000, String(c2.at(-1)!.acumulado));

// --- Valor residual: no se amortiza entero ---
const conResidual: Activo = { fechaAlta: "2026-01-01", valorAdquisicion: 30000, valorResidual: 6000, aniosVidaUtil: 8 };
const c3 = calcularCuadro(conResidual);
comprueba("solo se amortiza la base, no el valor entero", c3.at(-1)!.acumulado === 24000, String(c3.at(-1)!.acumulado));

// --- El caso que deja centimos colgando si no se ajusta el ultimo periodo ---
const feo: Activo = { fechaAlta: "2026-01-01", valorAdquisicion: 10000, valorResidual: 0, aniosVidaUtil: 3 };
const c4 = calcularCuadro(feo);
// 10000/36 = 277,7777... Si se redondea 36 veces, sobran o faltan centimos.
comprueba("con cuota no exacta el acumulado sigue cuadrando", c4.at(-1)!.acumulado === 10000, String(c4.at(-1)!.acumulado));
comprueba("y la suma de importes tambien", Math.abs(c4.reduce((s, f) => s + f.importe, 0) - 10000) < 0.005);

// --- Vida util corta y con decimales ---
const corto: Activo = { fechaAlta: "2026-06-10", valorAdquisicion: 1500, valorResidual: 0, aniosVidaUtil: 1.5 };
const c5 = calcularCuadro(corto);
comprueba("vida util con decimales cuadra", c5.at(-1)!.acumulado === 1500, String(c5.at(-1)!.acumulado));

// --- Nada que amortizar ---
comprueba("residual igual al valor: no hay cuadro", calcularCuadro({ fechaAlta: "2026-01-01", valorAdquisicion: 5000, valorResidual: 5000, aniosVidaUtil: 5 }).length === 0);

// --- Amortizado a una fecha ---
comprueba("a 30/06/2026 lleva 6 meses", amortizadoHasta(c1, new Date(2026, 5, 30)) === 600, String(amortizadoHasta(c1, new Date(2026, 5, 30))));

// --- Cuentas sugeridas del PGC ---
// Los casos salen del plan REAL de A3: la sugerencia conserva el sufijo del
// centro, que es como Lucia desglosa la amortizacion.
comprueba("maquinaria bodega -> su acumulada y su dotacion",
  JSON.stringify(cuentasSugeridas("213000700")) === JSON.stringify({ acumulada: "281300700", dotacion: "681000700" }));
comprueba("aplicaciones informaticas -> intangible",
  JSON.stringify(cuentasSugeridas("206000800")) === JSON.stringify({ acumulada: "280600800", dotacion: "680000800" }));
comprueba("mobiliario bar tamarindos conserva el sufijo",
  cuentasSugeridas("216001000")?.acumulada === "281601000");
comprueba("una cuenta que no es de inmovilizado no sugiere nada", cuentasSugeridas("600000000") === null);
comprueba("un codigo corto ya no vale", cuentasSugeridas("213") === null);

console.log(fallos === 0 ? "\nTODO CORRECTO" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
